import json
import unittest

from sc_research.http import HttpError, RateLimited
from sc_research.provenance import Unavailable
from sc_research.providers import ecb, edgar, gdelt, openfigi

from .helpers import fixture


class EdgarFundamentals(unittest.TestCase):
    """Real Apple companyfacts (trimmed) captured from data.sec.gov."""

    @classmethod
    def setUpClass(cls):
        cls.fund = edgar.fundamentals(fixture("edgar_companyfacts_aapl.json"))

    def test_ttm_uses_latest_annual_plus_ytd_minus_prior_ytd(self):
        rev = self.fund["metrics"]["revenue"]
        self.assertEqual(rev["concept"], "us-gaap:RevenueFromContractWithCustomerExcludingAssessedTax")
        self.assertEqual(rev["ttm"]["method"], "annual_plus_ytd_minus_prior_ytd")
        self.assertEqual(rev["ttm"]["end"], "2026-06-27")
        self.assertEqual(rev["latest_annual"]["val"], 416161000000)
        self.assertEqual(rev["ttm"]["val"], 466823000000)

    def test_cash_flow_has_no_stale_quarter(self):
        # Cash-flow facts are YTD-only in 10-Qs: the only ~90-day fact is an old Q1.
        ocf = self.fund["metrics"]["operating_cash_flow"]
        self.assertIsNone(ocf["latest_quarter"])
        self.assertIsNone(ocf["quarter_yoy_growth_pct"])
        self.assertEqual(self.fund["metrics"]["revenue"]["latest_quarter"]["end"], "2026-06-27")

    def test_eps_is_rounded(self):
        self.assertEqual(self.fund["metrics"]["eps_diluted"]["ttm"]["val"], 8.72)

    def test_ratios_and_valuation(self):
        r = self.fund["ratios"]
        self.assertAlmostEqual(r["net_margin_pct"], 27.62, places=2)
        self.assertEqual(r["free_cash_flow_ttm"], 146724000000 - 10041000000)
        v = edgar.valuation(self.fund, 200.0)
        self.assertEqual(v["pe_ttm"], round(200 / 8.72, 2))
        self.assertEqual(v["market_cap"], 200 * 14594180000)
        self.assertFalse(edgar.valuation(self.fund, None)["available"])

    def test_restatement_wins(self):
        rows = [
            {"start": "2024-01-01", "end": "2024-12-31", "val": 100, "form": "10-K", "filed": "2025-02-01"},
            {"start": "2024-01-01", "end": "2024-12-31", "val": 90, "form": "10-K/A", "filed": "2025-06-01"},
        ]
        self.assertEqual(edgar.flow_metric(rows)["latest_annual"]["val"], 90)


class EdgarIdentity(unittest.TestCase):
    TICKERS = {"0": {"cik_str": 320193, "ticker": "AAPL", "title": "Apple Inc."}, "1": {"cik_str": 1, "ticker": "ALV", "title": "Autoliv Inc"}}

    def test_find_cik(self):
        self.assertEqual(edgar.find_cik(self.TICKERS, "aapl", "APPLE INC")["cik"], 320193)

    def test_ticker_collision_is_rejected(self):
        # Allianz trades as ALV in Germany; on SEC that ticker is Autoliv.
        with self.assertRaises(Unavailable):
            edgar.find_cik(self.TICKERS, "ALV", "Allianz SE")

    def test_user_agent_required(self):
        import os
        from unittest import mock

        with mock.patch.dict(os.environ, {"SEC_USER_AGENT": ""}):
            with self.assertRaises(Unavailable):
                edgar.user_agent()

    def test_recent_filings(self):
        out = edgar.recent_filings(fixture("edgar_submissions_aapl.json"), limit=3)
        self.assertEqual(out["company"], "Apple Inc.")
        self.assertEqual(len(out["filings"]), 3)
        self.assertTrue(all(f["form"] != "4" for f in out["filings"]))
        self.assertTrue(out["filings"][0]["url"].startswith("https://www.sec.gov/Archives/edgar/data/320193/"))


class Ecb(unittest.TestCase):
    def test_fx(self):
        fx = ecb.parse_fx(fixture("ecb_exr.csv"))
        self.assertEqual(fx["USD"]["per_eur"], 1.1216)
        self.assertEqual(fx["USD"]["date"], "2026-11-02")
        self.assertAlmostEqual(fx["USD"]["change_pct"], (1.1216 / 1.1172 - 1) * 100, places=3)

    def test_key_rates(self):
        self.assertEqual(ecb.parse_key_rates(fixture("ecb_dfr.csv"))["deposit_facility"]["rate_pct"], 2.5)

    def test_convert(self):
        rates = {"USD": {"per_eur": 1.25}, "GBP": {"per_eur": 0.8}}
        self.assertEqual(ecb.convert(100, "EUR", "USD", rates), 125)
        self.assertEqual(ecb.convert(125, "USD", "EUR", rates), 100)
        self.assertAlmostEqual(ecb.convert(125, "USD", "GBP", rates), 80)
        self.assertIsNone(ecb.convert(1, "JPY", "EUR", rates))


class OpenFigi(unittest.TestCase):
    def test_prefers_home_exchange(self):
        data = fixture("openfigi_mapping.json")
        self.assertEqual(openfigi.parse_mapping(data[0], "US0378331005")["primary"]["ticker"], "AAPL")
        sap = openfigi.parse_mapping(data[1], "DE0007164600")
        self.assertEqual(sap["primary"]["exchCode"], "GR")

    def test_no_listing(self):
        with self.assertRaises(Unavailable):
            openfigi.parse_mapping({"warning": "No identifier found."}, "XX0000000000")


class Gdelt(unittest.TestCase):
    def test_company_query(self):
        self.assertEqual(gdelt.company_query("Apple Inc."), '"Apple"')
        self.assertEqual(gdelt.company_query("Mercedes-Benz Group AG"), '"Mercedes-Benz"')
        self.assertEqual(gdelt.company_query("SAP SE"), '"SAP"')

    def test_rate_limit_text_is_detected(self):
        with self.assertRaises(RateLimited):
            gdelt.parse_artlist(fixture("gdelt_ratelimited.txt"))

    def test_parse_articles(self):
        # Shape per the GDELT DOC 2.0 API documentation (mode=artlist, format=json).
        raw = json.dumps({"articles": [{"url": "https://x.example/a", "title": "T", "seendate": "20261102T183000Z", "domain": "x.example", "language": "English", "sourcecountry": "United States"}]})
        out = gdelt.parse_artlist(raw)
        self.assertEqual(out[0]["seen_utc"], "2026-11-02T18:30:00+00:00")
        self.assertEqual(gdelt.parse_artlist("{}"), [])
        with self.assertRaises(HttpError):
            gdelt.parse_artlist("<html>")


if __name__ == "__main__":
    unittest.main()
