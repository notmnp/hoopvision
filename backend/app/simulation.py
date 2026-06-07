import random
import re
from dataclasses import asdict, dataclass
from typing import Any, Callable

from .tendency_profile import (
    TendencyProfileBuilder,
    tendency_profile_builder,
)
from .matchup_data import MatchupDataService


ProfileProvider = Callable[[int], dict[str, Any]]

# ADR-004: the defender's career-derived block_rate and steal_rate are the
# primary contest inputs; physical matchup factors are secondary modifiers.
# Contest strength is measured as the defender's rate relative to a league
# baseline, so an elite defender meaningfully suppresses the offense while a
# poor defender concedes a slight edge.
LEAGUE_AVERAGE_BLOCK_RATE = 0.04
LEAGUE_AVERAGE_STEAL_RATE = 0.06
BLOCK_CONTEST_WEIGHT = 0.6
STEAL_PRESSURE_WEIGHT = 0.6


@dataclass(frozen=True)
class PlayByPlay:
    possession: int
    offensive_player: str
    shot_type: str
    result: str
    foul: bool
    turnover: bool
    score_a: int
    score_b: int
    # Where on the floor the shot was taken, sampled from the player's real
    # shot chart (see TendencyProfile.shot_zone_weights). Only set on an actual
    # field-goal attempt ("made"/"missed"); turnovers and drawn fouls leave both
    # None. The labels match the NBA SHOT_ZONE_BASIC / SHOT_ZONE_AREA values the
    # frontend court already maps to coordinates.
    shot_zone_basic: str | None = None
    shot_zone_area: str | None = None

    def to_dict(self) -> dict[str, Any]:
        return asdict(self)


@dataclass
class PlayerSimStats:
    points: int = 0
    field_goals_attempted: int = 0
    field_goals_made: int = 0
    turnovers: int = 0
    fouls_drawn: int = 0
    rim_attempts: int = 0
    mid_range_attempts: int = 0
    three_attempts: int = 0
    rim_made: int = 0
    mid_range_made: int = 0
    three_pointers_made: int = 0

    def to_dict(self) -> dict[str, Any]:
        attempts = self.field_goals_attempted
        return {
            "points": self.points,
            "shooting_percentage": (
                round(self.field_goals_made / attempts, 4) if attempts else 0.0
            ),
            "three_point_percentage": self._rate(
                self.three_pointers_made, self.three_attempts
            ),
            "shot_type_distribution": {
                "rim": self.rim_attempts,
                "mid_range": self.mid_range_attempts,
                "three": self.three_attempts,
            },
            "shot_type_percentage": {
                "rim": self._rate(self.rim_made, self.rim_attempts),
                "mid_range": self._rate(self.mid_range_made, self.mid_range_attempts),
                "three": self._rate(self.three_pointers_made, self.three_attempts),
            },
            "turnovers": self.turnovers,
            "fouls_drawn": self.fouls_drawn,
        }

    @staticmethod
    def _rate(made: int, attempts: int) -> float:
        return round(made / attempts, 4) if attempts else 0.0


@dataclass(frozen=True)
class PreparedMatchup:
    """Player dicts and tendency profiles built once and replayed across games.

    Profile construction is the expensive part of a simulation (it can hit the
    NBA Stats API); the per-possession game loop is cheap. Separating the two
    lets bulk runs build profiles once and replay the loop N times.
    """

    player_a: dict[str, Any]
    player_b: dict[str, Any]
    profile_a: Any
    profile_b: Any
    data_warnings: list[str]


class SimulationEngine:
    def __init__(
        self,
        profile_provider: ProfileProvider,
        profile_builder: TendencyProfileBuilder = tendency_profile_builder,
    ):
        self.profile_provider = profile_provider
        self.profile_builder = profile_builder

    def simulate(
        self,
        player_a_id: int,
        player_b_id: int,
        season_a_id: str,
        season_b_id: str,
        possession_mode: str = "make_it_take_it",
        seed: int | None = None,
    ) -> dict[str, Any]:
        matchup = self._prepare_matchup(
            player_a_id, player_b_id, season_a_id, season_b_id
        )
        return self._play_game(matchup, random.Random(seed), possession_mode)

    def simulate_bulk(
        self,
        player_a_id: int,
        player_b_id: int,
        season_a_id: str,
        season_b_id: str,
        n: int,
        possession_mode: str = "make_it_take_it",
        seed: int | None = None,
    ) -> dict[str, Any]:
        matchup = self._prepare_matchup(
            player_a_id, player_b_id, season_a_id, season_b_id
        )
        # A single RNG drives the whole batch. Left unseeded (seed=None) it draws
        # fresh system entropy, so each run is an independently generated — yet
        # statistically similar — Monte Carlo estimate (AC-ISO-002.6); pass a
        # seed only when a reproducible batch is wanted.
        rng = random.Random(seed)
        player_a_wins = 0
        player_b_wins = 0
        ties = 0
        for _ in range(n):
            scores, _, _ = self._run_possessions(
                matchup, rng, possession_mode
            )
            if scores["a"] > scores["b"]:
                player_a_wins += 1
            elif scores["b"] > scores["a"]:
                player_b_wins += 1
            else:
                ties += 1

        return {
            "player_a_wins": player_a_wins,
            "player_b_wins": player_b_wins,
            "ties": ties,
            "total_simulations": n,
            "player_a_win_pct": round(100 * player_a_wins / n, 2) if n else 0.0,
            "player_b_win_pct": round(100 * player_b_wins / n, 2) if n else 0.0,
        }

    def _prepare_matchup(
        self,
        player_a_id: int,
        player_b_id: int,
        season_a_id: str,
        season_b_id: str,
    ) -> PreparedMatchup:
        player_a = self.profile_provider(player_a_id)
        player_b = self.profile_provider(player_b_id)
        player_a_defender_bucket = self._height_bucket(player_b.get("height"))
        player_b_defender_bucket = self._height_bucket(player_a.get("height"))
        profile_a = self.profile_builder.build_profile(
            player_a_id,
            height_bucket=player_a_defender_bucket,
            season_id=season_a_id,
        )
        profile_b = self.profile_builder.build_profile(
            player_b_id,
            height_bucket=player_b_defender_bucket,
            season_id=season_b_id,
        )
        data_warnings = self._collect_data_warnings(
            player_a, player_b, profile_a, profile_b
        )
        return PreparedMatchup(
            player_a=player_a,
            player_b=player_b,
            profile_a=profile_a,
            profile_b=profile_b,
            data_warnings=data_warnings,
        )

    def _run_possessions(
        self,
        matchup: PreparedMatchup,
        rng: random.Random,
        possession_mode: str = "make_it_take_it",
    ) -> tuple[dict[str, int], dict[str, PlayerSimStats], list[PlayByPlay]]:
        player_a, player_b = matchup.player_a, matchup.player_b
        profile_a, profile_b = matchup.profile_a, matchup.profile_b
        scores = {"a": 0, "b": 0}
        stats = {
            player_a["name"]: PlayerSimStats(),
            player_b["name"]: PlayerSimStats(),
        }
        play_by_play: list[PlayByPlay] = []

        # First possession always belongs to player A; subsequent possession
        # changes are governed by possession_mode and the prior result.
        possession = 1
        offense_key = "a"
        while scores["a"] < 21 and scores["b"] < 21:
            defense_key = "b" if offense_key == "a" else "a"
            offense = player_a if offense_key == "a" else player_b
            defense = player_b if defense_key == "b" else player_a
            tendency = profile_a if offense_key == "a" else profile_b
            defense_tendency = profile_b if offense_key == "a" else profile_a

            play = self._simulate_possession(
                rng=rng,
                possession=possession,
                offense_key=offense_key,
                offense=offense,
                defense=defense,
                tendency=tendency.to_dict(),
                defense_tendency=defense_tendency.to_dict(),
                scores=scores,
                player_stats=stats[offense["name"]],
            )
            play_by_play.append(play)
            possession += 1
            offense_key = self._next_possessor(offense_key, play, possession_mode)

        return scores, stats, play_by_play

    @staticmethod
    def _next_possessor(
        offense_key: str, play: PlayByPlay, possession_mode: str
    ) -> str:
        other_key = "b" if offense_key == "a" else "a"
        # A drawn foul always returns the ball to the same player for a retry,
        # in both possession modes (AC-ISO-006.4).
        if play.foul:
            return offense_key
        if possession_mode == "alternating":
            return other_key
        # make-it-take-it: scorer keeps possession, otherwise it transfers.
        if play.result == "made":
            return offense_key
        return other_key

    def _play_game(
        self,
        matchup: PreparedMatchup,
        rng: random.Random,
        possession_mode: str = "make_it_take_it",
    ) -> dict[str, Any]:
        scores, stats, play_by_play = self._run_possessions(
            matchup, rng, possession_mode
        )
        winner_key = "a" if scores["a"] >= 21 else "b"
        winner = (
            matchup.player_a["name"] if winner_key == "a" else matchup.player_b["name"]
        )
        confidence_by_name = {
            matchup.player_a["name"]: matchup.profile_a.confidence_tier,
            matchup.player_b["name"]: matchup.profile_b.confidence_tier,
        }

        return {
            "play_by_play": [play.to_dict() for play in play_by_play],
            "win_probability": self._win_probability_curve(
                matchup, play_by_play, possession_mode
            ),
            "summary": {
                "winner": winner,
                "final_score": scores,
                "player_stats": {
                    player_name: {
                        **player_stats.to_dict(),
                        "confidence_tier": confidence_by_name.get(player_name),
                    }
                    for player_name, player_stats in stats.items()
                },
                "data_warnings": matchup.data_warnings,
            },
        }

    def _possession_outcome_dist(
        self,
        profile_off: Any,
        profile_def: Any,
        player_off: dict[str, Any],
        player_def: dict[str, Any],
    ) -> dict[str, float]:
        """One offensive possession's outcome distribution, from the model.

        Collapses the same turnover → foul → shot logic the engine plays out
        each possession (see _simulate_possession) into the probabilities of
        {turnover, foul (retry), made 2, made 3, miss}, reusing the exact
        contest helpers so the win-probability agrees with the simulation.
        """
        defense_tendency = profile_def.to_dict()
        turnover = self._defense_adjusted_turnover_rate(
            profile_off.turnover_rate, defense_tendency, player_off, player_def
        )
        foul = min(0.95, max(0.0, profile_off.foul_drawing_rate))
        dist = profile_off.shot_type_distribution
        eff = profile_off.scoring_efficiency_by_shot_type
        make = {
            band: self._make_probability(
                eff[band], defense_tendency, player_off, player_def
            )
            for band in ("rim", "mid_range", "three")
        }
        live = (1.0 - turnover) * (1.0 - foul)
        return {
            "turnover": turnover,
            "foul": foul,
            "make2": live
            * (dist["rim"] * make["rim"] + dist["mid_range"] * make["mid_range"]),
            "make3": live * (dist["three"] * make["three"]),
            "miss": live
            * (
                dist["rim"] * (1.0 - make["rim"])
                + dist["mid_range"] * (1.0 - make["mid_range"])
                + dist["three"] * (1.0 - make["three"])
            ),
        }

    def _win_probability_curve(
        self,
        matchup: PreparedMatchup,
        play_by_play: list[PlayByPlay],
        possession_mode: str,
    ) -> list[float]:
        """Player A's win probability after each possession, from the model.

        An absorbing-barrier Markov chain over (score_a, score_b, who-has-the-
        ball), whose per-possession scoring distributions come from each
        player's tendency profile (_possession_outcome_dist). It is pinned to
        1.0 / 0.0 ONLY when a player has actually reached 21 — every other state
        is strictly between, so a comeback is always possible (AC: no premature
        certainty). Computed once per game.
        """
        dist_a = self._possession_outcome_dist(
            matchup.profile_a, matchup.profile_b, matchup.player_a, matchup.player_b
        )
        dist_b = self._possession_outcome_dist(
            matchup.profile_b, matchup.profile_a, matchup.player_b, matchup.player_a
        )
        make_keeps = possession_mode != "alternating"
        memo: dict[tuple[int, int], tuple[float, float]] = {}

        def win_at(sa: int, sb: int, poss: str) -> float:
            if sa >= 21:
                return 1.0
            if sb >= 21:
                return 0.0
            pair = memo[(sa, sb)]
            return pair[0] if poss == "a" else pair[1]

        # Solve from the highest total score downward. Same-score A/B states
        # reference each other (a miss/turnover flips possession without
        # scoring), so each (sa, sb) is a 2x2 linear system solved together;
        # the made-shot terms only ever reference strictly-higher scores.
        for total in range(40, -1, -1):
            for sa in range(0, 21):
                sb = total - sa
                if sb < 0 or sb > 20:
                    continue
                a_make = "a" if make_keeps else "b"
                b_make = "b" if make_keeps else "a"
                a_const = (
                    dist_a["make2"] * win_at(sa + 2, sb, a_make)
                    + dist_a["make3"] * win_at(sa + 3, sb, a_make)
                ) / (1.0 - dist_a["foul"])
                a_coef = (dist_a["turnover"] + dist_a["miss"]) / (1.0 - dist_a["foul"])
                b_const = (
                    dist_b["make2"] * win_at(sa, sb + 2, b_make)
                    + dist_b["make3"] * win_at(sa, sb + 3, b_make)
                ) / (1.0 - dist_b["foul"])
                b_coef = (dist_b["turnover"] + dist_b["miss"]) / (1.0 - dist_b["foul"])
                denom = 1.0 - a_coef * b_coef
                if abs(denom) < 1e-9:
                    denom = 1e-9
                w_a = (a_const + a_coef * b_const) / denom
                w_b = b_const + b_coef * w_a
                memo[(sa, sb)] = (min(1.0, max(0.0, w_a)), min(1.0, max(0.0, w_b)))

        name_a = matchup.player_a["name"]
        curve: list[float] = []
        for index, play in enumerate(play_by_play):
            nxt = play_by_play[index + 1] if index + 1 < len(play_by_play) else None
            next_poss = "a" if (nxt is not None and nxt.offensive_player == name_a) else "b"
            curve.append(round(win_at(play.score_a, play.score_b, next_poss), 4))
        return curve

    def _simulate_possession(
        self,
        rng: random.Random,
        possession: int,
        offense_key: str,
        offense: dict[str, Any],
        defense: dict[str, Any],
        tendency: dict[str, Any],
        defense_tendency: dict[str, Any],
        scores: dict[str, int],
        player_stats: PlayerSimStats,
    ) -> PlayByPlay:
        shot_type = self._choose_shot_type(rng, tendency["shot_type_distribution"])
        turnover_rate = self._defense_adjusted_turnover_rate(
            tendency["turnover_rate"], defense_tendency, offense, defense
        )

        if rng.random() < turnover_rate:
            player_stats.turnovers += 1
            return PlayByPlay(
                possession=possession,
                offensive_player=offense["name"],
                shot_type=shot_type,
                result="turnover",
                foul=False,
                turnover=True,
                score_a=scores["a"],
                score_b=scores["b"],
            )

        if rng.random() < tendency["foul_drawing_rate"]:
            # A drawn foul awards no points and does not change the score; the
            # fouled player retains possession for a retry (handled by the
            # possession loop via _next_possessor).
            player_stats.fouls_drawn += 1
            return PlayByPlay(
                possession=possession,
                offensive_player=offense["name"],
                shot_type=shot_type,
                result="foul_drawn",
                foul=True,
                turnover=False,
                score_a=scores["a"],
                score_b=scores["b"],
            )

        player_stats.field_goals_attempted += 1
        self._increment_shot_attempt(player_stats, shot_type)
        make_probability = self._make_probability(
            tendency["scoring_efficiency_by_shot_type"][shot_type],
            defense_tendency,
            offense,
            defense,
        )
        made = rng.random() < make_probability
        points = 3 if shot_type == "three" else 2

        if made:
            player_stats.field_goals_made += 1
            player_stats.points += points
            scores[offense_key] += points
            if shot_type == "three":
                player_stats.three_pointers_made += 1
            elif shot_type == "rim":
                player_stats.rim_made += 1
            else:
                player_stats.mid_range_made += 1

        # Sample a concrete court zone within the chosen band from the player's
        # real shot-chart distribution. Drawn last so the make/miss outcome above
        # is unaffected, and only on a real FGA (turnovers/fouls return earlier).
        shot_zone_basic, shot_zone_area = self._choose_shot_zone(
            rng, tendency.get("shot_zone_weights", {}).get(shot_type, [])
        )

        return PlayByPlay(
            possession=possession,
            offensive_player=offense["name"],
            shot_type=shot_type,
            result="made" if made else "missed",
            foul=False,
            turnover=False,
            score_a=scores["a"],
            score_b=scores["b"],
            shot_zone_basic=shot_zone_basic,
            shot_zone_area=shot_zone_area,
        )

    @staticmethod
    def _choose_shot_type(
        rng: random.Random, shot_distribution: dict[str, float]
    ) -> str:
        roll = rng.random()
        cumulative = 0.0
        for shot_type in ("rim", "mid_range", "three"):
            cumulative += shot_distribution.get(shot_type, 0)
            if roll <= cumulative:
                return shot_type
        return "mid_range"

    @staticmethod
    def _choose_shot_zone(
        rng: random.Random, zones: list[dict[str, Any]]
    ) -> tuple[str | None, str | None]:
        # Weighted pick of a (SHOT_ZONE_BASIC, SHOT_ZONE_AREA) location within the
        # already-chosen band. Consumes NO RNG when no zones are available (e.g.
        # a profile built without shot_zone_weights), so seeded games without
        # location data stay byte-identical to before.
        if not zones:
            return None, None
        total = sum(max(0.0, zone.get("weight", 0.0)) for zone in zones)
        if total <= 0:
            return zones[0].get("basic"), zones[0].get("area")
        roll = rng.random() * total
        cumulative = 0.0
        for zone in zones:
            cumulative += max(0.0, zone.get("weight", 0.0))
            if roll <= cumulative:
                return zone.get("basic"), zone.get("area")
        return zones[-1].get("basic"), zones[-1].get("area")

    def _make_probability(
        self,
        base_probability: float,
        defense_tendency: dict[str, Any],
        offense: dict[str, Any],
        defense: dict[str, Any],
    ) -> float:
        # Primary: the defender's career block rate contests the shot. An
        # above-average shot blocker suppresses the make probability; a
        # below-average one concedes a small edge.
        block_contest = (
            self._to_float(defense_tendency.get("block_rate"))
            - LEAGUE_AVERAGE_BLOCK_RATE
        ) * BLOCK_CONTEST_WEIGHT
        # Secondary: physical presence still matters, particularly at the rim,
        # but does not override career defensive skill.
        height_edge = (
            self._height_inches(offense.get("height"))
            - self._height_inches(defense.get("height"))
        ) * 0.002
        wingspan_edge = (
            self._to_float(offense.get("wingspan"))
            - self._to_float(defense.get("wingspan"))
        ) * 0.0015
        weight_edge = (
            self._to_float(offense.get("weight"))
            - self._to_float(defense.get("weight"))
        ) * 0.0005
        return self._clamp(
            base_probability
            - block_contest
            + height_edge
            + wingspan_edge
            + weight_edge
        )

    def _defense_adjusted_turnover_rate(
        self,
        base_turnover_rate: float,
        defense_tendency: dict[str, Any],
        offense: dict[str, Any],
        defense: dict[str, Any],
    ) -> float:
        # Primary: the defender's career steal rate drives turnover pressure.
        steal_pressure = (
            self._to_float(defense_tendency.get("steal_rate"))
            - LEAGUE_AVERAGE_STEAL_RATE
        ) * STEAL_PRESSURE_WEIGHT
        # Secondary: a longer-armed defender forces marginally more turnovers.
        wingspan_pressure = (
            max(
                0.0,
                self._to_float(defense.get("wingspan"))
                - self._to_float(offense.get("wingspan")),
            )
            * 0.0008
        )
        return self._clamp(
            base_turnover_rate + steal_pressure + wingspan_pressure, 0.04, 0.28
        )

    @staticmethod
    def _increment_shot_attempt(player_stats: PlayerSimStats, shot_type: str) -> None:
        if shot_type == "rim":
            player_stats.rim_attempts += 1
        elif shot_type == "three":
            player_stats.three_attempts += 1
        else:
            player_stats.mid_range_attempts += 1

    @staticmethod
    def _collect_data_warnings(
        player_a: dict[str, Any],
        player_b: dict[str, Any],
        profile_a: Any,
        profile_b: Any,
    ) -> list[str]:
        warnings = []
        for player in (player_a, player_b):
            warnings.extend(player.get("data_warnings", []))
        warnings.extend(profile_a.data_warnings)
        warnings.extend(profile_b.data_warnings)
        return list(dict.fromkeys(warnings))

    @staticmethod
    def _height_inches(value: Any) -> float:
        if not value:
            return 78.0

        match = re.search(r"(\d+)\s*-\s*(\d+)", str(value))
        if not match:
            return 78.0

        return float(int(match.group(1)) * 12 + int(match.group(2)))

    @staticmethod
    def _height_bucket(value: Any) -> str:
        return MatchupDataService.height_bucket_for_inches(
            SimulationEngine._height_inches(value)
        )

    @staticmethod
    def _to_float(value: Any) -> float:
        try:
            return float(value or 0)
        except (TypeError, ValueError):
            return 0.0

    @staticmethod
    def _clamp(value: float, minimum: float = 0.15, maximum: float = 0.85) -> float:
        return max(minimum, min(maximum, value))
