import asyncio
import unittest
from unittest import mock

try:
    from mcp import Client

    from sc_research import server
except ImportError:  # the `mcp` extra is optional
    server = None

from .helpers import research


@unittest.skipIf(server is None, "mcp extra not installed")
class Server(unittest.TestCase):
    def setUp(self):
        patcher = mock.patch.object(server, "_research", research())
        patcher.start()
        self.addCleanup(patcher.stop)

    def call(self, name, args=None):
        async def go():
            async with Client(server.mcp) as client:
                return await client.call_tool(name, args or {})

        return asyncio.run(go())

    def test_tools_are_read_only_and_described(self):
        async def go():
            async with Client(server.mcp) as client:
                return (await client.list_tools()).tools

        tools = asyncio.run(go())
        names = {t.name for t in tools}
        self.assertEqual(
            names,
            {"get_portfolio_snapshot", "get_security_dossier", "scan_securities", "search_securities", "get_market_context", "search_global_news", "preview_trade"},
        )
        for t in tools:
            self.assertTrue(t.description, t.name)
            self.assertTrue(t.annotations.read_only_hint, t.name)
        self.assertNotIn("confirm", next(t for t in tools if t.name == "preview_trade").input_schema["properties"])

    def test_prompts(self):
        async def go():
            async with Client(server.mcp) as client:
                names = {p.name for p in (await client.list_prompts()).prompts}
                text = (await client.get_prompt("analyze_security", {"isin": "US0378331005"})).messages[0].content.text
                return names, text

        names, text = asyncio.run(go())
        self.assertEqual(names, {"analyze_security", "review_portfolio"})
        self.assertIn("US0378331005", text)
        self.assertIn("phase 2", text)

    def test_snapshot(self):
        result = self.call("get_portfolio_snapshot")
        self.assertFalse(result.is_error)
        self.assertEqual(result.structured_content["sections"]["holdings"]["status"], "ok")

    def test_errors_reach_the_model(self):
        result = self.call("preview_trade", {"side": "buy", "isin": "not-an-isin", "amount": "10"})
        self.assertTrue(result.is_error)
        self.assertIn("invalid ISIN", result.content[0].text)
        result = self.call("search_securities", {"query": "--help"})
        self.assertTrue(result.is_error)
        result = self.call("scan_securities", {"universe": "custom"})
        self.assertTrue(result.is_error)
        self.assertIn("isins", result.content[0].text)


if __name__ == "__main__":
    unittest.main()
