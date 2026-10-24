"""BiliGame MediaWiki renderer driven by a hand-written profile.

The renderer is deliberately thin: it maps semantic page-model fields to the
profile's parameter names, serialises links, checks that every emitted
parameter exists in the profile and writes the template block.  Entity
knowledge stays in the page-model builders.
"""

from __future__ import annotations

import json
import re
from collections import Counter
from dataclasses import dataclass
from pathlib import Path
from typing import Any, Iterable

from ..errors import BuildError, InputError
from ..provenance import is_cited, sorted_entries
from .model import Conflict, Link, PageModel, Text
from .titles import (
    IGNORED_TARGET_PREFIXES,
    TitleResolver,
    normalise_title,
)

_LINK_RE = re.compile(r"\[\[([^\[\]\n]+?)\]\]")


@dataclass(frozen=True)
class ParameterSpec:
    name: str
    required: bool
    conditional: bool
    # ``allow_empty`` marks a parameter the renderer may emit with an empty
    # value.  The verifier only tolerates empty values for these parameters.
    allow_empty: bool = False


@dataclass(frozen=True)
class TemplateSpec:
    name: str
    param_order: tuple[str, ...]
    params: dict[str, ParameterSpec]
    fields: dict[str, str]


@dataclass(frozen=True)
class PageSpec:
    page_type: str
    template: str
    title_field: str
    title_fallback: str
    disambiguator: str


@dataclass(frozen=True)
class ProvenanceSectionSpec:
    enabled: bool
    heading: str


@dataclass(frozen=True)
class Profile:
    site: str
    categories: dict[str, str]
    templates: dict[str, TemplateSpec]
    pages: dict[str, PageSpec]
    body_templates: dict[str, str]
    provenance_section: ProvenanceSectionSpec
    path: Path


@dataclass(frozen=True)
class TitleMatch:
    title: str
    source: str
    conflicts: tuple[Conflict, ...] = ()


@dataclass(frozen=True)
class OmittedParameter:
    param: str | None
    field: str | None
    reason: str

    def as_dict(self) -> dict[str, str]:
        value = {}
        if self.param:
            value["param"] = self.param
        if self.field:
            value["field"] = self.field
        value["reason"] = self.reason
        return value


@dataclass(frozen=True)
class RenderedPage:
    model: PageModel
    title: str
    title_source: str
    template: str
    wikitext: str
    emitted: tuple[str, ...]
    omitted: tuple[OmittedParameter, ...]
    conflicts: tuple[Conflict, ...]
    categories: tuple[str, ...]
    links: tuple[Link, ...]
    unresolved_links: tuple[str, ...] = ()


# ------------------------------------------------------------------- profile
def load_profile(path: Path | str) -> Profile:
    source = Path(path)
    if not source.is_file():
        raise InputError(f"wiki profile not found: {source}")
    try:
        data = json.loads(source.read_text(encoding="utf-8-sig"))
    except json.JSONDecodeError as exc:
        raise InputError(f"invalid JSON in {source}: {exc}") from exc
    if not isinstance(data, dict):
        raise InputError(f"{source}: profile must be a JSON object")

    overlay_dir = source.parent / f"{source.stem}.d"
    if overlay_dir.is_dir():
        for overlay in sorted(overlay_dir.glob("*.json")):
            try:
                extra = json.loads(overlay.read_text(encoding="utf-8-sig"))
            except json.JSONDecodeError as exc:
                raise InputError(f"invalid JSON in {overlay}: {exc}") from exc
            if not isinstance(extra, dict):
                raise InputError(f"{overlay}: profile overlay must be a JSON object")
            _deep_merge(data, extra)

    site = str(data.get("site") or "")
    if not site:
        raise BuildError(f"{source}: missing site")
    categories = data.get("categories") or {}
    if not isinstance(categories, dict) or not all(
        isinstance(key, str) and isinstance(value, str)
        for key, value in categories.items()
    ):
        raise BuildError(f"{source}: categories must map strings to strings")

    raw_templates = data.get("templates")
    if not isinstance(raw_templates, dict) or not raw_templates:
        raise BuildError(f"{source}: templates must be a non-empty object")
    templates: dict[str, TemplateSpec] = {}
    for name, raw in raw_templates.items():
        templates[name] = _load_template(source, name, raw)

    raw_pages = data.get("pages")
    if not isinstance(raw_pages, dict) or not raw_pages:
        raise BuildError(f"{source}: pages must be a non-empty object")
    pages: dict[str, PageSpec] = {}
    for page_type, raw in raw_pages.items():
        pages[page_type] = _load_page(source, page_type, raw, templates)

    body_templates = _load_body_templates(source, data.get("body_templates") or {})
    provenance_section = _load_provenance_section(
        source, data.get("provenance_section") or {}
    )

    return Profile(
        site=site,
        categories=dict(categories),
        templates=templates,
        pages=pages,
        body_templates=body_templates,
        provenance_section=provenance_section,
        path=source,
    )


def _load_body_templates(source: Path, raw: Any) -> dict[str, str]:
    """Load the helper templates page bodies may invoke.

    Page builders emit ``{{引用段落|…}}``, ``{{os/对话|…}}`` and similar
    dialect templates inside parameter values.  Declaring them here is what
    lets :func:`render_page` reject an undeclared template instead of
    publishing wikitext the profile does not know.
    """
    where = f"{source}: body_templates"
    if not isinstance(raw, dict):
        raise BuildError(f"{where} must be an object")
    templates: dict[str, str] = {}
    for key, value in raw.items():
        if not isinstance(key, str) or not key.strip():
            raise BuildError(f"{where}: keys must be non-empty strings")
        if not isinstance(value, str) or not value.strip():
            raise BuildError(f"{where}[{key!r}] must be a non-empty string")
        templates[key] = value
    if len(set(templates.values())) != len(templates):
        raise BuildError(f"{where}: template names must be unique")
    return templates


def _load_provenance_section(source: Path, raw: Any) -> ProvenanceSectionSpec:
    where = f"{source}: provenance_section"
    if not isinstance(raw, dict):
        raise BuildError(f"{where} must be an object")
    enabled = raw.get("enabled", False)
    heading = raw.get("heading", "")
    if not isinstance(enabled, bool):
        raise BuildError(f"{where}.enabled must be bool")
    if not isinstance(heading, str):
        raise BuildError(f"{where}.heading must be a string")
    if enabled and not heading.strip():
        raise BuildError(f"{where}.heading must not be empty when enabled")
    if not enabled and not heading:
        heading = "数据来源"
    return ProvenanceSectionSpec(enabled=enabled, heading=heading)


def _deep_merge(base: dict, overlay: dict) -> None:
    for key, value in overlay.items():
        if isinstance(value, dict) and isinstance(base.get(key), dict):
            _deep_merge(base[key], value)
        else:
            base[key] = value


def _load_template(source: Path, name: str, raw: Any) -> TemplateSpec:
    where = f"{source}: templates[{name!r}]"
    if not isinstance(raw, dict):
        raise BuildError(f"{where} must be an object")
    template_name = str(raw.get("template") or name)
    raw_params = raw.get("params")
    if not isinstance(raw_params, dict) or not raw_params:
        raise BuildError(f"{where}.params must be a non-empty object")
    params: dict[str, ParameterSpec] = {}
    for param_name, meta in raw_params.items():
        if not isinstance(meta, dict):
            raise BuildError(f"{where}.params[{param_name!r}] must be an object")
        required = meta.get("required", False)
        conditional = meta.get("conditional", False)
        allow_empty = meta.get("allow_empty", False)
        if not isinstance(required, bool):
            raise BuildError(f"{where}.params[{param_name!r}].required must be bool")
        if not isinstance(conditional, bool):
            raise BuildError(f"{where}.params[{param_name!r}].conditional must be bool")
        if not isinstance(allow_empty, bool):
            raise BuildError(
                f"{where}.params[{param_name!r}].allow_empty must be bool"
            )
        params[param_name] = ParameterSpec(
            param_name, required, conditional, allow_empty
        )

    raw_order = raw.get("param_order")
    if not isinstance(raw_order, list) or not raw_order:
        raise BuildError(f"{where}.param_order must be a non-empty list")
    order = tuple(str(item) for item in raw_order)
    if len(order) != len(set(order)):
        raise BuildError(f"{where}.param_order contains duplicates")
    if set(order) != set(params):
        missing = sorted(set(params) - set(order))
        extra = sorted(set(order) - set(params))
        raise BuildError(
            f"{where}.param_order must list every parameter exactly once"
            f" (missing={missing}, extra={extra})"
        )

    raw_fields = raw.get("fields")
    if not isinstance(raw_fields, dict) or not raw_fields:
        raise BuildError(f"{where}.fields must be a non-empty object")
    fields: dict[str, str] = {}
    for semantic, param in raw_fields.items():
        if not isinstance(semantic, str) or not isinstance(param, str):
            raise BuildError(f"{where}.fields must map strings to strings")
        if param not in params:
            raise BuildError(
                f"{where}.fields[{semantic!r}] points at unknown parameter {param!r}"
            )
        fields[semantic] = param
    return TemplateSpec(template_name, order, params, fields)


def _load_page(
    source: Path,
    page_type: str,
    raw: Any,
    templates: dict[str, TemplateSpec],
) -> PageSpec:
    where = f"{source}: pages[{page_type!r}]"
    if not isinstance(raw, dict):
        raise BuildError(f"{where} must be an object")
    template = str(raw.get("template") or "")
    if template not in templates:
        raise BuildError(f"{where}.template {template!r} is not defined")
    title = raw.get("title")
    if not isinstance(title, dict):
        raise BuildError(f"{where}.title must be an object")
    title_field = str(title.get("field") or "")
    if not title_field:
        raise BuildError(f"{where}.title.field must not be empty")
    title_fallback = str(title.get("fallback") or "game_id")
    if title_fallback not in ("game_id", "none"):
        raise BuildError(f"{where}.title.fallback must be 'game_id' or 'none'")
    disambiguator = str(title.get("disambiguator") or "（{game_id}）")
    if "{game_id}" not in disambiguator:
        raise BuildError(f"{where}.title.disambiguator must contain {{game_id}}")
    return PageSpec(
        page_type=page_type,
        template=template,
        title_field=title_field,
        title_fallback=title_fallback,
        disambiguator=disambiguator,
    )


# -------------------------------------------------------------------- titles
def resolve_titles(
    models: Iterable[PageModel], profile: Profile
) -> dict[str, TitleMatch]:
    """Resolve page titles from the profile's title rule.

    Collisions are counted by the shared MediaWiki title key, so spellings
    that would publish as the same page (``illMenate``/``IllMenate``) are
    disambiguated instead of overwriting each other.  Existing-page matching
    then replaces these proposals in ``plan_patches``.
    """
    proposals: dict[str, tuple[str, str, str]] = {}
    for model in sorted(models, key=lambda item: item.entity_id):
        spec = profile.pages.get(model.page_type)
        if spec is None:
            raise BuildError(f"{model.entity_id}: no page rule for {model.page_type!r}")
        value = model.field_value(spec.title_field)
        if value:
            proposals[model.entity_id] = (value, "generated", model.page_type)
            continue
        if spec.title_fallback == "none":
            raise BuildError(
                f"{model.entity_id}: title field {spec.title_field!r} is empty"
            )
        proposals[model.entity_id] = (model.game_id(), "generated:game_id", model.page_type)

    # Two titles that normalise to the same MediaWiki key are one page: a
    # second full page would overwrite the first instead of disambiguating.
    counts = Counter(
        normalise_title(title) for title, _, _ in proposals.values()
    )
    resolved: dict[str, TitleMatch] = {}
    for entity_id, (title, source, page_type) in proposals.items():
        conflicts: list[Conflict] = []
        if counts[normalise_title(title)] > 1:
            conflicts.append(
                Conflict(
                    "title_conflict",
                    f"{title!r} shared by {counts[normalise_title(title)]} pages",
                )
            )
            game_id = entity_id.split("/", 1)[-1]
            title = profile.pages[page_type].disambiguator.format(
                game_id=game_id
            )
            source = "generated:disambiguated"
        resolved[entity_id] = TitleMatch(title, source, tuple(conflicts))
    return resolved


# -------------------------------------------------------------------- render
def render_page(
    model: PageModel,
    profile: Profile,
    title_match: TitleMatch,
    resolver: TitleResolver | None = None,
) -> RenderedPage:
    spec = profile.pages.get(model.page_type)
    if spec is None:
        raise BuildError(f"{model.entity_id}: no page rule for {model.page_type!r}")
    template = profile.templates[spec.template]

    values: dict[str, str] = {}
    omitted: list[OmittedParameter] = []
    omitted_params: set[str] = set()
    unresolved_links: list[str] = []
    conflicts = list(model.conflicts) + list(title_match.conflicts)

    for field in model.fields():
        if field.name not in template.fields:
            omitted.append(
                OmittedParameter(None, field.name, "no_profile_parameter")
            )
            continue
        param = template.fields[field.name]
        if param not in template.params:
            raise BuildError(
                f"{model.entity_id}: field {field.name!r} maps to unknown "
                f"parameter {param!r} in {profile.path}"
            )
        value = _render_text(field.value, resolver)
        if resolver is not None:
            value, missing = _canonicalise_links(value, resolver)
            for target in missing:
                if target not in unresolved_links:
                    unresolved_links.append(target)
        if not value.strip():
            if not template.params[param].allow_empty:
                omitted.append(OmittedParameter(param, field.name, "empty_value"))
                omitted_params.add(param)
                continue
            # ``allow_empty`` parameters are always emitted, even with an
            # empty value: a template whose default is malformed (``ver``)
            # must receive an explicit value so the default never leaks.
        if param in values:
            raise BuildError(
                f"{model.entity_id}: parameter {param!r} emitted twice"
            )
        values[param] = value

    _validate_body_templates(values, template, profile, model.entity_id)

    for param, meta in template.params.items():
        if meta.required and param not in values:
            raise BuildError(
                f"{model.entity_id}: required parameter {param!r} is missing"
            )

    reverse = {param: field for field, param in template.fields.items()}
    for param in template.param_order:
        if param in values:
            continue
        if param in omitted_params:
            continue
        field = reverse.get(param)
        if field is not None and field in model.omitted:
            reason = model.omitted[field]
        elif template.params[param].conditional:
            reason = "conditional_omitted"
        else:
            reason = "no_verifiable_value"
        omitted.append(OmittedParameter(param, field, reason))

    lines = ["{{" + template.name]
    for param in template.param_order:
        if param in values:
            lines.append(f"|{param}={values[param]}")
    lines.append("}}")

    categories: list[str] = []
    for key in model.categories:
        target = profile.categories.get(key)
        if not target:
            raise BuildError(
                f"{model.entity_id}: category key {key!r} is not in the profile"
            )
        categories.append(target)
        lines.append(f"[[{target}]]")

    lines.extend(_provenance_lines(model, profile))

    return RenderedPage(
        model=model,
        title=title_match.title,
        title_source=title_match.source,
        template=template.name,
        wikitext="\n".join(lines) + "\n",
        emitted=tuple(
            param for param in template.param_order if param in values
        ),
        omitted=tuple(omitted),
        conflicts=tuple(_dedupe_conflicts(conflicts)),
        categories=tuple(categories),
        links=tuple(_render_link(link, resolver) for link in model.links()),
        unresolved_links=tuple(unresolved_links),
    )


_BODY_TEMPLATE_RE = re.compile(r"\{\{\s*([^{}|]+?)\s*(?:\||\}\})")
_PROVENANCE_LABELS = {
    "text_asset": "游戏数据",
    "rva": "反编译数据",
    "manual": "人工补充",
    "external": "外部资料",
}


def _validate_body_templates(
    values: dict[str, str],
    template: TemplateSpec,
    profile: Profile,
    entity_id: str,
) -> None:
    """Reject a parameter that invokes an undeclared helper template."""
    # Template names are MediaWiki titles: only the first letter is case
    # insensitive, so ``os/对话`` and ``Os/对话`` are one template.
    allowed = {
        normalise_title(name)
        for name in (template.name, *profile.body_templates.values())
    }
    for param, value in values.items():
        for name in _BODY_TEMPLATE_RE.findall(value):
            if normalise_title(name) not in allowed:
                raise BuildError(
                    f"{entity_id}: parameter {param!r} emits template "
                    f"{name!r}, which is not declared in "
                    f"{profile.path}:body_templates"
                )


def _provenance_lines(model: PageModel, profile: Profile) -> list[str]:
    """Render the bottom ``== 数据来源 ==`` section.

    Every locator is listed; manual and external facts are cited with
    ``<ref>`` because they cannot be reproduced from the APK alone.
    """
    spec = profile.provenance_section
    entries = sorted_entries(model.provenance)
    if not spec.enabled or not entries:
        return []
    lines = ["", f"== {spec.heading} =="]
    for entry in entries:
        kind = str(entry.get("kind") or "")
        label = _PROVENANCE_LABELS.get(kind, kind)
        locator = str(entry.get("locator") or "")
        note = str(entry.get("note") or "").strip()
        if is_cited(entry):
            body = f"{locator}：{note}" if note else locator
            lines.append(f"* {label}：<ref>{body}</ref>")
        else:
            suffix = f"（{note}）" if note else ""
            lines.append(f"* {label}：<code>{locator}</code>{suffix}")
    return lines


def _render_link(link: Link, resolver: TitleResolver | None) -> Link:
    target = resolver.resolve(link.target) if resolver is not None else link.target
    label = target if link.label == link.target else link.label
    return Link(target, label)


def _render_text(text: Text, resolver: TitleResolver | None = None) -> str:
    pieces = []
    for part in text.parts:
        if isinstance(part, Link):
            target = (
                resolver.resolve(part.target) if resolver is not None else part.target
            )
            label = target if part.label == part.target else part.label
            if label == target:
                pieces.append(f"[[{target}]]")
            else:
                pieces.append(f"[[{target}|{label}]]")
        else:
            pieces.append(part)
    return "".join(pieces)


def _canonicalise_links(
    text: str, resolver: TitleResolver
) -> tuple[str, tuple[str, ...]]:
    """Rewrite literal ``[[target]]`` links to the site's canonical spelling.

    Page builders occasionally emit wikitext links as plain strings (unlock
    lists, gallery captions).  Resolving them here keeps link emission in one
    place instead of asking every builder to construct ``Link`` objects.
    Targets that cannot be resolved are returned unchanged and reported.
    """
    unresolved: list[str] = []

    def replace(match: re.Match[str]) -> str:
        raw = match.group(1)
        target_part, separator, label = raw.partition("|")
        target = target_part.strip()
        if not target or target.startswith(":"):
            return match.group(0)
        if target.casefold().startswith(IGNORED_TARGET_PREFIXES):
            return match.group(0)
        canonical = resolver.resolve(target)
        known = resolver.is_known(canonical)
        if canonical == target and "#" in target:
            base, _, fragment = target.partition("#")
            resolved_base = resolver.resolve(base.strip())
            if resolved_base != base.strip():
                canonical = f"{resolved_base}#{fragment}"
                known = resolver.is_known(resolved_base)
        if not known:
            if canonical not in unresolved:
                unresolved.append(canonical)
            return match.group(0)
        if canonical == target:
            return match.group(0)
        tail = separator + label if separator else ""
        return f"[[{canonical}{tail}]]"

    return _LINK_RE.sub(replace, text), tuple(unresolved)


def _dedupe_conflicts(conflicts: Iterable[Conflict]) -> list[Conflict]:
    unique: dict[tuple[str, str], Conflict] = {}
    for conflict in conflicts:
        unique[(conflict.kind, conflict.detail)] = conflict
    return [unique[key] for key in sorted(unique)]
