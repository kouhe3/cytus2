"""``python -m cytus2db`` command line."""

from __future__ import annotations

import argparse
import json
import os
import sys
from pathlib import Path

from .build import build_database
from .errors import BuildError, ValidationError
from .verify import DEFAULT_LIVE_API, format_summary, verify_wiki
from .wiki.build import render_wiki
from .wiki.review import DEFAULT_FETCH_API, PAGE_TYPES, render_review

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
    render.add_argument(
        "--patches",
        action="store_true",
        help=(
            "match rendered pages against the site snapshot and emit "
            "parameter-level patches instead of full pages"
        ),
    )
    render.add_argument(
        "--snapshot",
        default="wiki/snapshot",
        help="wiki snapshot directory used by --patches (default: %(default)s)",
    )
    render.add_argument(
        "--batch",
        metavar="FILE|IDS",
        default=None,
        help=(
            "with --patches: review only 3-10 selected pages. FILE has one "
            "title or entity id per line; otherwise IDS is comma-separated. "
            "Reads the local pages cache and writes only "
            "<out>/review/<batch>.md"
        ),
    )
    render.add_argument(
        "--batch-name",
        default=None,
        help="output stem for --batch (default: the selection file stem)",
    )
    render.add_argument(
        "--type",
        dest="page_type",
        choices=PAGE_TYPES,
        default=None,
        help="only keep --batch pages of this type",
    )
    render.add_argument(
        "--fetch-selected",
        action="store_true",
        help=(
            "with --batch: fetch only the selected pages instead of reading "
            "the local cache (never refreshes the whole site)"
        ),
    )
    render.add_argument(
        "--fetch-api",
        default=DEFAULT_FETCH_API,
        help="api.php used by --fetch-selected (default: %(default)s)",
    )
    render.add_argument(
        "--fetch-helper",
        default=None,
        help=(
            "optional command that fetches {url} for --fetch-selected when "
            "the wiki WAF blocks plain HTTP"
        ),
    )
    verify = commands.add_parser(
        "verify",
        help="verify rendered wiki pages, patches and links",
    )
    verify.add_argument(
        "--wiki",
        default="build/wiki",
        help="wiki output directory to verify (default: %(default)s)",
    )
    verify.add_argument(
        "--profile",
        default="wiki/profiles/bili.json",
        help="hand-written wiki profile (default: %(default)s)",
    )
    verify.add_argument(
        "--snapshot",
        default="wiki/snapshot",
        help=(
            "committed site snapshot directory; its optional known_missing.json "
            "lists red-link targets with no page (default: %(default)s)"
        ),
    )
    verify.add_argument(
        "--report",
        default=None,
        help="JSON report path (default: <wiki>/verify.json)",
    )
    verify.add_argument(
        "--live",
        action="store_true",
        help=(
            "opt-in: render sampled full pages through action=parse; "
            "the default run never touches the network"
        ),
    )
    verify.add_argument(
        "--live-sample",
        type=int,
        default=7,
        help="number of full pages to render with --live (default: %(default)s)",
    )
    verify.add_argument(
        "--live-api",
        default=DEFAULT_LIVE_API,
        help="MediaWiki api.php URL used by --live (default: %(default)s)",
    )
    verify.add_argument(
        "--live-helper",
        default=None,
        help=(
            "optional command that fetches {url} for --live when the wiki "
            "WAF blocks plain HTTP"
        ),
    )
    return parser


def main(argv: list[str] | None = None) -> int:
    parser = build_parser()
    args = parser.parse_args(argv)
    if args.command == "render":
        batch_flags = (
            args.page_type is not None
            or args.batch_name is not None
            or args.fetch_selected
            or args.fetch_helper is not None
        )
        if args.batch is not None and not args.patches:
            parser.error("--batch requires --patches")
        if args.batch is None and batch_flags:
            parser.error(
                "--type, --batch-name, --fetch-selected and --fetch-helper "
                "require --batch"
            )
        if args.batch is not None:
            try:
                review = render_review(
                    Path(args.db),
                    Path(args.out),
                    Path(args.profile),
                    Path(args.snapshot),
                    args.batch,
                    page_type=args.page_type,
                    batch_name=args.batch_name,
                    fetch_selected=args.fetch_selected,
                    fetch_api=args.fetch_api,
                    fetch_helper=args.fetch_helper,
                )
            except BuildError as exc:
                print(f"cytus2db: {exc}", file=sys.stderr)
                return 1
            summary = " ".join(
                f"{name}={count}" for name, count in review["counts"].items()
            )
            print(
                f"review batch: {review['page_count']} page(s) ({summary})"
            )
            print(f"wrote review -> {Path(review['review']).as_posix()}")
            excluded = review.get("excluded") or []
            if excluded:
                print(f"filtered out by --type: {', '.join(excluded)}")
            missing = review.get("missing") or []
            if missing:
                print(
                    "not found on the site (treated as new pages): "
                    f"{', '.join(missing)}"
                )
            return 0
        try:
            result = render_wiki(
                Path(args.db),
                Path(args.out),
                Path(args.profile),
                Path(args.snapshot) if args.patches else None,
            )
        except BuildError as exc:
            print(f"cytus2db: {exc}", file=sys.stderr)
            return 1
        summary = " ".join(
            f"{name}={count}" for name, count in result["counts"].items()
        )
        print(f"rendered pages: {result['page_count']} ({summary})")
        if "patch_counts" in result:
            matched = sum(row["matched"] for row in result["patch_counts"].values())
            unmatched = sum(
                row["unmatched"] for row in result["patch_counts"].values()
            )
            conflicts = sum(
                row["conflicts"] for row in result["patch_counts"].values()
            )
            print(
                f"matched: {matched}, patches: {result['patch_count']}, "
                f"unmatched: {unmatched}, conflicts: {conflicts}"
            )
            print(f"wrote patches -> {Path(args.out) / 'patches'}")
        print(f"wrote pages -> {Path(args.out) / 'pages'}")
        print(f"wrote report -> {Path(args.out) / 'report.json'}")
        return 0

    if args.command == "verify":
        try:
            report = verify_wiki(
                Path(args.wiki),
                Path(args.profile),
                Path(args.snapshot),
                live=args.live,
                live_sample=args.live_sample,
                live_api=args.live_api,
                live_helper=args.live_helper,
            )
        except BuildError as exc:
            print(f"cytus2db: {exc}", file=sys.stderr)
            return 1
        report_path = (
            Path(args.report)
            if args.report is not None
            else Path(args.wiki) / "verify.json"
        )
        try:
            report_path.parent.mkdir(parents=True, exist_ok=True)
            report_path.write_text(
                json.dumps(report, ensure_ascii=False, indent=2, sort_keys=True)
                + "\n",
                encoding="utf-8",
                newline="\n",
            )
        except OSError as exc:
            print(f"cytus2db: cannot write {report_path}: {exc}", file=sys.stderr)
            return 1
        print(format_summary(report))
        print(f"wrote verification report -> {report_path}")
        return 0 if report["ok"] else 1

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
