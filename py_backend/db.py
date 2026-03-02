from __future__ import annotations

import contextlib
from typing import Any, AsyncIterator

import aiomysql

from .settings import get_settings


_pool: aiomysql.Pool | None = None


async def init_pool() -> None:
    global _pool
    if _pool is not None:
        return

    settings = get_settings()

    _pool = await aiomysql.create_pool(
        host=settings.db_host,
        port=settings.db_port,
        user=settings.db_user,
        password=settings.db_password,
        db=settings.db_name,
        autocommit=True,
        minsize=1,
        maxsize=5,
        cursorclass=aiomysql.DictCursor,
    )


async def close_pool() -> None:
    global _pool
    if _pool is None:
        return
    _pool.close()
    await _pool.wait_closed()
    _pool = None


@contextlib.asynccontextmanager
async def connection() -> AsyncIterator[aiomysql.Connection]:
    if _pool is None:
        raise RuntimeError("DB pool not initialized. Call init_pool() on startup.")
    async with _pool.acquire() as conn:
        yield conn


async def fetch_all(sql: str, params: Any = None) -> list[dict[str, Any]]:
    async with connection() as conn:
        async with conn.cursor() as cur:
            await cur.execute(sql, params)
            rows = await cur.fetchall()
            return list(rows)


async def fetch_one(sql: str, params: Any = None) -> dict[str, Any] | None:
    async with connection() as conn:
        async with conn.cursor() as cur:
            await cur.execute(sql, params)
            row = await cur.fetchone()
            return dict(row) if row else None


async def execute(sql: str, params: Any = None) -> int:
    async with connection() as conn:
        async with conn.cursor() as cur:
            await cur.execute(sql, params)
            return cur.rowcount

