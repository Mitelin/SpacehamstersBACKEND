import pytest

from decimal import Decimal

from py_backend.esi import ESIClient
from py_backend.services.wallet_journal import WalletJournalService


@pytest.mark.asyncio
async def test_wallet_journal_get_report_converts_decimal_to_float(monkeypatch: pytest.MonkeyPatch) -> None:
    esi = ESIClient("https://esi.test")
    service = WalletJournalService(esi)

    async def fake_fetch_all(sql: str, params: list) -> list[dict]:
        if "FROM corpWalletJournalReportMonthly" in sql:
            raise AssertionError("snapshot fallback should not be used when raw has rows")
        if "FROM corpWalletJournal" in sql:
            return [{"amount": Decimal("12.34"), "secondPartyId": 42}]
        raise AssertionError(f"unexpected SQL: {sql}")

    monkeypatch.setattr("py_backend.db.fetch_all", fake_fetch_all)

    rows = await service.get_report(wallet=1, year=2026, month=2, types=["bounty_prizes"])

    await esi.close()

    assert rows == [{"amount": 12.34, "secondPartyId": 42}]
    assert isinstance(rows[0]["amount"], float)


@pytest.mark.asyncio
async def test_wallet_journal_get_report_fallback_converts_decimal_to_float(monkeypatch: pytest.MonkeyPatch) -> None:
    esi = ESIClient("https://esi.test")
    service = WalletJournalService(esi)

    async def fake_fetch_all(sql: str, params: list) -> list[dict]:
        if "FROM corpWalletJournal\n" in sql:
            return []
        if "FROM corpWalletJournalReportMonthly" in sql:
            return [{"amount": Decimal("99.00"), "secondPartyId": 7}]
        raise AssertionError(f"unexpected SQL: {sql}")

    monkeypatch.setattr("py_backend.db.fetch_all", fake_fetch_all)

    rows = await service.get_report(wallet=1, year=2026, month=2, types=["bounty_prizes"])

    await esi.close()

    assert rows == [{"amount": 99.0, "secondPartyId": 7}]
    assert isinstance(rows[0]["amount"], float)
