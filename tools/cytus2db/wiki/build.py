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
from .bili import RenderedPage, load_profile, render_page, resolve_titles
from .db import Database
from .model import Conflict, PageModel
from .songs import build_song_pages


def build_page_models(db: Database) -> list[PageModel]:
    return build_song_pages(db)


def render_wiki(
    db_dir: Path | str,
    out_dir: Path | str,
    profile_path: Path | str,
) -> dict[str, object]:
    database = Database.load(db_dir)
    profile = load_profile(profile_path)
    models = build_page_models(database)
    titles = resolve_titles(models, profile)
    rendered = [render_page(model, profile, titles[model.entity_id]) for model in models]

    out = Path(out_dir)
    pages_dir = out / "pages"
    if pages_dir.is_dir():
        shutil.rmtree(pages_dir)
    pages_dir.mkdir(parents=True, exist_ok=True)

    entries = []
    for page in sorted(rendered, key=lambda item: item.model.entity_id):
        relative = _page_path(page)
        target = out / relative
        target.parent.mkdir(parents=True, exist_ok=True)
        target.write_text(page.wikitext, encoding="utf-8", newline="\n")
        entries.append(_report_entry(page, relative.as_posix()))

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
    out.mkdir(parents=True, exist_ok=True)
    (out / "report.json").write_text(
        json.dumps(report, ensure_ascii=False, indent=2, sort_keys=True) + "\n",
        encoding="utf-8",
        newline="\n",
    )
    return {
        "page_count": len(rendered),
        "counts": dict(sorted(counts.items())),
        "out": out,
    }


def _page_path(page: RenderedPage) -> Path:
    game_id = page.model.game_id()
    if "/" in game_id or "\\" in game_id:
        raise BuildError(f"{page.model.entity_id}: game id contains a path separator")
    filename = quote(game_id, safe="._-") + ".wikitext"
    return Path("pages") / page.model.page_type / filename


def _report_entry(page: RenderedPage, relative: str) -> dict[str, object]:
    return {
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


def _conflict_dict(conflict: Conflict) -> dict[str, str]:
    return {"kind": conflict.kind, "detail": conflict.detail}
