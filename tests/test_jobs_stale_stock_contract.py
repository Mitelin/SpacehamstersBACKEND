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
        r"Corporation\.getJobsCached\(hangars\)",
        blueprints_text,
    ), "Project refresh must load the default running-jobs view for in-progress counts."

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
        r"if\s*\(!all\)\s*\{[\s\S]*?item\s*=>\s*item\.status\s*==\s*'active'",
        corporation_text,
    ), "Default getJobsCached() contract must stay limited to active jobs so delivered work is not double-counted as running."