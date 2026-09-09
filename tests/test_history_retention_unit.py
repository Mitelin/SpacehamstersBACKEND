from datetime import datetime

import pytest

from py_backend.services.retention import history_cutoff, prune_activity_history, prune_wallet_history


def test_history_cutoff_keeps_complete_calendar_months() -> None:
    assert history_cutoff(datetime(2026, 9, 9, 12, 30)) == datetime(2026, 3, 1)
    assert history_cutoff(datetime(2026, 1, 31, 23, 59)) == datetime(2025, 7, 1)


@pytest.mark.asyncio
async def test_prune_activity_history_uses_complete_month_cutoff(monkeypatch: pytest.MonkeyPatch) -> None:
    calls: list[tuple[str, list]] = []

    async def fake_execute(sql: str, params: list) -> int:
        calls.append((sql, params))
        return 2

    monkeypatch.setattr("py_backend.db.execute", fake_execute)

    deleted = await prune_activity_history(datetime(2026, 9, 9, 12, 30))

    assert deleted == 6
    assert len(calls) == 3
    assert calls[0][1] == [datetime(2026, 3, 1)]
    assert calls[1][1] == [datetime(2026, 3, 1)]
    assert calls[2][1] == [2026, 2026, 3]


@pytest.mark.asyncio
async def test_prune_wallet_history_uses_complete_month_cutoff(monkeypatch: pytest.MonkeyPatch) -> None:
    calls: list[tuple[str, list]] = []

    async def fake_execute(sql: str, params: list) -> int:
        calls.append((sql, params))
        return 3

    monkeypatch.setattr("py_backend.db.execute", fake_execute)

    deleted = await prune_wallet_history(datetime(2026, 9, 9, 12, 30))

    assert deleted == 6
    assert len(calls) == 2
    assert calls[0][1] == [datetime(2026, 3, 1)]
    assert calls[1][1] == [2026, 2026, 3]