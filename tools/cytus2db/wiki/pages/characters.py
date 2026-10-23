"""Character page models (ticket #9).

The builder emits only fields the canonical DB can justify:

``name``
    ``bg_movie_info_data.CharacterId`` resolved to the song pack name (or the
    gallery folder name) by the entity layer.
``systems``
    Presence of the character in each in-game system, derived from entity
    records: iM posts authored under the character's own account, OS logs for
    the character, an ``oa_character`` record, and a gallery folder.
``category``
    Song pack ``Category`` plus ``is_iap_pack``: ``Extra`` packs are side
    characters, ``Main`` packs split into free and paid characters.
``theme_color``
    Song pack ``theme_color`` without the leading ``#``.
``imid``
    Distinct account names that authored the character's iM posts.
``unlock_method``
    Song pack price for IAP packs, ``免费`` otherwise.

Everything else in ``模板:角色`` (sorting, genre, profile, intro, images,
comments, trivia) has no APK source and stays out per ADR-0003.  ``最高等级``
needs the per-pack exp table, which the canonical DB does not carry yet, so it
is omitted rather than copied from the wiki.

A song may carry the same title as its character (``Miku``).  The page title
then takes the ``（角色）`` suffix so the two pages stay distinct; the
``角色名`` parameter always keeps the bare name.  Title-to-existing-page
matching stays ticket #12's job.
"""

from __future__ import annotations

import re
from collections import defaultdict
from typing import Any

from ..db import Database
from ..model import SEMANTIC_TEMPLATE, Conflict, Field, PageModel, Section, Text

SYSTEM_ORDER = ("im", "os", "oa", "gallery")

_CHARACTER_ID = re.compile(r"^(?P<stem>.+?)(?P<serial>[0-9]+)$")


def build(db: Database) -> list[PageModel]:
    """Return one page model per character entity, sorted by entity id."""
    packs = {record["id"]: record for record in db.records("pack")}
    im_posts = sorted(db.records("im_post"), key=lambda record: record["id"])
    os_logs = db.records("os_log")
    song_titles = {
        _text(song.get("name")) for song in db.records("song") if _text(song.get("name"))
    }
    oa_characters = {
        str(record.get("character_id") or "")
        for record in db.records("oa_character")
    }
    gallery_folders = {
        str(record.get("game_id") or "")
        for record in db.records("gallery_folder")
        if record.get("game_id") and record.get("game_id") != "misc"
    }

    pages: list[PageModel] = []
    for character in sorted(db.records("character"), key=lambda record: record["id"]):
        entity_id = character["id"]
        game_id = str(character["game_id"])
        pack = packs.get(str(character.get("pack_id") or ""))
        conflicts: list[Conflict] = []
        omitted: dict[str, str] = {}

        posts = _owned_posts(game_id, im_posts)
        systems = _systems(game_id, pack, posts, os_logs, oa_characters, gallery_folders)
        if not systems:
            conflicts.append(Conflict("missing_systems", entity_id))

        fields: list[Field] = []
        name = _text(character.get("name")) or game_id
        if name:
            fields.append(Field("name", Text.of(name)))
            page_title = f"{name}（角色）" if name in song_titles else name
            fields.append(Field("page_title", Text.of(page_title)))
        if systems:
            fields.append(Field("systems", Text.of(",".join(systems))))

        category = _category(pack, conflicts)
        if category:
            fields.append(Field("category", Text.of(category)))
        elif pack is not None:
            omitted["category"] = "unknown_pack_category"

        theme_color = _theme_color(pack, omitted)
        if theme_color:
            fields.append(Field("theme_color", Text.of(theme_color)))

        imid = _imid(posts)
        if imid:
            fields.append(Field("imid", Text.of(imid)))
        else:
            omitted["imid"] = "no_im_account"

        unlock_method = _unlock_method(pack, omitted)
        if unlock_method:
            fields.append(Field("unlock_method", Text.of(unlock_method)))

        omitted["max_level"] = "exp_table_not_extracted"

        pages.append(
            PageModel(
                entity_id=entity_id,
                page_type="character",
                sections=(Section(SEMANTIC_TEMPLATE, tuple(fields)),),
                categories=("character",),
                omitted=omitted,
                conflicts=tuple(conflicts),
            )
        )
    return pages


# ------------------------------------------------------------------ helpers
def _text(value: Any) -> str:
    return " ".join(str(value or "").split())


def _account_pattern(game_id: str) -> re.Pattern[str] | None:
    """Match the iM account avatar ids owned by ``game_id``.

    The APK ships one iM account per character stem.  Account avatars are named
    ``<stem>_<number>`` and belong to the numbered base character ``<stem>001``;
    secondary characters sharing the stem (``paff002``, ``neko003`` ...) have no
    account of their own.  The canonical DB carries the avatar id on each post
    but not the avatar-to-pack table, so the ownership rule is reconstructed
    here from those ids.
    """
    match = _CHARACTER_ID.match(game_id)
    if match is None or match.group("serial") != "001":
        return None
    stem = re.escape(match.group("stem"))
    return re.compile(rf"^{stem}_[0-9]+$")


def _owned_posts(game_id: str, posts: list[dict[str, Any]]) -> list[dict[str, Any]]:
    pattern = _account_pattern(game_id)
    if pattern is None:
        return []
    return [post for post in posts if pattern.match(_text(post.get("avatar")))]


def _systems(
    game_id: str,
    pack: dict[str, Any] | None,
    posts: list[dict[str, Any]],
    os_logs: list[dict[str, Any]],
    oa_characters: set[str],
    gallery_folders: set[str],
) -> list[str]:
    entity_id = f"character/{game_id}"
    found = set()
    if posts or (pack is not None and pack.get("has_im")):
        found.add("im")
    for log in os_logs:
        if str(log.get("file") or "") == game_id:
            found.add("os")
            break
        locks = log.get("level_locks") or ()
        if any(str(lock.get("character") or "") == entity_id for lock in locks):
            found.add("os")
            break
    if entity_id in oa_characters or game_id in oa_characters:
        found.add("oa")
    if game_id in gallery_folders:
        found.add("gallery")
    return [system for system in SYSTEM_ORDER if system in found]


def _category(pack: dict[str, Any] | None, conflicts: list[Conflict]) -> str:
    if pack is None:
        return ""
    category = _text(pack.get("category"))
    if category == "Extra":
        return "支线角色"
    if category == "Main":
        return "付费角色" if pack.get("is_iap") else "免费角色"
    conflicts.append(
        Conflict("unknown_pack_category", f"{pack['id']}: {category or '<empty>'}")
    )
    return ""


def _theme_color(pack: dict[str, Any] | None, omitted: dict[str, str]) -> str:
    if pack is None:
        omitted["theme_color"] = "missing_pack"
        return ""
    color = _text(pack.get("theme_color")).lstrip("#").strip()
    if not color:
        omitted["theme_color"] = "no_pack_theme"
    return color


def _imid(posts: list[dict[str, Any]]) -> str:
    accounts: list[str] = []
    seen: set[str] = set()
    for post in posts:
        author = _text(post.get("author"))
        if author and author not in seen:
            seen.add(author)
            accounts.append(author)
    return ",".join(accounts)


def _unlock_method(pack: dict[str, Any] | None, omitted: dict[str, str]) -> str:
    if pack is None:
        omitted["unlock_method"] = "missing_pack"
        return ""
    if not pack.get("is_iap"):
        return "免费"
    price = _text(pack.get("price"))
    if not price:
        omitted["unlock_method"] = "no_price"
    return price
