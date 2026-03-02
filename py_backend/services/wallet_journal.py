from __future__ import annotations

import asyncio
from datetime import datetime
from typing import Any

from .. import db
from ..esi import ESIClient, parse_x_pages
from ..logger import log


class WalletJournalService:
    def __init__(self, esi: ESIClient):
        self._esi = esi
        self._lock = asyncio.Lock()

    async def sync(self, corporation_id: int, wallet: int, access_token: str) -> int:
        if self._lock.locked():
            raise RuntimeError("Předchozí synchronizace ještě není dokončena.")
        async with self._lock:
            log(2, f"walletJournal.sync ({corporation_id}, {wallet})")
            page = 1
            cnt = 0
            max_page = 1
            while page <= max_page:
                resp = await self._esi.get(
                    f"/corporations/{corporation_id}/wallets/{wallet}/journal/",
                    token=access_token,
                    params={"datasource": "tranquility", "page": str(page)},
                )
                max_page = parse_x_pages(resp)
                if resp.status_code != 200:
                    raise RuntimeError(resp.reason_phrase)
                cnt += await self.store(resp.json())
                page += 1
            return cnt

    async def sync_names(self, access_token: str) -> int:
        cnt = 0
        rows = await db.fetch_all(
            """
            SELECT ids.ID
            FROM (
                SELECT DISTINCT firstPartyId ID from corpWalletJournal
                UNION SELECT DISTINCT secondPartyId from corpWalletJournal
            ) ids
            LEFT JOIN corpNames cn on cn.id = ids.id
            WHERE cn.id is null and ids.id is not null
            LIMIT 999
            """,
        )

        if rows:
            ids = [r["ID"] for r in rows]
            resp = await self._esi.post("/universe/names/", token=access_token, json=ids)
            if resp.status_code != 200:
                raise RuntimeError(resp.reason_phrase)
            cnt = await self.store_names(resp.json())
        return cnt

    async def store(self, items: list[dict[str, Any]]) -> int:
        cnt = 0
        async with db.connection() as conn:
            async with conn.cursor() as cur:
                for item in list(items):
                    await cur.execute(
                        """
                        REPLACE INTO corpWalletJournal (
                            id, amount, balance, contextID, contextIDType, date,
                            description, firstPartyID, reason, refType,
                            secondPartyId, tax, taxReceiverID
                        ) VALUES (%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s)
                        """,
                        [
                            item.get("id"),
                            item.get("amount"),
                            item.get("balance"),
                            item.get("context_id"),
                            item.get("context_id_type"),
                            _esi_dt(item.get("date")),
                            item.get("description"),
                            item.get("first_party_id"),
                            item.get("reason"),
                            item.get("ref_type"),
                            item.get("second_party_id"),
                            item.get("tax"),
                            item.get("tax_receiver_id"),
                        ],
                    )
                    cnt += 1
        return cnt

    async def store_names(self, items: list[dict[str, Any]]) -> int:
        cnt = 0
        async with db.connection() as conn:
            async with conn.cursor() as cur:
                for item in list(items):
                    await cur.execute(
                        "REPLACE INTO corpNames (ID, name, category) VALUES (%s,%s,%s)",
                        [item.get("id"), item.get("name"), item.get("category")],
                    )
                    cnt += 1
        return cnt

    async def get_report(self, wallet: int, year: int, month: int, types: Any) -> list[dict[str, Any]]:
                month_start = f"{int(year):04d}-{int(month):02d}-01"

                type_list = _normalize_types(types)
                if not type_list:
                        raise RuntimeError("types parameter missing")

                in_placeholders = ",".join(["%s"] * len(type_list))

                rows = await db.fetch_all(
                        f"""
                        SELECT SUM(amount) amount, secondPartyId
                        FROM corpWalletJournal
                        WHERE date >= %s and date < DATE_ADD(%s, INTERVAL 1 MONTH)
                            AND refType IN ({in_placeholders})
                        GROUP BY secondPartyId
                        """,
                        [month_start, month_start, *type_list],
                )

                if rows:
                        return rows

                # Fallback to monthly snapshot if raw table is missing historical data.
                return await db.fetch_all(
                        f"""
                        SELECT SUM(amount) amount, secondPartyId
                        FROM corpWalletJournalReportMonthly
                        WHERE wallet = %s AND year = %s AND month = %s
                            AND refType IN ({in_placeholders})
                        GROUP BY secondPartyId
                        """,
                        [int(wallet), int(year), int(month), *type_list],
                )

    async def get_pl(self, year: int, month: int) -> list[dict[str, Any]]:
        m = int(month)
        y = int(year)
        if y < 2021 or y > 2100:
            raise RuntimeError("Invalid year")
        if m < 1 or m > 12:
            raise RuntimeError("Invalid month")

        date_from = datetime(y, m, 1).replace(day=1)
        if m == 12:
            date_to = datetime(y + 1, 1, 1)
        else:
            date_to = datetime(y, m + 1, 1)

        return await db.fetch_all(
            """
            SELECT
                  wj.id
                , wj.date
                , wj.refType
                , wj.cd
                , it.typeId
                , it.typeName
                , ig.groupID
                , ig.groupName
                , ic.categoryID
                , ic.categoryName
                , wj.quantity
                , wj.amount
                , wj.duration
                , wj.installerID
                , wj.installerName
                , wj.partyId
                , cn.name partyName
                , wj.description
            FROM (SELECT
                    wj.id
                , wj.date
                , wj.refType
                , CASE WHEN wj.amount < 0 THEN 'D' ELSE 'C' END cd
                , nvl(wt.typeId, j.productTypeId) typeId
                , nvl(wt.quantity, 1) quantity
                , ABS(wj.amount) amount
                , j.duration
                , j.installerID
                , cn.name installerName
                , CASE
                    WHEN wj.refType in ('market_transaction', 'market_escrow') AND wj.amount >= 0 THEN wj.firstPartyId
                    WHEN wj.refType = 'player_donation' THEN wj.firstPartyId
                    ELSE wj.secondPartyId
                    END partyId
                , wj.description
                FROM corpWalletJournal wj
                LEFT JOIN corpWalletTransactions wt on wt.transactionID = wj.contextID and wj.contextIDType = 'market_transaction_id'
                LEFT JOIN corpJobs j on j.jobID = wj.contextID and wj.contextIDType = 'industry_job_id'
                LEFT JOIN corpNames cn on cn.id = j.installerID
                ) wj
            LEFT JOIN invTypes it on it.typeID = wj.typeId
            LEFT JOIN invGroups ig on ig.groupID = it.groupID
            LEFT JOIN invCategories ic on ic.categoryID = ig.categoryID
            LEFT JOIN corpNames cn on cn.id = wj.partyId
            WHERE wj.date >= %s AND wj.date < %s
            order by wj.date desc
            """,
            [date_from, date_to],
        )


def _esi_dt(value: str | None) -> str | None:
    if not value:
        return None
    return value[:19].replace("T", " ")


def _normalize_types(types: Any) -> list[str]:
    if types is None:
        return []
    if isinstance(types, (list, tuple)):
        return [str(t) for t in types if t is not None and str(t) != ""]
    return [str(types)]
