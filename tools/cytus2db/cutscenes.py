"""The game's first-open cutscene table.

``text/cutscenedata/cutscene_data_os`` maps a ``TriggerId`` -- an OS log id or
a Branching OS node id -- to the clip the game plays the first time that
archive entry is opened.  The clip stays a bare media reference (no asset
entity); both the OS log and the Branching OS node carry it as ``cutscene``.
"""

from __future__ import annotations

from .errors import BuildError
from .sources import InputSource

CUTSCENE_TABLE = ("cutscenedata", "cutscene_data_os")
CUTSCENE_LOCATOR = "text/" + "/".join(CUTSCENE_TABLE)


def cutscene_clips(source: InputSource) -> dict[str, str]:
    """TriggerId -> clip name (MovieFile without .mp4) for first-open clips."""
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
