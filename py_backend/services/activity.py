from __future__ import annotations

import asyncio
from datetime import datetime, timedelta, timezone
from decimal import Decimal
from email.utils import parsedate_to_datetime
from typing import Any

from .. import db
from ..esi import ESIClient
from ..logger import log
from .retention import prune_activity_history


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


def _parse_http_date(value: str | None) -> datetime | None:
    if not value:
        return None
    try:
        parsed = parsedate_to_datetime(value)
    except (TypeError, ValueError):
        return None
    if parsed.tzinfo is not None:
        parsed = parsed.astimezone(timezone.utc).replace(tzinfo=None)
    return parsed.replace(tzinfo=None, second=0, microsecond=0)


def _response_snapshot_at(response: Any, fallback: datetime | None = None) -> datetime:
    headers = getattr(response, "headers", {}) or {}
    last_modified = None
    try:
        last_modified = headers.get("Last-Modified") or headers.get("last-modified")
    except AttributeError:
        last_modified = None
    parsed = _parse_http_date(last_modified)
    if parsed:
        return parsed
    return fallback or datetime.now(timezone.utc).replace(tzinfo=None, second=0, microsecond=0)


def _response_has_last_modified(response: Any) -> bool:
    headers = getattr(response, "headers", {}) or {}
    try:
        return bool(headers.get("Last-Modified") or headers.get("last-modified"))
    except AttributeError:
        return False


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


def _clip_minutes(start: datetime | None, end: datetime | None, window_start: datetime, window_end: datetime) -> int:
    if start is None or end is None:
        return 0
    clipped_start = max(start, window_start)
    clipped_end = min(end, window_end)
    if clipped_end <= clipped_start:
        return 0
    return int(round((clipped_end - clipped_start).total_seconds() / 60.0))


def _iter_session_windows(rows: list[dict[str, Any]], active_until: datetime) -> list[tuple[datetime, datetime]]:
    session_keys: set[str] = set()
    sessions: list[tuple[datetime, datetime]] = []

    for row in rows:
        logon = _parse_dt(row.get("logonDate"))
        logoff = _parse_dt(row.get("logoffDate"))
        if logon is None or logoff is None or logoff <= logon:
            if not bool(row.get("isOnline")) or logon is None:
                continue
            snapshot_at = _parse_dt(row.get("snapshotAt")) or active_until
            end = min(snapshot_at, active_until)
            if end <= logon:
                continue
            key = f"{row.get('logonDate')}|{end}"
            if key in session_keys:
                continue
            session_keys.add(key)
            sessions.append((logon, end))
            continue
        key = f"{row.get('logonDate')}|{row.get('logoffDate')}"
        if key in session_keys:
            continue
        session_keys.add(key)
        sessions.append((logon, logoff))

    return sessions


def _merge_session_windows(sessions: list[tuple[datetime, datetime]]) -> list[tuple[datetime, datetime]]:
    if not sessions:
        return []

    ordered = sorted(sessions, key=lambda item: (item[0], item[1]))
    merged: list[tuple[datetime, datetime]] = []
    current_start, current_end = ordered[0]

    for start, end in ordered[1:]:
        if start <= current_end:
            if end > current_end:
                current_end = end
            continue
        merged.append((current_start, current_end))
        current_start, current_end = start, end

    merged.append((current_start, current_end))
    return merged


def _activity_days(rows: list[dict[str, Any]], year: int, month: int) -> set[datetime.date]:
    window_start = _month_start(year, month)
    window_end = _month_end(year, month)
    now_utc = datetime.now(timezone.utc).replace(tzinfo=None)
    active_until = min(now_utc, window_end)
    days: set[datetime.date] = set()

    for start, end in _merge_session_windows(_iter_session_windows(rows, active_until)):
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


def _days_mask(days: set[datetime.date]) -> int:
    mask = 0
    for day in days:
        shift = int(day.day) - 1
        if shift >= 0:
            mask |= 1 << shift
    return mask


def _mask_has_day(mask: int, day: int) -> bool:
    shift = int(day) - 1
    if shift < 0:
        return False
    return bool(mask & (1 << shift))


def _mask_day_count(mask: int) -> int:
    return int(mask).bit_count()


def _is_online_session(logon: datetime | None, logoff: datetime | None) -> bool:
    return bool(logon and (logoff is None or logon > logoff))


def _iter_month_segments(start: datetime, end: datetime) -> list[tuple[int, int, datetime, datetime]]:
    if end <= start:
        return []

    segments: list[tuple[int, int, datetime, datetime]] = []
    cursor = start
    while cursor < end:
        month_end = _month_end(cursor.year, cursor.month)
        segment_end = min(end, month_end)
        if segment_end > cursor:
            segments.append((cursor.year, cursor.month, cursor, segment_end))
        cursor = segment_end
    return segments


def _days_mask_between(start: datetime, end: datetime) -> int:
    if end <= start:
        return 0
    days: set[datetime.date] = set()
    current_day = start.date()
    last_day = (end - timedelta(microseconds=1)).date()
    while current_day <= last_day:
        days.add(current_day)
        current_day += timedelta(days=1)
    return _days_mask(days)


def _build_incremental_activity_updates(
    item: dict[str, Any],
    snapshot_at: datetime,
    state: dict[str, Any] | None = None,
    snapshot_is_current: bool = True,
) -> tuple[list[dict[str, Any]], dict[str, Any], list[dict[str, Any]]]:
    character_id = int(item.get("character_id"))
    logon = _parse_dt(item.get("logon_date"))
    logoff = _parse_dt(item.get("logoff_date"))
    is_online = _is_online_session(logon, logoff)

    updates_by_month: dict[tuple[int, int], dict[str, Any]] = {}
    intervals: list[dict[str, Any]] = []

    def ensure_update(year: int, month: int, snapshot_count: int) -> dict[str, Any]:
        key = (int(year), int(month))
        if key not in updates_by_month:
            updates_by_month[key] = {
                "year": key[0],
                "month": key[1],
                "characterId": character_id,
                "activeDaysMask": 0,
                "estimatedMinutes": 0,
                "status": "online" if is_online else "offline",
                "lastLogin": logon,
                "lastLogout": None if is_online else logoff,
                "locationId": item.get("location_id"),
                "shipTypeId": item.get("ship_type_id"),
                "startDate": _parse_dt(item.get("start_date")),
                "snapshotCount": 0,
                "lastSnapshotAt": snapshot_at,
            }
        updates_by_month[key]["snapshotCount"] += snapshot_count
        return updates_by_month[key]

    ensure_update(snapshot_at.year, snapshot_at.month, 1)

    closed_session = bool(logon and logoff and logoff > logon)
    session_end: datetime | None = None
    if closed_session:
        session_end = logoff
    elif is_online and logon and snapshot_at > logon:
        session_end = snapshot_at

    last_logon = _parse_dt((state or {}).get("lastLogonDate"))
    last_logoff = _parse_dt((state or {}).get("lastLogoffDate"))
    last_counted_until = _parse_dt((state or {}).get("lastCountedUntil"))
    last_snapshot_at = _parse_dt((state or {}).get("lastSnapshotAt"))
    counted_until = last_counted_until

    if last_snapshot_at and snapshot_at <= last_snapshot_at and last_logon == logon and last_logoff == logoff:
        return [], dict(state or {}), []

    if is_online and not closed_session and not snapshot_is_current:
        return [], dict(state or {}), []

    if logon and session_end:
        count_start = logon
        if last_logon == logon and last_counted_until:
            count_start = max(logon, last_counted_until)
        elif closed_session:
            count_start = logon
        elif last_snapshot_at:
            count_start = max(logon, last_snapshot_at)
        else:
            count_start = logon

        if session_end > count_start:
            intervals.append(
                {
                    "characterId": character_id,
                    "intervalStart": count_start,
                    "intervalEnd": session_end,
                    "sourceSnapshotAt": snapshot_at,
                    "sourceKind": "closed" if closed_session else "online",
                    "logonDate": logon,
                    "logoffDate": logoff,
                    "locationId": item.get("location_id"),
                    "shipTypeId": item.get("ship_type_id"),
                    "startDate": _parse_dt(item.get("start_date")),
                }
            )
            for year, month, segment_start, segment_end in _iter_month_segments(count_start, session_end):
                update = ensure_update(year, month, 0)
                update["estimatedMinutes"] += _clip_minutes(segment_start, segment_end, segment_start, segment_end)
                update["activeDaysMask"] |= _days_mask_between(segment_start, segment_end)
            counted_until = session_end if counted_until is None else max(counted_until, session_end)
        elif is_online and counted_until is None:
            counted_until = snapshot_at

    new_state = {
        "characterId": character_id,
        "lastLogonDate": logon,
        "lastLogoffDate": logoff,
        "lastCountedUntil": counted_until,
        "lastSnapshotAt": snapshot_at,
    }
    return list(updates_by_month.values()), new_state, intervals


def _estimate_minutes(rows: list[dict[str, Any]], year: int, month: int) -> int:
    window_start = _month_start(year, month)
    window_end = _month_end(year, month)
    now_utc = datetime.now(timezone.utc).replace(tzinfo=None)
    active_until = min(now_utc, window_end)
    total_minutes = 0

    for logon, logoff in _merge_session_windows(_iter_session_windows(rows, active_until)):
        total_minutes += _clip_minutes(logon, logoff, window_start, window_end)

    return total_minutes


def _estimate_hours(rows: list[dict[str, Any]], year: int, month: int) -> float:
    return round(_estimate_minutes(rows, year, month) / 60.0, 1)


def _empty_report(year: int, month: int) -> dict[str, Any]:
    return {
        "summary": [],
        "meta": {
            "year": year,
            "month": month,
            "pilotCount": 0,
            "snapshotCount": 0,
            "latestSnapshotAt": None,
            "monthKey": f"{year:04d}-{month:02d}",
        },
    }


def _build_report_from_rows(rows: list[dict[str, Any]], year: int, month: int) -> dict[str, Any]:
    y = int(year)
    m = int(month)
    if not rows:
        return _empty_report(y, m)

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
                "activeDaysMask": _days_mask(active_days),
                "seenToday": today in active_days,
                "estimatedMinutes": _estimate_minutes(character_rows, y, m),
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
        "summary": summary,
        "meta": {
            "year": y,
            "month": m,
            "pilotCount": len(summary),
            "snapshotCount": len(rows),
            "latestSnapshotAt": latest_snapshot,
            "monthKey": f"{y:04d}-{m:02d}",
        },
    }


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

            payload = resp.json() or []
            current_snapshot = snapshot_at or _response_snapshot_at(resp)
            snapshot_is_current = bool(snapshot_at) or _response_has_last_modified(resp)

            if not isinstance(payload, list):
                log(3, "activity.sync skipped: unexpected ESI membertracking payload")
                return 0
            items = list(payload)
            if not items:
                log(2, "activity.sync skipped: empty ESI membertracking payload")
                return 0

            await self.sync_names(items, access_token)
            cnt = await self.store(items, current_snapshot)
            await self.update_monthly_activity(items, current_snapshot, snapshot_is_current=snapshot_is_current)
            await prune_activity_history(current_snapshot)
            return cnt

    async def sync_names(self, items: list[dict[str, Any]], access_token: str) -> int:
        ids = sorted({int(item.get("character_id")) for item in list(items) if item.get("character_id") is not None})
        if not ids:
            return 0

        placeholders = ",".join(["%s"] * len(ids))
        rows = await db.fetch_all(f"SELECT ID FROM corpNames WHERE ID IN ({placeholders})", ids)
        known_ids = {int(row.get("ID")) for row in rows if row.get("ID") is not None}
        ids = [character_id for character_id in ids if character_id not in known_ids]
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

    async def _fetch_raw_month_rows(self, year: int, month: int) -> list[dict[str, Any]]:
        month_start = f"{int(year):04d}-{int(month):02d}-01"
        return await db.fetch_all(
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

    async def refresh_monthly_snapshots(self, months: set[tuple[int, int]]) -> int:
        cnt = 0
        async with db.connection() as conn:
            async with conn.cursor() as cur:
                for year, month in sorted(months):
                    report = _build_report_from_rows(await self._fetch_raw_month_rows(year, month), year, month)
                    await cur.execute(
                        "DELETE FROM corpActivityMonthly WHERE year=%s AND month=%s",
                        [int(year), int(month)],
                    )
                    for item in report["summary"]:
                        await cur.execute(
                            """
                            INSERT INTO corpActivityMonthly (
                                year, month, characterID, activeDaysMask, estimatedMinutes,
                                status, lastLogin, lastLogout, locationID, shipTypeID,
                                startDate, snapshotCount, lastSnapshotAt
                            ) VALUES (%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s)
                            """,
                            [
                                int(year),
                                int(month),
                                item.get("characterId"),
                                int(item.get("activeDaysMask") or 0),
                                int(item.get("estimatedMinutes") or 0),
                                item.get("status"),
                                item.get("lastLogin"),
                                item.get("lastLogout"),
                                item.get("locationId"),
                                item.get("shipTypeId"),
                                item.get("startDate"),
                                int(item.get("snapshotCount") or 0),
                                item.get("lastSnapshotAt"),
                            ],
                        )
                        cnt += 1
        return cnt

    async def update_monthly_activity(self, items: list[dict[str, Any]], snapshot_at: datetime, snapshot_is_current: bool = True) -> int:
        cnt = 0
        async with db.connection() as conn:
            async with conn.cursor() as cur:
                await conn.begin()
                try:
                    for item in list(items):
                        character_id = item.get("character_id")
                        if character_id is None:
                            continue
                        await cur.execute(
                            """
                            SELECT lastLogonDate, lastLogoffDate, lastCountedUntil, lastSnapshotAt
                            FROM corpActivityState
                            WHERE characterID = %s
                            FOR UPDATE
                            """,
                            [character_id],
                        )
                        state = await cur.fetchone()
                        updates, new_state, intervals = _build_incremental_activity_updates(
                            item,
                            snapshot_at,
                            state,
                            snapshot_is_current=snapshot_is_current,
                        )
                        if not updates and not intervals:
                            continue
                        for interval in intervals:
                            await cur.execute(
                                """
                                INSERT IGNORE INTO corpActivityIntervals (
                                    characterID, intervalStart, intervalEnd, sourceSnapshotAt, sourceKind,
                                    logonDate, logoffDate, locationID, shipTypeID, startDate
                                ) VALUES (%s,%s,%s,%s,%s,%s,%s,%s,%s,%s)
                                """,
                                [
                                    interval.get("characterId"),
                                    interval.get("intervalStart"),
                                    interval.get("intervalEnd"),
                                    interval.get("sourceSnapshotAt"),
                                    interval.get("sourceKind"),
                                    interval.get("logonDate"),
                                    interval.get("logoffDate"),
                                    interval.get("locationId"),
                                    interval.get("shipTypeId"),
                                    interval.get("startDate"),
                                ],
                            )
                        for update in updates:
                            await cur.execute(
                                """
                                INSERT INTO corpActivityMonthly (
                                    year, month, characterID, activeDaysMask, estimatedMinutes,
                                    status, lastLogin, lastLogout, locationID, shipTypeID,
                                    startDate, snapshotCount, lastSnapshotAt
                                ) VALUES (%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s)
                                ON DUPLICATE KEY UPDATE
                                    activeDaysMask = activeDaysMask | VALUES(activeDaysMask),
                                    estimatedMinutes = estimatedMinutes + VALUES(estimatedMinutes),
                                    status = VALUES(status),
                                    lastLogin = VALUES(lastLogin),
                                    lastLogout = VALUES(lastLogout),
                                    locationID = VALUES(locationID),
                                    shipTypeID = VALUES(shipTypeID),
                                    startDate = VALUES(startDate),
                                    snapshotCount = snapshotCount + VALUES(snapshotCount),
                                    lastSnapshotAt = VALUES(lastSnapshotAt)
                                """,
                                [
                                    update.get("year"),
                                    update.get("month"),
                                    update.get("characterId"),
                                    int(update.get("activeDaysMask") or 0),
                                    int(update.get("estimatedMinutes") or 0),
                                    update.get("status"),
                                    update.get("lastLogin"),
                                    update.get("lastLogout"),
                                    update.get("locationId"),
                                    update.get("shipTypeId"),
                                    update.get("startDate"),
                                    int(update.get("snapshotCount") or 0),
                                    update.get("lastSnapshotAt"),
                                ],
                            )
                        await cur.execute(
                            """
                            INSERT INTO corpActivityState (
                                characterID, lastLogonDate, lastLogoffDate, lastCountedUntil, lastSnapshotAt
                            ) VALUES (%s,%s,%s,%s,%s)
                            ON DUPLICATE KEY UPDATE
                                lastLogonDate = VALUES(lastLogonDate),
                                lastLogoffDate = VALUES(lastLogoffDate),
                                lastCountedUntil = VALUES(lastCountedUntil),
                                lastSnapshotAt = VALUES(lastSnapshotAt)
                            """,
                            [
                                new_state.get("characterId"),
                                new_state.get("lastLogonDate"),
                                new_state.get("lastLogoffDate"),
                                new_state.get("lastCountedUntil"),
                                new_state.get("lastSnapshotAt"),
                            ],
                        )
                        cnt += 1
                    await conn.commit()
                except Exception:
                    await conn.rollback()
                    raise
        return cnt

    async def _get_report_from_monthly(self, year: int, month: int) -> dict[str, Any] | None:
        rows = await db.fetch_all(
            """
            SELECT
                m.characterID AS characterId,
                COALESCE(cn.name, '') AS characterName,
                m.activeDaysMask,
                m.estimatedMinutes,
                m.status,
                m.lastLogin,
                m.lastLogout,
                m.locationID AS locationId,
                m.shipTypeID AS shipTypeId,
                it.typeName AS shipName,
                m.startDate,
                m.snapshotCount,
                m.lastSnapshotAt
            FROM corpActivityMonthly m
            LEFT JOIN corpNames cn ON cn.ID = m.characterID
            LEFT JOIN invTypes it ON it.typeID = m.shipTypeID
            WHERE m.year = %s AND m.month = %s
            ORDER BY m.characterID
            """,
            [int(year), int(month)],
        )
        if not rows:
            return None

        y = int(year)
        m = int(month)
        today = datetime.now(timezone.utc).date()
        latest_snapshot: datetime | None = None
        summary: list[dict[str, Any]] = []
        snapshot_count = 0

        for row in rows:
            last_snapshot_at = _parse_dt(row.get("lastSnapshotAt"))
            if last_snapshot_at and (latest_snapshot is None or last_snapshot_at > latest_snapshot):
                latest_snapshot = last_snapshot_at
            mask = int(row.get("activeDaysMask") or 0)
            minutes = int(row.get("estimatedMinutes") or 0)
            snapshot_count += int(row.get("snapshotCount") or 0)
            summary.append(
                {
                    "characterId": int(row.get("characterId") or 0),
                    "characterName": str(row.get("characterName") or row.get("characterId") or ""),
                    "activeDays": _mask_day_count(mask),
                    "activeDaysMask": mask,
                    "seenToday": today.year == y and today.month == m and _mask_has_day(mask, today.day),
                    "estimatedMinutes": minutes,
                    "estimatedHours": round(minutes / 60.0, 1),
                    "status": row.get("status") or "offline",
                    "lastLogin": row.get("lastLogin"),
                    "lastLogout": row.get("lastLogout"),
                    "locationId": row.get("locationId"),
                    "shipTypeId": row.get("shipTypeId"),
                    "shipName": row.get("shipName"),
                    "startDate": row.get("startDate"),
                    "snapshotCount": int(row.get("snapshotCount") or 0),
                    "lastSnapshotAt": row.get("lastSnapshotAt"),
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
                "snapshotCount": snapshot_count,
                "latestSnapshotAt": _jsonable_value(latest_snapshot),
                "monthKey": f"{y:04d}-{m:02d}",
            },
        }

    async def _fetch_interval_month_rows(self, year: int, month: int) -> list[dict[str, Any]]:
        month_start = f"{int(year):04d}-{int(month):02d}-01"
        return await db.fetch_all(
            """
            SELECT
                i.characterID AS characterId,
                COALESCE(cn.name, '') AS characterName,
                i.intervalStart,
                i.intervalEnd,
                i.sourceSnapshotAt,
                COALESCE(m.status, CASE WHEN i.sourceKind = 'online' THEN 'online' ELSE 'offline' END) AS status,
                COALESCE(m.lastLogin, i.logonDate) AS lastLogin,
                COALESCE(m.lastLogout, i.logoffDate) AS lastLogout,
                COALESCE(m.locationID, i.locationID) AS locationId,
                COALESCE(m.shipTypeID, i.shipTypeID) AS shipTypeId,
                it.typeName AS shipName,
                COALESCE(m.startDate, i.startDate) AS startDate,
                COALESCE(m.snapshotCount, 0) AS snapshotCount,
                COALESCE(m.lastSnapshotAt, i.sourceSnapshotAt) AS lastSnapshotAt
            FROM corpActivityIntervals i
            LEFT JOIN corpActivityMonthly m
                ON m.characterID = i.characterID AND m.year = %s AND m.month = %s
            LEFT JOIN corpNames cn ON cn.ID = i.characterID
            LEFT JOIN invTypes it ON it.typeID = COALESCE(m.shipTypeID, i.shipTypeID)
            WHERE i.intervalStart < DATE_ADD(%s, INTERVAL 1 MONTH)
              AND i.intervalEnd > %s
            ORDER BY i.characterID, i.intervalStart, i.intervalEnd
            """,
            [int(year), int(month), month_start, month_start],
        )

    def _build_report_from_intervals(self, rows: list[dict[str, Any]], year: int, month: int) -> dict[str, Any] | None:
        if not rows:
            return None

        y = int(year)
        m = int(month)
        window_start = _month_start(y, m)
        window_end = _month_end(y, m)
        today = datetime.now(timezone.utc).date()
        latest_snapshot: datetime | None = None
        by_character: dict[int, dict[str, Any]] = {}

        for row in rows:
            character_id = int(row.get("characterId") or 0)
            if not character_id:
                continue
            interval_start = _parse_dt(row.get("intervalStart"))
            interval_end = _parse_dt(row.get("intervalEnd"))
            if interval_start is None or interval_end is None or interval_end <= interval_start:
                continue

            item = by_character.setdefault(
                character_id,
                {
                    "characterId": character_id,
                    "characterName": str(row.get("characterName") or character_id),
                    "intervals": [],
                    "activeDaysMask": 0,
                    "status": row.get("status") or "offline",
                    "lastLogin": row.get("lastLogin"),
                    "lastLogout": row.get("lastLogout"),
                    "locationId": row.get("locationId"),
                    "shipTypeId": row.get("shipTypeId"),
                    "shipName": row.get("shipName"),
                    "startDate": row.get("startDate"),
                    "snapshotCount": int(row.get("snapshotCount") or 0),
                    "lastSnapshotAt": row.get("lastSnapshotAt"),
                },
            )
            item["intervals"].append((max(interval_start, window_start), min(interval_end, window_end)))
            row_snapshot = _parse_dt(row.get("lastSnapshotAt")) or _parse_dt(row.get("sourceSnapshotAt"))
            current_snapshot = _parse_dt(item.get("lastSnapshotAt"))
            if row_snapshot and (current_snapshot is None or row_snapshot >= current_snapshot):
                item["status"] = row.get("status") or "offline"
                item["lastLogin"] = row.get("lastLogin")
                item["lastLogout"] = row.get("lastLogout")
                item["locationId"] = row.get("locationId")
                item["shipTypeId"] = row.get("shipTypeId")
                item["shipName"] = row.get("shipName")
                item["startDate"] = row.get("startDate")
                item["snapshotCount"] = int(row.get("snapshotCount") or item.get("snapshotCount") or 0)
                item["lastSnapshotAt"] = row_snapshot
            if row_snapshot and (latest_snapshot is None or row_snapshot > latest_snapshot):
                latest_snapshot = row_snapshot

        summary: list[dict[str, Any]] = []
        snapshot_count = 0
        for item in by_character.values():
            merged = _merge_session_windows(
                [(start, end) for start, end in item.pop("intervals") if end > start]
            )
            minutes = 0
            mask = 0
            for start, end in merged:
                minutes += _clip_minutes(start, end, window_start, window_end)
                mask |= _days_mask_between(max(start, window_start), min(end, window_end))
            snapshot_count += int(item.get("snapshotCount") or 0)
            summary.append(
                {
                    **item,
                    "activeDays": _mask_day_count(mask),
                    "activeDaysMask": mask,
                    "seenToday": today.year == y and today.month == m and _mask_has_day(mask, today.day),
                    "estimatedMinutes": minutes,
                    "estimatedHours": round(minutes / 60.0, 1),
                }
            )

        if not summary:
            return None

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
                "snapshotCount": snapshot_count,
                "latestSnapshotAt": _jsonable_value(latest_snapshot),
                "monthKey": f"{y:04d}-{m:02d}",
            },
        }

    def _merge_monthly_interval_reports(
        self,
        monthly_report: dict[str, Any],
        interval_report: dict[str, Any] | None,
        year: int,
        month: int,
    ) -> dict[str, Any]:
        if interval_report is None:
            return monthly_report

        y = int(year)
        m = int(month)
        monthly_by_character = {
            int(item.get("characterId") or 0): item
            for item in monthly_report.get("summary", [])
            if int(item.get("characterId") or 0)
        }
        interval_by_character = {
            int(item.get("characterId") or 0): item
            for item in interval_report.get("summary", [])
            if int(item.get("characterId") or 0)
        }

        summary: list[dict[str, Any]] = []
        for character_id in sorted(set(monthly_by_character) | set(interval_by_character)):
            monthly_item = monthly_by_character.get(character_id)
            interval_item = interval_by_character.get(character_id)
            if monthly_item is None:
                if interval_item is not None:
                    summary.append(interval_item)
                continue
            if interval_item is None:
                summary.append(monthly_item)
                continue

            monthly_minutes = int(monthly_item.get("estimatedMinutes") or 0)
            interval_minutes = int(interval_item.get("estimatedMinutes") or 0)
            summary.append(interval_item if interval_minutes > monthly_minutes else monthly_item)

        latest_snapshot: datetime | None = None
        snapshot_count = 0
        for item in summary:
            snapshot_count += int(item.get("snapshotCount") or 0)
            item_snapshot = _parse_dt(item.get("lastSnapshotAt"))
            if item_snapshot and (latest_snapshot is None or item_snapshot > latest_snapshot):
                latest_snapshot = item_snapshot

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
                "snapshotCount": snapshot_count,
                "latestSnapshotAt": _jsonable_value(latest_snapshot),
                "monthKey": f"{y:04d}-{m:02d}",
            },
        }

    async def get_report(self, year: int, month: int) -> dict[str, Any]:
        y = int(year)
        m = int(month)
        if y < 2021 or y > 2100:
            raise RuntimeError("Invalid year")
        if m < 1 or m > 12:
            raise RuntimeError("Invalid month")

        monthly_report = await self._get_report_from_monthly(y, m)
        if monthly_report is not None:
            interval_report = self._build_report_from_intervals(await self._fetch_interval_month_rows(y, m), y, m)
            return self._merge_monthly_interval_reports(monthly_report, interval_report, y, m)

        report = _build_report_from_rows(await self._fetch_raw_month_rows(y, m), y, m)
        return {
            "summary": _jsonable_rows(report["summary"]),
            "meta": {
                "year": y,
                "month": m,
                "pilotCount": int(report["meta"].get("pilotCount") or 0),
                "snapshotCount": int(report["meta"].get("snapshotCount") or 0),
                "latestSnapshotAt": _jsonable_value(report["meta"].get("latestSnapshotAt")),
                "monthKey": report["meta"].get("monthKey"),
            },
        }
