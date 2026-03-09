from __future__ import annotations

import re
from pathlib import Path


REPO_ROOT = Path(__file__).resolve().parents[1]
MAIN_PY = REPO_ROOT / "py_backend" / "main.py"


# Frozen from kontext/API_CONTRACT_FREEZE.md
EXPECTED_ROUTES: set[tuple[str, str]] = {
    ("POST", "/api/userInfo"),
    ("POST", "/api/blueprints/calculate"),
    ("POST", "/api/blueprints/{type_id:int}/calculate"),
    ("POST", "/api/ore/material"),
    ("GET", "/api/corporation/{corporation_id:int}/assets/sync"),
    ("GET", "/api/corporation/{corporation_id:int}/assets/locations/{station_id:int}"),
    ("POST", "/api/corporation/{corporation_id:int}/assets"),
    ("POST", "/api/corporation/{corporation_id:int}/assetsDirect"),
    ("GET", "/api/corporation/{corporation_id:int}/assets"),
    ("GET", "/api/corporation/{corporation_id:int}/jobs/sync"),
    ("GET", "/api/corporation/{corporation_id:int}/jobs/location/{location_id:int}"),
    ("GET", "/api/corporation/{corporation_id:int}/jobs/report/{year:int}/{month:int}"),
    ("POST", "/api/corporation/{corporation_id:int}/jobs/velocity"),
    ("GET", "/api/corporation/{corporation_id:int}/jobs/direct"),
    ("GET", "/api/corporation/{corporation_id:int}/jobs"),
    ("POST", "/api/corporation/{corporation_id:int}/wallets/{wallet:int}/journal/report"),
    ("GET", "/api/corporation/{corporation_id:int}/wallets/{wallet:int}/journal/sync"),
    ("GET", "/api/corporation/{corporation_id:int}/wallets/{wallet:int}/transactions/sync"),
    ("GET", "/api/corporation/{corporation_id:int}/wallets/{wallet:int}/pl/{year:int}/{month:int}"),
    ("GET", "/api/corporation/{corporation_id:int}/wallets/{wallet:int}/volumes"),
}


def _parse_routes(main_py: Path) -> set[tuple[str, str]]:
    text = main_py.read_text(encoding="utf-8", errors="replace")

    # Route("/api/path", handler, methods=["GET", "POST"])
    route_re = re.compile(
        r"Route\(\s*\"(?P<path>[^\"]+)\"\s*,[^\)]*?methods\s*=\s*\[(?P<methods>[^\]]+)\]",
        re.MULTILINE | re.DOTALL,
    )

    parsed: set[tuple[str, str]] = set()
    for m in route_re.finditer(text):
        path = m.group("path")
        methods_raw = m.group("methods")
        methods = re.findall(r'\"(GET|POST|PUT|PATCH|DELETE|OPTIONS|HEAD)\"', methods_raw)
        for method in methods:
            parsed.add((method.upper(), path))

    assert parsed, "No routes parsed from py_backend/main.py"
    return parsed


def test_route_contract_is_frozen() -> None:
    actual = _parse_routes(MAIN_PY)

    missing = sorted(EXPECTED_ROUTES - actual)
    extra = sorted(actual - EXPECTED_ROUTES)

    assert not missing and not extra, (
        "API route contract drift detected.\n"
        f"Missing routes: {missing}\n"
        f"Unexpected routes: {extra}\n"
        "If intentional, update kontext/API_CONTRACT_FREEZE.md and this test."
    )
