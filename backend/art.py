"""Cover-art resolution against the local Navidrome library.

Navidrome is the only art source with usable coverage for this archive:
ListenBrainz only carries a ``release_mbid`` for part of the history (and none
for the recent listens), while Navidrome already has album art and Deezer
portraits for its artists behind ``getCoverArt``.

Matching is name-first. Navidrome's ``musicBrainzId`` on artists is unreliable
(collaboration credits such as "MF DOOM & Nujabes" get their own artist row), so
MBIDs are never trusted ahead of a normalized name match.
"""

import logging
import re
import time
import unicodedata
from collections import defaultdict
from typing import Any, Callable

logger = logging.getLogger("unwrapped.art")

ART_INDEX_KEY = "art_index_updated"
ART_INDEX_MAX_AGE = 24 * 3600

# Credit separators used in ListenBrainz metadata: "A & B", "A, B", "A feat. B"…
_SPLIT_RE = re.compile(
    r"\s*(?:;|,|&|\+/|\band\b|\bfeat\.?\b|\bft\.?\b|\bfeaturing\b|\bvs\.?\b|\sx\s)\s*",
    re.IGNORECASE,
)
# Trailing edition markers: "(Deluxe)", "[20th Anniversary Edition]"…
_EDITION_RE = re.compile(
    r"\s*[\(\[]\s*[^\)\]]*\b(deluxe|anniversary|edition|remaster(?:ed)?|expanded|bonus|"
    r"reissue|ep|remixes?|special)\b[^\)\]]*[\)\]]\s*$",
    re.IGNORECASE,
)
_NON_ALNUM = re.compile(r"[^a-z0-9]+")


def normalize_name(value: str | None) -> str:
    """Casefold, strip diacritics and punctuation, collapse whitespace."""
    text = (value or "").casefold()
    text = unicodedata.normalize("NFKD", text)
    text = "".join(ch for ch in text if not unicodedata.combining(ch))
    return _NON_ALNUM.sub(" ", text).strip()


def strip_edition(value: str | None) -> str:
    return _EDITION_RE.sub("", value or "").strip()


def split_artist(value: str | None) -> list[str]:
    return [part.strip() for part in _SPLIT_RE.split(value or "") if part and part.strip()]


class ArtIndex:
    """Name -> cover-art id lookup over a mirror of the Navidrome library."""

    def __init__(self, db, client_factory: Callable[[], Any]):
        self.db = db
        self._client_factory = client_factory
        self._albums: dict[str, list[tuple[str, str]]] = {}
        self._artists: dict[str, str] = {}

    async def startup(self):
        """Load the cached index, refreshing it when it is missing or stale."""
        await self._load()
        if await self._stale():
            await self.refresh()

    async def _stale(self) -> bool:
        try:
            raw = await self.db.get_meta(ART_INDEX_KEY)
        except Exception as exc:  # unreadable DB: do not pile on with a refresh
            logger.warning("could not read the cover-art index timestamp: %s", exc)
            return False
        try:
            return raw is None or (time.time() - float(raw)) > ART_INDEX_MAX_AGE
        except (TypeError, ValueError):
            return True

    async def _load(self):
        try:
            rows = await self.db.get_nav_art()
        except Exception as exc:  # table missing / unreadable: run without art
            logger.warning("cover-art index unavailable: %s", exc)
            rows = []
        self._apply(rows)
        logger.info(
            "cover-art index loaded from cache (%d albums, %d artists)",
            self._album_count(),
            len(self._artists),
        )

    async def refresh(self):
        """Rebuild the index from Navidrome. Failures are logged, never fatal."""
        try:
            client = self._client_factory()
        except ValueError as exc:
            logger.info("Navidrome not configured, skipping cover-art index: %s", exc)
            return
        try:
            album_rows = await client.get_album_index()
            artist_rows = await client.get_artist_index()
        except Exception as exc:
            logger.warning("cover-art index refresh failed: %s", exc)
            return

        rows: list[tuple[str, str, str, str, str, str]] = []
        for album in album_rows:
            cover_id = album.get("coverArt") or ""
            name = album.get("name") or ""
            if not cover_id or not name:
                continue
            rows.append((
                cover_id,
                "album",
                name,
                normalize_name(name),
                album.get("artist") or "",
                album.get("musicBrainzId") or "",
            ))
        for artist in artist_rows:
            cover_id = artist.get("coverArt") or ""
            name = artist.get("name") or ""
            if not cover_id or not name:
                continue
            rows.append((
                cover_id,
                "artist",
                name,
                normalize_name(name),
                "",
                artist.get("musicBrainzId") or "",
            ))

        if not rows:
            logger.warning("Navidrome returned no cover art, keeping the previous index")
            return

        try:
            await self.db.replace_nav_art(rows)
            await self.db.set_meta(ART_INDEX_KEY, str(int(time.time())))
        except Exception as exc:
            logger.warning("could not persist cover-art index: %s", exc)

        self._apply(rows)
        logger.info(
            "cover-art index refreshed (%d albums, %d artists)",
            self._album_count(),
            len(self._artists),
        )

    def _album_count(self) -> int:
        return sum(len(group) for group in self._albums.values())

    def _apply(self, rows):
        albums: dict[str, list[tuple[str, str]]] = defaultdict(list)
        artists: dict[str, str] = {}
        for cover_id, kind, name, norm_name, artist, mbid in rows:
            if not cover_id:
                continue
            if kind == "album":
                key = norm_name or normalize_name(name)
                if key:
                    albums[key].append((cover_id, normalize_name(artist)))
            elif kind == "artist":
                key = norm_name or normalize_name(name)
                if key:
                    artists.setdefault(key, cover_id)
        self._albums = dict(albums)
        self._artists = artists

    @staticmethod
    def album_keys(album: str | None) -> list[str]:
        keys: list[str] = []
        for candidate in (album, strip_edition(album)):
            key = normalize_name(candidate)
            if key and key not in keys:
                keys.append(key)
        return keys

    def resolve_album(self, album: str | None, artist: str | None = None) -> str | None:
        """Cover-art id for an album, or None when it is not in the library."""
        if not self._albums or not album:
            return None
        # Match the credited artist both whole and split into its parts.
        artist_parts = {normalize_name(artist)}
        artist_parts.update(normalize_name(part) for part in split_artist(artist))
        artist_parts.discard("")
        for key in self.album_keys(album):
            group = self._albums.get(key)
            if not group:
                continue
            if len(group) > 1 and artist_parts:
                # Same album name on several rows: prefer the matching artist.
                for cover_id, nav_artist in group:
                    if nav_artist and nav_artist in artist_parts:
                        return cover_id
            return group[0][0]
        return None

    def resolve_artist(self, artist: str | None = None) -> str | None:
        """Portrait for an artist, or None when Navidrome has no image for them."""
        if not self._artists or not artist:
            return None
        # Only the lead credit is tried after the full string: attributing a
        # collaborator's portrait to a group credit would be a lie.
        candidates = [artist]
        parts = split_artist(artist)
        if len(parts) > 1:
            candidates.append(parts[0])
        for candidate in candidates:
            key = normalize_name(candidate)
            if key and key in self._artists:
                return self._artists[key]
        return None

    def art_for(self, kind: str, name: str | None, artist: str | None = None) -> str | None:
        if kind == "artist":
            return self.resolve_artist(name)
        return self.resolve_album(name, artist)
