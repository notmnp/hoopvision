"""DraftScoringEngine for the All-Time Draft Challenge (WO-50).

Turns a completed five-player lineup into a deterministic 82-game win-loss
record via a weighted advanced-metrics formula (ADR-001). The metrics
(WS/48, BPM, VORP, TS%) are already era-normalised and built for cross-era
comparison, so no bespoke era adjustment is needed. Scoring is intentionally
explainable: the per-player contribution returned in the breakdown is exactly
the weighted value that fed the team aggregate.

Determinism (Key Contract): the same five (player_id, season_id, position_slot)
tuples always produce the same score. WS/48, BPM, and VORP come from the bundled
``player_advanced_stats.csv``. TS% is taken from PlayerDataService when a
provider is supplied (the WO's basic-stats source) and falls back to the CSV's
TS% — itself PTS / (2 × (FGA + 0.44 × FTA)), the same formula — so the score is
stable whether or not live stats are reachable.

All weights and calibration constants are tuning choices; each is a named module
constant with the rationale inline so they can be re-tuned without spelunking.
"""

from __future__ import annotations

import math
from typing import Callable, Literal

from pydantic import BaseModel, Field

from .draft import _AdvancedRow, _load_rows, ADVANCED_STATS_CSV_PATH

PositionSlot = Literal["PG", "SG", "SF", "PF", "C"]
_REQUIRED_SLOTS = ("PG", "SG", "SF", "PF", "C")

GAMES = 82

# Per-metric normalisation anchors. Each raw metric is mapped to a ~0..1 quality
# scale where 0 is a fringe rotation player and 1 is an elite peak season, so the
# four very-differently-scaled metrics can be combined. Values are clamped to a
# small overshoot ceiling so a historic outlier doesn't dominate unboundedly.
_WS48_ELITE = 0.30  # WS/48 of a peak MVP season
_BPM_FLOOR, _BPM_ELITE = -4.0, 10.0  # BPM range from fringe to peak
_VORP_ELITE = 8.0  # VORP of a peak season
_TS_FLOOR, _TS_ELITE = 0.48, 0.62  # true shooting from poor to elite
_NORM_CEILING = 1.2

# Position-specific metric weights (each row sums to 1.0). PG leans on BPM
# (playmaking/all-around impact); wings (SG/SF) on TS% and VORP (scoring
# efficiency + cumulative value); bigs (PF/C) on WS/48 (and the defensive value
# WS/48 and BPM capture). Order: (ws_per_48, bpm, vorp, ts_pct).
_POSITION_WEIGHTS: dict[str, tuple[float, float, float, float]] = {
    "PG": (0.20, 0.40, 0.25, 0.15),
    "SG": (0.15, 0.20, 0.30, 0.35),
    "SF": (0.20, 0.20, 0.30, 0.30),
    "PF": (0.40, 0.20, 0.25, 0.15),
    "C": (0.45, 0.20, 0.25, 0.10),
}

# Team balance: reward lineups that field someone strong in EVERY metric
# dimension (complementary skills) over five players who pile into the same one
# (redundant). `coverage` is the mean of the team's best normalised value per
# dimension; the bonus scales the aggregate by how far coverage exceeds the
# team's mean per-player value.
_BALANCE_WEIGHT = 0.18

# Calibrated sigmoid mapping team aggregate -> win total. Anchored so a
# league-average five (~1.5 aggregate) lands ~47 wins and a theoretically
# optimal five (~4.9 aggregate) approaches ~77 (ADR-001 targets). Derived by
# solving the logistic for those two anchor points.
_WIN_MIDPOINT = 1.089
_WIN_SCALE = 0.716


class DraftLineupPlayer(BaseModel):
    player_id: int
    season_id: str = Field(min_length=1)
    position_slot: PositionSlot


class DraftLineup(BaseModel):
    players: list[DraftLineupPlayer]


class DraftScoreMetrics(BaseModel):
    ws_per_48: float
    bpm: float
    vorp: float
    ts_pct: float


class DraftScoreBreakdown(BaseModel):
    player_id: int
    name: str
    position_slot: str
    contribution_score: float
    metrics: DraftScoreMetrics


class DraftScore(BaseModel):
    wins: int
    losses: int
    breakdown: list[DraftScoreBreakdown]


class DraftLineupError(ValueError):
    """Raised for a structurally invalid lineup (mapped to HTTP 400)."""


# Optional provider returning the per-game season stats payload (PlayerDataService
# shape) for a player-season, used for TS%; None falls back to the CSV.
SeasonStatsProvider = Callable[[int, str], dict | None]


def _clamp(value: float, low: float = 0.0, high: float = _NORM_CEILING) -> float:
    return max(low, min(high, value))


def _norm_ws48(value: float) -> float:
    return _clamp(value / _WS48_ELITE)


def _norm_bpm(value: float) -> float:
    return _clamp((value - _BPM_FLOOR) / (_BPM_ELITE - _BPM_FLOOR))


def _norm_vorp(value: float) -> float:
    return _clamp(value / _VORP_ELITE)


def _norm_ts(value: float) -> float:
    return _clamp((value - _TS_FLOOR) / (_TS_ELITE - _TS_FLOOR))


class DraftScoringEngine:
    def __init__(
        self,
        season_stats_provider: SeasonStatsProvider | None = None,
        csv_path=ADVANCED_STATS_CSV_PATH,
    ) -> None:
        self._season_stats_provider = season_stats_provider
        self._csv_path = csv_path
        self._index: dict[tuple[int, str], _AdvancedRow] | None = None

    def _metrics_index(self) -> dict[tuple[int, str], _AdvancedRow]:
        if self._index is None:
            self._index = {
                (row.player_id, row.season_id): row
                for row in _load_rows(self._csv_path)
            }
        return self._index

    @staticmethod
    def _validate(lineup: DraftLineup) -> None:
        players = lineup.players
        if len(players) != len(_REQUIRED_SLOTS):
            raise DraftLineupError(
                f"A lineup must contain exactly {len(_REQUIRED_SLOTS)} players."
            )
        slots = [p.position_slot for p in players]
        if len(set(slots)) != len(slots):
            raise DraftLineupError("Each position slot may be filled only once.")
        if set(slots) != set(_REQUIRED_SLOTS):
            raise DraftLineupError(
                "A lineup must fill exactly one of each slot: "
                + ", ".join(_REQUIRED_SLOTS)
            )

    def _resolve_ts_pct(self, player_id: int, season_id: str, csv_ts: float) -> float:
        # WO source-of-truth for TS% is PlayerDataService basic stats; the CSV's
        # TS% (same formula) is the deterministic fallback when no provider is
        # wired or the live lookup fails.
        if self._season_stats_provider is None:
            return csv_ts
        try:
            stats = self._season_stats_provider(player_id, season_id)
        except Exception:
            stats = None
        if stats and stats.get("true_shooting_pct"):
            return float(stats["true_shooting_pct"])
        return csv_ts

    def score(self, lineup: DraftLineup) -> DraftScore:
        self._validate(lineup)
        index = self._metrics_index()

        breakdown: list[DraftScoreBreakdown] = []
        # Per-metric normalised values across the five players, for the balance
        # coverage calculation.
        norm_by_metric = {"ws": [], "bpm": [], "vorp": [], "ts": []}
        contributions: list[float] = []

        for entry in lineup.players:
            row = index.get((entry.player_id, entry.season_id))
            ws = row.ws_per_48 if row else 0.0
            bpm = row.bpm if row else 0.0
            vorp = row.vorp if row else 0.0
            csv_ts = row.ts_pct if row else 0.0
            name = row.player_name if row else str(entry.player_id)
            ts = self._resolve_ts_pct(entry.player_id, entry.season_id, csv_ts)

            n_ws, n_bpm, n_vorp, n_ts = (
                _norm_ws48(ws),
                _norm_bpm(bpm),
                _norm_vorp(vorp),
                _norm_ts(ts),
            )
            norm_by_metric["ws"].append(n_ws)
            norm_by_metric["bpm"].append(n_bpm)
            norm_by_metric["vorp"].append(n_vorp)
            norm_by_metric["ts"].append(n_ts)

            w_ws, w_bpm, w_vorp, w_ts = _POSITION_WEIGHTS[entry.position_slot]
            value = w_ws * n_ws + w_bpm * n_bpm + w_vorp * n_vorp + w_ts * n_ts
            contributions.append(value)

            breakdown.append(
                DraftScoreBreakdown(
                    player_id=entry.player_id,
                    name=name,
                    position_slot=entry.position_slot,
                    contribution_score=round(value, 4),
                    metrics=DraftScoreMetrics(
                        ws_per_48=ws, bpm=bpm, vorp=vorp, ts_pct=round(ts, 4)
                    ),
                )
            )

        aggregate = sum(contributions)
        mean_value = aggregate / len(contributions)
        coverage = sum(max(values) for values in norm_by_metric.values()) / 4
        # Complementary lineups (coverage > mean) get a bonus; redundant ones
        # (everyone strong in the same metric, so coverage ≈ mean) get none.
        balance_multiplier = 1 + _BALANCE_WEIGHT * (coverage - mean_value)
        team_score = aggregate * balance_multiplier

        wins = self._wins_from_score(team_score)
        return DraftScore(wins=wins, losses=GAMES - wins, breakdown=breakdown)

    @staticmethod
    def _wins_from_score(team_score: float) -> int:
        logistic = 1 / (1 + math.exp(-_WIN_SCALE * (team_score - _WIN_MIDPOINT)))
        return max(0, min(GAMES, round(GAMES * logistic)))
