import json
import logging
from typing import Any

from .database import DatabaseManager
from .lb_client import ListenBrainzClient

logger = logging.getLogger("unwrapped.scheduler")

# Meta keys used to make the historical backfill resumable across runs.
BACKFILL_COMPLETE_KEY = "backfill_complete"
BACKFILL_CURSOR_KEY = "backfill_cursor"

# ListenBrainz caps a single page at 1000 listens (MAX_ITEMS_PER_GET).
MAX_PAGE_SIZE = 1000


class SyncService:
    def __init__(self, db: DatabaseManager, lb: ListenBrainzClient):
        self.db = db
        self.lb = lb

    def _normalize(self, listens: list[dict[str, Any]]) -> list[dict[str, Any]]:
        out: list[dict[str, Any]] = []
        for l in listens:
            if l.get("playing_now"):
                continue
            ts = l.get("listened_at")
            if ts is None:
                continue
            try:
                ts_int = int(ts)
            except (TypeError, ValueError):
                continue
            tm = l.get("track_metadata", {}) or {}
            add = tm.get("additional_info", {}) or {}
            artist_mbids = add.get("artist_mbids") or []
            out.append({
                "listened_at": ts_int,
                "recording_mbid": add.get("recording_mbid") or "",
                "artist_mbids_json": json.dumps(artist_mbids) if isinstance(artist_mbids, list) else "",
                "artist_name": tm.get("artist_name") or "",
                "release_mbid": add.get("release_mbid") or "",
                "album_name": tm.get("release_name") or "",
                "track_name": tm.get("track_name") or "",
                "duration_ms": add.get("duration_ms") or 0,
            })
        return out

    async def sync_listens(self, page_size: int = MAX_PAGE_SIZE, max_pages: int = 50) -> int:
        """Sync listens from ListenBrainz.

        Two directions are combined so the archive ends up covering the user's
        full history, not just the time since the app was first installed:

        - **Incremental (forward):** fetch listens newer than the stored
          ``last_sync_ts`` high-water mark.
        - **Backfill (backward):** page back through older history until the very
          first listen is reached. Progress is persisted in ``meta`` so large
          libraries resume across runs instead of restarting from scratch.
        """
        page_size = max(1, min(page_size, MAX_PAGE_SIZE))
        inserted = await self._sync_new_listens(page_size, max_pages)
        inserted += await self._backfill_history(page_size, max_pages)
        return inserted

    async def _sync_new_listens(self, page_size: int, max_pages: int) -> int:
        """Fetch listens newer than the ``last_sync_ts`` cursor (forward sync)."""
        last_ts = await self.db.get_last_sync_ts()
        inserted = 0
        cursor: int | None = last_ts
        newest = last_ts

        for _ in range(max_pages):
            listens = await self.lb.get_listens(min_ts=cursor, count=page_size)
            norm = self._normalize(listens)
            if not norm:
                break
            await self.db.insert_listens(norm)
            inserted += len(norm)
            batch_max = max(x["listened_at"] for x in norm)
            if newest is None or batch_max > newest:
                newest = batch_max
            if cursor is not None and batch_max <= cursor:
                break
            cursor = batch_max
            if len(listens) < page_size:
                break

        if newest is not None and (last_ts is None or newest > last_ts):
            await self.db.set_last_sync_ts(newest)
        if inserted:
            logger.info("Incremental sync: %d listens, last_ts=%s", inserted, newest)
        return inserted

    async def _backfill_history(self, page_size: int, max_pages: int) -> int:
        """Import history older than the archive's oldest listen (backward sync).

        Pages backwards using ``max_ts``. Each run makes at most ``max_pages``
        requests and stores ``backfill_cursor`` so the next run continues where
        this one stopped. ``backfill_complete`` marks the archive as having
        reached the user's earliest listen.
        """
        if await self.db.get_meta(BACKFILL_COMPLETE_KEY) == "1":
            return 0

        cursor_str = await self.db.get_meta(BACKFILL_CURSOR_KEY)
        try:
            cursor: int | None = int(cursor_str) if cursor_str is not None else None
        except ValueError:
            cursor = None

        if cursor is None:
            # Resume from just before the oldest listen we already have so the
            # backfill picks up where the archive currently begins.
            cursor = await self.db.get_first_listen_ts()

        inserted = 0
        for _ in range(max_pages):
            listens = await self.lb.get_listens(max_ts=cursor, count=page_size)
            norm = self._normalize(listens)
            if not norm:
                await self.db.set_meta(BACKFILL_COMPLETE_KEY, "1")
                logger.info("Backfill complete: reached the start of history")
                break

            await self.db.insert_listens(norm)
            inserted += len(norm)

            page_min = min(x["listened_at"] for x in norm)
            if cursor is not None and page_min >= cursor:
                # No backwards progress (e.g. every listen shares the boundary
                # timestamp). Stop rather than loop forever.
                await self.db.set_meta(BACKFILL_COMPLETE_KEY, "1")
                logger.info("Backfill complete: no older listens to page to")
                break

            cursor = page_min
            await self.db.set_meta(BACKFILL_CURSOR_KEY, str(cursor))

            if len(listens) < page_size:
                await self.db.set_meta(BACKFILL_COMPLETE_KEY, "1")
                logger.info("Backfill complete: reached the start of history")
                break
        else:
            logger.info(
                "Backfill paused after %d pages (%d listens); will resume on next sync",
                max_pages,
                inserted,
            )
        return inserted

