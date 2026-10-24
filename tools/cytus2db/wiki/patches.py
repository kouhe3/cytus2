"""Title matching and parameter-level wiki patches (ticket #12).

Existing pages are never regenerated: the renderer's parameter block is
compared with the site snapshot and only differing parameters are written as a
JSON patch.  ``apply_patch`` replaces exactly those value slices, so unknown
parameters and human-written sections stay byte-identical.

Matching is keyed by the template's own parameters, mirroring the site's page
inventory:

======================  ================================  =====================
template                key                               tie-breakers
======================  ================================  =====================
``歌曲``                ``曲名``
``角色``                ``角色名``
``曲包``                ``曲包名``
``Os/文件``             ``文件名`` + ``所属角色``
``Oa/文件``             ``文件名`` + ``所属角色``
``Gallery文件``         ``文件名`` + ``所属角色``
``Im/帖``               ``标题``                          ``全局排序``, ``剧情排序``
======================  ================================  =====================

An iM post whose title is still ambiguous falls back to ``<标题>（<post id>）``
so the historical title variants on the site are preserved untouched.

Identity parameters and titles are compared through
``cytus2db.wiki.titles``: the strict key catches MediaWiki-equivalent
spellings (``illMenate``/``IllMenate``), and the loose key recovers the site
spelling for case, parenthesis spacing, dashes and similarly known variants.
A loose match is only accepted when it selects exactly one page.
"""

from __future__ import annotations

import json
import re
from collections import defaultdict
from dataclasses import dataclass
from functools import cached_property
from pathlib import Path
from typing import Any, Iterable, Mapping

from ..errors import BuildError, InputError
from .bili import RenderedPage
from .model import Conflict
from .titles import match_key, normalise_title


class PatchError(BuildError):
    """A patch cannot be applied to the given wikitext."""


# --------------------------------------------------------------------- model
@dataclass(frozen=True)
class SnapshotPage:
    """One existing site page reduced to its template parameters."""

    title: str
    template: str
    params: Mapping[str, str]


@dataclass(frozen=True)
class Snapshot:
    """The site's title set plus the parameter block of every template page."""

    articles: frozenset[str]
    pages: tuple[SnapshotPage, ...] = ()
    redirects: frozenset[str] = frozenset()
    # ``pages.json`` is a local cache of wiki text and is not committed; a
    # titles-only checkout can still verify links but cannot diff parameters.
    pages_available: bool = True

    @cached_property
    def article_keys(self) -> frozenset[str]:
        return frozenset(normalise_title(title) for title in self.articles)

    @cached_property
    def redirect_keys(self) -> frozenset[str]:
        return frozenset(normalise_title(title) for title in self.redirects)

    def has_title(self, title: str) -> bool:
        """True when a page or redirect already owns ``title``'s title key.

        MediaWiki treats the first letter case-insensitively and underscores
        as spaces, so a full page for ``illMenate`` would overwrite the
        existing ``IllMenate`` page.  The shared key makes that collision
        visible before anything is written.
        """
        key = normalise_title(title)
        return key in self.article_keys or key in self.redirect_keys


@dataclass(frozen=True)
class PatchPage:
    """The parts of a rendered page that title matching and patching need."""

    entity_id: str
    page_type: str
    template: str
    title: str
    params: Mapping[str, str]

    def game_id(self) -> str:
        return self.entity_id.split("/", 1)[-1]


@dataclass(frozen=True)
class PageMatch:
    title: str
    source: str
    matched: bool
    keep_page: bool
    existing: SnapshotPage | None = None
    conflicts: tuple[Conflict, ...] = ()


@dataclass(frozen=True)
class PatchEntry:
    page: PatchPage
    match: PageMatch
    patch: dict[str, Any] | None
    keep_page: bool


# ------------------------------------------------------------------ snapshot
def load_snapshot(directory: Path | str, *, require_pages: bool = False) -> Snapshot:
    root = Path(directory)
    titles_path = root / "titles.json"
    pages_path = root / "pages.json"
    if not titles_path.is_file():
        raise InputError(f"wiki snapshot not found: {titles_path}")
    if not pages_path.is_file() and require_pages:
        raise InputError(
            f"wiki snapshot not found: {pages_path}. pages.json is a local "
            "cache of existing site pages (wiki text) and is not committed; "
            "refresh it with `python tools/wiki_snapshot.py --out wiki/snapshot` "
            "before using --patches."
        )

    titles = _read_json(titles_path)
    raw_articles = titles.get("articles")
    if not isinstance(raw_articles, list) or not all(
        isinstance(item, str) for item in raw_articles
    ):
        raise InputError(f"{titles_path}: articles must be a string list")
    articles = frozenset(raw_articles)
    raw_redirects = titles.get("redirects") or []
    if not isinstance(raw_redirects, list) or not all(
        isinstance(item, str) for item in raw_redirects
    ):
        raise InputError(f"{titles_path}: redirects must be a string list")

    pages = load_pages(pages_path) if pages_path.is_file() else ()
    return Snapshot(
        articles=articles,
        pages=pages,
        redirects=frozenset(raw_redirects),
        pages_available=pages_path.is_file(),
    )


def load_pages(path: Path | str) -> tuple[SnapshotPage, ...]:
    """Read the local ``pages.json`` cache into :class:`SnapshotPage` records.

    ``pages.json`` is a local cache, not a committed artifact: it holds the
    existing site pages' parameter blocks and therefore carries wiki text.
    ``render --patches`` needs it; a titles-only checkout still verifies links
    and categories, but cannot diff parameters.
    """
    pages_path = Path(path)
    pages_data = _read_json(pages_path)
    raw_templates = pages_data.get("templates")
    if not isinstance(raw_templates, dict):
        raise InputError(f"{pages_path}: templates must be an object")

    pages: list[SnapshotPage] = []
    for template, raw in raw_templates.items():
        if not isinstance(raw, dict):
            raise InputError(f"{pages_path}: templates[{template!r}] must be an object")
        raw_pages = raw.get("pages")
        if not isinstance(raw_pages, list):
            raise InputError(f"{pages_path}: templates[{template!r}].pages must be a list")
        for raw_page in raw_pages:
            if not isinstance(raw_page, dict):
                raise InputError(f"{pages_path}: page entries must be objects")
            title = raw_page.get("title")
            params = raw_page.get("params")
            if not isinstance(title, str) or not title:
                raise InputError(f"{pages_path}: page title must be a non-empty string")
            if not isinstance(params, dict):
                raise InputError(f"{pages_path}: {title}: params must be an object")
            pages.append(
                SnapshotPage(
                    title=title,
                    template=str(template),
                    params={
                        str(name): str(value or "") for name, value in params.items()
                    },
                )
            )
    return tuple(pages)


def _read_json(path: Path) -> dict[str, Any]:
    try:
        data = json.loads(path.read_text(encoding="utf-8-sig"))
    except json.JSONDecodeError as exc:
        raise InputError(f"invalid JSON in {path}: {exc}") from exc
    if not isinstance(data, dict):
        raise InputError(f"{path}: must be a JSON object")
    return data


# ------------------------------------------------------------- wikitext scan
def template_parameters(wikitext: str, template: str) -> dict[str, str]:
    """Return the top-level ``template`` block's parameters.

    MediaWiki semantics: a duplicated named parameter keeps the *last*
    occurrence's value, so that is the slice returned here.
    Raises :class:`PatchError` when the page has no such template block.
    """
    block = _find_template(wikitext, template)
    if block is None:
        raise PatchError(f"template {template!r} not found in page")
    _, _, close_start, _ = block
    slices = _parameter_slices(wikitext, block[0], close_start)
    return {
        name: wikitext[start:end].strip()
        for name, (start, end) in slices.items()
    }


def template_block(wikitext: str, template: str) -> str:
    """Return the exact top-level ``template`` block, braces included.

    The block is copied verbatim from the rendered page, so it can be shown
    to a human reviewer without re-serialising (and possibly reordering) the
    parameters.
    """
    block = _find_template(wikitext, template)
    if block is None:
        raise PatchError(f"template {template!r} not found in page")
    return wikitext[block[0] : block[3]]


def _find_template(
    wikitext: str, name: str
) -> tuple[int, int, int, int] | None:
    """Locate the top-level block of ``name``.

    Returns ``(open_start, body_start, close_start, block_end)``.
    """
    index = 0
    length = len(wikitext)
    while index < length - 1:
        start = wikitext.find("{{", index)
        if start < 0:
            return None
        measured = _measure(wikitext, start)
        if measured is None:
            return None
        close, end = measured
        header_end = start + 2
        cursor = header_end
        while cursor < close and wikitext[cursor] not in "|}\n":
            cursor += 1
        if wikitext[header_end:cursor].strip() == name:
            return start, header_end, close, end
        index = end
    return None


def _measure(wikitext: str, start: int) -> tuple[int, int] | None:
    """Return ``(close_start, block_end)`` for the block opening at ``start``."""
    depth = 1
    index = start + 2
    length = len(wikitext)
    while index < length - 1:
        if wikitext.startswith("{{", index):
            depth += 1
            index += 2
        elif wikitext.startswith("}}", index):
            depth -= 1
            if depth == 0:
                return index, index + 2
            index += 2
        else:
            index += 1
    return None


def _parameter_slices(
    wikitext: str, open_start: int, close_start: int
) -> dict[str, tuple[int, int]]:
    """Map parameter name to its effective value slice.

    A duplicate named parameter is legal wikitext; MediaWiki uses the last
    occurrence, so later segments overwrite earlier ones.
    """
    slices: dict[str, tuple[int, int]] = {}
    for position, (segment_start, segment_end) in enumerate(
        _split_segments(wikitext, open_start + 2, close_start)
    ):
        if position == 0:
            continue  # the template name
        equals = _find_equals(wikitext, segment_start, segment_end)
        if equals is None:
            continue
        name = wikitext[segment_start:equals].strip()
        if not name:
            continue
        slices[name] = (equals + 1, segment_end)
    return slices


def _split_segments(
    wikitext: str, start: int, end: int
) -> list[tuple[int, int]]:
    segments: list[tuple[int, int]] = []
    segment_start = start
    index = start
    depth = 0
    links = 0
    in_comment = False
    while index < end:
        if in_comment:
            if wikitext.startswith("-->", index):
                in_comment = False
                index += 3
            else:
                index += 1
            continue
        if wikitext.startswith("<!--", index):
            in_comment = True
            index += 4
        elif wikitext.startswith("{{", index):
            depth += 1
            index += 2
        elif wikitext.startswith("}}", index):
            depth -= 1
            index += 2
        elif wikitext.startswith("[[", index):
            links += 1
            index += 2
        elif wikitext.startswith("]]", index):
            links = max(0, links - 1)
            index += 2
        elif wikitext[index] == "|" and depth == 0 and links == 0:
            segments.append((segment_start, index))
            segment_start = index + 1
            index += 1
        else:
            index += 1
    segments.append((segment_start, end))
    return segments


def _find_equals(wikitext: str, start: int, end: int) -> int | None:
    index = start
    depth = 0
    links = 0
    in_comment = False
    while index < end:
        if in_comment:
            if wikitext.startswith("-->", index):
                in_comment = False
                index += 3
            else:
                index += 1
            continue
        if wikitext.startswith("<!--", index):
            in_comment = True
            index += 4
        elif wikitext.startswith("{{", index):
            depth += 1
            index += 2
        elif wikitext.startswith("}}", index):
            depth -= 1
            index += 2
        elif wikitext.startswith("[[", index):
            links += 1
            index += 2
        elif wikitext.startswith("]]", index):
            links = max(0, links - 1)
            index += 2
        elif wikitext[index] == "=" and depth == 0 and links == 0:
            return index
        else:
            index += 1
    return None


# ------------------------------------------------------------------ matching
@dataclass(frozen=True)
class _Rule:
    key: tuple[str, ...]
    # ``strict_only`` rules never fall back to the loose match key: the
    # identity field is a page title whose case is significant beyond the
    # first letter (``NEKO`` and ``Neko`` are different pages).
    strict_only: bool = False


_RULES = {
    "歌曲": _Rule(("曲名",)),
    "角色": _Rule(("角色名",)),
    "曲包": _Rule(("曲包名",)),
    "Os/文件": _Rule(("文件名", "所属角色")),
    "Oa/文件": _Rule(("文件名", "所属角色")),
    "Gallery文件": _Rule(("文件名", "所属角色")),
    "Im/帖": _Rule(("标题",), strict_only=True),
}
_IM_SORT_KEYS = ("全局排序", "剧情排序")


def patch_page(rendered: RenderedPage) -> PatchPage:
    return PatchPage(
        entity_id=rendered.model.entity_id,
        page_type=rendered.model.page_type,
        template=rendered.template,
        title=rendered.title,
        params=template_parameters(rendered.wikitext, rendered.template),
    )


def match_pages(
    pages: Iterable[PatchPage], snapshot: Snapshot
) -> dict[str, PageMatch]:
    by_template: dict[str, list[SnapshotPage]] = defaultdict(list)
    for page in snapshot.pages:
        by_template[page.template].append(page)
    indexes = {
        template: _build_index(records) for template, records in by_template.items()
    }

    claimed: set[str] = set()
    matches: dict[str, PageMatch] = {}
    for page in sorted(pages, key=lambda item: item.entity_id):
        match = _match_one(page, snapshot, indexes, claimed)
        if match.matched:
            claimed.add(match.title)
        matches[page.entity_id] = match
    return matches


_Index = tuple[
    dict[tuple[str, ...], list[SnapshotPage]],
    dict[str, list[SnapshotPage]],
    dict[tuple[str, ...], list[SnapshotPage]],
    dict[str, list[SnapshotPage]],
    dict[str, list[SnapshotPage]],
]


def _build_index(
    records: Iterable[SnapshotPage],
) -> _Index:
    by_key: dict[tuple[str, ...], list[SnapshotPage]] = defaultdict(list)
    by_first: dict[str, list[SnapshotPage]] = defaultdict(list)
    by_loose: dict[tuple[str, ...], list[SnapshotPage]] = defaultdict(list)
    by_loose_first: dict[str, list[SnapshotPage]] = defaultdict(list)
    by_exact: dict[str, list[SnapshotPage]] = defaultdict(list)
    for record in sorted(records, key=lambda item: item.title):
        by_exact[normalise_title(record.title)].append(record)
        rule = _RULES.get(record.template)
        if rule is None:
            continue
        key = tuple(
            _strict_value(record.params.get(name, "")) for name in rule.key
        )
        loose = tuple(
            _key_value(record.params.get(name, "")) for name in rule.key
        )
        by_key[key].append(record)
        by_first[key[0]].append(record)
        by_loose[loose].append(record)
        by_loose_first[loose[0]].append(record)
    return (
        dict(by_key),
        dict(by_first),
        dict(by_loose),
        dict(by_loose_first),
        dict(by_exact),
    )


def _match_one(
    page: PatchPage,
    snapshot: Snapshot,
    indexes: dict[str, _Index],
    claimed: set[str],
) -> PageMatch:
    rule = _RULES.get(page.template)
    conflicts: list[Conflict] = []
    empty_index: _Index = ({}, {}, {}, {}, {})
    by_key, by_first, by_loose, by_loose_first, by_exact = indexes.get(
        page.template, empty_index
    )

    exact_all = [
        item
        for item in by_exact.get(normalise_title(page.title), ())
        if item.title not in claimed
    ]

    key_candidates: list[SnapshotPage] = []
    normalised_key = False
    if rule is not None:
        strict_key = tuple(
            _strict_value(page.params.get(name, "")) for name in rule.key
        )
        loose_key = tuple(
            _key_value(page.params.get(name, "")) for name in rule.key
        )
        key_candidates = by_key.get(strict_key, [])
        if not key_candidates and not rule.strict_only:
            key_candidates = by_loose.get(loose_key, [])
            normalised_key = bool(key_candidates)
        if not key_candidates and len(rule.key) == 2 and not rule.strict_only:
            # Older OA pages carry no 所属角色 parameter; fall back to the
            # filename when exactly one page owns it.
            loose = by_first.get(strict_key[0], [])
            if len(loose) == 1:
                key_candidates = loose
            else:
                loose = by_loose_first.get(loose_key[0], [])
                if len(loose) == 1:
                    key_candidates = loose
                    normalised_key = True

    if page.template != "Im/帖" and len(exact_all) == 1:
        same_as_key = (
            len(key_candidates) == 1
            and key_candidates[0].title == exact_all[0].title
        )
        return PageMatch(
            title=exact_all[0].title,
            source="snapshot" if same_as_key else "snapshot:title",
            matched=True,
            keep_page=False,
            existing=exact_all[0],
        )

    available = [item for item in key_candidates if item.title not in claimed]
    if len(available) == 1:
        return PageMatch(
            title=available[0].title,
            source="snapshot:normalised" if normalised_key else "snapshot",
            matched=True,
            keep_page=False,
            existing=available[0],
        )

    if len(available) > 1:
        if page.template == "Im/帖":
            narrowed = _narrow_by_sort(page, available)
            if len(narrowed) == 1:
                return PageMatch(
                    title=narrowed[0].title,
                    source="snapshot:sort",
                    matched=True,
                    keep_page=False,
                    existing=narrowed[0],
                )
            if narrowed:
                available = narrowed
        conflicts.append(
            Conflict(
                "title_conflict",
                f"{_match_value(page.params.get(rule.key[0], '')) or page.title!r}"
                f" matches {len(available)} existing pages",
            )
        )
        return _disambiguated(page, snapshot, conflicts)

    if key_candidates:
        # Every page with this key is already claimed by another entity.
        conflicts.append(
            Conflict(
                "title_conflict",
                f"{_match_value(page.params.get(rule.key[0], '')) or page.title!r}"
                " is already claimed by another entity",
            )
        )
        return _disambiguated(page, snapshot, conflicts)

    if page.template == "Im/帖" and len(exact_all) == 1:
        return PageMatch(
            title=exact_all[0].title,
            source="snapshot:title",
            matched=True,
            keep_page=False,
            existing=exact_all[0],
        )

    if snapshot.has_title(page.title):
        conflicts.append(
            Conflict(
                "existing_title_without_match",
                f"{page.title!r} exists but no template page matched",
            )
        )
        return PageMatch(
            title=page.title,
            source="generated",
            matched=False,
            keep_page=False,
            conflicts=tuple(conflicts),
        )

    return PageMatch(
        title=page.title,
        source="generated",
        matched=False,
        keep_page=True,
        conflicts=tuple(conflicts),
    )


def _narrow_by_sort(
    page: PatchPage, candidates: list[SnapshotPage]
) -> list[SnapshotPage]:
    current = candidates
    for name in _IM_SORT_KEYS:
        value = _match_value(page.params.get(name, ""))
        if not value:
            continue
        filtered = [
            item
            for item in current
            if _match_value(item.params.get(name, "")) == value
        ]
        if filtered:
            current = filtered
        if len(current) == 1:
            break
    return current


def _disambiguated(
    page: PatchPage, snapshot: Snapshot, conflicts: list[Conflict]
) -> PageMatch:
    rule = _RULES.get(page.template)
    base = ""
    if rule is not None:
        base = _match_value(page.params.get(rule.key[0], ""))
    if not base:
        base = page.title
    suffix = f"（{page.game_id()}）"
    title = base if base.endswith(suffix) else f"{base}{suffix}"
    if snapshot.has_title(title):
        conflicts.append(
            Conflict(
                "existing_title_without_match",
                f"disambiguated title {title!r} already exists",
            )
        )
        keep_page = False
    else:
        keep_page = True
    return PageMatch(
        title=title,
        source="generated:disambiguated",
        matched=False,
        keep_page=keep_page,
        conflicts=tuple(conflicts),
    )


def _strict_value(value: str) -> str:
    """Return the MediaWiki title key of an identity parameter value."""
    return normalise_title(_match_value(value))


def _key_value(value: str) -> str:
    """Return the loose match key of an identity parameter value."""
    return match_key(_match_value(value))


def _match_value(value: str) -> str:
    text = " ".join(str(value or "").split())
    text = re.sub(r"\{\{DISPLAYTITLE:[^{}]*\}\}", "", text).strip()
    return text


# ------------------------------------------------------------------- patches
def plan_patches(
    pages: Iterable[PatchPage], snapshot: Snapshot
) -> dict[str, PatchEntry]:
    ordered = sorted(pages, key=lambda item: item.entity_id)
    matches = match_pages(ordered, snapshot)
    entries: dict[str, PatchEntry] = {}
    for page in ordered:
        match = matches[page.entity_id]
        patch = None
        if match.matched and match.existing is not None:
            changed: dict[str, str] = {}
            rule = _RULES.get(page.template)
            protected: frozenset[str] = frozenset()
            if match.source == "snapshot:title":
                # A title-based match already proves the page identity; never
                # rewrite the parameters that identity is keyed on.
                if rule is not None:
                    protected = frozenset(rule.key)
            for name, value in page.params.items():
                if name in protected:
                    continue
                current = match.existing.params.get(name)
                if current is None:
                    changed[name] = value
                    continue
                if (
                    rule is not None
                    and name in rule.key
                    and _key_value(current) == _key_value(value)
                ):
                    # Same identity under the matching normalisation (case,
                    # underscores, template markup): keep the site spelling.
                    continue
                if current.strip() != value.strip():
                    changed[name] = value
            patch = {
                "title": match.title,
                "template": page.template,
                "params": dict(sorted(changed.items())),
                "page_exists": True,
            }
        entries[page.entity_id] = PatchEntry(
            page=page,
            match=match,
            patch=patch,
            keep_page=match.keep_page,
        )
    return entries


def apply_patch(existing_wikitext: str, patch: Mapping[str, Any]) -> str:
    """Apply ``patch`` to an existing page, touching only patched values.

    Unknown parameters, comments, nested templates and every byte outside the
    patched value slices are preserved.  Parameters absent from the page are
    appended to the template block.
    """
    template = patch.get("template")
    params = patch.get("params")
    if not isinstance(template, str) or not template:
        raise PatchError("patch has no template name")
    if not isinstance(params, dict) or not all(
        isinstance(name, str) and isinstance(value, str)
        for name, value in params.items()
    ):
        raise PatchError("patch params must map strings to strings")
    if patch.get("page_exists") is not True:
        raise PatchError("apply_patch only patches existing pages")

    block = _find_template(existing_wikitext, template)
    if block is None:
        raise PatchError(f"template {template!r} not found in the existing page")
    open_start, _, close_start, _ = block
    slices = _parameter_slices(existing_wikitext, open_start, close_start)

    edits: list[tuple[int, int, str]] = []
    insertions: list[tuple[str, str]] = []
    for name, value in params.items():
        span = slices.get(name)
        if span is None:
            insertions.append((name, value))
            continue
        start, end = span
        old = existing_wikitext[start:end]
        lead = old[: len(old) - len(old.lstrip())]
        rest = old[len(lead) :]
        trail = rest[len(rest.rstrip()) :]
        core = rest[: len(rest) - len(trail)] if trail else rest
        if not core:
            replacement = value + old
        else:
            replacement = lead + value + trail
        edits.append((start, end, replacement))

    if insertions:
        if "\n" in existing_wikitext[open_start:close_start]:
            prefix = (
                ""
                if existing_wikitext[:close_start].endswith("\n")
                else "\n"
            )
            addition = prefix + "".join(
                f"|{name}={value}\n" for name, value in insertions
            )
        else:
            addition = "".join(f"|{name}={value}" for name, value in insertions)
        edits.append((close_start, close_start, addition))

    updated = existing_wikitext
    for start, end, replacement in sorted(
        edits, key=lambda item: item[0], reverse=True
    ):
        updated = updated[:start] + replacement + updated[end:]
    return updated
