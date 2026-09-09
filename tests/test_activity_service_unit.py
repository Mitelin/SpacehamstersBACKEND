from __future__ import annotations

from datetime import datetime

import pytest

from py_backend.esi import ESIClient
from py_backend.services.activity import ActivityService, _build_incremental_activity_updates, _response_snapshot_at


@pytest.mark.asyncio
async def test_activity_report_aggregates_month_rows(monkeypatch: pytest.MonkeyPatch) -> None:
    esi = ESIClient("https://esi.test")
    service = ActivityService(esi)

    async def fake_fetch_all(sql: str, params: list) -> list[dict]:
        if "FROM corpActivityMonthly" in sql:
            assert params == [2026, 4]
            return []
        assert params == ["2026-04-01", "2026-04-01"]
        return [
            {
                "snapshotAt": datetime(2026, 4, 2, 0, 45),
                "characterId": 7,
                "characterName": "Pilot A",
                "isOnline": 1,
                "logonDate": datetime(2026, 4, 2, 0, 0),
                "logoffDate": None,
                "locationId": 6001,
                "shipTypeId": 111,
                "shipName": "Drake",
                "startDate": datetime(2024, 1, 15, 12, 0),
            },
            {
                "snapshotAt": datetime(2026, 4, 2, 4, 45),
                "characterId": 7,
                "characterName": "Pilot A",
                "isOnline": 0,
                "logonDate": datetime(2026, 4, 2, 0, 0),
                "logoffDate": datetime(2026, 4, 2, 4, 30),
                "locationId": 6002,
                "shipTypeId": 112,
                "shipName": "Tengu",
                "startDate": datetime(2024, 1, 15, 12, 0),
            },
            {
                "snapshotAt": datetime(2026, 4, 3, 8, 45),
                "characterId": 7,
                "characterName": "Pilot A",
                "isOnline": 0,
                "logonDate": datetime(2026, 4, 3, 7, 0),
                "logoffDate": datetime(2026, 4, 3, 8, 0),
                "locationId": 6003,
                "shipTypeId": 113,
                "shipName": "Cerberus",
                "startDate": datetime(2024, 1, 15, 12, 0),
            },
        ]

    monkeypatch.setattr("py_backend.db.fetch_all", fake_fetch_all)

    report = await service.get_report(year=2026, month=4)

    await esi.close()

    assert report["meta"]["pilotCount"] == 1
    assert report["meta"]["snapshotCount"] == 3
    assert report["summary"][0]["characterId"] == 7
    assert report["summary"][0]["activeDays"] == 2
    assert report["summary"][0]["snapshotCount"] == 3
    assert report["summary"][0]["estimatedHours"] == 5.5
    assert report["summary"][0]["status"] == "offline"
    assert report["summary"][0]["shipName"] == "Cerberus"


@pytest.mark.asyncio
async def test_activity_report_does_not_mark_stale_member_as_seen_today(monkeypatch: pytest.MonkeyPatch) -> None:
    esi = ESIClient("https://esi.test")
    service = ActivityService(esi)

    class FixedDatetime(datetime):
        @classmethod
        def now(cls, tz=None):
            current = cls(2026, 4, 25, 12, 0, 0)
            if tz is not None:
                return current.replace(tzinfo=tz)
            return current

    async def fake_fetch_all(sql: str, params: list) -> list[dict]:
        if "FROM corpActivityMonthly" in sql:
            assert params == [2026, 4]
            return []
        assert params == ["2026-04-01", "2026-04-01"]
        return [
            {
                "snapshotAt": datetime(2026, 4, 18, 12, 45),
                "characterId": 8,
                "characterName": "Pilot B",
                "isOnline": 0,
                "logonDate": datetime(2026, 4, 18, 11, 35),
                "logoffDate": datetime(2026, 4, 18, 23, 10),
                "locationId": 6004,
                "shipTypeId": 114,
                "shipName": "Golem",
                "startDate": datetime(2024, 1, 15, 12, 0),
            },
            {
                "snapshotAt": datetime(2026, 4, 25, 8, 45),
                "characterId": 8,
                "characterName": "Pilot B",
                "isOnline": 0,
                "logonDate": datetime(2026, 4, 18, 11, 35),
                "logoffDate": datetime(2026, 4, 18, 23, 10),
                "locationId": 6004,
                "shipTypeId": 114,
                "shipName": "Golem",
                "startDate": datetime(2024, 1, 15, 12, 0),
            },
        ]

    monkeypatch.setattr("py_backend.db.fetch_all", fake_fetch_all)
    monkeypatch.setattr("py_backend.services.activity.datetime", FixedDatetime)

    report = await service.get_report(year=2026, month=4)

    await esi.close()

    assert report["summary"][0]["activeDays"] == 1
    assert report["summary"][0]["seenToday"] is False
    assert report["summary"][0]["lastLogin"] == datetime(2026, 4, 18, 11, 35)
    assert report["summary"][0]["lastLogout"] == datetime(2026, 4, 18, 23, 10)


@pytest.mark.asyncio
async def test_activity_report_merges_overlapping_sessions(monkeypatch: pytest.MonkeyPatch) -> None:
    esi = ESIClient("https://esi.test")
    service = ActivityService(esi)

    async def fake_fetch_all(sql: str, params: list) -> list[dict]:
        if "FROM corpActivityMonthly" in sql:
            assert params == [2026, 4]
            return []
        assert params == ["2026-04-01", "2026-04-01"]
        return [
            {
                "snapshotAt": datetime(2026, 4, 10, 10, 45),
                "characterId": 9,
                "characterName": "Pilot C",
                "isOnline": 0,
                "logonDate": datetime(2026, 4, 10, 8, 0),
                "logoffDate": datetime(2026, 4, 10, 10, 0),
                "locationId": 6005,
                "shipTypeId": 115,
                "shipName": "Scimitar",
                "startDate": datetime(2024, 1, 15, 12, 0),
            },
            {
                "snapshotAt": datetime(2026, 4, 10, 11, 45),
                "characterId": 9,
                "characterName": "Pilot C",
                "isOnline": 0,
                "logonDate": datetime(2026, 4, 10, 9, 30),
                "logoffDate": datetime(2026, 4, 10, 11, 0),
                "locationId": 6005,
                "shipTypeId": 115,
                "shipName": "Scimitar",
                "startDate": datetime(2024, 1, 15, 12, 0),
            },
        ]

    monkeypatch.setattr("py_backend.db.fetch_all", fake_fetch_all)

    report = await service.get_report(year=2026, month=4)

    await esi.close()

    assert report["summary"][0]["activeDays"] == 1
    assert report["summary"][0]["estimatedHours"] == 3.0


@pytest.mark.asyncio
async def test_activity_report_reads_monthly_snapshot(monkeypatch: pytest.MonkeyPatch) -> None:
    esi = ESIClient("https://esi.test")
    service = ActivityService(esi)

    async def fake_fetch_all(sql: str, params: list) -> list[dict]:
        if "FROM corpActivityMonthly" in sql:
            assert params == [2026, 4]
            return [
                {
                    "characterId": 10,
                    "characterName": "Pilot D",
                    "activeDaysMask": 6,
                    "estimatedMinutes": 135,
                    "status": "offline",
                    "lastLogin": datetime(2026, 4, 2, 9, 0),
                    "lastLogout": datetime(2026, 4, 2, 11, 15),
                    "locationId": 6006,
                    "shipTypeId": 116,
                    "shipName": "Basilisk",
                    "startDate": datetime(2024, 1, 15, 12, 0),
                    "snapshotCount": 5,
                    "lastSnapshotAt": datetime(2026, 4, 2, 12, 45),
                }
            ]
        if "FROM corpActivityIntervals" in sql:
            assert params == [2026, 4, "2026-04-01", "2026-04-01"]
            return []
        raise AssertionError("raw snapshot fallback should not be used when monthly snapshot has rows")

    monkeypatch.setattr("py_backend.db.fetch_all", fake_fetch_all)

    report = await service.get_report(year=2026, month=4)

    await esi.close()

    assert report["meta"]["pilotCount"] == 1
    assert report["meta"]["snapshotCount"] == 5
    assert report["summary"][0]["characterId"] == 10
    assert report["summary"][0]["activeDays"] == 2
    assert report["summary"][0]["activeDaysMask"] == 6
    assert report["summary"][0]["estimatedMinutes"] == 135
    assert report["summary"][0]["estimatedHours"] == 2.2


@pytest.mark.asyncio
async def test_activity_report_uses_interval_minutes_when_monthly_is_stale(monkeypatch: pytest.MonkeyPatch) -> None:
    esi = ESIClient("https://esi.test")
    service = ActivityService(esi)

    async def fake_fetch_all(sql: str, params: list) -> list[dict]:
        if "FROM corpActivityMonthly" in sql:
            assert params == [2026, 5]
            return [
                {
                    "characterId": 11,
                    "characterName": "Pilot E",
                    "activeDaysMask": 1 << 2,
                    "estimatedMinutes": 60,
                    "status": "online",
                    "lastLogin": datetime(2026, 5, 3, 10, 0),
                    "lastLogout": datetime(2026, 5, 3, 9, 0),
                    "locationId": 6007,
                    "shipTypeId": 117,
                    "shipName": "Ishtar",
                    "startDate": datetime(2024, 1, 15, 12, 0),
                    "snapshotCount": 2,
                    "lastSnapshotAt": datetime(2026, 5, 3, 11, 0),
                },
                {
                    "characterId": 12,
                    "characterName": "Pilot F",
                    "activeDaysMask": 1 << 1,
                    "estimatedMinutes": 600,
                    "status": "offline",
                    "lastLogin": datetime(2026, 5, 2, 8, 0),
                    "lastLogout": datetime(2026, 5, 2, 18, 0),
                    "locationId": 6008,
                    "shipTypeId": 118,
                    "shipName": "Cerberus",
                    "startDate": datetime(2024, 1, 15, 12, 0),
                    "snapshotCount": 1,
                    "lastSnapshotAt": datetime(2026, 5, 2, 18, 0),
                }
            ]
        if "FROM corpActivityIntervals" in sql:
            assert params == [2026, 5, "2026-05-01", "2026-05-01"]
            return [
                {
                    "characterId": 11,
                    "characterName": "Pilot E",
                    "intervalStart": datetime(2026, 5, 3, 10, 0),
                    "intervalEnd": datetime(2026, 5, 3, 11, 0),
                    "sourceSnapshotAt": datetime(2026, 5, 3, 11, 0),
                    "status": "online",
                    "lastLogin": datetime(2026, 5, 3, 10, 0),
                    "lastLogout": datetime(2026, 5, 3, 9, 0),
                    "locationId": 6007,
                    "shipTypeId": 117,
                    "shipName": "Ishtar",
                    "startDate": datetime(2024, 1, 15, 12, 0),
                    "snapshotCount": 2,
                    "lastSnapshotAt": datetime(2026, 5, 3, 11, 0),
                },
                {
                    "characterId": 11,
                    "characterName": "Pilot E",
                    "intervalStart": datetime(2026, 5, 3, 11, 0),
                    "intervalEnd": datetime(2026, 5, 3, 13, 0),
                    "sourceSnapshotAt": datetime(2026, 5, 3, 13, 0),
                    "status": "online",
                    "lastLogin": datetime(2026, 5, 3, 10, 0),
                    "lastLogout": datetime(2026, 5, 3, 9, 0),
                    "locationId": 6007,
                    "shipTypeId": 117,
                    "shipName": "Ishtar",
                    "startDate": datetime(2024, 1, 15, 12, 0),
                    "snapshotCount": 2,
                    "lastSnapshotAt": datetime(2026, 5, 3, 13, 0),
                },
            ]
        raise AssertionError("raw snapshot fallback should not be used when interval rows exist")

    monkeypatch.setattr("py_backend.db.fetch_all", fake_fetch_all)

    report = await service.get_report(year=2026, month=5)

    await esi.close()

    by_character_id = {item["characterId"]: item for item in report["summary"]}
    assert by_character_id[11]["estimatedMinutes"] == 180
    assert by_character_id[11]["estimatedHours"] == 3.0
    assert by_character_id[11]["activeDays"] == 1
    assert by_character_id[12]["estimatedMinutes"] == 600


@pytest.mark.asyncio
async def test_activity_report_counts_online_snapshot_until_snapshot_time(monkeypatch: pytest.MonkeyPatch) -> None:
    esi = ESIClient("https://esi.test")
    service = ActivityService(esi)

    class FixedDatetime(datetime):
        @classmethod
        def now(cls, tz=None):
            current = cls(2026, 4, 30, 18, 0, 0)
            if tz is not None:
                return current.replace(tzinfo=tz)
            return current

    async def fake_fetch_all(sql: str, params: list) -> list[dict]:
        if "FROM corpActivityMonthly" in sql:
            assert params == [2026, 4]
            return []
        assert params == ["2026-04-01", "2026-04-01"]
        return [
            {
                "snapshotAt": datetime(2026, 4, 30, 18, 0),
                "characterId": 11,
                "characterName": "Sly Maximus",
                "isOnline": 1,
                "logonDate": datetime(2026, 4, 30, 10, 0),
                "logoffDate": datetime(2026, 4, 30, 9, 0),
                "locationId": 30000250,
                "shipTypeId": 626,
                "shipName": "Vexor",
                "startDate": datetime(2025, 8, 7, 19, 26),
            }
        ]

    monkeypatch.setattr("py_backend.db.fetch_all", fake_fetch_all)
    monkeypatch.setattr("py_backend.services.activity.datetime", FixedDatetime)

    report = await service.get_report(year=2026, month=4)

    await esi.close()

    assert report["summary"][0]["status"] == "online"
    assert report["summary"][0]["activeDays"] == 1
    assert report["summary"][0]["estimatedMinutes"] == 480
    assert report["summary"][0]["estimatedHours"] == 8.0


@pytest.mark.asyncio
async def test_activity_sync_stores_rows_and_names(monkeypatch: pytest.MonkeyPatch) -> None:
    esi = ESIClient("https://esi.test")
    service = ActivityService(esi)

    class FakeResponse:
        status_code = 200
        reason_phrase = "OK"
        text = "OK"

        def json(self) -> list[dict]:
            return [
                {
                    "character_id": 11,
                    "logon_date": "2026-04-24T07:00:00Z",
                    "logoff_date": "2026-04-24T08:00:00Z",
                    "location_id": 6001,
                    "ship_type_id": 222,
                    "start_date": "2025-01-01T00:00:00Z",
                }
            ]

    captured: dict[str, object] = {}

    async def fake_get(path: str, token: str | None = None, params: dict | None = None):
        captured["path"] = path
        captured["token"] = token
        captured["params"] = params
        return FakeResponse()

    async def fake_sync_names(items: list[dict], access_token: str) -> int:
        captured["name_ids"] = [item["character_id"] for item in items]
        captured["name_token"] = access_token
        return 1

    async def fake_store(items: list[dict], snapshot_at: datetime) -> int:
        captured["store_count"] = len(items)
        captured["stored_items"] = items
        captured["snapshot_at"] = snapshot_at
        return len(items)

    async def fake_update(items: list[dict], snapshot_at: datetime, snapshot_is_current: bool = True) -> int:
        captured["activity_items"] = items
        captured["activity_snapshot"] = snapshot_at
        captured["activity_snapshot_is_current"] = snapshot_is_current
        return 1

    async def fake_prune(snapshot_at: datetime) -> int:
        captured["prune_snapshot"] = snapshot_at
        return 0

    monkeypatch.setattr(service._esi, "get", fake_get)
    monkeypatch.setattr(service, "sync_names", fake_sync_names)
    monkeypatch.setattr(service, "store", fake_store)
    monkeypatch.setattr(service, "update_monthly_activity", fake_update)
    monkeypatch.setattr("py_backend.services.activity.prune_activity_history", fake_prune)

    count = await service.sync(corporation_id=98652228, access_token="ceo-token", snapshot_at=datetime(2026, 4, 24, 8, 45))

    await esi.close()

    assert count == 1
    assert captured["path"] == "/corporations/98652228/membertracking/"
    assert captured["token"] == "ceo-token"
    assert captured["params"] == {"datasource": "tranquility"}
    assert captured["name_ids"] == [11]
    assert captured["name_token"] == "ceo-token"
    assert captured["store_count"] == 1
    assert captured["activity_items"] == captured["stored_items"]
    assert captured["activity_snapshot"] == datetime(2026, 4, 24, 8, 45)
    assert captured["activity_snapshot_is_current"] is True
    assert captured["prune_snapshot"] == datetime(2026, 4, 24, 8, 45)


@pytest.mark.asyncio
async def test_activity_sync_skips_unexpected_esi_payload(monkeypatch: pytest.MonkeyPatch) -> None:
    esi = ESIClient("https://esi.test")
    service = ActivityService(esi)

    class FakeResponse:
        status_code = 200
        reason_phrase = "OK"
        text = "OK"
        headers = {"Last-Modified": "Fri, 24 Apr 2026 08:45:31 GMT"}

        def json(self) -> dict:
            return {"error": "temporary bad payload"}

    async def fake_get(path: str, token: str | None = None, params: dict | None = None):
        return FakeResponse()

    async def fail_if_called(*args, **kwargs):
        raise AssertionError("activity sync should not store or aggregate invalid ESI payloads")

    monkeypatch.setattr(service._esi, "get", fake_get)
    monkeypatch.setattr(service, "sync_names", fail_if_called)
    monkeypatch.setattr(service, "store", fail_if_called)
    monkeypatch.setattr(service, "update_monthly_activity", fail_if_called)

    count = await service.sync(corporation_id=98652228, access_token="ceo-token")

    await esi.close()

    assert count == 0


def test_activity_snapshot_prefers_esi_last_modified_header() -> None:
    class FakeResponse:
        headers = {"Last-Modified": "Fri, 24 Apr 2026 08:45:31 GMT"}

    assert _response_snapshot_at(FakeResponse(), datetime(2026, 4, 24, 9, 10)) == datetime(2026, 4, 24, 8, 45)


@pytest.mark.asyncio
async def test_activity_sync_names_only_fetches_missing_names(monkeypatch: pytest.MonkeyPatch) -> None:
    esi = ESIClient("https://esi.test")
    service = ActivityService(esi)
    captured: dict[str, object] = {}

    class FakeResponse:
        status_code = 200
        reason_phrase = "OK"
        text = "OK"

        def json(self) -> list[dict]:
            return [{"id": 12, "name": "New Pilot", "category": "character"}]

    async def fake_fetch_all(sql: str, params: list) -> list[dict]:
        captured["lookup_params"] = params
        return [{"ID": 11}]

    async def fake_post(path: str, token: str | None = None, json: list[int] | None = None):
        captured["path"] = path
        captured["token"] = token
        captured["json"] = json
        return FakeResponse()

    async def fake_store_names(items: list[dict]) -> int:
        captured["stored_names"] = items
        return len(items)

    monkeypatch.setattr("py_backend.db.fetch_all", fake_fetch_all)
    monkeypatch.setattr(service._esi, "post", fake_post)
    monkeypatch.setattr(service, "store_names", fake_store_names)

    count = await service.sync_names([{"character_id": 11}, {"character_id": 12}], "ceo-token")

    await esi.close()

    assert count == 1
    assert captured["lookup_params"] == [11, 12]
    assert captured["path"] == "/universe/names/"
    assert captured["token"] == "ceo-token"
    assert captured["json"] == [12]


def test_incremental_activity_extends_online_interval_between_snapshots() -> None:
    item = {
        "character_id": 11,
        "logon_date": "2026-04-24T10:00:00Z",
        "logoff_date": "2026-04-24T09:00:00Z",
    }

    updates, state, intervals = _build_incremental_activity_updates(item, datetime(2026, 4, 24, 12, 0))
    assert updates[0]["estimatedMinutes"] == 120
    assert updates[0]["snapshotCount"] == 1
    assert intervals[0]["intervalStart"] == datetime(2026, 4, 24, 10, 0)
    assert intervals[0]["intervalEnd"] == datetime(2026, 4, 24, 12, 0)
    assert intervals[0]["sourceKind"] == "online"
    assert state["lastCountedUntil"] == datetime(2026, 4, 24, 12, 0)

    closed_item = {
        "character_id": 11,
        "logon_date": "2026-04-24T10:00:00Z",
        "logoff_date": "2026-04-24T13:00:00Z",
    }

    updates, state, intervals = _build_incremental_activity_updates(closed_item, datetime(2026, 4, 24, 14, 0), state)
    assert updates[0]["estimatedMinutes"] == 60
    assert intervals[0]["intervalStart"] == datetime(2026, 4, 24, 12, 0)
    assert intervals[0]["intervalEnd"] == datetime(2026, 4, 24, 13, 0)
    assert intervals[0]["sourceKind"] == "closed"
    assert state["lastCountedUntil"] == datetime(2026, 4, 24, 13, 0)


def test_incremental_activity_skips_repeated_stale_snapshot() -> None:
    state = {
        "lastLogonDate": datetime(2026, 4, 24, 10, 0),
        "lastLogoffDate": datetime(2026, 4, 24, 9, 0),
        "lastCountedUntil": datetime(2026, 4, 24, 12, 0),
        "lastSnapshotAt": datetime(2026, 4, 24, 12, 0),
    }
    item = {
        "character_id": 11,
        "logon_date": "2026-04-24T10:00:00Z",
        "logoff_date": "2026-04-24T09:00:00Z",
    }

    updates, new_state, intervals = _build_incremental_activity_updates(item, datetime(2026, 4, 24, 12, 0), state)

    assert updates == []
    assert intervals == []
    assert new_state == state


def test_incremental_activity_does_not_extend_online_without_current_snapshot_time() -> None:
    state = {
        "lastLogonDate": datetime(2026, 4, 24, 10, 0),
        "lastLogoffDate": datetime(2026, 4, 24, 9, 0),
        "lastCountedUntil": datetime(2026, 4, 24, 12, 0),
        "lastSnapshotAt": datetime(2026, 4, 24, 12, 0),
    }
    item = {
        "character_id": 11,
        "logon_date": "2026-04-24T10:00:00Z",
        "logoff_date": "2026-04-24T09:00:00Z",
    }

    updates, new_state, intervals = _build_incremental_activity_updates(
        item,
        datetime(2026, 4, 24, 13, 0),
        state,
        snapshot_is_current=False,
    )

    assert updates == []
    assert intervals == []
    assert new_state == state


def test_incremental_activity_counts_first_closed_session_exactly() -> None:
    item = {
        "character_id": 11,
        "logon_date": "2026-04-24T08:00:00Z",
        "logoff_date": "2026-04-24T09:45:00Z",
    }

    updates, state, intervals = _build_incremental_activity_updates(item, datetime(2026, 4, 24, 12, 45))

    assert updates[0]["estimatedMinutes"] == 105
    assert updates[0]["status"] == "offline"
    assert updates[0]["activeDaysMask"] == 1 << 23
    assert intervals[0]["intervalStart"] == datetime(2026, 4, 24, 8, 0)
    assert intervals[0]["intervalEnd"] == datetime(2026, 4, 24, 9, 45)
    assert state["lastCountedUntil"] == datetime(2026, 4, 24, 9, 45)


def test_incremental_activity_logout_closes_remaining_interval() -> None:
    state = {
        "lastLogonDate": datetime(2026, 4, 24, 8, 0),
        "lastLogoffDate": datetime(2026, 4, 24, 7, 0),
        "lastCountedUntil": datetime(2026, 4, 24, 9, 15),
    }
    item = {
        "character_id": 11,
        "logon_date": "2026-04-24T08:00:00Z",
        "logoff_date": "2026-04-24T09:45:00Z",
    }

    updates, state, intervals = _build_incremental_activity_updates(item, datetime(2026, 4, 24, 12, 45), state)

    assert updates[0]["estimatedMinutes"] == 30
    assert updates[0]["status"] == "offline"
    assert updates[0]["lastLogout"] == datetime(2026, 4, 24, 9, 45)
    assert intervals[0]["intervalStart"] == datetime(2026, 4, 24, 9, 15)
    assert intervals[0]["intervalEnd"] == datetime(2026, 4, 24, 9, 45)
    assert state["lastCountedUntil"] == datetime(2026, 4, 24, 9, 45)


def test_incremental_activity_splits_month_boundary() -> None:
    state = {
        "lastLogonDate": datetime(2026, 4, 30, 22, 0),
        "lastLogoffDate": datetime(2026, 4, 30, 21, 0),
        "lastCountedUntil": datetime(2026, 4, 30, 23, 30),
        "lastSnapshotAt": datetime(2026, 4, 30, 23, 30),
    }
    item = {
        "character_id": 11,
        "logon_date": "2026-04-30T22:00:00Z",
        "logoff_date": "2026-05-01T00:30:00Z",
    }

    updates, state, intervals = _build_incremental_activity_updates(item, datetime(2026, 5, 1, 1, 0), state)
    by_month = {(update["year"], update["month"]): update for update in updates}

    assert by_month[(2026, 4)]["estimatedMinutes"] == 30
    assert by_month[(2026, 5)]["estimatedMinutes"] == 30
    assert by_month[(2026, 5)]["snapshotCount"] == 1
    assert intervals[0]["intervalStart"] == datetime(2026, 4, 30, 23, 30)
    assert intervals[0]["intervalEnd"] == datetime(2026, 5, 1, 0, 30)
    assert state["lastCountedUntil"] == datetime(2026, 5, 1, 0, 30)


def test_incremental_activity_new_session_after_logout_counts_from_new_logon() -> None:
    state = {
        "lastLogonDate": datetime(2026, 4, 24, 8, 0),
        "lastLogoffDate": datetime(2026, 4, 24, 9, 45),
        "lastCountedUntil": datetime(2026, 4, 24, 9, 45),
        "lastSnapshotAt": datetime(2026, 4, 24, 10, 45),
    }
    item = {
        "character_id": 11,
        "logon_date": "2026-04-24T11:00:00Z",
        "logoff_date": "2026-04-24T10:30:00Z",
    }

    updates, state, intervals = _build_incremental_activity_updates(item, datetime(2026, 4, 24, 11, 45), state)

    assert updates[0]["estimatedMinutes"] == 45
    assert updates[0]["status"] == "online"
    assert intervals[0]["intervalStart"] == datetime(2026, 4, 24, 11, 0)
    assert intervals[0]["intervalEnd"] == datetime(2026, 4, 24, 11, 45)
    assert state["lastCountedUntil"] == datetime(2026, 4, 24, 11, 45)
