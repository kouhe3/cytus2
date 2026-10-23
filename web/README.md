# Cytus II SPA

Local React + Vite + TypeScript reader for the canonical DB. It consumes the
projection written by `python -m cytus2db build` (`build/spa/data.json`) plus the
matching text store; it does not define a second entity model.

## Start

```bash
cd web
pnpm install   # once
pnpm dev       # http://localhost:5190
```

`pnpm dev` is the one command to start the app. If `build/spa/data.json` is
missing it first runs `python -m cytus2db build --out build/` from the repository
root; that step needs the Python input tree (`CYTUS2_WORK`) and UnityPy. The Vite
plugin then serves the projection and text store under `/db/*`.

## Routes

| Route | Content |
|:--|:--|
| `/` | redirects to `/timeline` |
| `/timeline` | iM posts + OS logs ordered by `reading_order.order`; level slider, type and tier filters |
| `/im/<gameId>`, `/os/<gameId>`, `/<type>/<gameId>` | entity detail with body text, chart links, backlinks |
| `/song/<songId>@<Difficulty>` | chart detail: level, NeedUnlock, unlock sources from `unlocks_chart` edges, backlinks, sibling difficulties |

History routing is used, so every URL can be opened or refreshed directly, and
the browser back/forward buttons work. `Ctrl+K` (or `Cmd+K`) opens the command
palette; it is a shell navigation entry, not a search view.

## Served artifacts

| Endpoint | Source |
|:--|:--|
| `GET /db/data.json` | `build/spa/data.json` verbatim |
| `GET /db/text.json` | snippet index derived from `build/text/im_os.jsonl` |
| `GET /db/text?ref=…&lang=…` | one full iM post / OS log text record |

## Checks

```bash
pnpm typecheck
pnpm build
pnpm smoke     # app must be running; Edge CDP at 127.0.0.1:9333
```

`pnpm smoke` drives a real Edge tab over the DevTools protocol and asserts the
home feed order, slider/filter behaviour, the Ctrl+K palette, a chart opened
from an entity link, an unlock-source jump, direct chart deep links, and the
return to the timeline. Screenshots land in `web/.shots/` (git-ignored).

## Scope

This ticket covers the shell, the `/timeline` home and chart/entity details.
OA, CAPSO, Backup Database and full-text search views are ticket #15; the old
`viewer/` stays frozen.
