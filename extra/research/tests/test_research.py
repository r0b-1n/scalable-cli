import unittest
from unittest import mock

from sc_research import research as research_mod
from sc_research.cache import NullCache
from sc_research.http import RateLimited
from sc_research.provenance import Unavailable
from sc_research.sc import ScError

from .helpers import FakeSc, fixture, research

ISIN = "US0378331005"


def offline_providers():
    """Patch every network provider with recorded data."""
    return [
        mock.patch.object(research_mod.openfigi, "map_isin", lambda isin: research_mod.openfigi.parse_mapping(fixture("openfigi_mapping.json")[0], isin)),
        mock.patch.object(research_mod.edgar, "company_tickers", lambda: {"0": {"cik_str": 320193, "ticker": "AAPL", "title": "Apple Inc."}}),
        mock.patch.object(research_mod.edgar, "company_facts", lambda cik: fixture("edgar_companyfacts_aapl.json")),
        mock.patch.object(research_mod.edgar, "submissions", lambda cik: fixture("edgar_submissions_aapl.json")),
        mock.patch.object(research_mod.ecb, "fx_rates", lambda c: research_mod.ecb.parse_fx(fixture("ecb_exr.csv"))),
        mock.patch.object(research_mod.gdelt, "articles", mock.Mock(side_effect=RateLimited("gdelt", 429, "slow down"))),
    ]


class Dossier(unittest.TestCase):
    def setUp(self):
        for p in offline_providers():
            p.start()
            self.addCleanup(p.stop)

    def test_full_dossier(self):
        d = research().security_dossier(ISIN)
        s = d["sections"]
        self.assertEqual(d["name"], "Apple Inc.")
        self.assertEqual(list(s), list(research_mod.ALL_SECTIONS))
        for name in ("quote", "price_1y", "price_max", "position", "activity", "news_scalable", "identity", "fundamentals", "filings", "fx"):
            self.assertEqual(s[name]["status"], "ok", name)
            self.assertIn("fetched_at", s[name])
        self.assertTrue(s["price_1y"]["derived"])
        self.assertEqual(s["news_global"]["status"], "rate_limited")
        self.assertTrue(s["position"]["data"]["held"])
        self.assertTrue(all(t["isin"] == ISIN for t in s["activity"]["data"]["transactions"]))

    def test_valuation_is_fx_converted(self):
        f = research().security_dossier(ISIN, ["fundamentals"])["sections"]["fundamentals"]["data"]
        price = fixture("sc/quote.json")["result"]["quote_mid_price"]  # USD in the mock = reporting currency
        self.assertAlmostEqual(f["valuation"]["price_in_reporting_currency"], round(price, 4))
        self.assertEqual(f["sec_registrant"]["cik"], 320193)

    def test_sections_subset_skips_work(self):
        fake = FakeSc()
        d = research(fake).security_dossier(ISIN, ["quote"])
        self.assertEqual(list(d["sections"]), ["quote"])
        self.assertEqual([c[:2] for c in fake.calls], [["broker", "quote"]])

    def test_unknown_section(self):
        with self.assertRaises(ValueError):
            research().security_dossier(ISIN, ["nope"])

    def test_invalid_isin(self):
        with self.assertRaises(ValueError):
            research().security_dossier("--confirm")

    def test_filings_only_skips_companyfacts(self):
        with mock.patch.object(research_mod.edgar, "company_facts", mock.Mock(side_effect=AssertionError("not requested"))):
            s = research().security_dossier(ISIN, ["filings"])["sections"]
        self.assertEqual(list(s), ["quote", "filings"])
        self.assertEqual(s["filings"]["status"], "ok")

    def test_sc_failure_is_a_status_not_an_exception(self):
        fake = FakeSc(fail={"quote": ScError("no_session", "No active session.", ["Run 'sc login'"])})
        s = research(fake).security_dossier(ISIN, ["quote", "news_global"])["sections"]
        self.assertEqual(s["quote"]["status"], "error")
        self.assertEqual(s["quote"]["error"]["code"], "no_session")
        self.assertEqual(s["news_global"]["status"], "unavailable")  # no name without a quote



class EdgarWithoutUserAgent(unittest.TestCase):
    def test_unavailable(self):
        with mock.patch.object(research_mod.openfigi, "map_isin", lambda isin: research_mod.openfigi.parse_mapping(fixture("openfigi_mapping.json")[0], isin)), mock.patch.dict("os.environ", {"SEC_USER_AGENT": ""}):
            s = research().security_dossier(ISIN, ["fundamentals"])["sections"]
        self.assertEqual(s["fundamentals"]["status"], "unavailable")
        self.assertIn("SEC_USER_AGENT", s["fundamentals"]["reason"])


class Valuation(unittest.TestCase):
    def fund(self, **over):
        import datetime as dt

        from sc_research.providers import edgar

        fund = edgar.fundamentals(fixture("edgar_companyfacts_aapl.json"), today=dt.date(2026, 11, 3))
        return {**fund, **over}

    def setUp(self):
        self.r = research()

    def test_fx_failure_only_loses_valuation(self):
        with mock.patch.object(research_mod.ecb, "fx_rates", mock.Mock(side_effect=OSError("ECB down"))):
            v = self.r._valuation("US0378331005", self.fund(), {"quote_mid_price": 200, "quote_currency": "EUR"})
        self.assertFalse(v["available"])
        self.assertIn("ECB", v["reason"])

    def test_unpublished_currency(self):
        with mock.patch.object(research_mod.ecb, "fx_rates", lambda c: {}):
            v = self.r._valuation("US0378331005", self.fund(), {"quote_mid_price": 200, "quote_currency": "EUR"})
        self.assertIn("no reference rate", v["reason"])

    def test_adr_of_foreign_filer_is_not_valued(self):
        v = self.r._valuation("US6701002056", self.fund(filer_type="foreign"), {"quote_mid_price": 50, "quote_currency": "USD"})
        self.assertIn("ADR", v["reason"])

    def test_pence_quotes(self):
        rates = {"GBP": {"per_eur": 0.8, "date": "2099-01-01"}, "USD": {"per_eur": 1.0, "date": "2099-01-01"}}
        with mock.patch.object(research_mod.ecb, "fx_rates", lambda c: rates), mock.patch.object(research_mod, "FX_MAX_AGE_DAYS", 10**6):
            v = self.r._valuation("GB0000000000", self.fund(), {"quote_mid_price": 800, "quote_currency": "GBp"})
        self.assertAlmostEqual(v["price_in_reporting_currency"], 8 / 0.8 * 1.0)


class Snapshot(unittest.TestCase):
    def test_weights_and_concentration(self):
        snap = research().portfolio_snapshot()["sections"]
        h = snap["holdings"]["data"]
        self.assertAlmostEqual(sum(p["weight_pct"] for p in h["positions"]), 100, delta=0.1)
        weights = [p["weight_pct"] for p in h["positions"]]
        self.assertEqual(weights, sorted(weights, reverse=True))
        self.assertEqual(h["concentration"]["top1_weight_pct"], weights[0])
        self.assertIn("enabled", snap["trade_controls"]["data"])
        for name, sec in snap.items():
            self.assertEqual(sec["status"], "ok", name)


class Scan(unittest.TestCase):
    def test_scan_dedupes(self):
        out = research().scan([ISIN, ISIN.lower(), " "])
        self.assertEqual(out["count"], 1)
        self.assertIn("vs_sma_200d_pct", out["items"][0]["metrics_1y"])
        self.assertIsNotNone(out["items"][0]["metrics_1y"]["return_pct"])

    def test_scan_rejects_bad_isin_per_row(self):
        fake = FakeSc()
        out = research(fake).scan(["--help", ISIN])
        self.assertEqual(out["items"][0]["errors"], {"isin": "not a valid ISIN"})
        self.assertTrue(all("--help" not in c for c in fake.calls))

    def test_universe(self):
        self.assertEqual(len(research().universe("holdings")), len(fixture("sc/holdings.json")["result"]["items"]))
        with self.assertRaises(ValueError):
            research().universe("everything")


class PreviewTrade(unittest.TestCase):
    def test_never_confirms(self):
        fake = mock.Mock(return_value={"confirmation": {"id": "scb1_x"}})
        r = research_mod.Research(sc_run=fake, cache=NullCache())
        out = r.preview_trade("buy", ISIN, amount="500", order_type="limit", limit_price="150.5", venue="xetra")
        argv = fake.call_args[0][0]
        self.assertNotIn("--confirm", argv)
        self.assertEqual(argv[:3], ["broker", "trade", "buy"])
        self.assertFalse(out["order_placed"])
        self.assertIn("human", out["human_confirmation_required"])

    def test_flag_smuggling_is_rejected(self):
        r = research_mod.Research(sc_run=mock.Mock(), cache=NullCache())
        for kwargs in ({"amount": "--confirm"}, {"shares": "1 --confirm x"}, {"venue": "--confirm"}, {"limit_price": "-1"}):
            with self.subTest(kwargs=kwargs), self.assertRaises(ValueError):
                r.preview_trade("buy", ISIN, **kwargs)
        for side, isin, ot in (("hold", ISIN, "market"), ("buy", "--confirm", "market"), ("buy", ISIN, "trailing")):
            with self.assertRaises(ValueError):
                r.preview_trade(side, isin, order_type=ot)


class Provenance(unittest.TestCase):
    def test_unavailable(self):
        from sc_research.provenance import section

        def boom():
            raise Unavailable("nope")

        self.assertEqual(section("x", boom), {"source": "x", "status": "unavailable", "reason": "nope"})
        self.assertEqual(section("x", lambda: (None, 1.0))["status"], "unavailable")


if __name__ == "__main__":
    unittest.main()
