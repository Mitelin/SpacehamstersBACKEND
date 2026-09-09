from __future__ import annotations

from datetime import datetime

from .. import db


def history_cutoff(reference: datetime, months: int = 6) -> datetime:
    month_index = reference.year * 12 + reference.month - 1 - int(months)
    year, zero_based_month = divmod(month_index, 12)
    return datetime(year, zero_based_month + 1, 1)


async def prune_activity_history(reference: datetime) -> int:
    cutoff = history_cutoff(reference)
    deleted = 0
    deleted += await db.execute("DELETE FROM corpActivitySnapshots WHERE snapshotAt < %s", [cutoff])
    deleted += await db.execute("DELETE FROM corpActivityIntervals WHERE intervalEnd <= %s", [cutoff])
    deleted += await db.execute(
        "DELETE FROM corpActivityMonthly WHERE year < %s OR (year = %s AND month < %s)",
        [cutoff.year, cutoff.year, cutoff.month],
    )
    return deleted


async def prune_wallet_history(reference: datetime) -> int:
    cutoff = history_cutoff(reference)
    deleted = 0
    deleted += await db.execute("DELETE FROM corpWalletJournal WHERE date < %s", [cutoff])
    deleted += await db.execute(
        "DELETE FROM corpWalletJournalReportMonthly WHERE year < %s OR (year = %s AND month < %s)",
        [cutoff.year, cutoff.year, cutoff.month],
    )
    return deleted