"""BiliGame MediaWiki renderer driven by a hand-written profile.

The renderer is deliberately thin: it maps semantic page-model fields to the
profile's parameter names, serialises links, checks that every emitted
parameter exists in the profile and writes the template block.  Entity
knowledge stays in the page-model builders.
"""

from __future__ import annotations

import json
from collections import Counter
from dataclasses import dataclass
from pathlib import Path
from typing import Any, Iterable

from ..errors import BuildError, InputError
from .model import Conflict, Link, PageModel, Text


@dataclass(frozen=True)
class ParameterSpec:
    name: str
    required: bool
    conditional: bool
    default: str


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
    preserve_unknown_params: bool
    observed_unknown_params: tuple[str, ...]


@dataclass(frozen=True)
class Profile:
    site: str
    categories: dict[str, str]
    templates: dict[str, TemplateSpec]
    pages: dict[str, PageSpec]
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

    return Profile(
        site=site,
        categories=dict(categories),
        templates=templates,
        pages=pages,
        path=source,
    )


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
        default = meta.get("default", "")
        if not isinstance(required, bool):
            raise BuildError(f"{where}.params[{param_name!r}].required must be bool")
        if not isinstance(conditional, bool):
            raise BuildError(f"{where}.params[{param_name!r}].conditional must be bool")
        if not isinstance(default, str):
            raise BuildError(f"{where}.params[{param_name!r}].default must be a string")
        params[param_name] = ParameterSpec(param_name, required, conditional, default)

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
    preserve = raw.get("preserve_unknown_params", True)
    if not isinstance(preserve, bool):
        raise BuildError(f"{where}.preserve_unknown_params must be bool")
    observed = raw.get("observed_unknown_params") or []
    if not isinstance(observed, list) or not all(isinstance(item, str) for item in observed):
        raise BuildError(f"{where}.observed_unknown_params must be a string list")
    return PageSpec(
        page_type=page_type,
        template=template,
        title_field=title_field,
        title_fallback=title_fallback,
        disambiguator=disambiguator,
        preserve_unknown_params=preserve,
        observed_unknown_params=tuple(observed),
    )


# -------------------------------------------------------------------- titles
def resolve_titles(
    models: Iterable[PageModel], profile: Profile
) -> dict[str, TitleMatch]:
    """Resolve page titles from the profile's title rule.

    Colliding base titles are disambiguated deterministically.  Existing-page
    matching (snapshot) belongs to ticket #12 and will extend this report
    source, not replace the rule.
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

    counts = Counter(title for title, _, _ in proposals.values())
    resolved: dict[str, TitleMatch] = {}
    for entity_id, (title, source, page_type) in proposals.items():
        conflicts: list[Conflict] = []
        if counts[title] > 1:
            conflicts.append(
                Conflict("title_conflict", f"{title!r} shared by {counts[title]} pages")
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
) -> RenderedPage:
    spec = profile.pages.get(model.page_type)
    if spec is None:
        raise BuildError(f"{model.entity_id}: no page rule for {model.page_type!r}")
    template = profile.templates[spec.template]

    values: dict[str, str] = {}
    omitted: list[OmittedParameter] = []
    omitted_params: set[str] = set()
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
        value = _render_text(field.value)
        if not value.strip():
            omitted.append(OmittedParameter(param, field.name, "empty_value"))
            omitted_params.add(param)
            continue
        if param in values:
            raise BuildError(
                f"{model.entity_id}: parameter {param!r} emitted twice"
            )
        values[param] = value

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
        links=model.links(),
    )


def _render_text(text: Text) -> str:
    pieces = []
    for part in text.parts:
        if isinstance(part, Link):
            if part.label == part.target:
                pieces.append(f"[[{part.target}]]")
            else:
                pieces.append(f"[[{part.target}|{part.label}]]")
        else:
            pieces.append(part)
    return "".join(pieces)


def _dedupe_conflicts(conflicts: Iterable[Conflict]) -> list[Conflict]:
    unique: dict[tuple[str, str], Conflict] = {}
    for conflict in conflicts:
        unique[(conflict.kind, conflict.detail)] = conflict
    return [unique[key] for key in sorted(unique)]
