import asyncio
import calendar
import html
import logging
import os
import re
from collections import OrderedDict
from contextlib import asynccontextmanager
from datetime import datetime
from typing import Any

from apscheduler.schedulers.asyncio import AsyncIOScheduler
from dotenv import load_dotenv
from fastapi import FastAPI, HTTPException, Request, WebSocket, WebSocketDisconnect
from fastapi.responses import HTMLResponse, Response
from fastapi.staticfiles import StaticFiles
from fastapi.templating import Jinja2Templates

load_dotenv()

from .art import ArtIndex
from .database import DatabaseManager
from .lb_client import ListenBrainzClient
from .navidrome_client import NavidromeClient
from .scheduler import SyncService
from .stats import StatsEngine
from .util import LOCAL_TZ

logger = logging.getLogger("unwrapped.main")

DB_PATH = os.getenv("DATABASE_PATH", "/app/data/unwrapped.db")
db = DatabaseManager(DB_PATH)

_lb_client: ListenBrainzClient | None = None
_nav_client: NavidromeClient | None = None


def get_lb():
    global _lb_client
    if _lb_client is None:
        _lb_client = ListenBrainzClient()
    return _lb_client


def get_nav():
    global _nav_client
    if _nav_client is None:
        _nav_client = NavidromeClient()
    return _nav_client


art_index = ArtIndex(db, get_nav)
stats_engine = StatsEngine(db, art_index)
scheduler = AsyncIOScheduler()
_background_tasks: set[asyncio.Task] = set()

# Cover art proxy: a small in-process LRU so repeated list renders do not refetch
# from Navidrome. Memory-only (the pod has a read-only root) and size-capped.
COVER_ID_RE = re.compile(r"^(?:al|ar)-[A-Za-z0-9]{1,40}(?:_[0-9a-f]{16})?$")
ART_SIZES = (32, 64, 128, 256, 512)
ART_CACHE_MAX_ENTRIES = 240
ART_CACHE_MAX_BYTES = 64 * 1024
_art_cache: "OrderedDict[tuple[str, int], tuple[str, bytes]]" = OrderedDict()


def _spawn_background(coro):
    """Run *coro* in the background, keeping a reference so it isn't GC'd."""
    task = asyncio.create_task(coro)
    _background_tasks.add(task)
    task.add_done_callback(_background_tasks.discard)
    return task


def _esc(value: Any) -> str:
    return html.escape(str(value if value is not None else ""))


def _display(value: Any, fallback: str = "Unknown") -> str:
    text = str(value).strip() if value is not None else ""
    return _esc(text or fallback)


def _plural(count: int, singular: str, plural: str | None = None) -> str:
    return singular if count == 1 else (plural or f"{singular}s")


def _format_minutes(minutes: Any) -> str:
    total = int(round(float(minutes or 0)))
    hours, mins = divmod(total, 60)
    if hours and mins:
        return f"{hours}h {mins}m"
    if hours:
        return f"{hours}h"
    return f"{mins}m"


def _format_month(year: Any, month: Any) -> str:
    try:
        return datetime(int(year), int(month), 1).strftime("%B %Y")
    except (TypeError, ValueError):
        return "Unknown month"


def _format_iso_date(value: Any) -> str:
    try:
        parsed = datetime.strptime(str(value), "%Y-%m-%d")
        return f"{parsed:%B} {parsed.day}"
    except (TypeError, ValueError):
        return str(value or "")


def _format_short_iso(value: Any) -> str:
    try:
        parsed = datetime.strptime(str(value), "%Y-%m-%d")
        return f"{parsed:%b} {parsed.day}"
    except (TypeError, ValueError):
        return str(value or "")


def _shift_year(moment: datetime, year: int) -> datetime:
    try:
        return moment.replace(year=year)
    except ValueError:
        return moment.replace(year=year, day=28)


def _range_from_shorthand(shorthand: str) -> tuple[int, int]:
    now = int(datetime.now(tz=LOCAL_TZ).timestamp())
    mapping = {
        "week": 7, "7d": 7,
        "month": 30, "30d": 30,
        "quarter": 90, "90d": 90,
        "year": 365, "1y": 365,
        "all": 0,
    }
    days = mapping.get(shorthand)
    if days is None or days == 0:
        return 0, now
    return now - days * 86400, now


def render_on_this_day_html(groups: list[dict], earliest_ts: int | None) -> str:
    if not groups:
        if earliest_ts is not None:
            started = datetime.fromtimestamp(earliest_ts, tz=LOCAL_TZ)
            note = (
                "No listens on this date in previous years. "
                f"This archive starts on {started:%B} {started.day}, {started.year}."
            )
        else:
            note = "No listens yet. Your archive will appear here after the first sync."
        return f'<p class="empty-state">{_esc(note)}</p>'

    parts = []
    for group in groups:
        listens = group["listens"]
        count = len(listens)
        shown = listens[:50]
        items = "".join(
            f'<li><span class="listen-track">{_display(l.get("track_name"))}</span>'
            f'<span class="listen-artist">{_display(l.get("artist_name"))}</span></li>'
            for l in shown
        )
        overflow = ""
        if count > len(shown):
            overflow = (
                f'<p class="fragment-note">Showing the first {len(shown)} of '
                f'{count} listens.</p>'
            )
        parts.append(
            f'<section class="year-group">'
            f'<h3><time datetime="{group["date"].isoformat()}">{group["year"]}</time>'
            f'<span class="year-count">{count} {_plural(count, "listen")}</span></h3>'
            f'<ol class="listen-list">{items}</ol>{overflow}'
            f'</section>'
        )
    return "".join(parts)


def render_monthly_html(s: dict) -> str:
    month_label = _format_month(s.get("year"), s.get("month"))
    total = int(s.get("total_listens") or 0)
    if not total:
        return (
            f'<p class="empty-state">No listens in {_esc(month_label)}.</p>'
        )

    tracks = "".join(
        f'<li><span class="compact-main"><span class="compact-name">{_display(t.get("track"))}</span>'
        f'<span class="compact-meta">{_display(t.get("artist"))}</span></span>'
        f'<span class="compact-count">{_esc(t.get("count"))}</span></li>'
        for t in (s.get("top_tracks") or [])[:8]
    )
    artists = "".join(
        f'<li><span class="compact-main"><span class="compact-name">{_display(a.get("artist"))}</span></span>'
        f'<span class="compact-count">{_esc(a.get("count"))}</span></li>'
        for a in (s.get("top_artists") or [])[:8]
    )

    daily_map = {
        str(d.get("date")): int(d.get("listens") or 0) for d in (s.get("daily") or [])
    }
    year = int(s.get("year"))
    month = int(s.get("month"))
    days_in_month = calendar.monthrange(year, month)[1]
    daily = [
        {
            "date": f"{year:04d}-{month:02d}-{day:02d}",
            "listens": daily_map.get(f"{year:04d}-{month:02d}-{day:02d}", 0),
        }
        for day in range(1, days_in_month + 1)
    ]

    max_daily = max((d["listens"] for d in daily), default=0) or 1
    bars = "".join(
        f'<span class="month-bar" style="height:{round(d["listens"] / max_daily * 100)}%" '
        f'title="{_esc(d["date"])}: {_esc(d["listens"])} {_plural(d["listens"], "listen")}"></span>'
        for d in daily
    )
    daily_rows = "".join(
        f'<tr><td>{_esc(d["date"])}</td><td>{_esc(d["listens"])}</td></tr>'
        for d in daily
    )
    axis = (
        f'<p class="month-axis">'
        f'<span>{_esc(_format_short_iso(daily[0]["date"]))}</span>'
        f'<span>{_esc(_format_short_iso(daily[-1]["date"]))}</span>'
        f'</p>'
    )

    busiest = "No data"
    if s.get("busiest_day"):
        busiest = (
            f'{_esc(_format_iso_date(s.get("busiest_day")))}, '
            f'{_esc(s.get("busiest_day_listens"))} listens'
        )

    return (
        f'<p class="month-total">{total:,} <span>listens</span></p>'
        f'<dl class="month-facts">'
        f'<div><dt>Time</dt><dd>{_esc(_format_minutes(s.get("total_minutes")))}</dd></div>'
        f'<div><dt>Artists</dt><dd>{_esc(s.get("unique_artists"))}</dd></div>'
        f'<div><dt>Busiest day</dt><dd>{busiest}</dd></div>'
        f'</dl>'
        f'<div class="month-bars" role="img" aria-label="Daily listens in {_esc(month_label)}">{bars}</div>'
        f'{axis}'
        f'<details class="chart-data"><summary>Daily listens as a table</summary>'
        f'<table><thead><tr><th scope="col">Date</th><th scope="col">Listens</th></tr></thead>'
        f'<tbody>{daily_rows}</tbody></table></details>'
        f'<div class="month-lists">'
        f'<div><h3>Top tracks</h3><ol class="compact-list">{tracks}</ol></div>'
        f'<div><h3>Top artists</h3><ol class="compact-list">{artists}</ol></div>'
        f'</div>'
    )


async def scheduled_sync():
    logger.info("SCHEDULER: syncing listens")
    try:
        svc = SyncService(db, get_lb())
        await svc.sync_listens()
    except Exception as e:
        logger.error(f"sync failed: {e}")
    await refresh_art_index()


async def refresh_art_index():
    """Mirror Navidrome's cover art. Never fatal: the site works without it."""
    try:
        await art_index.refresh()
    except Exception as e:
        logger.warning(f"cover-art index refresh failed: {e}")


@asynccontextmanager
async def lifespan(app: FastAPI):
    await db.init_db()
    try:
        get_lb()
        logger.info("LB configured")
    except ValueError:
        logger.warning("LB not configured")

    sync_hour = int(os.getenv("SYNC_HOUR", "2")) if os.getenv("SYNC_HOUR") else 2
    scheduler.add_job(scheduled_sync, "cron", hour=sync_hour, minute=0, id="nightly_sync", replace_existing=True)
    scheduler.start()
    last_sync = await db.get_last_sync_ts()
    backfill_done = await db.get_meta("backfill_complete") == "1"
    if last_sync is None or not backfill_done:
        # Seed new installs and backfill history for existing ones. Run it in the
        # background: paging through a full ListenBrainz history can take a while
        # and should not block startup.
        _spawn_background(scheduled_sync())
    # Load the cached cover-art index and refresh it when stale. Also background:
    # a cold index costs a handful of Navidrome requests.
    _spawn_background(art_index.startup())
    yield
    for task in list(_background_tasks):
        task.cancel()
    scheduler.shutdown()
    if _lb_client:
        await _lb_client.close()
    if _nav_client:
        await _nav_client.close()


app = FastAPI(title="unwrapped", lifespan=lifespan)
app.mount("/static", StaticFiles(directory="frontend/static"), name="static")
templates = Jinja2Templates(directory="frontend/templates")


@app.get("/", response_class=HTMLResponse)
async def index(request: Request):
    current_year = datetime.now(tz=LOCAL_TZ).year
    return templates.TemplateResponse(
        "index.html", {"request": request, "current_year": current_year}
    )


@app.get("/wrapped/{year}", response_class=HTMLResponse)
async def wrapped_page(request: Request, year: int):
    return templates.TemplateResponse("wrapped.html", {"request": request, "year": year})


@app.get("/tracks", response_class=HTMLResponse)
async def tracks_page(request: Request):
    current_year = datetime.now(tz=LOCAL_TZ).year
    return templates.TemplateResponse(
        "tracks.html", {"request": request, "current_year": current_year}
    )


@app.get("/api/range")
async def api_range(from_: str | None = None, to_: str | None = None):
    start_ts = int(from_) if from_ else None
    end_ts = int(to_) if to_ else None
    s = await stats_engine.range_stats(start_ts, end_ts)
    return s


@app.get("/api/tracks/search")
async def api_tracks_search(q: str = "", limit: int = 15):
    limit = max(1, min(limit, 50))
    results = await stats_engine.track_search(q.strip(), limit)
    return {"query": q, "results": results}


@app.get("/api/tracks/detail")
async def api_tracks_detail(track: str, artist: str = ""):
    detail = await stats_engine.track_detail(track, artist)
    if detail is None:
        raise HTTPException(status_code=404, detail="track not found")
    return detail


@app.get("/api/art/{cover_id}")
async def api_art(cover_id: str, size: int = 128):
    """Proxy Navidrome cover art so the browser never sees its credentials."""
    if not COVER_ID_RE.match(cover_id):
        raise HTTPException(status_code=404)
    size = min(ART_SIZES, key=lambda s: abs(s - size))
    cached = _art_cache.get((cover_id, size))
    if cached:
        _art_cache.move_to_end((cover_id, size))
        return Response(
            content=cached[1],
            media_type=cached[0],
            headers={"Cache-Control": "public, max-age=2592000, immutable"},
        )

    try:
        content_type, body = await get_nav().get_cover_art(cover_id, size)
    except ValueError:  # Navidrome not configured
        return Response(status_code=204)
    except Exception as exc:
        logger.debug("cover art %s unavailable: %s", cover_id, exc)
        return Response(status_code=204)

    if not content_type.startswith("image/"):
        # Navidrome answers unknown ids with a JSON error payload, not an image.
        logger.debug("cover art %s is not an image (%s)", cover_id, content_type)
        return Response(status_code=204)

    if len(body) <= ART_CACHE_MAX_BYTES:
        _art_cache[(cover_id, size)] = (content_type, body)
        _art_cache.move_to_end((cover_id, size))
        while len(_art_cache) > ART_CACHE_MAX_ENTRIES:
            _art_cache.popitem(last=False)

    return Response(
        content=body,
        media_type=content_type,
        headers={"Cache-Control": "public, max-age=2592000, immutable"},
    )


@app.get("/api/timeline")
async def api_timeline(range: str | None = None, from_: str | None = None, to_: str | None = None,
                       granularity: str = "day"):
    if from_ or to_:
        start_ts = int(from_) if from_ else None
        end_ts = int(to_) if to_ else None
    elif range:
        start_ts, end_ts = _range_from_shorthand(range)
    else:
        start_ts = end_ts = None
    return await stats_engine.timeline(start_ts, end_ts, granularity)


@app.get("/api/on-this-day", response_class=HTMLResponse)
async def api_on_this_day(years: int = 5):
    now = datetime.now(tz=LOCAL_TZ)
    years = max(1, min(years, 20))
    groups = []
    for years_ago in range(1, years + 1):
        target = _shift_year(now, now.year - years_ago)
        start = target.replace(hour=0, minute=0, second=0, microsecond=0)
        end = target.replace(hour=23, minute=59, second=59, microsecond=999999)
        listens = await db.query_listens(int(start.timestamp()), int(end.timestamp()))
        if listens:
            groups.append({"year": target.year, "date": target.date(), "listens": listens})
    earliest_ts = await db.get_first_listen_ts()
    return render_on_this_day_html(groups, earliest_ts)


@app.get("/api/monthly/{year}/{month}", response_class=HTMLResponse)
async def api_monthly(year: int, month: int):
    summary = await stats_engine.month_summary(year, month)
    return render_monthly_html(summary)


@app.get("/api/wrapped/{year}")
async def api_wrapped(year: int, source: str = "lb"):
    if source == "local":
        return await stats_engine.year_summary(year)
    try:
        lb = get_lb()
        yir = await lb.get_year_in_review(year)
        if yir:
            return yir
    except ValueError:
        pass
    except Exception as e:
        logger.warning(f"LB year-in-review failed, falling back to local stats: {e}")
    return await stats_engine.year_summary(year)


@app.get("/api/live/now-playing")
async def api_live_now_playing():
    try:
        nav = get_nav()
        resp = await nav.get_now_playing()
        return resp
    except Exception as e:
        return {"error": str(e)}


@app.websocket("/ws/live")
async def ws_live(ws: WebSocket):
    await ws.accept()
    try:
        while True:
            try:
                nav = get_nav()
                np = await nav.get_now_playing()
                await ws.send_json({"type": "now_playing", "data": np})
            except Exception as e:
                await ws.send_json({"type": "error", "data": str(e)})
            await asyncio.sleep(5)
    except WebSocketDisconnect:
        logger.info("ws disconnected")
    except Exception:
        pass


@app.get("/healthz")
async def healthz():
    return {"status": "ok"}

@app.post("/api/sync")
async def api_sync():
    try:
        svc = SyncService(db, get_lb())
        await svc.sync_listens()
        return {"status": "ok"}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))
