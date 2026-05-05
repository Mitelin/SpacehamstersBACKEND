from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path
from urllib.error import HTTPError, URLError
from urllib.request import Request, urlopen


DEFAULT_CONFIG = Path(__file__).with_name("activity_api.local.json")
EXAMPLE_CONFIG = Path(__file__).with_name("activity_api.example.json")


def load_config(path: Path) -> dict:
    if not path.exists():
        raise RuntimeError(
            f"Missing config file: {path}. Copy {EXAMPLE_CONFIG.name} to {path.name} and fill bearerToken."
        )
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except json.JSONDecodeError as exc:
        raise RuntimeError(f"Invalid JSON in {path}: {exc}") from exc


def call_api(url: str, bearer_token: str) -> tuple[int, str]:
    request = Request(
        url,
        headers={
            "Accept": "application/json",
            "Authorization": f"Bearer {bearer_token}",
        },
        method="GET",
    )
    try:
        with urlopen(request, timeout=60) as response:
            return int(response.status), response.read().decode("utf-8", errors="replace")
    except HTTPError as exc:
        return int(exc.code), exc.read().decode("utf-8", errors="replace")
    except URLError as exc:
        raise RuntimeError(f"Request failed: {exc}") from exc


def main() -> int:
    parser = argparse.ArgumentParser(description="Call Spacehamsters activity API with a local bearer token config.")
    parser.add_argument("--config", default=str(DEFAULT_CONFIG), help="Path to local JSON config.")
    parser.add_argument("--year", type=int, default=2026, help="Report year.")
    parser.add_argument("--month", type=int, default=5, help="Report month.")
    parser.add_argument("--skip-sync", action="store_true", help="Skip the activity sync call and only fetch the report.")
    args = parser.parse_args()

    config = load_config(Path(args.config))
    base_url = str(config.get("baseUrl") or "").rstrip("/")
    corporation_id = int(config.get("corporationId") or 0)
    bearer_token = str(config.get("bearerToken") or "").strip()

    if not base_url:
        raise RuntimeError("Config baseUrl is required.")
    if not corporation_id:
        raise RuntimeError("Config corporationId is required.")
    if not bearer_token or bearer_token == "PASTE_BEARER_TOKEN_HERE":
        raise RuntimeError("Config bearerToken is missing. Fill tools/activity_api.local.json first.")

    if not args.skip_sync:
        sync_url = f"{base_url}/corporation/{corporation_id}/activity/sync"
        sync_status, sync_body = call_api(sync_url, bearer_token)
        print(f"SYNC {sync_status}")
        print(sync_body)

    report_url = f"{base_url}/corporation/{corporation_id}/activity/report/{args.year}/{args.month}"
    report_status, report_body = call_api(report_url, bearer_token)
    print(f"REPORT {report_status}")
    print(report_body)
    return 0


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except Exception as exc:
        print(str(exc), file=sys.stderr)
        raise SystemExit(1)