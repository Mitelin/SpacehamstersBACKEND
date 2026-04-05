from __future__ import annotations

import asyncio
from decimal import Decimal
from datetime import datetime
from typing import Any

from .. import db
from ..esi import ESIClient, parse_x_pages
from ..logger import log


def _jsonable_value(value: Any) -> Any:
    if isinstance(value, Decimal):
        return float(value)
    if isinstance(value, datetime):
        return value.isoformat(sep=" ")
    return value


def _jsonable_rows(rows: list[dict[str, Any]]) -> list[dict[str, Any]]:
    return [{k: _jsonable_value(v) for k, v in row.items()} for row in rows]


def _extract_year_months(items: list[dict[str, Any]], field_name: str) -> set[tuple[int, int]]:
    months: set[tuple[int, int]] = set()
    for item in items or []:
        value = item.get(field_name)
        if not value:
            continue
        try:
            parsed = datetime.fromisoformat(str(value).replace("Z", "+00:00"))
        except ValueError:
            try:
                parsed = datetime.strptime(str(value)[:19], "%Y-%m-%dT%H:%M:%S")
            except ValueError:
                try:
                    parsed = datetime.strptime(str(value)[:19], "%Y-%m-%d %H:%M:%S")
                except ValueError:
                    continue
        months.add((parsed.year, parsed.month))
    return months


class JobsService:
    def __init__(self, esi: ESIClient):
        self._esi = esi
        self._lock = asyncio.Lock()

    async def sync(self, corporation_id: int, access_token: str) -> int:
        if self._lock.locked():
            raise RuntimeError("Předchozí synchronizace ještě není dokončena.")
        async with self._lock:
            log(2, f"jobs.sync ({corporation_id})")
            page = 1
            cnt = 0
            max_page = 1
            touched_months: set[tuple[int, int]] = set()
            while page <= max_page:
                url = f"/corporations/{corporation_id}/industry/jobs/"
                resp = await self._esi.get(
                    url,
                    token=access_token,
                    params={"datasource": "tranquility", "include_completed": "true", "page": str(page)},
                )
                max_page = parse_x_pages(resp)
                if resp.status_code != 200:
                    raise RuntimeError(resp.reason_phrase)
                items = resp.json()
                touched_months.update(_extract_year_months(items, "start_date"))
                cnt += await self.store(items)
                page += 1

            if touched_months:
                await self.refresh_monthly_snapshots(touched_months)
            return cnt

    async def store(self, jobs: list[dict[str, Any]]) -> int:
        cnt = 0
        async with db.connection() as conn:
            async with conn.cursor() as cur:
                await conn.begin()
                try:
                    for job in list(jobs):
                        await cur.execute(
                            """
                            REPLACE INTO corpJobs (
                                jobID, activityID, blueprintID, blueprintLocationID, blueprintTypeID,
                                completedCharacterID, completedDate, cost, duration, endDate, facilityID,
                                installerID, licensedRuns, outputLocationID, pauseDate, probability,
                                productTypeID, runs, startDate, stationID, status, successfulRuns
                            ) VALUES (%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s)
                            """,
                            [
                                job.get("job_id"),
                                job.get("activity_id"),
                                job.get("blueprint_id"),
                                job.get("blueprint_location_id"),
                                job.get("blueprint_type_id"),
                                job.get("completed_character_id"),
                                _esi_dt(job.get("completed_date")),
                                job.get("cost"),
                                job.get("duration"),
                                _esi_dt(job.get("end_date")),
                                job.get("facility_id"),
                                job.get("installer_id"),
                                job.get("licensed_runs"),
                                job.get("output_location_id"),
                                _esi_dt(job.get("pause_date")),
                                job.get("probability"),
                                job.get("product_type_id"),
                                job.get("runs"),
                                _esi_dt(job.get("start_date")),
                                job.get("station_id"),
                                job.get("status"),
                                job.get("successful_runs"),
                            ],
                        )
                        cnt += 1
                        await conn.commit()
                except Exception:
                    await conn.rollback()
                    raise
        return cnt

    async def refresh_monthly_snapshots(self, months: set[tuple[int, int]]) -> int:
        cnt = 0
        async with db.connection() as conn:
            async with conn.cursor() as cur:
                for year, month in sorted(months):
                    month_start = f"{int(year):04d}-{int(month):02d}-01"
                    await cur.execute(
                        "DELETE FROM corpJobsReportMonthly WHERE year=%s AND month=%s",
                        [int(year), int(month)],
                    )
                    await cur.execute(
                        """
                        INSERT INTO corpJobsReportMonthly (
                            year, month, installerID,
                            manufacturing, researchTE, researchME, copying, invention, reaction
                        )
                        SELECT
                            %s,
                            %s,
                            j.installerID,
                            SUM(CASE WHEN j.activityID = 1 THEN j.duration END) AS manufacturing,
                            SUM(CASE WHEN j.activityID = 3 THEN j.duration END) AS researchTE,
                            SUM(CASE WHEN j.activityID = 4 THEN j.duration END) AS researchME,
                            SUM(CASE WHEN j.activityID = 5 THEN j.duration END) AS copying,
                            SUM(CASE WHEN j.activityID = 8 THEN j.duration END) AS invention,
                            SUM(CASE WHEN j.activityID = 9 OR j.activityID = 11 THEN j.duration END) AS reaction
                        FROM corpJobs j
                        WHERE j.startDate >= %s AND j.startDate < DATE_ADD(%s, INTERVAL 1 MONTH)
                        GROUP BY j.installerID
                        """,
                        [int(year), int(month), month_start, month_start],
                    )
                    cnt += max(int(cur.rowcount), 0)
        return cnt

    async def get_jobs(self, location_id: int) -> list[dict[str, Any]]:
        return await db.fetch_all(
            """
            SELECT j.activityID, j.blueprintTypeID, itb.typeName blueprintType, j.productTypeID, it.typeName productType,
                   sum(j.runs * NVL(prd.quantity, 1)) quantity
            FROM corpJobs j
            JOIN invTypes itb on itb.typeID = j.blueprintTypeID
            JOIN invTypes it on it.typeID = j.productTypeID
            left JOIN industryActivityProducts prd on prd.typeId = j.blueprintTypeID and prd.activityId IN (1, 11) AND prd.productTypeID = j.productTypeID
            WHERE j.outputLocationID = %s and j.STATUS = 'active'
            GROUP BY j.activityID, j.blueprintTypeID, j.productTypeID, it.typeName
            """,
            [location_id],
        )

    async def get_jobs_report(self, year: int, month: int) -> list[dict[str, Any]]:
        month_start = f"{int(year):04d}-{int(month):02d}-01"
        rows = await db.fetch_all(
            """
            SELECT
                j.installerID AS installerId,
                SUM( CASE WHEN j.activityID = 1 THEN j.duration END) AS manufacturing,
                SUM( CASE WHEN j.activityID = 3 THEN j.duration END) AS researchTE,
                SUM( CASE WHEN j.activityID = 4 THEN j.duration END) AS researchME,
                SUM( CASE WHEN j.activityID = 5 THEN j.duration END) AS copying,
                SUM( CASE WHEN j.activityID = 8 THEN j.duration END) AS invention,
                SUM( CASE WHEN j.activityID = 9 OR j.activityID = 11 THEN j.duration END) AS reaction
            FROM corpJobs j
            WHERE j.startDate >= %s and j.startDate < DATE_ADD(%s, INTERVAL 1 MONTH)
            GROUP BY j.installerID
            """,
            [month_start, month_start],
        )

        if rows:
            return _jsonable_rows(rows)

        rows = await db.fetch_all(
            """
            SELECT
                installerID AS installerId,
                manufacturing,
                researchTE,
                researchME,
                copying,
                invention,
                reaction
            FROM corpJobsReportMonthly
            WHERE year = %s AND month = %s
            """,
            [int(year), int(month)],
        )
        return _jsonable_rows(rows)

    async def get_jobs_velocity(self, categories: Any) -> list[dict[str, Any]]:
        category_ids = [int(c) for c in (categories or [6, 7])]
        if not category_ids:
            category_ids = [6, 7]
        category_placeholders = ", ".join(["%s"] * len(category_ids))

        rows = await db.fetch_all(
            f"""
            SELECT t.typeName, j0.cnt as w0, j1.cnt as w1, j2.cnt as w2, j3.cnt as w3, j4.cnt as w4, j5.cnt as w5,
                   j6.cnt as w6, j7.cnt as w7, j8.cnt as w8, j9.cnt as w9, j10.cnt as w10
            FROM invGroups g
            join invTypes t on g.groupID = t.groupID
            LEFT JOIN (SELECT sum(runs) as cnt, productTypeID FROM corpJobs WHERE completedDate is null GROUP BY productTypeID) j0 on t.typeID = j0.productTypeID
            LEFT JOIN (SELECT sum(runs) as cnt, productTypeID FROM corpJobs WHERE completedDate >=  DATE(NOW() - INTERVAL 7 * 1 DAY) AND completedDate <  DATE(NOW() - INTERVAL 7 * 0 DAY) GROUP BY productTypeID) j1 on t.typeID = j1.productTypeID
            LEFT JOIN (SELECT sum(runs) as cnt, productTypeID FROM corpJobs WHERE completedDate >=  DATE(NOW() - INTERVAL 7 * 2 DAY) AND completedDate <  DATE(NOW() - INTERVAL 7 * 1 DAY) GROUP BY productTypeID) j2 on t.typeID = j2.productTypeID
            LEFT JOIN (SELECT sum(runs) as cnt, productTypeID FROM corpJobs WHERE completedDate >=  DATE(NOW() - INTERVAL 7 * 3 DAY) AND completedDate <  DATE(NOW() - INTERVAL 7 * 2 DAY) GROUP BY productTypeID) j3 on t.typeID = j3.productTypeID
            LEFT JOIN (SELECT sum(runs) as cnt, productTypeID FROM corpJobs WHERE completedDate >=  DATE(NOW() - INTERVAL 7 * 4 DAY) AND completedDate <  DATE(NOW() - INTERVAL 7 * 3 DAY) GROUP BY productTypeID) j4 on t.typeID = j4.productTypeID
            LEFT JOIN (SELECT sum(runs) as cnt, productTypeID FROM corpJobs WHERE completedDate >=  DATE(NOW() - INTERVAL 7 * 5 DAY) AND completedDate <  DATE(NOW() - INTERVAL 7 * 4 DAY) GROUP BY productTypeID) j5 on t.typeID = j5.productTypeID
            LEFT JOIN (SELECT sum(runs) as cnt, productTypeID FROM corpJobs WHERE completedDate >=  DATE(NOW() - INTERVAL 7 * 6 DAY) AND completedDate <  DATE(NOW() - INTERVAL 7 * 5 DAY) GROUP BY productTypeID) j6 on t.typeID = j6.productTypeID
            LEFT JOIN (SELECT sum(runs) as cnt, productTypeID FROM corpJobs WHERE completedDate >=  DATE(NOW() - INTERVAL 7 * 7 DAY) AND completedDate <  DATE(NOW() - INTERVAL 7 * 6 DAY) GROUP BY productTypeID) j7 on t.typeID = j7.productTypeID
            LEFT JOIN (SELECT sum(runs) as cnt, productTypeID FROM corpJobs WHERE completedDate >=  DATE(NOW() - INTERVAL 7 * 8 DAY) AND completedDate <  DATE(NOW() - INTERVAL 7 * 7 DAY) GROUP BY productTypeID) j8 on t.typeID = j8.productTypeID
            LEFT JOIN (SELECT sum(runs) as cnt, productTypeID FROM corpJobs WHERE completedDate >=  DATE(NOW() - INTERVAL 7 * 9 DAY) AND completedDate <  DATE(NOW() - INTERVAL 7 * 8 DAY) GROUP BY productTypeID) j9 on t.typeID = j9.productTypeID
            LEFT JOIN (SELECT sum(runs) as cnt, productTypeID FROM corpJobs WHERE completedDate >=  DATE(NOW() - INTERVAL 7 * 10 DAY) AND completedDate <  DATE(NOW() - INTERVAL 7 * 9 DAY) GROUP BY productTypeID) j10 on t.typeID = j10.productTypeID
                        where g.categoryID in ({category_placeholders})
                            and (j0.cnt is not null or j1.cnt is not null or j2.cnt is not null or j3.cnt is not null or j4.cnt is not null or j5.cnt is not null
                   or j6.cnt is not null or j7.cnt is not null or j8.cnt is not null or j9.cnt is not null or j10.cnt is not null)
            order by t.typeName
            """,
            category_ids,
        )
        return _jsonable_rows(rows)

    async def get_all_jobs_direct(self, corporation_id: int, access_token: str) -> list[dict[str, Any]]:
        log(2, "jobs.getAllJobsDirect ()")

        page = 1
        max_page = 1
        items: list[dict[str, Any]] = []
        while page <= max_page:
            resp = await self._esi.get(
                f"/corporations/{corporation_id}/industry/jobs/",
                token=access_token,
                params={"datasource": "tranquility", "include_completed": "false", "page": str(page)},
            )
            max_page = parse_x_pages(resp)
            if resp.status_code != 200:
                raise RuntimeError(resp.reason_phrase)
            items.extend(resp.json())
            page += 1

        # Deduplicate typeIds and look up names/quantities in DB
        type_ids = {int(i["blueprint_type_id"]) for i in items if i.get("blueprint_type_id") is not None}
        type_ids |= {int(i["product_type_id"]) for i in items if i.get("product_type_id") is not None}
        type_names: dict[int, dict[str, Any]] = {}
        for type_id in sorted(type_ids):
            rows = await db.fetch_all(
                """
                SELECT it.typeID, it.typeName, prd.quantity
                FROM invTypes it
                left JOIN industryActivityProducts prd on prd.activityId IN (1, 11) AND prd.productTypeID = it.typeID
                WHERE it.typeId = %s
                """,
                [type_id],
            )
            if rows:
                type_names[int(rows[0]["typeID"])] = rows[0]

        rows_out: list[dict[str, Any]] = []
        for item in items:
            blueprint_type = type_names.get(int(item.get("blueprint_type_id")))
            product_type = type_names.get(int(item.get("product_type_id")))
            activity_id = int(item.get("activity_id"))
            if activity_id == 1:
                activity = "Manufacturing"
            elif activity_id == 3:
                activity = "Time efficiency research"
            elif activity_id == 5:
                activity = "Copying"
            elif activity_id == 9:
                activity = "Reaction"
            else:
                activity = str(activity_id)

            qty_per_run = float(product_type.get("quantity") or 0) if product_type else 0
            runs = int(item.get("runs") or 0)
            rows_out.append(
                {
                    "locationId": item.get("location_id"),
                    "duration": item.get("duration"),
                    "runs": runs,
                    "outputLocationID": item.get("output_location_id"),
                    "activity": activity,
                    "activityID": activity_id,
                    "blueprintTypeID": item.get("blueprint_type_id"),
                    "blueprintType": blueprint_type.get("typeName") if blueprint_type else "undefined",
                    "productTypeID": item.get("product_type_id"),
                    "productType": product_type.get("typeName") if product_type else "undefined",
                    "installerID": item.get("installer_id"),
                    "quantity": runs * qty_per_run,
                }
            )

        return rows_out

    async def get_all_jobs(self) -> list[dict[str, Any]]:
        return await db.fetch_all(
            """
            SELECT
                j.jobID, j.activityID, j.blueprintID, j.blueprintLocationID, j.blueprintTypeID,
                bp.typeName blueprintType, j.completedCharacterID, cn.name completedCharacter,
                j.completedDate, j.cost, j.duration, j.endDate, j.facilityID, cnf.name facility,
                j.installerID, cni.name installer, j.licensedRuns, j.outputLocationID, cnl.name outputLocation,
                j.pauseDate, j.probability, j.productTypeID, it.typeName productType,
                j.runs, j.startDate, j.stationID, j.status, j.successfulRuns
            FROM corpJobs j
            LEFT JOIN invTypes bp on bp.typeID = j.blueprintTypeID
            LEFT JOIN corpNames cn on cn.id = j.completedCharacterID
            LEFT JOIN corpAssetsNames cnf on cnf.itemID = j.facilityID
            LEFT JOIN corpNames cni on cni.id = j.installerID
            LEFT JOIN corpAssetsNames cnl on cnl.itemID = j.outputLocationID
            LEFT JOIN invTypes it on it.typeID = j.productTypeID
            """,
        )


def _esi_dt(value: str | None) -> str | None:
    if not value:
        return None
    # Node: slice(0,19).replace('T',' ')
    return value[:19].replace("T", " ")
