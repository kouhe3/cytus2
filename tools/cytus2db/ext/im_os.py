"""Content entities: iM posts, flat iM replies and OS logs.

The game stores an iM thread as one post object under
``text/imposts_*/posts``; the replies are its ``Replies`` array.  There is no
nested threading in the client, and this builder keeps the output flat even if
a future data dump nests a node: every reply becomes an ``im_reply`` record
addressed as ``im_reply/<post id>#<position>`` and carries no parent field.

OS logs live in ``text/osdata/<file>``.  Their body is a tiny script language:
``##conversation`` starts a speaker, ``##text`` starts a document, and
``##image`` / ``##movie`` / ``##sound`` / ``##bgm`` / ``##mail`` / ``##json``
emit media or layout blocks.

Localized bodies are not stored inline: ``write_artifacts`` writes
``build/text/im_os.jsonl`` with one record per entity and language.  Missing
translations are explicit (``missing: true``) instead of being silently empty.
"""

from __future__ import annotations

import json
from pathlib import Path
from typing import Any

from ..blocks import one_line as _one_line, parse_blocks as _parse_blocks
from ..errors import BuildError, InputError
from ..keys import asset_key, chart_key, entity_key, slug
from ..provenance import manual, sort_record, text_asset
from ..sources import LANGS, InputSource

_DIFFICULTY_BY_INDEX = {0: "Easy", 1: "Hard", 2: "Chaos", 3: "Glitch"}
_LANG_ORDER = {code: index for index, (code, _) in enumerate(LANGS)}
_TEXT_ARTIFACT = Path("text") / "im_os.jsonl"
_CUTSCENE_TABLE = ("cutscenedata", "cutscene_data_os")
_CUTSCENE_LOCATOR = "text/" + "/".join(_CUTSCENE_TABLE)

# Bili Wiki records these four title-only posts as removed from the iM feed
# after reading. The client only exposes the resulting save flag
# (``IMTopicRecord.IsRemoved``); the source tables carry no lifecycle field.
REMOVED_AFTER_READ_TOPIC_IDS = frozenset({"N2201", "P1201", "Q6701", "R0801"})
REMOVED_AFTER_READ_LOCATOR = "https://wiki.biligame.com/cytus2"

# --------------------------------------------------------------------- shared
_text_asset = text_asset
_sorted_provenance = sort_record


def _slot_text(slots: Any, slot: int) -> str:
    if not isinstance(slots, list) or slot >= len(slots):
        return ""
    value = slots[slot]
    return value if isinstance(value, str) else ""


def _localized(slots: Any) -> dict[str, str | None]:
    return {
        code: (_one_line(_slot_text(slots, slot)) or None)
        for code, slot in LANGS
    }


def _missing_languages(contents: Any) -> list[str]:
    return [
        code
        for code, slot in LANGS
        if not _slot_text(contents, slot).strip()
    ]


def _as_int(value: Any, where: str) -> int:
    if isinstance(value, bool) or not isinstance(value, int):
        raise BuildError(f"{where}: expected an integer, got {value!r}")
    return value


def _dedupe(records: list[dict[str, Any]], label: str) -> list[dict[str, Any]]:
    by_id: dict[str, dict[str, Any]] = {}
    for record in records:
        identifier = record["id"]
        if identifier in by_id:
            raise BuildError(f"duplicate {label} id: {identifier}")
        by_id[identifier] = record
    return [by_id[key] for key in sorted(by_id)]


# ------------------------------------------------------------------------- iM
def _post_files(source: InputSource) -> dict[str, tuple[dict[str, Any], str]]:
    """Map upper-case post id to (post object, provenance locator)."""
    posts: dict[str, tuple[dict[str, Any], str]] = {}
    if not source.text_dir.is_dir():
        return posts
    for path in sorted(source.text_dir.glob("imposts_*/posts")):
        try:
            data = json.loads(path.read_text(encoding="utf-8-sig"))
        except json.JSONDecodeError as exc:
            raise InputError(f"invalid JSON in {path}: {exc}") from exc
        if not isinstance(data, dict):
            raise InputError(f"{path} must contain one iM post object")
        game_id = str(data.get("Id") or "").strip().upper()
        if not game_id:
            raise BuildError(f"{path}: missing Id")
        if game_id in posts:
            raise BuildError(f"duplicate iM post {game_id} in {path}")
        posts[game_id] = (data, path.relative_to(source.root).as_posix())
    return posts


def _table_list(table: Any, name: str) -> list[Any]:
    if not isinstance(table.data, list):
        raise InputError(f"{table.locator} must be a JSON list ({name})")
    return table.data


def _flatten_replies(
    nodes: Any, locator: str
) -> list[tuple[dict[str, Any], str]]:
    """Depth-first flatten; the public shape stays one level."""
    flat: list[tuple[dict[str, Any], str]] = []
    if nodes is None:
        return flat
    if not isinstance(nodes, list):
        raise BuildError(f"{locator}: Replies must be a list")
    for index, node in enumerate(nodes):
        node_locator = f"{locator}[{index}]"
        if not isinstance(node, dict):
            raise BuildError(f"{node_locator}: reply must be an object")
        flat.append((node, node_locator))
        flat.extend(_flatten_replies(node.get("Replies"), f"{node_locator}.Replies"))
    return flat


def _build_im(source: InputSource) -> tuple[list[dict[str, Any]], list[dict[str, Any]]]:
    topics_table = source.text_json("imdata", "im_topic_data")
    posts = _post_files(source)
    if topics_table is None:
        if posts:
            raise InputError(
                "found iM post files but missing text/imdata/im_topic_data"
            )
        return [], []

    locks_table = source.text_json("imdata", "im_lock_condition_data")
    if locks_table is None:
        raise InputError("missing text/imdata/im_lock_condition_data")
    attachments_table = source.text_json("imdata", "im_attachment_data")

    topic_rows = _table_list(topics_table, "im_topic_data")
    lock_rows = _table_list(locks_table, "im_lock_condition_data")
    attachment_locators: dict[str, str] = {}
    if attachments_table is not None:
        for index, row in enumerate(_table_list(attachments_table, "im_attachment_data")):
            if isinstance(row, dict) and row.get("Id"):
                attachment_locators[str(row["Id"])] = f"{attachments_table.locator}[{index}]"

    topics: dict[str, tuple[dict[str, Any], int, str]] = {}
    for index, row in enumerate(topic_rows):
        if not isinstance(row, dict):
            raise BuildError(f"{topics_table.locator}[{index}]: must be an object")
        game_id = str(row.get("Id") or "").strip().upper()
        if not game_id:
            raise BuildError(f"{topics_table.locator}[{index}]: missing Id")
        if game_id in topics:
            raise BuildError(f"duplicate iM topic {game_id}")
        topics[game_id] = (row, index, f"{topics_table.locator}[{index}]")

    locks: dict[str, tuple[dict[str, Any], str]] = {}
    for index, row in enumerate(lock_rows):
        if not isinstance(row, dict):
            raise BuildError(f"{locks_table.locator}[{index}]: must be an object")
        game_id = str(row.get("TopicId") or "").strip().upper()
        if not game_id:
            raise BuildError(f"{locks_table.locator}[{index}]: missing TopicId")
        if game_id in locks:
            raise BuildError(f"duplicate iM lock row {game_id}")
        locks[game_id] = (row, f"{locks_table.locator}[{index}]")

    missing_posts = sorted(set(topics) - set(posts))
    if missing_posts:
        raise InputError(
            "missing iM post file for topic(s): " + ", ".join(missing_posts)
        )
    missing_topics = sorted(set(posts) - set(topics))
    if missing_topics:
        raise InputError(
            "iM post(s) missing from im_topic_data: " + ", ".join(missing_topics)
        )
    missing_locks = sorted(set(topics) - set(locks))
    if missing_locks:
        raise InputError(
            "missing iM lock row for topic(s): " + ", ".join(missing_locks)
        )

    posts_out: list[dict[str, Any]] = []
    replies_out: list[dict[str, Any]] = []
    reply_game_ids: set[str] = set()
    for game_id, (topic, index, topic_locator) in topics.items():
        post, post_locator = posts[game_id]
        lock, lock_locator = locks[game_id]
        contents = post.get("Contents")
        titles = _localized(topic.get("Titles"))

        author = _one_line(topic.get("CharacterName") or post.get("CharacterName"))
        avatar = _one_line(topic.get("AvatarId") or post.get("AvatarId"))
        if not author:
            raise BuildError(f"{topic_locator}: missing CharacterName")
        if not avatar:
            raise BuildError(f"{topic_locator}: missing AvatarId")

        flat_replies = _flatten_replies(
            post.get("Replies"), f"{post_locator}.Replies"
        )
        reply_count = len(flat_replies)

        charts: list[str] = []
        for chart_index, chart in enumerate(topic.get("UnlockCharts") or []):
            if not isinstance(chart, dict):
                raise BuildError(f"{topic_locator}.UnlockCharts[{chart_index}]: must be an object")
            song_id = str(chart.get("SongId") or "").strip()
            difficulty = chart.get("Difficulty")
            if not song_id:
                raise BuildError(
                    f"{topic_locator}.UnlockCharts[{chart_index}]: missing SongId"
                )
            if difficulty not in _DIFFICULTY_BY_INDEX:
                raise BuildError(
                    f"{topic_locator}.UnlockCharts[{chart_index}]: unknown Difficulty {difficulty!r}"
                )
            reference = chart_key(song_id, _DIFFICULTY_BY_INDEX[difficulty])
            if reference not in charts:
                charts.append(reference)

        level_locks = []
        for lock_index, level_lock in enumerate(lock.get("LevelLocks") or []):
            if not isinstance(level_lock, dict):
                raise BuildError(f"{lock_locator}.LevelLocks[{lock_index}]: must be an object")
            character_id = str(level_lock.get("SongPackId") or "").strip()
            if not character_id:
                raise BuildError(f"{lock_locator}.LevelLocks[{lock_index}]: missing SongPackId")
            level_locks.append(
                {
                    "character": entity_key("character", character_id),
                    "level": _as_int(
                        level_lock.get("Level", 0), f"{lock_locator}.LevelLocks[{lock_index}].Level"
                    ),
                }
            )
        level_locks.sort(key=lambda item: (item["character"], item["level"]))

        attachments: list[str] = []
        for attachment in post.get("Attachments") or []:
            value = str(attachment or "").strip()
            if value and value not in attachments:
                attachments.append(value)
        first_attachment = str(topic.get("FirstAttachmentId") or "").strip()
        if first_attachment and first_attachment not in attachments:
            attachments.insert(0, first_attachment)

        provenance = [
            _text_asset(topic_locator),
            _text_asset(post_locator),
            _text_asset(lock_locator),
        ]
        for attachment in attachments:
            locator = attachment_locators.get(attachment)
            if locator:
                provenance.append(_text_asset(locator))

        missing_languages = _missing_languages(contents)
        record: dict[str, Any] = {
            "id": entity_key("im", game_id),
            "type": "im_post",
            "game_id": game_id,
            "author": author,
            "avatar": avatar,
            "order": index + 1,
            "titles": titles,
            "likes": _as_int(topic.get("LikeCount", 0), f"{topic_locator}.LikeCount"),
            "reply_count": reply_count,
            "story_gate": str(lock.get("StoryLockId") or "").strip() or None,
            "topic_gate": str(lock.get("TopicLockId") or "").strip() or None,
            "title_only": (
                len(missing_languages) == len(LANGS)
                and reply_count == 0
                and not attachments
                and not charts
                and any(titles.values())
            ),
            "removed_after_read": game_id in REMOVED_AFTER_READ_TOPIC_IDS,
            "level_locks": level_locks,
            "attachments": attachments,
            "charts": charts,
            "text_ref": entity_key("im", game_id),
            "missing_languages": missing_languages,
            "provenance": provenance,
        }
        if record["removed_after_read"]:
            provenance.append(
                manual(
                    REMOVED_AFTER_READ_LOCATOR,
                    f"{game_id}: removed from the iM feed after reading (Bili Wiki)",
                )
            )
        _sorted_provenance(record)
        posts_out.append(record)

        for position, (node, node_locator) in enumerate(flat_replies, start=1):
            reply_game_id = str(node.get("Id") or "").strip()
            if not reply_game_id:
                raise BuildError(f"{node_locator}: missing reply Id")
            if reply_game_id in reply_game_ids:
                raise BuildError(f"{node_locator}: duplicate reply Id {reply_game_id}")
            reply_game_ids.add(reply_game_id)
            reply_author = _one_line(node.get("CharacterName"))
            reply_avatar = _one_line(node.get("AvatarId"))
            if not reply_author:
                raise BuildError(f"{node_locator}: missing CharacterName")
            if not reply_avatar:
                raise BuildError(f"{node_locator}: missing AvatarId")
            reply_id = f"im_reply/{game_id}#{position}"
            reply: dict[str, Any] = {
                "id": reply_id,
                "type": "im_reply",
                "game_id": reply_game_id,
                "post_id": entity_key("im", game_id),
                "order": position,
                "author": reply_author,
                "avatar": reply_avatar,
                "text_ref": reply_id,
                "missing_languages": _missing_languages(node.get("Contents")),
                "provenance": [_text_asset(node_locator)],
            }
            _sorted_provenance(reply)
            replies_out.append(reply)

    return _dedupe(posts_out, "im_post"), _dedupe(replies_out, "im_reply")


# ------------------------------------------------------------------------- OS
def _chapter_ids(source: InputSource) -> dict[str, str]:
    table = source.chapters()
    if not isinstance(table.data, list):
        raise InputError(f"{table.locator} must be a JSON list")
    mapping: dict[str, str] = {}
    for index, row in enumerate(table.data):
        if not isinstance(row, dict):
            continue
        number = row.get("Id")
        name = str(row.get("Name") or "")
        if number is None or not name:
            raise BuildError(f"{table.locator}[{index}]: missing Id or Name")
        if name in mapping:
            raise BuildError(f"duplicate OS chapter name {name!r}")
        mapping[name] = str(number)
    return mapping





def _movie_names(contents: Any) -> list[str]:
    names: set[str] = set()
    for _, slot in LANGS:
        for line in _slot_text(contents, slot).splitlines():
            stripped = line.strip()
            if not stripped.startswith("##"):
                continue
            key, _, value = stripped[2:].partition("=")
            if key.strip() != "movie":
                continue
            name = value.split(",", 1)[0].strip()
            if name:
                names.add(name)
    return sorted(names)


def _cutscene_clips(source: InputSource) -> dict[str, str]:
    """TriggerId -> clip name (MovieFile without .mp4) for first-open OS cutscenes."""
    table = source.cutscene_os()
    if table is None:
        return {}
    if not isinstance(table.data, dict):
        raise BuildError(f"{table.locator} must be a JSON object keyed by TriggerId")
    clips: dict[str, str] = {}
    for key, value in table.data.items():
        where = f"{table.locator}[{key!r}]"
        if not isinstance(value, dict):
            raise BuildError(f"{where}: must be an object")
        trigger = str(value.get("TriggerId") or "").strip()
        if not trigger:
            raise BuildError(f"{where}: missing TriggerId")
        if trigger != str(key).strip():
            raise BuildError(f"{where}: TriggerId {trigger!r} does not match the key")
        if trigger in clips:
            raise BuildError(f"{table.locator}: duplicate TriggerId {trigger!r}")
        movie = str(value.get("MovieFile") or "").strip()
        if not movie.endswith(".mp4"):
            raise BuildError(f"{where}: MovieFile {movie!r} is not an .mp4 clip")
        stem = movie[: -len(".mp4")]
        if not stem:
            raise BuildError(f"{where}: MovieFile {movie!r} has an empty clip name")
        clips[trigger] = stem
    return clips


def _build_os(source: InputSource) -> list[dict[str, Any]]:
    chapter_ids = _chapter_ids(source)
    cutscenes = _cutscene_clips(source)
    logs: list[dict[str, Any]] = []
    for table in source.os_tables():
        if not isinstance(table.data, list):
            raise InputError(f"{table.locator} must be a JSON list")
        file_name = table.locator.rsplit("/", 1)[-1]
        for index, raw in enumerate(table.data):
            if not isinstance(raw, dict):
                raise BuildError(f"{table.locator}[{index}]: must be an object")
            game_id = str(raw.get("Id") or "").strip()
            if not game_id:
                raise BuildError(f"{table.locator}[{index}]: missing Id")
            locator = f"{table.locator}[{index}]"
            timeline = raw.get("TimelineChapter") or {}
            if not isinstance(timeline, dict):
                raise BuildError(f"{locator}: TimelineChapter must be an object")

            folder_name = str(timeline.get("Folder") or "").strip()
            if folder_name and folder_name != "N/A":
                folder_id: str | None = entity_key("folder", slug(folder_name))
            else:
                folder_id = None

            chapter_name = str(timeline.get("Chapter") or "").strip()
            chapter_number = chapter_ids.get(chapter_name)
            if chapter_number is None:
                raise BuildError(
                    f"{locator}: TimelineChapter.Chapter {chapter_name!r} is not in text/osdata/chapters"
                )

            lock = raw.get("OSLockCondition") or {}
            if not isinstance(lock, dict):
                raise BuildError(f"{locator}: OSLockCondition must be an object")
            level_locks = []
            for lock_index, level_lock in enumerate(lock.get("LevelLocks") or []):
                if not isinstance(level_lock, dict):
                    raise BuildError(f"{locator}.OSLockCondition.LevelLocks[{lock_index}]: must be an object")
                character_id = str(level_lock.get("SongPackId") or "").strip()
                if not character_id:
                    raise BuildError(
                        f"{locator}.OSLockCondition.LevelLocks[{lock_index}]: missing SongPackId"
                    )
                level_locks.append(
                    {
                        "character": entity_key("character", character_id),
                        "level": _as_int(
                            level_lock.get("Level", 0),
                            f"{locator}.OSLockCondition.LevelLocks[{lock_index}].Level",
                        ),
                    }
                )
            level_locks.sort(key=lambda item: (item["character"], item["level"]))

            contents = raw.get("Contents")
            missing = [
                code
                for code, slot in LANGS
                if not _parse_blocks(_slot_text(contents, slot))
            ]

            record: dict[str, Any] = {
                "id": entity_key("os", game_id),
                "type": "os_log",
                "game_id": game_id,
                "file": file_name,
                "folder_id": folder_id,
                "chapter_id": entity_key("chapter", chapter_number),
                "index": _as_int(timeline.get("Index", 0), f"{locator}.TimelineChapter.Index"),
                "date": _one_line(raw.get("Date")),
                "category": str(raw.get("Category") or ""),
                "position": index,
                "level_lock_display": bool(raw.get("LevelLockDisplay")),
                "log_type": _as_int(raw.get("Type", 0), f"{locator}.Type"),
                "names": _localized(raw.get("Names")),
                "file_lock": str(lock.get("FileLockId") or "").strip() or None,
                "level_locks": level_locks,
                "movies": [asset_key("video", name) for name in _movie_names(contents)],
                "text_ref": entity_key("os", game_id),
                "missing_languages": missing,
                "provenance": [_text_asset(locator)],
            }
            clip = cutscenes.get(game_id)
            if clip is not None:
                record["cutscene"] = clip
                record["provenance"].append(_text_asset(_CUTSCENE_LOCATOR))
            _sorted_provenance(record)
            logs.append(record)
    return _dedupe(logs, "os_log")


# ------------------------------------------------------------------ artifacts
def build(source: InputSource) -> dict[str, list[dict[str, Any]]]:
    posts, replies = _build_im(source)
    logs = _build_os(source)
    return {"im_post": posts, "im_reply": replies, "os_log": logs}


def _append_text(
    records: list[dict[str, Any]],
    ref: str,
    entity_type: str,
    contents: Any,
) -> None:
    for code, slot in LANGS:
        raw = _slot_text(contents, slot)
        if raw.strip():
            records.append(
                {"ref": ref, "entity": entity_type, "lang": code, "text": raw}
            )
        else:
            records.append(
                {
                    "ref": ref,
                    "entity": entity_type,
                    "lang": code,
                    "text": None,
                    "missing": True,
                }
            )


def _append_blocks(
    records: list[dict[str, Any]],
    ref: str,
    entity_type: str,
    contents: Any,
) -> None:
    for code, slot in LANGS:
        blocks = _parse_blocks(_slot_text(contents, slot))
        if blocks:
            records.append(
                {"ref": ref, "entity": entity_type, "lang": code, "blocks": blocks}
            )
        else:
            records.append(
                {
                    "ref": ref,
                    "entity": entity_type,
                    "lang": code,
                    "blocks": [],
                    "missing": True,
                }
            )


def _os_contents(source: InputSource) -> dict[str, Any]:
    contents: dict[str, Any] = {}
    for table in source.os_tables():
        if not isinstance(table.data, list):
            continue
        for raw in table.data:
            if isinstance(raw, dict) and raw.get("Id"):
                contents[str(raw["Id"])] = raw.get("Contents")
    return contents


def _text_records(
    source: InputSource, entities: dict[str, list[dict[str, Any]]]
) -> list[dict[str, Any]]:
    posts = _post_files(source)
    post_contents: dict[str, Any] = {}
    reply_contents: dict[str, Any] = {}
    for raw, locator in posts.values():
        post_id = str(raw.get("Id") or "").strip().upper()
        post_contents[post_id] = raw.get("Contents")
        for node, _ in _flatten_replies(raw.get("Replies"), f"{locator}.Replies"):
            reply_id = str(node.get("Id") or "").strip()
            if reply_id:
                reply_contents[reply_id] = node.get("Contents")
    os_contents = _os_contents(source)

    records: list[dict[str, Any]] = []
    for post in entities.get("im_post", []):
        _append_text(
            records,
            post["text_ref"],
            "im_post",
            post_contents.get(post["game_id"].upper()),
        )
    for reply in entities.get("im_reply", []):
        _append_text(
            records,
            reply["text_ref"],
            "im_reply",
            reply_contents.get(reply["game_id"]),
        )
    for log in entities.get("os_log", []):
        _append_blocks(
            records,
            log["text_ref"],
            "os_log",
            os_contents.get(log["game_id"]),
        )
    return records


def _check_text(records: list[dict[str, Any]], entities: dict[str, list[dict[str, Any]]]) -> None:
    by_ref: dict[str, dict[str, dict[str, Any]]] = {}
    for record in records:
        by_ref.setdefault(record["ref"], {})[record["lang"]] = record

    for entity_type in ("im_post", "im_reply", "os_log"):
        for entity in entities.get(entity_type, []):
            ref = entity["text_ref"]
            languages = by_ref.get(ref)
            if languages is None:
                raise BuildError(f"{entity['id']}: text_ref {ref!r} does not resolve")
            if set(languages) != {code for code, _ in LANGS}:
                raise BuildError(
                    f"{entity['id']}: text_ref {ref!r} is missing language records"
                )
            missing = sorted(
                code for code, record in languages.items() if record.get("missing")
            )
            if missing != sorted(entity["missing_languages"]):
                raise BuildError(
                    f"{entity['id']}: missing_languages disagrees with the text store"
                )
            for code, record in languages.items():
                if record.get("missing"):
                    if entity_type == "os_log":
                        if record["blocks"]:
                            raise BuildError(f"{entity['id']}: {code} is marked missing but has blocks")
                    elif record["text"] is not None:
                        raise BuildError(f"{entity['id']}: {code} is marked missing but has text")
                elif entity_type == "os_log":
                    if not record["blocks"]:
                        raise BuildError(f"{entity['id']}: {code} has no blocks")
                elif not record["text"].strip():
                    raise BuildError(f"{entity['id']}: {code} has empty text")


def write_artifacts(
    out: Path,
    source: InputSource,
    entities: dict[str, list[dict[str, Any]]],
) -> None:
    records = _text_records(source, entities)
    _check_text(records, entities)
    path = Path(out) / _TEXT_ARTIFACT
    path.parent.mkdir(parents=True, exist_ok=True)
    ordered = sorted(
        records,
        key=lambda record: (
            record["ref"],
            _LANG_ORDER[record["lang"]],
        ),
    )
    with path.open("w", encoding="utf-8", newline="\n") as handle:
        for record in ordered:
            handle.write(
                json.dumps(
                    record, ensure_ascii=False, sort_keys=True, separators=(",", ":")
                )
            )
            handle.write("\n")
