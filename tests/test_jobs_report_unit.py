from __future__ import annotations

from decimal import Decimal

import pytest

from py_backend.esi import ESIClient
from py_backend.services.jobs import JobsService


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