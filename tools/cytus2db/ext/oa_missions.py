"""Localized OA mission sentences for wiki page rendering (ticket #11).

The canonical entities model an OA document's mission id but not the UI
sentence that tells the player how to unlock it.  The wiki needs that sentence
(or its page cannot fill ``描述`` / ``条件``), and it is localized text, so it
belongs in the derived text store rather than as an entity field.  This module
adds ``text/oa_missions.jsonl`` without touching the OA entity schema.
"""

from __future__ import annotations

import json
from pathlib import Path
from typing import Any

from ..sources import LANGS, InputSource

_OA_TABLE = ("oasystemdata", "oa_system_data")
_ARTIFACT = Path("text") / "oa_missions.jsonl"
_LANG_RANK = {code: index for index, (code, _) in enumerate(LANGS)}


def write_artifacts(
    out: Path,
    source: InputSource,
    entities: dict[str, list[dict[str, Any]]],
) -> None:
    table = source.text_json(*_OA_TABLE)
    if table is None or not isinstance(table.data, dict):
        return
    missions = table.data.get("Missions")
    if not isinstance(missions, list):
        return

    records = []
    for mission in missions:
        if not isinstance(mission, dict):
            continue
        mission_id = str(mission.get("MissionId") or "").strip()
        if not mission_id:
            continue
        details = mission.get("Details")
        base = {
            "ref": f"oa_mission/{mission_id}",
            "entity": "oa_mission",
            "mission_type": str(mission.get("Type") or ""),
            "args": str(mission.get("Args") or ""),
        }
        for code, slot in LANGS:
            text = ""
            if (
                isinstance(details, list)
                and slot < len(details)
                and isinstance(details[slot], str)
            ):
                text = details[slot]
            records.append({**base, "lang": code, "text": text})

    records.sort(key=lambda record: (record["ref"], _LANG_RANK[record["lang"]]))
    path = Path(out) / _ARTIFACT
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open("w", encoding="utf-8", newline="\n") as handle:
        for record in records:
            handle.write(
                json.dumps(record, ensure_ascii=False, sort_keys=True, separators=(",", ":"))
            )
            handle.write("\n")
