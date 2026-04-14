from __future__ import annotations

import re
from pathlib import Path


REPO_ROOT = Path(__file__).resolve().parents[1]
CORPORATION_GS = REPO_ROOT / "ZAMEK" / "SCRIPTS" / "Corporation.gs"
UNIVERSE_GS = REPO_ROOT / "ZAMEK" / "SCRIPTS" / "Universe.gs"


def _read_text(path: Path) -> str:
    return path.read_text(encoding="utf-8", errors="replace")


def test_history_sheet_syncs_missing_character_rows_into_main_mapping() -> None:
    text = _read_text(CORPORATION_GS)

    assert "const syncMainMappingRows = function(report) {" in text

    assert re.search(
        r"missingRows\.push\(\[installerName, ''\]\);",
        text,
    ), "History refresh should add newly seen characters into Historie A:B mapping rows."

    assert re.search(
        r"syncMainMappingRows\(report\);\s*var rows = toHistoryRows\(report\);",
        text,
    ), "History refresh should sync missing mapping rows before writing the monthly report."


def test_history_sheet_refresh_invalidates_main_map_cache() -> None:
    corporation_text = _read_text(CORPORATION_GS)
    universe_text = _read_text(UNIVERSE_GS)

    assert "if (Universe.resetMainMapCache) {" in corporation_text
    assert "resetMainMapCache: function() {" in universe_text
    assert re.search(
        r"resetMainMapCache:\s*function\(\)\s*\{\s*mainMap = null;\s*\}",
        universe_text,
    ), "Universe should expose a way to invalidate cached Historie main-name mappings after they are updated."
