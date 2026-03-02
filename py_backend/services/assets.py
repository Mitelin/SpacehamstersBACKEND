from __future__ import annotations

import asyncio
from typing import Any

from .. import db
from ..esi import ESIClient, parse_x_pages
from ..logger import log


class AssetsService:
    def __init__(self, esi: ESIClient):
        self._esi = esi
        self._lock = asyncio.Lock()

    async def sync(self, corporation_id: int, access_token: str) -> int:
        if self._lock.locked():
            raise RuntimeError("Předchozí synchronizace ještě není dokončena.")
        async with self._lock:
            log(2, f"assets.sync ({corporation_id})")
            await db.execute("TRUNCATE TABLE corpAssetsTemp")

            page = 1
            cnt = 0
            max_page = 1
            while page <= max_page:
                resp = await self._esi.get(
                    f"/corporations/{corporation_id}/assets/",
                    token=access_token,
                    params={"datasource": "tranquility", "page": str(page)},
                )
                max_page = parse_x_pages(resp)
                if resp.status_code != 200:
                    raise RuntimeError(resp.reason_phrase)
                cnt += await self.store(resp.json())
                page += 1

            await db.execute("TRUNCATE TABLE corpAssets")
            await db.execute(
                """
                INSERT INTO corpAssets (itemID, typeID, locationType, locationId, locationFlag, quantity, isSingleton, isBlueprintCopy)
                SELECT itemID, typeID, locationType, locationId, locationFlag, quantity, isSingleton, isBlueprintCopy FROM corpAssetsTemp
                """
            )
            await self.sync_names(corporation_id, access_token)
            return cnt

    async def sync_names(self, corporation_id: int, access_token: str) -> int:
        log(2, f"assets.syncNames ({corporation_id})")
        cnt = 0

        # 1) Named assets (singleton ships/stations/containers)
        rows = await db.fetch_all(
            """
            SELECT ass.itemID
            FROM corpAssets ass
            JOIN invTypes it on it.typeID = ass.typeID
            JOIN invGroups ig on ig.groupID = it.groupID
            WHERE ass.isSingleton = 1 and ig.categoryID in (2, 6, 65)
            """
        )
        if rows:
            ids = [r["itemID"] for r in rows]
            resp = await self._esi.post(
                f"/corporations/{corporation_id}/assets/names/",
                token=access_token,
                json=ids,
            )
            if resp.status_code != 200:
                raise RuntimeError(resp.reason_phrase)
            items = resp.json()
            await self.store_names(items)
            cnt += len(items)

        # 2) Unknown structures (player-owned)
        rows = await db.fetch_all(
            """
            SELECT stat.locationID
            FROM (SELECT distinct locationID FROM corpAssets a WHERE a.locationFlag in ('OfficeFolder', 'CorpDeliveries') and locationID >= 100000000) stat
            LEFT JOIN corpAssetsNames an on an.itemID = stat.locationID
            WHERE an.itemId IS NULL
            """
        )
        for row in rows:
            location_id = int(row["locationID"])
            resp = await self._esi.get(
                f"/universe/structures/{location_id}/",
                token=access_token,
                params={"datasource": "tranquility"},
            )
            if resp.status_code == 200:
                data = resp.json()
                await self.store_names([{"item_id": location_id, "name": data.get("name") or str(location_id)}])
                cnt += 1

        # 3) Unknown stations (NPC)
        rows = await db.fetch_all(
            """
            SELECT stat.locationID
            FROM (SELECT distinct locationID FROM corpAssets a WHERE a.locationFlag in ('OfficeFolder', 'CorpDeliveries') and locationID < 100000000) stat
            LEFT JOIN corpAssetsNames an on an.itemID = stat.locationID
            WHERE an.itemId IS NULL
            """
        )
        for row in rows:
            location_id = int(row["locationID"])
            resp = await self._esi.get(
                f"/universe/stations/{location_id}/",
                token=access_token,
                params={"datasource": "tranquility"},
            )
            if resp.status_code == 200:
                data = resp.json()
                await self.store_names([{"item_id": location_id, "name": data.get("name") or str(location_id)}])
                cnt += 1

        return cnt

    async def store(self, items: list[dict[str, Any]]) -> int:
        cnt = 0
        async with db.connection() as conn:
            async with conn.cursor() as cur:
                await conn.begin()
                try:
                    for item in list(items):
                        await cur.execute(
                            """
                            INSERT INTO corpAssetsTemp (
                                itemID, typeID, locationType, locationId, locationFlag, quantity, isSingleton, isBlueprintCopy
                            ) VALUES (?,?,?,?,?,?,?,?)
                            """,
                            [
                                item.get("item_id"),
                                item.get("type_id"),
                                item.get("location_type"),
                                item.get("location_id"),
                                item.get("location_flag"),
                                item.get("quantity"),
                                1 if item.get("is_singleton") else 0,
                                1 if item.get("is_blueprint_copy") else 0,
                            ],
                        )
                        cnt += 1
                    await conn.commit()
                except Exception:
                    await conn.rollback()
                    raise
        return cnt

    async def store_names(self, items: list[dict[str, Any]]) -> None:
        async with db.connection() as conn:
            async with conn.cursor() as cur:
                for item in list(items):
                    await cur.execute(
                        "REPLACE INTO corpAssetsNames (itemID, name) VALUES (?,?)",
                        [item.get("item_id"), item.get("name")],
                    )

    async def get_items_direct(
        self,
        corporation_id: int,
        access_token: str,
        params: list[dict[str, Any]],
    ) -> list[dict[str, Any]]:
        log(2, f"assets.getItemsDirect ({params})")

        # Fetch all assets from ESI
        page = 1
        max_page = 1
        items_all: list[dict[str, Any]] = []
        while page <= max_page:
            resp = await self._esi.get(
                f"/corporations/{corporation_id}/assets/",
                token=access_token,
                params={"datasource": "tranquility", "page": str(page)},
            )
            max_page = parse_x_pages(resp)
            if resp.status_code != 200:
                raise RuntimeError(resp.reason_phrase)
            items_all.extend(resp.json())
            page += 1

        # Filter items by requested locations
        filtered: list[dict[str, Any]] = []
        for b in params:
            filtered.extend(
                [
                    item
                    for item in items_all
                    if item.get("location_id") == b.get("locationID")
                    and (
                        item.get("location_flag") == b.get("locationFlag")
                        or b.get("locationType") == "item"
                    )
                ]
            )

        type_ids = sorted({int(item.get("type_id")) for item in filtered if item.get("type_id") is not None})
        type_names: dict[int, str] = {}
        for type_id in type_ids:
            row = await db.fetch_one("SELECT it.typeID, it.typeName FROM invTypes it WHERE it.typeId = %s", [type_id])
            if row:
                type_names[int(row["typeID"])] = str(row["typeName"])

        rows: list[dict[str, Any]] = []
        for item in filtered:
            for b in params:
                if item.get("location_id") == b.get("locationID") and (
                    item.get("location_flag") == b.get("locationFlag") or b.get("locationType") == "item"
                ):
                    existing = next(
                        (
                            r
                            for r in rows
                            if r["typeId"] == item.get("type_id")
                            and r["locationID"] == b.get("locationID")
                            and r["locationFlag"] == b.get("locationFlag")
                        ),
                        None,
                    )
                    qty = int(item.get("quantity") or 1)
                    if existing:
                        existing["quantity"] += qty
                    else:
                        tid = int(item.get("type_id"))
                        rows.append(
                            {
                                "typeName": type_names.get(tid, "undefined"),
                                "typeId": tid,
                                "quantity": qty,
                                "locationID": b.get("locationID"),
                                "locationType": b.get("locationType"),
                                "locationFlag": b.get("locationFlag"),
                            }
                        )
        return rows

    async def get_locations(self, station_id: int) -> list[dict[str, Any]]:
        return await db.fetch_all(
            """
            SELECT *, IFNULL(concat(c.hangar, " - ", c.container), c.hangar) name
            FROM (
                SELECT
                  containers.itemID locationID
                , containers.locationType
                , hangars.locationFlag
                , hangars.name hangar
                , containers.name container
                FROM (
                    SELECT %s stationId, ch.*
                    FROM corpHangars ch
                ) hangars
                JOIN (
                    SELECT
                      ass.*
                    , CASE WHEN assn.name = '' THEN it.typeName ELSE assn.name END name
                    FROM corpAssets ass
                    JOIN invTypes it on it.typeID = ass.typeID
                    LEFT JOIN corpAssetsNames assn on assn.itemId = ass.itemId
                    WHERE it.groupID = 448 and ass.isSingleton = 1
                ) containers on containers.locationId = hangars.stationId and containers.locationFlag = hangars.locationFlag
                UNION ALL
                SELECT
                hangars.stationId
                , 'station'
                , hangars.locationFlag
                , hangars.name hangar
                , NULL
                FROM (
                    SELECT %s stationId, ch.*
                    FROM corpHangars ch
                ) hangars
            ) c
            ORDER BY c.locationFlag, c.container
            """,
            [station_id, station_id],
        )

    async def get_items(self, location_id: int, location_type: str, location_flag: str) -> list[dict[str, Any]]:
        if location_type == "station":
            return await db.fetch_all(
                """
                SELECT it.typeName, SUM(ass.quantity) quantity
                FROM corpAssets ass
                LEFT JOIN invTypes it on it.typeID = ass.typeID
                WHERE locationId = %s AND locationFlag = %s
                GROUP BY ass.typeID, it.typeName
                """,
                [location_id, location_flag],
            )
        return await db.fetch_all(
            """
            SELECT it.typeName, SUM(ass.quantity) quantity
            FROM corpAssets ass
            LEFT JOIN invTypes it on it.typeID = ass.typeID
            WHERE locationId = %s
            GROUP BY ass.typeID, it.typeName
            """,
            [location_id],
        )

    async def get_all_items(self) -> list[dict[str, Any]]:
        return await db.fetch_all(
            """
            SELECT a1.locationID, NVL(s1.name, a1.locationID) name, a1.locationFlag location, a1.containerName, it.typeName, ig.groupName, sum(a1.quantity) quantity
            FROM (
                SELECT NVL(a3.typeId, a2.typeID) typeId, NVL(a3.quantity, a2.quantity) quantity, a1.locationID, h.name locationFlag, a3.itemId,
                  CASE WHEN a3.itemId IS NOT NULL THEN an.name END containerName
                FROM corpAssets a1
                JOIN corpAssets a2 on a2.locationID = a1.itemID
                JOIN corpHangars h on h.locationFlag = a2.locationFlag
                LEFT JOIN corpAssets a3 on a3.locationID = a2.itemID
                LEFT JOIN corpAssetsNames an on an.itemID = a2.itemID
                WHERE a1.locationFlag = 'OfficeFolder'
                UNION ALL
                SELECT a.typeID, a.quantity, a.locationID, a.locationFlag, NULL, NULL
                FROM corpAssets a
                WHERE a.locationFlag = 'CorpDeliveries'
            ) a1
            JOIN invTypes it on it.typeID = a1.typeID
            JOIN invGroups ig on ig.groupID = it.groupID
            LEFT JOIN corpAssetsNames s1 on s1.itemID = a1.locationID
            GROUP BY a1.locationID, a1.locationFlag, a1.containerName, a1.typeId
            """,
        )
