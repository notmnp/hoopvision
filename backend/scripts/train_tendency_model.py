from __future__ import annotations

import argparse
import sys
from dataclasses import asdict, dataclass
from datetime import date
from pathlib import Path
from typing import Any

import joblib
import numpy as np
from nba_api.stats.endpoints import playercareerstats
from nba_api.stats.static import players
from sklearn.ensemble import GradientBoostingRegressor
from sklearn.metrics import mean_absolute_error, r2_score, root_mean_squared_error
from sklearn.model_selection import train_test_split
from sklearn.multioutput import MultiOutputRegressor

PROJECT_ROOT = Path(__file__).resolve().parents[2]
if str(PROJECT_ROOT) not in sys.path:
    sys.path.insert(0, str(PROJECT_ROOT))

from backend.app.era_adjustment import EraAdjustmentService, era_adjustment_service
from backend.app.matchup_data import (  # noqa: E402
    HEIGHT_BUCKETS,
    MatchupConditionedStats,
    MatchupDataService,
    ZoneShotData,
    matchup_data_service,
)
from backend.app.nba_stats_client import (  # noqa: E402
    NBA_STATS_HEADERS,
    NBA_STATS_TIMEOUT_SECONDS,
    fetch_stats_data,
)


MODEL_VERSION = "v2_matchup_conditioned"
DEFAULT_R2_FLOOR = 0.0
DEFAULT_ARTIFACT_DIR = PROJECT_ROOT / "backend" / "data"
HEIGHT_BUCKET_ORDINAL = {
    "guard": 0,
    "wing": 1,
    "big": 2,
    "center": 3,
}
POSITION_ARCHETYPES = ("guard", "wing", "big", "center")

FEATURE_COLUMNS = (
    "height_bucket_ordinal",
    "points_per_game",
    "fga_per_game",
    "three_point_attempt_rate",
    "free_throw_attempt_rate",
    "assist_per_game",
    "turnover_per_game",
    "rebound_per_game",
    "block_per_game",
    "steal_per_game",
    "pace_multiplier",
    "scoring_environment_multiplier",
)

TARGET_COLUMNS = (
    "rim_frequency",
    "mid_range_frequency",
    "three_frequency",
    "rim_efficiency",
    "mid_range_efficiency",
    "three_efficiency",
    "foul_drawing_rate",
    "turnover_rate",
    "block_rate",
    "steal_rate",
)


@dataclass(frozen=True)
class TrainingRow:
    player_id: int
    height_bucket: str
    position_archetype: str
    sufficient_sample: bool
    possession_count: int
    features: dict[str, float]
    targets: dict[str, float]


@dataclass(frozen=True)
class MetricSet:
    mae: float
    rmse: float
    r2: float


@dataclass(frozen=True)
class ModelCalibrationReport:
    r2_floor: float
    metrics_by_height_bucket: dict[str, dict[str, MetricSet]]

    def to_dict(self) -> dict[str, Any]:
        return {
            "r2_floor": self.r2_floor,
            "metrics_by_height_bucket": {
                bucket: {
                    target: asdict(metrics)
                    for target, metrics in target_metrics.items()
                }
                for bucket, target_metrics in self.metrics_by_height_bucket.items()
            },
        }


class CalibrationError(RuntimeError):
    pass


class TendencyModelTrainer:
    def __init__(
        self,
        matchup_service: MatchupDataService = matchup_data_service,
        era_service: EraAdjustmentService = era_adjustment_service,
        r2_floor: float = DEFAULT_R2_FLOOR,
    ):
        self.matchup_service = matchup_service
        self.era_service = era_service
        self.r2_floor = r2_floor

    def assemble_dataset(
        self,
        player_ids: list[int] | None = None,
        limit_players: int | None = None,
    ) -> list[TrainingRow]:
        rows: list[TrainingRow] = []
        ids = player_ids or [int(player["id"]) for player in players.get_players()]
        if limit_players is not None:
            ids = ids[:limit_players]

        for player_id in ids:
            career_rows = self._fetch_career_rows(player_id)
            if not self._has_tracking_era_season(career_rows):
                continue

            features_base = self._extract_features(career_rows)
            position_archetype = self._position_archetype(career_rows)
            for height_bucket in HEIGHT_BUCKETS:
                matchup_stats = self.matchup_service.get_matchup_stats(
                    player_id,
                    height_bucket,
                )
                if matchup_stats.possession_count <= 0:
                    continue

                features = {
                    **features_base,
                    "height_bucket_ordinal": float(
                        HEIGHT_BUCKET_ORDINAL[height_bucket]
                    ),
                }
                rows.append(
                    TrainingRow(
                        player_id=player_id,
                        height_bucket=height_bucket,
                        position_archetype=position_archetype,
                        sufficient_sample=matchup_stats.sufficient_sample,
                        possession_count=matchup_stats.possession_count,
                        features=features,
                        targets=self._extract_targets(matchup_stats, features),
                    )
                )
        return rows

    def train(self, rows: list[TrainingRow]) -> dict[str, Any]:
        training_rows = [row for row in rows if row.sufficient_sample]
        evaluation_rows = list(rows)
        if len(training_rows) < 2:
            raise ValueError(
                "At least two sufficient-sample rows are required to train"
            )
        if len(evaluation_rows) < 2:
            raise ValueError("At least two rows are required for evaluation")

        train_rows, test_rows = self._split_rows(training_rows, evaluation_rows)
        model = self._fit_model(train_rows)
        report = self._calibration_report(model, test_rows)
        self._validate_calibration(report)

        return {
            "model": model,
            "metadata": {
                "model_version": MODEL_VERSION,
                "training_date": date.today().isoformat(),
                "training_set_size": len(train_rows),
                "evaluation_set_size": len(test_rows),
                "feature_columns": FEATURE_COLUMNS,
                "target_columns": TARGET_COLUMNS,
                "per_bucket_sample_counts": self._sample_counts(training_rows),
                "calibration_report": report.to_dict(),
            },
        }

    def write_artifact(
        self,
        artifact: dict[str, Any],
        output_dir: Path = DEFAULT_ARTIFACT_DIR,
    ) -> Path:
        output_dir.mkdir(parents=True, exist_ok=True)
        output_path = output_dir / f"tendency_model_{MODEL_VERSION}.joblib"
        joblib.dump(artifact, output_path)
        return output_path

    def _fetch_career_rows(self, player_id: int) -> list[dict[str, Any]]:
        data = fetch_stats_data(
            f"playercareerstats:{player_id}:totals",
            lambda: playercareerstats.PlayerCareerStats(
                player_id=player_id,
                headers=NBA_STATS_HEADERS.copy(),
                timeout=NBA_STATS_TIMEOUT_SECONDS,
            ),
        )
        return data.get("SeasonTotalsRegularSeason", [])

    def _extract_features(self, career_rows: list[dict[str, Any]]) -> dict[str, float]:
        totals = self._sum_totals(career_rows)
        games = max(1.0, totals["GP"])
        career_start, career_end = self._career_year_range(career_rows)
        era_adjustment = self.era_service.get_adjustment(career_start, career_end)

        return {
            "points_per_game": self._per_game(totals["PTS"], games),
            "fga_per_game": self._per_game(totals["FGA"], games),
            "three_point_attempt_rate": self._safe_rate(totals["FG3A"], totals["FGA"]),
            "free_throw_attempt_rate": self._safe_rate(totals["FTA"], totals["FGA"]),
            "assist_per_game": self._per_game(totals["AST"], games),
            "turnover_per_game": self._per_game(totals["TOV"], games),
            "rebound_per_game": self._per_game(totals["REB"], games),
            "block_per_game": self._per_game(totals["BLK"], games),
            "steal_per_game": self._per_game(totals["STL"], games),
            "pace_multiplier": era_adjustment.pace_multiplier,
            "scoring_environment_multiplier": (
                era_adjustment.scoring_environment_multiplier
            ),
        }

    def _extract_targets(
        self,
        matchup_stats: MatchupConditionedStats,
        features: dict[str, float],
    ) -> dict[str, float]:
        zone_targets = self._zone_targets(matchup_stats.zone_data)
        possessions = max(1, matchup_stats.possession_count)
        fga = max(1, matchup_stats.fga)
        return {
            **zone_targets,
            "foul_drawing_rate": self._clamp(
                matchup_stats.free_throw_attempts / fga,
                0.0,
                1.0,
            ),
            "turnover_rate": self._clamp(
                matchup_stats.turnovers / possessions, 0.0, 1.0
            ),
            "block_rate": self._clamp(matchup_stats.blocks / fga, 0.0, 1.0),
            "steal_rate": self._clamp(features["steal_per_game"] / 12.0, 0.0, 1.0),
        }

    @staticmethod
    def _zone_targets(zone_data: list[ZoneShotData]) -> dict[str, float]:
        grouped = {
            "rim": {"fga": 0, "fgm": 0},
            "mid_range": {"fga": 0, "fgm": 0},
            "three": {"fga": 0, "fgm": 0},
        }
        for zone in zone_data:
            shot_type = TendencyModelTrainer._shot_type_from_zone(zone)
            grouped[shot_type]["fga"] += zone.fga
            grouped[shot_type]["fgm"] += zone.fgm

        total_fga = sum(bucket["fga"] for bucket in grouped.values())
        if total_fga <= 0:
            return {
                "rim_frequency": 0.34,
                "mid_range_frequency": 0.33,
                "three_frequency": 0.33,
                "rim_efficiency": 0.62,
                "mid_range_efficiency": 0.42,
                "three_efficiency": 0.36,
            }

        return {
            "rim_frequency": round(grouped["rim"]["fga"] / total_fga, 4),
            "mid_range_frequency": round(grouped["mid_range"]["fga"] / total_fga, 4),
            "three_frequency": round(grouped["three"]["fga"] / total_fga, 4),
            "rim_efficiency": TendencyModelTrainer._efficiency(grouped["rim"]),
            "mid_range_efficiency": TendencyModelTrainer._efficiency(
                grouped["mid_range"]
            ),
            "three_efficiency": TendencyModelTrainer._efficiency(grouped["three"]),
        }

    @staticmethod
    def _shot_type_from_zone(zone: ZoneShotData) -> str:
        text = " ".join(
            (
                zone.shot_zone_basic,
                zone.shot_zone_area,
                zone.shot_zone_range,
            )
        ).lower()
        if "3" in text or "24+" in text:
            return "three"
        if "restricted area" in text or "paint" in text or "less than 8" in text:
            return "rim"
        return "mid_range"

    @staticmethod
    def _split_rows(
        training_rows: list[TrainingRow],
        evaluation_rows: list[TrainingRow],
    ) -> tuple[list[TrainingRow], list[TrainingRow]]:
        if len(training_rows) < 5:
            return training_rows, evaluation_rows

        labels = [
            f"{row.height_bucket}:{row.position_archetype}" for row in training_rows
        ]
        unique_label_count = len(set(labels))
        test_count = max(1, round(len(training_rows) * 0.2))
        can_stratify = (
            min(labels.count(label) for label in set(labels)) >= 2
            and test_count >= unique_label_count
            and len(training_rows) - test_count >= unique_label_count
        )
        stratify = labels if can_stratify else None
        train_rows, test_rows = train_test_split(
            training_rows,
            test_size=0.2,
            random_state=7,
            stratify=stratify,
        )
        sparse_rows = [row for row in evaluation_rows if not row.sufficient_sample]
        return list(train_rows), list(test_rows) + sparse_rows

    @staticmethod
    def _fit_model(rows: list[TrainingRow]) -> MultiOutputRegressor:
        features = np.array(
            [[row.features[column] for column in FEATURE_COLUMNS] for row in rows]
        )
        targets = np.array(
            [[row.targets[column] for column in TARGET_COLUMNS] for row in rows]
        )
        model = MultiOutputRegressor(
            GradientBoostingRegressor(random_state=7, n_estimators=120, max_depth=2)
        )
        model.fit(features, targets)
        return model

    def _calibration_report(
        self,
        model: MultiOutputRegressor,
        rows: list[TrainingRow],
    ) -> ModelCalibrationReport:
        metrics_by_bucket: dict[str, dict[str, MetricSet]] = {}
        for bucket in HEIGHT_BUCKETS:
            bucket_rows = [row for row in rows if row.height_bucket == bucket]
            if not bucket_rows:
                continue

            y_true = np.array(
                [
                    [row.targets[column] for column in TARGET_COLUMNS]
                    for row in bucket_rows
                ]
            )
            x_values = np.array(
                [
                    [row.features[column] for column in FEATURE_COLUMNS]
                    for row in bucket_rows
                ]
            )
            y_pred = model.predict(x_values)
            metrics_by_bucket[bucket] = {}
            for index, target in enumerate(TARGET_COLUMNS):
                true_values = y_true[:, index]
                predicted_values = y_pred[:, index]
                r2 = (
                    r2_score(true_values, predicted_values)
                    if len(bucket_rows) >= 2
                    else 1.0
                )
                metrics_by_bucket[bucket][target] = MetricSet(
                    mae=round(mean_absolute_error(true_values, predicted_values), 6),
                    rmse=round(
                        root_mean_squared_error(
                            true_values,
                            predicted_values,
                        ),
                        6,
                    ),
                    r2=round(float(r2), 6),
                )
        return ModelCalibrationReport(
            r2_floor=self.r2_floor,
            metrics_by_height_bucket=metrics_by_bucket,
        )

    def _validate_calibration(self, report: ModelCalibrationReport) -> None:
        failures = []
        for bucket, target_metrics in report.metrics_by_height_bucket.items():
            for target, metrics in target_metrics.items():
                if metrics.r2 < self.r2_floor:
                    failures.append(f"{bucket}.{target} r2={metrics.r2}")
        if failures:
            raise CalibrationError(
                "Model calibration below promotion floor: " + ", ".join(failures)
            )

    @staticmethod
    def _sample_counts(rows: list[TrainingRow]) -> dict[str, int]:
        return {
            bucket: sum(1 for row in rows if row.height_bucket == bucket)
            for bucket in HEIGHT_BUCKETS
        }

    @staticmethod
    def _sum_totals(career_rows: list[dict[str, Any]]) -> dict[str, float]:
        columns = ("GP", "PTS", "FGA", "FG3A", "FTA", "AST", "TOV", "REB", "BLK", "STL")
        return {
            column: sum(
                TendencyModelTrainer._to_float(row.get(column)) for row in career_rows
            )
            for column in columns
        }

    @staticmethod
    def _position_archetype(career_rows: list[dict[str, Any]]) -> str:
        position = " ".join(
            str(row.get("PLAYER_POSITION") or "") for row in career_rows
        )
        position = position.upper()
        if "C" in position:
            return "center"
        if "F" in position:
            return "wing"
        if "G" in position:
            return "guard"
        return "wing"

    @staticmethod
    def _has_tracking_era_season(career_rows: list[dict[str, Any]]) -> bool:
        for row in career_rows:
            season_id = str(row.get("SEASON_ID") or "")
            if len(season_id) >= 4 and season_id[:4].isdigit():
                if int(season_id[:4]) >= 2013:
                    return True
        return False

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
    def _per_game(value: float, games: float) -> float:
        return round(value / games, 4)

    @staticmethod
    def _safe_rate(numerator: float, denominator: float) -> float:
        if denominator <= 0:
            return 0.0
        return round(numerator / denominator, 4)

    @staticmethod
    def _efficiency(values: dict[str, int]) -> float:
        if values["fga"] <= 0:
            return 0.0
        return round(values["fgm"] / values["fga"], 4)

    @staticmethod
    def _clamp(value: float, minimum: float, maximum: float) -> float:
        return round(max(minimum, min(maximum, value)), 4)

    @staticmethod
    def _to_float(value: Any) -> float:
        try:
            return float(value or 0)
        except (TypeError, ValueError):
            return 0.0


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Train the matchup-conditioned tendency model."
    )
    parser.add_argument("--output-dir", type=Path, default=DEFAULT_ARTIFACT_DIR)
    parser.add_argument("--limit-players", type=int, default=None)
    parser.add_argument("--r2-floor", type=float, default=DEFAULT_R2_FLOOR)
    return parser.parse_args()


def main() -> None:
    args = parse_args()
    trainer = TendencyModelTrainer(r2_floor=args.r2_floor)
    rows = trainer.assemble_dataset(limit_players=args.limit_players)
    artifact = trainer.train(rows)
    output_path = trainer.write_artifact(artifact, args.output_dir)
    metadata = artifact["metadata"]
    print(
        "Wrote "
        f"{output_path} with {metadata['training_set_size']} training rows "
        f"and {metadata['evaluation_set_size']} evaluation rows."
    )


if __name__ == "__main__":
    main()
