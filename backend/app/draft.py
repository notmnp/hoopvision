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
import os
from concurrent.futures import ThreadPoolExecutor
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

# Players surfaced per pool, capped to the strongest by WS/48. Per-game stats are
# fetched live (best-effort) per player, so a cap bounds draw latency and keeps
# the field to genuine stars who have NBA-Stats coverage (obscure deep-bench
# players with no coverage row would otherwise show all-zero lines).
POOL_SIZE = int(os.getenv("DRAFT_POOL_SIZE", "16"))
# Below this many eligible players (after the exclude list is applied) the combo
# isn't worth presenting, so the resolver signals an auto re-spin instead of a
# threadbare pool (Key Contract / AC-ATD-008).
MIN_VIABLE_POOL = 3
# Each entry needs one (cached) per-game stats lookup that can hit the network on
# a cold cache. The pool is unrestricted, so they're fetched concurrently — the
# NBA-Stats throttle still spaces request starts, so this bounds in-flight calls
# without hammering. Tunable for prod proxy headroom.
POOL_STATS_WORKERS = int(os.getenv("DRAFT_POOL_STATS_WORKERS", "8"))

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
    spg: float
    bpg: float
    fg_pct: float
    # Retained for the pool's tie-break sort; not surfaced to the drafter.
    ws_per_48: float


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
    mp: float
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


def _order_slots(positions: set[str]) -> list[str]:
    """A player's unioned eligible slots in canonical PG→C order."""
    return sorted(
        positions,
        key=lambda p: _VALID_SLOTS.index(p) if p in _VALID_SLOTS else len(_VALID_SLOTS),
    )


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
                    mp=_to_float(raw.get("mp", "")),
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

        # Each player's best (peak WS/48) season WITH this franchise IN this era,
        # plus the UNION of every position they manned across their qualifying
        # seasons. The peak season drives the stats/ranking; eligibility spans all
        # slots they played, so a multi-position player (Harden: SG some seasons,
        # PG others on the same franchise) is draftable into either — not just the
        # one position listed for their single peak season.
        peak_by_player: dict[int, _AdvancedRow] = {}
        positions_by_player: dict[int, set[str]] = {}
        for row in self._rows_cache():
            if row.player_id in exclude_ids:
                continue
            if not season_in_era(row.season_id, era):
                continue
            if not abbreviations.intersection(row.teams):
                continue
            positions_by_player.setdefault(row.player_id, set()).update(row.positions)
            current = peak_by_player.get(row.player_id)
            if current is None or row.ws_per_48 > current.ws_per_48:
                peak_by_player[row.player_id] = row

        if len(peak_by_player) < MIN_VIABLE_POOL:
            return AutoRespin()

        # Cap to the strongest POOL_SIZE players by WS/48 BEFORE any per-game
        # lookups: per-game stats come from the best-effort (possibly networked)
        # provider, so bounding the field keeps the draw fast and avoids dragging
        # in obscure players who have no NBA-Stats coverage (all-zero lines).
        ranked = sorted(
            peak_by_player.values(), key=lambda r: r.ws_per_48, reverse=True
        )[:POOL_SIZE]
        positions = [_order_slots(positions_by_player[row.player_id]) for row in ranked]
        # Fetch the capped field's per-game stats concurrently — the throttle
        # still spaces request starts, so this just overlaps their latency.
        workers = max(1, min(POOL_STATS_WORKERS, len(ranked)))
        with ThreadPoolExecutor(max_workers=workers) as pool_executor:
            players = list(pool_executor.map(self._build_entry, ranked, positions))
        # Surface PPG-first (WS/48 breaks ties); the client re-sorts on demand.
        players.sort(key=lambda p: (p.stats.ppg, p.stats.ws_per_48), reverse=True)
        return PlayerPool(era=era_id, franchise=franchise_id, players=players)

    def _build_entry(
        self, row: _AdvancedRow, positions: list[str]
    ) -> PlayerPoolEntry:
        ppg = apg = rpg = spg = bpg = fg_pct = 0.0
        try:
            stats = self._season_stats_provider(row.player_id, row.season_id)
        except Exception:
            stats = None
        if stats:
            ppg = float(stats.get("points_per_game", 0.0) or 0.0)
            apg = float(stats.get("assist_per_game", 0.0) or 0.0)
            rpg = float(stats.get("rebound_per_game", 0.0) or 0.0)
            spg = float(stats.get("steal_per_game", 0.0) or 0.0)
            bpg = float(stats.get("block_per_game", 0.0) or 0.0)
            fg_pct = float(stats.get("field_goal_percentage", 0.0) or 0.0)

        return PlayerPoolEntry(
            player_id=row.player_id,
            season_id=row.season_id,
            name=row.player_name,
            positions=positions,
            stats=PlayerPoolStats(
                ppg=round(ppg, 1),
                apg=round(apg, 1),
                rpg=round(rpg, 1),
                spg=round(spg, 1),
                bpg=round(bpg, 1),
                fg_pct=round(fg_pct, 3),
                ws_per_48=row.ws_per_48,
            ),
        )
