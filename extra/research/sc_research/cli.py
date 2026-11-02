"""Command line front-end: the same research products as JSON, for scripts and agents without MCP."""

from __future__ import annotations

import argparse
import json
import sys
from typing import Any

from .cache import NullCache
from .research import ALL_SECTIONS, Research
from .sc import ScError


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(prog="sc-research", description=__doc__)
    parser.add_argument("--no-cache", action="store_true", help="bypass the local cache")
    sub = parser.add_subparsers(dest="cmd", required=True)

    sub.add_parser("snapshot", help="whole-portfolio snapshot")
    d = sub.add_parser("dossier", help="research dossier for one security")
    d.add_argument("isin")
    d.add_argument("--sections", nargs="+", choices=ALL_SECTIONS)
    d.add_argument("--news-locale", default="en_DE", choices=["en_DE", "de_DE"])
    d.add_argument("--news-days", type=int, default=7)
    s = sub.add_parser("scan", help="triage many securities")
    s.add_argument("--universe", choices=["holdings", "watchlist"], default="holdings")
    s.add_argument("--isin", action="append", dest="isins", help="custom ISINs (repeatable); overrides --universe")
    sub.add_parser("market", help="ECB FX and key rates")
    n = sub.add_parser("news", help="worldwide news via GDELT")
    n.add_argument("query")
    n.add_argument("--days", type=int, default=7)
    sub.add_parser("serve", help="run the MCP server on stdio (needs the `mcp` extra)")
    args = parser.parse_args(argv)

    if args.cmd == "serve":
        from .server import main as serve

        serve()
        return 0

    r = Research(cache=NullCache() if args.no_cache else None)
    try:
        result: Any
        if args.cmd == "snapshot":
            result = r.portfolio_snapshot()
        elif args.cmd == "dossier":
            result = r.security_dossier(args.isin, args.sections, news_locale=args.news_locale, news_days=args.news_days)
        elif args.cmd == "scan":
            result = r.scan(args.isins or r.universe(args.universe))
        elif args.cmd == "market":
            result = r.market_context()
        else:
            result = r.news_global(args.query, args.days)
    except (ScError, ValueError) as exc:
        print(json.dumps({"ok": False, "error": str(exc)}), file=sys.stderr)
        return 1
    json.dump(result, sys.stdout, indent=2, ensure_ascii=False)
    print()
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
