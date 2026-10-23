"""Render canonical-DB entities into wiki artifacts.

``python -m cytus2db render`` reads ``<db>/db/*.jsonl`` and writes
``pages/`` plus ``report.json`` under ``--out``.  Only page models and the
profile decide content; this module just coordinates files and the report.
"""

from __future__ import annotations

import json
import shutil
from pathlib import Path
from urllib.parse import quote

from ..errors import BuildError
from .bili import (
    RenderedPage,
    TitleMatch,
    load_profile,
    render_page,
    resolve_titles,
)
from .db import Database
from .model import Conflict, PageModel
from .patches import (
    PatchEntry,
    load_snapshot,
    patch_page,
    plan_patches,
)
from .titles import TitleResolver


def build_page_models(db: Database) -> list[PageModel]:
    """Run every page builder discovered under ``cytus2db.wiki.pages``."""
    import importlib
    import pkgutil

    from . import pages as pages_package

    models: list[PageModel] = []
    for info in sorted(pkgutil.iter_modules(pages_package.__path__), key=lambda item: item.name):
        module = importlib.import_module(f"{pages_package.__name__}.{info.name}")
        builder = getattr(module, "build", None)
        if builder is None:
            continue
        models.extend(builder(db))
    return models


def render_wiki(
    db_dir: Path | str,
    out_dir: Path | str,
    profile_path: Path | str,
    snapshot_dir: Path | str | None = None,
) -> dict[str, object]:
    database = Database.load(db_dir)
    profile = load_profile(profile_path)
    models = build_page_models(database)
    titles = resolve_titles(models, profile)
    rendered = [render_page(model, profile, titles[model.entity_id]) for model in models]

    plan: dict[str, PatchEntry] | None = None
    resolver: TitleResolver | None = None
    if snapshot_dir is not None:
        snapshot = load_snapshot(snapshot_dir)
        plan = plan_patches([patch_page(page) for page in rendered], snapshot)
        # The first pass supplies the page identities.  Matching maps every
        # generated title to the snapshot spelling; rendering again with that
        # resolver makes emitted links point at existing pages instead of
        # case/punctuation variants.  Patch parameters are re-extracted from
        # the resolved wikitext so the two passes never diverge.
        resolver = TitleResolver.from_titles(
            snapshot.articles, snapshot.redirects
        )
        for page in rendered:
            entry = plan[page.model.entity_id]
            canonical = entry.match.title if entry.match.matched else page.title
            resolver.add_generated(page.title, canonical)
        matched_titles = {
            page.model.entity_id: TitleMatch(
                plan[page.model.entity_id].match.title,
                plan[page.model.entity_id].match.source,
                plan[page.model.entity_id].match.conflicts,
            )
            for page in rendered
        }
        rendered = [
            render_page(
                model,
                profile,
                matched_titles[model.entity_id],
                resolver,
            )
            for model in models
        ]
        plan = plan_patches([patch_page(page) for page in rendered], snapshot)
        for page in rendered:
            entry = plan[page.model.entity_id]
            canonical = entry.match.title if entry.match.matched else page.title
            resolver.add_generated(page.title, canonical)

    out = Path(out_dir)
    pages_dir = out / "pages"
    if pages_dir.is_dir():
        shutil.rmtree(pages_dir)
    pages_dir.mkdir(parents=True, exist_ok=True)
    patches_dir = out / "patches"
    if plan is not None and patches_dir.is_dir():
        shutil.rmtree(patches_dir)

    entries = []
    for page in sorted(rendered, key=lambda item: item.model.entity_id):
        entry = plan.get(page.model.entity_id) if plan is not None else None
        page_relative: Path | None = None
        if entry is None or entry.keep_page:
            page_relative = _page_path(page)
            target = out / page_relative
            target.parent.mkdir(parents=True, exist_ok=True)
            target.write_text(page.wikitext, encoding="utf-8", newline="\n")

        patch_relative: Path | None = None
        if entry is not None and entry.patch is not None:
            patch_relative = _patch_path(page)
            patch_target = out / patch_relative
            patch_target.parent.mkdir(parents=True, exist_ok=True)
            patch_target.write_text(
                json.dumps(
                    entry.patch, ensure_ascii=False, indent=2, sort_keys=True
                )
                + "\n",
                encoding="utf-8",
                newline="\n",
            )
        entries.append(
            _report_entry(
                page,
                page_relative.as_posix() if page_relative is not None else None,
                patch_relative.as_posix() if patch_relative is not None else None,
                entry,
            )
        )

    counts: dict[str, int] = {}
    for page in rendered:
        counts[page.model.page_type] = counts.get(page.model.page_type, 0) + 1

    report = {
        "profile": Path(profile_path).as_posix(),
        "db": Path(db_dir).as_posix(),
        "page_count": len(rendered),
        "counts": dict(sorted(counts.items())),
        "pages": entries,
    }
    result: dict[str, object] = {
        "page_count": len(rendered),
        "counts": dict(sorted(counts.items())),
        "out": out,
    }
    if plan is not None:
        patch_counts = _patch_counts(rendered, plan)
        report["snapshot"] = Path(snapshot_dir).as_posix()
        report["patch_counts"] = patch_counts
        report["unmatched"] = [
            {
                "entity": page.model.entity_id,
                "page_type": page.model.page_type,
                "title": plan[page.model.entity_id].match.title,
                "title_source": plan[page.model.entity_id].match.source,
                "conflicts": [
                    _conflict_dict(item)
                    for item in plan[page.model.entity_id].match.conflicts
                ],
            }
            for page in sorted(rendered, key=lambda item: item.model.entity_id)
            if not plan[page.model.entity_id].match.matched
        ]
        report["patch_conflicts"] = [
            {
                "entity": page.model.entity_id,
                "page_type": page.model.page_type,
                "title": plan[page.model.entity_id].match.title,
                "conflicts": [
                    _conflict_dict(item)
                    for item in _title_conflicts(page, plan[page.model.entity_id])
                ],
            }
            for page in sorted(rendered, key=lambda item: item.model.entity_id)
            if _title_conflicts(page, plan[page.model.entity_id])
        ]
        report["unresolved_links"] = _unresolved_links(rendered)
        result["patch_counts"] = patch_counts
        result["patch_count"] = sum(
            row["patches"] for row in patch_counts.values()
        )
    out.mkdir(parents=True, exist_ok=True)
    (out / "report.json").write_text(
        json.dumps(report, ensure_ascii=False, indent=2, sort_keys=True) + "\n",
        encoding="utf-8",
        newline="\n",
    )
    return result


def _unresolved_links(rendered: list[RenderedPage]) -> list[dict[str, object]]:
    """Link targets that no snapshot page or generated page can resolve."""
    index: dict[str, dict[str, object]] = {}
    for page in sorted(rendered, key=lambda item: item.model.entity_id):
        for target in page.unresolved_links:
            record = index.setdefault(
                target, {"target": target, "count": 0, "sources": []}
            )
            record["count"] = int(record["count"]) + 1
            sources = record["sources"]
            if isinstance(sources, list) and page.model.entity_id not in sources:
                sources.append(page.model.entity_id)
    return [index[target] for target in sorted(index)]


def _page_path(page: RenderedPage) -> Path:
    game_id = page.model.game_id()
    if "/" in game_id or "\\" in game_id:
        raise BuildError(f"{page.model.entity_id}: game id contains a path separator")
    filename = quote(game_id, safe="._-") + ".wikitext"
    return Path("pages") / page.model.page_type / filename


def _patch_path(page: RenderedPage) -> Path:
    game_id = page.model.game_id()
    if "/" in game_id or "\\" in game_id:
        raise BuildError(f"{page.model.entity_id}: game id contains a path separator")
    filename = quote(game_id, safe="._-") + ".json"
    return Path("patches") / page.model.page_type / filename


def _patch_counts(
    rendered: list[RenderedPage], plan: dict[str, PatchEntry]
) -> dict[str, dict[str, int]]:
    summary: dict[str, dict[str, int]] = {}
    for page in rendered:
        entry = plan[page.model.entity_id]
        row = summary.setdefault(
            page.model.page_type,
            {"pages": 0, "matched": 0, "unmatched": 0, "conflicts": 0, "patches": 0},
        )
        row["pages"] += 1
        if entry.match.matched:
            row["matched"] += 1
        else:
            row["unmatched"] += 1
        if _title_conflicts(page, entry):
            row["conflicts"] += 1
        if entry.patch is not None:
            row["patches"] += 1
    return dict(sorted(summary.items()))


_TITLE_CONFLICT_KINDS = frozenset({"title_conflict", "existing_title_without_match"})


def _title_conflicts(
    page: RenderedPage, entry: PatchEntry
) -> list[Conflict]:
    return [
        conflict
        for conflict in _dedupe([*page.conflicts, *entry.match.conflicts])
        if conflict.kind in _TITLE_CONFLICT_KINDS
    ]


def _report_entry(
    page: RenderedPage,
    relative: str | None,
    patch_relative: str | None = None,
    entry: PatchEntry | None = None,
) -> dict[str, object]:
    report = {
        "entity": page.model.entity_id,
        "page_type": page.model.page_type,
        "title": page.title,
        "title_source": page.title_source,
        "template": page.template,
        "file": relative,
        "categories": list(page.categories),
        "emitted": list(page.emitted),
        "omitted": [item.as_dict() for item in page.omitted],
        "conflicts": [_conflict_dict(item) for item in page.conflicts],
        "links": [
            {"target": link.target, "label": link.label} for link in page.links
        ],
    }
    if entry is not None:
        report["title"] = entry.match.title
        report["title_source"] = entry.match.source
        report["matched"] = entry.match.matched
        report["patch"] = patch_relative
        report["conflicts"] = [
            _conflict_dict(item)
            for item in _dedupe(
                [*page.conflicts, *entry.match.conflicts]
            )
        ]
    return report


def _dedupe(conflicts: list[Conflict]) -> list[Conflict]:
    unique: dict[tuple[str, str], Conflict] = {}
    for conflict in conflicts:
        unique[(conflict.kind, conflict.detail)] = conflict
    return [unique[key] for key in sorted(unique)]


def _conflict_dict(conflict: Conflict) -> dict[str, str]:
    return {"kind": conflict.kind, "detail": conflict.detail}
