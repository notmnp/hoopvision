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


class FakeAsyncRedis:
    """Minimal in-memory stand-in for the Upstash async client.

    Implements just the surface the bracket KV helpers use (`set` with an `ex`
    TTL and `get`), so persistence can be exercised without a live KV store.
    """

    def __init__(self):
        self.store: dict[str, str] = {}
        self.last_ex: int | None = None

    async def set(self, key, value, ex=None):
        self.store[key] = value
        self.last_ex = ex
        return True

    async def get(self, key):
        return self.store.get(key)


class BracketEndpointTest(unittest.TestCase):
    def setUp(self):
        self.client = TestClient(api.app)
        # Replace the in-process game simulator so endpoints never hit the
        # network; bracket structure/advancement is what we exercise here.
        self._original = api.bracket_orchestrator._simulate_game
        api.bracket_orchestrator._simulate_game = stub_game
        # Inject an in-memory KV double so the endpoints can persist/restore
        # sessions without a live Upstash store.
        self._original_kv = api._kv_redis
        self.fake_kv = FakeAsyncRedis()
        api._kv_redis = self.fake_kv

    def tearDown(self):
        api.bracket_orchestrator._simulate_game = self._original
        api._kv_redis = self._original_kv

    def test_create_returns_bracket_id_and_state(self):
        response = self.client.post("/api/bracket", json=make_payload(4))
        self.assertEqual(response.status_code, 200)
        body = response.json()
        self.assertIn("bracket_id", body)
        self.assertEqual(body["bracket_state"]["status"], "SETUP")

    def test_create_persists_to_kv_with_ttl(self):
        bracket_id = self.client.post("/api/bracket", json=make_payload(4)).json()[
            "bracket_id"
        ]
        self.assertIn(f"bracket:{bracket_id}", self.fake_kv.store)
        self.assertEqual(self.fake_kv.last_ex, 86400)

    def test_create_rejects_mismatched_participant_count(self):
        payload = make_payload(8)
        payload["participants"] = payload["participants"][:5]
        response = self.client.post("/api/bracket", json=payload)
        self.assertEqual(response.status_code, 400)

    def test_create_rejects_unsupported_size(self):
        payload = make_payload(4)
        payload["bracket_size"] = 6
        response = self.client.post("/api/bracket", json=payload)
        self.assertEqual(response.status_code, 422)

    def test_get_unknown_bracket_returns_404(self):
        self.assertEqual(self.client.get("/api/bracket/nope").status_code, 404)

    def test_get_survives_session_eviction(self):
        # Simulate a cold start / different function instance by clearing the
        # in-process store; the session must be restored from KV.
        bracket_id = self.client.post("/api/bracket", json=make_payload(4)).json()[
            "bracket_id"
        ]
        api.bracket_orchestrator._sessions.clear()
        response = self.client.get(f"/api/bracket/{bracket_id}")
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json()["bracket_id"], bracket_id)

    def test_run_round_and_run_all_work_with_empty_sessions(self):
        bracket_id = self.client.post("/api/bracket", json=make_payload(8)).json()[
            "bracket_id"
        ]

        # Evict the in-process session before every subsequent request so each
        # endpoint must hydrate from KV first.
        api.bracket_orchestrator._sessions.clear()
        after_round = self.client.post(f"/api/bracket/{bracket_id}/run-round").json()
        self.assertEqual(after_round["status"], "IN_PROGRESS")
        self.assertTrue(all(m["winner"] for m in after_round["rounds"][0]["matchups"]))

        api.bracket_orchestrator._sessions.clear()
        final = self.client.post(f"/api/bracket/{bracket_id}/run-all").json()
        self.assertEqual(final["status"], "COMPLETE")
        self.assertIsNotNone(final["champion"])

        # The latest round results must be the ones persisted to KV.
        api.bracket_orchestrator._sessions.clear()
        fetched = self.client.get(f"/api/bracket/{bracket_id}").json()
        self.assertEqual(fetched["status"], "COMPLETE")
        self.assertIsNotNone(fetched["champion"])

    def test_run_round_then_run_all_completes(self):
        bracket_id = self.client.post("/api/bracket", json=make_payload(8)).json()[
            "bracket_id"
        ]

        after_round = self.client.post(f"/api/bracket/{bracket_id}/run-round").json()
        self.assertEqual(after_round["status"], "IN_PROGRESS")
        self.assertTrue(all(m["winner"] for m in after_round["rounds"][0]["matchups"]))

        final = self.client.post(f"/api/bracket/{bracket_id}/run-all").json()
        self.assertEqual(final["status"], "COMPLETE")
        self.assertIsNotNone(final["champion"])

        fetched = self.client.get(f"/api/bracket/{bracket_id}").json()
        self.assertEqual(fetched["status"], "COMPLETE")


class BracketKVUnavailableTest(unittest.TestCase):
    # Brackets are ephemeral/session-only: with no KV configured (e.g. local
    # dev) the endpoints must degrade gracefully to the orchestrator's in-memory
    # session store, not error. KV is only an optional durability layer for
    # surviving serverless cold starts in prod.
    def setUp(self):
        self.client = TestClient(api.app)
        self._original_kv = api._kv_redis
        # No KV client configured (missing credentials / library).
        api._kv_redis = None

    def tearDown(self):
        api._kv_redis = self._original_kv

    def test_full_lifecycle_works_in_memory_without_kv(self):
        created = self.client.post("/api/bracket", json=make_payload(4))
        self.assertEqual(created.status_code, 200)
        bracket_id = created.json()["bracket_id"]

        # The just-created session is held in memory, so fetching and running it
        # succeeds even though nothing was persisted to KV.
        fetched = self.client.get(f"/api/bracket/{bracket_id}")
        self.assertEqual(fetched.status_code, 200)

        final = self.client.post(f"/api/bracket/{bracket_id}/run-all")
        self.assertEqual(final.status_code, 200)
        self.assertEqual(final.json()["status"], "COMPLETE")
        self.assertIsNotNone(final.json()["champion"])

    def test_get_unknown_bracket_returns_404_not_500(self):
        response = self.client.get("/api/bracket/anything")
        self.assertEqual(response.status_code, 404)


class DefaultBracketEndpointTest(unittest.TestCase):
    def setUp(self):
        self.client = TestClient(api.app)
        self._original_kv = api._kv_redis
        api._kv_redis = FakeAsyncRedis()

    def tearDown(self):
        api._kv_redis = self._original_kv

    def test_default_returns_config_with_correct_count_and_seeds(self):
        for size in (4, 8, 16):
            response = self.client.get(f"/api/bracket/default/{size}")
            self.assertEqual(response.status_code, 200, size)
            body = response.json()
            self.assertEqual(body["bracket_size"], size)
            self.assertEqual(len(body["participants"]), size)
            seeds = [p["seed"] for p in body["participants"]]
            self.assertEqual(seeds, list(range(1, size + 1)))
            self.assertTrue(all(p["player_id"] > 0 for p in body["participants"]))

    def test_default_seed_order_is_stable_prefix(self):
        four = self.client.get("/api/bracket/default/4").json()["participants"]
        sixteen = self.client.get("/api/bracket/default/16").json()["participants"]
        self.assertEqual(
            [p["player_id"] for p in four],
            [p["player_id"] for p in sixteen[:4]],
        )

    def test_default_rejects_unsupported_size(self):
        self.assertEqual(self.client.get("/api/bracket/default/6").status_code, 400)

    def test_default_config_is_usable_to_create_a_bracket(self):
        config = self.client.get("/api/bracket/default/8").json()
        response = self.client.post("/api/bracket", json=config)
        self.assertEqual(response.status_code, 200)


if __name__ == "__main__":
    unittest.main()
