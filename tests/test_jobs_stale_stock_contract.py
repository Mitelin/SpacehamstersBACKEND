from __future__ import annotations

import re
from pathlib import Path


REPO_ROOT = Path(__file__).resolve().parents[1]
BLUEPRINTS_GS = REPO_ROOT / "ZAMEK" / "SCRIPTS" / "Blueprints.gs"
CORPORATION_GS = REPO_ROOT / "ZAMEK" / "SCRIPTS" / "Corporation.gs"


def _read_text(path: Path) -> str:
    return path.read_text(encoding="utf-8", errors="replace")


def test_recently_delivered_jobs_are_projected_into_stock_not_running() -> None:
    blueprints_text = _read_text(BLUEPRINTS_GS)
    corporation_text = _read_text(CORPORATION_GS)

    assert re.search(
        r"data:\s*alljobs\.data\.filter\(job\s*=>\s*job\.status\s*==\s*'active'\)",
        blueprints_text,
    ), "Project refresh must keep the in-progress job view limited to active jobs even when it loads the all-jobs snapshot."

    assert re.search(
        r"Corporation\.getJobsCached\(hangars,\s*true\)",
        blueprints_text,
    ), "Project refresh must also load the all-jobs view to reconcile recently delivered jobs."

    assert re.search(
        r"let\s+deliveredJobs\s*=\s*alljobs\.data\.filter\(job\s*=>\s*job\.status\s*==\s*'delivered'\s*&&\s*job\.completedTime\s*>\s*items\.lastModified\)",
        blueprints_text,
    ), (
        "Delivered jobs completed after the asset snapshot must be detected so their output stays counted "
        "until stock refresh catches up."
    )

    assert re.search(
        r"getFinishedJobProducts\s*\(\s*plannedJobs\s*,\s*deliveredJobs",
        blueprints_text,
    ), "Recently delivered jobs must be converted into projected stock via getFinishedJobProducts()."

    assert re.search(
        r"getFinishedJobProducts\s*\(\s*plannedJobs\s*,\s*deliveredJobs[\s\S]*?SpreadsheetApp\.flush\(\);[\s\S]*?this\.recalculateProject\(sheet,\s*notify\)",
        blueprints_text,
    ), (
        "Delivered-job fallback must be written into project tables before recalculateProject() runs, "
        "so the same refresh sees output that is not yet present in the assets cache."
    )

    assert re.search(
        r"const\s+assetSnapshot\s*=\s*Corporation\.getAssetsCached\(hangarContext\.hangars\)",
        blueprints_text,
    ), "recalculateProject() must compare delivered jobs against the same project asset scope instead of waiting for another refresh."

    assert re.search(
        r"recalc read blueprint params[\s\S]*?const\s+hangarContext\s*=\s*buildProjectHangarContext\(",
        blueprints_text,
    ), "recalculateProject() must build hangarContext before using delivered-job fallback against the project scope."

    assert re.search(
        r"Corporation\.syncJobs\(\)[\s\S]*?Corporation\.getJobsCached\(hangars,\s*true\)",
        blueprints_text,
    ), "Explicit project refresh must force-refresh jobs cache before reading all jobs, or newly delivered jobs can stay invisible until cache expiry."

    assert re.search(
        r"warm cache: jobs'[\s\S]*?Corporation\.syncJobs\(\)",
        blueprints_text,
    ), "runUpdateAllProjects() must warm the jobs snapshot via syncJobs() before freezing memo reuse for the ALPRO batch."

    assert re.search(
        r"item\.status\s*==\s*'delivered'\s*&&\s*item\.completedTime\s*>\s*assetSnapshot\.lastModified",
        blueprints_text,
    ), "recalculateProject() must detect jobs delivered after the project asset snapshot."

    assert re.search(
        r"missingVolume\s*-=?\s*projectedDelivered|projectedDelivered\s*>\s*0\)\s*missingVolume\s*-?=\s*projectedDelivered",
        blueprints_text,
    ), "When stock tables still lag, recalculateProject() must reduce missing-material gaps by recently delivered job output."

    assert re.search(
        r"if\s*\(!all\)\s*\{[\s\S]*?item\s*=>\s*item\.status\s*==\s*'active'",
        corporation_text,
    ), "Default getJobsCached() contract must stay limited to active jobs so delivered work is not double-counted as running."

    assert re.search(
        r"isMemoFrozen:\s*function\(\)\s*\{[\s\S]*?return\s+_freezeMemo;",
        corporation_text,
    ), "Blueprint refresh logic needs a public way to detect frozen memo mode so single-project refresh can force job sync without breaking ALPRO batch reuse."

    assert re.search(
        r"startDate:\s*a\.start_date,[\s\S]*?endDate:\s*a\.end_date,[\s\S]*?completedDate:\s*a\.completed_date,[\s\S]*?startTime:\s*new Date\(a\.start_date\)\.getTime\(\),[\s\S]*?endTime:\s*new Date\(a\.end_date\)\.getTime\(\),[\s\S]*?completedTime:\s*new Date\(a\.completed_date\)\.getTime\(\)",
        corporation_text,
    ), "Freshly synced jobs must preserve parsed start/end/completed timestamps in memo, or delivered-job reconciliation breaks until the sheet is reloaded."