"""Canonical key rules.

Entities are addressed by ``<type>/<game id>``. Songs and charts use the
addressable forms fixed by the spec: ``song/<songId>`` and
``song/<songId>@<Difficulty>``. Chart difficulty is always one of the seven
game values, never a number.
"""

from __future__ import annotations

import re
import unicodedata
from urllib.parse import quote

DIFFICULTIES = ("Easy", "Hard", "Chaos", "Glitch", "Crash", "Dream", "Drop")
DIFFICULTY_SET = frozenset(DIFFICULTIES)

_SLUG_RE = re.compile(r"[^a-z0-9]+")


def song_key(song_id: str) -> str:
    return f"song/{song_id}"


def chart_key(song_id: str, difficulty: str) -> str:
    if difficulty not in DIFFICULTY_SET:
        raise ValueError(
            f"unknown chart difficulty {difficulty!r}; expected one of {', '.join(DIFFICULTIES)}"
        )
    return f"song/{song_id}@{difficulty}"


def entity_key(entity_type: str, game_id: str) -> str:
    return f"{entity_type}/{game_id}"


def asset_key(kind: str, name: str) -> str:
    # Media resource names are identity, so the key keeps them losslessly.
    # Percent-encoding removes whitespace and slashes without collisions.
    return f"asset/{kind}/{quote(name, safe='')}"


def slug(text: str) -> str:
    """Stable URL/key slug for a display name that has no game id.

    Spaces, underscores, ampersands and punctuation collapse into single
    hyphens so folder keys never contain a slash or whitespace.
    """
    value = unicodedata.normalize("NFKC", text).strip().lower()
    value = _SLUG_RE.sub("-", value).strip("-")
    if not value:
        raise ValueError(f"cannot build a slug from {text!r}")
    return value
