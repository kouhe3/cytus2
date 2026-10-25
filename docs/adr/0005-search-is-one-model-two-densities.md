# ADR-0005: Search is one model shown at two densities

- Status: accepted
- Date: 2026-10-25

## Context

The SPA shipped two search surfaces that looked like two features:

- the sidebar **「搜索实体」** button opened a Ctrl K palette that scored
  reading-order entities and charts client-side, *and* ran a full-text request
  against `/db/search`, rendering both result sets in one list;
- **`/search`** ran the same endpoint through the same hook and rendered the
  same groups as a page.

The endpoint (`web/plugins/canonical-data.ts`) was already a hybrid: body text
for `im_post` / `os_log` / `oa_document` / `subtitle_line`, plus a title pass
(`titleSearch`) for posts and logs. So the palette was a strict superset of the
page (it also listed charts and the timeline), while the page was the only
shareable, keyboard-navigable view.

Three incoherences came with the split:

1. Copy lied about the data. `search.lede` / `search.coverageHint` claimed only
   bodies were searched and that replies were excluded — while the endpoint
   returned title matches and the palette injected charts.
2. `im_reply` already had text in the store and a snippet index
   (`SNIPPET_TYPES`) but was absent from `SEARCHABLE_TEXT_TYPES`, so reply prose
   was fetchable yet unsearchable.
3. Entity matching existed twice — the palette's client-side scorer and the
   server's token matcher — with two encoding rules for the same result href.

## Decision

1. **One model.** *Search* is a single query over **entity titles + narrative
   bodies**, returning one result set. The palette renders its head
   (*Search preview*); `/search?q=` renders it in full (*Search expanded*).
   Neither owns its own matching rules.
2. **Results are entities; pages are jumps.** A *Search result* opens an
   entity. Page entries (timeline, index pages) live in the palette's separate
   **跳转 / Jump** group and are never called results.
3. **Relevance order** is title-exact, title-prefix, title-contains, then
   body-only; ties break on title, then ref. Alphabetical order alone is not
   ranking — an exact entity name must not lose to an unrelated body match.
4. **`im_reply` joins the index.** Its body is independent narrative prose, the
   store already had it, and `entityHref` already encodes the `#` floor in reply
   ids. `story_node` stays out: its text repeats the subtitle lines, and indexing
   it would show the same sentence twice.
5. **Charts join as a group**, titled `song · difficulty · Lv <level>`, matched
   on that title plus song name, artist and `search_terms`. Charts are entities
   the user opens; leaving them palette-only meant `/search` could never find
   them.
6. **Counts are honest.** Each group reports `shown / total`; the expanded view
   can raise its per-group cap. A cap the UI does not disclose is a wrong answer.

## Consequences

- The sidebar exposes **one** entry: the Ctrl K trigger labelled 搜索. `/search`
  is no longer a nav destination; it is the expanded state of that search, still
  reachable by URL.
- `sidebar.searchTrigger` disappears from every locale; `search.eyebrow` /
  `title` / `lede` / coverage list describe titles *and* bodies.
- The palette's local matcher now only scores the handful of static page
  entries, so there is one entity matcher and one href encoding.
- `/db/search` response groups gain `total`; `limit` becomes a client choice
  rather than a hidden constant.
- Adding a searchable entity type is now one edit: the type list plus a title
  source. It does not require touching either surface.

## Alternatives rejected

- **Delete `/search`, keep the palette** — loses shareable `?q=` URLs, the
  grouped `shown / total` overview and keyboard traversal of long lists.
- **Delete the palette, focus `/search` on Ctrl K** — loses instant in-place
  lookup and the jump entries; every keystroke becomes a page navigation.
- **Keep both and only fix the copy** — leaves two matchers, two href encodings
  and a page that can never find charts. The duplication was the symptom.
- **Rank by title alphabetically** — reproducible but wrong: an exact entity
  name ranks below a body mention that happens to start with a smaller letter.
