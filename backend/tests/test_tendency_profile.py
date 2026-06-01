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


def season_stats(season_id, **overrides):
    """Build a per-season `PlayerSeasonStats`-shaped payload for tests."""
    payload = {
        "season_id": season_id,
        "season_label": season_id,
        "season_year": int(season_id[:4]),
        "points_per_game": 25.0,
        "fga_per_game": 18.0,
        "three_point_attempt_rate": 0.20,
        "free_throw_attempt_rate": 0.30,
        "assist_per_game": 5.0,
        "turnover_per_game": 2.5,
        "rebound_per_game": 6.0,
        "block_per_game": 1.0,
        "steal_per_game": 2.0,
    }
    payload.update(overrides)
    return payload


class StubMatchupService:
    def __init__(self, stats=None):
        self.stats = stats
        self.calls = []

    def get_matchup_stats(self, player_id, height_bucket, seasons=None):
        self.calls.append((player_id, height_bucket, seasons))
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
    def __init__(self, stats_payload, matchup_service=None):
        super().__init__(
            model=DictModel(),
            matchup_service=matchup_service or StubMatchupService(),
        )
        self.stats_payload = stats_payload

    def _fetch_season_stats(self, player_id, season_id):
        return self.stats_payload


class TendencyProfileBuilderTest(unittest.TestCase):
    def test_builds_profile_from_season_stats(self):
        builder = StubbedTendencyProfileBuilder(season_stats("1990-91"))

        profile = builder.build_profile(player_id=23, season_id="1990-91")

        self.assertEqual(profile.player_id, 23)
        self.assertEqual(profile.era_adjustment["era_key"], "physical_half_court")
        self.assertAlmostEqual(
            sum(profile.shot_type_distribution.values()), 1.0, places=4
        )
        self.assertIn("rim", profile.scoring_efficiency_by_shot_type)
        # A pre-tracking-era season has no observed matchup data, so confidence
        # is LOW.
        self.assertEqual(profile.confidence_tier, "LOW")
        self.assertTrue(
            any("confidence is LOW" in warning for warning in profile.data_warnings)
        )

    def test_uses_league_average_fallback_when_no_season_selected(self):
        builder = StubbedTendencyProfileBuilder(None)

        profile = builder.build_profile(player_id=999)

        self.assertEqual(profile.era_adjustment["era_key"], "modern_spacing")
        self.assertTrue(profile.data_warnings)
        self.assertAlmostEqual(
            sum(profile.shot_type_distribution.values()), 1.0, places=4
        )

    def test_uses_league_average_fallback_when_stats_fetch_fails(self):
        class FailingTendencyProfileBuilder(TendencyProfileBuilder):
            def __init__(self):
                super().__init__(
                    model=DictModel(),
                    matchup_service=StubMatchupService(),
                )

            def _fetch_season_stats(self, player_id, season_id):
                raise TimeoutError("stats.nba.com timed out")

        builder = FailingTendencyProfileBuilder()

        profile = builder.build_profile(player_id=999, season_id="2023-24")

        self.assertEqual(profile.era_adjustment["era_key"], "modern_spacing")
        self.assertIn("NBA Stats season lookup failed", profile.data_warnings[0])
        self.assertTrue(
            any(
                "League-average tendency inputs substituted" in warning
                for warning in profile.data_warnings
            )
        )
        self.assertAlmostEqual(
            sum(profile.shot_type_distribution.values()), 1.0, places=4
        )

    def test_season_id_drives_era_adjustment(self):
        builder = StubbedTendencyProfileBuilder(season_stats("1965-66"))

        profile = builder.build_profile(player_id=999, season_id="1965-66")

        self.assertEqual(
            profile.era_adjustment["era_key"], "pace_and_space_predecessor"
        )

    def test_accepts_height_bucket_for_model_input(self):
        builder = StubbedTendencyProfileBuilder(season_stats("2023-24"))

        profile = builder.build_profile(
            player_id=203999, height_bucket="center", season_id="2023-24"
        )

        self.assertEqual(profile.height_bucket, "center")
        self.assertEqual(profile.confidence_tier, "MEDIUM")

    def test_rejects_unknown_height_bucket(self):
        builder = StubbedTendencyProfileBuilder(None)

        with self.assertRaisesRegex(ValueError, "height_bucket"):
            builder.build_profile(
                player_id=203999, height_bucket="forward", season_id="2023-24"
            )

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
            season_stats("2023-24"),
            matchup_service=matchup_service,
        )

        profile = builder.build_profile(
            player_id=203999, height_bucket="guard", season_id="2023-24"
        )

        # Observed data is scoped to the selected season (2023-24 -> 2023).
        self.assertEqual(matchup_service.calls, [(203999, "guard", [2023])])
        self.assertEqual(profile.confidence_tier, "HIGH")
        self.assertEqual(profile.matchup_possession_count, 100)
        self.assertEqual(profile.observed_blend_weight, 0.5)
        self.assertGreater(profile.shot_type_distribution["rim"], 0.30)


if __name__ == "__main__":
    unittest.main()
