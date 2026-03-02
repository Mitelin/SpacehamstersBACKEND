from __future__ import annotations

from typing import Any

import httpx


class ESIClient:
    def __init__(self, base_url: str):
        self._client = httpx.AsyncClient(base_url=base_url, timeout=60.0)

    async def close(self) -> None:
        await self._client.aclose()

    async def get(self, path: str, token: str | None = None, params: dict[str, Any] | None = None) -> httpx.Response:
        headers = {"Accept": "application/json"}
        if token:
            headers["Authorization"] = f"Bearer {token}"
        return await self._client.get(path, headers=headers, params=params)

    async def post(self, path: str, token: str | None = None, json: Any | None = None) -> httpx.Response:
        headers = {"Accept": "application/json"}
        if token:
            headers["Authorization"] = f"Bearer {token}"
        return await self._client.post(path, headers=headers, json=json)


def parse_x_pages(response: httpx.Response) -> int:
    try:
        raw = response.headers.get("x-pages")
        return int(raw) if raw else 1
    except Exception:
        return 1
