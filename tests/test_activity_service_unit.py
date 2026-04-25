from __future__ import annotations

from datetime import datetime

import pytest

from py_backend.esi import ESIClient
from py_backend.services.activity import ActivityService


@pytest.mark.asyncio
async def test_activity_report_aggregates_month_rows(monkeypatch: pytest.MonkeyPatch) -> None:
    esi = ESIClient("https://esi.test")
    service = ActivityService(esi)

    async def fake_fetch_all(sql: str, params: list) -> list[dict]:
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
        captured["snapshot_at"] = snapshot_at
        return len(items)

    monkeypatch.setattr(service._esi, "get", fake_get)
    monkeypatch.setattr(service, "sync_names", fake_sync_names)
    monkeypatch.setattr(service, "store", fake_store)

    count = await service.sync(corporation_id=98652228, access_token="ceo-token", snapshot_at=datetime(2026, 4, 24, 8, 45))

    await esi.close()

    assert count == 1
    assert captured["path"] == "/corporations/98652228/membertracking/"
    assert captured["token"] == "ceo-token"
    assert captured["params"] == {"datasource": "tranquility"}
    assert captured["name_ids"] == [11]
    assert captured["name_token"] == "ceo-token"
    assert captured["store_count"] == 1