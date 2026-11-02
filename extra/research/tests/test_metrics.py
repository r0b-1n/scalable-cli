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

    def test_sma_only_with_enough_points(self):
        s = metrics.summarize(chart(list(range(1, 60))))
        self.assertIn("sma_50", s)
        self.assertNotIn("sma_200", s)

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
