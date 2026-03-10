from __future__ import annotations

import re
from pathlib import Path


REPO_ROOT = Path(__file__).resolve().parents[1]
BLUEPRINTS_GS = REPO_ROOT / "ZAMEK" / "SCRIPTS" / "Blueprints.gs"


def _read_text(path: Path) -> str:
    return path.read_text(encoding="utf-8", errors="replace")


def test_running_jobs_recalc_keeps_product_fallback_contract() -> None:
    text = _read_text(BLUEPRINTS_GS)

    assert re.search(
        r"getRange\(firstDataRow,\s*colJobsList,\s*rowsToRead,\s*6\)",
        text,
    ), "Running-jobs recalc must read 6 columns so product name is available for fallback matching."

    assert re.search(
        r"jobsFiltered\.map\(a\s*=>\s*\[.*?a\.licensedRuns,\s*a\.productName,",
        text,
        re.DOTALL,
    ), "Corporate jobs list must persist productName into the project sheet for reconciliation."

    assert re.search(
        r"jobsPersonal\.data\.map\(a\s*=>\s*\[.*?a\.product_name",
        text,
        re.DOTALL,
    ), "Personal jobs list must persist product_name into the project sheet for reconciliation."

    assert re.search(
        r"const\s+productActionKey\s*=\s*buildProductActionKey\(job\[5\],\s*job\[2\]\)",
        text,
    ), "Running-jobs recalc must fall back to product+activity matching when blueprint names differ."

    assert re.search(
        r"buildBlueprintActionKeys\(job\[3\],\s*job\[2\]\)",
        text,
    ), "Running-jobs recalc must still try blueprint+activity matching first."

    assert re.search(
        r"SpreadsheetApp\.flush\(\);[\s\S]*?sheet\.getRange\(firstDataRow,\s*1,\s*plannedCount,\s*22\)\.getValues\(\)",
        text,
    ), "Status recalc must refresh formulas and then re-read planned job rows from the sheet in the same run."

    assert re.search(
        r"SpreadsheetApp\.flush\(\);[\s\S]*?sheet\.getRange\(firstDataRow,\s*1,\s*plannedCount,\s*22\)\.getValues\(\)[\s\S]*?sheet\.getRange\(firstDataRow,\s*colInput,\s*inputCount,\s*21\)\.getValues\(\)",
        text,
    ), "Status recalc must re-read planned-job and input-material tables after flush so availability checks use fresh formula outputs."

    assert re.search(
        r"recalc clear columns[\s\S]*?getRange\(firstDataRow,\s*colJobs \+ 1,\s*maxJobs,\s*1\)[\s\S]*?setValue\(0\)[\s\S]*?getRange\(firstDataRow,\s*colInput \+ 9,\s*maxJobs,\s*6\)[\s\S]*?setValue\(0\)",
        text,
    ), "Requirement columns must be reset before recalc reads tables, or the next refresh compounds stale required values."