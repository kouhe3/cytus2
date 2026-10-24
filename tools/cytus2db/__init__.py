"""Cytus II canonical DB builder.

The package turns the locally unpacked game inputs (``$CYTUS2_WORK``) into the
canonical entity store described by GitHub issue #1: per-type JSONL, one
SQLite database and the SPA projection.
"""

from __future__ import annotations

__all__ = ["SCHEMA_VERSION"]

SCHEMA_VERSION = 1
