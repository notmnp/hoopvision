import asyncio
import threading
import time
import unittest

from backend.app.bracket import (
    BracketConfig,
    BracketOrchestrator,
    BracketParticipant,
    BracketValidationError,
    standard_seed_order,
)


def make_config(size, series_format=7):
    return BracketConfig(
        participants=[
            BracketParticipant(player_id=1000 + i, season_id="2015-16", seed=i + 1)
            for i in range(size)
        ],
        bracket_size=size,
        series_format=series_format,
    )


class DeterministicGameSimulator:
    """Lower player_id always wins, so the top seed wins the whole bracket.

    Returns the minimal SimulationResult shape the orchestrator reads
    (`summary.final_score`), letting bracket logic be tested without the engine.
    """

    def __init__(self):
        self.games_played = 0

    def __call__(self, player_a_id, player_b_id, season_a_id, season_b_id, mode):
        self.games_played += 1
        a_wins = player_a_id < player_b_id
        return {
            "play_by_play": [],
            "summary": {
                "final_score": {"a": 21, "b": 7} if a_wins else {"a": 7, "b": 21}
            },
        }


def make_orchestrator():
    return BracketOrchestrator(engine=None, game_simulator=DeterministicGameSimulator())


class SeedOrderTest(unittest.TestCase):
    def test_size_four_pairs_one_v_four_and_two_v_three(self):
        self.assertEqual(standard_seed_order(4), [1, 4, 2, 3])

    def test_size_eight_spreads_top_seeds(self):
        self.assertEqual(standard_seed_order(8), [1, 8, 4, 5, 2, 7, 3, 6])

    def test_size_sixteen_length_and_completeness(self):
        order = standard_seed_order(16)
        self.assertEqual(len(order), 16)
        self.assertEqual(sorted(order), list(range(1, 17)))


class CreateBracketTest(unittest.TestCase):
    def test_rejects_wrong_participant_count(self):
        config = make_config(4)
        config.participants.pop()
        with self.assertRaises(BracketValidationError):
            make_orchestrator().create_bracket(config)

    def test_creates_full_round_tree(self):
        state = make_orchestrator().create_bracket(make_config(8))
        self.assertEqual([r.round_number for r in state.rounds], [1, 2, 3])
        self.assertEqual([len(r.matchups) for r in state.rounds], [4, 2, 1])
        self.assertEqual(state.status, "SETUP")
        self.assertIsNone(state.champion)

    def test_first_round_populated_later_rounds_empty(self):
        state = make_orchestrator().create_bracket(make_config(4))
        first = state.rounds[0].matchups
        self.assertTrue(all(m.player_a and m.player_b for m in first))
        final = state.rounds[1].matchups[0]
        self.assertIsNone(final.player_a)
        self.assertIsNone(final.player_b)

    def test_seeds_assigned_positionally(self):
        state = make_orchestrator().create_bracket(make_config(4))
        seeds = {m.seed_a for m in state.rounds[0].matchups} | {
            m.seed_b for m in state.rounds[0].matchups
        }
        self.assertEqual(seeds, {1, 2, 3, 4})


class RunRoundTest(unittest.TestCase):
    def test_run_round_resolves_only_current_round(self):
        orch = make_orchestrator()
        state = orch.create_bracket(make_config(8))
        state = asyncio.run(orch.run_round(state.bracket_id))
        self.assertTrue(all(m.winner for m in state.rounds[0].matchups))
        self.assertTrue(all(m.winner is None for m in state.rounds[1].matchups))
        self.assertEqual(state.status, "IN_PROGRESS")

    def test_winners_advance_to_next_round(self):
        orch = make_orchestrator()
        state = orch.create_bracket(make_config(8))
        asyncio.run(orch.run_round(state.bracket_id))
        state = orch.get_state(state.bracket_id)
        second_round = state.rounds[1].matchups
        self.assertTrue(all(m.player_a and m.player_b for m in second_round))

    def test_series_respects_best_of_format(self):
        orch = make_orchestrator()
        state = orch.create_bracket(make_config(4, series_format=7))
        state = asyncio.run(orch.run_round(state.bracket_id))
        # Deterministic winner sweeps 4-0 in a best-of-7.
        matchup = state.rounds[0].matchups[0]
        self.assertEqual(matchup.series_wins.a + matchup.series_wins.b, 4)
        self.assertEqual(len(matchup.games), 4)

    def test_best_of_one_plays_single_game(self):
        orch = make_orchestrator()
        state = orch.create_bracket(make_config(4, series_format=1))
        state = asyncio.run(orch.run_round(state.bracket_id))
        self.assertEqual(len(state.rounds[0].matchups[0].games), 1)


class RunAllTest(unittest.TestCase):
    def test_run_all_completes_and_crowns_top_seed(self):
        orch = make_orchestrator()
        state = orch.create_bracket(make_config(16, series_format=7))
        state = asyncio.run(orch.run_all(state.bracket_id))
        self.assertEqual(state.status, "COMPLETE")
        self.assertIsNotNone(state.champion)
        # The lowest player_id (seed 1) wins every series by construction.
        self.assertEqual(state.champion.seed, 1)

    def test_missing_bracket_raises_keyerror(self):
        with self.assertRaises(KeyError):
            make_orchestrator().get_state("does-not-exist")


class ConcurrencyProbe:
    """Records peak simultaneous in-flight games to prove parallel dispatch."""

    def __init__(self):
        self.active = 0
        self.max_active = 0
        self.lock = threading.Lock()

    def __call__(self, player_a_id, player_b_id, season_a_id, season_b_id, mode):
        with self.lock:
            self.active += 1
            self.max_active = max(self.max_active, self.active)
        # Hold the slot briefly so concurrent matchups overlap in time.
        time.sleep(0.05)
        with self.lock:
            self.active -= 1
        a_wins = player_a_id < player_b_id
        return {
            "play_by_play": [],
            "summary": {
                "final_score": {"a": 21, "b": 7} if a_wins else {"a": 7, "b": 21}
            },
        }


class ParallelRoundTest(unittest.TestCase):
    def test_matchups_in_a_round_run_concurrently(self):
        # ADR-005: the four first-round matchups of an 8-player bracket should be
        # dispatched concurrently rather than serialized.
        probe = ConcurrencyProbe()
        orch = BracketOrchestrator(engine=None, game_simulator=probe)
        state = orch.create_bracket(make_config(8, series_format=1))
        asyncio.run(orch.run_round(state.bracket_id))
        self.assertTrue(all(m.winner for m in state.rounds[0].matchups))
        self.assertGreater(probe.max_active, 1)


if __name__ == "__main__":
    unittest.main()
