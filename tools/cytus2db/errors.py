from __future__ import annotations


class BuildError(Exception):
    """A build-time failure that must exit non-zero without a traceback."""


class InputError(BuildError):
    """The input tree is incomplete or unreadable."""


class ValidationError(BuildError):
    """One or more entity records violate the hand-written schema."""

    def __init__(self, messages: list[str]) -> None:
        self.messages = messages
        super().__init__(f"{len(messages)} schema validation error(s)")
