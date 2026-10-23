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

    def flush() -> None:
        nonlocal paragraph
        if paragraph:
            blocks.append({"kind": "narration", "text": "\n".join(paragraph)})
            paragraph = []

    for raw in (text or "").split("\n"):
        line = raw.rstrip()
        if line.startswith("##"):
            flush()
            key, _, value = line[2:].partition("=")
            key, value = key.strip(), value.strip()
            if key == "conversation":
                speaker = one_line(value) or None
                mode = "dialogue"
            elif key == "text":
                speaker = None
                mode = "text"
            elif key == "sound":
                name, _, label = value.partition(",")
                blocks.append(
                    {"kind": "sound", "name": name.strip(), "label": label.strip()}
                )
            elif key == "image":
                blocks.append({"kind": "image", "id": value})
            elif key == "movie":
                blocks.append({"kind": "movie", "id": value})
            elif key == "bgm":
                blocks.append({"kind": "bgm", "name": value})
            elif key == "mail":
                parts = [one_line(item) for item in value.split(",")]
                while len(parts) < 3:
                    parts.append("")
                blocks.append(
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
                blocks.append({"kind": "note", "directive": key, "value": value})
            continue

        stripped = line.strip()
        if not stripped:
            flush()
            continue
        if mode == "mail" and blocks and blocks[-1]["kind"] == "mail":
            body = blocks[-1]["body"]
            blocks[-1]["body"] = (body + "\n" + stripped).strip("\n")
        elif mode == "dialogue" and speaker:
            blocks.append({"kind": "dialogue", "speaker": speaker, "text": stripped})
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


def render_blocks(
    blocks: Iterable[dict[str, Any]],
    *,
    dialogue_template: str,
    sound_template: str,
) -> tuple[str, list[Conflict]]:
    """Render parsed blocks into the site's OS/OA templates."""
    lines: list[str] = []
    conflicts: list[Conflict] = []
    for block in blocks:
        kind = block.get("kind")
        if kind == "dialogue":
            speaker = one_line(block.get("speaker"))
            text = str(block.get("text") or "").strip("\n")
            if text:
                lines.append(f"{{{{{dialogue_template}|{speaker}|{text}}}}}")
        elif kind == "narration":
            text = str(block.get("text") or "").strip("\n")
            if text:
                lines.append(f"<poem>\n{text}\n</poem>")
        elif kind == "sound":
            value = _sound_value(block)
            if value:
                lines.append(f"{{{{{sound_template}|{value}}}}}")
        elif kind in ("image", "imageviewer"):
            name = _image_name(block.get("id"))
            if name:
                lines.append(f"[[File:{name}|thumb]]")
        elif kind == "mail":
            header = _mail_header(block)
            if header:
                lines.append(header)
            body = str(block.get("body") or "").strip("\n")
            if body:
                lines.append(f"<poem>\n{body}\n</poem>")
        elif kind == "booklet":
            booklet = _booklet(block)
            if booklet:
                lines.append(booklet)
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
    return "\n".join(lines), conflicts


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
