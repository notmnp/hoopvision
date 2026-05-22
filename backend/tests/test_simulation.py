import unittest
from unittest.mock import patch

from fastapi.testclient import TestClient

from backend.app import api
from backend.app.simulation import SimulationEngine
from backend.app.tendency_profile import TendencyProfile


def make_profile(player_id, three_frequency=0.2):
    return TendencyProfile(
        player_id=player_id,
        model_version="test",
        shot_type_distribution={
            "rim": 0.5,
            "mid_range": 0.5 - three_frequency,
            "three": three_frequency,
        },
        scoring_efficiency_by_shot_type={
            "rim": 0.70,
            "mid_range": 0.45,
            "three": 0.36,
        },
        foul_drawing_rate=0.10,
        turnover_rate=0.08,
        era_adjustment={"era_key": "modern_spacing"},
        data_warnings=[],
    )


class StubProfileBuilder:
    def build_profile(self, player_id, career_start_year=None, career_end_year=None):
        return make_profile(player_id)


class SimulationEngineTest(unittest.TestCase):
    def setUp(self):
        self.players = {
            1: {
                "player_id": 1,
                "name": "Player A",
                "height": "6-6",
                "weight": "210",
                "wingspan": 82.0,
                "from_year": 1990,
                "to_year": 2003,
                "data_warnings": [],
            },
            2: {
                "player_id": 2,
                "name": "Player B",
                "height": "6-9",
                "weight": "240",
                "wingspan": 86.0,
                "from_year": 2010,
                "to_year": 2024,
                "data_warnings": [],
            },
        }
        self.engine = SimulationEngine(self.players.get, StubProfileBuilder())

    def test_simulation_runs_to_21_and_alternates_possessions(self):
        result = self.engine.simulate(1, 2, seed=42)

        self.assertGreaterEqual(max(result["summary"]["final_score"].values()), 21)
        self.assertEqual(result["play_by_play"][0]["offensive_player"], "Player A")
        self.assertEqual(result["play_by_play"][1]["offensive_player"], "Player B")
        self.assertIn(result["summary"]["winner"], {"Player A", "Player B"})

    def test_seeded_simulation_is_deterministic(self):
        first = self.engine.simulate(1, 2, seed=7)
        second = self.engine.simulate(1, 2, seed=7)

        self.assertEqual(first, second)

    def test_collects_data_warnings(self):
        self.players[1]["data_warnings"] = ["substituted wingspan"]

        result = self.engine.simulate(1, 2, seed=12)

        self.assertEqual(result["summary"]["data_warnings"], ["substituted wingspan"])


class SimulateEndpointTest(unittest.TestCase):
    def test_get_player_returns_fallback_profile_when_nba_stats_fails(self):
        client = TestClient(api.app)

        with patch("backend.app.api._fetch_common_player_info") as common_info:
            common_info.side_effect = TimeoutError("stats.nba.com timed out")

            response = client.get("/player/Michael%20Jordan")

        self.assertEqual(response.status_code, 200)
        payload = response.json()
        self.assertEqual(payload["player"], "Michael Jordan")
        self.assertEqual(payload["data"]["player_id"], 893)
        self.assertEqual(payload["data"]["wingspan"], 83.0)
        self.assertTrue(payload["data"]["data_warnings"])

    def test_post_simulate_validates_distinct_players(self):
        client = TestClient(api.app)

        response = client.post(
            "/simulate",
            json={"player_a_id": 1, "player_b_id": 1, "seed": 1},
        )

        self.assertEqual(response.status_code, 400)

    def test_post_simulate_returns_engine_result(self):
        client = TestClient(api.app)
        expected = {
            "play_by_play": [],
            "summary": {
                "winner": "Player A",
                "final_score": {"a": 21, "b": 19},
                "player_stats": {},
                "data_warnings": [],
            },
        }

        with patch("backend.app.api.SimulationEngine") as engine_class:
            engine_class.return_value.simulate.return_value = expected

            response = client.post(
                "/simulate",
                json={"player_a_id": 1, "player_b_id": 2, "seed": 1},
            )

        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json(), expected)


if __name__ == "__main__":
    unittest.main()
