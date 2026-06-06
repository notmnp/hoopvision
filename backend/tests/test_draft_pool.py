import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

from fastapi.testclient import TestClient

from backend.app import api
from backend.app import draft_eras
from backend.app.draft import (
    MIN_VIABLE_POOL,
    AutoRespin,
    PlayerPool,
    PlayerPoolResolver,
    parse_positions,
)


# A tiny synthetic dataset exercising era windows, franchise relocation, trades,
# and ranking — independent of the committed CSV.
FAKE_CSV = """player_id,player_name,season_id,pos,teams,mp,ws_per_48,bpm,vorp,ts_pct
1,Star Wing,1995-96,SF,CHI,3000,0.250,8.0,7.0,0.600
1,Star Wing,1996-97,SF,CHI,3000,0.300,9.0,8.0,0.610
2,Steady Guard,1996-97,PG-SG,CHI,2500,0.150,3.0,3.0,0.560
3,Big Man,1997-98,C,CHI,2400,0.180,4.0,4.0,0.580
4,Sonic Legend,1995-96,PF,SEA,2800,0.220,6.0,6.0,0.590
8,Sonic Two,1996-97,SG,SEA,2700,0.190,5.0,5.0,0.585
9,Sonic Three,1997-98,PG,SEA,2600,0.170,4.0,4.0,0.575
5,Thunder Star,2012-13,SG,OKC,2900,0.210,7.0,6.5,0.605
6,Traded Vet,1996-97,SF,PHI;CHI,2000,0.120,1.0,1.0,0.540
7,Bench Cog,1996-97,PG,CHI,1600,0.080,-1.0,0.2,0.500
10,Swing Man,1994-95,SG,CHI,2200,0.140,2.0,2.0,0.550
10,Swing Man,1996-97,PG,CHI,2300,0.160,2.5,2.5,0.555
"""


def _make_resolver(stats=None):
    tmp = Path(tempfile.mkdtemp()) / "adv.csv"
    tmp.write_text(FAKE_CSV)
    provider = lambda pid, season: stats  # noqa: E731
    return PlayerPoolResolver(season_stats_provider=provider, csv_path=tmp)


class ParsePositionsTest(unittest.TestCase):
    def test_single_and_multi(self):
        self.assertEqual(parse_positions("SF"), ["SF"])
        self.assertEqual(parse_positions("PF-C"), ["PF", "C"])
        self.assertEqual(parse_positions("PG-SG"), ["PG", "SG"])

    def test_legacy_generic_positions_expand(self):
        self.assertEqual(parse_positions("G"), ["PG", "SG"])
        self.assertEqual(parse_positions("F"), ["SF", "PF"])

    def test_garbage_ignored(self):
        self.assertEqual(parse_positions(""), [])
        self.assertEqual(parse_positions("XX"), [])


class EraFranchiseDataTest(unittest.TestCase):
    def test_eras_partition_without_gaps(self):
        eras = draft_eras.list_eras()
        self.assertEqual([e["id"] for e in eras][0], "1970s")
        for earlier, later in zip(eras, eras[1:]):
            # Half-open windows chain end-to-start so every season maps to one era.
            self.assertEqual(earlier["end_year"], later["start_year"])

    def test_franchise_eligibility_respects_relocations(self):
        # Seattle existed in the 1990s but not the 2010s; OKC is the reverse.
        nineties = {f["id"]: f for f in draft_eras.list_franchises_for_era("1990s")}
        tens = {f["id"]: f for f in draft_eras.list_franchises_for_era("2010s")}
        self.assertEqual(nineties["thunder"]["name"], "Seattle SuperSonics")
        self.assertEqual(nineties["thunder"]["abbreviation"], "SEA")
        self.assertEqual(tens["thunder"]["name"], "Oklahoma City Thunder")

    def test_expansion_team_absent_before_it_existed(self):
        seventies = {f["id"] for f in draft_eras.list_franchises_for_era("1970s")}
        self.assertNotIn("heat", seventies)  # Heat began play in 1988
        self.assertNotIn("raptors", seventies)
        self.assertIn("celtics", seventies)

    def test_franchise_abbreviations_union_all_stints(self):
        self.assertEqual(
            draft_eras.franchise_abbreviations("thunder"), {"SEA", "OKC"}
        )
        self.assertEqual(
            draft_eras.franchise_abbreviations("wizards"), {"CAP", "WSB", "WAS"}
        )


class ResolvePoolTest(unittest.TestCase):
    def test_ranks_by_peak_ws48_and_uses_peak_season(self):
        pool = _make_resolver().resolve_pool("1990s", "bulls")
        self.assertIsInstance(pool, PlayerPool)
        self.assertEqual(pool.players[0].player_id, 1)
        self.assertEqual(pool.players[0].name, "Star Wing")
        # Peak season within the era is 1996-97 (ws .300 > .250 in 1995-96).
        self.assertEqual(pool.players[0].season_id, "1996-97")
        self.assertEqual(pool.players[0].stats.ws_per_48, 0.300)
        # Ranked strictly descending by WS/48.
        ws = [p.stats.ws_per_48 for p in pool.players]
        self.assertEqual(ws, sorted(ws, reverse=True))

    def test_excluded_players_removed(self):
        pool = _make_resolver().resolve_pool("1990s", "bulls", exclude_ids={1})
        ids = {p.player_id for p in pool.players}
        self.assertNotIn(1, ids)

    def test_positions_union_across_seasons(self):
        # Player 10 played SG (1994-95) then PG (1996-97, the peak) for the same
        # franchise in the same era; eligibility must span BOTH slots, not just
        # the peak season's PG — ordered canonically PG before SG.
        pool = _make_resolver().resolve_pool("1990s", "bulls")
        by_id = {p.player_id: p for p in pool.players}
        self.assertEqual(by_id[10].positions, ["PG", "SG"])
        # A genuinely single-position player stays single.
        self.assertEqual(by_id[3].positions, ["C"])

    def test_trade_team_membership_matches_franchise(self):
        pool = _make_resolver().resolve_pool("1990s", "bulls")
        # player 6 played PHI;CHI in 1996-97 — counts for the Bulls.
        self.assertIn(6, {p.player_id for p in pool.players})

    def test_franchise_era_isolation(self):
        # The Sonics legend (SEA, 1995-96) shows for the Thunder franchise in the
        # 1990s; the OKC-era star (2012-13) does not bleed into the 1990s pool.
        sonics_90s = _make_resolver().resolve_pool("1990s", "thunder")
        ids = {p.player_id for p in sonics_90s.players}
        self.assertIn(4, ids)
        self.assertNotIn(5, ids)

    def test_auto_respin_below_minimum(self):
        # Only one OKC player in the 2010s sample -> below MIN_VIABLE_POOL.
        self.assertLess(1, MIN_VIABLE_POOL)
        result = _make_resolver().resolve_pool("2010s", "thunder")
        self.assertIsInstance(result, AutoRespin)
        self.assertTrue(result.auto_respin)

    def test_unknown_era_or_franchise_returns_none(self):
        resolver = _make_resolver()
        self.assertIsNone(resolver.resolve_pool("1850s", "bulls"))
        self.assertIsNone(resolver.resolve_pool("1990s", "nonexistent"))

    def test_display_stats_from_provider(self):
        stats = {
            "points_per_game": 28.4,
            "assist_per_game": 5.2,
            "rebound_per_game": 6.9,
        }
        pool = _make_resolver(stats=stats).resolve_pool("1990s", "bulls")
        top = pool.players[0]
        self.assertEqual(top.stats.ppg, 28.4)
        self.assertEqual(top.stats.apg, 5.2)
        self.assertEqual(top.stats.rpg, 6.9)


class DraftEndpointsTest(unittest.TestCase):
    """Endpoint wiring against the real committed CSV (provider stubbed)."""

    def setUp(self):
        self.client = TestClient(api.app)

    def test_eras_endpoint(self):
        response = self.client.get("/api/draft/eras")
        self.assertEqual(response.status_code, 200)
        ids = [e["id"] for e in response.json()["eras"]]
        self.assertEqual(ids, ["1970s", "1980s", "1990s", "2000s", "2010s", "2020s"])

    def test_franchises_endpoint_filters_by_era(self):
        response = self.client.get("/api/draft/franchises", params={"era": "1990s"})
        self.assertEqual(response.status_code, 200)
        names = {f["name"] for f in response.json()["franchises"]}
        self.assertIn("Chicago Bulls", names)
        self.assertIn("Seattle SuperSonics", names)
        self.assertNotIn("Oklahoma City Thunder", names)

    def test_franchises_endpoint_rejects_unknown_era(self):
        response = self.client.get("/api/draft/franchises", params={"era": "1700s"})
        self.assertEqual(response.status_code, 400)

    def test_pool_endpoint_returns_ranked_bulls_90s(self):
        # Stub the per-game provider so the test never touches live NBA Stats.
        with patch.object(
            api.player_pool_resolver,
            "_season_stats_provider",
            return_value={"points_per_game": 1.0},
        ):
            response = self.client.get(
                "/api/draft/pool",
                params={"era": "1990s", "franchise_id": "bulls"},
            )
        self.assertEqual(response.status_code, 200)
        body = response.json()
        self.assertEqual(body["era"], "1990s")
        self.assertEqual(body["franchise"], "bulls")
        # The pool is unrestricted: every eligible Bulls-90s player is surfaced.
        self.assertGreater(len(body["players"]), 0)
        # With a flat per-game stub, PPG ties resolve on WS/48 — Jordan (893)
        # was the Bulls' peak-WS/48 player of the 1990s, so he leads.
        self.assertEqual(body["players"][0]["player_id"], 893)
        entry = body["players"][0]
        self.assertIn("positions", entry)
        self.assertIn("ws_per_48", entry["stats"])

    def test_pool_endpoint_excludes_players(self):
        with patch.object(
            api.player_pool_resolver, "_season_stats_provider", return_value=None
        ):
            response = self.client.get(
                "/api/draft/pool",
                params={
                    "era": "1990s",
                    "franchise_id": "bulls",
                    "exclude": "893,33",
                },
            )
        ids = {p["player_id"] for p in response.json()["players"]}
        self.assertNotIn(893, ids)

    def test_pool_endpoint_unknown_franchise_404(self):
        response = self.client.get(
            "/api/draft/pool", params={"era": "1990s", "franchise_id": "nope"}
        )
        self.assertEqual(response.status_code, 404)


if __name__ == "__main__":
    unittest.main()
