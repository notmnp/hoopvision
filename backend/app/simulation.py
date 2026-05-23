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

    def to_dict(self) -> dict[str, Any]:
        attempts = self.field_goals_attempted
        return {
            "points": self.points,
            "shooting_percentage": (
                round(self.field_goals_made / attempts, 4) if attempts else 0.0
            ),
            "shot_type_distribution": {
                "rim": self.rim_attempts,
                "mid_range": self.mid_range_attempts,
                "three": self.three_attempts,
            },
            "turnovers": self.turnovers,
            "fouls_drawn": self.fouls_drawn,
        }


class SimulationEngine:
    def __init__(
        self,
        profile_provider: ProfileProvider,
        profile_builder: TendencyProfileBuilder = tendency_profile_builder,
    ):
        self.profile_provider = profile_provider
        self.profile_builder = profile_builder

    def simulate(
        self, player_a_id: int, player_b_id: int, seed: int | None = None
    ) -> dict[str, Any]:
        rng = random.Random(seed)
        player_a = self.profile_provider(player_a_id)
        player_b = self.profile_provider(player_b_id)
        player_a_defender_bucket = self._height_bucket(player_b.get("height"))
        player_b_defender_bucket = self._height_bucket(player_a.get("height"))
        profile_a = self.profile_builder.build_profile(
            player_a_id,
            height_bucket=player_a_defender_bucket,
            career_start_year=player_a.get("from_year"),
            career_end_year=player_a.get("to_year"),
        )
        profile_b = self.profile_builder.build_profile(
            player_b_id,
            height_bucket=player_b_defender_bucket,
            career_start_year=player_b.get("from_year"),
            career_end_year=player_b.get("to_year"),
        )

        scores = {"a": 0, "b": 0}
        stats = {
            player_a["name"]: PlayerSimStats(),
            player_b["name"]: PlayerSimStats(),
        }
        play_by_play: list[PlayByPlay] = []
        data_warnings = self._collect_data_warnings(
            player_a, player_b, profile_a, profile_b
        )

        possession = 1
        while scores["a"] < 21 and scores["b"] < 21:
            offense_key = "a" if possession % 2 else "b"
            defense_key = "b" if offense_key == "a" else "a"
            offense = player_a if offense_key == "a" else player_b
            defense = player_b if defense_key == "b" else player_a
            tendency = profile_a if offense_key == "a" else profile_b

            play = self._simulate_possession(
                rng=rng,
                possession=possession,
                offense_key=offense_key,
                offense=offense,
                defense=defense,
                tendency=tendency.to_dict(),
                scores=scores,
                player_stats=stats[offense["name"]],
            )
            play_by_play.append(play)
            possession += 1

        winner_key = "a" if scores["a"] >= 21 else "b"
        winner = player_a["name"] if winner_key == "a" else player_b["name"]

        return {
            "play_by_play": [play.to_dict() for play in play_by_play],
            "summary": {
                "winner": winner,
                "final_score": scores,
                "player_stats": {
                    player_name: player_stats.to_dict()
                    for player_name, player_stats in stats.items()
                },
                "data_warnings": data_warnings,
            },
        }

    def _simulate_possession(
        self,
        rng: random.Random,
        possession: int,
        offense_key: str,
        offense: dict[str, Any],
        defense: dict[str, Any],
        tendency: dict[str, Any],
        scores: dict[str, int],
        player_stats: PlayerSimStats,
    ) -> PlayByPlay:
        shot_type = self._choose_shot_type(rng, tendency["shot_type_distribution"])
        turnover_rate = self._defense_adjusted_turnover_rate(
            tendency["turnover_rate"], offense, defense
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
            player_stats.fouls_drawn += 1
            player_stats.points += 1
            scores[offense_key] += 1
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
            offense,
            defense,
        )
        made = rng.random() < make_probability
        points = 3 if shot_type == "three" else 2

        if made:
            player_stats.field_goals_made += 1
            player_stats.points += points
            scores[offense_key] += points

        return PlayByPlay(
            possession=possession,
            offensive_player=offense["name"],
            shot_type=shot_type,
            result="made" if made else "missed",
            foul=False,
            turnover=False,
            score_a=scores["a"],
            score_b=scores["b"],
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

    def _make_probability(
        self,
        base_probability: float,
        offense: dict[str, Any],
        defense: dict[str, Any],
    ) -> float:
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
        return self._clamp(base_probability + height_edge + wingspan_edge + weight_edge)

    def _defense_adjusted_turnover_rate(
        self,
        base_turnover_rate: float,
        offense: dict[str, Any],
        defense: dict[str, Any],
    ) -> float:
        wingspan_pressure = (
            max(
                0.0,
                self._to_float(defense.get("wingspan"))
                - self._to_float(offense.get("wingspan")),
            )
            * 0.0008
        )
        return self._clamp(base_turnover_rate + wingspan_pressure, 0.04, 0.28)

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
