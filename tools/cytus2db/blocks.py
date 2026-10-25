"""Parser for the game's script-style text bodies.

OS logs, OA documents and Branching OS nodes share one tiny script language:
``##conversation`` starts a speaker, ``##text`` starts narration, and
``##image`` / ``##movie`` / ``##sound`` / ``##bgm`` / ``##mail`` / ``##json``
emit media or layout blocks.  Trailing whitespace is insignificant; leading
whitespace is part of the text (the assets indent paragraphs with ideographic
spaces) and is preserved.
"""

from __future__ import annotations

import json
import re
from typing import Any

_PAGE = re.compile(r"<p>(.*?)</p>", re.IGNORECASE | re.DOTALL)


def one_line(value: Any) -> str:
    return " ".join(str(value or "").split())


# The game ships raw line breaks inside ``msgs`` message content ("Hello
# Simon, it's been a while⏎If you see this message..."), which strict JSON
# rejects.  Tolerating control characters keeps those bodies parseable.
_JSON_DECODER = json.JSONDecoder(strict=False)

# ``MessageType`` is the phone bubble kind: 0 is a system line such as
# "[JOE is offline]", 1/3 are the phone owner's text/image, 2/4 the other
# party's.  Sides drive the chat layout, so the mapping is not cosmetic.
_MSGS_SIDES = {0: "system", 1: "outgoing", 2: "incoming", 3: "outgoing", 4: "incoming"}

_MSGS_FIELDS = (
    ("Content", "text"),
    ("Image", "image"),
    ("UserName", "name"),
    ("Avatar", "avatar"),
    ("Time", "time"),
)


def _msgs_messages(payload: Any) -> list[dict[str, Any]]:
    if not isinstance(payload, list):
        return []
    messages: list[dict[str, Any]] = []
    for item in payload:
        if not isinstance(item, dict):
            continue
        try:
            message_type = int(item.get("MessageType"))
        except (TypeError, ValueError):
            message_type = 2
        message: dict[str, Any] = {
            "side": _MSGS_SIDES.get(message_type, "incoming")
        }
        for source, target in _MSGS_FIELDS:
            value = item.get(source)
            if not isinstance(value, str):
                continue
            if target == "text":
                if value.strip():
                    message[target] = value
            elif value.strip():
                message[target] = value.strip()
        if "text" in message or "image" in message:
            messages.append(message)
    return messages


def _consume_json(lines: list[str], start: int) -> tuple[Any, int, bool]:
    """Read one JSON value starting at ``lines[start]``.

    The ``##json=`` directives are followed by a pretty-printed payload that
    spans several lines, so parsing one line at a time would treat the tail as
    narration. Stop before the next directive and report failure instead of
    swallowing the rest of the body.
    """
    index = start
    buffer = ""
    started = False
    while index < len(lines):
        line = lines[index]
        stripped = line.lstrip()
        if buffer and stripped.startswith("##"):
            break
        if not started and stripped:
            if not stripped.startswith(("{", "[")):
                return None, start, False
            started = True
        index += 1
        buffer = f"{buffer}\n{line}" if buffer else line
        candidate = buffer.lstrip()
        if not candidate:
            continue
        try:
            payload, _ = _JSON_DECODER.raw_decode(candidate)
        except json.JSONDecodeError:
            continue
        return payload, index, True
    return None, start, False


def _json_blocks(viewer: str, payload: Any) -> list[dict[str, Any]]:
    """Turn one ``##json=<viewer>`` payload into blocks."""
    if viewer == "msgs" and isinstance(payload, list):
        messages = _msgs_messages(payload)
        if messages:
            return [{"kind": "msgs", "messages": messages}]
    if viewer == "gallery" and isinstance(payload, list):
        blocks: list[dict[str, Any]] = []
        for item in payload:
            if not isinstance(item, dict):
                continue
            gallery_id = str(item.get("Id") or "").strip()
            if gallery_id:
                # Gallery entries in OS bodies are exported OS attachments;
                # reuse the image block so SPA and wiki share one renderer.
                blocks.append({"kind": "image", "id": gallery_id})
        return blocks or [{"kind": "note", "directive": "json", "value": viewer}]
    if viewer == "booklet" and isinstance(payload, dict):
        body = str(payload.get("Content") or "").replace("\r\n", "\n")
        paragraphs = [
            item.strip("\n") for item in body.split("\n\n") if item.strip()
        ]
        return [
            {
                "kind": "booklet",
                "title": one_line(payload.get("Title")),
                "subtitle": one_line(payload.get("Subtitle")),
                "paragraphs": paragraphs,
            }
        ]
    if isinstance(payload, dict):
        return [
            {
                "kind": "imageviewer",
                "id": str(payload.get("Image") or ""),
                "viewer": viewer,
            }
        ]
    return [{"kind": "note", "directive": "json", "value": viewer}]


def parse_blocks(text: str) -> list[dict[str, Any]]:
    """Turn one script-style body into ordered blocks, preserving speakers."""
    blocks: list[dict[str, Any]] = []
    speaker: str | None = None
    mode = "dialogue"
    paragraph: list[str] = []
    dialogue_open = False
    pending_blank = False

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

    lines = (text or "").split("\n")
    index = 0
    while index < len(lines):
        line = lines[index].rstrip()
        index += 1

        if line.startswith("##"):
            pending_blank = False
            key, _, value = line[2:].partition("=")
            key, value = key.strip(), value.strip()
            if key == "conversation":
                flush()
                speaker = one_line(value) or None
                mode = "dialogue"
                dialogue_open = False
            elif key == "text":
                flush()
                speaker = None
                mode = "text"
            elif key == "bgm":
                if value.lower() not in ("", "mute"):
                    flush()
                    add({"kind": "bgm", "name": value})
            elif key == "sound":
                flush()
                name, _, label = value.partition(",")
                add(
                    {"kind": "sound", "name": name.strip(), "label": label.strip()}
                )
            elif key == "image":
                flush()
                add({"kind": "image", "id": value})
            elif key == "movie":
                flush()
                add({"kind": "movie", "id": value})
            elif key == "json":
                flush()
                payload, next_index, ok = _consume_json(lines, index)
                if ok:
                    index = next_index
                for block in _json_blocks(value, payload):
                    add(block)
            elif key == "mail":
                flush()
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
                flush()
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
            blocks[-1]["body"] = (body + "\n" + line).strip("\n")
        elif mode == "dialogue" and speaker:
            previous = blocks[-1] if blocks else None
            if (
                dialogue_open
                and previous is not None
                and previous["kind"] == "dialogue"
                and previous["speaker"] == speaker
            ):
                previous["text"] = f"{previous['text']}<br>{line}"
            else:
                add({"kind": "dialogue", "speaker": speaker, "text": line})
            dialogue_open = True
        else:
            paragraph.append(line)
    flush()
    return blocks


def paged_dialogue(text: str) -> list[dict[str, Any]]:
    """Split an OA description into its ``<p>`` pages, rendered as dialogue."""
    pages = [match.group(1).strip() for match in _PAGE.finditer(text or "")]
    pages = [page for page in pages if page]
    if not pages:
        body = (text or "").strip()
        return [{"kind": "dialogue", "text": body}] if body else []
    return [{"kind": "dialogue", "text": page} for page in pages]
