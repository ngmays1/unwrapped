import os
from typing import Any

import aiosqlite


class DatabaseManager:
    """SQLite database manager for unwrapped."""

    def __init__(self, db_path: str = "/app/data/unwrapped.db"):
        self.db_path = db_path

    async def _exec_pragmas(self, db: aiosqlite.Connection):
        await db.execute("PRAGMA journal_mode=WAL")
        await db.execute("PRAGMA synchronous=NORMAL")
        await db.execute("PRAGMA foreign_keys=ON")

    async def init_db(self):
        os.makedirs(os.path.dirname(self.db_path), exist_ok=True)
        async with aiosqlite.connect(self.db_path) as db:
            await self._exec_pragmas(db)
            await db.execute("""
                CREATE TABLE IF NOT EXISTS listens (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    listened_at INTEGER NOT NULL,
                    recording_mbid TEXT,
                    artist_mbids TEXT,
                    artist_name TEXT,
                    release_mbid TEXT,
                    album_name TEXT,
                    track_name TEXT,
                    duration_ms INTEGER,
                    inserted_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                    UNIQUE(listened_at, track_name, artist_name)
                )
            """)
            await db.execute("CREATE INDEX IF NOT EXISTS idx_listens_listened_at ON listens(listened_at)")
            await db.execute("CREATE INDEX IF NOT EXISTS idx_listens_artist ON listens(artist_name)")
            await db.execute("CREATE INDEX IF NOT EXISTS idx_listens_track ON listens(track_name)")

            await db.execute("""
                CREATE TABLE IF NOT EXISTS meta (
                    key TEXT PRIMARY KEY,
                    value TEXT NOT NULL,
                    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
                )
            """)

            # Cover-art index mirrored from the Navidrome library. Purely additive:
            # the site runs fine when this table is empty (no art is shown).
            await db.execute("""
                CREATE TABLE IF NOT EXISTS nav_art (
                    cover_id TEXT PRIMARY KEY,
                    kind TEXT NOT NULL,
                    name TEXT NOT NULL,
                    norm_name TEXT NOT NULL,
                    artist TEXT NOT NULL DEFAULT '',
                    mbid TEXT NOT NULL DEFAULT '',
                    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
                )
            """)
            await db.execute(
                "CREATE INDEX IF NOT EXISTS idx_nav_art_lookup ON nav_art(kind, norm_name)"
            )
            await db.commit()

    async def get_meta(self, key: str) -> str | None:
        await self.init_db()
        async with aiosqlite.connect(self.db_path) as db:
            await self._exec_pragmas(db)
            async with db.execute("SELECT value FROM meta WHERE key=?", (key,)) as cur:
                row = await cur.fetchone()
                return row[0] if row else None

    async def set_meta(self, key: str, value: str):
        await self.init_db()
        async with aiosqlite.connect(self.db_path) as db:
            await self._exec_pragmas(db)
            await db.execute("INSERT OR REPLACE INTO meta (key, value, updated_at) VALUES (?,?,CURRENT_TIMESTAMP)",
                              (key, value))
            await db.commit()

    async def get_last_sync_ts(self) -> int | None:
        v = await self.get_meta("last_sync_ts")
        try:
            return int(v) if v is not None else None
        except ValueError:
            return None

    async def set_last_sync_ts(self, ts: int):
        await self.set_meta("last_sync_ts", str(ts))

    async def replace_nav_art(self, rows: list[tuple[str, str, str, str, str, str]]):
        """Swap the whole cover-art index.

        Each row is (cover_id, kind, name, norm_name, artist, mbid).
        """
        await self.init_db()
        async with aiosqlite.connect(self.db_path) as db:
            await self._exec_pragmas(db)
            await db.execute("DELETE FROM nav_art")
            await db.executemany(
                "INSERT OR REPLACE INTO nav_art (cover_id, kind, name, norm_name, artist, mbid) "
                "VALUES (?,?,?,?,?,?)",
                rows,
            )
            await db.commit()

    async def get_nav_art(self) -> list[tuple[str, str, str, str, str, str]]:
        await self.init_db()
        async with aiosqlite.connect(self.db_path) as db:
            await self._exec_pragmas(db)
            async with db.execute(
                "SELECT cover_id, kind, name, norm_name, artist, mbid FROM nav_art"
            ) as cur:
                return list(await cur.fetchall())

    async def get_first_listen_ts(self) -> int | None:
        await self.init_db()
        async with aiosqlite.connect(self.db_path) as db:
            await self._exec_pragmas(db)
            async with db.execute("SELECT MIN(listened_at) FROM listens") as cur:
                row = await cur.fetchone()
                return int(row[0]) if row and row[0] is not None else None

    async def insert_listens(self, listens: list[dict[str, Any]]):
        if not listens:
            return
        await self.init_db()
        async with aiosqlite.connect(self.db_path) as db:
            await self._exec_pragmas(db)
            for l in listens:
                await db.execute("""
                    INSERT OR IGNORE INTO listens
                    (listened_at, recording_mbid, artist_mbids, artist_name, release_mbid, album_name, track_name, duration_ms)
                    VALUES (?,?,?,?,?,?,?,?)
                """, (
                    l.get("listened_at"),
                    l.get("recording_mbid"),
                    l.get("artist_mbids_json"),
                    l.get("artist_name"),
                    l.get("release_mbid"),
                    l.get("album_name"),
                    l.get("track_name"),
                    l.get("duration_ms"),
                ))
            await db.commit()

    async def query_listens(self, start_ts: int | None, end_ts: int | None, limit: int | None = None) -> list[dict[str, Any]]:
        await self.init_db()
        clauses = []
        params: list[Any] = []
        if start_ts is not None:
            clauses.append("listened_at >= ?")
            params.append(start_ts)
        if end_ts is not None:
            clauses.append("listened_at < ?")
            params.append(end_ts)
        where = "WHERE " + " AND ".join(clauses) if clauses else ""
        sql = f"SELECT listened_at, artist_name, album_name, track_name, duration_ms, recording_mbid FROM listens {where} ORDER BY listened_at ASC"
        if limit:
            sql += f" LIMIT {limit}"
        async with aiosqlite.connect(self.db_path) as db:
            await self._exec_pragmas(db)
            async with db.execute(sql, params) as cur:
                rows = await cur.fetchall()
                return [
                    {
                        "listened_at": r[0],
                        "artist_name": r[1],
                        "album_name": r[2],
                        "track_name": r[3],
                        "duration_ms": r[4] or 0,
                        "recording_mbid": r[5],
                    }
                    for r in rows
                ]
