"""Story gate -> ending-branch semantic code.

The game ships only story-lock ids (``story_ending03_good_ending1``); which
ending branch each id denotes, and the reason for that claim, are manual.  The
reading-order projection stores the semantic code and the wiki page model
renders its own display label, so both read this module instead of keeping
private maps that can drift.
"""

from __future__ import annotations

# Story gate -> (semantic code, reason).  The codes are stable data values; the
# localized display label belongs to the consuming surface.
ENDING_BRANCHES: dict[str, tuple[str, str]] = {
    "story_ending03_good_ending1": (
        "good_ending1",
        "ending03 branch reached by responding to PAFF",
    ),
    "story_ending03_good_ending2": (
        "good_ending2",
        "ending03 branch reached without responding to PAFF",
    ),
    "story_ending04_main": (
        "ending04",
        "ending04 main ending",
    ),
}
ENDING_BRANCH_LOCATOR = "cytus2db/branches.py:ENDING_BRANCHES"


def ending_branch(story_gate: str) -> tuple[str, str] | None:
    """Return ``(semantic code, reason)`` for a story gate, if known."""
    return ENDING_BRANCHES.get(story_gate)
