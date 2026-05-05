from __future__ import annotations

import argparse
import base64
import json
import sys
from pathlib import Path
from urllib.parse import urlencode
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


def save_config(path: Path, config: dict) -> None:
    path.write_text(json.dumps(config, indent=2), encoding="utf-8")


def _request(url: str, *, method: str = "GET", headers: dict[str, str] | None = None, data: bytes | None = None) -> tuple[int, str]:
    request = Request(url, headers=headers or {}, data=data, method=method)
    try:
        with urlopen(request, timeout=60) as response:
            return int(response.status), response.read().decode("utf-8", errors="replace")
    except HTTPError as exc:
        return int(exc.code), exc.read().decode("utf-8", errors="replace")
    except URLError as exc:
        raise RuntimeError(f"Request failed: {exc}") from exc


def verify_eve_token(verify_url: str, bearer_token: str) -> bool:
    status, _body = _request(
        verify_url,
        headers={
            "Accept": "application/json",
            "Authorization": f"Bearer {bearer_token}",
        },
    )
    return status == 200


def refresh_access_token(token_url: str, refresh_token: str, client_id: str, client_secret: str) -> str:
    basic_auth = base64.b64encode(f"{client_id}:{client_secret}".encode("utf-8")).decode("ascii")
    status, body = _request(
        token_url,
        method="POST",
        headers={
            "Accept": "application/json",
            "Content-Type": "application/x-www-form-urlencoded",
            "Authorization": f"Basic {basic_auth}",
        },
        data=urlencode({"grant_type": "refresh_token", "refresh_token": refresh_token}).encode("utf-8"),
    )
    if status != 200:
        raise RuntimeError(f"EVE token refresh failed: HTTP {status}: {body[:300]}")
    payload = json.loads(body)
    access_token = str(payload.get("access_token") or "").strip()
    if not access_token:
        raise RuntimeError("EVE token refresh succeeded but access_token is missing.")
    return access_token


def resolve_bearer_token(config_path: Path, config: dict) -> str:
    verify_url = str(config.get("verifyUrl") or "https://login.eveonline.com/v2/oauth/verify").strip()
    token_url = str(config.get("tokenUrl") or "https://login.eveonline.com/v2/oauth/token").strip()
    bearer_token = str(config.get("bearerToken") or "").strip()
    refresh_token = str(config.get("refreshToken") or "").strip()
    client_id = str(config.get("eveClientId") or "").strip()
    client_secret = str(config.get("eveClientSecret") or "").strip()

    if bearer_token and bearer_token != "PASTE_BEARER_TOKEN_HERE" and verify_eve_token(verify_url, bearer_token):
        return bearer_token

    if refresh_token and client_id and client_secret:
        refreshed_token = refresh_access_token(token_url, refresh_token, client_id, client_secret)
        if not verify_eve_token(verify_url, refreshed_token):
            raise RuntimeError("Refreshed access token is still rejected by EVE verify endpoint.")
        config["bearerToken"] = refreshed_token
        save_config(config_path, config)
        return refreshed_token

    if bearer_token:
        raise RuntimeError(
            "Configured bearerToken is not a valid EVE SSO access token. Fill refreshToken, eveClientId and eveClientSecret to auto-refresh it."
        )

    raise RuntimeError(
        "No usable token found. Fill bearerToken or provide refreshToken, eveClientId and eveClientSecret."
    )


def call_api(url: str, bearer_token: str) -> tuple[int, str]:
    return _request(
        url,
        headers={
            "Accept": "application/json",
            "Authorization": f"Bearer {bearer_token}",
        },
    )


def main() -> int:
    parser = argparse.ArgumentParser(description="Call Spacehamsters activity API with a local bearer token config.")
    parser.add_argument("--config", default=str(DEFAULT_CONFIG), help="Path to local JSON config.")
    parser.add_argument("--year", type=int, default=2026, help="Report year.")
    parser.add_argument("--month", type=int, default=5, help="Report month.")
    parser.add_argument("--skip-sync", action="store_true", help="Skip the activity sync call and only fetch the report.")
    args = parser.parse_args()

    config_path = Path(args.config)
    config = load_config(config_path)
    base_url = str(config.get("baseUrl") or "").rstrip("/")
    corporation_id = int(config.get("corporationId") or 0)

    if not base_url:
        raise RuntimeError("Config baseUrl is required.")
    if not corporation_id:
        raise RuntimeError("Config corporationId is required.")

    bearer_token = resolve_bearer_token(config_path, config)

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