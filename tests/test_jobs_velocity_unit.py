from __future__ import annotations

import pytest

from py_backend.esi import ESIClient
from py_backend.services.jobs import JobsService


@pytest.mark.asyncio
async def test_jobs_velocity_uses_category_placeholders(monkeypatch: pytest.MonkeyPatch) -> None:
    esi = ESIClient("https://esi.test")
    service = JobsService(esi)

    async def fake_fetch_all(sql: str, params: list) -> list[dict]:
        assert "where g.categoryID in (%s, %s)" in sql
        assert params == [6, 7]
        return [{"typeName": "Test Item", "w1": 1}]

    monkeypatch.setattr("py_backend.db.fetch_all", fake_fetch_all)

    rows = await service.get_jobs_velocity([6, 7])

    await esi.close()

    assert rows == [{"typeName": "Test Item", "w1": 1}]