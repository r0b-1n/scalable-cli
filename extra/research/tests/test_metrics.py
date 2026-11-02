import datetime as dt
import unittest

from sc_research import metrics

from .helpers import fixture


def chart(prices, step_days=1):
    start = dt.datetime(2025, 1, 1, tzinfo=dt.UTC)
    return {
        "timeframe": "1y",
        "currency": "EUR",
        "data_points": [
            {"mid_price": p, "timestamp_utc": (start + dt.timedelta(days=i * step_days)).isoformat()} for i, p in enumerate(prices)
        ],
    }


class Metrics(unittest.TestCase):
    def test_basic_stats(self):
        s = metrics.summarize(chart([100, 120, 90, 110]))
        self.assertEqual(s["return_pct"], 10.0)
        self.assertEqual(s["high"], 120)
        self.assertEqual(s["max_drawdown"]["pct"], -25.0)
        self.assertEqual(s["below_high_pct"], round((110 / 120 - 1) * 100, 2))

    def test_rsi_extremes(self):
        self.assertEqual(metrics.rsi(list(range(1, 30))), 100.0)
        self.assertLess(metrics.rsi(list(range(30, 1, -1))), 1)
        self.assertIsNone(metrics.rsi([1, 2, 3]))

    def test_sma_is_calendar_based(self):
        s = metrics.summarize(chart(list(range(1, 60))))  # 58 days of daily points
        self.assertIn("sma_50d", s)
        self.assertNotIn("sma_200d", s)
        sparse = metrics.summarize(chart(list(range(1, 80)), step_days=3))  # 234 days, every 3rd day
        self.assertIn("sma_200d", sparse)
        self.assertEqual(sparse["median_sampling_days"], 3.0)

    def test_non_positive_prices_are_dropped(self):
        s = metrics.summarize(chart([0, 1, 2, -3, 4]))
        self.assertEqual(s["points"], 3)
        self.assertEqual(s["return_pct"], 300.0)

    def test_flat_series_rsi_is_neutral(self):
        self.assertEqual(metrics.rsi([5.0] * 30), 50.0)

    def test_volatility_is_robust_to_irregular_sampling(self):
        import math
        import random

        rng = random.Random(7)
        daily, p = [], 100.0
        for _ in range(365):
            p *= math.exp(rng.gauss(0, 0.2 / math.sqrt(365)))
            daily.append(p)
        dense = metrics.summarize(chart(daily))["volatility_annualized_pct"]
        sparse = metrics.summarize(chart(daily[::3], step_days=3))["volatility_annualized_pct"]
        self.assertAlmostEqual(dense, 20, delta=3)
        self.assertAlmostEqual(sparse, 20, delta=4)

    def test_naive_timestamps_are_utc(self):
        c = {"data_points": [{"mid_price": 1, "timestamp_utc": "2025-01-01T00:00:00"}, {"mid_price": 2, "timestamp_utc": "2025-01-02T00:00:00Z"}]}
        self.assertEqual(metrics.summarize(c)["return_pct"], 100.0)

    def test_technicals_can_be_skipped(self):
        self.assertNotIn("rsi_14_samples", metrics.summarize(chart(list(range(1, 60))), technicals=False))

    def test_cagr_needs_long_history(self):
        self.assertNotIn("cagr_pct", metrics.summarize(chart([100, 110])))
        long = metrics.summarize(chart([100, 121], step_days=730))
        self.assertAlmostEqual(long["cagr_pct"], 10.0, delta=0.2)

    def test_insufficient(self):
        self.assertTrue(metrics.summarize({"data_points": []})["insufficient_data"])

    def test_real_mock_chart(self):
        s = metrics.summarize(fixture("sc/chart_1y.json"))
        self.assertEqual(s["points"], fixture("sc/chart_1y.json")["point_count"])
        self.assertGreater(s["volatility_annualized_pct"], 0)


if __name__ == "__main__":
    unittest.main()
