from __future__ import annotations

from decimal import Decimal

import pytest

from py_backend.esi import ESIClient
from py_backend.services.jobs import JobsService, _extract_year_months


@pytest.mark.asyncio
async def test_jobs_report_converts_decimal_to_float(monkeypatch: pytest.MonkeyPatch) -> None:
    esi = ESIClient("https://esi.test")
    service = JobsService(esi)

    async def fake_fetch_all(sql: str, params: list) -> list[dict]:
        if "FROM corpJobsReportMonthly" in sql:
            raise AssertionError("snapshot fallback should not be used when raw has rows")
        if "FROM corpJobs j" in sql:
            return [{"installerId": 42, "manufacturing": Decimal("3600.0"), "reaction": Decimal("1800.0")}]
        raise AssertionError(f"unexpected SQL: {sql}")

    monkeypatch.setattr("py_backend.db.fetch_all", fake_fetch_all)

    rows = await service.get_jobs_report(year=2026, month=3)

    await esi.close()

    assert rows == [{"installerId": 42, "manufacturing": 3600.0, "reaction": 1800.0}]
    assert isinstance(rows[0]["manufacturing"], float)
    assert isinstance(rows[0]["reaction"], float)


@pytest.mark.asyncio
async def test_jobs_report_fallback_converts_decimal_to_float(monkeypatch: pytest.MonkeyPatch) -> None:
    esi = ESIClient("https://esi.test")
    service = JobsService(esi)

    async def fake_fetch_all(sql: str, params: list) -> list[dict]:
        if "FROM corpJobs j" in sql:
            return []
        if "FROM corpJobsReportMonthly" in sql:
            return [{"installerId": 7, "copying": Decimal("7200.0"), "invention": Decimal("900.0")}]
        raise AssertionError(f"unexpected SQL: {sql}")

    monkeypatch.setattr("py_backend.db.fetch_all", fake_fetch_all)

    rows = await service.get_jobs_report(year=2026, month=3)

    await esi.close()

    assert rows == [{"installerId": 7, "copying": 7200.0, "invention": 900.0}]
    assert isinstance(rows[0]["copying"], float)
    assert isinstance(rows[0]["invention"], float)


def test_jobs_extract_year_months_parses_esi_dates() -> None:
    months = _extract_year_months(
        [
            {"start_date": "2026-03-31T23:59:59Z"},
            {"start_date": "2026-04-01T00:00:00Z"},
            {"start_date": "2026-04-15 11:22:33"},
            {"start_date": None},
            {},
        ],
        "start_date",
    )

    assert months == {(2026, 3), (2026, 4)}


@pytest.mark.asyncio
async def test_jobs_sync_refreshes_monthly_snapshots(monkeypatch: pytest.MonkeyPatch) -> None:
    esi = ESIClient("https://esi.test")
    service = JobsService(esi)

    class FakeResponse:
        status_code = 200
        reason_phrase = "OK"

        def json(self) -> list[dict]:
            return [
                {"job_id": 1, "start_date": "2026-03-31T23:59:59Z"},
                {"job_id": 2, "start_date": "2026-04-01T00:00:00Z"},
            ]

    async def fake_get(path: str, token: str | None = None, params: dict | None = None):
        return FakeResponse()

    async def fake_store(items: list[dict]) -> int:
        return len(items)

    seen: dict[str, object] = {}

    async def fake_refresh(months: set[tuple[int, int]]) -> int:
        seen["months"] = set(months)
        return 2

    monkeypatch.setattr(service._esi, "get", fake_get)
    monkeypatch.setattr("py_backend.services.jobs.parse_x_pages", lambda response: 1)
    monkeypatch.setattr(service, "store", fake_store)
    monkeypatch.setattr(service, "refresh_monthly_snapshots", fake_refresh)

    count = await service.sync(corporation_id=98652228, access_token="token")

    await esi.close()

    assert count == 2
    assert seen == {"months": {(2026, 3), (2026, 4)}}