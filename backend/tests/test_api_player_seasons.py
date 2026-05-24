import unittest
from unittest.mock import patch

from fastapi.testclient import TestClient

from backend.app import api


SEASONS = [
    {"season_id": "2023-24", "season_label": "2023-24"},
    {"season_id": "2022-23", "season_label": "2022-23"},
]

SEASON_STATS = {
    "season_id": "2023-24",
    "season_label": "2023-24",
    "season_year": 2023,
    "team_id": 1610612747,
    "team_abbreviation": "LAL",
    "points_per_game": 20.0,
    "fga_per_game": 15.0,
    "three_point_attempt_rate": 0.3333,
    "free_throw_attempt_rate": 0.2667,
    "assist_per_game": 4.0,
    "turnover_per_game": 2.0,
    "rebound_per_game": 6.0,
    "block_per_game": 0.5,
    "steal_per_game": 1.0,
}


class PlayerSeasonEndpointsTest(unittest.TestCase):
    def setUp(self):
        self.client = TestClient(api.app)

    def test_get_player_seasons_returns_options(self):
        with patch.object(api, "list_player_seasons", return_value=SEASONS):
            response = self.client.get("/player/2544/seasons")

        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json(), SEASONS)

    def test_get_player_season_returns_stats(self):
        with patch.object(api, "get_player_season_stats", return_value=SEASON_STATS):
            response = self.client.get("/player/2544/season/2023-24")

        self.assertEqual(response.status_code, 200)
        body = response.json()
        self.assertEqual(body["season_year"], 2023)
        self.assertEqual(body["points_per_game"], 20.0)

    def test_get_player_season_missing_returns_404(self):
        with patch.object(api, "get_player_season_stats", return_value=None):
            response = self.client.get("/player/2544/season/1999-00")

        self.assertEqual(response.status_code, 404)

    def test_get_player_seasons_upstream_failure_returns_502(self):
        with patch.object(
            api, "list_player_seasons", side_effect=RuntimeError("nba down")
        ):
            response = self.client.get("/player/2544/seasons")

        self.assertEqual(response.status_code, 502)


if __name__ == "__main__":
    unittest.main()
