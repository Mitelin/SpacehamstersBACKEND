import pytest
import respx
from httpx import Response

from py_backend.esi import ESIClient
from py_backend.services.jobs import JobsService
from tests.golden import assert_json_golden


@pytest.mark.asyncio
async def test_golden_jobs_direct_basic(monkeypatch: pytest.MonkeyPatch) -> None:
    esi = ESIClient("https://esi.test")
    service = JobsService(esi)

    async def fake_fetch_all(sql: str, params: list) -> list[dict]:
        type_id = int(params[0])
        if type_id == 100:
            return [{"typeID": 100, "typeName": "Blueprint", "quantity": None}]
        if type_id == 200:
            return [{"typeID": 200, "typeName": "Product", "quantity": 5}]
        return []

    monkeypatch.setattr("py_backend.db.fetch_all", fake_fetch_all)

    corp_id = 123
    token = "t"

    with respx.mock(assert_all_called=True) as router:
        router.get(
            f"https://esi.test/corporations/{corp_id}/industry/jobs/",
            params={"datasource": "tranquility", "include_completed": "false", "page": "1"},
            headers={"Accept": "application/json", "Authorization": f"Bearer {token}"},
        ).respond(
            200,
            headers={"x-pages": "1"},
            json=[
                {
                    "location_id": 999,
                    "duration": 3600,
                    "runs": 2,
                    "output_location_id": 555,
                    "activity_id": 1,
                    "blueprint_type_id": 100,
                    "product_type_id": 200,
                    "installer_id": 42,
                }
            ],
        )

        rows = await service.get_all_jobs_direct(corp_id, token)

    await esi.close()

    assert_json_golden("jobs_direct_basic", rows)
