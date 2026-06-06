"""DraftScoringEngine for the All-Time Draft Challenge (WO-50).

Turns a completed five-player lineup into a deterministic 82-game win-loss
record. The metrics (WS/48, BPM, VORP, TS%) are already era-normalised and built
for cross-era comparison, so no bespoke era adjustment is needed. Scoring is
intentionally explainable: the per-player contribution returned in the breakdown
is exactly the centred value that fed the team aggregate.

Design (rewritten — see ADR-001 follow-up):

* Every metric is centred on a LEAGUE-AVERAGE STARTER (value 0) and scaled so an
  elite peak season is ~+1. Below-average players therefore go NEGATIVE and drag
  the team down — a bad starter costs you games, it is not a free empty slot.
* Rate stats (WS/48, BPM, TS%) are shrunk toward average for small-minutes
  seasons (a 500-minute specialist's gaudy rate is not trusted as full-time
  starter production). VORP — already a cumulative, minutes-aware "value over
  replacement" stat — is the volume backbone and is NOT shrunk.
* A league-average five aggregates to ~0 and maps to ~41 wins; a stack of
  all-time peak seasons can reach a perfect 82-0 (the game's stated goal); a
  team of fringe/role players lands in the 20s–30s.

Determinism (Key Contract): the same five (player_id, season_id, position_slot)
tuples always produce the same score. WS/48, BPM, VORP and minutes come from the
bundled ``player_advanced_stats.csv``. TS% is taken from PlayerDataService when a
provider is supplied and falls back to the CSV's TS% (same formula), so the score
is stable whether or not live stats are reachable.

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

# Per-metric centring. Each metric is mapped to a z-like quality scale via
# (raw - AVG) / SCALE, where AVG is a league-average full-time starter (-> 0) and
# AVG + SCALE is an elite peak season (-> +1). A below-average season is negative.
# Values are clamped to a symmetric overshoot band so a single historic outlier
# can't run away with the score.
_WS48_AVG, _WS48_SCALE = 0.100, 0.150  # .100 average starter, .250 elite
_BPM_AVG, _BPM_SCALE = 0.0, 8.0  # 0 is league average by construction; +8 superstar
_VORP_AVG, _VORP_SCALE = 2.0, 4.0  # ~2.0 full-season average starter; ~6.0 star
_TS_AVG, _TS_SCALE = 0.560, 0.080  # .560 average, .640 elite
_Z_CLAMP = 2.0  # cap each metric at ±2 "elite units"

# Minutes reliability: rate stats from tiny samples regress toward average. A
# season at or above _MP_FULL is fully trusted; below it the rate stats are
# shrunk toward 0 (average), floored at _MP_MIN_TRUST so a real season still
# counts. VORP is exempt — it already bakes in playing time.
_MP_FULL = 2000.0
_MP_MIN_TRUST = 0.5

# Position-specific metric weights (each row sums to 1.0). VORP is the shared
# backbone (volume-aware value); BPM carries playmaking/all-around impact for
# guards; WS/48 carries the efficiency+defence bigs live on; TS% is a smaller
# efficiency garnish (deliberately down-weighted so empty-calorie shooting can't
# masquerade as star value). Order: (ws_per_48, bpm, vorp, ts_pct).
_POSITION_WEIGHTS: dict[str, tuple[float, float, float, float]] = {
    "PG": (0.15, 0.35, 0.35, 0.15),
    "SG": (0.15, 0.25, 0.35, 0.25),
    "SF": (0.20, 0.25, 0.35, 0.20),
    "PF": (0.30, 0.25, 0.35, 0.10),
    "C": (0.35, 0.20, 0.35, 0.10),
}

# Synergy: a small additive bonus for a roster that is genuinely strong (above
# average) in EVERY metric dimension, rewarding complementary fives over five
# players piled into the same skill. `coverage` is the mean of the team's best
# above-average z per dimension (0..1); the bonus tops out at +_SYNERGY_WEIGHT.
_SYNERGY_WEIGHT = 0.45

# Calibrated logistic mapping team aggregate -> wins, centred at 0 (an average
# five -> 41 wins). _WIN_SCALE is set so a stack of all-time peak seasons clears
# the rounding threshold (team_score >= ~6.4) to a perfect 82-0 — the game's
# stated goal — while a fringe five sits in the teens.
_WIN_SCALE = 0.8


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


def _clamp(value: float, low: float, high: float) -> float:
    return max(low, min(high, value))


def _z_ws48(value: float) -> float:
    return _clamp((value - _WS48_AVG) / _WS48_SCALE, -_Z_CLAMP, _Z_CLAMP)


def _z_bpm(value: float) -> float:
    return _clamp((value - _BPM_AVG) / _BPM_SCALE, -_Z_CLAMP, _Z_CLAMP)


def _z_vorp(value: float) -> float:
    return _clamp((value - _VORP_AVG) / _VORP_SCALE, -_Z_CLAMP, _Z_CLAMP)


def _z_ts(value: float) -> float:
    return _clamp((value - _TS_AVG) / _TS_SCALE, -_Z_CLAMP, _Z_CLAMP)


def _reliability(mp: float) -> float:
    return _clamp(mp / _MP_FULL, _MP_MIN_TRUST, 1.0)


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
        # Per-metric centred values across the five players, for the synergy
        # coverage calculation.
        z_by_metric = {"ws": [], "bpm": [], "vorp": [], "ts": []}
        contributions: list[float] = []

        for entry in lineup.players:
            row = index.get((entry.player_id, entry.season_id))
            ws = row.ws_per_48 if row else 0.0
            bpm = row.bpm if row else 0.0
            vorp = row.vorp if row else 0.0
            csv_ts = row.ts_pct if row else 0.0
            mp = row.mp if row else 0.0
            name = row.player_name if row else str(entry.player_id)
            ts = self._resolve_ts_pct(entry.player_id, entry.season_id, csv_ts)

            # Rate stats are shrunk toward average for small-minutes seasons;
            # VORP (cumulative, minutes-aware) is trusted as-is.
            rel = _reliability(mp)
            z_ws = _z_ws48(ws) * rel
            z_bpm = _z_bpm(bpm) * rel
            z_vorp = _z_vorp(vorp)
            z_ts = _z_ts(ts) * rel

            z_by_metric["ws"].append(z_ws)
            z_by_metric["bpm"].append(z_bpm)
            z_by_metric["vorp"].append(z_vorp)
            z_by_metric["ts"].append(z_ts)

            w_ws, w_bpm, w_vorp, w_ts = _POSITION_WEIGHTS[entry.position_slot]
            value = w_ws * z_ws + w_bpm * z_bpm + w_vorp * z_vorp + w_ts * z_ts
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
        # Synergy: mean of the team's best ABOVE-average z per dimension. A roster
        # with an elite presence in every category gets up to +_SYNERGY_WEIGHT;
        # one that ignores a dimension (or is below average everywhere) gets ~0.
        coverage = sum(
            max(0.0, min(1.0, max(values))) for values in z_by_metric.values()
        ) / len(z_by_metric)
        team_score = aggregate + _SYNERGY_WEIGHT * coverage

        wins = self._wins_from_score(team_score)
        return DraftScore(wins=wins, losses=GAMES - wins, breakdown=breakdown)

    @staticmethod
    def _wins_from_score(team_score: float) -> int:
        logistic = 1 / (1 + math.exp(-_WIN_SCALE * team_score))
        return max(0, min(GAMES, round(GAMES * logistic)))
