"""iM post pages (ticket #10).

One page per ``im_post`` entity.  The page model carries the twelve
``Im/帖`` template parameters plus one renderer-only field:

``page_title``
    The wiki page title: an existing page's title when the snapshot matches,
    otherwise the post headline.  ``resolve_titles`` reads this field; it is
    never emitted as a template parameter.

Existing-page matching uses the committed ``wiki/snapshot/pages.json`` (the
same snapshot ticket #12 will reuse).  ``CYTUS2_WIKI_SNAPSHOT`` may point at
another snapshot directory, which keeps tests off the real site data.
Two posts that would share a title keep the site's ``标题（P0101）`` form for
the extra page.

``剧情排序`` is the post's position among the same account's posts in reading
order (the account's story line); ``全局排序`` is its position among all iM
posts.  Empty replies are skipped and counted in the page's report conflicts.

The game's rich text is translated to the wikitext the site already uses:
``<color>``/``<size>`` wrappers are dropped, ``>>hyperlink {...} <<hyperlink``
becomes an external link, ``>> ... <<`` becomes ``{{引用段落|...}}`` and line
breaks become ``<br>``.  Comments follow ``{{im/评论|user:text;…}}`` with the
template's delimiter characters escaped to full width (``;``, ``:`` and the
parameter-breaking ``|``).
"""

from __future__ import annotations

import json
import os
import re
import sys
import unicodedata
from collections import defaultdict
from pathlib import Path
from typing import Any, Iterable

from ..db import Database
from ..model import SEMANTIC_TEMPLATE, Conflict, Field, Link, PageModel, Section, Text
from ...errors import InputError
from ...keys import DIFFICULTIES

_LANG_ORDER = ("zh-Hans", "zh-Hant", "en", "ja", "ko")
_TEMPLATE_KEY = "Im/帖"
_SNAPSHOT_ENV = "CYTUS2_WIKI_SNAPSHOT"
_DIFFICULTY_INDEX = {name: index for index, name in enumerate(DIFFICULTIES)}
_LEGACY_OPENING_STORY = "story01"
_ENDING_BRANCHES = {
    "story_ending03_good_ending1": "GE",
    "story_ending03_good_ending2": "BE",
}

_COLOR_TAG = re.compile(r"</?color[^>]*>")
_SIZE_TAG = re.compile(r"</?size[^>]*>", re.IGNORECASE)
_HYPERLINK = re.compile(r">>[ \t]*hyperlink\s*(\{.*?\})\s*<<[ \t]*hyperlink", re.DOTALL)
_QUOTE = re.compile(r"^>>[ \t]*\n(.*?)^<<[ \t]*$", re.DOTALL | re.MULTILINE)
_DASHES = re.compile("[\u2010-\u2015\u2212]")
_TRAILING_PUNCTUATION = "。.、,，\"”’"


def build(db: Database) -> list[PageModel]:
    """Return one page model per iM post, sorted by entity id."""
    posts = sorted(db.records("im_post"), key=lambda record: record["id"])
    if not posts:
        return []

    sequence = _sequence_keys(db)
    matched_titles = _match_page_titles(posts, sequence)
    page_titles = _assign_page_titles(posts, sequence, matched_titles)
    default_avatars = _default_avatars(posts, sequence)
    texts = _text_index(db)
    replies = _replies_by_post(db)
    chart_targets = _chart_targets(db)
    plot_rank = _plot_ranks(posts, sequence)
    by_reading_order = sorted(
        posts, key=lambda post: sequence(post["id"], int(post.get("order") or 0))
    )
    global_rank = {
        post["id"]: index for index, post in enumerate(by_reading_order, start=1)
    }

    pages: list[PageModel] = []
    for post in posts:
        conflicts: list[Conflict] = []
        omitted: dict[str, str] = {}
        fields: list[Field] = []

        headline = _localized(post.get("titles"))
        fields.append(Field("page_title", Text.of(page_titles[post["id"]])))
        fields.append(Field("global_order", Text.of(str(global_rank[post["id"]]))))
        fields.append(Field("plot_order", Text.of(str(plot_rank[post["id"]]))))
        fields.append(Field("account", Text.of(_one_line(post.get("author")))))
        if headline:
            fields.append(Field("headline", Text.of(headline)))
        else:
            omitted["headline"] = "title_missing"

        body = _localized_text(texts, post.get("text_ref"))
        if body is not None:
            fields.append(Field("content", Text.of(_rich_text(body))))
        else:
            omitted["content"] = "text_missing"

        post_replies = replies.get(post["id"], [])
        comments, skipped = _comments(post_replies, texts)
        if comments is None:
            omitted["comments"] = "no_replies" if not post_replies else "only_empty_replies"
        else:
            fields.append(Field("comments", Text.of(comments)))
        if skipped:
            conflicts.append(
                Conflict("empty_replies_skipped", f"{skipped} empty replies skipped")
            )

        fields.append(Field("likes", Text.of(str(int(post.get("likes") or 0)))))

        unlock = _unlock_condition(post, db, page_titles)
        if unlock is None:
            omitted["unlock_condition"] = "no_unlock_condition"
        else:
            fields.append(Field("unlock_condition", unlock))

        charts = _unlock_charts(post["id"], chart_targets, db, conflicts)
        if charts is None:
            omitted["unlock_charts"] = "no_chart_unlocks"
        else:
            fields.append(Field("unlock_charts", charts))

        attachment = _attachment(post)
        if attachment is None:
            omitted["attachment"] = "no_attachment"
        else:
            fields.append(Field("attachment", Text.of(attachment)))

        ending = _ENDING_BRANCHES.get(str(post.get("story_gate") or ""))
        if ending is None:
            omitted["ending_branch"] = "no_ending_branch"
        else:
            fields.append(Field("ending_branch", Text.of(ending)))

        override = _avatar_override(post, default_avatars)
        if override is None:
            omitted["avatar_override"] = "default_avatar"
        else:
            fields.append(Field("avatar_override", Text.of(override)))

        pages.append(
            PageModel(
                entity_id=post["id"],
                page_type="im_post",
                sections=(Section(SEMANTIC_TEMPLATE, tuple(fields)),),
                categories=("im_post",),
                omitted=omitted,
                conflicts=tuple(_dedupe_conflicts(conflicts)),
            )
        )
    return pages


# ------------------------------------------------------------------ ordering
def _sequence_keys(db: Database) -> "_Sequence":
    """Map ``im/<id>`` to its canonical reading-order position."""
    orders: dict[str, int] = {}
    for record in db.records("reading_order"):
        if record.get("entity_type") != "im_post":
            continue
        identifier = str(record.get("entity_id") or "")
        order = record.get("order")
        if identifier and isinstance(order, int):
            orders[identifier] = order
    return _Sequence(orders)


class _Sequence:
    """Sort key for iM posts: reading order first, game table order after."""

    def __init__(self, orders: dict[str, int]) -> None:
        self.orders = orders
        self.unranked = 10**9 if orders else 0

    def __call__(self, identifier: str, game_order: int = 0) -> tuple[int, int, str]:
        return (self.orders.get(identifier, self.unranked), game_order, identifier)


def _plot_ranks(posts: list[dict[str, Any]], sequence: "_Sequence") -> dict[str, int]:
    by_author: dict[str, list[dict[str, Any]]] = defaultdict(list)
    for post in posts:
        by_author[_one_line(post.get("author"))].append(post)
    ranks: dict[str, int] = {}
    for author_posts in by_author.values():
        ordered = sorted(
            author_posts,
            key=lambda post: sequence(post["id"], int(post.get("order") or 0)),
        )
        for index, post in enumerate(ordered, start=1):
            ranks[post["id"]] = index
    return ranks


# ---------------------------------------------------------------- page titles
def _match_page_titles(
    posts: list[dict[str, Any]], sequence: "_Sequence"
) -> dict[str, str]:
    """Map post id to an existing wiki page title, by account and headline."""
    groups = _existing_page_groups()
    if not groups:
        return {}
    by_key: dict[tuple[str, str], list[dict[str, Any]]] = defaultdict(list)
    for post in posts:
        headline = _localized(post.get("titles"))
        if not headline:
            continue
        key = (_one_line(post.get("author")), _normalize_title(headline))
        by_key[key].append(post)

    matched: dict[str, str] = {}
    for key, candidates in by_key.items():
        pages = groups.get(key, [])
        if not pages:
            continue
        candidates.sort(key=lambda post: sequence(post["id"], int(post.get("order") or 0)))
        for post, page in zip(candidates, pages):
            matched[post["id"]] = page
    return matched


def _assign_page_titles(
    posts: list[dict[str, Any]],
    sequence: "_Sequence",
    matched: dict[str, str],
) -> dict[str, str]:
    """Choose one unique page title per post.

    A snapshot match wins over the generated headline.  Two posts that would
    land on the same title keep the existing-page title for the matched one
    (or the earliest post in reading order) and move the rest to the site's
    ``标题（P0101）`` form.  The renderer's own disambiguator cannot express a
    suffix, so collisions are settled here.
    """
    base: dict[str, tuple[str, str, bool]] = {}
    for post in posts:
        headline = _localized(post.get("titles"))
        existing = matched.get(post["id"]) or ""
        title = existing or headline or str(post["game_id"])
        base[post["id"]] = (title, headline, bool(existing))

    groups: dict[str, list[dict[str, Any]]] = defaultdict(list)
    for post in posts:
        groups[base[post["id"]][0]].append(post)

    assigned: dict[str, str] = {}
    for title, members in groups.items():
        if len(members) == 1:
            assigned[members[0]["id"]] = title
            continue
        ordered = sorted(
            members,
            key=lambda post: (
                not base[post["id"]][2],
                sequence(post["id"], int(post.get("order") or 0)),
            ),
        )
        assigned[ordered[0]["id"]] = title
        for post in ordered[1:]:
            headline, _, _ = base[post["id"]]
            disambiguated = f"{headline or post['game_id']}（{post['game_id']}）"
            assigned[post["id"]] = disambiguated
    return assigned


def _existing_page_groups() -> dict[tuple[str, str], list[str]]:
    snapshot = _snapshot_dir()
    if snapshot is None:
        return {}
    path = snapshot / "pages.json"
    try:
        data = json.loads(path.read_text(encoding="utf-8-sig"))
    except json.JSONDecodeError as exc:
        raise InputError(f"invalid JSON in {path}: {exc}") from exc
    template = (data.get("templates") or {}).get(_TEMPLATE_KEY) or {}
    raw_pages = template.get("pages") or []

    grouped: dict[tuple[str, str], list[tuple[tuple[int, int, str], str]]] = defaultdict(list)
    for raw in raw_pages:
        if not isinstance(raw, dict):
            continue
        params = raw.get("params") or {}
        account = _one_line(params.get("iM_ID"))
        headline = _normalize_title(params.get("标题") or "")
        title = str(raw.get("title") or "")
        if not account or not headline or not title:
            continue
        grouped[(account, headline)].append((_page_sort_key(params, title), title))

    return {
        key: [title for _, title in sorted(entries)]
        for key, entries in grouped.items()
    }


def _snapshot_dir() -> Path | None:
    override = os.environ.get(_SNAPSHOT_ENV)
    if override:
        path = Path(override)
        if not (path / "pages.json").is_file():
            raise InputError(f"{_SNAPSHOT_ENV}={override}: missing pages.json")
        return path
    candidate = Path(__file__).resolve().parents[4] / "wiki" / "snapshot"
    return candidate if (candidate / "pages.json").is_file() else None


def _page_sort_key(params: dict[str, Any], title: str) -> tuple[int, int, str]:
    def number(name: str) -> int:
        value = str(params.get(name) or "").strip()
        return int(value) if value.isdigit() else sys.maxsize

    return (number("剧情排序"), number("全局排序"), title)


def _normalize_title(value: Any) -> str:
    """Loose comparison key for the site's hand-written titles.

    Existing pages differ from the game text by whitespace, ``<br>``, full-half
    width brackets, ``帖``/``贴``, dash style, decorative parentheses, trailing
    punctuation and combining noise.  Everything else stays significant.
    """
    text = str(value or "").replace("<br>", "")
    text = unicodedata.normalize("NFKC", text)
    text = text.replace("【", "[").replace("】", "]").replace("帖", "贴")
    text = _DASHES.sub("-", text)
    text = text.replace("(", "").replace(")", "")
    text = unicodedata.normalize("NFD", text)
    text = "".join(
        character
        for character in text
        if unicodedata.category(character) not in ("Mn", "Me")
    )
    text = unicodedata.normalize("NFC", text)
    text = re.sub(r"\s+", "", text).lower()
    return text.rstrip(_TRAILING_PUNCTUATION).rstrip()


# ---------------------------------------------------------------------- text
def _text_index(db: Database) -> dict[str, dict[str, str | None]]:
    records: dict[str, dict[str, str | None]] = defaultdict(dict)
    for record in db.text_records("im_os"):
        if record.get("entity") not in ("im_post", "im_reply"):
            continue
        ref = str(record.get("ref") or "")
        language = str(record.get("lang") or "")
        if ref and language:
            records[ref][language] = record.get("text")
    return records


def _localized_text(
    texts: dict[str, dict[str, str | None]], ref: Any
) -> str | None:
    languages = texts.get(str(ref or ""))
    if not languages:
        return None
    for language in _LANG_ORDER:
        value = languages.get(language)
        if isinstance(value, str) and value.strip():
            return value
    return None


def _localized(value: Any) -> str:
    if not isinstance(value, dict):
        return ""
    for language in _LANG_ORDER:
        text = _one_line(value.get(language))
        if text:
            return text
    return ""


def _one_line(value: Any) -> str:
    return " ".join(str(value or "").split())


def _rich_text(raw: str) -> str:
    """Translate the game's rich text to the wikitext the site already uses."""
    text = raw.replace("\r\n", "\n").replace("\r", "\n").strip()

    def hyperlink(match: re.Match[str]) -> str:
        try:
            payload = json.loads(match.group(1))
        except json.JSONDecodeError:
            return ""
        if not isinstance(payload, dict):
            return ""
        label = _COLOR_TAG.sub("", str(payload.get("Content") or "")).strip()
        urls = payload.get("Urls") or {}
        url = ""
        if isinstance(urls, dict):
            for key in ("Editor", "iOS", "Android"):
                candidate = str(urls.get(key) or "").strip()
                if candidate:
                    url = candidate
                    break
        if url and label:
            return f"[{url} {label}]"
        return label

    text = _HYPERLINK.sub(hyperlink, text)
    text = _QUOTE.sub(
        lambda match: "{{引用段落|" + match.group(1).strip() + "}}", text
    )
    text = _COLOR_TAG.sub("", text)
    text = _SIZE_TAG.sub("", text)
    return text.replace("\n", "<br>")


def _comments(
    replies: Iterable[dict[str, Any]],
    texts: dict[str, dict[str, str | None]],
) -> tuple[str | None, int]:
    entries: list[str] = []
    skipped = 0
    for reply in sorted(replies, key=lambda record: int(record.get("order") or 0)):
        body = _localized_text(texts, reply.get("text_ref"))
        if body is None:
            skipped += 1
            continue
        author = _escape_delimiters(_one_line(reply.get("author")))
        text = _escape_delimiters(_rich_text(body))
        entries.append(f"{author}:{text}")
    if not entries:
        return None, skipped
    return "{{im/评论|" + ";".join(entries) + "}}", skipped


def _escape_delimiters(value: str) -> str:
    """Escape characters ``im/评论`` uses as delimiters.

    ``;`` and ``:`` separate comments and split user from text; a literal
    ``|`` would end the template parameter, so it becomes full width as well
    (the site already writes ``｜`` for this case).
    """
    return value.replace(";", "；").replace(":", "：").replace("|", "｜")


# ------------------------------------------------------------------- unlocks
def _unlock_condition(
    post: dict[str, Any], db: Database, page_titles: dict[str, str]
) -> Text | None:
    parts: list[Text] = []

    level_parts: list[str] = []
    seen: set[tuple[str, int]] = set()
    locks = sorted(
        post.get("level_locks") or [],
        key=lambda lock: (str(lock.get("character")), int(lock.get("level") or 0)),
    )
    for lock in locks:
        character_id = str(lock.get("character") or "")
        level = int(lock.get("level") or 0)
        if not character_id or (character_id, level) in seen:
            continue
        seen.add((character_id, level))
        character = db.get(character_id)
        name = _one_line(character.get("name")) if character else ""
        name = name or character_id.split("/", 1)[-1]
        level_parts.append(f"{name}达到Lv.{level + 1}")
    if level_parts:
        parts.append(Text.of("、".join(level_parts)))

    topic = str(post.get("topic_gate") or "").strip()
    if topic:
        target = f"im/{topic}"
        title = page_titles.get(target) or topic
        parts.append(Text.of("已阅读过iM贴文“", Link(title), "”"))

    story = str(post.get("story_gate") or "").strip()
    if story and story != _LEGACY_OPENING_STORY:
        parts.append(Text.of(f"已完成剧情 {story}"))

    if not parts:
        return None
    combined = parts[0]
    for part in parts[1:]:
        combined = Text.of(combined, "且", part)
    return combined


def _chart_targets(db: Database) -> dict[str, list[str]]:
    targets: dict[str, list[str]] = defaultdict(list)
    for edge in db.edges:
        if edge.relation == "unlocks_chart" and edge.source.startswith("im/"):
            targets[edge.source].append(edge.target)
    return targets


def _unlock_charts(
    entity_id: str,
    chart_targets: dict[str, list[str]],
    db: Database,
    conflicts: list[Conflict],
) -> Text | None:
    grouped: dict[str, set[str]] = defaultdict(set)
    for target in sorted(chart_targets.get(entity_id, [])):
        chart = db.get(target)
        if chart is None:
            conflicts.append(Conflict("missing_chart", target))
            continue
        song_id = str(chart.get("song_id") or "")
        difficulty = str(chart.get("difficulty") or "")
        if not song_id or difficulty not in _DIFFICULTY_INDEX:
            conflicts.append(Conflict("invalid_chart", target))
            continue
        grouped[song_id].add(difficulty)
    if not grouped:
        return None

    lines: list[tuple[str, str]] = []
    for song_id, difficulties in grouped.items():
        song = db.get(song_id)
        name = _one_line(song.get("name")) if song else ""
        name = name or song_id.split("/", 1)[-1]
        ordered = sorted(difficulties, key=lambda item: _DIFFICULTY_INDEX[item])
        labels = "/".join(item.upper() for item in ordered)
        lines.append((name, f"[[{name}]]（{labels}）"))
    lines.sort()
    return Text.of("<br>".join(line for _, line in lines))


def _attachment(post: dict[str, Any]) -> str | None:
    attachments = post.get("attachments") or []
    if not attachments:
        return None
    return f"{str(attachments[0]).strip().lower()}.png"


def _default_avatars(
    posts: list[dict[str, Any]], sequence: "_Sequence"
) -> dict[str, str]:
    """The avatar an account uses on its first post (in reading order)."""
    defaults: dict[str, str] = {}
    ordered = sorted(
        posts, key=lambda post: sequence(post["id"], int(post.get("order") or 0))
    )
    for post in ordered:
        author = _one_line(post.get("author"))
        avatar = _one_line(post.get("avatar"))
        if author and avatar:
            defaults.setdefault(author, avatar)
    return defaults


def _avatar_override(post: dict[str, Any], defaults: dict[str, str]) -> str | None:
    avatar = _one_line(post.get("avatar"))
    author = _one_line(post.get("author"))
    if not avatar or defaults.get(author) == avatar:
        return None
    return avatar.replace("_", " ")


def _replies_by_post(db: Database) -> dict[str, list[dict[str, Any]]]:
    replies: dict[str, list[dict[str, Any]]] = defaultdict(list)
    for reply in db.records("im_reply"):
        replies[str(reply.get("post_id") or "")].append(reply)
    return replies


def _dedupe_conflicts(conflicts: Iterable[Conflict]) -> list[Conflict]:
    unique: dict[tuple[str, str], Conflict] = {}
    for conflict in conflicts:
        unique[(conflict.kind, conflict.detail)] = conflict
    return [unique[key] for key in sorted(unique)]
