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

    async def subsonic(self, endpoint: str, **params: Any) -> dict[str, Any]:
        """Call a Subsonic endpoint and return the unwrapped response body."""
        await self._ensure_authenticated()
        resp = await self.client.get(
            f"{self.base_url}/rest/{endpoint}", params={**self._subsonic_params(), **params}
        )
        resp.raise_for_status()
        return resp.json().get("subsonic-response", {}) or {}

    async def get_now_playing(self) -> dict[str, Any]:
        return await self.subsonic("getNowPlaying.view")

    async def get_album_index(self, page_size: int = 500, max_pages: int = 40) -> list[dict[str, Any]]:
        """Page through the whole album library (name, artist, coverArt, musicBrainzId)."""
        albums: list[dict[str, Any]] = []
        for page in range(max_pages):
            data = await self.subsonic(
                "getAlbumList2.view",
                type="alphabeticalByName",
                size=page_size,
                offset=page * page_size,
            )
            batch = (data.get("albumList2") or {}).get("album") or []
            albums.extend(batch)
            if len(batch) < page_size:
                break
        return albums

    async def get_artist_index(self) -> list[dict[str, Any]]:
        """Return every artist entry (name, coverArt, musicBrainzId) in the library."""
        data = await self.subsonic("getArtists.view")
        artists: list[dict[str, Any]] = []
        for index in (data.get("artists") or {}).get("index") or []:
            artists.extend(index.get("artist") or [])
        return artists

    async def get_cover_art(self, cover_id: str, size: int = 128) -> tuple[str, bytes]:
        """Fetch cover-art bytes. Returns (content_type, body)."""
        await self._ensure_authenticated()
        resp = await self.client.get(
            f"{self.base_url}/rest/getCoverArt.view",
            params={**self._subsonic_params(), "id": cover_id, "size": size},
        )
        resp.raise_for_status()
        return resp.headers.get("content-type", "image/jpeg"), resp.content

    async def close(self):
        await self.client.aclose()
