from __future__ import annotations

import re
from pathlib import Path


REPO_ROOT = Path(__file__).resolve().parents[1]
SALES_GS = REPO_ROOT / "ZAMEK" / "SCRIPTS" / "Sales.gs"


def _read_text(path: Path) -> str:
    return path.read_text(encoding="utf-8", errors="replace")


def test_jita_sales_uses_only_hard_export_limit() -> None:
    text = _read_text(SALES_GS)

    assert re.search(
        r"const\s+MAX_EXPORT_LINES\s*=\s*100;",
        text,
    ), "Jita Sales must define a fixed hard export cap of 100 rows."

    assert re.search(
        r"const\s+freeSlots\s*=\s*MAX_EXPORT_LINES;",
        text,
    ), "copyJitaSellImport() must use the fixed hard cap instead of per-character free order slots."

    assert re.search(
        r"const\s+exportCandidatesLen\s*=\s*Math\.min\(MAX_EXPORT_LINES,\s*inputRows\.length\);",
        text,
    ), "Candidate export rows must be capped only by MAX_EXPORT_LINES and input size."

    assert not re.search(
        r"Eve\.getCharacterMarketOrders\(|Eve\.getCharacterSkills\(|computeMaxOrderSlots\(",
        text,
    ), "Jita Sales must not fetch character market orders or skills to compute the export limit anymore."


def test_jita_sales_type_resolution_retries_rate_limits() -> None:
    text = _read_text(SALES_GS)

    assert re.search(
        r"const\s+resolveInventoryTypesChunk_\s*=\s*\(names\)\s*=>",
        text,
    ), "Jita Sales should wrap inventory type resolution in a dedicated chunk helper."

    assert re.search(
        r"const\s+CHUNK\s*=\s*50;",
        text,
    ), "Large Jita Sales imports should resolve names in smaller batches to reduce ESI /universe/ids pressure."

    assert re.search(
        r"rate limit exceeded|\\b\(420\|5\\d\\d\)\\b|Utilities\.sleep\(250 \* attempt\)",
        text,
    ), "Inventory type resolution should retry rate-limited ESI batches with backoff instead of failing the whole sales import immediately."