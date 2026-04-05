from __future__ import annotations

from decimal import Decimal

import pytest

from py_backend.esi import ESIClient
from py_backend.services.wallet_transactions import WalletTransactionsService


@pytest.mark.asyncio
async def test_wallet_transactions_velocity_converts_decimal_to_float(monkeypatch: pytest.MonkeyPatch) -> None:
    esi = ESIClient("https://esi.test")
    service = WalletTransactionsService(esi)

    async def fake_ensure_schema() -> None:
        return None

    async def fake_fetch_all(sql: str, params: list[int]) -> list[dict]:
        assert "FROM corpWalletTransactions tr" in sql
        assert params == [6]
        return [
            {
                "typeID": 34,
                "typeName": "Tritanium",
                "sold7d": Decimal("3"),
                "sold30d": Decimal("10"),
                "sold60d": Decimal("15"),
                "sold90d": Decimal("22"),
                "avgDaily30d": Decimal("0.3333"),
                "avgDaily90d": Decimal("0.2444"),
                "activeDays30d": 4,
                "activeDays90d": 8,
                "lastSellDate": "2026-04-01 12:34:56",
                "firstSellDate": "2026-01-15 09:00:00",
                "w1": Decimal("3"),
                "w2": Decimal("2"),
                "w3": Decimal("1"),
                "w4": Decimal("4"),
                "w5": Decimal("0"),
                "w6": Decimal("2"),
                "w7": Decimal("1"),
                "w8": Decimal("3"),
                "w9": Decimal("0"),
                "w10": Decimal("2"),
                "w11": Decimal("1"),
                "w12": Decimal("1"),
                "w13": Decimal("2"),
            }
        ]

    monkeypatch.setattr(service, "ensure_schema", fake_ensure_schema)
    monkeypatch.setattr("py_backend.db.fetch_all", fake_fetch_all)

    rows = await service.get_type_sales_velocity(6)

    await esi.close()

    assert rows[0]["avgDaily30d"] == 0.3333
    assert rows[0]["sold7d"] == 3.0
    assert rows[0]["w13"] == 2.0
    assert isinstance(rows[0]["avgDaily30d"], float)
    assert isinstance(rows[0]["sold7d"], float)