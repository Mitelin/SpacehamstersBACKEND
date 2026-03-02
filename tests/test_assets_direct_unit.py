import pytest
import respx
from httpx import Response

from py_backend.esi import ESIClient
from py_backend.services.assets import AssetsService


@pytest.mark.asyncio
async def test_get_items_direct_filters_and_aggregates(monkeypatch: pytest.MonkeyPatch) -> None:
    esi = ESIClient("https://esi.test")
    service = AssetsService(esi)

    async def fake_fetch_one(sql: str, params: list):
        type_id = int(params[0])
        return {"typeID": type_id, "typeName": f"Type {type_id}"}

    monkeypatch.setattr("py_backend.db.fetch_one", fake_fetch_one)

    corp_id = 123
    token = "t"

    # Two pages of assets
    with respx.mock(assert_all_called=True) as router:
        router.get(
            f"https://esi.test/corporations/{corp_id}/assets/",
            params={"datasource": "tranquility", "page": "1"},
            headers={"Accept": "application/json", "Authorization": f"Bearer {token}"},
        ).respond(
            200,
            headers={"x-pages": "2"},
            json=[
                {"type_id": 10, "location_id": 1, "location_flag": "CorpDeliveries", "quantity": 2},
                {"type_id": 10, "location_id": 1, "location_flag": "CorpDeliveries", "quantity": 3},
                {"type_id": 20, "location_id": 2, "location_flag": "AutoFit", "quantity": 1},
            ],
        )
        router.get(
            f"https://esi.test/corporations/{corp_id}/assets/",
            params={"datasource": "tranquility", "page": "2"},
            headers={"Accept": "application/json", "Authorization": f"Bearer {token}"},
        ).respond(
            200,
            headers={"x-pages": "2"},
            json=[
                {"type_id": 20, "location_id": 2, "location_flag": "AutoFit", "quantity": 4},
                {"type_id": 30, "location_id": 999, "location_flag": "Other", "quantity": 1},
            ],
        )

        params = [
            {"locationID": 1, "locationType": "station", "locationFlag": "CorpDeliveries"},
            {"locationID": 2, "locationType": "item", "locationFlag": "AutoFit"},
        ]

        rows = await service.get_items_direct(corp_id, token, params)

    await esi.close()

    # Expect aggregation per (typeId, locationID, locationFlag)
    assert sorted(rows, key=lambda r: (r["locationID"], r["typeId"])) == [
        {
            "typeName": "Type 10",
            "typeId": 10,
            "quantity": 5,
            "locationID": 1,
            "locationType": "station",
            "locationFlag": "CorpDeliveries",
        },
        {
            "typeName": "Type 20",
            "typeId": 20,
            "quantity": 5,
            "locationID": 2,
            "locationType": "item",
            "locationFlag": "AutoFit",
        },
    ]
