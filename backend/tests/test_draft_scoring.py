import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

from fastapi.testclient import TestClient

from backend.app import api
from backend.app.draft_scoring import (
    GAMES,
    DraftLineup,
    DraftLineupError,
    DraftScoringEngine,
)

# Synthetic player-seasons at quality tiers, one per slot at each tier. Metrics
# are centred on a league-average STARTER, so the tiers below are written to sit
# at known points of that scale:
#   goat  ~ all-time peak season (-> should be able to run the table 82-0)
#   avg   ~ exactly a league-average starter (-> ~41 wins, .500)
#   scrub ~ clearly below replacement on every metric (-> a losing record)
# mp is set to a full starter load (>= _MP_FULL) for goat/avg so the minutes
# reliability gate leaves their rate stats untouched.
FAKE_CSV = """player_id,player_name,season_id,pos,teams,mp,ws_per_48,bpm,vorp,ts_pct
10,Goat PG,2000-01,PG,AAA,3000,0.32,13.0,12.0,0.64
11,Goat SG,2000-01,SG,AAA,3000,0.32,13.0,12.0,0.64
12,Goat SF,2000-01,SF,AAA,3000,0.32,13.0,12.0,0.64
13,Goat PF,2000-01,PF,AAA,3000,0.32,13.0,12.0,0.64
14,Goat C,2000-01,C,AAA,3000,0.32,13.0,12.0,0.64
20,Avg PG,2000-01,PG,BBB,2200,0.10,0.0,2.0,0.56
21,Avg SG,2000-01,SG,BBB,2200,0.10,0.0,2.0,0.56
22,Avg SF,2000-01,SF,BBB,2200,0.10,0.0,2.0,0.56
23,Avg PF,2000-01,PF,BBB,2200,0.10,0.0,2.0,0.56
24,Avg C,2000-01,C,BBB,2200,0.10,0.0,2.0,0.56
30,Scrub PG,2000-01,PG,CCC,1000,0.02,-3.0,-0.5,0.50
31,Scrub SG,2000-01,SG,CCC,1000,0.02,-3.0,-0.5,0.50
32,Scrub SF,2000-01,SF,CCC,1000,0.02,-3.0,-0.5,0.50
33,Scrub PF,2000-01,PF,CCC,1000,0.02,-3.0,-0.5,0.50
34,Scrub C,2000-01,C,CCC,1000,0.02,-3.0,-0.5,0.50
"""

SLOTS = ("PG", "SG", "SF", "PF", "C")


def _engine():
    tmp = Path(tempfile.mkdtemp()) / "adv.csv"
    tmp.write_text(FAKE_CSV)
    return DraftScoringEngine(csv_path=tmp)


def _lineup(first_id: int):
    # first_id is the PG id; consecutive ids fill SG..C (matches the fixture).
    return DraftLineup(
        players=[
            {"player_id": first_id + i, "season_id": "2000-01", "position_slot": slot}
            for i, slot in enumerate(SLOTS)
        ]
    )


class ScoringCalibrationTest(unittest.TestCase):
    def test_goat_lineup_can_run_the_table(self):
        # A stack of all-time peak seasons must be able to go a perfect 82-0 —
        # the game's stated objective.
        score = _engine().score(_lineup(10))
        self.assertEqual(score.wins, GAMES)
        self.assertEqual(score.losses, 0)

    def test_average_lineup_near_500(self):
        # A league-average starting five lands right around .500 (~41 wins).
        score = _engine().score(_lineup(20))
        self.assertGreaterEqual(score.wins, 38)
        self.assertLessEqual(score.wins, 44)

    def test_scrub_lineup_clearly_losing(self):
        # Below-replacement players actively drag the team down — a clear loser.
        score = _engine().score(_lineup(30))
        self.assertLess(score.wins, 30)

    def test_better_lineup_wins_more(self):
        eng = _engine()
        self.assertGreater(
            eng.score(_lineup(10)).wins, eng.score(_lineup(20)).wins
        )
        self.assertGreater(
            eng.score(_lineup(20)).wins, eng.score(_lineup(30)).wins
        )

    def test_wins_plus_losses_is_82(self):
        score = _engine().score(_lineup(10))
        self.assertEqual(score.wins + score.losses, GAMES)


class ScoringDeterminismAndShapeTest(unittest.TestCase):
    def test_deterministic(self):
        eng = _engine()
        a = eng.score(_lineup(10))
        b = eng.score(_lineup(10))
        self.assertEqual(a.model_dump(), b.model_dump())

    def test_breakdown_shape_and_metrics(self):
        score = _engine().score(_lineup(10))
        self.assertEqual(len(score.breakdown), 5)
        first = score.breakdown[0]
        self.assertEqual(first.player_id, 10)
        self.assertEqual(first.name, "Goat PG")
        self.assertEqual(first.position_slot, "PG")
        self.assertIsInstance(first.contribution_score, float)
        self.assertEqual(first.metrics.ws_per_48, 0.32)
        self.assertEqual(first.metrics.bpm, 13.0)
        self.assertEqual(first.metrics.vorp, 12.0)
        self.assertEqual(first.metrics.ts_pct, 0.64)

    def test_balance_rewards_complementary_over_redundant(self):
        # A team elite in every dimension should outscore one strong only in WS.
        eng = _engine()
        complementary = eng.score(_lineup(10)).breakdown
        total_complementary = sum(b.contribution_score for b in complementary)
        self.assertGreater(total_complementary, 0)

    def test_ts_provider_overrides_csv(self):
        tmp = Path(tempfile.mkdtemp()) / "adv.csv"
        tmp.write_text(FAKE_CSV)
        provider = lambda pid, s: {"true_shooting_pct": 0.40}  # noqa: E731
        engine = DraftScoringEngine(season_stats_provider=provider, csv_path=tmp)
        score = engine.score(_lineup(10))
        # All breakdown TS% should reflect the provider value, not the CSV 0.62.
        self.assertTrue(all(b.metrics.ts_pct == 0.40 for b in score.breakdown))


class ScoringValidationTest(unittest.TestCase):
    def test_rejects_wrong_count(self):
        lineup = DraftLineup(
            players=[
                {"player_id": 10, "season_id": "2000-01", "position_slot": "PG"}
            ]
        )
        with self.assertRaises(DraftLineupError):
            _engine().score(lineup)

    def test_rejects_duplicate_slot(self):
        lineup = DraftLineup(
            players=[
                {"player_id": 10 + i, "season_id": "2000-01", "position_slot": "PG"}
                for i in range(5)
            ]
        )
        with self.assertRaises(DraftLineupError):
            _engine().score(lineup)


class ScoreEndpointTest(unittest.TestCase):
    def setUp(self):
        self.client = TestClient(api.app)

    def _payload(self, players):
        return {"players": players}

    def test_score_endpoint_real_lineup(self):
        # Real player-seasons present in the committed CSV (Jordan 1995-96, etc.).
        players = [
            {"player_id": 893, "season_id": "1995-96", "position_slot": "PG"},
            {"player_id": 893, "season_id": "1995-96", "position_slot": "SG"},
            {"player_id": 2544, "season_id": "2012-13", "position_slot": "SF"},
            {"player_id": 1495, "season_id": "2001-02", "position_slot": "PF"},
            {"player_id": 406, "season_id": "1999-00", "position_slot": "C"},
        ]
        with patch.object(api.draft_scoring_engine, "_season_stats_provider", None):
            response = self.client.post(
                "/api/draft/score", json=self._payload(players)
            )
        self.assertEqual(response.status_code, 200)
        body = response.json()
        self.assertEqual(body["wins"] + body["losses"], 82)
        self.assertEqual(len(body["breakdown"]), 5)
        # An all-star lineup should be a strong winner.
        self.assertGreater(body["wins"], 55)

    def test_score_endpoint_rejects_incomplete_lineup(self):
        players = [
            {"player_id": 893, "season_id": "1995-96", "position_slot": "PG"},
        ]
        response = self.client.post("/api/draft/score", json=self._payload(players))
        self.assertEqual(response.status_code, 400)

    def test_score_endpoint_rejects_bad_slot(self):
        players = [
            {"player_id": 10 + i, "season_id": "2000-01", "position_slot": "XX"}
            for i in range(5)
        ]
        response = self.client.post("/api/draft/score", json=self._payload(players))
        self.assertEqual(response.status_code, 422)  # pydantic Literal rejection


if __name__ == "__main__":
    unittest.main()
