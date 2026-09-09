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
        month_start = f"{y:04d}-{m:02d}-01"

        members = await db.fetch_all(
            """
            SELECT m.characterID AS characterId,
                   COALESCE(cn.name, CAST(m.characterID AS CHAR)) AS characterName,
                     m.estimatedMinutes, m.startDate
            FROM corpActivityMonthly m
            LEFT JOIN corpNames cn ON cn.ID = m.characterID
            WHERE m.year = %s AND m.month = %s
            """,
            [y, m],
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
            [month_start, month_start],
        )
        payments = await db.fetch_all(
            """
            SELECT firstPartyID AS characterId, amount, date
            FROM corpWalletJournal
            WHERE wallet = %s AND refType = 'player_donation' AND amount > 0
              AND date >= %s AND date < DATE_ADD(%s, INTERVAL 1 MONTH)
            """,
            [int(wallet), month_start, month_start],
        )
        report = build_tax_report(
            members,
            identities,
            intervals,
            payments,
            year=y,
            month=m,
            required_amount=int(required_amount),
            activity_threshold_hours=float(activity_threshold_hours),
        )
        report["meta"]["wallet"] = int(wallet)
        return report