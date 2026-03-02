import json
import os

import httpx
import pytest


pytestmark = pytest.mark.asyncio


async def _post(client: httpx.AsyncClient, path: str, body: dict) -> tuple[int, str, str]:
    r = await client.post(path, json=body)
    return r.status_code, r.headers.get("content-type", ""), r.text


async def test_parity_blueprints_calculate_optional(node_base_url: str | None, py_base_url: str | None) -> None:
    if not node_base_url or not py_base_url:
        pytest.skip("Set NODE_BASE_URL and PY_BASE_URL to run parity tests")

    body = {
        "types": [{"typeId": 34, "amount": 1000}],
        "typeme": 0,
        "typete": 0,
        "buildT1": True,
        "copyBPO": True,
        "produceFuelBlocks": True,
    }

    async with httpx.AsyncClient(base_url=node_base_url, timeout=120.0) as node, httpx.AsyncClient(
        base_url=py_base_url, timeout=120.0
    ) as py:
        n_code, _n_ct, n_text = await _post(node, "/api/blueprints/calculate", body)
        p_code, _p_ct, p_text = await _post(py, "/api/blueprints/calculate", body)

    assert n_code == p_code

    # Both should be JSON on success; if either returns text error, compare raw.
    try:
        n_json = json.loads(n_text)
        p_json = json.loads(p_text)
    except Exception:
        assert n_text == p_text
        return

    assert n_json == p_json
