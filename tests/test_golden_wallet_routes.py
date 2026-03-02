import pytest

from tests.golden import assert_json_golden


def _set_auth(app, monkeypatch: pytest.MonkeyPatch, *, user_token: str = "user") -> None:
    async def validate_token(_auth_header: str | None) -> str:
        return user_token

    monkeypatch.setattr(app.state.user_info, "validate_token", validate_token)


def test_golden_wallet_volumes_route(app_client, monkeypatch: pytest.MonkeyPatch) -> None:
    app = app_client.app
    _set_auth(app, monkeypatch)

    async def get_type_volumes():
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
