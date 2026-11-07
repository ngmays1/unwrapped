import hashlib
import os
from typing import Any

import httpx


class NavidromeClient:
    """Minimal Navidrome client for now-playing and auth."""

    def __init__(self):
        self.base_url = os.getenv("NAVIDROME_URL")
        if not self.base_url:
            raise ValueError("NAVIDROME_URL required")
        self.username = os.getenv("NAVIDROME_USERNAME")
        self.password = os.getenv("NAVIDROME_PASSWORD")
        if not self.username or not self.password:
            raise ValueError("NAVIDROME_USERNAME and NAVIDROME_PASSWORD required")
        self.client = httpx.AsyncClient(timeout=httpx.Timeout(30.0))
        self._subsonic_token: str | None = None
        self._subsonic_salt: str | None = None

    async def _ensure_authenticated(self):
        if self._subsonic_token and self._subsonic_salt:
            return
        try:
            resp = await self.client.post(
                f"{self.base_url}/auth/login",
                json={"username": self.username, "password": self.password},
            )
            resp.raise_for_status()
            data = resp.json()
            self._subsonic_token = data.get("subsonicToken")
            self._subsonic_salt = data.get("subsonicSalt")
        except Exception:
            # Fallback: generate token
            salt = hashlib.md5(os.urandom(16)).hexdigest()[:12]
            self._subsonic_salt = salt
            self._subsonic_token = hashlib.md5((self.password + salt).encode("utf-8")).hexdigest()

    def _subsonic_params(self) -> dict[str, Any]:
        return {
            "u": self.username,
            "t": self._subsonic_token,
            "s": self._subsonic_salt,
            "v": "1.16.1",
            "c": "unwrapped",
            "f": "json",
        }

    async def get_now_playing(self) -> dict[str, Any]:
        await self._ensure_authenticated()
        params = self._subsonic_params()
        resp = await self.client.get(f"{self.base_url}/rest/getNowPlaying.view", params=params)
        resp.raise_for_status()
        data = resp.json()
        return data.get("subsonic-response", {})

    async def close(self):
        await self.client.aclose()
