from __future__ import annotations

import argparse
import asyncio
import datetime as dt
import json
import os
import pathlib
import signal
import shutil
import subprocess
import sys
import time
from typing import Any


ROOT = pathlib.Path(__file__).resolve().parent
DEFAULT_CONFIG_PATH = ROOT / "launcher_config.json"
EXAMPLE_CONFIG_PATH = ROOT / "launcher_config.example.json"
STATE_PATH = ROOT / ".launcher_state.json"
PID_PATH = ROOT / ".backend.pid"

_DOTENV_LOADED_FROM: pathlib.Path | None = None
LOCK_PATH = ROOT / ".launcher.lock"
DBINIT_SQL_PATH = ROOT / "dbinit.sql"
PRESERVE_DIR = ROOT / ".launcher_preserve"


class LauncherError(RuntimeError):
    pass


def _utcnow() -> dt.datetime:
    return dt.datetime.now(dt.timezone.utc)


def _local_now() -> dt.datetime:
    return dt.datetime.now().astimezone()


def _log(msg: str) -> None:
    ts = _local_now().strftime("%Y-%m-%d %H:%M:%S%z")
    print(f"[{ts}] {msg}")


def _read_json(path: pathlib.Path) -> dict[str, Any]:
    if not path.exists():
        return {}
    return json.loads(path.read_text(encoding="utf-8"))


def _write_json(path: pathlib.Path, payload: dict[str, Any]) -> None:
    path.write_text(json.dumps(payload, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")


def _get_preserve_paths(cfg: dict[str, Any]) -> list[str]:
    raw = cfg.get("preserve_paths")
    if raw is None:
        return [
            "ZAMEK",
            "CONTEXTPREPIS.MD",
            "uzivatele.md",
            "LAUNCHER.md",
        ]
    if not isinstance(raw, list) or not all(isinstance(x, str) for x in raw):
        raise LauncherError("config.preserve_paths must be an array of strings")
    return list(raw)


def _preserve_snapshot(repo: pathlib.Path, rel_paths: list[str]) -> pathlib.Path | None:
    if not rel_paths:
        return None

    snapshot = (repo / PRESERVE_DIR.name / "latest").resolve()
    snapshot.parent.mkdir(parents=True, exist_ok=True)
    if snapshot.exists():
        shutil.rmtree(snapshot, ignore_errors=True)
    snapshot.mkdir(parents=True, exist_ok=True)

    copied_any = False
    for rel in rel_paths:
        src = (repo / rel).resolve()
        if not src.exists():
            continue
        dst = (snapshot / rel)
        dst.parent.mkdir(parents=True, exist_ok=True)
        try:
            if src.is_dir():
                shutil.copytree(src, dst, dirs_exist_ok=True)
            else:
                shutil.copy2(src, dst)
            copied_any = True
        except Exception as exc:
            _log(f"WARN: preserve snapshot failed for {rel}: {exc}")

    return snapshot if copied_any else None


def _restore_preserved(repo: pathlib.Path, snapshot: pathlib.Path | None, rel_paths: list[str]) -> None:
    if snapshot is None or not snapshot.exists():
        return
    for rel in rel_paths:
        dst = (repo / rel).resolve()
        if dst.exists():
            continue
        src = (snapshot / rel)
        if not src.exists():
            continue
        dst.parent.mkdir(parents=True, exist_ok=True)
        try:
            if src.is_dir():
                shutil.copytree(src, dst, dirs_exist_ok=True)
            else:
                shutil.copy2(src, dst)
            _log(f"Restored preserved path: {rel}")
        except Exception as exc:
            _log(f"WARN: restore preserved failed for {rel}: {exc}")


def _acquire_lock(path: pathlib.Path, stale_seconds: int = 60 * 30) -> None:
    now = time.time()
    if path.exists():
        try:
            age = now - path.stat().st_mtime
        except OSError:
            age = 0
        if age < stale_seconds:
            raise LauncherError(f"Launcher already running (lock present): {path}")
        try:
            path.unlink()
        except OSError:
            raise LauncherError(f"Launcher lock exists and cannot be removed: {path}")

    try:
        # best-effort atomic create
        fd = os.open(str(path), os.O_CREAT | os.O_EXCL | os.O_WRONLY)
        with os.fdopen(fd, "w", encoding="utf-8") as f:
            f.write(f"pid={os.getpid()}\n")
            f.write(f"utc={_utcnow().isoformat()}\n")
    except FileExistsError:
        raise LauncherError(f"Launcher already running (lock present): {path}")


def _release_lock(path: pathlib.Path) -> None:
    try:
        if path.exists():
            path.unlink()
    except OSError:
        pass


def _run_cmd(
    args: list[str],
    *,
    cwd: pathlib.Path | None = None,
    env: dict[str, str] | None = None,
    timeout_s: int = 60,
    check: bool = True,
) -> subprocess.CompletedProcess[str]:
    proc = subprocess.run(
        args,
        cwd=str(cwd) if cwd else None,
        env=env,
        text=True,
        capture_output=True,
        timeout=timeout_s,
        shell=False,
    )
    if check and proc.returncode != 0:
        raise LauncherError(
            "Command failed: "
            + " ".join(args)
            + f"\nexit={proc.returncode}\nstdout={proc.stdout.strip()}\nstderr={proc.stderr.strip()}"
        )
    return proc


def _parse_config(path: pathlib.Path) -> dict[str, Any]:
    if not path.exists():
        raise LauncherError(
            f"Missing config: {path}. Create it (copy from {EXAMPLE_CONFIG_PATH.name}) or pass --config."  # noqa: E501
        )
    cfg = _read_json(path)
    if not isinstance(cfg, dict):
        raise LauncherError("Config must be a JSON object")
    return cfg


def _get_repo_path(cfg: dict[str, Any]) -> pathlib.Path:
    repo_path = cfg.get("repo_path")
    if repo_path:
        return pathlib.Path(str(repo_path)).expanduser().resolve()
    return ROOT


def _maybe_load_dotenv(repo: pathlib.Path) -> None:
    global _DOTENV_LOADED_FROM
    if _DOTENV_LOADED_FROM == repo:
        return

    try:
        from dotenv import load_dotenv  # type: ignore
    except Exception:
        _DOTENV_LOADED_FROM = repo
        return

    dotenv_path = repo / ".env"
    if dotenv_path.exists():
        load_dotenv(dotenv_path=dotenv_path, override=False)

    _DOTENV_LOADED_FROM = repo


def _resolve_repo_relative(repo: pathlib.Path, value: Any) -> pathlib.Path:
    p = pathlib.Path(str(value)).expanduser()
    if p.is_absolute():
        return p.resolve()
    return (repo / p).resolve()


def _get_backend_env(cfg: dict[str, Any]) -> dict[str, str]:
    _maybe_load_dotenv(_get_repo_path(cfg))
    env = os.environ.copy()
    extra = cfg.get("env") or {}
    if not isinstance(extra, dict):
        raise LauncherError("config.env must be an object of string->string")
    for k, v in extra.items():
        if v is None:
            continue
        env[str(k)] = str(v)
    return env


def _get_backend_cmd(cfg: dict[str, Any]) -> list[str]:
    cmd = cfg.get("backend_command")
    if cmd is None:
        python_exe = str(cfg.get("python_executable") or sys.executable)
        return [python_exe, "-m", "py_backend"]
    if not isinstance(cmd, list) or not all(isinstance(x, str) for x in cmd):
        raise LauncherError("config.backend_command must be a JSON array of strings")
    return list(cmd)


def _read_pid(path: pathlib.Path) -> int | None:
    try:
        raw = path.read_text(encoding="utf-8").strip()
    except FileNotFoundError:
        return None
    except OSError:
        return None

    if not raw:
        return None
    try:
        return int(raw)
    except ValueError:
        return None


def _is_pid_running_windows(pid: int) -> bool:
    # tasklist is available on Windows; it prints header + maybe the process.
    proc = _run_cmd(["tasklist", "/FI", f"PID eq {pid}"], timeout_s=15, check=False)
    out = (proc.stdout or "")
    return str(pid) in out


def backend_is_running(pid_path: pathlib.Path = PID_PATH) -> bool:
    pid = _read_pid(pid_path)
    if pid is None:
        return False
    if os.name == "nt":
        return _is_pid_running_windows(pid)
    try:
        os.kill(pid, 0)
        return True
    except OSError:
        return False


def stop_backend(pid_path: pathlib.Path = PID_PATH, timeout_s: int = 20) -> None:
    pid = _read_pid(pid_path)
    if pid is None:
        return

    if not backend_is_running(pid_path):
        try:
            pid_path.unlink()
        except OSError:
            pass
        return

    _log(f"Stopping backend pid={pid}")
    if os.name == "nt":
        _run_cmd(["taskkill", "/PID", str(pid), "/T"], timeout_s=timeout_s, check=False)
        for _ in range(timeout_s):
            if not backend_is_running(pid_path):
                break
            time.sleep(1)
        if backend_is_running(pid_path):
            _run_cmd(["taskkill", "/PID", str(pid), "/T", "/F"], timeout_s=timeout_s, check=False)
    else:
        try:
            os.kill(pid, signal.SIGTERM)
        except OSError:
            pass

        # Wait for graceful exit
        for _ in range(timeout_s):
            if not backend_is_running(pid_path):
                break
            time.sleep(1)

        # Force kill if still running
        if backend_is_running(pid_path):
            try:
                os.kill(pid, signal.SIGKILL)
            except OSError:
                pass

    # cleanup
    try:
        pid_path.unlink()
    except OSError:
        pass


def start_backend(
    cfg: dict[str, Any],
    *,
    pid_path: pathlib.Path = PID_PATH,
) -> int:
    repo = _get_repo_path(cfg)
    env = _get_backend_env(cfg)
    cmd = _get_backend_cmd(cfg)

    stdout_path = cfg.get("backend_stdout")
    stderr_path = cfg.get("backend_stderr")

    stdout_file: pathlib.Path | None = None
    stderr_file: pathlib.Path | None = None
    if stdout_path:
        stdout_file = _resolve_repo_relative(repo, stdout_path)
    if stderr_path:
        stderr_file = _resolve_repo_relative(repo, stderr_path)

    if stdout_file:
        stdout_file.parent.mkdir(parents=True, exist_ok=True)
    if stderr_file:
        stderr_file.parent.mkdir(parents=True, exist_ok=True)

    stdout_f = open(stdout_file, "a", encoding="utf-8") if stdout_file else subprocess.DEVNULL
    stderr_f = open(stderr_file, "a", encoding="utf-8") if stderr_file else subprocess.DEVNULL

    _log("Starting backend: " + " ".join(cmd))
    creationflags = 0
    if os.name == "nt":
        # allows taskkill to also kill children reliably; also isolates console signals
        creationflags = subprocess.CREATE_NEW_PROCESS_GROUP  # type: ignore[attr-defined]

    try:
        p = subprocess.Popen(
            cmd,
            cwd=str(repo),
            env=env,
            stdout=stdout_f,
            stderr=stderr_f,
            creationflags=creationflags,
            start_new_session=(os.name != "nt"),
        )
    finally:
        if stdout_file:
            stdout_f.close()  # type: ignore[union-attr]
        if stderr_file:
            stderr_f.close()  # type: ignore[union-attr]

    pid_path.write_text(str(p.pid), encoding="utf-8")
    time.sleep(1)
    if p.poll() is not None:
        raise LauncherError(f"Backend exited immediately (exit={p.returncode}). Check logs.")
    _log(f"Backend started pid={p.pid}")
    return p.pid


def _is_git_repo(repo: pathlib.Path) -> bool:
    return (repo / ".git").exists()


def _git_executable(cfg: dict[str, Any]) -> str:
    git_cfg = cfg.get("git") or {}
    if not isinstance(git_cfg, dict):
        raise LauncherError("config.git must be an object")
    exe = git_cfg.get("executable")
    if exe is None or str(exe).strip() == "":
        return "git"
    return str(exe)


def _git_head(cfg: dict[str, Any], repo: pathlib.Path, ref: str = "HEAD") -> str:
    proc = _run_cmd([_git_executable(cfg), "rev-parse", ref], cwd=repo, timeout_s=30, check=True)
    return (proc.stdout or "").strip()


def _git_fetch(cfg: dict[str, Any], repo: pathlib.Path) -> None:
    _run_cmd([_git_executable(cfg), "fetch", "--prune"], cwd=repo, timeout_s=120, check=True)


def _git_pull_ff_only(cfg: dict[str, Any], repo: pathlib.Path) -> None:
    _run_cmd([_git_executable(cfg), "pull", "--ff-only"], cwd=repo, timeout_s=180, check=True)


def _should_restart_window(cfg: dict[str, Any], now_local: dt.datetime) -> bool:
    sched = cfg.get("restart_window") or {}
    if not isinstance(sched, dict):
        raise LauncherError("config.restart_window must be an object")

    hours = sched.get("hours")
    minute = sched.get("minute", 0)
    if hours is None:
        return False
    if not isinstance(hours, list) or not all(isinstance(x, int) for x in hours):
        raise LauncherError("config.restart_window.hours must be an array of ints")
    if not isinstance(minute, int):
        raise LauncherError("config.restart_window.minute must be int")

    return now_local.hour in set(hours) and now_local.minute == minute


def _restart_window_key(cfg: dict[str, Any], now_local: dt.datetime) -> str | None:
    sched = cfg.get("restart_window") or {}
    if not isinstance(sched, dict):
        raise LauncherError("config.restart_window must be an object")

    hours = sched.get("hours")
    minute = sched.get("minute", 0)
    if hours is None:
        return None
    if not isinstance(hours, list) or not all(isinstance(x, int) for x in hours):
        raise LauncherError("config.restart_window.hours must be an array of ints")
    if not isinstance(minute, int):
        raise LauncherError("config.restart_window.minute must be int")

    if now_local.hour not in set(hours) or now_local.minute != minute:
        return None
    # Once-per-window key (per local date)
    return f"{now_local.date().isoformat()}T{now_local.hour:02d}:{now_local.minute:02d}"


def _parse_interval_minutes(value: Any, *, default: int) -> int:
    if value is None:
        return default
    try:
        minutes = int(value)
    except Exception:
        raise LauncherError("Interval minutes must be an int")
    if minutes < 1:
        raise LauncherError("Interval minutes must be >= 1")
    return minutes


def _should_run_interval(state: dict[str, Any], *, key: str, interval_minutes: int, now_utc: dt.datetime) -> bool:
    raw = state.get(key)
    if not raw:
        return True
    try:
        last = dt.datetime.fromisoformat(str(raw))
        if last.tzinfo is None:
            last = last.replace(tzinfo=dt.timezone.utc)
    except Exception:
        return True

    return (now_utc - last) >= dt.timedelta(minutes=interval_minutes)


def _get_db_params_from_env(env: dict[str, str]) -> dict[str, Any]:
    def _req(name: str) -> str:
        v = env.get(name)
        if v is None or v == "":
            raise LauncherError(f"Missing required env var for DB: {name}")
        return v

    host = env.get("DB_HOST", "127.0.0.1")
    port = int(env.get("DB_PORT", "3306"))
    user = _req("DB_USER")
    password = _req("DB_PASSWORD")
    db_name = _req("DB_NAME")
    return {"host": host, "port": port, "user": user, "password": password, "db": db_name}


async def _db_connect(
    *,
    host: str,
    port: int,
    user: str,
    password: str,
    db: str | None,
):
    import aiomysql

    return await aiomysql.connect(host=host, port=port, user=user, password=password, db=db, autocommit=True)


async def _db_database_exists(conn, db_name: str) -> bool:
    async with conn.cursor() as cur:
        await cur.execute("SELECT SCHEMA_NAME FROM information_schema.SCHEMATA WHERE SCHEMA_NAME=%s", (db_name,))
        return (await cur.fetchone()) is not None


async def _db_ensure_database(params: dict[str, Any], *, create_db: bool) -> None:
    db_name = str(params["db"])
    conn = await _db_connect(host=params["host"], port=int(params["port"]), user=params["user"], password=params["password"], db=None)
    try:
        if await _db_database_exists(conn, db_name):
            return
        if not create_db:
            raise LauncherError(f"Database '{db_name}' does not exist (and create_database=false)")
        _log(f"Creating database {db_name}")
        async with conn.cursor() as cur:
            await cur.execute(f"CREATE DATABASE `{db_name}` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci")
    finally:
        conn.close()


async def _db_table_exists(conn, db_name: str, table: str) -> bool:
    async with conn.cursor() as cur:
        await cur.execute(
            "SELECT 1 FROM information_schema.TABLES WHERE TABLE_SCHEMA=%s AND TABLE_NAME=%s",
            (db_name, table),
        )
        return (await cur.fetchone()) is not None


async def _db_count(conn, sql: str, params: tuple[Any, ...] = ()) -> int:
    async with conn.cursor() as cur:
        await cur.execute(sql, params)
        row = await cur.fetchone()
        if not row:
            return 0
        # aiomysql default cursor returns tuples
        return int(row[0])


def _split_sql_statements(sql_text: str) -> list[str]:
    # Very simple splitter good enough for our dbinit.sql (no ';' in strings).
    parts = []
    buff: list[str] = []
    for line in sql_text.splitlines():
        # drop comments
        stripped = line.strip()
        if stripped.startswith("--") or stripped.startswith("#"):
            continue
        buff.append(line)
        if ";" in line:
            joined = "\n".join(buff)
            buff = []
            for stmt in joined.split(";"):
                s = stmt.strip()
                if s:
                    parts.append(s)
    tail = "\n".join(buff).strip()
    if tail:
        parts.append(tail)
    return parts


async def _db_run_bootstrap(conn, sql_path: pathlib.Path) -> None:
    if not sql_path.exists():
        raise LauncherError(f"Missing SQL bootstrap file: {sql_path}")

    sql_text = sql_path.read_text(encoding="utf-8")
    statements = _split_sql_statements(sql_text)
    if not statements:
        raise LauncherError(f"No SQL statements found in: {sql_path}")

    _log(f"Applying DB bootstrap from {sql_path.name} ({len(statements)} statements)")
    async with conn.cursor() as cur:
        for stmt in statements:
            try:
                await cur.execute(stmt)
            except Exception as exc:
                raise LauncherError(f"DB bootstrap failed on statement:\n{stmt}\nError: {exc}")


def _import_sql_via_mysql_client(
    params: dict[str, Any],
    *,
    sql_path: pathlib.Path,
    mysql_client: str = "mysql",
) -> None:
    if not sql_path.exists():
        raise LauncherError(f"SDE SQL file not found: {sql_path}")

    env = os.environ.copy()
    # Use env var so password isn't visible in process list.
    env["MYSQL_PWD"] = str(params["password"])

    cmd = [
        mysql_client,
        "-h",
        str(params["host"]),
        "-P",
        str(params["port"]),
        "-u",
        str(params["user"]),
        str(params["db"]),
    ]
    _log(f"Importing SDE via {mysql_client}: {sql_path}")
    try:
        with open(sql_path, "rb") as f:
            proc = subprocess.run(cmd, env=env, stdin=f, text=False, capture_output=True, timeout=60 * 60)
    except FileNotFoundError:
        raise LauncherError(
            f"mysql client not found: '{mysql_client}'. Install MariaDB/MySQL client or set database.sde_import.mysql_client"
        )
    except subprocess.TimeoutExpired:
        raise LauncherError("SDE import timed out")

    if proc.returncode != 0:
        stderr = (proc.stderr or b"")[:4000].decode("utf-8", errors="replace")
        stdout = (proc.stdout or b"")[:4000].decode("utf-8", errors="replace")
        raise LauncherError(f"SDE import failed (exit={proc.returncode})\nstdout={stdout}\nstderr={stderr}")


async def ensure_database_ready(cfg: dict[str, Any], env: dict[str, str]) -> None:
    params = _get_db_params_from_env(env)

    repo = _get_repo_path(cfg)

    db_cfg = cfg.get("database") or {}
    if not isinstance(db_cfg, dict):
        raise LauncherError("config.database must be an object")
    create_database = bool(db_cfg.get("create_database", True))
    require_sde = bool(db_cfg.get("require_sde_tables", False))
    sde_import_cfg = db_cfg.get("sde_import") or {}
    if not isinstance(sde_import_cfg, dict):
        raise LauncherError("config.database.sde_import must be an object")

    ccp_jsonl_dir = sde_import_cfg.get("ccp_jsonl_dir")

    await _db_ensure_database(params, create_db=create_database)

    conn = await _db_connect(
        host=params["host"],
        port=int(params["port"]),
        user=params["user"],
        password=params["password"],
        db=params["db"],
    )
    try:
        # base connectivity
        await _db_count(conn, "SELECT 1")

        required_tables = [
            "corpAssets",
            "corpAssetsTemp",
            "corpAssetsIDs",
            "corpAssetsNames",
            "corpNames",
            "corpHangars",
            "corpJobs",
            "corpWalletJournal",
            "corpWalletTransactions",
            "corpUserInfo",
        ]

        missing = []
        for t in required_tables:
            if not await _db_table_exists(conn, params["db"], t):
                missing.append(t)

        # also treat empty corpHangars as "not ready"
        if not missing:
            hangars_cnt = await _db_count(conn, "SELECT COUNT(*) FROM corpHangars")
            if hangars_cnt < 1:
                missing.append("corpHangars(seed)")

        if missing:
            _log("DB not ready; missing: " + ", ".join(missing))
            await _db_run_bootstrap(conn, DBINIT_SQL_PATH)
        else:
            _log("DB schema OK")

        if require_sde:
            sde_tables = [
                "invTypes",
                "invGroups",
                "invCategories",
                "industryActivity",
                "industryActivityProducts",
                "industryActivityMaterials",
                "industryBlueprints",
            ]
            sde_missing = []
            for t in sde_tables:
                if not await _db_table_exists(conn, params["db"], t):
                    sde_missing.append(t)
            # If CCP JSONL is configured, prefer importing from there (and keep it up to date by buildNumber).
            if ccp_jsonl_dir:
                try:
                    from py_backend.sde_ccp_importer import (
                        get_imported_build_number,
                        import_minimal_sde_from_ccp_jsonl,
                        read_ccp_sde_build_info,
                    )

                    ccp_dir = _resolve_repo_relative(repo, ccp_jsonl_dir)
                    build = read_ccp_sde_build_info(ccp_dir)
                    imported = await get_imported_build_number(conn)
                    if imported != int(build["buildNumber"]):
                        _log(
                            "Importing minimal SDE from CCP JSONL "
                            + f"(build {build['buildNumber']}, previously {imported})"
                        )
                        await import_minimal_sde_from_ccp_jsonl(conn, ccp_dir)
                    else:
                        _log(f"CCP SDE already imported (build {imported})")
                except Exception as exc:
                    raise LauncherError(f"CCP JSONL SDE import failed: {exc}")

                # Re-check after CCP import
                sde_missing = []
                for t in sde_tables:
                    if not await _db_table_exists(conn, params["db"], t):
                        sde_missing.append(t)

            # Fallback: old SQL import path (Fuzzwork-style) if still configured.
            if sde_missing:
                sql_path = sde_import_cfg.get("sql_path")
                mysql_client = str(sde_import_cfg.get("mysql_client") or "mysql")
                if sql_path:
                    _import_sql_via_mysql_client(
                        {**params, "password": params["password"]},
                        sql_path=_resolve_repo_relative(repo, sql_path),
                        mysql_client=mysql_client,
                    )

                    sde_missing = []
                    for t in sde_tables:
                        if not await _db_table_exists(conn, params["db"], t):
                            sde_missing.append(t)

            if sde_missing:
                raise LauncherError(
                    "Missing required SDE tables in DB: "
                    + ", ".join(sde_missing)
                    + ". Set database.sde_import.ccp_jsonl_dir (preferred) or provide database.sde_import.sql_path."
                )
            _log("SDE tables OK")
    finally:
        conn.close()


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="All-in-one backend launcher (DB check + git auto-update + restart)")
    parser.add_argument("--config", default=str(DEFAULT_CONFIG_PATH), help="Path to launcher_config.json")
    parser.add_argument("--dry-run", action="store_true", help="Do not stop/start/pull; only print decisions")
    parser.add_argument("--force-restart", action="store_true", help="Restart backend even if not needed")
    parser.add_argument("--force-update", action="store_true", help="Attempt git pull even outside restart window")

    args = parser.parse_args(argv)

    cfg_path = pathlib.Path(args.config).expanduser().resolve()
    cfg = _parse_config(cfg_path)
    repo = _get_repo_path(cfg)

    _acquire_lock(LOCK_PATH)
    try:
        state = _read_json(STATE_PATH)
        now_utc = _utcnow()

        now_local = _local_now()
        in_restart_window = _should_restart_window(cfg, now_local)
        restart_window_cfg = cfg.get("restart_window") or {}
        if not isinstance(restart_window_cfg, dict):
            raise LauncherError("config.restart_window must be an object")
        restart_even_if_no_git_change = bool(restart_window_cfg.get("restart_even_if_no_git_change", True))
        restart_key = _restart_window_key(cfg, now_local)
        restart_window_already_done = bool(restart_key and state.get("last_restart_window_key") == restart_key)
        restart_window_hit = bool(restart_key and not restart_window_already_done)

        git_cfg = cfg.get("git") or {}
        if not isinstance(git_cfg, dict):
            raise LauncherError("config.git must be an object")
        git_enabled = bool(git_cfg.get("enabled", True))

        git_check_interval_minutes = _parse_interval_minutes(git_cfg.get("check_interval_minutes"), default=60)
        pull_on_new_version = bool(git_cfg.get("pull_on_new_version", True))

        update_available = False
        old_head = None
        new_head = None

        should_git_check = False
        if git_enabled and _is_git_repo(repo):
            should_git_check = _should_run_interval(
                state,
                key="last_git_check_utc",
                interval_minutes=git_check_interval_minutes,
                now_utc=now_utc,
            )
            # If restart window hit, always check git (even if interval not elapsed)
            if restart_window_hit:
                should_git_check = True
            if args.force_update:
                should_git_check = True

            if should_git_check:
                try:
                    old_head = _git_head(cfg, repo, "HEAD")
                    _git_fetch(cfg, repo)
                    # upstream head might not exist if no tracking branch; handle gracefully
                    try:
                        upstream = _git_head(cfg, repo, "@{u}")
                        update_available = upstream != old_head
                    except LauncherError:
                        update_available = False
                    new_head = old_head
                    state["last_git_check_utc"] = now_utc.isoformat()
                except Exception as exc:
                    _log(f"Git check failed (continuing without update): {exc}")
            else:
                _log("Git check skipped (interval not elapsed)")
        else:
            if git_enabled:
                _log("Git disabled or repo not found; skipping auto-update")

        should_restart_due_to_git = bool(update_available and in_restart_window) or bool(update_available and args.force_update)
        should_restart_in_window = bool(in_restart_window and (restart_even_if_no_git_change or update_available))

        running = backend_is_running(PID_PATH)

        _log(
            "Decision: "
            + f"running={running} "
            + f"update_available={update_available} "
            + f"in_restart_window={in_restart_window} "
            + f"restart_even_if_no_git_change={restart_even_if_no_git_change} "
            + f"restart_window_hit={restart_window_hit} "
            + f"force_restart={args.force_restart} "
            + f"force_update={args.force_update}"
        )

        if args.dry_run:
            return 0

        pulled = False

        # If a new version is available, update + restart.
        # Also allow --force-update to pull (even if no update was detected).
        if (update_available and pull_on_new_version) or args.force_update:
            preserve_paths = _get_preserve_paths(cfg)
            snapshot = _preserve_snapshot(repo, preserve_paths)

            if running:
                stop_backend(PID_PATH)
                running = False
            try:
                if old_head is None:
                    old_head = _git_head(cfg, repo, "HEAD")
                _git_pull_ff_only(cfg, repo)
                new_head = _git_head(cfg, repo, "HEAD")
                pulled = new_head != old_head
                if pulled:
                    _log(f"Updated git: {old_head} -> {new_head}")
                else:
                    _log("Git already up-to-date")

                # Ensure local ignored content wasn't lost during update.
                _restore_preserved(repo, snapshot, preserve_paths)
            except Exception as exc:
                raise LauncherError(f"Git pull failed: {exc}")

        # Planned restart window: optionally restart even without git change.
        if args.force_restart or restart_window_hit:
            state["last_restart_window_key"] = restart_key
            if running and (args.force_restart or should_restart_in_window):
                stop_backend(PID_PATH)
                running = False

        # DB check/bootstrap before (re)start.
        env = _get_backend_env(cfg)
        asyncio.run(ensure_database_ready(cfg, env))

        # Start when not running OR when restart window/forced restart happened.
        running = backend_is_running(PID_PATH)
        if not running:
            start_backend(cfg, pid_path=PID_PATH)
        else:
            # If it is running and we didn't stop it, we leave it as-is.
            _log("Backend already running; no restart requested")

        # Persist state
        state["last_run_utc"] = _utcnow().isoformat()
        state["last_git_head"] = new_head or old_head
        state["last_git_pulled"] = bool(pulled)
        state["last_in_restart_window"] = bool(in_restart_window)
        _write_json(STATE_PATH, state)

        return 0
    finally:
        _release_lock(LOCK_PATH)


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except LauncherError as exc:
        _log(f"ERROR: {exc}")
        raise SystemExit(1)
