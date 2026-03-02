from __future__ import annotations

import asyncio
from typing import Any

from .. import db
from ..esi import ESIClient, parse_x_pages
from ..logger import log


class WalletTransactionsService:
    def __init__(self, esi: ESIClient):
        self._esi = esi
        self._lock = asyncio.Lock()

    async def sync(self, corporation_id: int, wallet: int, access_token: str) -> int:
        if self._lock.locked():
            raise RuntimeError("Předchozí synchronizace ještě není dokončena.")
        async with self._lock:
            log(2, f"walletTransactions.sync ({corporation_id}, {wallet})")
            page = 1
            cnt = 0
            max_page = 1
            while page <= max_page:
                resp = await self._esi.get(
                    f"/corporations/{corporation_id}/wallets/{wallet}/transactions/",
                    token=access_token,
                    params={"datasource": "tranquility", "page": str(page)},
                )
                max_page = parse_x_pages(resp)
                if resp.status_code != 200:
                    raise RuntimeError(resp.reason_phrase)
                cnt += await self.store(resp.json())
                page += 1
            return cnt

    async def store(self, items: list[dict[str, Any]]) -> int:
        cnt = 0
        async with db.connection() as conn:
            async with conn.cursor() as cur:
                for item in list(items):
                    await cur.execute(
                        """
                        REPLACE INTO corpWalletTransactions (
                            transactionID, clientID, date, isBuy, journalRefID,
                            locationID, quantity, typeID, unitPrice
                        ) VALUES (?,?,?,?,?,?,?,?,?)
                        """,
                        [
                            item.get("transaction_id"),
                            item.get("client_id"),
                            _esi_dt(item.get("date")),
                            1 if item.get("is_buy") else 0,
                            item.get("journal_ref_id"),
                            item.get("location_id"),
                            item.get("quantity"),
                            item.get("type_id"),
                            item.get("unit_price"),
                        ],
                    )
                    cnt += 1
        return cnt

    async def get_type_volumes(self) -> list[dict[str, Any]]:
        return await db.fetch_all(
            """
            SELECT items.*, buys.quantity buyQuantity, buys.unitPrice buyPrice, sells.quantity sellQuantity, sells.unitPrice sellPrice
            FROM (
                SELECT DISTINCT tr.typeID, it.typeName
                FROM corpWalletTransactions tr
                JOIN invTypes it on it.typeID = tr.typeID
            ) items
            LEFT JOIN (
                SELECT tr.typeID, SUM(tr.quantity) quantity, AVG(tr.unitPrice) unitPrice
                FROM corpWalletTransactions tr
                WHERE tr.isBuy = 1
                  AND tr.date >= DATE_SUB(NOW(), INTERVAL 30 DAY)
                GROUP BY tr.typeID
            ) buys on buys.typeID = items.typeID
            LEFT JOIN (
                SELECT tr.typeID, SUM(tr.quantity) quantity, AVG(tr.unitPrice) unitPrice
                FROM corpWalletTransactions tr
                WHERE tr.isBuy = 0
                  AND tr.date >= DATE_SUB(NOW(), INTERVAL 30 DAY)
                GROUP BY tr.typeID
            ) sells on sells.typeID = items.typeID
            """,
        )


def _esi_dt(value: str | None) -> str | None:
    if not value:
        return None
    return value[:19].replace("T", " ")
