from __future__ import annotations

import base64
import json
from dataclasses import dataclass
from datetime import datetime, timezone
from typing import Any

import httpx

from .. import db
from ..esi import ESIClient
from ..logger import log
from ..settings import get_settings


def _b64url_decode(data: str) -> bytes:
    padding = "=" * (-len(data) % 4)
    return base64.urlsafe_b64decode(data + padding)


@dataclass
class ParsedJWT:
    name: str | None
    user_id: int


def parse_jwt(token: str) -> ParsedJWT:
    base64_part = token.split(".")[1]
    decoded = json.loads(_b64url_decode(base64_part).decode("utf-8"))
    sub = decoded.get("sub", "")
    user_id = int(str(sub).split(":")[2])
    return ParsedJWT(name=decoded.get("name"), user_id=user_id)


class UserInfoService:
    def __init__(self, esi: ESIClient):
        self._esi = esi
        self._settings = get_settings()

    async def store(self, user_info: dict[str, Any]) -> None:
        log(2, "userInfo.store()")
        user = parse_jwt(user_info["access_token"])
        await db.execute(
            "REPLACE INTO corpUserInfo (userID, date, accessToken, refreshToken, expiresIn) VALUES (?,?,?,?,?)",
            [
                user.user_id,
                datetime.now(timezone.utc).replace(tzinfo=None),
                user_info.get("access_token"),
                user_info.get("refresh_token"),
                user_info.get("expires_in"),
            ],
        )

    async def get_user_corporation_id(self, access_token: str) -> int:
        log(2, "userInfo.getUserCorporationId()")
        user = parse_jwt(access_token)
        response = await self._esi.get(f"/characters/{user.user_id}", token=access_token)
        data = response.json()
        corp_id = int(data["corporation_id"])
        log(1, f"userInfo.getUserCorporationId(): corporationId is {corp_id}")
        return corp_id

    async def get_ceo_access_token(self) -> str:
        row = await db.fetch_one(
            "SELECT date, accessToken, refreshToken, expiresIn FROM corpUserInfo WHERE userID = ?",
            [self._settings.ceo_character_id],
        )
        if not row:
            raise RuntimeError("CEO UserInfo není v databázi")

        issued: datetime = row["date"]
        now = datetime.now(timezone.utc).replace(tzinfo=None)
        diff_seconds = (now - issued).total_seconds()
        expiration = max(int(row["expiresIn"]) - int(diff_seconds), 0)

        if expiration >= 300:
            log(1, f"userInfo.getCEOAccessToken(): returning existing access token with expiration {expiration}")
            return str(row["accessToken"])

        log(1, f"userInfo.getCEOAccessToken(): Trying to refresh access token for user id {self._settings.ceo_character_id}")
        if not self._settings.eve_client_id or not self._settings.eve_client_secret:
            raise RuntimeError("EVE_CLIENT_ID / EVE_CLIENT_SECRET missing")

        auth = base64.b64encode(
            f"{self._settings.eve_client_id}:{self._settings.eve_client_secret}".encode("utf-8")
        ).decode("ascii")
        headers = {
            "Content-Type": "application/x-www-form-urlencoded",
            "Accept": "application/json",
            "Authorization": f"Basic {auth}",
        }
        form = {"grant_type": "refresh_token", "refresh_token": row["refreshToken"]}

        async with httpx.AsyncClient(timeout=60.0) as client:
            response = await client.post(self._settings.eve_token_api, data=form, headers=headers)
        response.raise_for_status()
        token_json = response.json()

        await self.store(token_json)
        log(1, "userInfo.getCEOAccessToken(): Token updated")
        return str(token_json["access_token"])

    async def validate_token(self, authorization_header: str | None) -> str:
        if not authorization_header:
            raise RuntimeError("No token")
        split = authorization_header.split(" ")
        if len(split) != 2 or split[0] != "Bearer":
            raise RuntimeError("Invalid token")
        access_token = split[1]
        corp_id = await self.get_user_corporation_id(access_token)
        if corp_id != self._settings.corporation_id:
            raise RuntimeError("Unauthorized corporation member")
        return access_token
