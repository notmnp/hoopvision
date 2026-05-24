import unittest
from unittest.mock import patch

from backend.app import player_data


CAREER_ROWS = [
    {
        "SEASON_ID": "2022-23",
        "TEAM_ABBREVIATION": "LAL",
        "TEAM_ID": 1610612747,
        "GP": 50,
        "PTS": 1000,
        "FGA": 800,
        "FG3A": 200,
        "FTA": 240,
        "AST": 300,
        "TOV": 120,
        "REB": 400,
        "BLK": 30,
        "STL": 60,
    },
    {
        "SEASON_ID": "2023-24",
        "TEAM_ABBREVIATION": "LAL",
        "TEAM_ID": 1610612747,
        "GP": 40,
        "PTS": 800,
        "FGA": 600,
        "FG3A": 150,
        "FTA": 160,
        "AST": 200,
        "TOV": 80,
        "REB": 280,
        "BLK": 20,
        "STL": 40,
    },
    {
        "SEASON_ID": "2023-24",
        "TEAM_ABBREVIATION": "TOT",
        "TEAM_ID": 0,
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
    },
    {
        "SEASON_ID": "2023-24",
        "TEAM_ABBREVIATION": "MIA",
        "TEAM_ID": 1610612748,
        "GP": 30,
        "PTS": 600,
        "FGA": 450,
        "FG3A": 200,
        "FTA": 120,
        "AST": 80,
        "TOV": 60,
        "REB": 140,
        "BLK": 15,
        "STL": 30,
    },
]


class PlayerDataTest(unittest.TestCase):
    def test_list_player_seasons_dedupes_and_sorts_desc(self):
        with patch.object(
            player_data, "fetch_career_season_rows", return_value=CAREER_ROWS
        ):
            seasons = player_data.list_player_seasons(2544)

        self.assertEqual(
            [season["season_id"] for season in seasons],
            ["2023-24", "2022-23"],
        )
        self.assertEqual(seasons[0]["season_label"], "2023-24")

    def test_get_player_season_stats_prefers_tot_row(self):
        with patch.object(
            player_data, "fetch_career_season_rows", return_value=CAREER_ROWS
        ):
            stats = player_data.get_player_season_stats(2544, "2023-24")

        # TOT totals (70 GP, 1400 PTS) win over the summed LAL+MIA per-team rows.
        self.assertEqual(stats["season_year"], 2023)
        self.assertEqual(stats["points_per_game"], 20.0)
        self.assertEqual(stats["fga_per_game"], 15.0)
        self.assertEqual(stats["three_point_attempt_rate"], round(350 / 1050, 4))
        self.assertEqual(stats["free_throw_attempt_rate"], round(280 / 1050, 4))
        # The branding team is the one with the most games (LAL 40 > MIA 30),
        # not the teamless TOT row.
        self.assertEqual(stats["team_abbreviation"], "LAL")
        self.assertEqual(stats["team_id"], 1610612747)

    def test_get_player_season_stats_sums_when_no_tot_row(self):
        with patch.object(
            player_data, "fetch_career_season_rows", return_value=CAREER_ROWS
        ):
            stats = player_data.get_player_season_stats(2544, "2022-23")

        self.assertEqual(stats["points_per_game"], 20.0)
        self.assertEqual(stats["season_year"], 2022)

    def test_get_player_season_stats_missing_season_returns_none(self):
        with patch.object(
            player_data, "fetch_career_season_rows", return_value=CAREER_ROWS
        ):
            self.assertIsNone(player_data.get_player_season_stats(2544, "1999-00"))


if __name__ == "__main__":
    unittest.main()
