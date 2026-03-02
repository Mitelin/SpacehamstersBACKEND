from __future__ import annotations

import os
from dataclasses import dataclass


def _env(name: str, default: str | None = None) -> str | None:
    value = os.getenv(name)
    if value is None:
        return default
    return value


def _env_int(name: str, default: int | None = None) -> int | None:
    value = os.getenv(name)
    if value is None or value == "":
        return default
    return int(value)


@dataclass(frozen=True)
class Settings:
    # MariaDB
    db_host: str
    db_port: int
    db_user: str
    db_password: str
    db_name: str

    # EVE
    eve_api_base: str
    eve_token_api: str
    eve_client_id: str | None
    eve_client_secret: str | None

    # App
    corporation_id: int
    ceo_character_id: int
    log_level: int
    enable_scheduler: int


_settings: Settings | None = None


def get_settings() -> Settings:
    global _settings
    if _settings is not None:
        return _settings

    db_user = _env("DB_USER")
    db_password = _env("DB_PASSWORD")
    db_name = _env("DB_NAME")
    corporation_id = _env_int("CORPORATION_ID")
    ceo_character_id = _env_int("CEO_CHARACTER_ID")

    missing = [
        name
        for name, value in [
            ("DB_USER", db_user),
            ("DB_PASSWORD", db_password),
            ("DB_NAME", db_name),
            ("CORPORATION_ID", corporation_id),
            ("CEO_CHARACTER_ID", ceo_character_id),
        ]
        if value in (None, "")
    ]
    if missing:
        raise RuntimeError(f"Missing required env vars: {', '.join(missing)}")

    _settings = Settings(
        db_host=_env("DB_HOST", "127.0.0.1") or "127.0.0.1",
        db_port=_env_int("DB_PORT", 3306) or 3306,
        db_user=str(db_user),
        db_password=str(db_password),
        db_name=str(db_name),
        eve_api_base=_env("EVE_API_BASE", "https://esi.evetech.net/latest") or "https://esi.evetech.net/latest",
        eve_token_api=_env("EVE_TOKEN_API", "https://login.eveonline.com/v2/oauth/token")
        or "https://login.eveonline.com/v2/oauth/token",
        eve_client_id=_env("EVE_CLIENT_ID"),
        eve_client_secret=_env("EVE_CLIENT_SECRET"),
        corporation_id=int(corporation_id),
        ceo_character_id=int(ceo_character_id),
        log_level=_env_int("LOG_LEVEL", 2) or 2,
        enable_scheduler=_env_int("ENABLE_SCHEDULER", 0) or 0,
    )
    return _settings
