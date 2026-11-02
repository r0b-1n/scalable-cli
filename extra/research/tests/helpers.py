import json
from pathlib import Path
from typing import Any

from sc_research.cache import NullCache
from sc_research.research import Research
from sc_research.sc import ScError

FIXTURES = Path(__file__).parent / "fixtures"


def fixture(name: str) -> Any:
    path = FIXTURES / name
    return json.loads(path.read_text(encoding="utf-8")) if path.suffix == ".json" else path.read_text(encoding="utf-8")


# `sc` argv prefix -> recorded mock output (tests/fixtures/sc/*.json)
SC_ROUTES = {
    ("broker", "quote"): "quote",
    ("broker", "chart", "1y"): "chart_1y",
    ("broker", "chart", "max"): "chart_max",
    ("broker", "holdings"): "holdings",
    ("broker", "transactions"): "transactions",
    ("broker", "savings-plans"): "savings_plans",
    ("broker", "price-alerts"): "price_alerts",
    ("broker", "security-news"): "news",
    ("broker", "watchlist"): "watchlist",
    ("broker", "overview"): "overview",
    ("broker", "cash-breakdown"): "cash",
    ("overnight",): "overnight",
    ("capabilities",): "capabilities",
}


class FakeSc:
    """Replays recorded `sc --json` data; records every argv it was called with."""

    def __init__(self, fail: dict[str, ScError] | None = None) -> None:
        self.calls: list[list[str]] = []
        self.fail = fail or {}

    def __call__(self, args: list[str]) -> Any:
        self.calls.append(list(args))
        key: tuple[str, ...]
        if args[:2] == ["broker", "chart"]:
            key = ("broker", "chart", args[args.index("--timeframe") + 1])
        elif args[0] == "broker":
            key = tuple(args[:2])
        else:
            key = (args[0],)
        name = SC_ROUTES.get(key)
        if name in self.fail:
            raise self.fail[name]
        if name is None:
            raise ScError("unknown_command", f"no fixture for {args}")
        return fixture(f"sc/{name}.json")


def research(fake: FakeSc | None = None) -> Research:
    return Research(sc_run=fake or FakeSc(), cache=NullCache())
