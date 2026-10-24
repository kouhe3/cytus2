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
| `/timeline` | iM posts + OS logs ordered by `reading_order.order`; level slider, type and tier filters |
| `/oa` | OA archive index: one card per character with object/document/description counts |
| `/oa/<gameId>` | OA workspace: object tabs, each object's text and documents, all hotspot descriptions |
| `/backup` | Backup Database folder index with per-folder media counts |
| `/backup/<gameId>` | folder items grouped as a media retrospective; kind filter, conditions, boss-stage links |
| `/story` | story nodes ordered by reading order; level/version/chapter sort, event/Branching OS filter |
| `/shop` | CAPSO packs, gacha machine and shop bundles; Black Market badge |
| `/extras` | appendix hub: assistant dialogues and title-screen evolution |
| `/extras/assistants` | iM assistant dialogue groups, pages and trigger/target, all five languages |
| `/extras/titles` | 10 title screens with story unlocks and `video_title_*` playback; missing clips are marked |
| `/search?q=<text>` | full-text search over iM posts, OS logs, OA documents and subtitle lines, grouped by type |
| `/im/<gameId>`, `/os/<gameId>`, `/<type>/<gameId>` | entity detail with body text, type-specific facts, charts, and inbound/outbound edges |
| `/song/<songId>@<Difficulty>` | chart detail: level, NeedUnlock, unlock sources from `unlocks_chart` edges, backlinks, sibling difficulties |

History routing is used, so every URL can be opened or refreshed directly, and
the browser back/forward buttons work. `Ctrl+K` (or `Cmd+K`) opens the command
palette, which searches the same full-text index and groups hits by entity type;
`/search` is the keyboard-navigable full page for the same query.

The sidebar language switch covers `en`, `ja`, `zh-Hant`, `ko` and `zh-Hans`
and persists to `localStorage`. Text records come from the canonical store in
the selected language; when it has no body the server returns an explicit
fallback (or a 404) and the page shows which language is being displayed.

## Served artifacts

| Endpoint | Source |
|:--|:--|
| `GET /db/data.json` | `build/spa/data.json` verbatim |
| `GET /db/text.json` | snippet and name index derived from `build/text/*.jsonl` (`im_os`, `oa`, `story`, `extras`, `packs`, `subtitles`) |
| `GET /db/text?ref=…&lang=…` | one full text record with `requested_lang` / `fallback` fields |
| `GET /db/search?q=…&lang=…&limit=…` | full-text match groups for posts, logs, OA documents and subtitle lines |
| `GET /media/<path>` | local media export (title clips under `titles/<clip>.mp4`), Range-capable |

The text index also reads `build/text/extras.jsonl`; the extras routes use it
through the same `text_ref` contract as the timeline. `/media/*` defaults to
`viewer/public/media` and can be pointed elsewhere with `CYTUS2_MEDIA_DIR`.
When a title clip is absent the page renders an explicit
`title-video-missing` note instead of a broken player.

Subtitle cues and pack descriptions follow the same contract: the entity only
carries `text_ref`, and their localized text is read from
`build/text/subtitles.jsonl` / `build/text/packs.jsonl`. Title names are
rendered from `text_ref` too, so switching the sidebar language never falls
back to a hard-coded name.

## Checks

```bash
pnpm typecheck
pnpm build
pnpm smoke     # app must be running; Edge CDP at 127.0.0.1:9333
```

`pnpm smoke` drives a real Edge tab over the DevTools protocol and asserts the
home feed order, slider/filter behaviour, the Ctrl+K palette, a chart opened
from an entity link, an unlock-source jump, direct chart deep links, the return
to the timeline, the chart → post → chart round trip, the OA archive and
document views, a backup gallery item, a Branching OS node, a CAPSO pack and
the Black Market bundle, the extras hub, all 19 assistant groups / 30 pages
with their language switch, the 10 title screens and 13 video clips (or their
missing-export notes), grouped search hits opened with the keyboard, and the
five-language switch including the explicit missing-language fallback.
Screenshots land in `web/.shots/` (git-ignored).

## Scope

The SPA is the only reader of the canonical projection: the shell, the
`/timeline` home, OA, Backup Database, story nodes, CAPSO/gacha/bundles,
chart/entity details, the `/extras` appendix, full-text search and the
five-language switch all read the same `build/spa/data.json` + text stores.

`web/` is self-contained: it imports nothing from `viewer/` and reads only
`build/` artifacts for its data model. The one runtime exception is the media
export (`/media/*`, default `viewer/public/media`, override with
`CYTUS2_MEDIA_DIR`), which is generated by `export_media.py` and is too large
for `build/`. The old `viewer/` is frozen — it is not part of the build, and
its `viewer/public/data/` exports are neither produced by the canonical
pipeline nor consumed here.
