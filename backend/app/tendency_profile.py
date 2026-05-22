from dataclasses import asdict, dataclass
from typing import Any

import numpy as np
from nba_api.stats.endpoints import playercareerstats
from sklearn.ensemble import GradientBoostingRegressor
from sklearn.multioutput import MultiOutputRegressor

from backend.app.era_adjustment import EraAdjustmentService, era_adjustment_service


MODEL_VERSION = "embedded-gradient-boosting-v1"

FEATURE_COLUMNS = (
    "points_per_game",
    "field_goal_attempts_per_game",
    "three_point_attempt_rate",
    "free_throw_attempt_rate",
    "assist_per_game",
    "turnover_per_game",
    "rebound_per_game",
    "pace_multiplier",
    "scoring_environment_multiplier",
)

OUTPUT_COLUMNS = (
    "rim_frequency",
    "mid_range_frequency",
    "three_frequency",
    "rim_efficiency",
    "mid_range_efficiency",
    "three_efficiency",
    "foul_drawing_rate",
    "turnover_rate",
)

LEAGUE_AVERAGE_FEATURES = {
    "points_per_game": 12.0,
    "field_goal_attempts_per_game": 9.5,
    "three_point_attempt_rate": 0.30,
    "free_throw_attempt_rate": 0.24,
    "assist_per_game": 2.4,
    "turnover_per_game": 1.5,
    "rebound_per_game": 4.5,
}

TRAINING_ROWS = (
    {
        "features": (30.0, 21.0, 0.18, 0.34, 5.0, 3.0, 6.0, 1.0, 1.0),
        "outputs": (0.38, 0.44, 0.18, 0.68, 0.46, 0.36, 0.18, 0.12),
    },
    {
        "features": (27.0, 20.0, 0.42, 0.20, 6.5, 3.2, 5.0, 1.0, 1.0),
        "outputs": (0.28, 0.22, 0.50, 0.64, 0.44, 0.41, 0.12, 0.13),
    },
    {
        "features": (24.0, 16.0, 0.10, 0.45, 3.0, 2.5, 10.0, 1.0, 1.0),
        "outputs": (0.58, 0.32, 0.10, 0.72, 0.42, 0.32, 0.23, 0.14),
    },
    {
        "features": (16.0, 11.0, 0.55, 0.14, 2.0, 1.1, 4.0, 1.0, 1.0),
        "outputs": (0.20, 0.18, 0.62, 0.62, 0.42, 0.40, 0.08, 0.09),
    },
    {
        "features": (18.0, 14.0, 0.04, 0.32, 8.5, 3.4, 4.0, 1.0, 1.0),
        "outputs": (0.44, 0.48, 0.08, 0.65, 0.45, 0.31, 0.16, 0.16),
    },
    {
        "features": (10.0, 7.5, 0.02, 0.26, 1.4, 1.2, 9.0, 1.0, 1.0),
        "outputs": (0.68, 0.28, 0.04, 0.70, 0.39, 0.25, 0.13, 0.12),
    },
    {
        "features": (8.0, 6.0, 0.38, 0.18, 1.2, 0.8, 3.5, 1.0, 1.0),
        "outputs": (0.24, 0.22, 0.54, 0.60, 0.40, 0.37, 0.07, 0.08),
    },
    {
        "features": (14.0, 10.5, 0.22, 0.28, 4.5, 1.8, 5.5, 1.0, 1.0),
        "outputs": (0.38, 0.34, 0.28, 0.64, 0.43, 0.35, 0.12, 0.10),
    },
)


@dataclass(frozen=True)
class TendencyProfile:
    player_id: int
    model_version: str
    shot_type_distribution: dict[str, float]
    scoring_efficiency_by_shot_type: dict[str, float]
    foul_drawing_rate: float
    turnover_rate: float
    era_adjustment: dict[str, Any]
    data_warnings: list[str]

    def to_dict(self) -> dict[str, Any]:
        return asdict(self)


class EmbeddedTendencyModel:
    def __init__(self):
        features = np.array([row["features"] for row in TRAINING_ROWS])
        outputs = np.array([row["outputs"] for row in TRAINING_ROWS])
        self.model = MultiOutputRegressor(
            GradientBoostingRegressor(random_state=7, n_estimators=40, max_depth=2)
        )
        self.model.fit(features, outputs)

    def predict(self, features: dict[str, float]) -> dict[str, float]:
        feature_vector = np.array([[features[column] for column in FEATURE_COLUMNS]])
        prediction = self.model.predict(feature_vector)[0]
        return dict(zip(OUTPUT_COLUMNS, prediction, strict=True))


class TendencyProfileBuilder:
    def __init__(
        self,
        model: EmbeddedTendencyModel | None = None,
        era_service: EraAdjustmentService = era_adjustment_service,
    ):
        self.model = model or EmbeddedTendencyModel()
        self.era_service = era_service

    def build_profile(
        self,
        player_id: int,
        career_start_year: int | str | None = None,
        career_end_year: int | str | None = None,
    ) -> TendencyProfile:
        season_rows = self._fetch_regular_season_rows(player_id)
        features, data_warnings = self._extract_features(season_rows)
        inferred_start, inferred_end = self._career_year_range(season_rows)

        era_adjustment = self.era_service.get_adjustment(
            career_start_year or inferred_start,
            career_end_year or inferred_end,
        )
        features["pace_multiplier"] = era_adjustment.pace_multiplier
        features["scoring_environment_multiplier"] = (
            era_adjustment.scoring_environment_multiplier
        )

        prediction = self.model.predict(features)
        shot_distribution = self._normalize_distribution(
            {
                "rim": prediction["rim_frequency"],
                "mid_range": prediction["mid_range_frequency"],
                "three": prediction["three_frequency"],
            }
        )

        return TendencyProfile(
            player_id=player_id,
            model_version=MODEL_VERSION,
            shot_type_distribution=shot_distribution,
            scoring_efficiency_by_shot_type={
                "rim": self._clamp(prediction["rim_efficiency"], 0.45, 0.85),
                "mid_range": self._clamp(
                    prediction["mid_range_efficiency"], 0.30, 0.60
                ),
                "three": self._clamp(prediction["three_efficiency"], 0.20, 0.50),
            },
            foul_drawing_rate=self._clamp(prediction["foul_drawing_rate"], 0.03, 0.30),
            turnover_rate=self._clamp(prediction["turnover_rate"], 0.04, 0.24),
            era_adjustment=era_adjustment.to_dict(),
            data_warnings=data_warnings,
        )

    def _fetch_regular_season_rows(self, player_id: int) -> list[dict[str, Any]]:
        stats = playercareerstats.PlayerCareerStats(player_id=player_id)
        data = stats.get_normalized_dict()
        return data.get("SeasonTotalsRegularSeason", [])

    def _extract_features(
        self, season_rows: list[dict[str, Any]]
    ) -> tuple[dict[str, float], list[str]]:
        data_warnings: list[str] = []
        totals = self._sum_totals(season_rows)
        games = totals.get("GP", 0)

        if games <= 0:
            data_warnings.append(
                "League-average tendency inputs substituted because no regular-season stats were found."
            )
            return {
                **LEAGUE_AVERAGE_FEATURES,
                "pace_multiplier": 1.0,
                "scoring_environment_multiplier": 1.0,
            }, data_warnings

        features = {
            "points_per_game": self._per_game(totals, "PTS", games),
            "field_goal_attempts_per_game": self._per_game(totals, "FGA", games),
            "three_point_attempt_rate": self._safe_rate(
                totals.get("FG3A"), totals.get("FGA")
            ),
            "free_throw_attempt_rate": self._safe_rate(
                totals.get("FTA"), totals.get("FGA")
            ),
            "assist_per_game": self._per_game(totals, "AST", games),
            "turnover_per_game": self._per_game(totals, "TOV", games),
            "rebound_per_game": self._per_game(totals, "REB", games),
            "pace_multiplier": 1.0,
            "scoring_environment_multiplier": 1.0,
        }

        for feature_name, fallback_value in LEAGUE_AVERAGE_FEATURES.items():
            if features[feature_name] == 0:
                features[feature_name] = fallback_value
                data_warnings.append(
                    f"League-average {feature_name} substituted because player data was missing or zero."
                )

        return features, data_warnings

    @staticmethod
    def _sum_totals(season_rows: list[dict[str, Any]]) -> dict[str, float]:
        columns = ("GP", "PTS", "FGA", "FG3A", "FTA", "AST", "TOV", "REB")
        return {
            column: sum(
                TendencyProfileBuilder._to_float(row.get(column)) for row in season_rows
            )
            for column in columns
        }

    @staticmethod
    def _career_year_range(
        season_rows: list[dict[str, Any]]
    ) -> tuple[int | None, int | None]:
        years = []
        for row in season_rows:
            season_id = str(row.get("SEASON_ID") or "")
            if len(season_id) >= 4 and season_id[:4].isdigit():
                years.append(int(season_id[:4]))

        if not years:
            return None, None
        return min(years), max(years) + 1

    @staticmethod
    def _per_game(totals: dict[str, float], column: str, games: float) -> float:
        return round(totals.get(column, 0) / games, 4)

    @staticmethod
    def _safe_rate(numerator: float | None, denominator: float | None) -> float:
        if not denominator:
            return 0.0
        return round((numerator or 0) / denominator, 4)

    @staticmethod
    def _to_float(value: Any) -> float:
        try:
            return float(value or 0)
        except (TypeError, ValueError):
            return 0.0

    @staticmethod
    def _normalize_distribution(values: dict[str, float]) -> dict[str, float]:
        clamped = {
            key: TendencyProfileBuilder._clamp(value, 0.01, 0.98)
            for key, value in values.items()
        }
        total = sum(clamped.values())
        normalized = {key: round(value / total, 4) for key, value in clamped.items()}
        rounding_delta = round(1.0 - sum(normalized.values()), 4)
        normalized["rim"] = round(normalized["rim"] + rounding_delta, 4)
        return normalized

    @staticmethod
    def _clamp(value: float, minimum: float, maximum: float) -> float:
        return round(max(minimum, min(maximum, float(value))), 4)


tendency_profile_builder = TendencyProfileBuilder()
