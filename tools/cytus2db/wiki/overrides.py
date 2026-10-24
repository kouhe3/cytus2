"""Hand-maintained wiki facts the APK does not carry.

ADR-0003 allows a page field only when it is verifiable from the game data.
An override is the explicit exception: the value is written down here together
with the chapter/symbol it annotates, and every use is recorded as ``manual``
provenance so the page footer cites it with ``<ref>``.

Nothing in this module is inferred at runtime.  Adding an entry is a reviewed
edit, not a heuristic.
"""

from __future__ import annotations

from ..provenance import manual

# Story gate -> ending-branch label shown by ``Im/帖``'s ``结局分支``.
# The game ships the gate ids (``story_ending03_good_ending1``) but no display
# label; the wiki's own pages call them GE/BE.
IM_POST_ENDING_BRANCHES: dict[str, tuple[str, str]] = {
    "story_ending03_good_ending1": (
        "GE",
        "story_ending03_good_ending1 is the good ending of the ending03 chain",
    ),
    "story_ending03_good_ending2": (
        "BE",
        "story_ending03_good_ending2 is the bad ending of the ending03 chain",
    ),
}
ENDING_BRANCH_LOCATOR = "cytus2db/wiki/overrides.py:IM_POST_ENDING_BRANCHES"


def ending_branch(story_gate: str) -> tuple[str, dict[str, str]] | None:
    """Return ``(label, manual provenance)`` for a story gate, if known."""
    found = IM_POST_ENDING_BRANCHES.get(story_gate)
    if found is None:
        return None
    label, note = found
    return label, manual(ENDING_BRANCH_LOCATOR, f"{story_gate}: {note}")
