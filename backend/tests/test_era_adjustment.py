import unittest

from backend.app.era_adjustment import EraAdjustmentService


class EraAdjustmentServiceTest(unittest.TestCase):
    def setUp(self):
        self.service = EraAdjustmentService()

    def test_selects_era_by_largest_career_overlap(self):
        adjustment = self.service.get_adjustment(1984, 2003)

        self.assertEqual(adjustment.era_key, "physical_half_court")
        self.assertEqual(adjustment.career_start_year, 1984)
        self.assertEqual(adjustment.career_end_year, 2003)

    def test_returns_modern_baseline_for_missing_years(self):
        adjustment = self.service.get_adjustment(None, None)

        self.assertEqual(adjustment.era_key, "modern_spacing")
        self.assertEqual(adjustment.pace_multiplier, 1.0)
        self.assertEqual(adjustment.scoring_environment_multiplier, 1.0)

    def test_swaps_reversed_career_years(self):
        adjustment = self.service.get_adjustment(2003, 1984)

        self.assertEqual(adjustment.career_start_year, 1984)
        self.assertEqual(adjustment.career_end_year, 2003)

    def test_returns_serializable_adjustment(self):
        adjustment = self.service.get_adjustment("1960", "1969").to_dict()

        self.assertEqual(adjustment["era_key"], "pace_and_space_predecessor")
        self.assertGreater(adjustment["pace_multiplier"], 0)
        self.assertGreater(adjustment["scoring_environment_multiplier"], 0)


if __name__ == "__main__":
    unittest.main()
