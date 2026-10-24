"""Provenance entries shared by entities, edges and extension modules.

Every derived record carries a ``provenance`` list of ``{kind, locator, note?}``
entries (see ``schema/common.schema.json``).  The four kinds are:

``text_asset``
    A JSON table or TextAsset field the value was read from.
``rva``
    A decompiled symbol (``il2cppdumper/dump.cs:<name>``).
``manual``
    A hand-maintained fact such as an alias override or a derived label.
``external``
    A fact taken from outside the APK (site text, a documented inference).

Keeping the constructors and the ordering in one module is what makes entity,
edge and extension records comparable: entries sort by
``(kind, locator, note)`` and exact duplicates collapse, so re-ordering a
builder or merging two sources never changes the artifact.
"""

from __future__ import annotations

from typing import Any, Iterable

# Provenance kinds that must be cited with a wiki ``<ref>`` because they are
# not reproducible from the APK alone.
CITED_KINDS = frozenset({"manual", "external"})


def _entry(kind: str, locator: str, note: str | None) -> dict[str, str]:
    if not locator:
        raise ValueError("provenance locator must not be empty")
    entry = {"kind": kind, "locator": locator}
    if note:
        entry["note"] = note
    return entry


def text_asset(locator: str, note: str | None = None) -> dict[str, str]:
    """A JSON table or TextAsset field."""
    return _entry("text_asset", locator, note)


def rva(locator: str, note: str | None = None) -> dict[str, str]:
    """A decompiled symbol (``il2cppdumper/dump.cs:<name>``)."""
    return _entry("rva", locator, note)


def manual(locator: str, note: str | None = None) -> dict[str, str]:
    """A hand-maintained fact, recorded with its source file and symbol."""
    return _entry("manual", locator, note)


def external(locator: str, note: str | None = None) -> dict[str, str]:
    """A fact from outside the APK (site text, documented inference)."""
    return _entry("external", locator, note)


def sorted_entries(
    entries: Iterable[dict[str, str]],
) -> list[dict[str, str]]:
    """Return ``entries`` deduplicated and ordered deterministically."""
    unique = {
        (entry.get("kind"), entry.get("locator"), entry.get("note")): entry
        for entry in entries
        if entry.get("kind") and entry.get("locator")
    }
    return [
        unique[key]
        for key in sorted(
            unique, key=lambda item: (item[0], item[1], item[2] or "")
        )
    ]


def sort_record(record: dict[str, Any]) -> None:
    """Sort ``record["provenance"]`` in place."""
    record["provenance"] = sorted_entries(record.get("provenance") or [])


def is_cited(entry: dict[str, str]) -> bool:
    """True when the entry needs a wiki ``<ref>`` (manual or external)."""
    return str(entry.get("kind") or "") in CITED_KINDS
