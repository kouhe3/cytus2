"""``python -m cytus2db`` command line."""

from __future__ import annotations

import argparse
import os
import sys
from pathlib import Path

from .build import build_database
from .errors import BuildError, ValidationError
from .wiki.build import render_wiki

DEFAULT_WORK = os.environ.get("CYTUS2_WORK", "C:/tmp/workspace/cytus2/cytus2_work")
_MAX_REPORTED_ERRORS = 50


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        prog="cytus2db",
        description=(
            "Build the Cytus II canonical DB and render it to wiki artifacts."
        ),
    )
    commands = parser.add_subparsers(dest="command", required=True)
    build = commands.add_parser("build", help="build all entity artifacts")
    build.add_argument(
        "--input",
        default=DEFAULT_WORK,
        help="unpacked input tree (default: $CYTUS2_WORK or %(default)s)",
    )
    build.add_argument(
        "--out",
        default="build",
        help="output directory (default: %(default)s)",
    )
    build.add_argument(
        "--clean",
        action="store_true",
        help="remove db/, db.sqlite and spa/ before writing",
    )
    render = commands.add_parser("render", help="render wiki pages from a built DB")
    render.add_argument(
        "--db",
        default="build",
        help="build directory containing db/*.jsonl (default: %(default)s)",
    )
    render.add_argument(
        "--out",
        default="build/wiki",
        help="wiki output directory (default: %(default)s)",
    )
    render.add_argument(
        "--profile",
        default="wiki/profiles/bili.json",
        help="hand-written wiki profile (default: %(default)s)",
    )
    return parser


def main(argv: list[str] | None = None) -> int:
    parser = build_parser()
    args = parser.parse_args(argv)
    if args.command == "render":
        try:
            result = render_wiki(Path(args.db), Path(args.out), Path(args.profile))
        except BuildError as exc:
            print(f"cytus2db: {exc}", file=sys.stderr)
            return 1
        summary = " ".join(
            f"{name}={count}" for name, count in result["counts"].items()
        )
        print(f"rendered pages: {result['page_count']} ({summary})")
        print(f"wrote pages -> {Path(args.out) / 'pages'}")
        print(f"wrote report -> {Path(args.out) / 'report.json'}")
        return 0

    try:
        counts = build_database(Path(args.input), Path(args.out), clean=args.clean)
    except ValidationError as exc:
        print(f"cytus2db: {exc}", file=sys.stderr)
        for message in exc.messages[:_MAX_REPORTED_ERRORS]:
            print(f"  {message}", file=sys.stderr)
        remaining = len(exc.messages) - _MAX_REPORTED_ERRORS
        if remaining > 0:
            print(f"  ... and {remaining} more error(s)", file=sys.stderr)
        return 1
    except BuildError as exc:
        print(f"cytus2db: {exc}", file=sys.stderr)
        return 1

    summary = " ".join(f"{name}={count}" for name, count in counts.items())
    print(f"entity counts: {summary}")
    print(f"wrote JSONL -> {Path(args.out) / 'db'}")
    print(f"wrote SQLite -> {Path(args.out) / 'db.sqlite'}")
    print(f"wrote SPA projection -> {Path(args.out) / 'spa' / 'data.json'}")
    return 0
