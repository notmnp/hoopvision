import unittest

from fastapi.testclient import TestClient

from backend.app import api


def stub_game(player_a_id, player_b_id, season_a_id, season_b_id, mode):
    a_wins = player_a_id < player_b_id
    return {
        "play_by_play": [],
        "summary": {"final_score": {"a": 21, "b": 7} if a_wins else {"a": 7, "b": 21}},
    }


def make_payload(size, series_format=7):
    return {
        "participants": [
            {"player_id": 1000 + i, "season_id": "2015-16", "seed": i + 1}
            for i in range(size)
        ],
        "bracket_size": size,
        "series_format": series_format,
    }


class BracketEndpointTest(unittest.TestCase):
    def setUp(self):
        self.client = TestClient(api.app)
        # Replace the in-process game simulator so endpoints never hit the
        # network; bracket structure/advancement is what we exercise here.
        self._original = api.bracket_orchestrator._simulate_game
        api.bracket_orchestrator._simulate_game = stub_game

    def tearDown(self):
        api.bracket_orchestrator._simulate_game = self._original

    def test_create_returns_bracket_id_and_state(self):
        response = self.client.post("/bracket", json=make_payload(4))
        self.assertEqual(response.status_code, 200)
        body = response.json()
        self.assertIn("bracket_id", body)
        self.assertEqual(body["bracket_state"]["status"], "SETUP")

    def test_create_rejects_mismatched_participant_count(self):
        payload = make_payload(8)
        payload["participants"] = payload["participants"][:5]
        response = self.client.post("/bracket", json=payload)
        self.assertEqual(response.status_code, 400)

    def test_create_rejects_unsupported_size(self):
        payload = make_payload(4)
        payload["bracket_size"] = 6
        response = self.client.post("/bracket", json=payload)
        self.assertEqual(response.status_code, 422)

    def test_get_unknown_bracket_returns_404(self):
        self.assertEqual(self.client.get("/bracket/nope").status_code, 404)

    def test_run_round_then_run_all_completes(self):
        bracket_id = self.client.post("/bracket", json=make_payload(8)).json()[
            "bracket_id"
        ]

        after_round = self.client.post(f"/bracket/{bracket_id}/run-round").json()
        self.assertEqual(after_round["status"], "IN_PROGRESS")
        self.assertTrue(all(m["winner"] for m in after_round["rounds"][0]["matchups"]))

        final = self.client.post(f"/bracket/{bracket_id}/run-all").json()
        self.assertEqual(final["status"], "COMPLETE")
        self.assertIsNotNone(final["champion"])

        fetched = self.client.get(f"/bracket/{bracket_id}").json()
        self.assertEqual(fetched["status"], "COMPLETE")


class DefaultBracketEndpointTest(unittest.TestCase):
    def setUp(self):
        self.client = TestClient(api.app)

    def test_default_returns_config_with_correct_count_and_seeds(self):
        for size in (4, 8, 16):
            response = self.client.get(f"/bracket/default/{size}")
            self.assertEqual(response.status_code, 200, size)
            body = response.json()
            self.assertEqual(body["bracket_size"], size)
            self.assertEqual(len(body["participants"]), size)
            seeds = [p["seed"] for p in body["participants"]]
            self.assertEqual(seeds, list(range(1, size + 1)))
            self.assertTrue(all(p["player_id"] > 0 for p in body["participants"]))

    def test_default_seed_order_is_stable_prefix(self):
        four = self.client.get("/bracket/default/4").json()["participants"]
        sixteen = self.client.get("/bracket/default/16").json()["participants"]
        self.assertEqual(
            [p["player_id"] for p in four],
            [p["player_id"] for p in sixteen[:4]],
        )

    def test_default_rejects_unsupported_size(self):
        self.assertEqual(self.client.get("/bracket/default/6").status_code, 400)

    def test_default_config_is_usable_to_create_a_bracket(self):
        config = self.client.get("/bracket/default/8").json()
        response = self.client.post("/bracket", json=config)
        self.assertEqual(response.status_code, 200)


if __name__ == "__main__":
    unittest.main()
