import unittest
from unittest.mock import patch

from backend.app import nba_stats_client


class StubEndpoint:
    def __init__(self, data):
        self.data = data

    def get_normalized_dict(self):
        return self.data


class NBAStatsClientTest(unittest.TestCase):
    def setUp(self):
        nba_stats_client._cache.clear()
        nba_stats_client._last_request_at = 0.0

    def test_fetch_stats_data_caches_successful_response(self):
        calls = 0

        def endpoint_factory():
            nonlocal calls
            calls += 1
            return StubEndpoint({"CommonPlayerInfo": [{"PLAYER_ID": 202681}]})

        first = nba_stats_client.fetch_stats_data("player:202681", endpoint_factory)
        second = nba_stats_client.fetch_stats_data("player:202681", endpoint_factory)

        self.assertEqual(first, second)
        self.assertEqual(calls, 1)

    def test_fetch_stats_data_retries_then_raises_last_error(self):
        with patch.object(nba_stats_client, "NBA_STATS_RETRIES", 2), patch.object(
            nba_stats_client.time, "sleep"
        ):

            def endpoint_factory():
                raise TimeoutError("stats.nba.com timed out")

            with self.assertRaisesRegex(TimeoutError, "timed out"):
                nba_stats_client.fetch_stats_data("player:202681", endpoint_factory)

    def test_fetch_stats_data_returns_copy_of_cached_payload(self):
        def endpoint_factory():
            return StubEndpoint({"CommonPlayerInfo": [{"PLAYER_ID": 202681}]})

        first = nba_stats_client.fetch_stats_data("player:202681", endpoint_factory)
        first["CommonPlayerInfo"][0]["PLAYER_ID"] = 1
        second = nba_stats_client.fetch_stats_data("player:202681", endpoint_factory)

        self.assertEqual(second["CommonPlayerInfo"][0]["PLAYER_ID"], 202681)


if __name__ == "__main__":
    unittest.main()
