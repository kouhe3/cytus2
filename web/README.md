# Cytus II SPA

Local React + Vite + TypeScript reader for the canonical DB. It consumes the
projection written by `python -m cytus2db build` (`build/spa/data.json`) plus the
matching text store; it does not define a second entity model.

## Start

```bash
cd web
pnpm install   # once
pnpm dev       # http://127.0.0.1:5190
```

`pnpm dev` is the one command to start the app. If `build/spa/data.json` is
missing it first runs `python -m cytus2db build --out build/` from the repository
root; that step needs the Python input tree (`CYTUS2_WORK`) and UnityPy. The Vite
plugin then serves the projection and text store under `/db/*`.

Prefer building first with
`uv run python -m cytus2db build --out build/ --input cytus2_work` from the
repository root when the default `python` does not have UnityPy;
`CYTUS2_BUILD_DIR` points the dev server at an existing build directory.

## Routes

| Route | Content |
|:--|:--|
| `/` | redirects to `/timeline` |
| `/timeline` | global unlock timeline: all 323 iM posts + the 501 main-seven OS logs (`timeline_scope=timeline`) ordered by `reading_order.order`; level slider, type, tier and iM account filters |
| `/characters` | character index: one card per character (27) with its gallery icon, name, OS-log count and game id, sorted by name; each card opens the character page |
| `/character/<gameId>` | character page: logo, every costume illustration and the bad-ending (`broken_illustration_*`) variant, then every OS log of that character via `OS → SORT BY VERSION`; PAFF / NEKO / ROBO add an IM tab linking to the account-filtered feed |
| `/os` | OS archive index with the game's three groupings: chapter → folder (default; 17 chapters with logs, each split by `TimelineChapter.Folder`), character → version, and version → character. The chapter order follows the wiki-maintained game list (`Amiya` between `Decommission` and `cyTus`), not the table's `Id`. Every file carries the 1-based unlock level of its own character (`Lv N`, e.g. `Lv 36`); other characters' level conditions and the file-lock chain stay in the entity detail, and the list neither hides files nor marks them as locked. Staging chapters `test01` / `test02` stay out of the chapter view; the chosen mode persists in `sessionStorage` |
| `/oa` | OA archive index: one card per character with object/document/description counts |
| `/oa/<gameId>` | OA archive: scene videos with scene LOGOs, every clickable object as a link into its own entity page, and hotspot descriptions grouped by `DescriptionObjectId`. Each description variant states its in-game enable/disable conditions (level lock, OS read, story clear), because one hotspot swaps text across story stages and the game picks one eligible variant at random. The object page (`/oa_object/<gameId>`) owns the object text, its color art plus three panel images, attached documents, unlock conditions and level locks; OA entity pages link back to their character's archive |
| `/backup` | Backup Database folder index with per-folder gallery logos and media counts |
| `/backup/<gameId>` | folder header logo, then items grouped as a media retrospective; kind filter, conditions, boss-stage links |
| `/story` | story nodes ordered by reading order; level/version/chapter sort, event/Branching OS filter |
| `/shop` | CAPSO packs, gacha machine and shop bundles; Black Market badge |
| `/extras` | appendix hub: assistant dialogues, title-screen evolution, song-select media and the cutscene subtitle library |
| `/extras/assistants` | iM assistant dialogue groups, pages and trigger/target, all five languages |
| `/extras/titles` | 10 title screens with story unlocks and `video_title_*` playback; missing clips are marked |
| `/extras/songselect` | song-select media: 36 normal `video_songselect_*` backgrounds grouped by the 27 packs (costume / story variants kept separate) and the 14 true-end scene entries in game order. Vanessa has no exclusive true-end scene (story design, its entry carries Miku's clip); Bo Bo's duplicate video is called out but not shown. Videos never autoplay |
| `/extras/cutscenes` | cutscene subtitle library: all 55 subtitle groups paired with their exported clip (exact key, then a trailing `_N` removed), a dialogue search that lists every matching cue in every language (bounded per group/language and in total, with a hidden-match count) and seeks the paired clip to the clicked cue, muxed audio variants for silent clips in both rows and the cue player, and the 62 exported videos without subtitles |
| `/search?q=<text>` | full-text search over iM posts, OS logs, OA documents and subtitle lines, grouped by type |
| `/im/<gameId>`, `/os/<gameId>`, `/<type>/<gameId>` | entity detail with body text, type-specific facts, charts, and inbound/outbound edges; iM posts render their inbound replies as a full rich-text feed directly under the post body (one batched text request per language) while the neighbour list stays a navigation index, title-only iM posts carry an explicit note, and the four Bili-Wiki-confirmed posts carry a manual removed-after-reading note. An OS log with a first-open cutscene shows it as a 16:9 player above the body, with the sidebar language's subtitle track (or an explicit missing-subtitle note) |
| `/song/<songId>@<Difficulty>` | chart detail: level, NeedUnlock, song, the chart's own audio track (`music_id` and its `duration_seconds` formatted `m:ss`; THE BEGINNING shows 1:20 / 1:07 / 2:18), unlock sources from `unlocks_chart` edges, sibling difficulties |

History routing is used, so every URL can be opened or refreshed directly, and
the browser back/forward buttons work. `Ctrl+K` (or `Cmd+K`) opens the command
palette, which searches the same full-text index and groups hits by entity type;
`/search` is the keyboard-navigable full page for the same query.

The sidebar language switch covers `en`, `ja`, `zh-Hant`, `ko` and `zh-Hans`
and persists to `localStorage`. It drives both halves of the interface from one
state: UI copy comes from `src/data/messages.ts` through `useI18n()`, while
text records come from the canonical store in the same language. When a record
has no body the server returns an explicit fallback (or a 404) and the page
shows which language is being displayed.

`messages.ts` is the only source of UI copy. `zh-Hans` defines the key union,
every other dictionary is typed as `Messages`, and labels for entity types,
relations and units live beside it. Missing keys fall back to `zh-Hans` and log
a development warning; the raw key is never rendered. `useI18n()` also exposes
`Intl`-backed `formatNumber` / `formatDate`, so counts and dates follow the
active locale. Entity titles and bodies are not translated by this dictionary.

`/timeline` reads only `timeline_scope=timeline` rows. Paid and side/DLC OS
logs (`timeline_scope=character`) stay out of the feed and appear only on
their character page, sorted by the numeric `version_order`. The account
filter uses the seven icons from `im_filter_data` (exported as `imFilters` in
`data.json`) plus `other/NPC`. That filter is a feed dimension, not the
character-page navigation: only PAFF / NEKO / ROBO have an IM tab, so Xenon,
ConneR, Cherry and JOE do not, and PΛFF has none either. PΛFF's four epilogue
posts remain in the global feed.

## Served artifacts

| Endpoint | Source |
|:--|:--|
| `GET /db/data.json` | `build/spa/data.json` verbatim |
| `GET /db/text.json` | snippet and name index derived from `build/text/*.jsonl` (`im_os`, `oa`, `story`, `extras`, `packs`, `subtitles`) |
| `GET /db/text?ref=…&lang=…` | one full text record with `requested_lang` / `fallback` fields |
| `GET /db/search?q=…&lang=…&limit=…` | full-text match groups for posts, logs, OA documents and subtitle lines |
| `GET /media/<path>` | local media export (title clips under `titles/<clip>.mp4`, archive clips under `videos/<clip>.mp4`, character song-select backgrounds under `videos/songselect/<clip>.mp4`, subtitle files under `subs/<clip>.<lang>.vtt`), Range-capable |

The text index also reads `build/text/extras.jsonl`; the extras routes use it
through the same `text_ref` contract as the timeline. `/media/*` defaults to
`viewer/public/media` and can be pointed elsewhere with `CYTUS2_MEDIA_DIR`.
When a title clip is absent the page renders an explicit
`title-video-missing` note instead of a broken player.

`/media/manifest.json` carries a `songSelect` section next to `videos`:
`normal` holds all 36 `video_songselect_*` backgrounds (27 packs plus costume /
story variants; all but `ilka001_s001`, `joe001` and `miku001` are silent),
`trueEnd` holds the 15 `video_trueend_*` backgrounds
(14 in the scene's `sceneOrder`, with `bobo001` marked as a duplicate of
`robo001`), and `sceneOrder` records the true-end pack order. Export facts are
data-driven: `duplicateOf` lists byte-identical clips within a section, and
`contentMatches` lists normal clips whose bytes equal a true-end clip.
`vanessa001` matches `miku001_song_select` because Vanessa has no exclusive
true-end scene (story design), so its bundle carries Miku's clip; this is
metadata, not an export error. The song-select clips stay out of `videos` so
the Cutscene Library does not list them as subtitle-less cutscenes.

Every archive video — the OS cutscene section, OS/OA inline `##movie` blocks
and OA scene clips — renders through the shared `VideoPlayer`
(`src/components/VideoPlayer.tsx`). It resolves the clip through
`/media/manifest.json` (`movies` first, then `videos`), attaches the exact
subtitle group's VTT for the active language, never autoplays, and explains a
missing clip or a missing language track with a note instead of a broken
element. Inline movies and OA scenes pass `subtitleKey={null} missing="hide"`,
which keeps their previous no-note behaviour. Only the Cutscene Library opts
into #32's no-audio note with `showAudioNote`, and a resolved muxed
`videoAudio` variant suppresses it; the OS/gallery/story/OA players never show
it.

OS phone transcripts (`##json=msgs`, e.g. `os/nos021`) render as a chat: every
message keeps its side (`MessageType` 1/3 is the phone owner, 2/4 the other
party, 0 a system line), its sender avatar, timestamp and sticker. The export
puts `osavatars.ab` / `osstickers.ab` under `os-avatars/` and `os-stickers/`
(`osAvatars` / `osStickers` in `/media/manifest.json`); a message whose sprite
is missing shows its attachment id instead of disappearing.

Subtitle cues and pack descriptions follow the same contract: the entity only
carries `text_ref`, and their localized text is read from
`build/text/subtitles.jsonl` / `build/text/packs.jsonl`. Title names are
rendered from `text_ref` too, so switching the sidebar language never falls
back to a hard-coded name.

## Checks

```bash
pnpm typecheck
pnpm build
pnpm check:i18n  # dictionary key/placeholder parity + no CJK outside messages.ts
pnpm smoke       # app must be running; Edge CDP at 127.0.0.1:9333
```

`pnpm check:i18n` and `pnpm smoke` import `src/data/messages.ts` directly;
Node 24 strips the types, so no test runner or build step is involved.

`pnpm smoke` drives a real Edge tab over the DevTools protocol and asserts the
824-entry home feed and its account filter, the character OS version order and
the IM tab limited to PAFF / NEKO / ROBO, the PΛFF note, the slider/filter
behaviour, the Ctrl+K palette, a chart opened from an entity link, an
unlock-source jump, direct chart deep links, the return to the timeline, the
chart → post → chart round trip, the OS chapter → folder index (17 chapters,
54 folders, 1032 logs) and its three-way grouping switch, the OA archive and
document views (whose silent `_oa_system` scene players stay free of the
library's no-audio note), a backup gallery item, a Branching OS node, a CAPSO
pack and the Black Market bundle, the extras hub, all 19 assistant groups / 30
pages with their language switch, the 10 title screens and 13 video clips (or
their missing-export notes), the cutscene subtitle library (55 group rows, 62
videos without subtitles, the sidebar language switch and the two missing-en
notes, the single `Waahhhh` hit that seeks its clip to 3.7s, the repeated
`choice is obvious` line listed at both 7.7s and 16.9s, the ten `Shelter` cues
across all five languages, the `Sister Shannon` cue whose 97.95s prints as
`1:38.0`, the bounded `neko` list with its hidden-match count, the muxed
`audioKey` swap on both a library row and the cue player that drops the
no-audio note, and the missing-clip note), the
OS cutscene player (resolved `videos/<clip>.mp4`
source, no autoplay, 17 zh-Hans cues, the ja track swap without a page reload,
the missing-subtitle and missing-clip notes and the 390px no-overflow layout),
grouped search hits opened with the keyboard, and the
five-language switch
including the explicit missing-language fallback. The switch checks assert the
sidebar label, timeline heading/filter/level gate/account heading, character
tab and PΛFF note in each of the five languages, plus that the canonical text
language changes with the UI.
Screenshots land in `web/.shots/` (git-ignored).

## Scope

The SPA is the only reader of the canonical projection: the shell, the
`/timeline` home, OA, Backup Database, story nodes, CAPSO/gacha/bundles,
chart/entity details, the `/extras` assistants and titles pages, full-text
search and the five-language switch all read the same `build/spa/data.json` +
text stores. `/extras/cutscenes` is the one route outside that contract: it
builds its rows from `/media/manifest.json` and loads the exported
`subs/<group>.<lang>.vtt` files on demand, because the canonical projection
carries no cutscene dialogue.

`web/` is self-contained: it imports nothing from `viewer/` and reads only
`build/` artifacts for its data model. The one runtime exception is the media
export (`/media/*`, default `viewer/public/media`, override with
`CYTUS2_MEDIA_DIR`), which is generated by `export_media.py` and is too large
for `build/`. The old `viewer/` is frozen — it is not part of the build, and
its `viewer/public/data/` exports are neither produced by the canonical
pipeline nor consumed here.
