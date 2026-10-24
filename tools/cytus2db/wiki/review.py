"""Read-only wikitext review batches (ticket #25).

``render --patches --batch <file-or-ids>`` selects 3-10 pages, diffs only
their template parameters against the local site snapshot and writes one
human-readable Markdown file under ``<out>/review/``.  A batch never writes
``pages/``, ``patches/`` or ``report.json`` and never calls a write API.

The local ``wiki/snapshot/pages.json`` cache is authoritative.  When it is
missing, ``--fetch-selected`` fetches only the selected titles through
``action=query&prop=revisions``; the whole-site snapshot is never refreshed
from this command.
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
from collections import Counter
from collections.abc import Callable, Iterable, Mapping, Sequence
from dataclasses import dataclass
from pathlib import Path
from typing import Any

from ..errors import BuildError, InputError
from .bili import Profile, RenderedPage, load_profile, resolve_titles
from .build import build_page_models, render_with_patches
from .db import Database
from .model import Conflict, PageModel
from .patches import (
    PatchEntry,
    PatchError,
    Snapshot,
    SnapshotPage,
    load_snapshot,
    template_block,
    template_parameters,
)
from .titles import TitleResolver, match_key, normalise_title

DEFAULT_FETCH_API = "https://wiki.biligame.com/cytus2/api.php"

PAGE_TYPES = ("character", "song", "im_post", "os_log", "oa_document")

_MIN_BATCH = 3
_MAX_BATCH = 10

_CELL_LIMIT = 160

# Template parameters the wiki owner maintains by hand.  The renderer either
# never emits them or only emits a verified subset, so a batch must always
# tell the reviewer that the site's value stays untouched.
HUMAN_PARAMS = frozenset({"轶事", "歌词"})

# Human-written body sections that are outside the template block.
HUMAN_SECTIONS: dict[str, tuple[str, ...]] = {
    "character": ("轶事",),
    "song": ("歌词", "轶事"),
}

_REASON_LABELS = {
    "no_verifiable_value": "无可验证值",
    "conditional_omitted": "条件参数不成立",
    "empty_value": "空值",
    "no_profile_parameter": "无对应模板参数",
    "exp_table_not_extracted": "经验表未抽取",
    "no_ending_branch": "无结局分支",
    "default_avatar": "使用默认头像",
    "no_chart_unlocks": "无谱面解锁",
    "no_attachment": "无附件",
    "no_unlock_edges": "无解锁关系",
    "content_unavailable": "正文不可用",
    "no_im_account": "无 iM 账号",
    "no_replies": "无回复",
    "content_missing": "正文缺失",
    "text_missing": "文本缺失",
    "title_missing": "标题缺失",
}

_TYPE_ORDER = {name: index for index, name in enumerate(PAGE_TYPES)}

_FETCH_PAGE_LIMIT = 50
_COMMENT_RE = re.compile(r"<!--.*?-->", re.DOTALL)
_REDIRECT_RE = re.compile(r"^\s*#redirect\b", re.IGNORECASE)


@dataclass(frozen=True)
class BatchSpec:
    """A parsed ``--batch`` argument: a stable name plus selection entries."""

    name: str
    entries: tuple[str, ...]


# ------------------------------------------------------------------ selection
def parse_batch_spec(spec: str) -> BatchSpec:
    """Parse ``<file-or-ids>``.

    A path to an existing file selects one entry per line (blank lines and
    ``#`` comments are ignored).  Anything else is a comma-separated list.
    Titles keep their spaces; only commas separate inline entries.
    """
    source = Path(spec)
    if source.is_file():
        entries = [
            line.strip()
            for line in source.read_text(encoding="utf-8-sig").splitlines()
            if line.strip() and not line.lstrip().startswith("#")
        ]
        name = source.stem
    else:
        entries = [item.strip() for item in spec.split(",") if item.strip()]
        name = "selection"
    if not entries:
        raise InputError(
            "batch: the selection is empty; pass a file with one title or "
            "entity id per line, or a comma-separated list"
        )
    return BatchSpec(name=name, entries=tuple(entries))


def select_pages(
    models: Iterable[PageModel],
    profile: Profile,
    spec: BatchSpec,
    page_type: str | None = None,
) -> tuple[list[PageModel], list[PageModel]]:
    """Resolve ``spec`` to page models.

    Returns ``(selected, excluded)``.  ``page_type`` is a filter: pages of
    other types are returned in ``excluded`` so the review can name them
    instead of silently shrinking.
    """
    all_models = list(models)
    titles = resolve_titles(all_models, profile)
    by_entity = {model.entity_id: model for model in all_models}
    by_title: dict[str, list[PageModel]] = {}
    by_loose: dict[str, list[PageModel]] = {}
    for model in all_models:
        title = titles[model.entity_id].title
        by_title.setdefault(normalise_title(title), []).append(model)
        by_loose.setdefault(match_key(title), []).append(model)

    chosen: dict[str, PageModel] = {}
    for entry in spec.entries:
        if entry in by_entity:
            chosen[entry] = by_entity[entry]
            continue
        candidates = by_title.get(normalise_title(entry), [])
        if not candidates:
            candidates = by_loose.get(match_key(entry), [])
        if not candidates:
            raise InputError(
                f"batch: no page matches {entry!r}; expected an entity id "
                "such as 'song/alpha001_000' or an existing page title"
            )
        if len(candidates) > 1:
            names = ", ".join(model.entity_id for model in candidates)
            raise InputError(f"batch: {entry!r} is ambiguous: {names}")
        chosen[candidates[0].entity_id] = candidates[0]

    ordered = sorted(
        chosen.values(),
        key=lambda model: (_TYPE_ORDER.get(model.page_type, 99), model.entity_id),
    )
    excluded: list[PageModel] = []
    if page_type is not None:
        excluded = [model for model in ordered if model.page_type != page_type]
        ordered = [model for model in ordered if model.page_type == page_type]

    if not _MIN_BATCH <= len(ordered) <= _MAX_BATCH:
        extra = (
            f" after --type {page_type!r} filtered out {len(excluded)} page(s)"
            if excluded
            else ""
        )
        raise InputError(
            f"batch: needs {_MIN_BATCH}-{_MAX_BATCH} pages, got {len(ordered)}"
            f"{extra}; select 3-10 titles or entity ids"
        )
    return ordered, excluded


# --------------------------------------------------------------------- fetch
def fetch_selected_pages(
    titles: Sequence[str],
    *,
    api_url: str = DEFAULT_FETCH_API,
    helper: str | None = None,
    fetcher: Callable[[str, Mapping[str, str]], str] | None = None,
) -> list[dict[str, Any]]:
    """Fetch revisions for exactly ``titles`` (read-only ``action=query``)."""
    pages: list[dict[str, Any]] = []
    ordered = list(dict.fromkeys(titles))
    for start in range(0, len(ordered), _FETCH_PAGE_LIMIT):
        batch = ordered[start : start + _FETCH_PAGE_LIMIT]
        form = {
            "action": "query",
            "prop": "revisions",
            "rvprop": "content",
            "rvslots": "main",
            "titles": "|".join(batch),
            "format": "json",
            "formatversion": "2",
            "redirects": "0",
        }
        payload = _request_json(
            api_url, form, helper=helper, fetcher=fetcher
        )
        error = payload.get("error")
        if error:
            detail = error.get("info") if isinstance(error, dict) else error
            raise BuildError(f"--fetch-selected: API error: {detail}")
        query = payload.get("query")
        raw = query.get("pages") if isinstance(query, dict) else None
        if isinstance(raw, dict):
            raw = list(raw.values())
        if not isinstance(raw, list):
            raise BuildError("--fetch-selected: response has no query.pages list")
        pages.extend(item for item in raw if isinstance(item, dict))
    return pages


def _request_json(
    api_url: str,
    form: Mapping[str, str],
    *,
    helper: str | None,
    fetcher: Callable[[str, Mapping[str, str]], str] | None,
) -> dict[str, Any]:
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
                check=False,
            )
        except (OSError, subprocess.SubprocessError) as exc:
            raise BuildError(f"--fetch-selected: helper failed: {exc}") from exc
        if completed.returncode != 0:
            message = (completed.stderr or "").strip()
            raise BuildError(
                f"--fetch-selected: helper exited {completed.returncode}: "
                f"{message[:400]}"
            )
        body = completed.stdout
    else:
        data = urllib.parse.urlencode(form).encode("utf-8")
        request = urllib.request.Request(
            api_url,
            data=data,
            method="POST",
            headers={
                "User-Agent": "cytus2db-wiki-review/0.1 "
                "(read-only parameter diff)"
            },
        )
        try:
            with urllib.request.urlopen(request, timeout=90) as response:
                body = response.read().decode("utf-8", "replace")
        except (urllib.error.URLError, OSError) as exc:
            raise BuildError(f"--fetch-selected: request failed: {exc}") from exc
    return _json_payload(body)


def _json_payload(body: str) -> dict[str, Any]:
    try:
        data = json.loads(body)
    except json.JSONDecodeError:
        match = re.search(r"<pre[^>]*>(.*?)</pre>", body, re.DOTALL | re.IGNORECASE)
        data = None
        if match is not None:
            try:
                data = json.loads(html.unescape(match.group(1)))
            except json.JSONDecodeError:
                data = None
        if data is None:
            start = body.find("{")
            end = body.rfind("}")
            if start >= 0 and end > start:
                try:
                    data = json.loads(body[start : end + 1])
                except json.JSONDecodeError:
                    data = None
        if data is None:
            raise BuildError("--fetch-selected: response is not JSON")
    if not isinstance(data, dict):
        raise BuildError("--fetch-selected: response is not a JSON object")
    return data


def _revision_content(page: Mapping[str, Any]) -> str | None:
    if page.get("missing") is True:
        return None
    revisions = page.get("revisions")
    if not isinstance(revisions, list) or not revisions:
        return None
    slots = revisions[0].get("slots") if isinstance(revisions[0], dict) else None
    main = slots.get("main") if isinstance(slots, dict) else None
    if not isinstance(main, dict):
        return None
    content = main.get("content")
    if content is None:
        content = main.get("*")
    return content if isinstance(content, str) else None


# ------------------------------------------------------------------ snapshot
def _load_cache(root: Path) -> Snapshot:
    pages_path = root / "pages.json"
    if not pages_path.is_file():
        raise InputError(
            f"batch: {pages_path} is missing. Batch mode reads only the local "
            "pages cache and never refreshes the whole site. Pass "
            "--fetch-selected to fetch just the selected pages, or refresh "
            "the cache explicitly with "
            f"`python tools/wiki_snapshot.py --out {root.as_posix()}`."
        )
    return load_snapshot(root, require_pages=True)


def _snapshot_with_selected_pages(
    root: Path,
    models: list[PageModel],
    selected: list[PageModel],
    profile: Profile,
    *,
    api_url: str,
    helper: str | None,
    fetcher: Callable[[str, Mapping[str, str]], str] | None,
) -> tuple[Snapshot, list[str], list[str]]:
    """Fetch only ``selected`` and build a snapshot that contains just them."""
    base = load_snapshot(root, require_pages=False)
    titles = resolve_titles(models, profile)
    resolver = TitleResolver.from_titles(base.articles, base.redirects)

    requested: dict[str, str] = {}
    owners: dict[str, str] = {}
    requested_titles: list[str] = []
    for model in selected:
        emitted = titles[model.entity_id].title
        site_title = resolver.resolve(emitted)
        template = profile.templates[profile.pages[model.page_type].template].name
        key = normalise_title(site_title)
        if key in requested:
            raise InputError(
                f"batch: {owners[key]} and {model.entity_id} both resolve to "
                f"site title {site_title!r}; a batch can patch one page once"
            )
        requested[key] = template
        owners[key] = model.entity_id
        requested_titles.append(site_title)

    fetched = fetch_selected_pages(
        requested_titles,
        api_url=api_url,
        helper=helper,
        fetcher=fetcher,
    )

    by_key = {key: template for key, template in requested.items()}
    by_loose: dict[str, list[str]] = {}
    for key in by_key:
        by_loose.setdefault(match_key(key), []).append(key)

    page_records: list[SnapshotPage] = []
    seen: set[str] = set()
    for record in fetched:
        title = record.get("title")
        if not isinstance(title, str) or not title:
            raise BuildError("--fetch-selected: page record has no title")
        key = normalise_title(title)
        template = by_key.get(key)
        if template is None:
            loose = by_loose.get(match_key(title), [])
            if len(loose) == 1:
                key = loose[0]
                template = by_key[key]
        if template is None:
            raise BuildError(
                f"--fetch-selected: fetched unexpected page {title!r}"
            )
        content = _revision_content(record)
        if content is None:
            continue  # page exists under no title / has no revision
        cleaned = _COMMENT_RE.sub("", content)
        if _REDIRECT_RE.match(cleaned):
            raise BuildError(
                f"--fetch-selected: {title!r} is a redirect; "
                "select the target page title or entity id"
            )
        try:
            params = template_parameters(cleaned, template)
        except PatchError as exc:
            raise BuildError(
                f"--fetch-selected: {title!r}: {exc}"
            ) from exc
        page_records.append(
            SnapshotPage(title=title, template=template, params=params)
        )
        seen.add(key)

    missing = [owners[key] for key in requested if key not in seen]
    return (
        Snapshot(
            articles=base.articles,
            pages=tuple(page_records),
            redirects=base.redirects,
            pages_available=True,
        ),
        missing,
        requested_titles,
    )


# ------------------------------------------------------------------ markdown
def render_review(
    db_dir: Path | str,
    out_dir: Path | str,
    profile_path: Path | str,
    snapshot_dir: Path | str,
    batch: str,
    *,
    page_type: str | None = None,
    batch_name: str | None = None,
    fetch_selected: bool = False,
    fetch_api: str = DEFAULT_FETCH_API,
    fetch_helper: str | None = None,
    fetcher: Callable[[str, Mapping[str, str]], str] | None = None,
) -> dict[str, object]:
    """Write one review Markdown file and return a summary dict.

    This function is deliberately write-once: the review file is the only
    artifact it creates.  It never writes the snapshot cache, pages, patches
    or the report.
    """
    database = Database.load(db_dir)
    profile = load_profile(profile_path)
    models = build_page_models(database)
    spec = parse_batch_spec(batch)
    selected, excluded = select_pages(models, profile, spec, page_type)
    stem = _batch_stem(batch_name or spec.name)

    root = Path(snapshot_dir)
    fetched_titles: list[str] = []
    missing: list[str] = []
    if fetch_selected:
        snapshot, missing, fetched_titles = _snapshot_with_selected_pages(
            root,
            models,
            selected,
            profile,
            api_url=fetch_api,
            helper=fetch_helper,
            fetcher=fetcher,
        )
    else:
        snapshot = _load_cache(root)

    rendered, plan = render_with_patches(models, profile, snapshot)
    by_entity = {page.model.entity_id: page for page in rendered}
    rows = [(by_entity[model.entity_id], plan[model.entity_id]) for model in selected]

    text = _review_markdown(
        stem=stem,
        rows=rows,
        profile=profile,
        snapshot_dir=root,
        page_type=page_type,
        excluded=excluded,
        fetched=bool(fetch_selected),
        missing=missing,
    )

    review_path = Path(out_dir) / "review" / f"{stem}.md"
    review_path.parent.mkdir(parents=True, exist_ok=True)
    review_path.write_text(text, encoding="utf-8", newline="\n")

    counts = Counter(model.page_type for model in selected)
    return {
        "review": review_path,
        "page_count": len(selected),
        "counts": dict(sorted(counts.items())),
        "excluded": [model.entity_id for model in excluded],
        "fetched": bool(fetch_selected),
        "fetched_titles": fetched_titles,
        "missing": missing,
    }


def _batch_stem(name: str) -> str:
    stem = re.sub(r'[<>:"/\\|?*\x00-\x1f]', "_", name).strip(" .")
    if not stem:
        raise InputError("batch: the output name is empty")
    return stem


def _review_markdown(
    *,
    stem: str,
    rows: list[tuple[RenderedPage, PatchEntry]],
    profile: Profile,
    snapshot_dir: Path,
    page_type: str | None,
    excluded: list[PageModel],
    fetched: bool,
    missing: list[str],
) -> str:
    lines = [
        f"# Wikitext 审阅批次：{stem}",
        "",
        f"- 页面数：{len(rows)}",
        f"- 类型分布：{_counts_text(rows)}",
        f"- 类型过滤：{f'`{page_type}`' if page_type else '无'}",
        f"- 数据来源：{_source_text(snapshot_dir, fetched, len(rows))}",
        (
            "- 写入范围：仅本文件；不写 `pages/`、`patches/`、`report.json`，"
            "也不调用任何写 API"
        ),
    ]
    if excluded:
        detail = ", ".join(
            f"`{model.entity_id}`（{model.page_type}）" for model in excluded
        )
        lines.append(f"- 已按类型过滤排除：{detail}")
    if missing:
        detail = ", ".join(f"`{entity}`" for entity in missing)
        lines.append(f"- 站点未返回（按新页面处理）：{detail}")
    lines.extend(
        [
            "",
            (
                "> 本文件只描述模板参数级改动。模板外的正文段落（人工撰写的轶事、"
                "歌词等）、站内未知参数与未列出的参数都不会被写入，保持原样。"
            ),
            "",
            "| # | 页面 | 类型 | 实体 | 变化 | 状态 |",
            "| --- | --- | --- | --- | --- | --- |",
        ]
    )
    for index, (page, entry) in enumerate(rows, start=1):
        changes = _changes(entry)
        status = "补丁" if entry.patch is not None else "新页"
        lines.append(
            f"| {index} | {_cell(entry.match.title, limit=80)} "
            f"| `{page.model.page_type}` | `{page.model.entity_id}` "
            f"| {len(changes)} | {status} |"
        )
    lines.append("")

    for page, entry in rows:
        lines.extend(
            _page_markdown(
                page=page,
                entry=entry,
                profile=profile,
                batch_stem=stem,
            )
        )
        lines.extend(["", "---", ""])
    lines.append(
        "本文件由 `cytus2db render --patches --batch` 生成，仅用于只读审阅；"
        "应用修改后请重新生成同一批次复核。"
    )
    lines.append("")
    return "\n".join(lines)


def _counts_text(rows: list[tuple[RenderedPage, PatchEntry]]) -> str:
    counts = Counter(page.model.page_type for page, _ in rows)
    return ", ".join(f"`{name}`={count}" for name, count in sorted(counts.items()))


def _source_text(snapshot_dir: Path, fetched: bool, count: int) -> str:
    if fetched:
        return f"按选中页面单独抓取（{count} 页），未刷新整站快照"
    return f"本地快照 `{snapshot_dir.as_posix()}`（`pages.json`，未联网）"


def _page_markdown(
    *,
    page: RenderedPage,
    entry: PatchEntry,
    profile: Profile,
    batch_stem: str,
) -> list[str]:
    title = entry.match.title
    changes = _changes(entry)
    existing = entry.match.existing
    lines = [
        f"## {title}",
        "",
        f"- 实体：`{page.model.entity_id}`",
        f"- 类型：`{page.model.page_type}`",
        f"- 模板：`{page.template}`",
        f"- 标题来源：`{entry.match.source}`",
    ]
    if entry.match.matched:
        lines.append("- 站内状态：已存在（参数级补丁）")
    else:
        lines.append(
            "- 站内状态：未匹配（没有可应用的补丁；本工具不创建页面）"
        )
    lines.append(f"- 页面地址：{_page_url(title)}")
    lines.extend(["", f"### 参数变化（{len(changes)}）", ""])

    if changes:
        lines.extend(
            [
                "| 参数 | 旧值 | 新值 |",
                "| --- | --- | --- |",
            ]
        )
        for name in sorted(changes):
            old_text = _old_value(existing, name)
            lines.append(
                f"| `{name}` | {old_text} | {_preview(changes[name])} |"
            )
        truncated = any(
            len(str(value)) > _CELL_LIMIT for value in changes.values()
        ) or (
            existing is not None
            and any(
                len(existing.params.get(name, "")) > _CELL_LIMIT
                for name in changes
            )
        )
        if truncated:
            lines.append("")
            lines.append(
                f"> 表格中超过 {_CELL_LIMIT} 字符的旧值或新值以 `…` 截断；"
                "完整新值见下方参数块。"
            )
    else:
        if existing is None:
            lines.append("站内没有匹配页面，无法比较参数；以下为新页参数块。")
        else:
            lines.append("无参数变化（站内参数与本次渲染一致），无需编辑。")

    lines.extend(
        [
            "",
            "### 新参数块",
            "",
            (
                "> 仅供核对。已有页面请逐参数替换；整块粘贴会覆盖站内未知参数与"
                "人工内容。"
                if entry.patch is not None
                else "> 站内没有此页；如需新建，可人工复制以下参数块。"
            ),
            "",
            "````wikitext",
            template_block(page.wikitext, page.template),
            "````",
            "",
            "### 保留项",
            "",
        ]
    )
    lines.extend(_preservation_items(page, entry, profile))
    lines.extend(["", "### 省略/冲突/未知参数", ""])
    lines.extend(_omitted_markdown(page))
    lines.extend(["", "**冲突**", ""])
    lines.extend(_conflict_markdown(page, entry))
    lines.extend(["", "**未知参数**", ""])
    lines.extend(
        _unknown_markdown(
            existing, entry.page.params, set(profile.templates[page.template].params)
        )
    )
    lines.extend(["", "### 人工应用步骤", ""])
    lines.extend(_apply_steps(title, entry, changes, batch_stem))
    return lines


def _changes(entry: PatchEntry) -> dict[str, str]:
    patch = entry.patch or {}
    params = patch.get("params")
    if not isinstance(params, dict):
        return {}
    return {str(name): str(value) for name, value in params.items()}


def _old_value(existing: SnapshotPage | None, name: str) -> str:
    if existing is None or name not in existing.params:
        return "（站内无此参数）"
    return _preview(existing.params[name])


def _cell(value: Any, *, limit: int = _CELL_LIMIT) -> str:
    text = "" if value is None else str(value)
    if len(text) > limit:
        text = text[:limit].rstrip() + "…"
    text = html.escape(text, quote=False)
    return text.replace("\n", "<br>").replace("|", "&#124;")


def _preview(value: Any, *, limit: int = _CELL_LIMIT) -> str:
    """Render a value for prose/tables, making an empty value explicit."""
    return _cell(value, limit=limit) or "（空）"


def _preservation_items(
    page: RenderedPage, entry: PatchEntry, profile: Profile
) -> list[str]:
    items: list[str] = []
    sections = HUMAN_SECTIONS.get(page.model.page_type, ())
    for section in sections:
        items.append(f"`== {section} ==`：人工段落，本工具不写入，保留")
    if not sections:
        items.append(
            "`== 轶事 ==` / `== 歌词 ==`（如站内存在）：人工段落，"
            "本工具不写入，保留"
        )
    existing = entry.match.existing
    known = set(profile.templates[page.template].params)
    unknown = _unknown_params(existing, entry.page.params, known)
    if unknown:
        items.append(
            f"站内未知参数（{len(unknown)} 项）：保留原值，见下方「未知参数」"
        )
    if existing is not None:
        human = [
            name
            for name in sorted(existing.params)
            if name in HUMAN_PARAMS and name not in entry.page.params
        ]
        for name in human:
            raw = existing.params[name]
            shown = f"（{_preview(raw, limit=80)}）" if raw else "（空）"
            items.append(f"`|{name}`：人工维护参数，保留站内原值{shown}")
    omitted = list(page.omitted)
    if omitted:
        items.append(
            f"渲染器省略的参数（{len(omitted)} 项）：不写入，"
            "站内已有值保持原样（明细见下）"
        )
    items.append("模板外正文（如有）：保留")
    return [f"- {item}" for item in items]


def _omitted_markdown(page: RenderedPage) -> list[str]:
    omitted = list(page.omitted)
    if not omitted:
        return ["- 省略参数：无"]
    lines = [
        f"**省略参数（{len(omitted)}）**",
        "",
        "| 参数 | 字段 | 原因 |",
        "| --- | --- | --- |",
    ]
    for item in omitted:
        reason = _REASON_LABELS.get(item.reason, item.reason)
        if item.param in HUMAN_PARAMS:
            reason = f"{reason}；人工维护"
        param = f"`{item.param}`" if item.param else "—"
        lines.append(
            f"| {param} | {_cell(item.field, limit=60)} "
            f"| {reason}（`{item.reason}`） |"
        )
    return lines


def _conflict_markdown(page: RenderedPage, entry: PatchEntry) -> list[str]:
    conflicts = _dedupe_conflicts([*page.conflicts, *entry.match.conflicts])
    if not conflicts:
        return ["- 无"]
    return [f"- `{conflict.kind}`：{_cell(conflict.detail)}" for conflict in conflicts]


def _unknown_params(
    existing: SnapshotPage | None,
    rendered: Mapping[str, str],
    known: set[str],
) -> list[str]:
    if existing is None:
        return []
    return [
        name
        for name in sorted(existing.params)
        if name not in rendered and name not in known and name not in HUMAN_PARAMS
    ]


def _unknown_markdown(
    existing: SnapshotPage | None,
    rendered: Mapping[str, str],
    known: set[str],
) -> list[str]:
    if existing is None:
        return ["- 无（站内没有匹配页面，没有可保留的站内参数）"]
    unknown = _unknown_params(existing, rendered, known)
    return [
        f"- `|{name}`：{_preview(existing.params[name], limit=80)}"
        "（站内未知参数，保留原值）"
        for name in unknown
    ] or ["- 无"]


def _apply_steps(
    title: str,
    entry: PatchEntry,
    changes: Mapping[str, str],
    batch_stem: str,
) -> list[str]:
    if entry.patch is None:
        return [
            (
                "> 站内没有匹配页面：本批次没有可应用的补丁。本工具不创建页面；"
                "如需新建，请人工核对上方参数块后自行创建。"
            )
        ]
    if not changes:
        return ["该页没有参数变化，无需编辑。"]
    names = "、".join(f"`{name}`" for name in sorted(changes))
    return [
        f"1. 打开 {_page_url(title)}。",
        "2. 点击「编辑」→「源代码编辑」。",
        (
            f"3. 在 `{{{{{entry.page.template}}}}}` 内**只**替换这些参数：{names}；"
            "其余参数、站内未知参数与模板外正文不要动。"
        ),
        "4. 点击「显示预览」，确认信息框与正文渲染正常、没有模板报错。",
        f"5. 填写编辑摘要 `参数同步：{batch_stem}` 并保存。",
    ]


def _page_url(title: str) -> str:
    target = urllib.parse.quote(title.replace(" ", "_"), safe="")
    return f"https://wiki.biligame.com/cytus2/{target}"


def _dedupe_conflicts(conflicts: Iterable[Conflict]) -> list[Conflict]:
    unique: dict[tuple[str, str], Conflict] = {}
    for conflict in conflicts:
        unique[(conflict.kind, conflict.detail)] = conflict
    return [unique[key] for key in sorted(unique)]
