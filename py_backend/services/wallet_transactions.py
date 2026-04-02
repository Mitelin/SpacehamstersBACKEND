from __future__ import annotations

import asyncio
from datetime import datetime
from typing import Any

from .. import db
from ..esi import ESIClient, parse_x_pages
from ..logger import log


def _jsonable_value(value: Any) -> Any:
    if isinstance(value, datetime):
        return value.isoformat(sep=" ")
    return value


def _jsonable_rows(rows: list[dict[str, Any]]) -> list[dict[str, Any]]:
    return [{k: _jsonable_value(v) for k, v in row.items()} for row in rows]


class WalletTransactionsService:
    def __init__(self, esi: ESIClient):
        self._esi = esi
        self._lock = asyncio.Lock()
        self._schema_lock = asyncio.Lock()
        self._schema_ready = False

    async def ensure_schema(self) -> None:
        if self._schema_ready:
            return
        async with self._schema_lock:
            if self._schema_ready:
                return

            wallet_column = await db.fetch_one(
                """
                SELECT COLUMN_NAME
                FROM INFORMATION_SCHEMA.COLUMNS
                WHERE TABLE_SCHEMA = DATABASE()
                  AND TABLE_NAME = 'corpWalletTransactions'
                  AND COLUMN_NAME = 'wallet'
                """
            )
            if wallet_column is None:
                await db.execute("ALTER TABLE corpWalletTransactions ADD COLUMN wallet INT NULL AFTER transactionID")

            wallet_index = await db.fetch_one(
                """
                SELECT INDEX_NAME
                FROM INFORMATION_SCHEMA.STATISTICS
                WHERE TABLE_SCHEMA = DATABASE()
                  AND TABLE_NAME = 'corpWalletTransactions'
                  AND INDEX_NAME = 'idx_corp_wallet_transactions_wallet_date_type'
                """
            )
            if wallet_index is None:
                await db.execute(
                    "CREATE INDEX idx_corp_wallet_transactions_wallet_date_type ON corpWalletTransactions (wallet, date, typeID)"
                )

            self._schema_ready = True

    async def sync(self, corporation_id: int, wallet: int, access_token: str) -> int:
        if self._lock.locked():
            raise RuntimeError("Předchozí synchronizace ještě není dokončena.")
        async with self._lock:
            await self.ensure_schema()
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

                items = resp.json()
                for item in items:
                    item["wallet"] = wallet
                cnt += await self.store(items)
                page += 1
            return cnt

    async def store(self, items: list[dict[str, Any]]) -> int:
        await self.ensure_schema()
        cnt = 0
        async with db.connection() as conn:
            async with conn.cursor() as cur:
                for item in list(items):
                    await cur.execute(
                        """
                        REPLACE INTO corpWalletTransactions (
                            transactionID, wallet, clientID, date, isBuy, journalRefID,
                            locationID, quantity, typeID, unitPrice
                        ) VALUES (%s,%s,%s,%s,%s,%s,%s,%s,%s,%s)
                        """,
                        [
                            item.get("transaction_id"),
                            item.get("wallet"),
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

    async def get_type_volumes(self, wallet: int) -> list[dict[str, Any]]:
        await self.ensure_schema()
        return await db.fetch_all(
            """
            SELECT items.*, buys.quantity buyQuantity, buys.unitPrice buyPrice, sells.quantity sellQuantity, sells.unitPrice sellPrice
            FROM (
                SELECT DISTINCT tr.typeID, it.typeName
                FROM corpWalletTransactions tr
                JOIN invTypes it ON it.typeID = tr.typeID
                WHERE tr.wallet = %s
            ) items
            LEFT JOIN (
                SELECT tr.typeID, SUM(tr.quantity) quantity, AVG(tr.unitPrice) unitPrice
                FROM corpWalletTransactions tr
                WHERE tr.isBuy = 1
                  AND tr.wallet = %s
                  AND tr.date >= DATE_SUB(NOW(), INTERVAL 30 DAY)
                GROUP BY tr.typeID
            ) buys ON buys.typeID = items.typeID
            LEFT JOIN (
                SELECT tr.typeID, SUM(tr.quantity) quantity, AVG(tr.unitPrice) unitPrice
                FROM corpWalletTransactions tr
                WHERE tr.isBuy = 0
                  AND tr.wallet = %s
                  AND tr.date >= DATE_SUB(NOW(), INTERVAL 30 DAY)
                GROUP BY tr.typeID
            ) sells ON sells.typeID = items.typeID
            """,
            [wallet, wallet, wallet],
        )

    async def get_type_sales_velocity(self, wallet: int) -> list[dict[str, Any]]:
        await self.ensure_schema()
        weekly_columns = []
        for week in range(1, 14):
            start_days = 7 * week
            end_days = 7 * (week - 1)
            weekly_columns.append(
                """
                SUM(
                    CASE
                        WHEN tr.date >= DATE_SUB(NOW(), INTERVAL {start_days} DAY)
                         AND tr.date < DATE_SUB(NOW(), INTERVAL {end_days} DAY)
                        THEN tr.quantity
                        ELSE 0
                    END
                ) AS w{week}
                """.strip().format(start_days=start_days, end_days=end_days, week=week)
            )

        sql = """
            SELECT
                tr.typeID,
                it.typeName,
                SUM(CASE WHEN tr.date >= DATE_SUB(NOW(), INTERVAL 7 DAY) THEN tr.quantity ELSE 0 END) AS sold7d,
                SUM(CASE WHEN tr.date >= DATE_SUB(NOW(), INTERVAL 30 DAY) THEN tr.quantity ELSE 0 END) AS sold30d,
                SUM(CASE WHEN tr.date >= DATE_SUB(NOW(), INTERVAL 60 DAY) THEN tr.quantity ELSE 0 END) AS sold60d,
                SUM(CASE WHEN tr.date >= DATE_SUB(NOW(), INTERVAL 90 DAY) THEN tr.quantity ELSE 0 END) AS sold90d,
                ROUND(SUM(CASE WHEN tr.date >= DATE_SUB(NOW(), INTERVAL 30 DAY) THEN tr.quantity ELSE 0 END) / 30, 4) AS avgDaily30d,
                ROUND(SUM(CASE WHEN tr.date >= DATE_SUB(NOW(), INTERVAL 90 DAY) THEN tr.quantity ELSE 0 END) / 90, 4) AS avgDaily90d,
                COUNT(DISTINCT CASE WHEN tr.date >= DATE_SUB(NOW(), INTERVAL 30 DAY) THEN DATE(tr.date) END) AS activeDays30d,
                COUNT(DISTINCT DATE(tr.date)) AS activeDays90d,
                MAX(tr.date) AS lastSellDate,
                MIN(tr.date) AS firstSellDate,
                {weekly_columns}
            FROM corpWalletTransactions tr
            JOIN invTypes it ON it.typeID = tr.typeID
            WHERE tr.isBuy = 0
              AND tr.wallet = %s
              AND tr.date >= DATE_SUB(NOW(), INTERVAL 91 DAY)
            GROUP BY tr.typeID, it.typeName
            ORDER BY it.typeName
        """.format(weekly_columns=",\n                ".join(weekly_columns))

        rows = await db.fetch_all(sql, [wallet])
        return _jsonable_rows(rows)


def _esi_dt(value: str | None) -> str | None:
    if not value:
        return None
    return value[:19].replace("T", " ")
