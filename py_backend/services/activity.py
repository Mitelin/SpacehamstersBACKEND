from __future__ import annotations

import asyncio
from datetime import datetime, timedelta, timezone
from decimal import Decimal
from typing import Any

from .. import db
from ..esi import ESIClient
from ..logger import log


def _jsonable_value(value: Any) -> Any:
    if isinstance(value, Decimal):
        return float(value)
    if isinstance(value, datetime):
        return value.isoformat(sep=" ")
    return value


def _jsonable_rows(rows: list[dict[str, Any]]) -> list[dict[str, Any]]:
    return [{k: _jsonable_value(v) for k, v in row.items()} for row in rows]


def _esi_dt(value: str | None) -> str | None:
    if not value:
        return None
    return value[:19].replace("T", " ")


def _parse_dt(value: Any) -> datetime | None:
    if value is None or value == "":
        return None
    if isinstance(value, datetime):
        return value.replace(tzinfo=None)
    raw = str(value)
    try:
        parsed = datetime.fromisoformat(raw.replace("Z", "+00:00"))
    except ValueError:
        try:
            parsed = datetime.strptime(raw[:19], "%Y-%m-%dT%H:%M:%S")
        except ValueError:
            try:
                parsed = datetime.strptime(raw[:19], "%Y-%m-%d %H:%M:%S")
            except ValueError:
                return None
    if parsed.tzinfo is not None:
        parsed = parsed.astimezone(timezone.utc).replace(tzinfo=None)
    return parsed.replace(tzinfo=None)


def _month_start(year: int, month: int) -> datetime:
    return datetime(int(year), int(month), 1)


def _month_end(year: int, month: int) -> datetime:
    start = _month_start(year, month)
    if int(month) == 12:
        return datetime(int(year) + 1, 1, 1)
    return datetime(int(year), int(month) + 1, 1)


def _clip_hours(start: datetime | None, end: datetime | None, window_start: datetime, window_end: datetime) -> float:
    if start is None or end is None:
        return 0.0
    clipped_start = max(start, window_start)
    clipped_end = min(end, window_end)
    if clipped_end <= clipped_start:
        return 0.0
    return (clipped_end - clipped_start).total_seconds() / 3600.0


def _iter_session_windows(rows: list[dict[str, Any]], active_until: datetime) -> list[tuple[datetime, datetime]]:
    session_keys: set[str] = set()
    sessions: list[tuple[datetime, datetime]] = []
    last_online_by_logon: dict[str, dict[str, Any]] = {}

    for row in rows:
        logon = _parse_dt(row.get("logonDate"))
        logoff = _parse_dt(row.get("logoffDate"))
        logon_key = str(row.get("logonDate") or "")
        if logon_key:
            last_online_by_logon[logon_key] = row
        if logon is None or logoff is None or logoff <= logon:
            continue
        key = f"{row.get('logonDate')}|{row.get('logoffDate')}"
        if key in session_keys:
            continue
        session_keys.add(key)
        sessions.append((logon, logoff))

    for logon_key, row in last_online_by_logon.items():
        if not bool(row.get("isOnline")):
            continue
        key = f"{logon_key}|"
        if key in session_keys:
            continue
        logon = _parse_dt(row.get("logonDate"))
        if logon is None or active_until <= logon:
            continue
        session_keys.add(key)
        sessions.append((logon, active_until))

    return sessions


def _activity_days(rows: list[dict[str, Any]], year: int, month: int) -> set[datetime.date]:
    window_start = _month_start(year, month)
    window_end = _month_end(year, month)
    now_utc = datetime.now(timezone.utc).replace(tzinfo=None)
    active_until = min(now_utc, window_end)
    days: set[datetime.date] = set()

    for start, end in _iter_session_windows(rows, active_until):
        clipped_start = max(start, window_start)
        clipped_end = min(end, window_end)
        if clipped_end <= clipped_start:
            continue
        current_day = clipped_start.date()
        last_day = (clipped_end - timedelta(microseconds=1)).date()
        while current_day <= last_day:
            days.add(current_day)
            current_day += timedelta(days=1)

    return days


def _estimate_hours(rows: list[dict[str, Any]], year: int, month: int) -> float:
    window_start = _month_start(year, month)
    window_end = _month_end(year, month)
    now_utc = datetime.now(timezone.utc).replace(tzinfo=None)
    active_until = min(now_utc, window_end)
    total_hours = 0.0

    for logon, logoff in _iter_session_windows(rows, active_until):
        total_hours += _clip_hours(logon, logoff, window_start, window_end)

    return round(total_hours, 1)


class ActivityService:
    def __init__(self, esi: ESIClient):
        self._esi = esi
        self._lock = asyncio.Lock()

    async def sync(self, corporation_id: int, access_token: str, snapshot_at: datetime | None = None) -> int:
        if self._lock.locked():
            raise RuntimeError("Předchozí synchronizace ještě není dokončena.")
        async with self._lock:
            log(2, f"activity.sync ({corporation_id})")
            resp = await self._esi.get(
                f"/corporations/{corporation_id}/membertracking/",
                token=access_token,
                params={"datasource": "tranquility"},
            )
            if resp.status_code != 200:
                raise RuntimeError(resp.text or resp.reason_phrase)

            items = list(resp.json() or [])
            current_snapshot = snapshot_at or datetime.now(timezone.utc).replace(tzinfo=None, second=0, microsecond=0)

            if items:
                await self.sync_names(items, access_token)
            return await self.store(items, current_snapshot)

    async def sync_names(self, items: list[dict[str, Any]], access_token: str) -> int:
        ids = sorted({int(item.get("character_id")) for item in list(items) if item.get("character_id") is not None})
        if not ids:
            return 0

        resp = await self._esi.post("/universe/names/", token=access_token, json=ids)
        if resp.status_code != 200:
            raise RuntimeError(resp.text or resp.reason_phrase)
        return await self.store_names(resp.json())

    async def store_names(self, items: list[dict[str, Any]]) -> int:
        cnt = 0
        async with db.connection() as conn:
            async with conn.cursor() as cur:
                for item in list(items):
                    await cur.execute(
                        "REPLACE INTO corpNames (ID, name, category) VALUES (%s,%s,%s)",
                        [item.get("id"), item.get("name"), item.get("category")],
                    )
                    cnt += 1
        return cnt

    async def store(self, items: list[dict[str, Any]], snapshot_at: datetime) -> int:
        cnt = 0
        async with db.connection() as conn:
            async with conn.cursor() as cur:
                for item in list(items):
                    logon_date = _esi_dt(item.get("logon_date"))
                    logoff_date = _esi_dt(item.get("logoff_date"))
                    is_online = 0
                    if logon_date and (not logoff_date or logon_date > logoff_date):
                        is_online = 1
                    await cur.execute(
                        """
                        REPLACE INTO corpActivitySnapshots (
                            snapshotAt, characterID, logonDate, logoffDate, startDate,
                            locationID, shipTypeID, isOnline
                        ) VALUES (%s,%s,%s,%s,%s,%s,%s,%s)
                        """,
                        [
                            snapshot_at,
                            item.get("character_id"),
                            logon_date,
                            logoff_date,
                            _esi_dt(item.get("start_date")),
                            item.get("location_id"),
                            item.get("ship_type_id"),
                            is_online,
                        ],
                    )
                    cnt += 1
        return cnt

    async def get_report(self, year: int, month: int) -> dict[str, Any]:
        y = int(year)
        m = int(month)
        if y < 2021 or y > 2100:
            raise RuntimeError("Invalid year")
        if m < 1 or m > 12:
            raise RuntimeError("Invalid month")

        month_start = f"{y:04d}-{m:02d}-01"
        rows = await db.fetch_all(
            """
            SELECT
                s.snapshotAt,
                s.characterID AS characterId,
                COALESCE(cn.name, '') AS characterName,
                s.isOnline,
                s.logonDate,
                s.logoffDate,
                s.locationID AS locationId,
                s.shipTypeID AS shipTypeId,
                it.typeName AS shipName,
                s.startDate
            FROM corpActivitySnapshots s
            LEFT JOIN corpNames cn ON cn.ID = s.characterID
            LEFT JOIN invTypes it ON it.typeID = s.shipTypeID
            WHERE s.snapshotAt >= %s AND s.snapshotAt < DATE_ADD(%s, INTERVAL 1 MONTH)
            ORDER BY s.characterID, s.snapshotAt
            """,
            [month_start, month_start],
        )

        if not rows:
            return {
                "summary": [],
                "meta": {
                    "year": y,
                    "month": m,
                    "pilotCount": 0,
                    "snapshotCount": 0,
                    "latestSnapshotAt": None,
                    "monthKey": f"{y:04d}-{m:02d}",
                },
            }

        grouped: dict[int, list[dict[str, Any]]] = {}
        for row in rows:
            character_id = int(row["characterId"])
            grouped.setdefault(character_id, []).append(row)

        today = datetime.now(timezone.utc).date()
        summary: list[dict[str, Any]] = []
        latest_snapshot: datetime | None = None

        for character_id, character_rows in grouped.items():
            last = character_rows[-1]
            active_days = _activity_days(character_rows, y, m)
            last_snapshot_at = _parse_dt(last.get("snapshotAt"))
            if last_snapshot_at and (latest_snapshot is None or last_snapshot_at > latest_snapshot):
                latest_snapshot = last_snapshot_at
            summary.append(
                {
                    "characterId": character_id,
                    "characterName": str(last.get("characterName") or character_id),
                    "activeDays": len(active_days),
                    "seenToday": today in active_days,
                    "estimatedHours": _estimate_hours(character_rows, y, m),
                    "status": "online" if bool(last.get("isOnline")) else "offline",
                    "lastLogin": last.get("logonDate"),
                    "lastLogout": last.get("logoffDate"),
                    "locationId": last.get("locationId"),
                    "shipTypeId": last.get("shipTypeId"),
                    "shipName": last.get("shipName"),
                    "startDate": last.get("startDate"),
                    "snapshotCount": len(character_rows),
                    "lastSnapshotAt": last.get("snapshotAt"),
                }
            )

        summary.sort(
            key=lambda item: (
                -int(item.get("activeDays") or 0),
                -float(item.get("estimatedHours") or 0),
                str(item.get("characterName") or ""),
            )
        )

        return {
            "summary": _jsonable_rows(summary),
            "meta": {
                "year": y,
                "month": m,
                "pilotCount": len(summary),
                "snapshotCount": len(rows),
                "latestSnapshotAt": _jsonable_value(latest_snapshot),
                "monthKey": f"{y:04d}-{m:02d}",
            },
        }