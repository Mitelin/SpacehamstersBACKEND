from __future__ import annotations

import asyncio
import json
import subprocess
import tempfile
from datetime import datetime, timezone
from decimal import Decimal
from pathlib import Path
from typing import Any

from .. import db
from ..settings import Settings

TAX_LEDGER_START = (2026, 8)
TAX_PAYMENT_AMOUNTS = {Decimal("250000000"), Decimal("500000000")}


def _parse_datetime(value: Any) -> datetime | None:
    if isinstance(value, datetime):
        return value
    if not value:
        return None
    try:
        return datetime.fromisoformat(str(value).replace("Z", "+00:00")).replace(tzinfo=None)
    except ValueError:
        return None


def _merged_minutes(intervals: list[tuple[datetime, datetime]]) -> int:
    if not intervals:
        return 0
    ordered = sorted(intervals)
    merged: list[tuple[datetime, datetime]] = [ordered[0]]
    for start, end in ordered[1:]:
        previous_start, previous_end = merged[-1]
        if start <= previous_end:
            merged[-1] = (previous_start, max(previous_end, end))
        else:
            merged.append((start, end))
    return int(round(sum((end - start).total_seconds() for start, end in merged) / 60.0))


def _iter_months(start: tuple[int, int], end: tuple[int, int]) -> list[tuple[int, int]]:
    months: list[tuple[int, int]] = []
    year, month = start
    while (year, month) <= end:
        months.append((year, month))
        month = month + 1
        if month == 13:
            year, month = year + 1, 1
    return months


def allocate_tax_payments_fifo(
    reports: list[dict[str, Any]],
    identities: list[dict[str, Any]],
    payments: list[dict[str, Any]],
) -> None:
    identity_by_character = {int(row["characterId"]): row for row in identities}
    obligations: dict[str, list[dict[str, Any]]] = {}

    for report in reports:
        for row in report.get("summary", []):
            auth_user_id = row.get("authUserId")
            if auth_user_id is not None:
                obligations.setdefault(f"auth:{auth_user_id}", []).append(row)
            else:
                for character_id in row.get("characterIds", []):
                    obligations.setdefault(f"character:{character_id}", []).append(row)
            row["paidAmount"] = 0.0
            row["remainingAmount"] = float(row.get("requiredAmount") or 0)
            row["lastPaymentAt"] = None
            row["payments"] = 0

    ordered_payments = sorted(
        payments,
        key=lambda payment: (_parse_datetime(payment.get("date")) or datetime.min, int(payment.get("id") or 0)),
    )
    for payment in ordered_payments:
        payment_date = _parse_datetime(payment.get("date"))
        if payment_date is None or payment_date < datetime(*TAX_LEDGER_START, 1):
            continue
        character_id = int(payment["characterId"])
        identity = identity_by_character.get(character_id)
        key = f"auth:{identity['authUserId']}" if identity else f"character:{character_id}"
        remaining_payment = Decimal(str(payment.get("amount") or 0))
        if remaining_payment not in TAX_PAYMENT_AMOUNTS:
            continue

        for row in obligations.get(key, []):
            required = Decimal(str(row.get("requiredAmount") or 0))
            already_paid = Decimal(str(row.get("paidAmount") or 0))
            remaining_due = max(required - already_paid, Decimal(0))
            if remaining_due <= 0:
                continue
            allocated = min(remaining_payment, remaining_due)
            row["paidAmount"] = float(already_paid + allocated)
            row["remainingAmount"] = float(remaining_due - allocated)
            row["payments"] = int(row.get("payments") or 0) + 1
            row["lastPaymentAt"] = payment_date.isoformat(sep=" ")
            remaining_payment -= allocated
            if remaining_payment <= 0:
                break

    for report in reports:
        month_end = _parse_datetime(report.get("meta", {}).get("monthEnd"))
        for row in report.get("summary", []):
            if row.get("status") in {"exempt", "unmapped"}:
                continue
            required = Decimal(str(row.get("requiredAmount") or 0))
            paid = Decimal(str(row.get("paidAmount") or 0))
            if paid >= required:
                paid_at = _parse_datetime(row.get("lastPaymentAt"))
                row["status"] = "paid_late" if month_end and paid_at and paid_at >= month_end else "paid"
            elif paid > 0:
                row["status"] = "partial"
            else:
                row["status"] = "unpaid"


def build_tax_report(
    members: list[dict[str, Any]],
    identities: list[dict[str, Any]],
    intervals: list[dict[str, Any]],
    payments: list[dict[str, Any]],
    *,
    year: int,
    month: int,
    required_amount: int = 250_000_000,
    activity_threshold_hours: float = 10.0,
    membership_threshold_days: int = 62,
    as_of: datetime | None = None,
) -> dict[str, Any]:
    month_start = datetime(int(year), int(month), 1)
    month_end = datetime(int(year) + 1, 1, 1) if int(month) == 12 else datetime(int(year), int(month) + 1, 1)
    evaluation_at = min(as_of or datetime.now(timezone.utc).replace(tzinfo=None), month_end)
    identity_by_character = {int(row["characterId"]): row for row in identities}
    people: dict[str, dict[str, Any]] = {}

    def person_for(character_id: int, character_name: str = "") -> dict[str, Any]:
        identity = identity_by_character.get(character_id)
        auth_user_id = identity.get("authUserId") if identity else None
        key = f"auth:{auth_user_id}" if auth_user_id is not None else f"character:{character_id}"
        if key not in people:
            people[key] = {
                "authUserId": auth_user_id,
                "mainCharacterId": identity.get("mainCharacterId") if identity else None,
                "mainCharacterName": identity.get("mainCharacterName") if identity else character_name,
                "characters": [],
                "characterIds": set(),
                "fallbackMinutes": [],
                "intervals": [],
                "payments": [],
                "membershipStartDates": [],
                "mapped": identity is not None,
            }
        return people[key]

    for member in members:
        character_id = int(member["characterId"])
        character_name = str(member.get("characterName") or character_id)
        person = person_for(character_id, character_name)
        if character_id not in person["characterIds"]:
            person["characterIds"].add(character_id)
            person["characters"].append(character_name)
        person["fallbackMinutes"].append(int(member.get("estimatedMinutes") or 0))
        membership_start = _parse_datetime(member.get("startDate"))
        if membership_start is not None:
            person["membershipStartDates"].append(membership_start)

    for interval in intervals:
        character_id = int(interval["characterId"])
        identity = identity_by_character.get(character_id)
        if identity is None:
            person = people.get(f"character:{character_id}")
        else:
            person = people.get(f"auth:{identity.get('authUserId')}")
        start = _parse_datetime(interval.get("intervalStart"))
        end = _parse_datetime(interval.get("intervalEnd"))
        if person is not None and start is not None and end is not None and end > start:
            clipped_start = max(start, month_start)
            clipped_end = min(end, month_end)
            if clipped_end > clipped_start:
                person["intervals"].append((clipped_start, clipped_end))

    for payment in payments:
        if Decimal(str(payment.get("amount") or 0)) not in TAX_PAYMENT_AMOUNTS:
            continue
        character_id = int(payment["characterId"])
        identity = identity_by_character.get(character_id)
        if identity is None:
            person = people.get(f"character:{character_id}")
        else:
            person = people.get(f"auth:{identity.get('authUserId')}")
        if person is not None:
            person["payments"].append(payment)

    summary: list[dict[str, Any]] = []
    threshold_minutes = int(round(float(activity_threshold_hours) * 60))
    for person in people.values():
        has_intervals = bool(person["intervals"])
        activity_minutes = (
            _merged_minutes(person["intervals"])
            if has_intervals
            else max(person["fallbackMinutes"], default=0)
        )
        paid_amount = sum(Decimal(str(payment.get("amount") or 0)) for payment in person["payments"])
        membership_days = max(
            (max(0, (evaluation_at - start).days) for start in person["membershipStartDates"]),
            default=None,
        )
        activity_exempt = activity_minutes < threshold_minutes
        membership_exempt = membership_days is not None and membership_days <= int(membership_threshold_days)
        exemption_reasons = []
        if activity_exempt:
            exemption_reasons.append("low_activity")
        if membership_exempt:
            exemption_reasons.append("short_membership")
        exempt = bool(exemption_reasons)
        amount_due = Decimal(0 if exempt else required_amount)
        remaining = max(amount_due - paid_amount, Decimal(0))

        if not person["mapped"]:
            status = "unmapped"
        elif exempt:
            status = "exempt"
        elif paid_amount >= amount_due:
            status = "paid"
        elif paid_amount > 0:
            status = "partial"
        else:
            status = "unpaid"

        payment_dates = [
            parsed
            for parsed in (_parse_datetime(payment.get("date")) for payment in person["payments"])
            if parsed is not None
        ]
        summary.append(
            {
                "authUserId": person["authUserId"],
                "mainCharacterId": person["mainCharacterId"],
                "mainCharacterName": person["mainCharacterName"],
                "characters": sorted(person["characters"]),
                "characterIds": sorted(person["characterIds"]),
                "activityMinutes": activity_minutes,
                "activityHours": round(activity_minutes / 60.0, 1),
                "activitySource": "intervals" if has_intervals else "monthly_estimate",
                "corporationTenureDays": membership_days,
                "exemptionReasons": exemption_reasons,
                "requiredAmount": float(amount_due),
                "paidAmount": float(paid_amount),
                "remainingAmount": float(remaining),
                "status": status,
                "lastPaymentAt": max(payment_dates).isoformat(sep=" ") if payment_dates else None,
                "payments": len(person["payments"]),
            }
        )

    summary.sort(key=lambda row: (str(row["status"]), str(row["mainCharacterName"]).casefold()))
    return {
        "summary": summary,
        "meta": {
            "year": int(year),
            "month": int(month),
            "requiredAmount": int(required_amount),
            "activityThresholdHours": float(activity_threshold_hours),
            "membershipThresholdDays": int(membership_threshold_days),
            "evaluatedAt": evaluation_at.isoformat(sep=" "),
            "monthEnd": month_end.isoformat(sep=" "),
            "peopleCount": len(summary),
            "unmappedCount": sum(1 for row in summary if row["status"] == "unmapped"),
        },
    }


class TaxService:
    def __init__(self, settings: Settings):
        self._settings = settings
        self._identity_lock = asyncio.Lock()

    async def sync_identities(self, corporation_id: int) -> int:
        project = self._settings.alliance_auth_project
        python = self._settings.alliance_auth_python
        if not project or not python:
            raise RuntimeError("Alliance Auth identity export is not configured")

        exporter = Path(__file__).resolve().parents[2] / "tools" / "export_alliance_auth_identities.py"
        if not exporter.is_file():
            raise RuntimeError(f"Alliance Auth exporter missing: {exporter}")

        async with self._identity_lock:
            with tempfile.TemporaryDirectory(prefix="eve-tax-identities-") as temp_dir:
                output_path = Path(temp_dir) / "identities.json"
                command = [
                    python,
                    str(exporter),
                    "--project",
                    project,
                    "--settings",
                    self._settings.alliance_auth_settings_module,
                    "--corporation-id",
                    str(int(corporation_id)),
                    "--output",
                    str(output_path),
                ]
                result = await asyncio.to_thread(
                    subprocess.run,
                    command,
                    capture_output=True,
                    text=True,
                    timeout=120,
                    check=False,
                )
                if result.returncode != 0:
                    detail = (result.stderr or result.stdout or "unknown error").strip()[-1000:]
                    raise RuntimeError(f"Alliance Auth identity export failed: {detail}")
                payload = json.loads(output_path.read_text(encoding="utf-8"))

            rows = list(payload.get("identities") or [])
            if not rows:
                raise RuntimeError("Alliance Auth identity export returned no identities")
            synced_at = _parse_datetime(payload.get("syncedAt")) or datetime.utcnow()

            async with db.connection() as conn:
                async with conn.cursor() as cur:
                    await conn.begin()
                    try:
                        await cur.execute("DELETE FROM corpTaxIdentity")
                        for row in rows:
                            await cur.execute(
                                """
                                INSERT INTO corpTaxIdentity (
                                    characterID, characterName, authUserID, mainCharacterID,
                                    mainCharacterName, corporationID, isCurrentCorpMember, syncedAt
                                ) VALUES (%s,%s,%s,%s,%s,%s,%s,%s)
                                """,
                                [
                                    int(row["characterId"]),
                                    str(row["characterName"]),
                                    int(row["authUserId"]),
                                    int(row["mainCharacterId"]),
                                    str(row["mainCharacterName"]),
                                    int(row["corporationId"]) if row.get("corporationId") is not None else None,
                                    1 if row.get("isCurrentCorpMember") else 0,
                                    synced_at,
                                ],
                            )
                        await conn.commit()
                    except Exception:
                        await conn.rollback()
                        raise
            return len(rows)

    async def get_report(
        self,
        wallet: int,
        year: int,
        month: int,
        required_amount: int = 250_000_000,
        activity_threshold_hours: float = 10.0,
    ) -> dict[str, Any]:
        y = int(year)
        m = int(month)
        if y < 2021 or y > 2100 or m < 1 or m > 12:
            raise RuntimeError("Invalid tax report period")
        requested_period = (y, m)
        if requested_period < TAX_LEDGER_START:
            return {
                "summary": [],
                "meta": {
                    "year": y,
                    "month": m,
                    "wallet": int(wallet),
                    "taxLedgerStart": "2026-08",
                    "peopleCount": 0,
                    "unmappedCount": 0,
                },
            }

        periods = _iter_months(TAX_LEDGER_START, requested_period)
        first_month = f"{TAX_LEDGER_START[0]:04d}-{TAX_LEDGER_START[1]:02d}-01"
        requested_month = f"{y:04d}-{m:02d}-01"
        now = datetime.now(timezone.utc).replace(tzinfo=None)

        members = await db.fetch_all(
            """
            SELECT m.year, m.month, m.characterID AS characterId,
                   COALESCE(cn.name, CAST(m.characterID AS CHAR)) AS characterName,
                   m.estimatedMinutes, m.startDate
            FROM corpActivityMonthly m
            LEFT JOIN corpNames cn ON cn.ID = m.characterID
            WHERE (m.year * 100 + m.month) BETWEEN %s AND %s
            """,
            [TAX_LEDGER_START[0] * 100 + TAX_LEDGER_START[1], y * 100 + m],
        )
        identities = await db.fetch_all(
            """
            SELECT characterID AS characterId, characterName, authUserID AS authUserId,
                   mainCharacterID AS mainCharacterId, mainCharacterName,
                   corporationID AS corporationId, isCurrentCorpMember
            FROM corpTaxIdentity
            """
        )
        intervals = await db.fetch_all(
            """
            SELECT characterID AS characterId, intervalStart, intervalEnd
            FROM corpActivityIntervals
            WHERE intervalStart < DATE_ADD(%s, INTERVAL 1 MONTH) AND intervalEnd > %s
            """,
            [requested_month, first_month],
        )
        payments = await db.fetch_all(
            """
            SELECT id, firstPartyID AS characterId, amount, date
            FROM corpWalletJournal
                        WHERE wallet = %s AND refType = 'player_donation' AND amount IN (%s, %s)
              AND date >= %s AND date <= %s
            ORDER BY date, id
            """,
                        [int(wallet), 250_000_000, 500_000_000, first_month, now],
        )

        reports: list[dict[str, Any]] = []
        for report_year, report_month in periods:
            report_start = datetime(report_year, report_month, 1)
            report_end = (
                datetime(report_year + 1, 1, 1)
                if report_month == 12
                else datetime(report_year, report_month + 1, 1)
            )
            report = build_tax_report(
                [
                    row
                    for row in members
                    if int(row.get("year") or 0) == report_year and int(row.get("month") or 0) == report_month
                ],
                identities,
                [
                    row
                    for row in intervals
                    if (_parse_datetime(row.get("intervalStart")) or datetime.max) < report_end
                    and (_parse_datetime(row.get("intervalEnd")) or datetime.min) > report_start
                ],
                [],
                year=report_year,
                month=report_month,
                required_amount=int(required_amount),
                activity_threshold_hours=float(activity_threshold_hours),
                as_of=now,
            )
            reports.append(report)

        allocate_tax_payments_fifo(reports, identities, payments)
        report = reports[-1]
        report["meta"]["wallet"] = int(wallet)
        report["meta"]["taxLedgerStart"] = "2026-08"
        return report