from __future__ import annotations

import argparse
import asyncio
import sys
from dataclasses import dataclass
from pathlib import Path

import httpx

# Allow running as a plain script: `python tools/migrate_history_from_old_backend.py ...`
# In that case, sys.path[0] points at `tools/`, so we add the repo root.
REPO_ROOT = Path(__file__).resolve().parents[1]
if str(REPO_ROOT) not in sys.path:
    sys.path.insert(0, str(REPO_ROOT))

from py_backend import db  # noqa: E402
from py_backend.esi import ESIClient  # noqa: E402
from py_backend.services.user_info import UserInfoService  # noqa: E402
from py_backend.settings import get_settings  # noqa: E402


@dataclass(frozen=True)
class YearMonth:
    year: int
    month: int


def _parse_year_month(value: str) -> YearMonth:
    parts = value.strip().split("-")
    if len(parts) != 2:
        raise argparse.ArgumentTypeError("Expected YYYY-MM")
    year = int(parts[0])
    month = int(parts[1])
    if year < 2000 or year > 2100:
        raise argparse.ArgumentTypeError("Year out of range")
    if month < 1 or month > 12:
        raise argparse.ArgumentTypeError("Month out of range")
    return YearMonth(year=year, month=month)


def _iter_months(start: YearMonth, end: YearMonth) -> list[YearMonth]:
    if (end.year, end.month) < (start.year, start.month):
        raise ValueError("end must be >= start")

    out: list[YearMonth] = []
    year, month = start.year, start.month
    while (year, month) <= (end.year, end.month):
        out.append(YearMonth(year=year, month=month))
        month += 1
        if month > 12:
            month = 1
            year += 1
    return out


async def _upsert_jobs_month(year: int, month: int, report_rows: list[dict]) -> None:
    await db.execute("DELETE FROM corpJobsReportMonthly WHERE year=%s AND month=%s", [year, month])

    for row in report_rows:
        await db.execute(
            """
            REPLACE INTO corpJobsReportMonthly (
                year, month, installerID,
                manufacturing, researchTE, researchME, copying, invention, reaction
            ) VALUES (%s,%s,%s,%s,%s,%s,%s,%s,%s)
            """,
            [
                year,
                month,
                int(row.get("installerId")),
                row.get("manufacturing"),
                row.get("researchTE"),
                row.get("researchME"),
                row.get("copying"),
                row.get("invention"),
                row.get("reaction"),
            ],
        )


async def _upsert_wallet_month(wallet: int, year: int, month: int, ref_type: str, report_rows: list[dict]) -> None:
    await db.execute(
        "DELETE FROM corpWalletJournalReportMonthly WHERE wallet=%s AND year=%s AND month=%s AND refType=%s",
        [wallet, year, month, ref_type],
    )

    for row in report_rows:
        second_party_id = row.get("secondPartyId")
        if second_party_id is None:
            continue
        await db.execute(
            """
            REPLACE INTO corpWalletJournalReportMonthly (
                wallet, year, month, refType, secondPartyId, amount
            ) VALUES (%s,%s,%s,%s,%s,%s)
            """,
            [wallet, year, month, ref_type, int(second_party_id), row.get("amount")],
        )


async def _import_jobs_raw(old_api_base: str, corporation_id: int, headers: dict[str, str]) -> int:
    url = f"{old_api_base}/corporation/{corporation_id}/jobs"
    async with httpx.AsyncClient(timeout=300.0) as client:
        resp = await client.get(url, headers=headers)
        resp.raise_for_status()
        rows: list[dict] = resp.json() or []

    cnt = 0
    for row in rows:
        await db.execute(
            """
            REPLACE INTO corpJobs (
                jobID, activityID, blueprintID, blueprintLocationID, blueprintTypeID,
                completedCharacterID, completedDate, cost, duration, endDate, facilityID,
                installerID, licensedRuns, outputLocationID, pauseDate, probability,
                productTypeID, runs, startDate, stationID, status, successfulRuns
            ) VALUES (%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s)
            """,
            [
                row.get("jobID"),
                row.get("activityID"),
                row.get("blueprintID"),
                row.get("blueprintLocationID"),
                row.get("blueprintTypeID"),
                row.get("completedCharacterID"),
                row.get("completedDate"),
                row.get("cost"),
                row.get("duration"),
                row.get("endDate"),
                row.get("facilityID"),
                row.get("installerID"),
                row.get("licensedRuns"),
                row.get("outputLocationID"),
                row.get("pauseDate"),
                row.get("probability"),
                row.get("productTypeID"),
                row.get("runs"),
                row.get("startDate"),
                row.get("stationID"),
                row.get("status"),
                row.get("successfulRuns"),
            ],
        )
        cnt += 1
    return cnt


async def run_migration(
    old_api_base: str,
    start: YearMonth,
    end: YearMonth,
    wallet: int,
    ref_types: list[str],
    import_raw_jobs: bool,
) -> None:
    settings = get_settings()
    await db.init_pool()

    esi = ESIClient(settings.eve_api_base)
    user_info = UserInfoService(esi)

    try:
        token = await user_info.get_ceo_access_token()

        headers = {
            "Authorization": f"Bearer {token}",
            "Accept": "application/json",
        }

        months = _iter_months(start, end)

        async with httpx.AsyncClient(timeout=60.0) as client:
            if import_raw_jobs:
                raw_cnt = await _import_jobs_raw(old_api_base, settings.corporation_id, headers)
                print(f"Imported raw jobs into corpJobs: {raw_cnt}")

            for ym in months:
                jobs_url = f"{old_api_base}/corporation/{settings.corporation_id}/jobs/report/{ym.year}/{ym.month}"
                resp = await client.get(jobs_url, headers=headers)
                resp.raise_for_status()
                jobs_report = resp.json() or []
                await _upsert_jobs_month(ym.year, ym.month, jobs_report)

                for ref_type in ref_types:
                    wallet_url = (
                        f"{old_api_base}/corporation/{settings.corporation_id}/wallets/{wallet}/journal/report"
                    )
                    resp = await client.post(
                        wallet_url,
                        headers={**headers, "Content-Type": "application/json"},
                        json={"year": ym.year, "month": ym.month, "types": [ref_type]},
                    )
                    resp.raise_for_status()
                    wallet_report = resp.json() or []
                    await _upsert_wallet_month(wallet, ym.year, ym.month, ref_type, wallet_report)

    finally:
        await esi.close()
        await db.close_pool()


def main() -> None:
    parser = argparse.ArgumentParser(
        description=(
            "Migrates historical monthly reports from an old Aubi backend into snapshot tables in the new DB. "
            "This restores Sheets history even if raw corpJobs/corpWalletJournal were not migrated."
        )
    )
    parser.add_argument(
        "--old-api-base",
        default="https://aubi.synology.me:4444/api",
        help="Old backend API base (must include /api)",
    )
    parser.add_argument("--start", type=_parse_year_month, required=True, help="Start month (YYYY-MM)")
    parser.add_argument("--end", type=_parse_year_month, required=True, help="End month (YYYY-MM)")
    parser.add_argument("--wallet", type=int, default=1, help="Wallet division number (default: 1)")
    parser.add_argument(
        "--ref-types",
        default="bounty_prizes,ess_escrow_transfer",
        help="Comma-separated refTypes to migrate (default: bounty_prizes,ess_escrow_transfer)",
    )
    parser.add_argument(
        "--import-raw-jobs",
        action="store_true",
        help="Also import full raw corp jobs history from old backend into corpJobs",
    )

    args = parser.parse_args()
    ref_types = [t.strip() for t in str(args.ref_types).split(",") if t.strip()]
    asyncio.run(
        run_migration(
            old_api_base=str(args.old_api_base).rstrip("/"),
            start=args.start,
            end=args.end,
            wallet=int(args.wallet),
            ref_types=ref_types,
            import_raw_jobs=bool(args.import_raw_jobs),
        )
    )


if __name__ == "__main__":
    main()
