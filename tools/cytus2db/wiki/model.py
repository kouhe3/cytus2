"""Dialect-independent page model.

A page model is what an entity looks like as a wiki page before any wiki
dialect is chosen: ordered sections, fields with semantic names, link targets
and category keys.  Nothing here knows about MediaWiki templates or Chinese
parameter names; that mapping lives in a profile consumed by the renderer.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Iterable, Union


@dataclass(frozen=True)
class Link:
    """A link to another page, by target title."""

    target: str
    label: str = ""

    def __post_init__(self) -> None:
        if not self.target:
            raise ValueError("link target must not be empty")
        if not self.label:
            object.__setattr__(self, "label", self.target)


@dataclass(frozen=True)
class Text:
    """A run of text that may contain links."""

    parts: tuple[Union[str, Link], ...]

    @classmethod
    def of(cls, *parts: Union[str, Link, "Text"]) -> "Text":
        flattened: list[Union[str, Link]] = []
        for part in parts:
            if isinstance(part, Text):
                flattened.extend(part.parts)
            else:
                flattened.append(part)
        return cls(tuple(flattened))

    def plain(self) -> str:
        return "".join(
            part if isinstance(part, str) else part.label for part in self.parts
        )

    def links(self) -> tuple[Link, ...]:
        return tuple(part for part in self.parts if isinstance(part, Link))

    def __bool__(self) -> bool:
        return bool(self.plain().strip())


@dataclass(frozen=True)
class Field:
    """One semantic field.  ``name`` is site-independent (``rating.Chaos``)."""

    name: str
    value: Text


@dataclass(frozen=True)
class Section:
    """An ordered page section.

    ``kind="template"`` is the infobox/template section that a renderer maps
    through the profile.  Other kinds are reserved for page bodies added by
    later tickets.
    """

    kind: str
    fields: tuple[Field, ...] = ()


@dataclass(frozen=True)
class Conflict:
    """A reviewable problem found while building or rendering a page."""

    kind: str
    detail: str


SEMANTIC_TEMPLATE = "template"


@dataclass
class PageModel:
    """One entity rendered into sections, fields, links and categories."""

    entity_id: str
    page_type: str
    sections: tuple[Section, ...]
    categories: tuple[str, ...] = ()
    omitted: dict[str, str] = field(default_factory=dict)
    conflicts: tuple[Conflict, ...] = ()

    def fields(self) -> Iterable[Field]:
        for section in self.sections:
            yield from section.fields

    def field(self, name: str) -> Text | None:
        for item in self.fields():
            if item.name == name:
                return item.value
        return None

    def field_value(self, name: str) -> str:
        value = self.field(name)
        return value.plain().strip() if value is not None else ""

    def links(self) -> tuple[Link, ...]:
        found: list[Link] = []
        for item in self.fields():
            found.extend(item.value.links())
        return tuple(found)

    def game_id(self) -> str:
        return self.entity_id.split("/", 1)[-1]
