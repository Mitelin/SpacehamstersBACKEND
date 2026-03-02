from __future__ import annotations

from datetime import datetime, timezone


def log(level: int, message: object) -> None:
    current_date = f"[{datetime.now(timezone.utc).ctime()}] "
    brackets = ">>> "
    if level == 3:
        brackets = "!!! "
    if level == 2:
        brackets = "### "
    print(current_date + brackets + str(message))
