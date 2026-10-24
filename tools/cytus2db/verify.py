"""Offline verification of rendered wiki artifacts (ticket #13).

``python -m cytus2db verify`` reads ``<wiki>/report.json`` plus the rendered
``pages/`` and ``patches/`` trees, the hand-written profile and the committed
site snapshot.  The default run is offline.  ``--live`` is opt-in and renders
sampled full pages through the MediaWiki ``action=parse`` API.

The checks deliberately consume artifacts, not renderer internals: an emitted
parameter is judged against the merged profile, a patch against the snapshot
page it claims to update, and a link against the snapshot title set.
"""

from __future__ import annotations

import html
import json
import re
import shlex
import subprocess
import urllib.error
import urllib.parse
import urllib.request
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any, Callable, Iterable, Mapping

from .errors import BuildError, InputError
from .wiki.bili import Profile, TemplateSpec, load_profile
from .wiki.patches import (
    PatchError,
    SnapshotPage,
    load_snapshot,
    template_parameters,
)
from .wiki.titles import IGNORED_TARGET_PREFIXES, normalise_title

DEFAULT_LIVE_API = "https://wiki.biligame.com/cytus2/api.php"

# A generated full page belongs to exactly one page family.  Keeping this
# mapping in the verifier (rather than reading it back from the artifact) is
# what makes the category check independent of the renderer.
PAGE_TYPE_CATEGORY = {
    "song": "song",
    "character": "character",
    "pack": "pack",
    "im_post": "im_post",
    "oa_document": "oa",
    "os_log": "os",
    "gallery_item": "gallery",
}

_IGNORED_EXTERNAL_PREFIXES = (
    "http://",
    "https://",
    "//",
    "mailto:",
    "ftp://",
)
_LINK_RE = re.compile(r"\[\[([^\[\]\n]+?)\]\]")
_COMMENT_RE = re.compile(r"<!--.*?-->", re.S)
_NOWIKI_RE = re.compile(r"<nowiki\b.*?</nowiki>", re.S | re.I)
_CATEGORY_RE = re.compile(r"\[\[\s*([^\[\]|:]+):\s*([^\]|]+)")
_ERROR_PATTERNS = (
    ("class_error", re.compile(r'class\s*=\s*["\']error["\']', re.I)),
    ("template_error", re.compile(r"模板错误")),
    ("template_error_en", re.compile(r"template\s+error", re.I)),
    ("lua_error", re.compile(r"lua\s+error", re.I)),
    ("script_error", re.compile(r"脚本错误")),
    ("unexpanded_parameter", re.compile(r"\{\{\{")),
)
_REQUIRED_REPORT_FIELDS = (
    "entity",
    "page_type",
    "title",
    "title_source",
    "template",
    "emitted",
    "omitted",
    "conflicts",
)


@dataclass
class _Check:
    errors: list[str] = field(default_factory=list)
    details: dict[str, Any] = field(default_factory=dict)

    def fail(self, message: str) -> None:
        self.errors.append(message)

    def as_dict(self) -> dict[str, Any]:
        return {
            "ok": not self.errors,
            "errors": list(self.errors),
            "details": self.details,
        }


def verify_wiki(
    wiki_dir: Path | str,
    profile_path: Path | str,
    snapshot_dir: Path | str,
    *,
    live: bool = False,
    live_sample: int = 7,
    live_api: str = DEFAULT_LIVE_API,
    live_helper: str | None = None,
    fetcher: Callable[[str, Mapping[str, str]], str] | None = None,
) -> dict[str, Any]:
    """Verify one rendered wiki output tree and return the JSON-ready report."""
    wiki = Path(wiki_dir)
    if live_sample < 1:
        raise InputError("live sample must be at least 1")
    profile = load_profile(profile_path)
    snapshot = load_snapshot(snapshot_dir)
    pages_available = snapshot.pages_available
    raw_report = _read_report(wiki)
    raw_pages = raw_report.get("pages")
    if not isinstance(raw_pages, list):
        raise InputError(f"{wiki / 'report.json'}: pages must be a list")

    article_titles = {normalise_title(title) for title in snapshot.articles}
    redirect_titles = {normalise_title(title) for title in snapshot.redirects}
    snapshot_pages: dict[str, list[SnapshotPage]] = {}
    for page in snapshot.pages:
        snapshot_pages.setdefault(normalise_title(page.title), []).append(page)
    # Full pages emitted by this run will exist once it is published, so a
    # link to one is not a red link even though the snapshot predates it.
    # Counted up front: two full pages with the same title key would publish
    # as one page, which is the overwrite this ticket forbids.
    generated_counts: dict[str, int] = {}
    for raw in raw_pages:
        if not isinstance(raw, dict):
            continue
        raw_title = raw.get("title")
        if raw.get("file") is None or not isinstance(raw_title, str) or not raw_title:
            continue
        key = normalise_title(raw_title)
        if key:
            generated_counts[key] = generated_counts.get(key, 0) + 1
    generated_titles = set(generated_counts)
    duplicate_titles = {
        key for key, count in generated_counts.items() if count > 1
    }
    known_missing = _load_known_missing(snapshot_dir)

    entries: list[dict[str, Any]] = []
    rendered: list[tuple[dict[str, Any], str]] = []
    for index, raw in enumerate(raw_pages):
        entry, text = _verify_entry(
            raw,
            index=index,
            wiki=wiki,
            profile=profile,
            article_titles=article_titles,
            redirect_titles=redirect_titles,
            snapshot_pages=snapshot_pages,
            generated_titles=generated_titles,
            duplicate_titles=duplicate_titles,
            known_missing=known_missing,
            pages_available=pages_available,
        )
        entries.append(entry)
        if text is not None:
            rendered.append((entry, text))

    global_checks = _verify_report_shape(raw_pages, raw_report)
    global_checks.details["snapshot_pages_available"] = pages_available
    known_check = _verify_known_missing(
        known_missing, article_titles, redirect_titles
    )
    global_checks.errors.extend(known_check.errors)
    global_checks.details["known_missing"] = known_check.details
    artifact_check = _verify_artifacts(wiki, entries)
    upload_check = _verify_uploads(wiki, entries)
    global_checks.errors.extend(upload_check.errors)
    global_checks.details["uploads"] = upload_check.details

    live_report = {"enabled": False}
    if live:
        live_report = _verify_live(
            rendered,
            sample=live_sample,
            api_url=live_api,
            helper=live_helper,
            fetcher=fetcher,
        )
        for entry, text in rendered:
            if entry["entity"] not in live_report["sampled_entities"]:
                continue
            result = live_report["results"].get(entry["entity"])
            check = _Check()
            if result is None:
                check.fail("sampled page was not rendered")
            else:
                if result.get("error"):
                    check.fail(f"live render failed: {result['error']}")
                for marker in result["markers"]:
                    check.fail(
                        f"template error marker {marker['marker']!r}: "
                        f"{marker['context']}"
                    )
            check.details = {
                "title": entry["title"],
                "markers": [] if result is None else result["markers"],
            }
            entry["checks"]["live"] = check.as_dict()
        live_report.pop("results", None)
        live_report.pop("sampled_entities", None)
    else:
        for entry in entries:
            entry["checks"].pop("live", None)

    for entry in entries:
        entry["ok"] = all(check["ok"] for check in entry["checks"].values())

    checks = _aggregate_checks(entries, global_checks, artifact_check)
    checks["uploads"] = not upload_check.errors
    if live:
        checks["live"] = all(
            entry["checks"]["live"]["ok"]
            for entry in entries
            if "live" in entry["checks"]
        )
    else:
        checks["live"] = None

    counts = _counts(entries, artifact_check, upload_check)
    red_links = _red_link_index(entries)
    known_red_links = _known_red_link_index(entries, known_missing)
    report = {
        "schema_version": 1,
        "kind": "wiki_verify",
        "wiki": wiki.as_posix(),
        "profile": Path(profile_path).as_posix(),
        "snapshot": Path(snapshot_dir).as_posix(),
        "live": live_report,
        "page_count": len(entries),
        "counts": counts,
        "checks": checks,
        "artifact_check": artifact_check.as_dict(),
        "upload_check": upload_check.as_dict(),
        "report_check": global_checks.as_dict(),
        "pages": entries,
        "red_links": red_links,
        "known_red_links": known_red_links,
        "errors": list(artifact_check.errors) + list(global_checks.errors),
        "ok": False,
    }
    report["ok"] = _overall_ok(checks, report["errors"])
    return report


def format_summary(report: Mapping[str, Any], *, limit: int = 20) -> str:
    """Render the human-readable summary printed by the CLI."""
    counts = report["counts"]
    checks = report["checks"]

    def mark(name: str) -> str:
        value = checks.get(name)
        if value is None:
            return "SKIP"
        return "PASS" if value else "FAIL"

    lines = [
        f"wiki verify: {report['wiki']}",
        (
            f"pages: {counts['pages']} "
            f"({counts['full_pages']} full, {counts['patches']} patches, "
            f"{counts['matched']} matched)"
        ),
        (
            f"  template params: {mark('template_params')} "
            f"({counts['unknown_params']} unknown, "
            f"{counts['empty_params']} empty)"
        ),
        (
            f"  required params: {mark('required_params')} "
            f"({counts['missing_required']} missing)"
        ),
        (
            f"  conditional params: {mark('conditional_params')} "
            f"({counts['conditional_violations']} violation(s))"
        ),
        (
            f"  patch targets: {mark('patch_target')} "
            f"({counts['patch_targets_checked']} checked, "
            f"{counts['patch_target_missing']} missing, "
            f"{counts['patch_target_redirect']} redirect(s))"
        ),
        (
            f"  patch diffs: {mark('patch_diff')} "
            f"({counts['patch_non_differing']} non-differing)"
        ),
        f"  page output: {mark('page_output')}",
        (
            f"  categories: {mark('category')} "
            f"({counts['category_failures']} page(s) missing the expected category)"
        ),
        (
            f"  red links: {mark('links')} "
            f"{counts['red_links']} occurrence(s) / "
            f"{counts['red_link_targets']} target(s) "
            f"(checked {counts['links_checked']}: "
            f"{counts['links_articles']} article, "
            f"{counts['links_redirects']} redirect, "
            f"{counts['links_generated']} new page)"
        ),
        (
            f"  known missing: {counts['known_red_links']} occurrence(s) / "
            f"{counts['known_red_link_targets']} target(s) "
            "(explicitly listed in snapshot/known_missing.json)"
        ),
        (
            f"  uploads: {mark('uploads')} "
            f"({counts['upload_files']} file(s), "
            f"{counts['upload_missing']} not on the site)"
        ),
        f"  artifacts: {mark('artifacts')}",
    ]
    live = report.get("live") or {}
    if not live.get("enabled"):
        lines.append("  live: skipped (offline; pass --live to render samples)")
    elif live.get("skipped"):
        lines.append(f"  live: skipped ({live['skipped']})")
    else:
        lines.append(
            f"  live: {mark('live')} "
            f"({live['checked']} page(s), {live['failures']} failure(s))"
        )

    for target in report.get("red_links", [])[:limit]:
        sources = ", ".join(target["sources"][:3])
        if target["count"] > 3:
            sources += ", ..."
        lines.append(f"    RED [[{target['target']}]] <- {sources}")
    remaining = len(report.get("red_links", [])) - limit
    if remaining > 0:
        lines.append(f"    ... and {remaining} more red-link target(s)")
    for target in report.get("known_red_links", [])[:limit]:
        sources = ", ".join(target["sources"][:3])
        if target["count"] > 3:
            sources += ", ..."
        lines.append(
            f"    KNOWN MISSING [[{target['target']}]] <- {sources}"
            f" ({target.get('reason', '')})"
        )

    failures: list[str] = []
    for entry in report.get("pages", []):
        for name, check in entry.get("checks", {}).items():
            if check.get("ok"):
                continue
            for error in check.get("errors", []):
                failures.append(f"  ! {entry.get('entity')} [{name}] {error}")
    for error in report.get("errors", []):
        failures.append(f"  ! {error}")
    if failures:
        lines.append("failed checks:")
        lines.extend(failures[:limit])
        remaining_failures = len(failures) - limit
        if remaining_failures > 0:
            lines.append(f"  ... and {remaining_failures} more failed check(s)")

    lines.append("result: PASS" if report.get("ok") else "result: FAIL")
    return "\n".join(lines)


# --------------------------------------------------------------- report shape
def _read_report(wiki: Path) -> dict[str, Any]:
    path = wiki / "report.json"
    if not path.is_file():
        raise InputError(f"wiki report not found: {path}")
    try:
        data = json.loads(path.read_text(encoding="utf-8-sig"))
    except OSError as exc:
        raise InputError(f"cannot read {path}: {exc}") from exc
    except json.JSONDecodeError as exc:
        raise InputError(f"invalid JSON in {path}: {exc}") from exc
    if not isinstance(data, dict):
        raise InputError(f"{path}: report must be a JSON object")
    return data


def _load_known_missing(snapshot_dir: Path | str) -> dict[str, dict[str, str]]:
    """Load the explicit list of red-link targets that have no page at all.

    The file is optional.  It exists so that a target the game data names but
    the wiki never created is *listed* rather than silently tolerated; every
    entry needs a human-written reason.
    """
    path = Path(snapshot_dir) / "known_missing.json"
    if not path.is_file():
        return {}
    try:
        data = json.loads(path.read_text(encoding="utf-8-sig"))
    except OSError as exc:
        raise InputError(f"cannot read {path}: {exc}") from exc
    except json.JSONDecodeError as exc:
        raise InputError(f"invalid JSON in {path}: {exc}") from exc
    if not isinstance(data, dict):
        raise InputError(f"{path}: document must be a JSON object")
    titles = data.get("titles")
    if not isinstance(titles, list):
        raise InputError(f"{path}: titles must be a list")
    result: dict[str, dict[str, str]] = {}
    for index, entry in enumerate(titles):
        if not isinstance(entry, dict):
            raise InputError(f"{path}: titles[{index}] must be an object")
        title = entry.get("title")
        reason = entry.get("reason")
        if not isinstance(title, str) or not title.strip():
            raise InputError(f"{path}: titles[{index}].title must be a string")
        if not isinstance(reason, str) or not reason.strip():
            raise InputError(f"{path}: titles[{index}].reason must be a string")
        result[normalise_title(title)] = {"title": title, "reason": reason}
    return result


def _verify_known_missing(
    known_missing: Mapping[str, Mapping[str, str]],
    article_titles: set[str],
    redirect_titles: set[str],
) -> _Check:
    """Fail when an entry in the hand-written list has since gained a page."""
    check = _Check()
    stale: list[str] = []
    for key, record in sorted(known_missing.items()):
        if key in article_titles or key in redirect_titles:
            stale.append(record.get("title", key))
            check.fail(
                f"known-missing title {record.get('title', key)!r} exists in "
                "the snapshot; remove it from known_missing.json"
            )
    check.details = {"checked": len(known_missing), "stale": stale}
    return check


def _verify_report_shape(
    raw_pages: list[Any], raw_report: Mapping[str, Any]
) -> _Check:
    check = _Check()
    page_count = raw_report.get("page_count")
    if not isinstance(page_count, int):
        check.fail("report.page_count must be an integer")
    elif page_count != len(raw_pages):
        check.fail(
            f"report.page_count is {page_count}, but pages has {len(raw_pages)} entries"
        )

    counts = raw_report.get("counts")
    if not isinstance(counts, dict):
        check.fail("report.counts must be an object")
    else:
        computed: dict[str, int] = {}
        for raw in raw_pages:
            page_type = raw.get("page_type") if isinstance(raw, dict) else None
            if isinstance(page_type, str):
                computed[page_type] = computed.get(page_type, 0) + 1
        if dict(sorted(computed.items())) != dict(sorted(counts.items())):
            check.fail(
                "report.counts does not match the page entries: "
                f"{counts!r} != {computed!r}"
            )

    seen: set[str] = set()
    duplicates: list[str] = []
    for raw in raw_pages:
        if not isinstance(raw, dict):
            continue
        entity = raw.get("entity")
        if not isinstance(entity, str):
            continue
        if entity in seen:
            duplicates.append(entity)
        seen.add(entity)
    if duplicates:
        check.fail(f"duplicate report entities: {sorted(duplicates)[:10]}")
    check.details = {
        "pages": len(raw_pages),
        "page_count": page_count,
        "counts": counts,
    }
    return check


def _verify_artifacts(wiki: Path, entries: Iterable[Mapping[str, Any]]) -> _Check:
    check = _Check()
    expected: set[str] = set()
    for entry in entries:
        for key in ("file", "patch"):
            relative = entry.get(key)
            if isinstance(relative, str) and relative:
                expected.add(Path(relative).as_posix())

    actual_pages = {
        path.relative_to(wiki).as_posix()
        for path in (wiki / "pages").rglob("*")
        if path.is_file()
    }
    actual_patches = {
        path.relative_to(wiki).as_posix()
        for path in (wiki / "patches").rglob("*")
        if path.is_file()
    }
    actual = actual_pages | actual_patches
    orphans = sorted(actual - expected)
    missing = sorted(expected - actual)
    if orphans:
        check.fail(f"unreported artifact file(s): {orphans[:10]}")
    if missing:
        check.fail(f"report references missing file(s): {missing[:10]}")
    check.details = {
        "pages": len(actual_pages),
        "patches": len(actual_patches),
        "orphans": orphans,
        "missing": missing,
    }
    return check


def _verify_uploads(
    wiki: Path, entries: Iterable[Mapping[str, Any]]
) -> _Check:
    """Check ``uploads.json`` against every ``[[File:…]]`` the pages emit.

    File links are not red links (the verifier ignores them), so the manifest
    is where upload work is tracked.  A referenced file missing from the
    manifest is a build bug and fails; a manifest entry with
    ``status="missing"`` is reported as a gap but does not fail, because the
    file may simply not have been uploaded yet.
    """
    check = _Check()
    referenced: dict[str, str] = {}
    for entry in entries:
        links = entry.get("checks", {}).get("links", {}).get("details", {})
        for name in links.get("file_targets", []):
            referenced.setdefault(normalise_title(name), str(name))
    if not referenced:
        check.details = {
            "referenced": 0,
            "manifest": 0,
            "missing_from_manifest": [],
            "missing": [],
        }
        return check

    path = wiki / "uploads.json"
    if not path.is_file():
        check.fail(
            f"upload manifest not found: {path} "
            f"({len(referenced)} file link(s) referenced)"
        )
        check.details = {
            "referenced": len(referenced),
            "manifest": 0,
            "missing_from_manifest": sorted(referenced.values()),
            "missing": [],
        }
        return check
    data = _read_json_object(path)
    files = data.get("files")
    if not isinstance(files, list):
        check.fail(f"{path}: files must be a list")
        files = []
    manifest: dict[str, Mapping[str, Any]] = {}
    for index, item in enumerate(files):
        if not isinstance(item, dict):
            check.fail(f"{path}: files[{index}] must be an object")
            continue
        name = item.get("name")
        status = item.get("status")
        if not isinstance(name, str) or not name.strip():
            check.fail(f"{path}: files[{index}].name must be a non-empty string")
            continue
        if status not in ("existing", "missing"):
            check.fail(
                f"{path}: files[{index}].status must be 'existing' or 'missing'"
            )
        manifest.setdefault(normalise_title(name), item)

    missing_keys = sorted(set(referenced) - set(manifest))
    missing_from_manifest = [referenced[key] for key in missing_keys]
    for name in missing_from_manifest:
        check.fail(
            f"{path}: referenced file {name!r} is not in the manifest"
        )
    missing = sorted(
        str(item.get("name"))
        for item in manifest.values()
        if item.get("status") == "missing"
    )
    check.details = {
        "referenced": len(referenced),
        "manifest": len(manifest),
        "missing_from_manifest": missing_from_manifest,
        "missing": missing,
    }
    return check


def _read_json_object(path: Path) -> dict[str, Any]:
    try:
        data = json.loads(path.read_text(encoding="utf-8-sig"))
    except OSError as exc:
        raise InputError(f"cannot read {path}: {exc}") from exc
    except json.JSONDecodeError as exc:
        raise InputError(f"invalid JSON in {path}: {exc}") from exc
    if not isinstance(data, dict):
        raise InputError(f"{path}: must be a JSON object")
    return data


def _aggregate_checks(
    entries: Iterable[Mapping[str, Any]],
    global_checks: _Check,
    artifact_check: _Check,
) -> dict[str, bool | None]:
    names = (
        "report",
        "template_params",
        "required_params",
        "conditional_params",
        "patch_target",
        "patch_diff",
        "page_output",
        "category",
        "links",
    )
    result: dict[str, bool | None] = {}
    materialized = list(entries)
    for name in names:
        values = [
            entry["checks"][name]["ok"]
            for entry in materialized
            if name in entry["checks"]
        ]
        if name == "report":
            values.append(global_checks.as_dict()["ok"])
        result[name] = all(values)
    result["artifacts"] = not artifact_check.errors
    return result


def _overall_ok(checks: Mapping[str, bool | None], errors: Iterable[str]) -> bool:
    if list(errors):
        return False
    return all(value for value in checks.values() if value is not None)


def _counts(
    entries: Iterable[Mapping[str, Any]],
    artifact_check: _Check,
    upload_check: _Check,
) -> dict[str, Any]:
    materialized = list(entries)
    counts: dict[str, Any] = {
        "pages": len(materialized),
        "full_pages": sum(1 for entry in materialized if entry.get("file")),
        "patches": sum(1 for entry in materialized if entry.get("patch")),
        "matched": sum(1 for entry in materialized if entry.get("matched") is True),
        "unmatched": sum(
            1 for entry in materialized if entry.get("matched") is False
        ),
        "unknown_params": 0,
        "patch_unknown_params": 0,
        "empty_params": 0,
        "missing_required": 0,
        "conditional_violations": 0,
        "patch_targets_checked": 0,
        "patch_target_missing": 0,
        "patch_target_redirect": 0,
        "patch_template_mismatch": 0,
        "patch_non_differing": 0,
        "category_failures": 0,
        "links_checked": 0,
        "links_articles": 0,
        "links_redirects": 0,
        "links_generated": 0,
        "red_links": 0,
        "red_link_targets": 0,
        "known_red_links": 0,
        "known_red_link_targets": 0,
        "ignored_links": 0,
        "ignored_file_links": 0,
        "ignored_category_links": 0,
        "ignored_external_links": 0,
        "ignored_anchor_links": 0,
        "orphan_files": len(artifact_check.details.get("orphans", [])),
        "upload_files": 0,
        "upload_missing": 0,
    }
    counts["upload_files"] = int(upload_check.details.get("referenced", 0))
    counts["upload_missing"] = len(upload_check.details.get("missing", []))
    for entry in materialized:
        checks = entry["checks"]
        params = checks["template_params"]["details"]
        counts["unknown_params"] += len(params.get("unknown", []))
        counts["patch_unknown_params"] += sum(
            1 for item in params.get("unknown", []) if item.get("source") == "patch"
        )
        counts["empty_params"] += len(params.get("empty", []))
        counts["missing_required"] += len(
            checks["required_params"]["details"].get("missing", [])
        )
        counts["conditional_violations"] += len(
            checks["conditional_params"]["details"].get("violations", [])
        )
        status = checks["patch_target"]["details"].get("status")
        if status not in (None, "not_applicable"):
            counts["patch_targets_checked"] += 1
        if status == "missing":
            counts["patch_target_missing"] += 1
        elif status == "redirect":
            counts["patch_target_redirect"] += 1
        elif status in ("template_mismatch", "no_template_data"):
            counts["patch_template_mismatch"] += 1
        counts["patch_non_differing"] += len(
            checks["patch_diff"]["details"].get("non_differing", [])
        )
        if not checks["category"]["ok"]:
            counts["category_failures"] += 1
        links = checks["links"]["details"]
        counts["links_checked"] += links.get("checked", 0)
        counts["links_articles"] += links.get("articles", 0)
        counts["links_redirects"] += links.get("redirects", 0)
        counts["links_generated"] += links.get("generated", 0)
        counts["known_red_links"] += len(links.get("known_missing", []))
        counts["red_links"] += sum(1 for item in _flatten_missing(links))
        ignored = links.get("ignored", {})
        counts["ignored_links"] += sum(ignored.values())
        counts["ignored_file_links"] += ignored.get("file", 0)
        counts["ignored_category_links"] += ignored.get("category", 0)
        counts["ignored_external_links"] += ignored.get("external", 0)
        counts["ignored_anchor_links"] += ignored.get("anchor", 0)
    counts["red_link_targets"] = len(_red_link_index(materialized))
    counts["known_red_link_targets"] = len(
        _known_red_link_index(materialized, {})
    )
    return counts


def _flatten_missing(links: Mapping[str, Any]) -> list[str]:
    return [str(item) for item in links.get("missing", [])]


def _red_link_index(entries: Iterable[Mapping[str, Any]]) -> list[dict[str, Any]]:
    index: dict[str, dict[str, Any]] = {}
    for entry in entries:
        links = entry["checks"]["links"]["details"]
        for item in links.get("missing", []):
            target = str(item)
            record = index.setdefault(
                target, {"target": target, "count": 0, "sources": []}
            )
            record["count"] += 1
            source = entry.get("entity")
            if isinstance(source, str) and source not in record["sources"]:
                record["sources"].append(source)
    return [index[target] for target in sorted(index)]


def _known_red_link_index(
    entries: Iterable[Mapping[str, Any]],
    known_missing: Mapping[str, Mapping[str, str]],
) -> list[dict[str, Any]]:
    index: dict[str, dict[str, Any]] = {}
    for entry in entries:
        links = entry["checks"]["links"]["details"]
        for item in links.get("known_missing", []):
            target = str(item)
            record = index.setdefault(
                target,
                {
                    "target": target,
                    "count": 0,
                    "sources": [],
                    "reason": known_missing.get(target, {}).get("reason", ""),
                },
            )
            record["count"] += 1
            source = entry.get("entity")
            if isinstance(source, str) and source not in record["sources"]:
                record["sources"].append(source)
    return [index[target] for target in sorted(index)]


# ------------------------------------------------------------------ one page
def _verify_entry(
    raw: Any,
    *,
    index: int,
    wiki: Path,
    profile: Profile,
    article_titles: set[str],
    redirect_titles: set[str],
    snapshot_pages: Mapping[str, list[SnapshotPage]],
    generated_titles: set[str],
    duplicate_titles: set[str],
    known_missing: Mapping[str, Mapping[str, str]],
    pages_available: bool,
) -> tuple[dict[str, Any], str | None]:
    report_check = _Check()
    params_check = _Check()
    required_check = _Check()
    conditional_check = _Check()
    patch_target_check = _Check()
    patch_diff_check = _Check()
    page_output_check = _Check()
    category_check = _Check()
    links_check = _Check()

    if not isinstance(raw, dict):
        report_check.fail(f"page entry {index} must be an object")
        raw = {}
    entity = raw.get("entity")
    page_type = raw.get("page_type")
    title = raw.get("title")
    title_source = raw.get("title_source")
    template_name = raw.get("template")
    emitted = _string_list(raw.get("emitted"))
    omitted = _dict_list(raw.get("omitted"))
    conflicts = _dict_list(raw.get("conflicts"))
    matched = raw.get("matched") if isinstance(raw.get("matched"), bool) else None

    for name in _REQUIRED_REPORT_FIELDS:
        if name not in raw:
            report_check.fail(f"report entry is missing {name!r}")
    for name, value in (
        ("entity", entity),
        ("page_type", page_type),
        ("title", title),
        ("title_source", title_source),
        ("template", template_name),
    ):
        if not isinstance(value, str) or not value:
            report_check.fail(f"report entry {name!r} must be a non-empty string")
    if "emitted" in raw and not isinstance(raw.get("emitted"), list):
        report_check.fail("report entry 'emitted' must be a list")
    if "omitted" in raw and not isinstance(raw.get("omitted"), list):
        report_check.fail("report entry 'omitted' must be a list")
    if "conflicts" in raw and not isinstance(raw.get("conflicts"), list):
        report_check.fail("report entry 'conflicts' must be a list")

    spec = profile.pages.get(page_type) if isinstance(page_type, str) else None
    template: TemplateSpec | None = None
    if spec is None:
        report_check.fail(f"no profile page rule for page type {page_type!r}")
    else:
        template = profile.templates.get(spec.template)
        if template is None:
            report_check.fail(f"profile template {spec.template!r} is missing")
        elif template_name != template.name:
            report_check.fail(
                f"report template {template_name!r} != profile template "
                f"{template.name!r}"
            )

    file_relative = raw.get("file")
    patch_relative = raw.get("patch")
    page_text: str | None = None
    page_params: dict[str, str] | None = None

    if file_relative is not None:
        path, error = _artifact_path(wiki, file_relative, "file")
        if error:
            page_output_check.fail(error)
        elif not path.is_file():
            page_output_check.fail(f"full page not found: {file_relative}")
        else:
            try:
                page_text = path.read_text(encoding="utf-8")
            except OSError as exc:
                page_output_check.fail(f"cannot read {file_relative}: {exc}")

    if page_text is not None and template is not None:
        try:
            page_params = template_parameters(page_text, template.name)
        except PatchError as exc:
            params_check.fail(str(exc))

    patch_data: dict[str, Any] | None = None
    if patch_relative is not None:
        path, error = _artifact_path(wiki, patch_relative, "patch")
        if error:
            patch_target_check.fail(error)
        elif not path.is_file():
            patch_target_check.fail(f"patch not found: {patch_relative}")
        else:
            try:
                loaded = json.loads(path.read_text(encoding="utf-8-sig"))
            except OSError as exc:
                patch_target_check.fail(f"cannot read {patch_relative}: {exc}")
            except json.JSONDecodeError as exc:
                patch_target_check.fail(f"invalid JSON in {patch_relative}: {exc}")
            else:
                if isinstance(loaded, dict):
                    patch_data = loaded
                else:
                    patch_target_check.fail(
                        f"{patch_relative}: patch must be a JSON object"
                    )

    patch_params: dict[str, str] = {}
    patch_existing: SnapshotPage | None = None
    if patch_data is not None:
        if pages_available:
            patch_params, patch_existing = _verify_patch_target(
                patch_data,
                patch_relative=str(patch_relative),
                entry_title=title if isinstance(title, str) else "",
                template=template,
                article_titles=article_titles,
                redirect_titles=redirect_titles,
                snapshot_pages=snapshot_pages,
                check=patch_target_check,
            )
        else:
            raw_params = patch_data.get("params")
            if isinstance(raw_params, dict) and all(
                isinstance(name, str) and isinstance(value, str)
                for name, value in raw_params.items()
            ):
                patch_params = dict(raw_params)
            else:
                patch_target_check.fail(
                    f"{patch_relative}: params must map strings to strings"
                )
            patch_target_check.details = {
                "status": "unavailable",
                "reason": "snapshot/pages.json is absent (local cache)",
            }

    _verify_parameters(
        template,
        page_params=page_params,
        patch_params=patch_params,
        emitted=emitted,
        check=params_check,
    )
    _verify_required(
        template,
        page_params=page_params,
        patch_params=patch_params,
        patch_existing=patch_existing,
        patch_title=title if isinstance(title, str) else "",
        patch_present=patch_data is not None,
        snapshot_pages=snapshot_pages,
        check=required_check,
    )
    _verify_conditionals(
        template,
        page_params=page_params,
        patch_params=patch_params,
        omitted=omitted,
        check=conditional_check,
    )
    _verify_patch_diff(
        template,
        patch_params=patch_params,
        patch_existing=patch_existing,
        check=patch_diff_check,
    )
    _verify_page_output(
        file_relative=file_relative,
        patch_relative=patch_relative,
        matched=matched,
        title=title if isinstance(title, str) else "",
        article_titles=article_titles,
        redirect_titles=redirect_titles,
        duplicate_titles=duplicate_titles,
        page_text=page_text,
        patch_data=patch_data,
        check=page_output_check,
    )
    _verify_category(
        page_text=page_text,
        page_type=page_type if isinstance(page_type, str) else "",
        profile=profile,
        check=category_check,
    )
    _verify_links(
        page_text=page_text,
        patch_params=patch_params,
        article_titles=article_titles,
        redirect_titles=redirect_titles,
        generated_titles=generated_titles,
        known_missing=known_missing,
        check=links_check,
    )

    entry: dict[str, Any] = {
        "entity": entity if isinstance(entity, str) else f"<page {index}>",
        "page_type": page_type if isinstance(page_type, str) else "",
        "title": title if isinstance(title, str) else "",
        "title_source": title_source if isinstance(title_source, str) else "",
        "template": template_name if isinstance(template_name, str) else "",
        "matched": matched,
        "file": file_relative if isinstance(file_relative, str) else None,
        "patch": patch_relative if isinstance(patch_relative, str) else None,
        "categories": _string_list(raw.get("categories")),
        "emitted": emitted,
        "omitted": omitted,
        "conflicts": conflicts,
        "checks": {
            "report": report_check.as_dict(),
            "template_params": params_check.as_dict(),
            "required_params": required_check.as_dict(),
            "conditional_params": conditional_check.as_dict(),
            "patch_target": patch_target_check.as_dict(),
            "patch_diff": patch_diff_check.as_dict(),
            "page_output": page_output_check.as_dict(),
            "category": category_check.as_dict(),
            "links": links_check.as_dict(),
        },
    }
    return entry, page_text


def _artifact_path(
    wiki: Path, relative: Any, kind: str
) -> tuple[Path, str | None]:
    if not isinstance(relative, str) or not relative.strip():
        return wiki, f"report {kind} path must be a non-empty string"
    path = Path(relative)
    if path.is_absolute() or ".." in path.parts:
        return wiki, f"report {kind} path escapes the wiki directory: {relative!r}"
    return wiki / path, None


def _verify_parameters(
    template: TemplateSpec | None,
    *,
    page_params: Mapping[str, str] | None,
    patch_params: Mapping[str, str],
    emitted: list[str],
    check: _Check,
) -> None:
    unknown: list[dict[str, str]] = []
    empty: list[dict[str, str]] = []
    mismatch: list[str] = []
    if template is not None and page_params is not None:
        for name in page_params:
            if name not in template.params:
                unknown.append({"param": name, "source": "page"})
        for name, value in page_params.items():
            meta = template.params.get(name)
            if not value.strip() and not (meta is not None and meta.allow_empty):
                empty.append({"param": name, "source": "page"})
        actual = set(page_params)
        reported = set(emitted)
        if actual != reported:
            mismatch.append(
                "page parameter set differs from report.emitted "
                f"(only page={sorted(actual - reported)}, "
                f"only report={sorted(reported - actual)})"
            )
    if template is not None and patch_params:
        for name, value in patch_params.items():
            if name not in template.params:
                unknown.append({"param": name, "source": "patch"})
            meta = template.params.get(name)
            if not value.strip() and not (meta is not None and meta.allow_empty):
                empty.append({"param": name, "source": "patch"})
        unreported = sorted(set(patch_params) - set(emitted))
        if emitted and unreported:
            check.fail(
                "patch parameter(s) missing from report.emitted: "
                f"{unreported}"
            )
    for item in unknown:
        check.fail(
            f"unknown {item['source']} parameter {item['param']!r} "
            f"is not in the profile template"
        )
    for item in empty:
        check.fail(f"empty {item['source']} parameter {item['param']!r}")
    for message in mismatch:
        check.fail(message)
    check.details = {
        "unknown": unknown,
        "empty": empty,
        "emitted_mismatch": mismatch,
        "checked": sorted(page_params) if page_params is not None else [],
    }


def _missing_required(
    template: TemplateSpec, params: Mapping[str, str]
) -> list[str]:
    return [
        name
        for name, meta in template.params.items()
        if meta.required and not params.get(name, "").strip()
    ]


def _verify_required(
    template: TemplateSpec | None,
    *,
    page_params: Mapping[str, str] | None,
    patch_params: Mapping[str, str],
    patch_existing: SnapshotPage | None,
    patch_title: str,
    patch_present: bool,
    snapshot_pages: Mapping[str, list[SnapshotPage]],
    check: _Check,
) -> None:
    missing: list[str] = []
    basis = "none"
    if template is not None and page_params is not None:
        missing = _missing_required(template, page_params)
        basis = "page"
    elif template is not None and patch_present:
        if patch_existing is not None:
            merged = dict(patch_existing.params)
            merged.update(patch_params)
            missing = _missing_required(template, merged)
            basis = "snapshot+patch"
        else:
            candidates = [
                page
                for page in snapshot_pages.get(
                    normalise_title(patch_title), []
                )
                if page.template == template.name
            ]
            if candidates:
                merged = dict(candidates[0].params)
                merged.update(patch_params)
                missing = _missing_required(template, merged)
                basis = "snapshot+patch"
    for name in missing:
        check.fail(f"required parameter {name!r} is missing or empty")
    check.details = {"missing": missing, "basis": basis}


def _verify_conditionals(
    template: TemplateSpec | None,
    *,
    page_params: Mapping[str, str] | None,
    patch_params: Mapping[str, str],
    omitted: list[dict[str, Any]],
    check: _Check,
) -> None:
    violations: list[str] = []
    conditional = (
        {
            name
            for name, meta in template.params.items()
            if meta.conditional
        }
        if template is not None
        else set()
    )
    if page_params is not None:
        reasons = {
            str(item.get("param")): str(item.get("reason"))
            for item in omitted
            if isinstance(item.get("param"), str)
        }
        for name in sorted(conditional):
            if name in page_params:
                if not page_params[name].strip():
                    violations.append(f"{name}: emitted empty")
                continue
            reason = reasons.get(name)
            if reason != "conditional_omitted":
                violations.append(
                    f"{name}: omitted with reason {reason!r}, "
                    "expected 'conditional_omitted'"
                )
    elif patch_params:
        for name in sorted(conditional & set(patch_params)):
            if not patch_params[name].strip():
                violations.append(f"{name}: patched empty")
    for violation in violations:
        check.fail(f"conditional parameter {violation}")
    check.details = {"violations": violations, "checked": sorted(conditional)}


def _verify_patch_target(
    patch: Mapping[str, Any],
    *,
    patch_relative: str,
    entry_title: str,
    template: TemplateSpec | None,
    article_titles: set[str],
    redirect_titles: set[str],
    snapshot_pages: Mapping[str, list[SnapshotPage]],
    check: _Check,
) -> tuple[dict[str, str], SnapshotPage | None]:
    title = patch.get("title")
    template_name = patch.get("template")
    params = patch.get("params")
    if not isinstance(title, str) or not title:
        check.fail(f"{patch_relative}: title must be a non-empty string")
        title = ""
    if not isinstance(template_name, str) or not template_name:
        check.fail(f"{patch_relative}: template must be a non-empty string")
        template_name = ""
    if not isinstance(params, dict) or not all(
        isinstance(name, str) and isinstance(value, str)
        for name, value in params.items()
    ):
        check.fail(f"{patch_relative}: params must map strings to strings")
        params = {}
    if patch.get("page_exists") is not True:
        check.fail(f"{patch_relative}: page_exists must be true")
    if template is not None and template_name != template.name:
        check.fail(
            f"{patch_relative}: patch template {template_name!r} != "
            f"profile template {template.name!r}"
        )
    if entry_title and title and title != entry_title:
        check.fail(
            f"{patch_relative}: patch title {title!r} != report title "
            f"{entry_title!r}"
        )

    existing: SnapshotPage | None = None
    status = "ok"
    title_key = normalise_title(title) if title else ""
    if not title:
        status = "invalid"
    elif title_key in article_titles:
        candidates = [
            page
            for page in snapshot_pages.get(title_key, [])
            if page.template == template_name
        ]
        if not candidates:
            status = "no_template_data"
            check.fail(
                f"{patch_relative}: no snapshot page with template "
                f"{template_name!r} at title {title!r}"
            )
        else:
            existing = candidates[0]
    elif title_key in redirect_titles:
        status = "redirect"
        check.fail(f"{patch_relative}: target title {title!r} is a redirect")
    else:
        status = "missing"
        check.fail(f"{patch_relative}: target title {title!r} does not exist")
    check.details = {
        "title": title or None,
        "template": template_name or None,
        "status": status,
    }
    return dict(params), existing


def _verify_patch_diff(
    template: TemplateSpec | None,
    *,
    patch_params: Mapping[str, str],
    patch_existing: SnapshotPage | None,
    check: _Check,
) -> None:
    if not patch_params:
        check.details = {"non_differing": [], "status": "not_applicable"}
        return
    if patch_existing is None:
        check.details = {"non_differing": [], "status": "unverified"}
        return
    non_differing: list[str] = []
    for name, value in patch_params.items():
        if template is not None and name not in template.params:
            continue
        current = patch_existing.params.get(name)
        if current is not None and current.strip() == value.strip():
            non_differing.append(name)
    for name in non_differing:
        check.fail(
            f"patch parameter {name!r} equals the existing snapshot value"
        )
    check.details = {"non_differing": non_differing, "status": "checked"}


def _verify_page_output(
    *,
    file_relative: Any,
    patch_relative: Any,
    matched: bool | None,
    title: str,
    article_titles: set[str],
    redirect_titles: set[str],
    duplicate_titles: set[str],
    page_text: str | None,
    patch_data: Mapping[str, Any] | None,
    check: _Check,
) -> None:
    if file_relative is not None and patch_relative is not None:
        check.fail("page entry has both a full page and a patch")
    if file_relative is not None and page_text is None:
        check.fail("full page was reported but could not be read")
    if file_relative is not None:
        title_key = normalise_title(title)
        if title_key in duplicate_titles:
            check.fail(
                f"full page title {title!r} is shared by more than one page"
            )
    if patch_relative is not None and patch_data is None:
        check.fail("patch was reported but could not be read")
    if matched is True:
        if file_relative is not None:
            check.fail("matched page must not get a full page")
        if patch_relative is None:
            check.fail("matched page has no patch")
    elif matched is False:
        title_key = normalise_title(title)
        if file_relative is not None and (
            title_key in article_titles or title_key in redirect_titles
        ):
            check.fail(
                f"unmatched page emitted a full page for existing title {title!r}"
            )
        if (
            file_relative is None
            and patch_relative is None
            and title_key not in article_titles
            and title_key not in redirect_titles
        ):
            check.fail("unmatched page produced neither a full page nor a patch")
    check.details = {
        "file": file_relative if isinstance(file_relative, str) else None,
        "patch": patch_relative if isinstance(patch_relative, str) else None,
        "matched": matched,
    }


def _verify_category(
    *,
    page_text: str | None,
    page_type: str,
    profile: Profile,
    check: _Check,
) -> None:
    if page_text is None:
        check.details = {"status": "not_rendered"}
        return
    key = PAGE_TYPE_CATEGORY.get(page_type)
    if key is None:
        check.fail(f"no expected category for page type {page_type!r}")
        check.details = {"expected": None, "found": []}
        return
    expected = profile.categories.get(key)
    if not expected:
        check.fail(f"profile has no category for key {key!r}")
        check.details = {"expected": None, "found": []}
        return
    found = _category_targets(page_text)
    if expected not in found:
        check.fail(f"missing expected category {expected!r}")
    check.details = {"expected": expected, "found": found}


# --------------------------------------------------------------------- links
def _verify_links(
    *,
    page_text: str | None,
    patch_params: Mapping[str, str],
    article_titles: set[str],
    redirect_titles: set[str],
    generated_titles: set[str],
    known_missing: Mapping[str, Mapping[str, str]],
    check: _Check,
) -> None:
    segments: list[str] = []
    if page_text is not None:
        segments.append(page_text)
    segments.extend(patch_params.values())
    targets, ignored, file_targets = _extract_links(segments)
    missing: list[str] = []
    known: list[str] = []
    articles = 0
    redirects = 0
    generated = 0
    for target in targets:
        if target in article_titles:
            articles += 1
        elif target in redirect_titles:
            redirects += 1
        elif target in generated_titles:
            generated += 1
        elif target in known_missing:
            known.append(target)
        else:
            missing.append(target)
    for target in missing:
        check.fail(f"red link [[{target}]]")
    check.details = {
        "checked": len(targets),
        "articles": articles,
        "redirects": redirects,
        "generated": generated,
        "known_missing": known,
        "missing": missing,
        "ignored": ignored,
        "file_targets": sorted(set(file_targets)),
    }


def _extract_links(
    segments: Iterable[str],
) -> tuple[list[str], dict[str, int], list[str]]:
    targets: list[str] = []
    ignored = {"file": 0, "category": 0, "external": 0, "anchor": 0}
    file_targets: list[str] = []
    for segment in segments:
        text = _COMMENT_RE.sub("", segment)
        text = _NOWIKI_RE.sub("", text)
        for match in _LINK_RE.finditer(text):
            raw = match.group(1)
            target = raw.split("|", 1)[0].split("#", 1)[0].strip()
            if target.startswith(":"):
                target = target[1:].strip()
            if not target:
                ignored["anchor"] += 1
                continue
            lowered = target.casefold()
            if any(lowered.startswith(item) for item in IGNORED_TARGET_PREFIXES):
                prefix = next(
                    item for item in IGNORED_TARGET_PREFIXES if lowered.startswith(item)
                )
                if prefix in ("file:", "image:", "文件:", "图像:"):
                    ignored["file"] += 1
                    name = target[len(prefix):].strip()
                    if name:
                        file_targets.append(name)
                else:
                    ignored["category"] += 1
                continue
            if any(lowered.startswith(item) for item in _IGNORED_EXTERNAL_PREFIXES):
                ignored["external"] += 1
                continue
            normalised = normalise_title(target)
            if not normalised:
                ignored["anchor"] += 1
                continue
            targets.append(normalised)
    return targets, ignored, file_targets


def _category_targets(text: str) -> list[str]:
    cleaned = _COMMENT_RE.sub("", text)
    found: list[str] = []
    for match in _CATEGORY_RE.finditer(cleaned):
        namespace = match.group(1).strip()
        if namespace.casefold() not in ("分类", "category"):
            continue
        name = normalise_title(match.group(2))
        if name:
            found.append(f"分类:{name}")
    return found


# ---------------------------------------------------------------------- live
def _verify_live(
    rendered: list[tuple[dict[str, Any], str]],
    *,
    sample: int,
    api_url: str,
    helper: str | None,
    fetcher: Callable[[str, Mapping[str, str]], str] | None,
) -> dict[str, Any]:
    sampled = _sample_pages(rendered, sample)
    results: dict[str, dict[str, Any]] = {}
    failures = 0
    for entry, text in sampled:
        entity = entry["entity"]
        result: dict[str, Any] = {"markers": []}
        try:
            response = _live_parse_html(
                text,
                title=entry.get("title", ""),
                api_url=api_url,
                helper=helper,
                fetcher=fetcher,
            )
            markers = template_error_markers(response)
            result["markers"] = markers
            if markers:
                failures += 1
        except Exception as exc:  # noqa: BLE001 - report helper/network failures
            result["error"] = str(exc)
            failures += 1
        results[entity] = result
    skipped = None
    if not sampled:
        skipped = "no full pages to render"
    return {
        "enabled": True,
        "api": api_url,
        "sample": sample,
        "checked": len(sampled),
        "failures": failures,
        "skipped": skipped,
        "pages": [
            {
                "entity": entry["entity"],
                "title": entry.get("title", ""),
                "ok": not results[entry["entity"]]["markers"]
                and "error" not in results[entry["entity"]],
                "markers": [
                    marker["marker"]
                    for marker in results[entry["entity"]]["markers"]
                ],
                "error": results[entry["entity"]].get("error"),
            }
            for entry, _ in sampled
        ],
        "results": results,
        "sampled_entities": [entry["entity"] for entry, _ in sampled],
    }


def _sample_pages(
    rendered: list[tuple[dict[str, Any], str]], limit: int
) -> list[tuple[dict[str, Any], str]]:
    groups: dict[str, list[tuple[dict[str, Any], str]]] = {}
    for item in rendered:
        groups.setdefault(item[0].get("page_type") or "", []).append(item)
    for items in groups.values():
        items.sort(key=lambda item: item[0]["entity"])
    ordered_types = sorted(groups)
    sampled: list[tuple[dict[str, Any], str]] = []
    offset = 0
    while len(sampled) < limit:
        added = False
        for page_type in ordered_types:
            items = groups[page_type]
            if offset < len(items):
                sampled.append(items[offset])
                added = True
                if len(sampled) == limit:
                    break
        if not added:
            break
        offset += 1
    return sampled


def _live_parse_html(
    wikitext: str,
    *,
    title: str,
    api_url: str,
    helper: str | None,
    fetcher: Callable[[str, Mapping[str, str]], str] | None,
) -> str:
    form = {
        "action": "parse",
        "format": "json",
        "formatversion": "2",
        "contentmodel": "wikitext",
        "prop": "text",
        "disablelimitreport": "1",
        "text": wikitext,
    }
    if title:
        form["title"] = title
    if fetcher is not None:
        body = fetcher(api_url, form)
    elif helper:
        url = f"{api_url}?{urllib.parse.urlencode(form)}"
        parts = shlex.split(helper)
        if any("{url}" in part for part in parts):
            command = [part.replace("{url}", url) for part in parts]
        else:
            command = [*parts, url]
        try:
            completed = subprocess.run(
                command,
                capture_output=True,
                text=True,
                encoding="utf-8",
                errors="replace",
                timeout=180,
            )
        except (OSError, subprocess.SubprocessError) as exc:
            raise BuildError(f"live helper failed: {exc}") from exc
        if completed.returncode != 0:
            message = (completed.stderr or "").strip()
            raise BuildError(
                f"live helper exited {completed.returncode}: {message[:400]}"
            )
        body = completed.stdout
    else:
        data = urllib.parse.urlencode(form).encode("utf-8")
        request = urllib.request.Request(
            api_url,
            data=data,
            method="POST",
            headers={
                "User-Agent": "cytus2db-wiki-verify/0.1 "
                "(offline-first canonical DB build)"
            },
        )
        try:
            with urllib.request.urlopen(request, timeout=90) as response:
                body = response.read().decode("utf-8", "replace")
        except (urllib.error.URLError, OSError) as exc:
            raise BuildError(f"action=parse request failed: {exc}") from exc
    return _parse_parse_response(body)


def _parse_parse_response(body: str) -> str:
    data: Any
    try:
        data = json.loads(body)
    except json.JSONDecodeError:
        data = _json_from_helper_output(body)
    if not isinstance(data, dict):
        raise BuildError("action=parse response is not a JSON object")
    error = data.get("error")
    if error:
        if isinstance(error, dict):
            detail = error.get("info") or error.get("code") or error
        else:
            detail = error
        raise BuildError(f"action=parse error: {detail}")
    parse = data.get("parse")
    if not isinstance(parse, dict):
        raise BuildError("action=parse response has no parse object")
    text = parse.get("text")
    if isinstance(text, dict):
        text = text.get("*")
    if not isinstance(text, str):
        raise BuildError("action=parse response has no parse.text")
    return text


def _json_from_helper_output(body: str) -> Any:
    """Accept plain JSON, ``<pre>JSON</pre>`` wrappers and noisy helper output."""
    match = re.search(r"<pre[^>]*>(.*?)</pre>", body, re.S | re.I)
    if match:
        candidate = html.unescape(match.group(1))
        try:
            return json.loads(candidate)
        except json.JSONDecodeError:
            pass
    start = body.find("{")
    end = body.rfind("}")
    if start >= 0 and end > start:
        try:
            return json.loads(body[start : end + 1])
        except json.JSONDecodeError:
            pass
    raise BuildError("live helper did not return parseable JSON")


def template_error_markers(html_text: str) -> list[dict[str, str]]:
    """Return template-error markers found in rendered HTML."""
    found: list[dict[str, str]] = []
    seen: set[str] = set()
    for name, pattern in _ERROR_PATTERNS:
        match = pattern.search(html_text)
        if match is None or name in seen:
            continue
        seen.add(name)
        found.append(
            {
                "marker": name,
                "text": match.group(0),
                "context": _context(html_text, match.start(), match.end()),
            }
        )
    return found


def _context(text: str, start: int, end: int, radius: int = 100) -> str:
    snippet = text[max(0, start - radius) : end + radius]
    snippet = re.sub(r"<[^>]+>", " ", snippet)
    return " ".join(snippet.split())[:300]


# ------------------------------------------------------------------ helpers
def _string_list(value: Any) -> list[str]:
    if not isinstance(value, list):
        return []
    return [item for item in value if isinstance(item, str)]


def _dict_list(value: Any) -> list[dict[str, Any]]:
    if not isinstance(value, list):
        return []
    return [item for item in value if isinstance(item, dict)]
