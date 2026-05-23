import unittest

from backend.app.tendency_profile import TendencyProfileBuilder


class StubbedTendencyProfileBuilder(TendencyProfileBuilder):
    def __init__(self, season_rows):
        super().__init__()
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
        self.assertEqual(profile.data_warnings, [])

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


if __name__ == "__main__":
    unittest.main()
