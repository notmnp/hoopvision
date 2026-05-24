import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

import joblib

from backend.app.matchup_data import MatchupConditionedStats, ZoneShotData
from backend.scripts.train_tendency_model import (
    FEATURE_COLUMNS,
    MODEL_VERSION,
    TARGET_COLUMNS,
    CalibrationError,
    TendencyModelTrainer,
)


CAREER_ROWS = [
    {
        "SEASON_ID": "2023-24",
        "GP": 70,
        "PTS": 1400,
        "FGA": 1050,
        "FG3A": 350,
        "FTA": 280,
        "AST": 280,
        "TOV": 140,
        "REB": 420,
        "BLK": 35,
        "STL": 70,
    }
]


class StubMatchupService:
    def get_matchup_stats(self, player_id, height_bucket):
        possessions = {
            "guard": 80,
            "wing": 72,
            "big": 44,
            "center": 96,
        }[height_bucket]
        return MatchupConditionedStats(
            sufficient_sample=possessions >= 50,
            possession_count=possessions,
            fgm=28,
            fga=60,
            points=70,
            free_throw_attempts=12,
            turnovers=8,
            blocks=5,
            zone_data=[
                ZoneShotData(
                    zone="Restricted Area | Center(C) | Less Than 8 ft.",
                    shot_zone_basic="Restricted Area",
                    shot_zone_area="Center(C)",
                    shot_zone_range="Less Than 8 ft.",
                    fgm=12,
                    fga=18,
                    points=24,
                    frequency=0.3,
                    field_goal_percentage=0.6667,
                ),
                ZoneShotData(
                    zone="Mid-Range | Center(C) | 16-24 ft.",
                    shot_zone_basic="Mid-Range",
                    shot_zone_area="Center(C)",
                    shot_zone_range="16-24 ft.",
                    fgm=8,
                    fga=22,
                    points=16,
                    frequency=0.3667,
                    field_goal_percentage=0.3636,
                ),
                ZoneShotData(
                    zone="Above the Break 3 | Left Side Center(LC) | 24+ ft.",
                    shot_zone_basic="Above the Break 3",
                    shot_zone_area="Left Side Center(LC)",
                    shot_zone_range="24+ ft.",
                    fgm=8,
                    fga=20,
                    points=24,
                    frequency=0.3333,
                    field_goal_percentage=0.4,
                ),
            ],
            height_bucket=height_bucket,
        )


class TendencyModelTrainerTest(unittest.TestCase):
    def setUp(self):
        self.trainer = TendencyModelTrainer(
            matchup_service=StubMatchupService(),
            r2_floors={},
        )

    def test_assembles_rows_for_tracking_era_player_buckets(self):
        with patch.object(
            self.trainer,
            "_fetch_career_rows",
            return_value=CAREER_ROWS,
        ):
            rows = self.trainer.assemble_dataset(player_ids=[203999])

        self.assertEqual(len(rows), 4)
        self.assertEqual(rows[0].features["points_per_game"], 20.0)
        self.assertEqual(rows[1].features["height_bucket_ordinal"], 1.0)
        self.assertFalse(rows[2].sufficient_sample)
        self.assertEqual(rows[0].targets["rim_frequency"], 0.3)
        self.assertEqual(set(FEATURE_COLUMNS), set(rows[0].features))
        self.assertEqual(set(TARGET_COLUMNS), set(rows[0].targets))

    def test_train_returns_versioned_artifact_metadata(self):
        rows = []
        with patch.object(
            self.trainer,
            "_fetch_career_rows",
            return_value=CAREER_ROWS,
        ):
            for player_id in [1, 2, 3]:
                rows.extend(self.trainer.assemble_dataset(player_ids=[player_id]))

        artifact = self.trainer.train(rows)

        self.assertEqual(artifact["metadata"]["model_version"], MODEL_VERSION)
        self.assertIn("calibration_report", artifact["metadata"])
        self.assertEqual(artifact["metadata"]["per_bucket_sample_counts"]["big"], 0)

    def test_write_artifact_serializes_joblib(self):
        artifact = {"model": object(), "metadata": {"model_version": MODEL_VERSION}}

        with tempfile.TemporaryDirectory() as temp_dir:
            path = self.trainer.write_artifact(artifact, Path(temp_dir))
            loaded = joblib.load(path)

        self.assertTrue(path.name.startswith("tendency_model_"))
        self.assertEqual(loaded["metadata"]["model_version"], MODEL_VERSION)

    def test_calibration_failure_refuses_promotion(self):
        rows = []
        with patch.object(
            self.trainer,
            "_fetch_career_rows",
            return_value=CAREER_ROWS,
        ):
            for player_id in [1, 2, 3]:
                rows.extend(self.trainer.assemble_dataset(player_ids=[player_id]))

        # A floor above the maximum possible R² (1.0) for a single
        # (bucket, target) pair forces the calibration gate to fail. The "big"
        # bucket is always present in the evaluation set (sparse rows are
        # appended there), so the gate reliably sees this floor.
        strict_trainer = TendencyModelTrainer(
            matchup_service=StubMatchupService(),
            r2_floors={"big": {"rim_frequency": 2.0}},
        )
        with self.assertRaises(CalibrationError):
            strict_trainer.train(rows)


if __name__ == "__main__":
    unittest.main()
