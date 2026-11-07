# unwrapped

A self-hosted "Spotify Wrapped"-style listening-stats dashboard for your own music
stack. It pulls listening history from **ListenBrainz**, reads live playback from
**Navidrome**, stores everything in SQLite, and renders it all through a small
FastAPI + vanilla-JS web UI.

## Features

- **Range explorer**: totals, top tracks / artists / albums for any date range or
  preset (7d / 30d / 90d / 1y / all).
- **Charts**: an ECharts timeline bar chart and a weekday x hour listening heatmap.
- **On this day**: listens from the same calendar day in previous years, grouped by
  year and loaded as an HTML fragment.
- **Monthly recap**: per-month summary with daily breakdown, loaded as an HTML fragment.
- **Year in review**: locally computed year stats by default, with an optional
  ListenBrainz year-in-review source on the API.
- **Live endpoints**: Navidrome now-playing over `/api/live/now-playing` and a polling
  WebSocket at `/ws/live`; the dashboard itself does not surface them.
- **Cover art**: album art and artist portraits in the top tracks / artists / albums
  lists and the year-in-review page. Art is mirrored from the local Navidrome library
  (name-matched, cached in `nav_art`) and proxied through `/api/art/{id}`, so no
  credentials reach the browser and the page is unchanged when Navidrome is absent.
- **Incremental sync**: nightly job that pages forward from a stored cursor, so new
  history accumulates without being re-fetched.
- **History backfill**: on startup (and on each sync) the app pages *backwards* through
  older listens until the very first one, so the full archive — and therefore the 90d /
  1y / all range comparisons — is complete even for installs that started with only a
  recent window. Backfill progress is checkpointed in the `meta` table and resumes
  automatically across restarts.

## Architecture

```
ListenBrainz  ──►  lb_client  ──►  SyncService  ──►  SQLite (aiosqlite)
   (API)                          (scheduler)            │
                                                          ▼
Navidrome    ──►  navidrome_client ──┬──►  ArtIndex ──►  StatsEngine
   (API)                             │     (nav_art)          │
                                     └──►  art proxy ─────────┤
                                                             ▼
                                        FastAPI routes / JSON APIs / fragments
                                                             │
                                                             ▼
                                               ECharts frontend
```

| Component | Responsibility |
| --- | --- |
| `backend/main.py` | FastAPI app, page routes, JSON APIs, HTML fragments, WebSocket, lifespan/scheduler wiring |
| `backend/lb_client.py` | ListenBrainz API client with retry/backoff (listens and year-in-review) |
| `backend/navidrome_client.py` | Navidrome/Subsonic client for now-playing, library indexes, and cover art |
| `backend/art.py` | `ArtIndex` — name-matched cover-art mirror of the Navidrome library |
| `backend/scheduler.py` | `SyncService` — forward sync against `last_sync_ts` plus resumable backward history backfill |
| `backend/stats.py` | `StatsEngine` — all aggregation (totals, top lists, histograms, timelines, month/year summaries) |
| `backend/database.py` | Async SQLite manager (WAL mode) with `listens`, `meta`, and `nav_art` tables |
| `backend/util.py` | Local timezone helper (`TZ`) |
| `frontend/` | Jinja2 templates, self-hosted fonts, static JS (ECharts), and CSS |

## Tech stack

- **Backend:** FastAPI, Uvicorn, httpx, APScheduler, aiosqlite, Jinja2, pydantic, python-dotenv
- **Frontend:** vanilla JS, ECharts, self-hosted Fraunces and IBM Plex Sans
- **Storage:** SQLite (WAL)
- **Container:** `python:3.11-slim` + Uvicorn

## Getting started (Docker)

Build the image:

```bash
docker build -t unwrapped:latest .
```

Run it:

```bash
docker run -d --name unwrapped -p 8000:8000 \
  -v /path/to/data:/app/data \
  -e TZ="America/New_York" \
  -e LISTENBRAINZ_USERNAME="your-user" \
  -e LISTENBRAINZ_TOKEN="your-token" \
  -e NAVIDROME_URL="http://navidrome:4533" \
  -e NAVIDROME_USERNAME="your-user" \
  -e NAVIDROME_PASSWORD="your-password" \
  unwrapped:latest
```

Then open <http://localhost:8000>. On startup the app seeds the most recent listens and
then backfills older history in the background until it reaches your first listen. A large
library may take several sync cycles to backfill fully — progress is checkpointed in the
`meta` table (`backfill_cursor` / `backfill_complete`) so it resumes after a restart instead
of starting over.

## Getting started (local dev)

```bash
python -m venv .venv && source .venv/bin/activate
pip install -r requirements.txt
uvicorn backend.main:app --reload --host 0.0.0.0 --port 8000
```

Create a `.env` file in the project root (loaded via `python-dotenv`):

```dotenv
TZ=America/New_York
DATABASE_PATH=/app/data/unwrapped.db
SYNC_HOUR=2
LISTENBRAINZ_USERNAME=your-user
LISTENBRAINZ_TOKEN=your-token
NAVIDROME_URL=http://navidrome:4533
NAVIDROME_USERNAME=your-user
NAVIDROME_PASSWORD=your-password
```

## Configuration

| Variable | Default | Description |
| --- | --- | --- |
| `TZ` | `UTC` | Local timezone used for all date bucketing |
| `DATABASE_PATH` | `/app/data/unwrapped.db` | SQLite database file path |
| `SYNC_HOUR` | `2` | Hour of day (local) to run the nightly sync job |
| `LISTENBRAINZ_USERNAME` | — | ListenBrainz username (**required** for sync) |
| `LISTENBRAINZ_TOKEN` | — | ListenBrainz user token (**required** for sync) |
| `NAVIDROME_URL` | — | Base URL of the Navidrome instance (required for live features and cover art) |
| `NAVIDROME_USERNAME` | — | Navidrome username |
| `NAVIDROME_PASSWORD` | — | Navidrome password |

If ListenBrainz credentials are missing the app still starts; sync is disabled and
warnings are logged. Missing Navidrome credentials only disable the live endpoints and
cover art. Art also degrades gracefully when Navidrome is configured but unreachable:
cached art ids still resolve, and the images simply drop out of the lists.

## API reference

| Method | Path | Description |
| --- | --- | --- |
| `GET` | `/` | Explore dashboard page |
| `GET` | `/wrapped/{year}` | Year-in-review page |
| `GET` | `/api/range` | Aggregate stats for `from_`/`to_` (epoch seconds) |
| `GET` | `/api/timeline` | Time series (`range` shorthand or `from_`/`to_`, `granularity=day\|week\|month`) |
| `GET` | `/api/on-this-day` | HTML fragment of listens on this day in previous years (`years`, 1-20, default 5) |
| `GET` | `/api/monthly/{year}/{month}` | HTML fragment monthly summary |
| `GET` | `/api/wrapped/{year}` | JSON year-in-review (`source=lb\|local`, default `lb`) |
| `GET` | `/api/live/now-playing` | Current Navidrome now-playing |
| `GET` | `/api/art/{cover_id}` | Cover art proxied from Navidrome (`size` 32-512, snapped to the nearest step) |
| `WS` | `/ws/live` | Pushes now-playing JSON every 5 seconds |
| `POST` | `/api/sync` | Trigger a listen sync on demand |
| `GET` | `/healthz` | Liveness/readiness probe |

## Data model

SQLite tables created on startup (`backend/database.py`):

- **`listens`** — one row per scrobble: `listened_at`, MBIDs, `artist_name`,
  `album_name`, `track_name`, `duration_ms`. Uniqueness on
  `(listened_at, track_name, artist_name)`; indexes on time, artist, and track.
- **`meta`** — key/value store; holds the `last_sync_ts` cursor and the backfill
  checkpoints, plus `art_index_updated` (when the cover-art mirror was last refreshed).
- **`nav_art`** — cover-art mirror of the Navidrome library: `cover_id`, `kind`
  (`album`/`artist`), display `name`, normalized `norm_name`, `artist`, and MBID.
  Rebuilt on startup when older than a day and after every nightly sync; it is
  additive, so an install without Navidrome simply keeps it empty.

## Cover art

`/api/range` (and the year-in-review payload) attach an `"art"` cover id to each top
track / artist / album, or `null` when the item is not in the library. Matching runs on
normalized names — casefolded, diacritics and punctuation stripped, edition suffixes
(`(Deluxe)`, `(20th Anniversary Edition)`) trimmed, and collaboration credits split on
`; , & feat. ft.` — so `Denzel Curry & Kenneth Blume` still finds Denzel Curry's
portrait. Navidrome MBIDs are deliberately not trusted first: its artist table contains
its own pseudo-artists for collaboration credits. Albums are matched by name with the
artist as a tie-break; artists fall back to the lead credit only, since showing a
collaborator's portrait would be wrong. Images are fetched once per id and size into a
small in-memory LRU, and the browser caches them for 30 days.

## Deployment

A Kubernetes manifest lives at `k8s/21-deployment-unwrapped.yaml`:

- Namespace `media-services`, single replica, `Recreate` strategy.
- Runs as non-root (UID/GID 1000) with a read-only root filesystem and all
  capabilities dropped; `/tmp` is an `emptyDir`.
- SQLite data is persisted to a `hostPath` at `/docker-configs/unwrapped/data`.
- Config comes from the `unwrapped-config` ConfigMap and `unwrapped-secrets` Secret.
- Exposed via a `NodePort` service on port `30556`.

## Project layout

```
unwrapped/
├── Dockerfile
├── requirements.txt
├── backend/
│   ├── main.py              # FastAPI app & routes
│   ├── art.py               # ArtIndex: cover-art mirror
│   ├── database.py          # async SQLite manager
│   ├── lb_client.py         # ListenBrainz client
│   ├── navidrome_client.py  # Navidrome/Subsonic client
│   ├── scheduler.py         # SyncService
│   ├── stats.py             # StatsEngine
│   └── util.py              # timezone helper
└── frontend/
    ├── templates/
    │   ├── index.html
    │   └── wrapped.html
    └── static/
        ├── app.js
        ├── wrapped.js
        ├── style.css
        ├── favicon.svg
        ├── fonts/            # Fraunces + IBM Plex Sans (OFL)
        └── vendor/           # echarts.min.js
```

## Notes & limitations

- History only accumulates from the first run forward; the initial seed fetches the
  most recent page rather than a full backfill.
- Don't commit plaintext credentials — use a real secrets manager (e.g. Sealed
  Secrets) or environment injection.
