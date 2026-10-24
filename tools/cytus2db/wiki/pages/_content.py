"""Shared script parsing and title helpers for OS, OA and gallery pages.

The game's OS/OA bodies are a small line script: ``##conversation`` starts a
speaker, ``##text`` starts prose, and ``##sound`` / ``##image`` / ``##mail`` /
``##movie`` / ``##json`` emit the other block kinds.  OS logs already reach the
text store as parsed blocks; OA documents stay a raw string.  Both paths end in
the same wikitext renderer here so the two page families cannot drift apart.
"""

from __future__ import annotations

from collections import Counter
from typing import Any, Iterable

from ..model import Conflict, Field, PageModel, Section, Text

LANG_ORDER = ("zh-Hans", "zh-Hant", "en", "ja", "ko")
_LANG_RANK = {language: index for index, language in enumerate(LANG_ORDER)}
_IMAGE_SUFFIXES = (".png", ".jpg", ".jpeg", ".gif", ".webp")


# ------------------------------------------------------------------- language
def one_line(value: Any) -> str:
    return " ".join(str(value or "").split())


def display_name(value: Any) -> str:
    """A page-title component: MediaWiki displays ``_`` as a space."""
    return one_line(str(value or "").replace("_", " "))


def localized(value: Any) -> str:
    """First non-empty value in the wiki's preferred language order."""
    if not isinstance(value, dict):
        return ""
    for language in LANG_ORDER:
        text = one_line(value.get(language))
        if text:
            return text
    return ""


def grouped_records(
    records: Iterable[dict[str, Any]], entity_type: str
) -> dict[str, dict[str, dict[str, Any]]]:
    """Index text-store rows as ``ref -> language -> row``."""
    grouped: dict[str, dict[str, dict[str, Any]]] = {}
    for record in records:
        if record.get("entity") != entity_type:
            continue
        ref = str(record.get("ref") or "")
        language = str(record.get("lang") or "")
        if ref and language:
            grouped.setdefault(ref, {})[language] = record
    return grouped


def pick_language(
    records: dict[str, dict[str, Any]], key: str
) -> Any:
    """Return ``records[lang][key]`` for the first language with a value."""
    for language in LANG_ORDER:
        record = records.get(language)
        if record is None:
            continue
        value = record.get(key)
        if value:
            return value
    return None


def sorted_languages(records: dict[str, dict[str, Any]]) -> list[dict[str, Any]]:
    return [records[language] for language in sorted(records, key=_LANG_RANK.get)]


# --------------------------------------------------------------------- script
def parse_script(text: str) -> list[dict[str, Any]]:
    """Parse an unparsed OA body into the same block shapes OS logs use."""
    blocks: list[dict[str, Any]] = []
    speaker: str | None = None
    mode = "dialogue"
    paragraph: list[str] = []
    pending_blank = False
    dialogue_open = False

    def add(block: dict[str, Any]) -> None:
        nonlocal pending_blank
        if pending_blank:
            block["blank_before"] = True
        pending_blank = False
        blocks.append(block)

    def flush() -> None:
        nonlocal paragraph
        if paragraph:
            add({"kind": "narration", "text": "\n".join(paragraph)})
            paragraph = []

    for raw in (text or "").split("\n"):
        line = raw.rstrip()
        if line.startswith("##"):
            pending_blank = False
            flush()
            key, _, value = line[2:].partition("=")
            key, value = key.strip(), value.strip()
            if key == "conversation":
                speaker = one_line(value) or None
                mode = "dialogue"
                dialogue_open = False
            elif key == "text":
                speaker = None
                mode = "text"
            elif key == "sound":
                name, _, label = value.partition(",")
                add(
                    {"kind": "sound", "name": name.strip(), "label": label.strip()}
                )
            elif key == "image":
                add({"kind": "image", "id": value})
            elif key == "movie":
                add({"kind": "movie", "id": value})
            elif key == "bgm":
                add({"kind": "bgm", "name": value})
            elif key == "mail":
                parts = [one_line(item) for item in value.split(",")]
                while len(parts) < 3:
                    parts.append("")
                add(
                    {
                        "kind": "mail",
                        "title": parts[0],
                        "from": parts[1],
                        "to": parts[2],
                        "body": "",
                    }
                )
                mode = "mail"
                speaker = None
            else:
                add({"kind": "note", "directive": key, "value": value})
            continue

        stripped = line.strip()
        if not stripped:
            flush()
            dialogue_open = False
            pending_blank = True
            continue
        if mode == "mail" and blocks and blocks[-1]["kind"] == "mail":
            body = blocks[-1]["body"]
            blocks[-1]["body"] = (body + "\n" + stripped).strip("\n")
        elif mode == "dialogue" and speaker:
            previous = blocks[-1] if blocks else None
            if (
                dialogue_open
                and previous is not None
                and previous["kind"] == "dialogue"
                and previous["speaker"] == speaker
            ):
                previous["text"] = f"{previous['text']}<br>{stripped}"
            else:
                add(
                    {"kind": "dialogue", "speaker": speaker, "text": stripped}
                )
            dialogue_open = True
        else:
            paragraph.append(stripped)
    flush()
    return blocks


def _image_name(value: Any) -> str:
    name = one_line(value)
    if not name:
        return ""
    if name.lower().endswith(_IMAGE_SUFFIXES):
        return name
    return f"{name}.png"


def _sound_value(block: dict[str, Any]) -> str:
    name = one_line(block.get("name"))
    label = one_line(block.get("label"))
    if name and label:
        return f"{name},{label}"
    return name or label


def _mail_header(block: dict[str, Any]) -> str:
    parts = []
    for key, param in (
        ("title", "主题"),
        ("from", "发件人"),
        ("to", "收件人"),
    ):
        value = one_line(block.get(key))
        if value:
            parts.append(f"|{param}={value}")
    return "{{邮件抬头" + "".join(parts) + "}}" if parts else ""


def _booklet(block: dict[str, Any]) -> str:
    parts = []
    for key, param in (("title", "标题"), ("subtitle", "副标题")):
        value = one_line(block.get(key))
        if value:
            parts.append(f"|{param}={value}")
    paragraphs = block.get("paragraphs") or []
    body = "<br><br>".join(
        str(paragraph).strip().replace("\n", "<br>")
        for paragraph in paragraphs
        if str(paragraph).strip()
    )
    if body:
        parts.append(f"|正文={body}")
    return "{{小册子" + "".join(parts) + "}}" if parts else ""


def render_prose(blocks: Iterable[dict[str, Any]]) -> str:
    """Join narration paragraphs for a pure-prose document."""
    paragraphs: list[str] = []
    for block in blocks:
        if block.get("kind") == "narration":
            text = str(block.get("text") or "").strip("\n")
        elif block.get("kind") == "mail":
            text = str(block.get("body") or "").strip("\n")
        else:
            continue
        if text:
            paragraphs.append(text)
    return "\n\n".join(paragraphs)


def render_document(
    blocks: Iterable[dict[str, Any]],
    *,
    dialogue_template: str,
    sound_template: str,
    poem_prose: bool,
) -> tuple[str, list[Conflict]]:
    """Render an OS/OA body.

    A document made only of prose and attachments wraps the prose once in
    ``<poem>`` (the existing diary/announcement pages do this).  A document
    with dialogue keeps the OS template blocks and uses ``<br>`` for line
    breaks inside narration.
    """
    blocks = list(blocks)
    if poem_prose and not any(
        block.get("kind") in ("dialogue", "sound", "movie", "booklet", "imageviewer")
        for block in blocks
    ):
        body = render_prose(blocks)
        if not body:
            return "", []
        parts = [f"<poem>\n{body}\n</poem>"]
        for block in blocks:
            if block.get("kind") in ("image", "imageviewer"):
                name = _image_name(block.get("id"))
                if name:
                    parts.append(f"[[File:{name}|thumb]]")
            elif block.get("kind") == "mail":
                header = _mail_header(block)
                if header:
                    parts.append(header)
        return "\n".join(parts), []
    return render_blocks(
        blocks,
        dialogue_template=dialogue_template,
        sound_template=sound_template,
    )


def render_blocks(
    blocks: Iterable[dict[str, Any]],
    *,
    dialogue_template: str,
    sound_template: str,
) -> tuple[str, list[Conflict]]:
    """Render parsed blocks into the site's OS/OA templates."""
    lines: list[tuple[str, bool]] = []
    conflicts: list[Conflict] = []
    for block in blocks:
        kind = block.get("kind")

        def add_line(text: str, *, _block: dict[str, Any] = block) -> None:
            lines.append((text, bool(_block.get("blank_before"))))
        if kind == "dialogue":
            speaker = one_line(block.get("speaker"))
            text = str(block.get("text") or "").strip("\n")
            if text:
                add_line(f"{{{{{dialogue_template}|{speaker}|{text}}}}}")
        elif kind == "narration":
            text = str(block.get("text") or "").strip("\n")
            if text:
                add_line(text.replace("\n", "<br>"))
        elif kind == "sound":
            value = _sound_value(block)
            if value:
                add_line(f"{{{{{sound_template}|{value}}}}}")
        elif kind in ("image", "imageviewer"):
            name = _image_name(block.get("id"))
            if name:
                add_line(f"[[File:{name}|thumb]]")
        elif kind == "mail":
            header = _mail_header(block)
            if header:
                add_line(header)
            body = str(block.get("body") or "").strip("\n")
            if body:
                add_line(f"<poem>\n{body}\n</poem>")
        elif kind == "booklet":
            booklet = _booklet(block)
            if booklet:
                add_line(booklet)
        elif kind == "movie":
            conflicts.append(
                Conflict("unrendered_movie", f"{one_line(block.get('id'))} has no BV mapping")
            )
        elif kind == "bgm":
            continue
        else:
            conflicts.append(
                Conflict("unrendered_block", f"unsupported block {kind!r}")
            )
    parts: list[str] = []
    for index, (text, blank_before) in enumerate(lines):
        if index:
            parts.append("\n\n" if blank_before else "\n")
        parts.append(text)
    return "".join(parts), conflicts


# --------------------------------------------------------------------- titles
def disambiguate_titles(
    models: list[PageModel], reserved: Counter[str] | None = None
) -> None:
    """Number repeated ``文件名（角色）`` titles like the site's `` 2`` pages."""
    counts = Counter(model.field_value("title") for model in models)
    counts.update(reserved or {})
    seen: Counter[str] = Counter(reserved or {})
    for model in models:
        base = model.field_value("title")
        if counts[base] <= 1:
            continue
        seen[base] += 1
        if seen[base] == 1:
            continue
        marker = base.rfind("（")
        suffix = f" {seen[base]}"
        title = base[:marker] + suffix + base[marker:] if marker > 0 else base + suffix
        model.sections = tuple(
            Section(
                section.kind,
                tuple(
                    Field(field.name, Text.of(title))
                    if field.name == "title"
                    else field
                    for field in section.fields
                ),
            )
            for section in model.sections
        )
