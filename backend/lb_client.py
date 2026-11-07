import asyncio
import logging
import os
from typing import Any

import httpx

logger = logging.getLogger("unwrapped.lb")

LISTENBRAINZ_API_BASE = "https://api.listenbrainz.org"


class ListenBrainzClient:
    def __init__(self):
        self.username = os.getenv("LISTENBRAINZ_USERNAME")
        self.token = os.getenv("LISTENBRAINZ_TOKEN")
        if not self.username or not self.token:
            raise ValueError("LISTENBRAINZ_USERNAME and LISTENBRAINZ_TOKEN required")
        self.client = httpx.AsyncClient(
            timeout=httpx.Timeout(60.0),
            headers={
                "Authorization": f"Token {self.token}",
                "User-Agent": "unwrapped/1.0",
            },
        )
        self._max_retries = 5
        self._base_backoff = 0.5

    async def _request(self, method: str, url: str, **kwargs):
        for attempt in range(self._max_retries):
            try:
                resp = await self.client.request(method, url, **kwargs)
                if resp.status_code == 429:
                    retry_after = int(resp.headers.get("Retry-After", "0"))
                    sleep_s = retry_after or (self._base_backoff * (2 ** attempt))
                    await asyncio.sleep(sleep_s)
                    continue
                if resp.status_code >= 500:
                    await asyncio.sleep(self._base_backoff * (2 ** attempt))
                    continue
                resp.raise_for_status()
                return resp
            except httpx.HTTPStatusError:
                if attempt == self._max_retries - 1:
                    raise
                await asyncio.sleep(self._base_backoff * (2 ** attempt))
            except Exception:
                if attempt == self._max_retries - 1:
                    raise
                await asyncio.sleep(self._base_backoff * (2 ** attempt))
        return None

    async def get_listens(self, max_ts: int | None = None, min_ts: int | None = None, count: int = 1000) -> list[dict[str, Any]]:
        url = f"{LISTENBRAINZ_API_BASE}/1/user/{self.username}/listens"
        params: dict[str, Any] = {"count": count}
        if max_ts is not None:
            params["max_ts"] = max_ts
        if min_ts is not None:
            params["min_ts"] = min_ts
        resp = await self._request("GET", url, params=params)
        if resp is None:
            return []
        data = resp.json()
        payload = data.get("payload", {})
        listens = payload.get("listens", [])
        return listens

    async def get_year_in_review(self, year: int):
        url = f"{LISTENBRAINZ_API_BASE}/1/stats/user/{self.username}/year-in-review/{year}"
        try:
            resp = await self._request("GET", url)
        except httpx.HTTPStatusError:
            return {}
        if resp is None or resp.status_code == 404:
            return {}
        return resp.json().get("payload", {})

    async def close(self):
        await self.client.aclose()
