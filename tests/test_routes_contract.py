import pytest


def _set_auth(app, monkeypatch: pytest.MonkeyPatch, *, user_token: str = "user", ceo_token: str = "ceo") -> None:
    async def validate_token(_auth_header: str | None) -> str:
        return user_token

    async def get_ceo_access_token() -> str:
        return ceo_token

    monkeypatch.setattr(app.state.user_info, "validate_token", validate_token)
    monkeypatch.setattr(app.state.user_info, "get_ceo_access_token", get_ceo_access_token)


def test_blueprints_id_calculate_missing_amount(app_client) -> None:
    resp = app_client.post("/api/blueprints/123/calculate", json={})
    assert resp.status_code == 200
    assert resp.text == "Chyba: amount missing"


def test_wallet_journal_report_missing_year(app_client, monkeypatch: pytest.MonkeyPatch) -> None:
    _set_auth(app_client.app, monkeypatch)

    resp = app_client.post(
        "/api/corporation/123/wallets/1/journal/report",
        headers={"authorization": "Bearer x"},
        json={"month": 1, "types": ["market_transaction"]},
    )
    assert resp.status_code == 200
    assert resp.text == "year parameter missing"


def test_assets_sync_happy_path(app_client, monkeypatch: pytest.MonkeyPatch) -> None:
    app = app_client.app
    _set_auth(app, monkeypatch, user_token="user", ceo_token="ceo")

    async def sync(corporation_id: int, access_token: str) -> int:
        assert corporation_id == 123
        assert access_token == "ceo"
        return 7

    monkeypatch.setattr(app.state.assets_service, "sync", sync)

    resp = app_client.get("/api/corporation/123/assets/sync", headers={"authorization": "Bearer x"})
    assert resp.status_code == 200
    assert resp.text == "Records synchronized: 7"


def test_jobs_direct_uses_ceo_token(app_client, monkeypatch: pytest.MonkeyPatch) -> None:
    app = app_client.app
    _set_auth(app, monkeypatch, user_token="user", ceo_token="ceo")

    async def get_all_jobs_direct(corporation_id: int, access_token: str):
        assert corporation_id == 123
        assert access_token == "ceo"
        return [{"ok": True}]

    monkeypatch.setattr(app.state.jobs_service, "get_all_jobs_direct", get_all_jobs_direct)

    resp = app_client.get("/api/corporation/123/jobs/direct", headers={"authorization": "Bearer x"})
    assert resp.status_code == 200
    assert resp.json() == [{"ok": True}]


def test_activity_sync_uses_ceo_token(app_client, monkeypatch: pytest.MonkeyPatch) -> None:
    app = app_client.app
    _set_auth(app, monkeypatch, user_token="user", ceo_token="ceo")

    async def sync(corporation_id: int, access_token: str) -> int:
        assert corporation_id == 123
        assert access_token == "ceo"
        return 9

    monkeypatch.setattr(app.state.activity_service, "sync", sync)

    resp = app_client.get("/api/corporation/123/activity/sync", headers={"authorization": "Bearer x"})
    assert resp.status_code == 200
    assert resp.text == "Records synchronized: 9"


def test_activity_report_uses_user_token(app_client, monkeypatch: pytest.MonkeyPatch) -> None:
    app = app_client.app
    _set_auth(app, monkeypatch, user_token="user", ceo_token="ceo")

    async def get_report(year: int, month: int):
        assert year == 2026
        assert month == 4
        return {"summary": [{"characterId": 1}], "meta": {"pilotCount": 1}}

    monkeypatch.setattr(app.state.activity_service, "get_report", get_report)

    resp = app_client.get("/api/corporation/123/activity/report/2026/4", headers={"authorization": "Bearer x"})
    assert resp.status_code == 200
    assert resp.json() == {"summary": [{"characterId": 1}], "meta": {"pilotCount": 1}}


def test_assets_direct_param_mapping(app_client, monkeypatch: pytest.MonkeyPatch) -> None:
    app = app_client.app
    _set_auth(app, monkeypatch, user_token="user", ceo_token="ceo")

    captured = {}

    async def get_items_direct(corporation_id: int, access_token: str, params):
        captured["corporation_id"] = corporation_id
        captured["access_token"] = access_token
        captured["params"] = params
        return []

    monkeypatch.setattr(app.state.assets_service, "get_items_direct", get_items_direct)

    body = [
        {"locationID": 1, "locationType": "station", "locationFlag": "CorpDeliveries"},
        {"locationID": 2, "locationType": "item", "locationFlag": "AutoFit"},
    ]

    resp = app_client.post(
        "/api/corporation/123/assetsDirect",
        headers={"authorization": "Bearer x"},
        json=body,
    )

    assert resp.status_code == 200
    assert captured["corporation_id"] == 123
    assert captured["access_token"] == "ceo"
    assert captured["params"] == body


def test_wallet_volumes_uses_user_token(app_client, monkeypatch: pytest.MonkeyPatch) -> None:
    app = app_client.app
    _set_auth(app, monkeypatch, user_token="user", ceo_token="ceo")

    captured = {}

    async def get_type_volumes(wallet: int):
        captured["wallet"] = wallet
        captured["called"] = True
        return [{"typeID": 1}]

    monkeypatch.setattr(app.state.wallet_transactions_service, "get_type_volumes", get_type_volumes)

    resp = app_client.get("/api/corporation/123/wallets/1/volumes", headers={"authorization": "Bearer x"})
    assert resp.status_code == 200
    assert resp.json() == [{"typeID": 1}]
    assert captured.get("called") is True
    assert captured.get("wallet") == 1


def test_wallet_transactions_velocity_uses_user_token(app_client, monkeypatch: pytest.MonkeyPatch) -> None:
    app = app_client.app
    _set_auth(app, monkeypatch, user_token="user", ceo_token="ceo")

    captured = {}

    async def get_type_sales_velocity(wallet: int):
        captured["wallet"] = wallet
        captured["called"] = True
        return [{"typeID": 1, "sold90d": 9}]

    monkeypatch.setattr(app.state.wallet_transactions_service, "get_type_sales_velocity", get_type_sales_velocity)

    resp = app_client.get(
        "/api/corporation/123/wallets/1/transactions/velocity",
        headers={"authorization": "Bearer x"},
    )
    assert resp.status_code == 200
    assert resp.json() == [{"typeID": 1, "sold90d": 9}]
    assert captured.get("called") is True
    assert captured.get("wallet") == 1


def test_wallet_pl_invalid_month_returns_chyba(app_client, monkeypatch: pytest.MonkeyPatch) -> None:
    app = app_client.app
    _set_auth(app, monkeypatch)

    resp = app_client.get("/api/corporation/123/wallets/1/pl/2024/13", headers={"authorization": "Bearer x"})
    assert resp.status_code == 200
    assert resp.text.startswith("Chyba: ")


def test_scheduler_includes_wallet_transactions_sync(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("ENABLE_SCHEDULER", "1")

    import py_backend.db as db_module
    import py_backend.settings as settings_module
    import py_backend.main as main_module

    settings_module._settings = None

    async def _noop() -> None:
        return None

    class FakeScheduler:
        def __init__(self, timezone: str):
            self.timezone = timezone
            self.jobs = []
            self.started = False
            self.shutdown_called = False

        def add_job(self, func, trigger):
            self.jobs.append(trigger)

        def start(self):
            self.started = True

        def shutdown(self, wait: bool = False):
            self.shutdown_called = True

    monkeypatch.setattr(db_module, "init_pool", _noop)
    monkeypatch.setattr(db_module, "close_pool", _noop)
    monkeypatch.setattr(main_module, "AsyncIOScheduler", FakeScheduler)

    from starlette.testclient import TestClient

    app = main_module.create_app()
    with TestClient(app):
        scheduler = app.state.scheduler
        assert scheduler is not None
        assert scheduler.started is True
        assert scheduler.timezone == "UTC"

        scheduled_times = []
        for trigger in scheduler.jobs:
            hours = [expr.first for expr in trigger.fields[5].expressions]
            minutes = [expr.first for expr in trigger.fields[6].expressions]
            scheduled_times.extend((hour, minutes[0]) for hour in hours)
        scheduled_times = sorted(scheduled_times)
        assert scheduled_times == sorted(
            [(4, 0), (4, 15), (4, 30)] + [(hour, 45) for hour in range(24)]
        )

    assert scheduler.shutdown_called is True
