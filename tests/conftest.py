import os

import pytest


@pytest.fixture(autouse=True)
def _required_env(monkeypatch: pytest.MonkeyPatch) -> None:
    """Ensure required env vars are present for app/settings creation in tests."""

    monkeypatch.setenv("DB_HOST", "127.0.0.1")
    monkeypatch.setenv("DB_PORT", "3306")
    monkeypatch.setenv("DB_USER", "test")
    monkeypatch.setenv("DB_PASSWORD", "test")
    monkeypatch.setenv("DB_NAME", "test")
    monkeypatch.setenv("CORPORATION_ID", "123")
    monkeypatch.setenv("CEO_CHARACTER_ID", "456")
    monkeypatch.setenv("INDUSTRY_WALLET", "6")
    monkeypatch.setenv("ENABLE_SCHEDULER", "0")

    # reset cached settings between tests
    import py_backend.settings as settings_module

    settings_module._settings = None


@pytest.fixture
def app_client(monkeypatch: pytest.MonkeyPatch):
    """Starlette TestClient with DB pool init disabled (unit/contract tests)."""

    import py_backend.db as db_module

    async def _noop() -> None:
        return None

    monkeypatch.setattr(db_module, "init_pool", _noop)
    monkeypatch.setattr(db_module, "close_pool", _noop)

    from starlette.testclient import TestClient
    from py_backend.main import create_app

    app = create_app()
    with TestClient(app) as client:
        yield client


@pytest.fixture(scope="session")
def node_base_url() -> str | None:
    return os.getenv("NODE_BASE_URL")


@pytest.fixture(scope="session")
def py_base_url() -> str | None:
    return os.getenv("PY_BASE_URL")
