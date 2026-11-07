from collections import defaultdict
from datetime import datetime
from typing import Any

from .util import LOCAL_TZ


class StatsEngine:
    def __init__(self, db):
        self.db = db

    def _ts_to_local_date(self, ts: int) -> datetime:
        try:
            dt = datetime.fromtimestamp(ts, tz=LOCAL_TZ)
            return dt
        except Exception:
            return datetime.fromtimestamp(ts)

    def _month_bounds(self, year: int, month: int) -> tuple[int, int]:
        start = datetime(year, month, 1, tzinfo=LOCAL_TZ)
        if month == 12:
            end = datetime(year + 1, 1, 1, tzinfo=LOCAL_TZ)
        else:
            end = datetime(year, month + 1, 1, tzinfo=LOCAL_TZ)
        return int(start.timestamp()), int(end.timestamp())

    def _year_bounds(self, year: int) -> tuple[int, int]:
        start = datetime(year, 1, 1, tzinfo=LOCAL_TZ)
        end = datetime(year + 1, 1, 1, tzinfo=LOCAL_TZ)
        return int(start.timestamp()), int(end.timestamp())

    async def range_stats(self, start_ts: int | None, end_ts: int | None) -> dict[str, Any]:
        listens = await self.db.query_listens(start_ts, end_ts)
        if not listens:
            return {
                "total_listens": 0,
                "total_minutes": 0,
                "top_tracks": [],
                "top_artists": [],
                "top_albums": [],
                "busiest_day": None,
                "busiest_day_listens": 0,
                "hour_hist": [0] * 24,
                "weekday_hist": [0] * 7,
                "weekday_hour_hist": [[0] * 24 for _ in range(7)],
                "unique_artists": 0,
                "unique_tracks": 0,
                "unique_albums": 0,
                "first_listen_ts": None,
                "last_listen_ts": None,
            }

        total_listens = len(listens)
        total_ms = sum(l.get("duration_ms", 0) for l in listens)
        total_minutes = round(total_ms / 60000.0, 2)

        track_counter: dict[tuple[str,str], int] = defaultdict(int)
        artist_counter: dict[str, int] = defaultdict(int)
        album_counter: dict[tuple[str,str], int] = defaultdict(int)
        for l in listens:
            track_key = (l.get("track_name") or "", l.get("artist_name") or "")
            artist_key = l.get("artist_name") or ""
            album_key = (l.get("album_name") or "", artist_key)
            track_counter[track_key] += 1
            artist_counter[artist_key] += 1
            album_counter[album_key] += 1

        top_tracks = [
            {"track": t[0][0], "artist": t[0][1], "count": t[1]}
            for t in sorted(track_counter.items(), key=lambda x: x[1], reverse=True)[:25]
        ]
        top_artists = [
            {"artist": a[0], "count": a[1]}
            for a in sorted(artist_counter.items(), key=lambda x: x[1], reverse=True)[:25]
        ]
        top_albums = [
            {"album": al[0][0], "artist": al[0][1], "count": al[1]}
            for al in sorted(album_counter.items(), key=lambda x: x[1], reverse=True)[:25]
        ]

        day_counter: dict[str, int] = defaultdict(int)
        hour_hist = [0] * 24
        weekday_hist = [0] * 7
        weekday_hour_hist = [[0] * 24 for _ in range(7)]
        for l in listens:
            dt = self._ts_to_local_date(l.get("listened_at"))
            day_counter[dt.date().isoformat()] += 1
            hour_hist[dt.hour] += 1
            weekday_hist[dt.weekday()] += 1  # dt.weekday(): Monday = 0
            weekday_hour_hist[dt.weekday()][dt.hour] += 1

        if day_counter:
            busiest_day, busiest_day_listens = max(day_counter.items(), key=lambda x: x[1])
        else:
            busiest_day, busiest_day_listens = None, 0

        listen_timestamps = [l.get("listened_at") for l in listens if l.get("listened_at") is not None]

        return {
            "total_listens": total_listens,
            "total_minutes": total_minutes,
            "top_tracks": top_tracks,
            "top_artists": top_artists,
            "top_albums": top_albums,
            "busiest_day": busiest_day,
            "busiest_day_listens": busiest_day_listens,
            "hour_hist": hour_hist,
            "weekday_hist": weekday_hist,
            "weekday_hour_hist": weekday_hour_hist,
            "unique_artists": len(artist_counter),
            "unique_tracks": len(track_counter),
            "unique_albums": len(album_counter),
            "first_listen_ts": min(listen_timestamps) if listen_timestamps else None,
            "last_listen_ts": max(listen_timestamps) if listen_timestamps else None,
        }

    async def timeline(self, start_ts: int | None, end_ts: int | None, granularity: str = "day") -> dict[str, Any]:
        listens = await self.db.query_listens(start_ts, end_ts)
        buckets: dict[str, dict[str, float]] = defaultdict(lambda: {"listens": 0.0, "ms": 0.0})
        for l in listens:
            dt = self._ts_to_local_date(l.get("listened_at"))
            if granularity == "month":
                key = dt.strftime("%Y-%m")
            elif granularity == "week":
                iso = dt.isocalendar()
                key = f"{iso[0]}-W{iso[1]:02d}"
            else:
                key = dt.date().isoformat()
            buckets[key]["listens"] += 1
            buckets[key]["ms"] += l.get("duration_ms", 0) or 0
        series = [
            {"date": k, "listens": int(v["listens"]), "minutes": round(v["ms"] / 60000.0, 2)}
            for k, v in sorted(buckets.items())
        ]
        return {"granularity": granularity, "series": series}

    async def month_summary(self, year: int, month: int) -> dict[str, Any]:
        start_ts, end_ts = self._month_bounds(year, month)
        stats = await self.range_stats(start_ts, end_ts)
        listens = await self.db.query_listens(start_ts, end_ts)
        day_counter: dict[str, int] = defaultdict(int)
        for l in listens:
            day_counter[self._ts_to_local_date(l.get("listened_at")).date().isoformat()] += 1
        stats["year"] = year
        stats["month"] = month
        stats["daily"] = [{"date": k, "listens": v} for k, v in sorted(day_counter.items())]
        return stats

    async def year_summary(self, year: int) -> dict[str, Any]:
        start_ts, end_ts = self._year_bounds(year)
        stats = await self.range_stats(start_ts, end_ts)
        listens = await self.db.query_listens(start_ts, end_ts)
        month_counter: dict[str, int] = defaultdict(int)
        for l in listens:
            month_counter[self._ts_to_local_date(l.get("listened_at")).strftime("%Y-%m")] += 1
        stats["year"] = year
        stats["monthly"] = [{"month": k, "listens": v} for k, v in sorted(month_counter.items())]
        return stats
