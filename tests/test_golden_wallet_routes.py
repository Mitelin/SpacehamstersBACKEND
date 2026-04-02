import pytest

from tests.golden import assert_json_golden


def _set_auth(app, monkeypatch: pytest.MonkeyPatch, *, user_token: str = "user") -> None:
    async def validate_token(_auth_header: str | None) -> str:
        return user_token

    monkeypatch.setattr(app.state.user_info, "validate_token", validate_token)


def test_golden_wallet_volumes_route(app_client, monkeypatch: pytest.MonkeyPatch) -> None:
    app = app_client.app
    _set_auth(app, monkeypatch)

    async def get_type_volumes(wallet: int):
        assert wallet == 1
        return [
            {
                "typeID": 34,
                "typeName": "Tritanium",
                "buyQuantity": 10,
                "buyPrice": 4.2,
                "sellQuantity": 5,
                "sellPrice": 4.8,
            }
        ]

    monkeypatch.setattr(app.state.wallet_transactions_service, "get_type_volumes", get_type_volumes)

    resp = app_client.get("/api/corporation/123/wallets/1/volumes", headers={"authorization": "Bearer x"})
    assert resp.status_code == 200
    assert_json_golden("wallet_volumes_route_basic", resp.json())


def test_golden_wallet_transactions_velocity_route(app_client, monkeypatch: pytest.MonkeyPatch) -> None:
    app = app_client.app
    _set_auth(app, monkeypatch)

    async def get_type_sales_velocity(wallet: int):
        assert wallet == 1
        return [
            {
                "typeID": 34,
                "typeName": "Tritanium",
                "sold7d": 3,
                "sold30d": 10,
                "sold60d": 15,
                "sold90d": 22,
                "avgDaily30d": 0.3333,
                "avgDaily90d": 0.2444,
                "activeDays30d": 4,
                "activeDays90d": 8,
                "lastSellDate": "2026-04-01 12:34:56",
                "firstSellDate": "2026-01-15 09:00:00",
                "w1": 3,
                "w2": 2,
                "w3": 1,
                "w4": 4,
                "w5": 0,
                "w6": 2,
                "w7": 1,
                "w8": 3,
                "w9": 0,
                "w10": 2,
                "w11": 1,
                "w12": 1,
                "w13": 2,
            }
        ]

    monkeypatch.setattr(app.state.wallet_transactions_service, "get_type_sales_velocity", get_type_sales_velocity)

    resp = app_client.get("/api/corporation/123/wallets/1/transactions/velocity", headers={"authorization": "Bearer x"})
    assert resp.status_code == 200
    assert_json_golden("wallet_transactions_velocity_route_basic", resp.json())


def test_golden_wallet_pl_route(app_client, monkeypatch: pytest.MonkeyPatch) -> None:
    app = app_client.app
    _set_auth(app, monkeypatch)

    async def get_pl(year: int, month: int):
        assert year == 2024
        assert month == 1
        return [
            {
                "id": 1,
                "refType": "market_transaction",
                "cd": "C",
                "typeId": 34,
                "typeName": "Tritanium",
                "quantity": 10,
                "amount": 42.0,
            }
        ]

    monkeypatch.setattr(app.state.wallet_journal_service, "get_pl", get_pl)

    resp = app_client.get("/api/corporation/123/wallets/1/pl/2024/1", headers={"authorization": "Bearer x"})
    assert resp.status_code == 200
    assert_json_golden("wallet_pl_route_basic", resp.json())
