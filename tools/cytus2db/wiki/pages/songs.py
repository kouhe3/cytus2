"""Song page builder (ticket #8)."""

from __future__ import annotations

from ..model import PageModel
from ..songs import build_song_pages


def build(db) -> list[PageModel]:
    return build_song_pages(db)
