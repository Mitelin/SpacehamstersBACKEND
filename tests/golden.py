from __future__ import annotations

import json
import os
from pathlib import Path
from typing import Any

_GOLDEN_DIR = Path(__file__).parent / "golden"


def assert_json_golden(name: str, data: Any) -> None:
    """Compare JSON-serializable `data` with tests/golden/<name>.json.

    Set env `UPDATE_GOLDEN=1` to (re)write the golden file.
    """

    _GOLDEN_DIR.mkdir(parents=True, exist_ok=True)
    path = _GOLDEN_DIR / f"{name}.json"

    serialized = json.dumps(data, ensure_ascii=False, indent=2, sort_keys=True) + "\n"
    update = os.getenv("UPDATE_GOLDEN") in ("1", "true", "TRUE", "yes", "YES")

    if update or not path.exists():
        path.write_text(serialized, encoding="utf-8")
        return

    expected = path.read_text(encoding="utf-8")
    assert expected == serialized
