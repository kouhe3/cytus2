"""Hand-maintained wiki facts the APK does not carry.

ADR-0003 allows a page field only when it is verifiable from the game data.
An override is the explicit exception: the value is written down here together
with the chapter/symbol it annotates, and every use is recorded as ``manual``
provenance so the page footer cites it with ``<ref>``.

Nothing in this module is inferred at runtime.  Adding an entry is a reviewed
edit, not a heuristic.
"""

from __future__ import annotations

from ..branches import ENDING_BRANCH_LOCATOR, ending_branch as ending_branch_code
from ..provenance import manual

# Semantic branch code -> label shown by ``Im/帖``'s ``结局分支``.  Gate ids
# and the reason each code denotes live in the shared ``branches`` module; the
# wiki's own pages call the two ending03 branches GE/BE, and ending04 has no
# wiki label.
IM_POST_ENDING_BRANCH_LABELS: dict[str, str] = {
    "good_ending1": "GE",
    "good_ending2": "BE",
}


def ending_branch(story_gate: str) -> tuple[str, dict[str, str]] | None:
    """Return ``(label, manual provenance)`` for a story gate, if known."""
    found = ending_branch_code(story_gate)
    if found is None:
        return None
    code, reason = found
    label = IM_POST_ENDING_BRANCH_LABELS.get(code)
    if label is None:
        return None
    return label, manual(ENDING_BRANCH_LOCATOR, f"{story_gate}: {reason}")
