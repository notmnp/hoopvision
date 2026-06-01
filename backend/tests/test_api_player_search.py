import unittest

from fastapi.testclient import TestClient

from backend.app import api


class PlayerSearchEndpointTest(unittest.TestCase):
    def setUp(self):
        self.client = TestClient(api.app)

    def test_partial_query_returns_ranked_suggestions(self):
        response = self.client.get("/api/players/search", params={"q": "lebron"})

        self.assertEqual(response.status_code, 200)
        results = response.json()
        self.assertTrue(results)
        self.assertEqual(set(results[0]), {"id", "full_name"})
        self.assertTrue(
            any("LeBron James" == result["full_name"] for result in results)
        )

    def test_exact_match_ranks_first(self):
        response = self.client.get("/api/players/search", params={"q": "Stephen Curry"})

        self.assertEqual(response.status_code, 200)
        results = response.json()
        self.assertEqual(results[0]["full_name"], "Stephen Curry")

    def test_caps_results_at_ten(self):
        response = self.client.get("/api/players/search", params={"q": "a"})

        self.assertEqual(response.status_code, 200)
        self.assertLessEqual(len(response.json()), 10)

    def test_no_match_returns_empty_list_not_404(self):
        response = self.client.get(
            "/api/players/search", params={"q": "zzzznotaplayer"}
        )

        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json(), [])

    def test_empty_query_returns_empty_list(self):
        response = self.client.get("/api/players/search", params={"q": ""})

        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json(), [])


if __name__ == "__main__":
    unittest.main()
