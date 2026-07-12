---
quick_id: 260712-gm4
slug: add-autocomplete-on-search-input-by-arti
kind: research
date: 2026-07-12
---

# Research — search autocomplete by artist / song / album; which API?

## TL;DR

The search input **already has typeahead autocomplete** for **song** and **artist**
(`quick-260611-ql0`). It is powered by the **Deezer public search API**, proxied
own-origin at `/api/deezer/search`. Adding **album** autocomplete needs **NO new
API and NO new endpoint** — every Deezer hit already carries its album name.

## Which API supports this?

**Deezer public search** — `https://api.deezer.com/search?q=<term>&limit=<n>` (keyless,
no auth). It is CORS-blocked for direct browser fetch, so the app calls it through the
edge proxy `src/routes/api/deezer/search/+server.ts`. The proxy reshapes each hit to:

```ts
interface DeezerHit { id; title; artist; album; cover; preview }
//                          song    artist  ALBUM  ← already present
```

- `title`  → song name  (already surfaced as `kind:'song'`)
- `artist` → artist name (already surfaced as `kind:'artist'`)
- `album`  → **album name — present in the payload, just not yet surfaced**

Client fn: `deezerSearchTopN(term, limit, signal)` (`src/lib/services/deezer.ts`) →
`DeezerHit[]`. The search page's `fetchSuggestions` already calls it with
`limit = SUGGEST_CAP (8)`, debounced 300ms, race-guarded.

### Why NOT the other candidates

| API | Song | Artist | Album | Verdict |
|-----|------|--------|-------|---------|
| **Deezer /search** (in use) | ✓ | ✓ | ✓ (`.album` per hit) | **Use it — already wired, keyless, album free** |
| Deezer `/search/album?q=` | — | — | ✓ (true album entities) | Better album ranking but needs a NEW proxy route + client fn; overkill for a typeahead (against the "reuse, don't reinvent" constraint) — note as future option |
| iTunes Search | ✓ | ✓ | ✓ | CORS-open but a 2nd provider = mixed ranking/dupes; no reason to add |
| CN sources (netease/qq/kuwo) | ✓ | ✓ | partial | Heavier, per-source failure isolation; the sandbox can't even reach them for dev — Deezer is the right typeahead source |

## Recommended approach (chosen)

**Derive album suggestions from the DeezerHit set already fetched** — exactly how
artist suggestions are already derived in `deriveSuggestions()`
(`src/lib/search/autocomplete-logic.ts`):

- Add `'album'` to the `Suggestion.kind` union.
- In `deriveSuggestions`, emit distinct `kind:'album'` rows from `hit.album`
  (case-insensitive dedupe on `album|artist`, skip empty; carry the album's `artist`
  for the muted sub-line, like a song row).
- Interleave album rows into the capped list alongside songs + artists.
- Render an album glyph + title + artist sub in the typeahead; tap fills the input
  with the album name and runs the normal search (identical to the artist row's
  existing behavior — `pickSuggestion` is already generic on `s.title`).

**Cost:** one pure-function change + one render tweak. **Zero** new network calls,
endpoints, proxies, env vars, or npm deps. No i18n keys (rows are data + a glyph;
the header reuses `search.suggestions`).

## Integration points

- `src/lib/search/autocomplete-logic.ts` — `Suggestion` type + `deriveSuggestions()` (pure).
- `src/routes/(app)/search/+page.svelte` — the `{#each suggestions}` render (glyph + sub gate).
- Tests: `src/lib/search/autocomplete-logic.test.ts` — extend the `hit()` fixture with an
  album arg; add album-derivation cases.

## Pitfalls / gotchas

- **Album noise:** albums are derived from the top song hits for the query, so they
  reflect "albums appearing in these results" (same semantics as the existing artist
  rows). Acceptable + consistent; a dedicated `/search/album` endpoint is the upgrade
  path if album precision ever matters.
- **Cap fairness:** the interleave must give album rows a slot or they get starved
  below `SUGGEST_CAP=8`. Redesign the interleave to round-robin song/artist/album.
- **Key uniqueness:** `key = album:${title}|${artist}` — keep the kind prefix so an
  album named the same as a song/artist can't collide in the `{#each (key)}`.
- **Backward-compat:** existing tests build hits with `album:''`; empty albums are
  skipped, so those tests stay green untouched.
- **Sandbox note:** Deezer IS reachable in this dev sandbox (unlike CN sources), so the
  typeahead — including new album rows — can be verified live in the browser.
