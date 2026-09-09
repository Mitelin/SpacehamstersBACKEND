from datetime import datetime

import pytest

from py_backend.services.taxes import TaxService, allocate_tax_payments_fifo, build_tax_report


def test_tax_report_groups_alts_and_deduplicates_overlapping_activity() -> None:
    identities = [
        {
            "authUserId": 51,
            "mainCharacterId": 100,
            "mainCharacterName": "Main Pilot",
            "characterId": 100,
        },
        {
            "authUserId": 51,
            "mainCharacterId": 100,
            "mainCharacterName": "Main Pilot",
            "characterId": 101,
        },
    ]
    members = [
        {"characterId": 100, "characterName": "Main Pilot", "estimatedMinutes": 480},
        {"characterId": 101, "characterName": "Industry Alt", "estimatedMinutes": 360},
    ]
    intervals = [
        {
            "characterId": 100,
            "intervalStart": datetime(2026, 8, 1, 8),
            "intervalEnd": datetime(2026, 8, 1, 16),
        },
        {
            "characterId": 101,
            "intervalStart": datetime(2026, 8, 1, 12),
            "intervalEnd": datetime(2026, 8, 1, 18),
        },
    ]
    payments = [
        {"characterId": 101, "amount": 250_000_000, "date": "2026-08-06T10:00:00Z"},
    ]

    report = build_tax_report(
        members,
        identities,
        intervals,
        payments,
        year=2026,
        month=8,
    )

    assert report["meta"]["peopleCount"] == 1
    assert report["summary"] == [
        {
            "authUserId": 51,
            "mainCharacterId": 100,
            "mainCharacterName": "Main Pilot",
            "characters": ["Industry Alt", "Main Pilot"],
            "characterIds": [100, 101],
            "activityMinutes": 600,
            "activityHours": 10.0,
            "activitySource": "intervals",
            "corporationTenureDays": None,
            "exemptionReasons": [],
            "requiredAmount": 250_000_000.0,
            "paidAmount": 250_000_000.0,
            "remainingAmount": 0.0,
            "status": "paid",
            "lastPaymentAt": "2026-08-06 10:00:00",
            "payments": 1,
        }
    ]


def test_tax_payments_are_allocated_oldest_debt_first() -> None:
    identities = [{"authUserId": 60, "characterId": 600}]
    august = build_tax_report(
        [{"characterId": 600, "characterName": "Pilot", "estimatedMinutes": 600}],
        identities,
        [],
        [],
        year=2026,
        month=8,
    )
    september = build_tax_report(
        [{"characterId": 600, "characterName": "Pilot", "estimatedMinutes": 600}],
        identities,
        [],
        [],
        year=2026,
        month=9,
        as_of=datetime(2026, 9, 10),
    )

    allocate_tax_payments_fifo(
        [august, september],
        identities,
        [
            {"id": 1, "characterId": 600, "amount": 300_000_000, "date": datetime(2026, 8, 31, 20)},
            {"id": 2, "characterId": 600, "amount": 500_000_000, "date": datetime(2026, 9, 2, 10)},
        ],
    )

    august_row = august["summary"][0]
    september_row = september["summary"][0]
    assert august_row["paidAmount"] == 250_000_000.0
    assert august_row["payments"] == 1
    assert august_row["status"] == "paid_late"
    assert september_row["paidAmount"] == 250_000_000.0
    assert september_row["payments"] == 1
    assert september_row["status"] == "paid"


@pytest.mark.asyncio
async def test_tax_service_applies_september_payment_to_august_first(monkeypatch: pytest.MonkeyPatch) -> None:
    service = TaxService(None)  # type: ignore[arg-type]

    async def fake_fetch_all(sql: str, params: list | None = None) -> list[dict]:
        if "FROM corpActivityMonthly" in sql:
            assert params == [202608, 202609]
            return [
                {
                    "year": 2026,
                    "month": month,
                    "characterId": 700,
                    "characterName": "Pilot",
                    "estimatedMinutes": 600,
                    "startDate": datetime(2025, 1, 1),
                }
                for month in (8, 9)
            ]
        if "FROM corpTaxIdentity" in sql:
            return [
                {
                    "authUserId": 70,
                    "mainCharacterId": 700,
                    "mainCharacterName": "Pilot",
                    "characterId": 700,
                }
            ]
        if "FROM corpActivityIntervals" in sql:
            return []
        if "FROM corpWalletJournal" in sql:
            assert params is not None
            assert params[:4] == [1, 250_000_000, 500_000_000, "2026-08-01"]
            return [
                {
                    "id": 10,
                    "characterId": 700,
                    "amount": 250_000_000,
                    "date": datetime(2026, 9, 2, 10),
                }
            ]
        raise AssertionError(f"unexpected SQL: {sql}")

    monkeypatch.setattr("py_backend.db.fetch_all", fake_fetch_all)

    report = await service.get_report(wallet=1, year=2026, month=9)

    assert report["meta"]["taxLedgerStart"] == "2026-08"
    assert report["summary"][0]["paidAmount"] == 0.0
    assert report["summary"][0]["status"] == "unpaid"


def test_tax_report_exempts_person_below_ten_hours() -> None:
    report = build_tax_report(
        [{"characterId": 200, "characterName": "Quiet Main", "estimatedMinutes": 599}],
        [
            {
                "authUserId": 52,
                "mainCharacterId": 200,
                "mainCharacterName": "Quiet Main",
                "characterId": 200,
            }
        ],
        [],
        [],
        year=2026,
        month=8,
    )

    row = report["summary"][0]
    assert row["activityHours"] == 10.0
    assert row["requiredAmount"] == 0.0
    assert row["remainingAmount"] == 0.0
    assert row["status"] == "exempt"
    assert row["exemptionReasons"] == ["low_activity"]


def test_tax_report_exempts_person_without_character_over_62_days() -> None:
    report = build_tax_report(
        [
            {
                "characterId": 300,
                "characterName": "New Main",
                "estimatedMinutes": 900,
                "startDate": datetime(2026, 7, 1),
            }
        ],
        [
            {
                "authUserId": 53,
                "mainCharacterId": 300,
                "mainCharacterName": "New Main",
                "characterId": 300,
            }
        ],
        [],
        [],
        year=2026,
        month=8,
    )

    row = report["summary"][0]
    assert row["corporationTenureDays"] == 62
    assert row["exemptionReasons"] == ["short_membership"]
    assert row["requiredAmount"] == 0.0
    assert row["status"] == "exempt"


def test_tax_report_uses_longest_membership_across_alts() -> None:
    report = build_tax_report(
        [
            {
                "characterId": 400,
                "characterName": "New Main",
                "estimatedMinutes": 600,
                "startDate": datetime(2026, 8, 1),
            },
            {
                "characterId": 401,
                "characterName": "Old Alt",
                "estimatedMinutes": 600,
                "startDate": datetime(2026, 6, 1),
            },
        ],
        [
            {
                "authUserId": 54,
                "mainCharacterId": 400,
                "mainCharacterName": "New Main",
                "characterId": 400,
            },
            {
                "authUserId": 54,
                "mainCharacterId": 400,
                "mainCharacterName": "New Main",
                "characterId": 401,
            },
        ],
        [],
        [],
        year=2026,
        month=8,
    )

    row = report["summary"][0]
    assert row["corporationTenureDays"] == 92
    assert row["exemptionReasons"] == []
    assert row["requiredAmount"] == 250_000_000.0
    assert row["status"] == "unpaid"