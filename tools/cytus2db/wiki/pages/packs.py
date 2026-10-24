"""Song pack page models (ticket #9).

``模板:曲包`` takes three parameters, all of them entity-derived:

``曲包名``   the pack display name;
``所属角色``  the character(s) whose ``pack_id`` points at this pack;
``属性``     the pack icon stem, i.e. the song pack id without its serial
             number (``paff001`` -> ``paff``), matching the site's
             ``pack-icon-<属性>.png`` naming.

Character pages and their packs share a display name (``PAFF`` the character
and ``PAFF`` the pack).  The character page owns the bare title on the site, so
a pack that would collide with a character gets the ``（曲包）`` suffix; the
``曲包名`` parameter itself always keeps the real name.  Title-to-existing-page
matching remains ticket #12's job.
"""

from __future__ import annotations

import re
from collections import defaultdict
from typing import Any

from ..db import Database
from ..model import SEMANTIC_TEMPLATE, Field, PageModel, Section, Text, provenance_of

_SERIAL = re.compile(r"[0-9]+$")
_PACK_TITLE_SUFFIX = "（曲包）"


def build(db: Database) -> list[PageModel]:
    """Return one page model per pack entity, sorted by entity id."""
    owners: dict[str, list[dict[str, Any]]] = defaultdict(list)
    character_names: set[str] = set()
    for character in sorted(db.records("character"), key=lambda record: record["id"]):
        character_names.add(_text(character.get("name")) or str(character["game_id"]))
        pack_id = str(character.get("pack_id") or "")
        if pack_id:
            owners[pack_id].append(character)

    pages: list[PageModel] = []
    for pack in sorted(db.records("pack"), key=lambda record: record["id"]):
        game_id = str(pack["game_id"])
        name = _text(pack.get("name")) or game_id
        omitted: dict[str, str] = {}
        fields: list[Field] = [Field("pack_name", Text.of(name))]

        character_names_for_pack = [
            _text(character.get("name")) or str(character["game_id"])
            for character in owners.get(pack["id"], [])
        ]
        if character_names_for_pack:
            fields.append(
                Field("characters", Text.of(",".join(character_names_for_pack)))
            )
        else:
            omitted["characters"] = "no_linked_character"

        attribute = _SERIAL.sub("", game_id) or game_id
        fields.append(Field("attribute", Text.of(attribute)))

        page_title = (
            f"{name}{_PACK_TITLE_SUFFIX}" if name in character_names else name
        )
        fields.append(Field("page_title", Text.of(page_title)))

        pages.append(
            PageModel(
                entity_id=pack["id"],
                page_type="pack",
                sections=(Section(SEMANTIC_TEMPLATE, tuple(fields)),),
                categories=("pack",),
                omitted=omitted,
                provenance=provenance_of(pack),
            )
        )
    return pages


def _text(value: Any) -> str:
    return " ".join(str(value or "").split())
