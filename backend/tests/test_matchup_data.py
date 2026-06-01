import unittest
from unittest.mock import patch

from backend.app import matchup_data
from backend.app.matchup_data import MatchupDataService


class MatchupDataServiceTest(unittest.TestCase):
    def setUp(self):
        self.responses = {}
        self.requested_keys = []
        self.fetch_patcher = patch.object(
            matchup_data, "fetch_stats_data", self._fetch_stats_data
        )
        self.fetch_patcher.start()
        self.service = MatchupDataService()

    def tearDown(self):
        self.fetch_patcher.stop()

    def _fetch_stats_data(self, cache_key, endpoint_factory, **kwargs):
        self.requested_keys.append(cache_key)
        return self.responses.get(cache_key, {})

    def test_classifies_height_buckets(self):
        self.assertEqual(MatchupDataService.height_bucket_for_inches(76.9), "guard")
        self.assertEqual(MatchupDataService.height_bucket_for_inches(77), "wing")
        self.assertEqual(MatchupDataService.height_bucket_for_inches(80), "big")
        self.assertEqual(MatchupDataService.height_bucket_for_inches(84), "center")

    def test_aggregates_matchup_possessions_for_defender_height_bucket(self):
        with patch.object(MatchupDataService, "_tracking_seasons", return_value=[2024]):
            self.responses = {
                "leagueseasonmatchups:2024:203999": {
                    "SeasonMatchups": [
                        {
                            "DEF_PLAYER_ID": 10,
                            "PARTIAL_POSS": 37.2,
                            "MATCHUP_FGM": 10,
                            "MATCHUP_FGA": 20,
                            "PLAYER_PTS": 26,
                            "MATCHUP_FTA": 4,
                            "MATCHUP_TOV": 3,
                            "MATCHUP_BLK": 1,
                            "HELP_BLK": 1,
                        },
                        {
                            "DEF_PLAYER_ID": 11,
                            "PARTIAL_POSS": 18.1,
                            "MATCHUP_FGM": 4,
                            "MATCHUP_FGA": 11,
                            "PLAYER_PTS": 10,
                            "MATCHUP_FTA": 2,
                            "MATCHUP_TOV": 1,
                            "MATCHUP_BLK": 0,
                            "HELP_BLK": 1,
                        },
                        {
                            "DEF_PLAYER_ID": 12,
                            "PARTIAL_POSS": 99,
                            "MATCHUP_FGM": 20,
                            "MATCHUP_FGA": 40,
                            "PLAYER_PTS": 52,
                        },
                    ]
                },
                "leaguedashplayerbiostats:2024": {
                    "LeagueDashPlayerBioStats": [
                        {"PLAYER_ID": 10, "PLAYER_HEIGHT_INCHES": 77},
                        {"PLAYER_ID": 11, "PLAYER_HEIGHT_INCHES": 79},
                        {"PLAYER_ID": 12, "PLAYER_HEIGHT_INCHES": 84},
                    ]
                },
                "shotchartdetail:2024:203999": {
                    "Shot_Chart_Detail": [
                        {
                            "SHOT_ATTEMPTED_FLAG": 1,
                            "SHOT_MADE_FLAG": 1,
                            "SHOT_TYPE": "2PT Field Goal",
                            "SHOT_ZONE_BASIC": "Mid-Range",
                            "SHOT_ZONE_AREA": "Center(C)",
                            "SHOT_ZONE_RANGE": "16-24 ft.",
                        },
                        {
                            "SHOT_ATTEMPTED_FLAG": 1,
                            "SHOT_MADE_FLAG": 0,
                            "SHOT_TYPE": "3PT Field Goal",
                            "SHOT_ZONE_BASIC": "Above the Break 3",
                            "SHOT_ZONE_AREA": "Left Side Center(LC)",
                            "SHOT_ZONE_RANGE": "24+ ft.",
                        },
                    ]
                },
            }

            stats = self.service.get_matchup_stats(203999, "wing")

        self.assertTrue(stats.sufficient_sample)
        self.assertEqual(stats.possession_count, 55)
        self.assertEqual(stats.fgm, 14)
        self.assertEqual(stats.fga, 31)
        self.assertEqual(stats.points, 36)
        self.assertEqual(stats.free_throw_attempts, 6)
        self.assertEqual(stats.turnovers, 4)
        self.assertEqual(stats.blocks, 3)
        self.assertEqual(stats.height_bucket, "wing")
        self.assertEqual(len(stats.zone_data), 2)
        self.assertAlmostEqual(sum(zone.frequency for zone in stats.zone_data), 1.0)
        self.assertIn(
            matchup_data.ZONE_DATA_UNCONDITIONED_WARNING, stats.data_warnings
        )

    def test_returns_empty_payload_when_no_tracking_rows_match_bucket(self):
        with patch.object(MatchupDataService, "_tracking_seasons", return_value=[2024]):
            self.responses = {
                "leagueseasonmatchups:2024:893": {
                    "SeasonMatchups": [
                        {"DEF_PLAYER_ID": 12, "PARTIAL_POSS": 99},
                    ]
                },
                "leaguedashplayerbiostats:2024": {
                    "LeagueDashPlayerBioStats": [
                        {"PLAYER_ID": 12, "PLAYER_HEIGHT_INCHES": 84},
                    ]
                },
            }

            stats = self.service.get_matchup_stats(893, "guard")

        self.assertFalse(stats.sufficient_sample)
        self.assertEqual(stats.possession_count, 0)
        self.assertEqual(stats.zone_data, [])
        self.assertEqual(stats.data_warnings, [])
        self.assertNotIn("shotchartdetail:2024:893", self.requested_keys)

    def test_marks_sparse_samples_as_insufficient(self):
        with patch.object(MatchupDataService, "_tracking_seasons", return_value=[2024]):
            self.responses = {
                "leagueseasonmatchups:2024:203999": {
                    "SeasonMatchups": [
                        {"DEF_PLAYER_ID": 10, "PARTIAL_POSS": 12},
                    ]
                },
                "leaguedashplayerbiostats:2024": {
                    "LeagueDashPlayerBioStats": [
                        {"PLAYER_ID": 10, "PLAYER_HEIGHT_INCHES": 76},
                    ]
                },
                "shotchartdetail:2024:203999": {"Shot_Chart_Detail": []},
            }

            stats = self.service.get_matchup_stats(203999, "guard")

        self.assertFalse(stats.sufficient_sample)
        self.assertEqual(stats.possession_count, 12)

    def test_rejects_unknown_height_bucket(self):
        with self.assertRaisesRegex(ValueError, "height_bucket"):
            self.service.get_matchup_stats(203999, "forward")

    def test_seasons_arg_scopes_fetches_to_only_those_seasons(self):
        # _tracking_seasons returns a different year; the explicit seasons= arg
        # must override it so nothing outside the requested season is fetched.
        with patch.object(MatchupDataService, "_tracking_seasons", return_value=[9999]):
            self.responses = {
                "leagueseasonmatchups:2023:777": {
                    "SeasonMatchups": [
                        {"DEF_PLAYER_ID": 10, "PARTIAL_POSS": 60, "MATCHUP_FGA": 20},
                    ]
                },
                "leaguedashplayerbiostats:2023": {
                    "LeagueDashPlayerBioStats": [
                        {"PLAYER_ID": 10, "PLAYER_HEIGHT_INCHES": 78},
                    ]
                },
                "shotchartdetail:2023:777": {"Shot_Chart_Detail": []},
            }

            stats = self.service.get_matchup_stats(777, "wing", seasons=[2023])

        self.assertEqual(stats.possession_count, 60)
        # Only 2023 keys were requested; the 9999 _tracking_seasons value was ignored.
        self.assertFalse(any("9999" in key for key in self.requested_keys))
        self.assertIn("leagueseasonmatchups:2023:777", self.requested_keys)

    def test_seasons_none_defaults_to_all_tracking_seasons(self):
        # Guards the offline-training path: no seasons arg fans out across the
        # full tracking range.
        with patch.object(
            MatchupDataService, "_tracking_seasons", return_value=[2022, 2023, 2024]
        ):
            self.responses = {
                f"leagueseasonmatchups:{year}:777": {"SeasonMatchups": []}
                for year in (2022, 2023, 2024)
            }

            self.service.get_matchup_stats(777, "wing")

        for year in (2022, 2023, 2024):
            self.assertIn(f"leagueseasonmatchups:{year}:777", self.requested_keys)

    def test_empty_seasons_list_issues_no_fetch(self):
        # [] is explicit "no seasons" (distinct from None) -> zero upstream calls.
        with patch.object(MatchupDataService, "_tracking_seasons", return_value=[2024]):
            stats = self.service.get_matchup_stats(777, "wing", seasons=[])

        self.assertEqual(self.requested_keys, [])
        self.assertEqual(stats.possession_count, 0)


if __name__ == "__main__":
    unittest.main()
