# ADR-0004: `SongPackId` is the character id; "Song Pack" means song-only DLC

- Status: accepted
- Date: 2026-10-25

## Context

The game's `song_pack_data.offline_song_pack_list` mixes two concepts that the
old viewer conflated:

- the **character/ownership unit** — `song_pack_id` is the target of level
  locks, iM/OS gates, exp tables and the character page (`paff001`, `ai001`);
- the **song-only DLC** — `expansion_pack_data.ExpansionPackList` sells five
  songs at a time and every song names the character it belongs to via
  `SongPackId` (for example `expack049` "Kizuna AI Extend 2026" adds
  `ai001_011`…`ai001_015` under `ai001`).

The old viewer put characters *inside* "song packs" and used "song pack" for
both the character record and DLC. That made `hasIM`, level locks and
expansion purchases read as properties of a pack instead of a character.

## Decision

1. **`SongPackId` is the character id.** Level locks, exp tables, iM/OS gates
   and ownership grouping all point at `character/<SongPackId>`. In game code
   `SimpleCharacterSongPackIdConverter.GetCharacterId()` is currently the
   identity mapping; the interface exists so this stays a lookup, not an
   assumption.
2. **"Character Pack"** (`pack`) is the *release record* of a character:
   `song_pack_id`, price, IAP flag, `hasIM`, theme colour and the character's
   base songs. It is 1:1 with `character` but keeps commercial/UI fields out
   of the character entity.
3. **"Song Pack"** is reserved for packs that sell **songs without selling a
   character** — the `expansion_pack` entities from `expansion_pack_data`.
   Their songs carry `SongPackId` = target character, so they appear under
   that character and share its level/exp and gates.
4. Expansion songs keep `pack_id = pack/<SongPackId>` and carry an extra
   `expansion_pack_id`. No expansion creates a new character.

## Consequences

- `db` gains `expansion_pack` (50 entries in the current APK) plus 252 songs
  and their charts; the SPA lists them in the shop and on the character.
- Buying an expansion pack is an entitlement on `expansion_pack_id`; buying a
  character pack is an entitlement on the character's `song_pack_id`. Both
  were already separate IAP products in game.
- `hasIM` stays a character-pack/UI flag; purchasing an expansion never adds
  an iM tab.
- `SongPackId` must not be used as the name of a commercial DLC; use
  `expansion_pack` / Song Pack for that.

## Alternatives rejected

- **Model expansion packs as characters**: duplicates character ids and
  breaks level locks and character pages.
- **Fold expansion songs into the base character pack only**: loses the
  purchase unit, price and provenance of the DLC.
- **Keep the old "song pack contains character" model**: cannot represent
  multiple DLC packs adding songs to one character without inventing
  characters.
