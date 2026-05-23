import unittest

from backend.app.matchup_data import MatchupConditionedStats, ZoneShotData
from backend.app.tendency_profile import TendencyProfileBuilder


class DictModel:
    model_version = "test-artifact"

    def predict(self, features):
        return {
            "rim_frequency": 0.30,
            "mid_range_frequency": 0.30,
            "three_frequency": 0.40,
            "rim_efficiency": 0.60,
            "mid_range_efficiency": 0.42,
            "three_efficiency": 0.38,
            "foul_drawing_rate": 0.10,
            "turnover_rate": 0.10,
            "block_rate": 0.05,
            "steal_rate": 0.06,
        }


class StubMatchupService:
    def __init__(self, stats=None):
        self.stats = stats
        self.calls = []

    def get_matchup_stats(self, player_id, height_bucket):
        self.calls.append((player_id, height_bucket))
        return self.stats or MatchupConditionedStats(
            sufficient_sample=False,
            possession_count=0,
            fgm=0,
            fga=0,
            points=0,
            free_throw_attempts=0,
            turnovers=0,
            blocks=0,
            zone_data=[],
            height_bucket=height_bucket,
        )


class StubbedTendencyProfileBuilder(TendencyProfileBuilder):
    def __init__(self, season_rows, matchup_service=None):
        super().__init__(
            model=DictModel(),
            matchup_service=matchup_service or StubMatchupService(),
        )
        self.season_rows = season_rows

    def _fetch_regular_season_rows(self, player_id):
        return self.season_rows


class TendencyProfileBuilderTest(unittest.TestCase):
    def test_builds_profile_from_regular_season_totals(self):
        builder = StubbedTendencyProfileBuilder(
            [
                {
                    "SEASON_ID": "1990-91",
                    "GP": 82,
                    "PTS": 2580,
                    "FGA": 1837,
                    "FG3A": 93,
                    "FTA": 671,
                    "AST": 453,
                    "TOV": 202,
                    "REB": 492,
                    "BLK": 83,
                    "STL": 223,
                },
                {
                    "SEASON_ID": "1991-92",
                    "GP": 80,
                    "PTS": 2404,
                    "FGA": 1818,
                    "FG3A": 100,
                    "FTA": 590,
                    "AST": 489,
                    "TOV": 200,
                    "REB": 511,
                    "BLK": 75,
                    "STL": 182,
                },
            ]
        )

        profile = builder.build_profile(player_id=23)

        self.assertEqual(profile.player_id, 23)
        self.assertEqual(profile.era_adjustment["era_key"], "physical_half_court")
        self.assertAlmostEqual(
            sum(profile.shot_type_distribution.values()), 1.0, places=4
        )
        self.assertIn("rim", profile.scoring_efficiency_by_shot_type)
        self.assertEqual(profile.confidence_tier, "LOW")
        self.assertTrue(
            any("confidence is LOW" in warning for warning in profile.data_warnings)
        )

    def test_uses_league_average_fallback_when_stats_are_missing(self):
        builder = StubbedTendencyProfileBuilder([])

        profile = builder.build_profile(player_id=999)

        self.assertEqual(profile.era_adjustment["era_key"], "modern_spacing")
        self.assertTrue(profile.data_warnings)
        self.assertAlmostEqual(
            sum(profile.shot_type_distribution.values()), 1.0, places=4
        )

    def test_uses_league_average_fallback_when_stats_fetch_fails(self):
        class FailingTendencyProfileBuilder(TendencyProfileBuilder):
            def _fetch_regular_season_rows(self, player_id):
                raise TimeoutError("stats.nba.com timed out")

        builder = FailingTendencyProfileBuilder()

        profile = builder.build_profile(player_id=999)

        self.assertEqual(profile.era_adjustment["era_key"], "modern_spacing")
        self.assertIn("NBA Stats career lookup failed", profile.data_warnings[0])
        self.assertTrue(
            any(
                "League-average tendency inputs substituted" in warning
                for warning in profile.data_warnings
            )
        )
        self.assertAlmostEqual(
            sum(profile.shot_type_distribution.values()), 1.0, places=4
        )

    def test_accepts_explicit_career_years_for_era_adjustment(self):
        builder = StubbedTendencyProfileBuilder([])

        profile = builder.build_profile(
            player_id=999,
            career_start_year=1960,
            career_end_year=1969,
        )

        self.assertEqual(
            profile.era_adjustment["era_key"], "pace_and_space_predecessor"
        )

    def test_accepts_height_bucket_for_model_input(self):
        builder = StubbedTendencyProfileBuilder(
            [
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
        )

        profile = builder.build_profile(player_id=203999, height_bucket="center")

        self.assertEqual(profile.height_bucket, "center")
        self.assertEqual(profile.confidence_tier, "MEDIUM")

    def test_rejects_unknown_height_bucket(self):
        builder = StubbedTendencyProfileBuilder([])

        with self.assertRaisesRegex(ValueError, "height_bucket"):
            builder.build_profile(player_id=203999, height_bucket="forward")

    def test_blends_observed_matchup_data_with_model_prediction(self):
        matchup_service = StubMatchupService(
            MatchupConditionedStats(
                sufficient_sample=True,
                possession_count=100,
                fgm=30,
                fga=60,
                points=72,
                free_throw_attempts=18,
                turnovers=6,
                blocks=3,
                zone_data=[
                    ZoneShotData(
                        zone="Restricted Area | Center(C) | Less Than 8 ft.",
                        shot_zone_basic="Restricted Area",
                        shot_zone_area="Center(C)",
                        shot_zone_range="Less Than 8 ft.",
                        fgm=20,
                        fga=30,
                        points=40,
                        frequency=0.5,
                        field_goal_percentage=0.6667,
                    ),
                    ZoneShotData(
                        zone="Above the Break 3 | Center(C) | 24+ ft.",
                        shot_zone_basic="Above the Break 3",
                        shot_zone_area="Center(C)",
                        shot_zone_range="24+ ft.",
                        fgm=10,
                        fga=30,
                        points=30,
                        frequency=0.5,
                        field_goal_percentage=0.3333,
                    ),
                ],
                height_bucket="guard",
            )
        )
        builder = StubbedTendencyProfileBuilder(
            [
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
            ],
            matchup_service=matchup_service,
        )

        profile = builder.build_profile(player_id=203999, height_bucket="guard")

        self.assertEqual(matchup_service.calls, [(203999, "guard")])
        self.assertEqual(profile.confidence_tier, "HIGH")
        self.assertEqual(profile.matchup_possession_count, 100)
        self.assertEqual(profile.observed_blend_weight, 0.5)
        self.assertGreater(profile.shot_type_distribution["rim"], 0.30)


if __name__ == "__main__":
    unittest.main()
