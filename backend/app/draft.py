"""PlayerPoolResolver for the All-Time Draft Challenge (WO-49).

Resolves the player pool for a spun era-franchise combination. Franchise
membership and the advanced metrics used for ranking (WS/48, BPM) come from the
bundled ``player_advanced_stats.csv`` (ADR-001), which makes pool resolution
fully deterministic and independent of live NBA-Stats availability. Per-game
display stats (PPG/APG/RPG) are layered on at request time from
``PlayerDataService`` via an injected provider, degrading gracefully to zero if
that lookup fails so the endpoint never 500s on a stats hiccup.
"""

from __future__ import annotations

import csv
from dataclasses import dataclass
from pathlib import Path
from typing import Callable

from pydantic import BaseModel

from .draft_eras import (
    franchise_abbreviations,
    get_era,
    get_franchise,
    season_in_era,
)

ADVANCED_STATS_CSV_PATH = (
    Path(__file__).resolve().parents[1] / "data" / "player_advanced_stats.csv"
)

# Number of players surfaced per pool. The blueprint recommends 6-8; 8 gives the
# user a real choice while still fitting on a card.
POOL_SIZE = 8
# Below this many eligible players (after the exclude list is applied) the combo
# isn't worth presenting, so the resolver signals an auto re-spin instead of a
# threadbare pool (Key Contract / AC-ATD-008).
MIN_VIABLE_POOL = 3

_VALID_SLOTS = ("PG", "SG", "SF", "PF", "C")
# Legacy Basketball Reference generic positions -> the modern slots they cover.
_LEGACY_POSITIONS = {
    "G": ["PG", "SG"],
    "F": ["SF", "PF"],
}

# A provider that returns the per-game season stats payload (the shape produced
# by player_data.season_stats_from_totals) for a player-season, or None.
SeasonStatsProvider = Callable[[int, str], dict | None]


class PlayerPoolStats(BaseModel):
    ppg: float
    apg: float
    rpg: float
    ws_per_48: float
    bpm: float


class PlayerPoolEntry(BaseModel):
    player_id: int
    season_id: str
    name: str
    positions: list[str]
    stats: PlayerPoolStats


class PlayerPool(BaseModel):
    era: str
    franchise: str
    players: list[PlayerPoolEntry]


class AutoRespin(BaseModel):
    auto_respin: bool = True


@dataclass(frozen=True)
class _AdvancedRow:
    player_id: int
    player_name: str
    season_id: str
    positions: tuple[str, ...]
    teams: tuple[str, ...]
    ws_per_48: float
    bpm: float
    vorp: float
    ts_pct: float


def parse_positions(pos: str) -> list[str]:
    """"PF-C" -> ["PF", "C"]; legacy "G"/"F" expand to their modern slots."""
    slots: list[str] = []
    for token in pos.upper().split("-"):
        token = token.strip()
        if token in _VALID_SLOTS:
            if token not in slots:
                slots.append(token)
        elif token in _LEGACY_POSITIONS:
            for slot in _LEGACY_POSITIONS[token]:
                if slot not in slots:
                    slots.append(slot)
    return slots


def _to_float(value: str) -> float:
    try:
        return float(value)
    except (TypeError, ValueError):
        return 0.0


def _load_rows(path: Path) -> list[_AdvancedRow]:
    rows: list[_AdvancedRow] = []
    with path.open(newline="") as handle:
        for raw in csv.DictReader(handle):
            try:
                player_id = int(raw["player_id"])
            except (TypeError, ValueError, KeyError):
                continue
            rows.append(
                _AdvancedRow(
                    player_id=player_id,
                    player_name=raw.get("player_name", ""),
                    season_id=raw.get("season_id", ""),
                    positions=tuple(parse_positions(raw.get("pos", ""))),
                    teams=tuple(
                        t for t in (raw.get("teams", "") or "").split(";") if t
                    ),
                    ws_per_48=_to_float(raw.get("ws_per_48", "")),
                    bpm=_to_float(raw.get("bpm", "")),
                    vorp=_to_float(raw.get("vorp", "")),
                    ts_pct=_to_float(raw.get("ts_pct", "")),
                )
            )
    return rows


class PlayerPoolResolver:
    """Assembles ranked player pools from the bundled advanced-stats dataset."""

    def __init__(
        self,
        season_stats_provider: SeasonStatsProvider,
        csv_path: Path = ADVANCED_STATS_CSV_PATH,
    ) -> None:
        self._season_stats_provider = season_stats_provider
        self._csv_path = csv_path
        self._rows: list[_AdvancedRow] | None = None

    def _rows_cache(self) -> list[_AdvancedRow]:
        # Lazy-load + cache in-process: the CSV is ~15k rows and never changes at
        # runtime, so a single parse serves every request for the process's life.
        if self._rows is None:
            self._rows = _load_rows(self._csv_path)
        return self._rows

    def resolve_pool(
        self,
        era_id: str,
        franchise_id: str,
        exclude_ids: set[int] | None = None,
    ) -> PlayerPool | AutoRespin | None:
        """Return the ranked pool, an auto-respin signal, or None for bad input.

        None is returned when the era or franchise id is unknown (the endpoint
        maps that to a 404/400); AutoRespin when too few players remain after the
        exclude list is applied.
        """
        era = get_era(era_id)
        franchise = get_franchise(franchise_id)
        if era is None or franchise is None:
            return None

        exclude_ids = exclude_ids or set()
        abbreviations = franchise_abbreviations(franchise_id)

        # Each player's best (peak WS/48) season WITH this franchise IN this era.
        peak_by_player: dict[int, _AdvancedRow] = {}
        for row in self._rows_cache():
            if row.player_id in exclude_ids:
                continue
            if not season_in_era(row.season_id, era):
                continue
            if not abbreviations.intersection(row.teams):
                continue
            current = peak_by_player.get(row.player_id)
            if current is None or row.ws_per_48 > current.ws_per_48:
                peak_by_player[row.player_id] = row

        ranked = sorted(
            peak_by_player.values(), key=lambda r: r.ws_per_48, reverse=True
        )

        if len(ranked) < MIN_VIABLE_POOL:
            return AutoRespin()

        players = [self._build_entry(row) for row in ranked[:POOL_SIZE]]
        return PlayerPool(era=era_id, franchise=franchise_id, players=players)

    def _build_entry(self, row: _AdvancedRow) -> PlayerPoolEntry:
        ppg = apg = rpg = 0.0
        try:
            stats = self._season_stats_provider(row.player_id, row.season_id)
        except Exception:
            stats = None
        if stats:
            ppg = float(stats.get("points_per_game", 0.0) or 0.0)
            apg = float(stats.get("assist_per_game", 0.0) or 0.0)
            rpg = float(stats.get("rebound_per_game", 0.0) or 0.0)

        return PlayerPoolEntry(
            player_id=row.player_id,
            season_id=row.season_id,
            name=row.player_name,
            positions=list(row.positions),
            stats=PlayerPoolStats(
                ppg=round(ppg, 1),
                apg=round(apg, 1),
                rpg=round(rpg, 1),
                ws_per_48=row.ws_per_48,
                bpm=row.bpm,
            ),
        )
