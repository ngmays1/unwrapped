from collections import defaultdict
from datetime import date, datetime, timedelta
from typing import Any

from .util import LOCAL_TZ


class StatsEngine:
    def __init__(self, db, art=None):
        self.db = db
        self.art = art

    def _art_for(self, kind: str, name: str | None, artist: str | None = None) -> str | None:
        """Cover-art id for a ranked row, or None when it is not resolvable."""
        if self.art is None:
            return None
        return self.art.art_for(kind, name, artist)

    @staticmethod
    def _dominant_album(votes: dict[str, int] | None) -> str | None:
        """The album a track was most often played from."""
        if not votes:
            return None
        return max(votes.items(), key=lambda x: x[1])[0] or None

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

    async def track_search(self, query: str, limit: int = 15) -> list[dict[str, Any]]:
        rows = await self.db.search_tracks(query, limit)
        results = []
        for row in rows:
            item = dict(row)
            item["art"] = self._art_for("album", item.pop("album_name", ""), item["artist"])
            results.append(item)
        return results

    async def track_detail(self, track: str, artist: str) -> dict[str, Any] | None:
        listens = await self.db.get_track_listens(track, artist)
        if not listens:
            return None

        total_listens = len(listens)
        total_ms = sum(l.get("duration_ms", 0) or 0 for l in listens)
        total_minutes = round(total_ms / 60000.0, 2)

        album_counter: dict[str, int] = defaultdict(int)
        day_counter: dict[str, int] = defaultdict(int)
        week_counter: dict[tuple[int, int], dict[str, Any]] = {}
        month_counter: dict[str, dict[str, float]] = defaultdict(
            lambda: {"listens": 0, "ms": 0.0}
        )
        hour_hist = [0] * 24
        weekday_hist = [0] * 7
        weekday_hour_hist = [[0] * 24 for _ in range(7)]
        play_dates: set[date] = set()

        for l in listens:
            moment = self._ts_to_local_date(l.get("listened_at"))
            day = moment.date()
            play_dates.add(day)
            album_counter[l.get("album_name") or ""] += 1
            day_counter[day.isoformat()] += 1

            iso = moment.isocalendar()
            week_key = (iso[0], iso[1])
            if week_key not in week_counter:
                week_start = day - timedelta(days=day.weekday())
                week_counter[week_key] = {
                    "week": f"{iso[0]}-W{iso[1]:02d}",
                    "start": week_start.isoformat(),
                    "end": (week_start + timedelta(days=6)).isoformat(),
                    "listens": 0,
                }
            week_counter[week_key]["listens"] += 1

            month_key = moment.strftime("%Y-%m")
            month_counter[month_key]["listens"] += 1
            month_counter[month_key]["ms"] += l.get("duration_ms", 0) or 0
            hour_hist[moment.hour] += 1
            weekday_hist[moment.weekday()] += 1
            weekday_hour_hist[moment.weekday()][moment.hour] += 1

        days = sorted(day_counter.items(), key=lambda x: (x[1], x[0]), reverse=True)
        top_days = [{"date": d, "listens": c} for d, c in days[:5]]
        busiest_day = top_days[0] if top_days else None

        weeks = sorted(
            week_counter.values(), key=lambda w: (w["listens"], w["start"]), reverse=True
        )
        top_weeks = weeks[:5]
        busiest_week = top_weeks[0] if top_weeks else None

        longest_streak: dict[str, Any] = {"days": 0, "start": None, "end": None}
        run_start: date | None = None
        run_length = 0
        previous: date | None = None
        for day in sorted(play_dates):
            if previous is not None and (day - previous).days == 1:
                run_length += 1
            else:
                run_start = day
                run_length = 1
            if run_length > longest_streak["days"]:
                longest_streak = {
                    "days": run_length,
                    "start": run_start.isoformat() if run_start else None,
                    "end": day.isoformat(),
                }
            previous = day

        monthly = []
        sorted_dates = sorted(play_dates)
        if sorted_dates:
            cursor = sorted_dates[0].replace(day=1)
            end_month = sorted_dates[-1].replace(day=1)
            while cursor <= end_month:
                key = cursor.strftime("%Y-%m")
                bucket = month_counter.get(key, {"listens": 0, "ms": 0.0})
                monthly.append(
                    {
                        "month": key,
                        "listens": int(bucket["listens"]),
                        "minutes": round(bucket["ms"] / 60000.0, 2),
                    }
                )
                cursor = (cursor.replace(day=28) + timedelta(days=4)).replace(day=1)

        recent = [
            {
                "listened_at": l.get("listened_at"),
                "album_name": l.get("album_name") or "",
            }
            for l in listens[-10:][::-1]
        ]

        return {
            "track": track,
            "artist": artist or "",
            "art": self._art_for("album", self._dominant_album(album_counter), artist),
            "total_listens": total_listens,
            "total_minutes": total_minutes,
            "first_listen_ts": listens[0].get("listened_at"),
            "last_listen_ts": listens[-1].get("listened_at"),
            "unique_days": len(day_counter),
            "average_per_active_day": round(total_listens / len(day_counter), 2),
            "longest_streak": longest_streak,
            "busiest_day": busiest_day,
            "busiest_week": busiest_week,
            "top_days": top_days,
            "top_weeks": top_weeks,
            "hour_hist": hour_hist,
            "weekday_hist": weekday_hist,
            "weekday_hour_hist": weekday_hour_hist,
            "monthly": monthly,
            "recent": recent,
        }

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
        # A track can appear on several albums; keep the dominant one for art.
        track_album: dict[tuple[str, str], dict[str, int]] = defaultdict(lambda: defaultdict(int))
        # Artists without a portrait fall back to their most-played album sleeve.
        artist_album: dict[str, dict[str, int]] = defaultdict(lambda: defaultdict(int))
        for l in listens:
            track_key = (l.get("track_name") or "", l.get("artist_name") or "")
            artist_key = l.get("artist_name") or ""
            album_key = (l.get("album_name") or "", artist_key)
            track_counter[track_key] += 1
            artist_counter[artist_key] += 1
            album_counter[album_key] += 1
            track_album[track_key][l.get("album_name") or ""] += 1
            artist_album[artist_key][l.get("album_name") or ""] += 1

        top_tracks = [
            {
                "track": t[0][0],
                "artist": t[0][1],
                "count": t[1],
                "art": self._art_for(
                    "album", self._dominant_album(track_album.get(t[0])), t[0][1]
                ),
            }
            for t in sorted(track_counter.items(), key=lambda x: x[1], reverse=True)[:25]
        ]
        top_artists = []
        for artist, count in sorted(artist_counter.items(), key=lambda x: x[1], reverse=True)[:25]:
            art = self._art_for("artist", artist)
            if not art:
                art = self._art_for(
                    "album", self._dominant_album(artist_album.get(artist)), artist
                )
            top_artists.append({"artist": artist, "count": count, "art": art})
        top_albums = [
            {
                "album": al[0][0],
                "artist": al[0][1],
                "count": al[1],
                "art": self._art_for("album", al[0][0], al[0][1]),
            }
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
        day_counter: dict[str, int] = defaultdict(int)
        for l in listens:
            moment = self._ts_to_local_date(l.get("listened_at"))
            month_counter[moment.strftime("%Y-%m")] += 1
            day_counter[moment.date().isoformat()] += 1
        stats["year"] = year
        stats["monthly"] = [{"month": k, "listens": v} for k, v in sorted(month_counter.items())]
        stats["daily"] = [{"date": k, "listens": v} for k, v in sorted(day_counter.items())]
        return stats
