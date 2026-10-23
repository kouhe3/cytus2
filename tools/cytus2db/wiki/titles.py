"""Shared MediaWiki-style title normalisation (ticket #20).

Two keys are defined:

``normalise_title``
    The MediaWiki title key: Unicode NFKC, ``_`` as a space, collapsed
    whitespace and a capitalised first character.  Only the first character is
    case-insensitive, so ``NEKO`` and ``Neko`` stay distinct pages, while
    ``illMenate`` and ``IllMenate`` collide.  On top of MediaWiki this module
    applies the site's explicit punctuation rules:

    * full-width parentheses, colons, commas and question marks fold to their
      half-width form (mostly NFKC, spelled out for titles that only differ by
      width);
    * the dash family (hyphen, non-breaking hyphen, figure dash, en/em dash,
      minus sign, full-width hyphen) folds to ``-``;
    * whitespace touching brackets, colons, ``;``, ``,``, ``!``, ``?``, ``.``
      or a dash is insignificant, so ``Baptism of Fire (CliqTrack remix)`` and
      ``Baptism of Fire(CliqTrack remix)`` are the same page title;
    * whitespace touching CJK characters is insignificant, matching Chinese
      wiki typography (``CyTus 流量年度报告`` == ``CyTus流量年度报告``).

    This is the key used for overwrite detection, collision checks and the
    verifier: a full page whose title key equals an existing title must never
    be written as a full page.

``match_key``
    A looser key used only to recover the site spelling when a target may
    differ by more than MediaWiki considers equivalent: case anywhere
    (``Bring the light`` == ``Bring the Light``), decorative slashes
    (``CHAOS //System Offline//`` == ``CHAOS System Offline``) and star
    glyph variants (``☆`` == ``✰``).  Loose keys are resolved only when they
    point at exactly one title; ambiguous groups are left unresolved instead
    of guessing.

``TitleResolver`` combines both keys into "target -> canonical site spelling"
lookups for link emission.
"""

from __future__ import annotations

import re
import unicodedata
from dataclasses import dataclass, field
from typing import Iterable

# Characters that MediaWiki's title rules do not touch but the Cytus II wiki
# uses interchangeably.  NFKC already folds the full-width forms; the
# remaining code points are folded explicitly so the difference is documented
# in one place instead of being an accident of NFKC.
_DASHES = "\u2010\u2011\u2012\u2013\u2014\u2015\u2212\ufe63\uff0d"
_STARS = "\u2605\u2606\u2726\u2727\u2729\u272a\u272b\u272c\u272d\u272e\u272f\u2730\u2b50"

_DASH_TABLE = str.maketrans({character: "-" for character in _DASHES})
_STAR_TABLE = str.maketrans({character: "\u2606" for character in _STARS})

# Punctuation whose surrounding whitespace does not distinguish titles.
_PUNCTUATION = "()[]{}<>:;,!?."
_PUNCTUATION_SPACE = re.compile(
    rf"\s*([{re.escape(_PUNCTUATION)}])\s*"
)

_CJK = "\u3400-\u4dbf\u4e00-\u9fff\u3040-\u309f\u30a0-\u30ff\uac00-\ud7af\uf900-\ufaff"
_CJK_SPACE_BEFORE = re.compile(rf"\s+(?=[{_CJK}])")
_CJK_SPACE_AFTER = re.compile(rf"(?<=[{_CJK}])\s+")

_SLASHES = re.compile(r"[/\\]")

# Link targets in these namespaces are files or category memberships, not
# pages: title normalisation must leave them alone.
IGNORED_TARGET_PREFIXES = (
    "file:",
    "image:",
    "category:",
    "文件:",
    "图像:",
    "分类:",
)


def normalise_title(title: str) -> str:
    """Return the MediaWiki title key used for equality and collisions."""
    text = unicodedata.normalize("NFKC", str(title or ""))
    text = text.replace("_", " ").translate(_DASH_TABLE)
    text = _PUNCTUATION_SPACE.sub(r"\1", text)
    text = _CJK_SPACE_BEFORE.sub("", text)
    text = _CJK_SPACE_AFTER.sub("", text)
    text = " ".join(text.split())
    if text:
        first = text[0].upper()
        # Unicode upper-casing may expand to several characters (``ß`` ->
        # ``SS``); MediaWiki only capitalises a single character and leaves
        # the rest alone, so refuse expansions.
        if len(first) == 1:
            text = first + text[1:]
    return text


def match_key(title: str) -> str:
    """Return the loose key used to recover a canonical spelling."""
    text = normalise_title(title).translate(_STAR_TABLE).casefold()
    text = _SLASHES.sub("", text)
    return " ".join(text.split())


@dataclass
class TitleResolver:
    """Resolve link targets to the site's canonical title spelling.

    Site titles (articles before redirects) are authoritative.  ``generated``
    entries map a title this run is about to create to the page it matched, so
    links to a generated variant point at the existing site page instead
    (``Audio Baro03 702 12 20（NEKO#ΦωΦ）`` -> ``Audio Baro03 702 12 20（NEKO）``).

    Loose matches are accepted only when they are unambiguous; a target that
    matches several titles is returned unchanged so the verifier can report it
    as a red link instead of silently guessing.
    """

    site: dict[str, str] = field(default_factory=dict)
    site_loose: dict[str, list[str]] = field(default_factory=dict)
    generated: dict[str, str] = field(default_factory=dict)
    generated_loose: dict[str, list[str]] = field(default_factory=dict)

    @classmethod
    def from_titles(
        cls,
        articles: Iterable[str],
        redirects: Iterable[str] = (),
    ) -> "TitleResolver":
        resolver = cls()
        for title in sorted(articles):
            resolver._add_site(title)
        for title in sorted(redirects):
            resolver._add_site(title)
        return resolver

    def add_generated(self, emitted: str, canonical: str) -> None:
        """Map one emitted title (and its canonical form) to ``canonical``."""
        for title in (emitted, canonical):
            if not title:
                continue
            key = normalise_title(title)
            existing = self.generated.get(key)
            if existing is not None and existing != canonical:
                continue
            self.generated[key] = canonical
            loose = match_key(title)
            bucket = self.generated_loose.setdefault(loose, [])
            if canonical not in bucket:
                bucket.append(canonical)

    def _add_site(self, title: str) -> None:
        key = normalise_title(title)
        if not key:
            return
        # Articles are added first and win over redirects.
        self.site.setdefault(key, title)
        loose = match_key(title)
        bucket = self.site_loose.setdefault(loose, [])
        if title not in bucket:
            bucket.append(title)

    def resolve(self, target: str) -> str:
        """Return the canonical spelling for ``target`` or ``target`` itself."""
        key = normalise_title(target)
        if not key:
            return target
        if key in self.site:
            return self.site[key]
        loose = match_key(target)
        candidates = self.site_loose.get(loose, [])
        if len(candidates) == 1:
            return candidates[0]
        if key in self.generated:
            return self.generated[key]
        candidates = self.generated_loose.get(loose, [])
        if len(candidates) == 1:
            return candidates[0]
        return target

    def is_known(self, target: str) -> bool:
        """True when ``resolve`` can point ``target`` at a known page."""
        return self.resolve(target) != target or self._known_unchanged(target)

    def _known_unchanged(self, target: str) -> bool:
        # A target may already be the canonical spelling.
        key = normalise_title(target)
        if not key:
            return False
        if self.site.get(key) == target or self.generated.get(key) == target:
            return True
        loose = match_key(target)
        candidates = self.site_loose.get(loose, [])
        if len(candidates) == 1 and candidates[0] == target:
            return True
        candidates = self.generated_loose.get(loose, [])
        return len(candidates) == 1 and candidates[0] == target
