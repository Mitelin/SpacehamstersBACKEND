from __future__ import annotations

import re
from pathlib import Path


REPO_ROOT = Path(__file__).resolve().parents[1]
ZASOBOVANI_GS = REPO_ROOT / "ZAMEK" / "SCRIPTS" / "ZASOBOVANI.gs"


def _read_text(path: Path) -> str:
    return path.read_text(encoding="utf-8", errors="replace")


def test_nakup_list_uses_all_project_divisions_for_stock() -> None:
    text = _read_text(ZASOBOVANI_GS)

    assert re.search(
        r"const\s+PROJECT_HANGAR_PARAM_ROWS\s*=\s*\[\s*2\s*,\s*3\s*,\s*5\s*,\s*12\s*\]",
        text,
    ), "Nakup list must infer stock divisions from manufacturing, reaction, research, and capital project hangars."

    assert re.search(
        r"PROJECT_HANGAR_PARAM_ROWS\.forEach\(row\s*=>\s*\{[\s\S]*?getRange\(row,\s*PROJECT_HANGAR_PARAM_COL,\s*1,\s*1\)",
        text,
    ), "Nakup list must scan all configured project hangar cells instead of only B2."