import pytest

from tests.golden import assert_json_golden


def _set_auth(app, monkeypatch: pytest.MonkeyPatch, *, user_token: str = "user", ceo_token: str = "ceo") -> None:
    async def validate_token(_auth_header: str | None) -> str:
        return user_token

    async def get_ceo_access_token() -> str:
        return ceo_token

    monkeypatch.setattr(app.state.user_info, "validate_token", validate_token)
    monkeypatch.setattr(app.state.user_info, "get_ceo_access_token", get_ceo_access_token)


def test_golden_assets_locations_route(app_client, monkeypatch: pytest.MonkeyPatch) -> None:
    app = app_client.app
    _set_auth(app, monkeypatch)

    async def get_locations(station_id: int):
        assert station_id == 60003760
        return [
            {
                "locationID": 1,
                "locationType": "station",
                "locationFlag": "CorpDeliveries",
                "name": "CorpDeliveries",
            }
        ]

    monkeypatch.setattr(app.state.assets_service, "get_locations", get_locations)

    resp = app_client.get(
        "/api/corporation/123/assets/locations/60003760",
        headers={"authorization": "Bearer x"},
    )
    assert resp.status_code == 200
    assert_json_golden("assets_locations_route_basic", resp.json())
