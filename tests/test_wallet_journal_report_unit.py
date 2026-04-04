import pytest

from decimal import Decimal

from py_backend.esi import ESIClient
from py_backend.services.wallet_journal import WalletJournalService, _extract_year_months


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


def test_wallet_journal_extract_year_months_parses_esi_dates() -> None:
    months = _extract_year_months(
        [
            {"date": "2026-03-31T23:59:59Z"},
            {"date": "2026-04-01T00:00:00Z"},
            {"date": "2026-04-15 11:22:33"},
            {"date": None},
            {},
        ]
    )

    assert months == {(2026, 3), (2026, 4)}


@pytest.mark.asyncio
async def test_wallet_journal_sync_refreshes_monthly_snapshots(monkeypatch: pytest.MonkeyPatch) -> None:
    esi = ESIClient("https://esi.test")
    service = WalletJournalService(esi)

    class FakeResponse:
        status_code = 200
        reason_phrase = "OK"

        def json(self) -> list[dict]:
            return [
                {"id": 1, "date": "2026-03-31T23:59:59Z"},
                {"id": 2, "date": "2026-04-01T00:00:00Z"},
            ]

    async def fake_get(path: str, token: str | None = None, params: dict | None = None):
        return FakeResponse()

    async def fake_store(items: list[dict]) -> int:
        return len(items)

    seen: dict[str, object] = {}

    async def fake_refresh(wallet: int, months: set[tuple[int, int]]) -> int:
        seen["wallet"] = wallet
        seen["months"] = set(months)
        return 2

    monkeypatch.setattr(service._esi, "get", fake_get)
    monkeypatch.setattr("py_backend.services.wallet_journal.parse_x_pages", lambda response: 1)
    monkeypatch.setattr(service, "store", fake_store)
    monkeypatch.setattr(service, "refresh_monthly_snapshots", fake_refresh)

    count = await service.sync(corporation_id=98652228, wallet=1, access_token="token")

    await esi.close()

    assert count == 2
    assert seen == {"wallet": 1, "months": {(2026, 3), (2026, 4)}}
