import random
import unittest
from unittest.mock import patch

from fastapi.testclient import TestClient

from backend.app import api
from backend.app.simulation import PlayByPlay, PlayerSimStats, SimulationEngine
from backend.app.tendency_profile import TendencyProfile


SEASON_A = "2000-01"
SEASON_B = "2010-11"


def make_profile(
    player_id, three_frequency=0.2, confidence_tier="MEDIUM", foul_drawing_rate=0.10
):
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
        foul_drawing_rate=foul_drawing_rate,
        turnover_rate=0.08,
        era_adjustment={"era_key": "modern_spacing"},
        data_warnings=[],
        confidence_tier=confidence_tier,
    )


class StubProfileBuilder:
    def __init__(self, confidence_tiers=None, foul_drawing_rate=0.10):
        self.calls = []
        self.confidence_tiers = confidence_tiers or {}
        self.foul_drawing_rate = foul_drawing_rate

    def build_profile(self, player_id, height_bucket="wing", season_id=None):
        self.calls.append(
            {
                "player_id": player_id,
                "height_bucket": height_bucket,
                "season_id": season_id,
            }
        )
        return make_profile(
            player_id,
            confidence_tier=self.confidence_tiers.get(player_id, "MEDIUM"),
            foul_drawing_rate=self.foul_drawing_rate,
        )


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
        self.profile_builder = StubProfileBuilder()
        self.engine = SimulationEngine(self.players.get, self.profile_builder)

    def test_simulation_runs_to_21_starting_with_player_a(self):
        result = self.engine.simulate(1, 2, SEASON_A, SEASON_B, seed=42)

        self.assertGreaterEqual(max(result["summary"]["final_score"].values()), 21)
        self.assertEqual(result["play_by_play"][0]["offensive_player"], "Player A")
        self.assertIn(result["summary"]["winner"], {"Player A", "Player B"})

    def test_alternating_mode_alternates_possessions(self):
        # With no fouls, alternating mode flips possession every turn.
        profile_builder = StubProfileBuilder(foul_drawing_rate=0.0)
        engine = SimulationEngine(self.players.get, profile_builder)

        result = engine.simulate(
            1, 2, SEASON_A, SEASON_B, possession_mode="alternating", seed=42
        )

        offensive_players = [
            play["offensive_player"] for play in result["play_by_play"]
        ]
        expected = [
            "Player A" if index % 2 == 0 else "Player B"
            for index in range(len(offensive_players))
        ]
        self.assertEqual(offensive_players, expected)

    def test_make_it_take_it_scorer_retains_possession(self):
        # A made basket keeps possession; a miss/turnover transfers it.
        made = PlayByPlay(1, "Player A", "rim", "made", False, False, 2, 0)
        missed = PlayByPlay(1, "Player A", "rim", "missed", False, False, 0, 0)
        turnover = PlayByPlay(1, "Player A", "rim", "turnover", False, True, 0, 0)

        self.assertEqual(
            self.engine._next_possessor("a", made, "make_it_take_it"), "a"
        )
        self.assertEqual(
            self.engine._next_possessor("a", missed, "make_it_take_it"), "b"
        )
        self.assertEqual(
            self.engine._next_possessor("a", turnover, "make_it_take_it"), "b"
        )

    def test_foul_retains_possession_in_both_modes(self):
        foul = PlayByPlay(1, "Player A", "rim", "foul_drawn", True, False, 0, 0)

        self.assertEqual(
            self.engine._next_possessor("a", foul, "make_it_take_it"), "a"
        )
        self.assertEqual(self.engine._next_possessor("a", foul, "alternating"), "a")

    def test_foul_awards_no_points_and_records_foul_drawn(self):
        # foul_drawing_rate of 1.0 (and no turnover) forces a foul this turn.
        tendency = make_profile(1, foul_drawing_rate=1.0).to_dict()
        tendency["turnover_rate"] = 0.0
        defense = make_profile(2).to_dict()
        scores = {"a": 0, "b": 0}
        player_stats = PlayerSimStats()

        play = self.engine._simulate_possession(
            rng=random.Random(1),
            possession=1,
            offense_key="a",
            offense=self.players[1],
            defense=self.players[2],
            tendency=tendency,
            defense_tendency=defense,
            scores=scores,
            player_stats=player_stats,
        )

        self.assertTrue(play.foul)
        self.assertEqual(play.result, "foul_drawn")
        self.assertEqual(scores, {"a": 0, "b": 0})
        self.assertEqual(play.score_a, 0)
        self.assertEqual(play.score_b, 0)
        self.assertEqual(player_stats.points, 0)
        self.assertEqual(player_stats.fouls_drawn, 1)

    def test_seeded_simulation_is_deterministic(self):
        first = self.engine.simulate(1, 2, SEASON_A, SEASON_B, seed=7)
        second = self.engine.simulate(1, 2, SEASON_A, SEASON_B, seed=7)

        self.assertEqual(first, second)

    def test_simulate_bulk_aggregates_win_counts(self):
        result = self.engine.simulate_bulk(1, 2, SEASON_A, SEASON_B, n=25)

        self.assertEqual(result["total_simulations"], 25)
        self.assertEqual(
            result["player_a_wins"] + result["player_b_wins"] + result["ties"], 25
        )
        self.assertAlmostEqual(
            result["player_a_win_pct"],
            round(100 * result["player_a_wins"] / 25, 2),
        )

    def test_simulate_bulk_builds_profiles_once(self):
        self.engine.simulate_bulk(1, 2, SEASON_A, SEASON_B, n=10)

        # Profiles are built once per matchup, not once per simulation.
        self.assertEqual(len(self.profile_builder.calls), 2)

    def test_player_stats_include_scoring_breakdown(self):
        result = self.engine.simulate(1, 2, SEASON_A, SEASON_B, seed=5)

        for stats in result["summary"]["player_stats"].values():
            self.assertIn("shooting_percentage", stats)
            self.assertIn("three_point_percentage", stats)
            self.assertIn("shot_type_distribution", stats)
            self.assertIn("shot_type_percentage", stats)
            self.assertEqual(
                set(stats["shot_type_distribution"]),
                {"rim", "mid_range", "three"},
            )
            self.assertEqual(
                set(stats["shot_type_percentage"]),
                {"rim", "mid_range", "three"},
            )
            for zone_pct in stats["shot_type_percentage"].values():
                self.assertGreaterEqual(zone_pct, 0.0)
                self.assertLessEqual(zone_pct, 1.0)

    def test_player_stats_expose_confidence_tier_per_player(self):
        profile_builder = StubProfileBuilder(confidence_tiers={1: "HIGH", 2: "LOW"})
        engine = SimulationEngine(self.players.get, profile_builder)

        result = engine.simulate(1, 2, SEASON_A, SEASON_B, seed=5)

        player_stats = result["summary"]["player_stats"]
        self.assertEqual(player_stats["Player A"]["confidence_tier"], "HIGH")
        self.assertEqual(player_stats["Player B"]["confidence_tier"], "LOW")

    def test_collects_data_warnings(self):
        self.players[1]["data_warnings"] = ["substituted wingspan"]

        result = self.engine.simulate(1, 2, SEASON_A, SEASON_B, seed=12)

        self.assertEqual(result["summary"]["data_warnings"], ["substituted wingspan"])

    def test_elite_shot_blocker_lowers_make_probability(self):
        offense = self.players[1]
        defense = self.players[2]
        elite = self.engine._make_probability(
            0.5, {"block_rate": 0.18}, offense, defense
        )
        poor = self.engine._make_probability(
            0.5, {"block_rate": 0.0}, offense, defense
        )

        self.assertLess(elite, poor)

    def test_block_rate_dominates_physical_size_in_shot_contest(self):
        # A small but elite shot blocker should contest better than a large
        # but poor one, proving career skill is the primary factor (ADR-004).
        small_elite_defender = {"height": "6-3", "wingspan": 78.0, "weight": 190}
        big_poor_defender = {"height": "7-2", "wingspan": 90.0, "weight": 280}
        offense = self.players[1]

        elite = self.engine._make_probability(
            0.5, {"block_rate": 0.22}, offense, small_elite_defender
        )
        poor = self.engine._make_probability(
            0.5, {"block_rate": 0.0}, offense, big_poor_defender
        )

        self.assertLess(elite, poor)

    def test_elite_thief_raises_turnover_rate(self):
        offense = self.players[1]
        defense = self.players[2]
        elite = self.engine._defense_adjusted_turnover_rate(
            0.08, {"steal_rate": 0.20}, offense, defense
        )
        poor = self.engine._defense_adjusted_turnover_rate(
            0.08, {"steal_rate": 0.0}, offense, defense
        )

        self.assertGreater(elite, poor)

    def test_passes_height_bucket_and_season_id_to_profile_builder(self):
        self.players[1]["height"] = "6-4"
        self.players[2]["height"] = "7-0"

        self.engine.simulate(1, 2, SEASON_A, SEASON_B, seed=3)

        self.assertEqual(self.profile_builder.calls[0]["height_bucket"], "center")
        self.assertEqual(self.profile_builder.calls[1]["height_bucket"], "guard")
        self.assertEqual(self.profile_builder.calls[0]["season_id"], SEASON_A)
        self.assertEqual(self.profile_builder.calls[1]["season_id"], SEASON_B)


class SimulateEndpointTest(unittest.TestCase):
    def _payload(self, **overrides):
        payload = {
            "player_a_id": 1,
            "player_b_id": 2,
            "season_a_id": SEASON_A,
            "season_b_id": SEASON_B,
            "seed": 1,
        }
        payload.update(overrides)
        return payload

    def test_get_player_normalizes_encoded_spaces_plus_and_extra_spaces(self):
        client = TestClient(api.app)

        with patch("backend.app.api._fetch_common_player_info") as common_info:
            common_info.side_effect = TimeoutError("stats.nba.com timed out")

            encoded_response = client.get("/api/player/Michael%2520Jordan")
            plus_response = client.get("/api/player/Michael+Jordan")
            spaced_response = client.get("/api/player/Michael%20%20%20Jordan")

        self.assertEqual(encoded_response.status_code, 200)
        self.assertEqual(plus_response.status_code, 200)
        self.assertEqual(spaced_response.status_code, 200)
        self.assertEqual(encoded_response.json()["data"]["player_id"], 893)
        self.assertEqual(plus_response.json()["data"]["player_id"], 893)
        self.assertEqual(spaced_response.json()["data"]["player_id"], 893)

    def test_get_player_treats_regex_characters_as_plain_text(self):
        client = TestClient(api.app)

        response = client.get("/api/player/[")

        self.assertEqual(response.status_code, 404)

    def test_get_player_returns_fallback_profile_when_nba_stats_fails(self):
        client = TestClient(api.app)

        with patch("backend.app.api._fetch_common_player_info") as common_info:
            common_info.side_effect = TimeoutError("stats.nba.com timed out")

            response = client.get("/api/player/Michael%20Jordan")

        self.assertEqual(response.status_code, 200)
        payload = response.json()
        self.assertEqual(payload["player"], "Michael Jordan")
        self.assertEqual(payload["data"]["player_id"], 893)
        self.assertEqual(payload["data"]["wingspan"], 83.0)
        self.assertTrue(payload["data"]["data_warnings"])

    def test_get_player_uses_curated_wingspan_when_profile_lookup_fails(self):
        client = TestClient(api.app)

        with patch("backend.app.api._fetch_common_player_info") as common_info:
            common_info.side_effect = TimeoutError("stats.nba.com timed out")

            response = client.get("/api/player/Kyrie%20Irving")

        self.assertEqual(response.status_code, 200)
        payload = response.json()
        self.assertEqual(payload["data"]["player_id"], 202681)
        self.assertEqual(payload["data"]["wingspan"], 76.0)
        self.assertFalse(
            any(
                "Position-average wingspan substituted" in warning
                for warning in payload["data"]["data_warnings"]
            )
        )

    def test_post_simulate_validates_distinct_players(self):
        client = TestClient(api.app)

        response = client.post(
            "/api/simulate",
            json=self._payload(player_b_id=1),
        )

        self.assertEqual(response.status_code, 400)

    def test_post_simulate_requires_season_ids(self):
        client = TestClient(api.app)

        response = client.post(
            "/api/simulate",
            json={"player_a_id": 1, "player_b_id": 2, "seed": 1},
        )

        self.assertEqual(response.status_code, 422)

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

            response = client.post("/api/simulate", json=self._payload())

        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json(), expected)
        engine_class.return_value.simulate.assert_called_once_with(
            1,
            2,
            SEASON_A,
            SEASON_B,
            possession_mode="make_it_take_it",
            seed=1,
        )

    def test_post_simulate_bulk_validates_distinct_players(self):
        client = TestClient(api.app)

        response = client.post(
            "/api/simulate/bulk",
            json={
                "player_a_id": 1,
                "player_b_id": 1,
                "season_a_id": SEASON_A,
                "season_b_id": SEASON_B,
                "n": 10,
            },
        )

        self.assertEqual(response.status_code, 400)

    def test_post_simulate_bulk_caps_n_and_returns_result(self):
        client = TestClient(api.app)
        expected = {
            "player_a_wins": 600,
            "player_b_wins": 400,
            "ties": 0,
            "total_simulations": 1000,
            "player_a_win_pct": 60.0,
            "player_b_win_pct": 40.0,
        }

        with patch("backend.app.api.SimulationEngine") as engine_class:
            engine_class.return_value.simulate_bulk.return_value = expected

            response = client.post(
                "/api/simulate/bulk",
                json={
                    "player_a_id": 1,
                    "player_b_id": 2,
                    "season_a_id": SEASON_A,
                    "season_b_id": SEASON_B,
                    "n": 999999,
                },
            )

        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json(), expected)
        engine_class.return_value.simulate_bulk.assert_called_once_with(
            1,
            2,
            SEASON_A,
            SEASON_B,
            api.BULK_SIM_MAX_N,
            possession_mode="make_it_take_it",
        )


if __name__ == "__main__":
    unittest.main()
