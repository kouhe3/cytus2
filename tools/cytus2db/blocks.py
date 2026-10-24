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


def parse_blocks(text: str) -> list[dict[str, Any]]:
    """Turn one script-style body into ordered blocks, preserving speakers."""
    blocks: list[dict[str, Any]] = []
    speaker: str | None = None
    mode = "dialogue"
    paragraph: list[str] = []
    dialogue_open = False
    pending_viewer: str | None = None
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

    for raw in (text or "").split("\n"):
        line = raw.rstrip()
        if pending_viewer is not None:
            viewer, pending_viewer = pending_viewer, None
            payload: Any = None
            stripped = line.strip()
            if stripped.startswith("{"):
                try:
                    payload = json.loads(stripped)
                except json.JSONDecodeError:
                    payload = None
            if viewer == "booklet" and isinstance(payload, dict):
                body = str(payload.get("Content") or "").replace("\r\n", "\n")
                paragraphs = [
                    item.strip("\n") for item in body.split("\n\n") if item.strip()
                ]
                add(
                    {
                        "kind": "booklet",
                        "title": one_line(payload.get("Title")),
                        "subtitle": one_line(payload.get("Subtitle")),
                        "paragraphs": paragraphs,
                    }
                )
            elif isinstance(payload, dict):
                add(
                    {
                        "kind": "imageviewer",
                        "id": str(payload.get("Image") or ""),
                        "viewer": viewer,
                    }
                )
            else:
                add({"kind": "note", "directive": "json", "value": viewer})
            continue

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
                pending_viewer = value
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
