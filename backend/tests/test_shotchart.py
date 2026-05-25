import unittest
from unittest.mock import patch

from fastapi.testclient import TestClient

from backend.app import api
from backend.app.shotchart import ShotChartService


def shot_row(basic, area, made):
    return {
        "SHOT_ZONE_BASIC": basic,
        "SHOT_ZONE_AREA": area,
        "SHOT_ATTEMPTED_FLAG": 1,
        "SHOT_MADE_FLAG": 1 if made else 0,
    }


SAMPLE_ROWS = [
    shot_row("Restricted Area", "Center(C)", True),
    shot_row("Restricted Area", "Center(C)", True),
    shot_row("Restricted Area", "Center(C)", False),
    shot_row("Above the Break 3", "Center(C)", True),
    shot_row("Above the Break 3", "Center(C)", False),
]


class ShotChartServiceTest(unittest.TestCase):
    def test_pre_tracking_era_returns_unavailable_without_fetch(self):
        service = ShotChartService()
        with patch(
            "backend.app.shotchart.fetch_stats_data"
        ) as fetch:
            result = service.get_shot_chart(893, "1995-96")
        fetch.assert_not_called()
        self.assertFalse(result.available)
        self.assertEqual(result.zones, [])
        self.assertTrue(result.data_warnings)

    def test_tracking_era_aggregates_zones(self):
        service = ShotChartService()
        with patch(
            "backend.app.shotchart.fetch_stats_data",
            return_value={"Shot_Chart_Detail": SAMPLE_ROWS},
        ):
            result = service.get_shot_chart(201939, "2015-16")
        self.assertTrue(result.available)
        self.assertEqual(len(result.zones), 2)
        # Zones are sorted by attempts desc; the rim zone has 3 attempts, 2 made.
        rim = result.zones[0]
        self.assertEqual(rim.zone_label, "Restricted Area")
        self.assertEqual(rim.attempts, 3)
        self.assertEqual(rim.made, 2)
        self.assertAlmostEqual(rim.fg_pct, 0.6667, places=3)

    def test_tracking_era_with_no_rows_is_unavailable(self):
        service = ShotChartService()
        with patch(
            "backend.app.shotchart.fetch_stats_data",
            return_value={"Shot_Chart_Detail": []},
        ):
            result = service.get_shot_chart(201939, "2014-15")
        self.assertFalse(result.available)
        self.assertTrue(result.data_warnings)


class ShotChartEndpointTest(unittest.TestCase):
    def setUp(self):
        self.client = TestClient(api.app)

    def test_endpoint_returns_chart_data(self):
        with patch(
            "backend.app.shotchart.fetch_stats_data",
            return_value={"Shot_Chart_Detail": SAMPLE_ROWS},
        ):
            response = self.client.get("/shotchart/201939/2015-16")
        self.assertEqual(response.status_code, 200)
        body = response.json()
        self.assertTrue(body["available"])
        self.assertEqual(len(body["zones"]), 2)
        self.assertEqual(set(body["zones"][0]), {
            "zone_label",
            "zone_area",
            "attempts",
            "made",
            "fg_pct",
        })

    def test_endpoint_pre_tracking_era_warns(self):
        response = self.client.get("/shotchart/893/1995-96")
        self.assertEqual(response.status_code, 200)
        body = response.json()
        self.assertFalse(body["available"])
        self.assertEqual(body["zones"], [])
        self.assertTrue(body["data_warnings"])

    def test_endpoint_upstream_failure_returns_502(self):
        with patch(
            "backend.app.shotchart.fetch_stats_data",
            side_effect=RuntimeError("nba down"),
        ):
            response = self.client.get("/shotchart/201939/2015-16")
        self.assertEqual(response.status_code, 502)


if __name__ == "__main__":
    unittest.main()
