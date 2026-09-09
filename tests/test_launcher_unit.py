from __future__ import annotations

import os

import pytest

import launcher


@pytest.mark.asyncio
async def test_ensure_database_ready_bootstraps_when_activity_table_missing(monkeypatch: pytest.MonkeyPatch) -> None:
    async def _noop(*args, **kwargs):
        return None

    class FakeConn:
        def close(self) -> None:
            return None

    seen: dict[str, object] = {}

    async def fake_connect(**kwargs):
        seen["connect"] = kwargs
        return FakeConn()

    async def fake_count(conn, sql: str) -> int:
        if sql == "SELECT 1":
            return 1
        if sql == "SELECT COUNT(*) FROM corpHangars":
            return 7
        raise AssertionError(f"unexpected count SQL: {sql}")

    async def fake_table_exists(conn, db_name: str, table_name: str) -> bool:
        return table_name != "corpActivitySnapshots"

    async def fake_bootstrap(conn, sql_path):
        seen["bootstrap"] = str(sql_path)

    monkeypatch.setattr(launcher, "_db_ensure_database", _noop)
    monkeypatch.setattr(launcher, "_db_connect", fake_connect)
    monkeypatch.setattr(launcher, "_db_count", fake_count)
    monkeypatch.setattr(launcher, "_db_table_exists", fake_table_exists)
    monkeypatch.setattr(launcher, "_db_run_bootstrap", fake_bootstrap)

    await launcher.ensure_database_ready({}, dict(os.environ))

    assert seen.get("bootstrap") == str(launcher.DBINIT_SQL_PATH)


@pytest.mark.asyncio
async def test_ensure_database_ready_bootstraps_when_wallet_column_missing(monkeypatch: pytest.MonkeyPatch) -> None:
    async def _noop(*args, **kwargs):
        return None

    class FakeConn:
        def close(self) -> None:
            return None

    seen: dict[str, object] = {}

    async def fake_connect(**kwargs):
        return FakeConn()

    async def fake_count(conn, sql: str) -> int:
        if sql == "SELECT 1":
            return 1
        if sql == "SELECT COUNT(*) FROM corpHangars":
            return 7
        raise AssertionError(f"unexpected count SQL: {sql}")

    async def fake_table_exists(conn, db_name: str, table_name: str) -> bool:
        return True

    async def fake_column_exists(conn, db_name: str, table_name: str, column_name: str) -> bool:
        assert (table_name, column_name) == ("corpWalletJournal", "wallet")
        return False

    async def fake_bootstrap(conn, sql_path):
        seen["bootstrap"] = str(sql_path)

    monkeypatch.setattr(launcher, "_db_ensure_database", _noop)
    monkeypatch.setattr(launcher, "_db_connect", fake_connect)
    monkeypatch.setattr(launcher, "_db_count", fake_count)
    monkeypatch.setattr(launcher, "_db_table_exists", fake_table_exists)
    monkeypatch.setattr(launcher, "_db_column_exists", fake_column_exists)
    monkeypatch.setattr(launcher, "_db_run_bootstrap", fake_bootstrap)

    await launcher.ensure_database_ready({}, dict(os.environ))

    assert seen.get("bootstrap") == str(launcher.DBINIT_SQL_PATH)