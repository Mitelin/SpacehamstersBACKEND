from datetime import datetime

from py_backend.services.taxes import build_tax_report


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
        {"characterId": 100, "amount": 100_000_000, "date": "2026-08-05T10:00:00Z"},
        {"characterId": 101, "amount": 150_000_000, "date": "2026-08-06T10:00:00Z"},
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
            "payments": 2,
        }
    ]


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