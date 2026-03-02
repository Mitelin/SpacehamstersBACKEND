from __future__ import annotations

import os
import re
from pathlib import Path

import pytest

from py_backend.sde_contract import REQUIRED_SDE_SCHEMA, SDE_TABLE_PREFIXES


def test_ccp_importer_targets_all_contract_tables() -> None:
    from py_backend.sde_ccp_importer import MINIMAL_SDE_TABLES

    missing = sorted(t for t in REQUIRED_SDE_SCHEMA.keys() if t not in MINIMAL_SDE_TABLES)
    assert not missing, (
        "CCP JSONL importer does not declare support for contract tables: " + ", ".join(missing)
    )


def _repo_root() -> Path:
    # tests/ is a direct child of repo root in this workspace
    return Path(__file__).resolve().parents[1]


def _iter_backend_py_files() -> list[Path]:
    services_dir = _repo_root() / "py_backend" / "services"
    return sorted(services_dir.glob("*.py"))


def _extract_sde_table_names_from_text(text: str) -> set[str]:
    # Very simple SQL-ish extraction: capture words after FROM/JOIN.
    # We filter to SDE prefixes to avoid matching Python "from ... import".
    pattern = re.compile(r"\b(?:FROM|JOIN)\s+([A-Za-z0-9_]+)\b", re.IGNORECASE)
    candidates = {m.group(1) for m in pattern.finditer(text)}
    return {t for t in candidates if t.startswith(SDE_TABLE_PREFIXES)}


def _extract_sde_tables_used_by_backend() -> set[str]:
    used: set[str] = set()
    for path in _iter_backend_py_files():
        used |= _extract_sde_table_names_from_text(path.read_text(encoding="utf-8", errors="ignore"))
    return used


def test_sde_contract_covers_all_tables_used_in_services() -> None:
    used = _extract_sde_tables_used_by_backend()
    missing = sorted(t for t in used if t not in REQUIRED_SDE_SCHEMA)
    assert not missing, (
        "Backend SQL references SDE tables not listed in REQUIRED_SDE_SCHEMA: "
        + ", ".join(missing)
    )


def _default_fuzzwork_dump_path() -> Path:
    # User-provided path (kept overridable for CI / other environments)
    return _repo_root() / "ZAMEK" / "SDE Fuzzwork" / "sde-20250707-TRANQUILITY.sql"


@pytest.fixture(scope="session")
def fuzzwork_sql_dump_path() -> Path:
    env = os.getenv("FUZZWORK_SDE_SQL_DUMP")
    return Path(env).expanduser().resolve() if env else _default_fuzzwork_dump_path()


def _parse_create_table_columns(sql_path: Path, tables: set[str]) -> dict[str, set[str]]:
    """Parse a MySQL dump and extract column names for selected tables.

    This intentionally only parses CREATE TABLE blocks and only for the tables
    requested (to keep runtime reasonable on large dumps).
    """

    remaining = set(tables)
    found: dict[str, set[str]] = {}

    # Examples we handle:
    #   CREATE TABLE `invTypes` (
    #   CREATE TABLE IF NOT EXISTS `invTypes` (
    create_re = re.compile(r"^CREATE\s+TABLE\s+(?:IF\s+NOT\s+EXISTS\s+)?`(?P<table>[A-Za-z0-9_]+)`\s*\(", re.IGNORECASE)
    col_re = re.compile(r"^\s*`(?P<col>[A-Za-z0-9_]+)`\s+", re.IGNORECASE)
    end_re = re.compile(r"^\)\s*(?:ENGINE|TYPE|COMMENT|DEFAULT|;)", re.IGNORECASE)

    current: str | None = None
    current_cols: set[str] = set()

    # The dump can be huge; stream it.
    with sql_path.open("r", encoding="utf-8", errors="ignore") as f:
        for line in f:
            if current is None:
                m = create_re.match(line)
                if not m:
                    continue
                table = m.group("table")
                if table not in remaining:
                    # Skip tables we don't care about; still need to consume
                    # until end of this CREATE TABLE block.
                    current = "__skip__"
                    current_cols = set()
                    continue
                current = table
                current_cols = set()
                continue

            # inside a CREATE TABLE block
            if end_re.match(line):
                if current != "__skip__":
                    found[current] = current_cols
                    remaining.discard(current)
                    if not remaining:
                        break
                current = None
                current_cols = set()
                continue

            if current != "__skip__":
                cm = col_re.match(line)
                if cm:
                    current_cols.add(cm.group("col"))

    return found


def test_fuzzwork_dump_contains_required_tables_and_columns(fuzzwork_sql_dump_path: Path) -> None:
    if not fuzzwork_sql_dump_path.exists():
        pytest.skip(f"Fuzzwork SQL dump not found at {fuzzwork_sql_dump_path}. Set FUZZWORK_SDE_SQL_DUMP to run this test.")

    required_tables = set(REQUIRED_SDE_SCHEMA.keys())
    parsed = _parse_create_table_columns(fuzzwork_sql_dump_path, required_tables)

    missing_tables = sorted(t for t in required_tables if t not in parsed)
    assert not missing_tables, "Missing CREATE TABLE definitions in dump: " + ", ".join(missing_tables)

    problems: list[str] = []
    for table, required_cols in REQUIRED_SDE_SCHEMA.items():
        got = {c.lower() for c in parsed[table]}
        req = {c.lower() for c in required_cols}
        missing_cols = sorted(c for c in req if c not in got)
        if missing_cols:
            problems.append(f"{table}: missing columns: {', '.join(missing_cols)}")

    assert not problems, "Schema mismatch vs contract:\n" + "\n".join(problems)
