---
phase: quick-260919-pid
plan: 01
type: execute
wave: 1
depends_on: []
files_modified:
  - src/lib/search/autocomplete-logic.test.ts
  - src/lib/search/autocomplete-logic.ts
autonomous: true
requirements: [QUICK-260919-PID]

must_haves:
  truths:
    - "deriveSuggestions() returns artist rows first, then album rows, then song rows — never interleaved"
    - "At most ARTIST_ROWS (2) artist rows and at most ALBUM_ROWS (2) album rows are emitted; songs take every remaining slot up to SUGGEST_CAP"
    - "When a leading group is short (or empty), songs backfill so the output reaches SUGGEST_CAP whenever enough total suggestions exist — no holes"
    - "When there are no songs, artists/albums do NOT expand past their caps — a short output is correct (asymmetric by design)"
    - "Within each group the existing first-seen relevance order is unchanged"
    - "Every dedupe / empty-skip / MIN_QUERY_LEN / empty-hits behaviour is byte-for-byte unchanged"
    - "The search page renders suggestions in array order with the existing ♪ / ◎ / ♫ glyphs — no page change, no headings, no new i18n keys"
  artifacts:
    - path: "src/lib/search/autocomplete-logic.ts"
      provides: "ARTIST_ROWS / ALBUM_ROWS constants; bounded grouped concat replacing the interleave; decision record tagged quick-260919-pid with measured evidence, the superseded interleave rationale kept visible, gm4 reference intact"
      exports: ["ARTIST_ROWS", "ALBUM_ROWS"]
      contains: "quick-260919-pid"
    - path: "src/lib/search/autocomplete-logic.test.ts"
      provides: "ordering tests pinning artists(≤2) → albums(≤2) → songs(fill), backfill, and asymmetry cases"
      contains: "quick-260919-pid"
  key_links:
    - from: "src/routes/(app)/search/+page.svelte"
      to: "src/lib/search/autocomplete-logic.ts"
      via: "{#each suggestions as s (s.key)} renders deriveSuggestions() output in array order"
      pattern: "deriveSuggestions\\(hits, kw\\)"
---

<objective>
Replace the song/artist/album INTERLEAVE in `deriveSuggestions()` with a BOUNDED grouped concatenation — at most 2 artists, then at most 2 albums, then songs filling every remaining slot up to `SUGGEST_CAP` — and rewrite the ordering tests to pin the new order, the backfill rule, and the asymmetry rule.

Purpose: the user wants the typeahead grouped by kind. A plain unbounded concat was measured against live Deezer responses and rendered ZERO song rows for 5 of 6 queries (see context), so the user chose the bounded variant. Locked: order artists → albums → songs; caps 2/2/fill; no headings; no i18n keys (♪ / ◎ / ♫ glyphs already mark kind).
Output: two named constants + one pure-function change + one test rewrite; `pnpm check` and `pnpm test` green.
</objective>

<execution_context>
@/Users/laichan/.claude/plugins/cache/gsd-plugin/gsd/4.5.3/workflows/execute-plan.md
@/Users/laichan/.claude/plugins/cache/gsd-plugin/gsd/4.5.3/templates/summary.md
</execution_context>

<context>
@./CLAUDE.md
@src/lib/search/autocomplete-logic.ts
@src/lib/search/autocomplete-logic.test.ts

**Consumer confirmed — NO change to `src/routes/(app)/search/+page.svelte`.** It calls `deriveSuggestions(hits, kw)` (line ~125) and renders `{#each suggestions as s (s.key)}` (line ~666) in array order; the two `.sort()` calls on that page (lines ~257, ~326) are for RESULT rows, not the typeahead. The glyph per kind is already at line ~677. Do not touch the page.

**Input size is bounded.** The page fetches `deezerSearchTopN(kw, SUGGEST_CAP, sig)`, so `hits.length <= 8`; `artists`, `albums`, `songs` are each `<= 8`, and `artists` is derived from the SAME hit list as `songs`.

**Why the leading groups are bounded — measured evidence (quick-260919-pid).** Live Deezer responses through the app's own proxy, with the UNBOUNDED concat (`[...artists, ...albums, ...songs].slice(0, 8)`):

| query | distinct artists | distinct album\|artist | song rows unbounded concat would show |
|---|---|---|---|
| love | 8 | 8 | 0 |
| happy | 8 | 8 | 0 |
| hello | 8 | 8 | 0 |
| jay chou | 1 | 7 | 0 |
| 周杰倫 | 2 | 7 | 0 |
| tame impala | 1 | 5 | 2 |

Five of six render ZERO song rows — including artist-name queries — and songs are the only directly playable kind. Hence `ARTIST_ROWS = 2` / `ALBUM_ROWS = 2`: with 8 hits that guarantees ≥ 4 song rows whenever 4+ distinct songs exist. These numbers go into the code comment verbatim.

**Backfill / asymmetry rule (state in code + tests; the executor must NOT "fix" it):**
- Leading group short → songs expand. 0 artists + 1 album + 8 songs → `[album, song×7]` (length 8). Output always reaches `SUGGEST_CAP` when total suggestions ≥ 8.
- No songs → output is SHORT. 0 songs + 5 artists + 5 albums → `[artist×2, album×2]` (length 4). The 2/2 caps are ceilings on those two kinds, never a floor to backfill from. Asymmetric on purpose: artist/album rows are navigation, song rows are the product.

The implementation that satisfies both is exactly `[...artists.slice(0, ARTIST_ROWS), ...albums.slice(0, ALBUM_ROWS), ...songs].slice(0, SUGGEST_CAP)` — no cursors, no loops, no per-group minimums.

<interfaces>
From src/lib/search/autocomplete-logic.ts (existing, unchanged signatures):
```typescript
export const MIN_QUERY_LEN = 2;
export const SUGGEST_CAP = 8;
export interface Suggestion { kind: 'song' | 'artist' | 'album'; title: string; artist?: string; key: string; }
export function deriveSuggestions(hits: DeezerHit[], query: string): Suggestion[];
export function suggestionKeyword(s: Pick<Suggestion, 'title' | 'artist'>): string; // quick-260919-pbs — DO NOT TOUCH
```
New in this plan (Task 2), placed directly after `SUGGEST_CAP`:
```typescript
export const ARTIST_ROWS = 2;
export const ALBUM_ROWS = 2;
```
Test fixture already in the test file: `hit(title, artist, album = '', id?)` → `DeezerHit`. Note: an empty `title` skips the SONG only — the hit's artist and album are still collected — which is how the asymmetry test produces 0 songs with artists/albums present.
</interfaces>
</context>

<tasks>

<task type="auto" tdd="true">
  <name>Task 1: Rewrite the ordering tests to pin bounded artists → albums → songs, backfill, and asymmetry (RED)</name>
  <files>src/lib/search/autocomplete-logic.test.ts</files>
  <behavior>
    - Exact grouped order, small: `hit('Song A','Artist 1','Album 1')`, `hit('Song B','Artist 2','Album 2')`, query 'son' → `out.map(s => s.kind)` equals `['artist','artist','album','album','song','song']` and `out.map(s => s.title)` equals `['Artist 1','Artist 2','Album 1','Album 2','Song A','Song B']`.
    - Leading groups are bounded (the inverted cap-overflow case): 8 hits `hit(\`Song ${i}\`, \`Artist ${i}\`, \`Album ${i}\`)` → `out.length === SUGGEST_CAP`; `out.map(s => s.kind)` equals `['artist','artist','album','album','song','song','song','song']`; the artist titles are `['Artist 0','Artist 1']` and the album titles `['Album 0','Album 1']` (first-seen relevance order kept within the truncated groups); `ARTIST_ROWS === 2` and `ALBUM_ROWS === 2` (import both).
    - Backfill when a leading group is short: 8 hits `hit(\`Song ${i}\`, '', 'Same LP')` (empty artist → 0 artist rows; album dedupe key `same lp|` → 1 album row) → `out.length === SUGGEST_CAP`, `out[0].kind === 'album'`, `out.slice(1).every(s => s.kind === 'song')` (7 songs — songs expanded to fill).
    - Asymmetry — no songs, output stays short: 5 hits `hit('', \`Artist ${i}\`, \`Album ${i}\`)` (empty title skips the song only) → `out.map(s => s.kind)` equals `['artist','artist','album','album']` and `out.length === 4` — artists/albums do NOT grow past their caps to backfill. Comment states this is by design (quick-260919-pid).
    - Single hit: `hit('Only Song','Solo','Solo LP')` → kinds exactly `['artist','album','song']`.
  </behavior>
  <action>
    In `src/lib/search/autocomplete-logic.test.ts`:

    1. Extend the import to include `ARTIST_ROWS` and `ALBUM_ROWS` from `./autocomplete-logic` (RED: they do not exist yet, so the file fails to compile/run until Task 2 — that is the expected RED state for this task; do not stub them).

    2. DELETE the two interleave-era tests `'interleaves at least one artist suggestion near the top when artists are present'` (lines ~92-98) and `'surfaces album rows near the top when present, without exceeding the cap (gm4)'` (lines ~133-142). They would pass incidentally under the new design, but their names and comments describe the superseded interleave; the new exact-order tests below replace them with stricter assertions.

    3. ADJUST one gm4 test so its assertion stays about dedupe, not about the album cap: in `'emits distinct album suggestions carrying the album artist as the sub (gm4)'` (lines ~102-111) the fixture has 3 distinct albums (`Jay`, `Fantasy`, `H3M`) but `ALBUM_ROWS = 2` now truncates the third. Remove the third hit `hit('Song C', 'Eason Chan', 'H3M')` and change the expectation to `['Jay', 'Fantasy']`; keep the `toMatchObject({ kind: 'album', title: 'Jay', artist: 'Jay Chou' })` line. Add a one-line comment: kept to 2 distinct albums because ALBUM_ROWS caps the album group (quick-260919-pid); dedupe semantics under test are unchanged.

    4. ADD a `// --- bounded grouped order (quick-260919-pid) ---` block with the five cases from `<behavior>` as separate `it(...)` tests, asserting exact arrays with `toEqual` (not `some`) so a regression to interleaving or to unbounded groups fails loudly. In the bounded test, a one-line comment records why: an unbounded concat rendered zero song rows for 5 of 6 measured live queries. In the asymmetry test, a one-line comment records: caps are ceilings on artists/albums, never a floor — a short list is correct when there are no songs.

    5. LEAVE EVERY OTHER TEST UNTOUCHED — MIN_QUERY_LEN/empty-query, empty hits, song relevance order (filters by kind), empty-title skip, artist dedupe (exactly 2 artists — fits `ARTIST_ROWS`), empty-artist skip, song dedupe, cap+unique keys (30 hits → 2 artists + 6 songs = 8), the two other gm4 album tests, the nullish-tolerance test, the whole `debounce` block, and the whole `suggestionKeyword` block (quick-260919-pbs). Each was checked against the bounded design and passes unchanged after Task 2.

    Tabs, single quotes. Run the file: it MUST fail (RED) — at minimum the missing `ARTIST_ROWS`/`ALBUM_ROWS` exports and the five new order tests. Commit as `test(quick-260919-pid): pin bounded artists → albums → songs suggestion order`.
  </action>
  <verify>
    <automated>cd /Users/laichan/code/tung/openmusic && pnpm vitest run src/lib/search/autocomplete-logic.test.ts 2>&1 | tail -30</automated>
  </verify>
  <done>The two interleave tests are gone; the gm4 distinct-album test uses 2 albums; five bounded-order tests exist; the file fails (RED) against the current implementation; `grep -c 'quick-260919-pid' src/lib/search/autocomplete-logic.test.ts` ≥ 2; `grep -c 'ARTIST_ROWS' src/lib/search/autocomplete-logic.test.ts` ≥ 1.</done>
</task>

<task type="auto" tdd="true">
  <name>Task 2: Add ARTIST_ROWS / ALBUM_ROWS, replace the interleave with the bounded grouped concat, write the decision record (GREEN)</name>
  <files>src/lib/search/autocomplete-logic.ts</files>
  <behavior>
    - All Task 1 tests pass; the whole file is green; `pnpm check` clean; full `pnpm test` green.
  </behavior>
  <action>
    In `src/lib/search/autocomplete-logic.ts`:

    1. CONSTANTS — directly after `SUGGEST_CAP` (line ~25), add two exported module-level constants, house `SCREAMING_SNAKE_CASE`, each with a one-line doc comment saying why it is 2:
       - `ARTIST_ROWS = 2` — ceiling on artist rows; measured live queries produce up to 8 distinct artists in 8 hits, which would otherwise consume the whole cap (quick-260919-pid).
       - `ALBUM_ROWS = 2` — ceiling on album rows; same reason, 7-8 distinct album|artist pairs per 8 hits is the norm. 2 + 2 leaves ≥ 4 song slots.
       Optionally widen `SUGGEST_CAP`'s comment from "(song + artist)" to "(artist + album + song)"; not required.

    2. BODY — replace ONLY the interleave section (lines ~113-140: the comment, `out`, `SONGS_FIRST` / `ARTISTS_NEAR_TOP` / `ALBUMS_NEAR_TOP`, the `si`/`ai`/`li` cursors, the three head loops, and the round-robin `while`) with a single return: the concat of `artists.slice(0, ARTIST_ROWS)`, `albums.slice(0, ALBUM_ROWS)`, and all of `songs`, then `.slice(0, SUGGEST_CAP)`. That one expression gives the backfill (songs expand into unused leading slots) AND the asymmetry (a short result when there are no songs — the leading slices never grow). Everything above line 113 — the three build loops, their dedupe keys and skips, `MIN_QUERY_LEN`, the empty-hits guard, and the `// --- albums (gm4):` comment at line 98 — stays byte-identical. `suggestionKeyword`, `debounce`, and their comments stay untouched.

    3. DECISION RECORD — replace the three-line interleave comment at ~113-115 with a block (CLAUDE.md: decision refs are never deleted, new decisions are tagged) that records BOTH halves:
       a. `// --- bounded grouped concat (quick-260919-pid): artists (≤ ARTIST_ROWS), then albums (≤ ALBUM_ROWS), then songs fill to SUGGEST_CAP.` State the locked decision: grouped by kind, artists → albums → songs, no headings / no i18n (♪ ◎ ♫ glyphs mark kind).
       b. Why the two leading groups are bounded — paste the measured evidence table from `<context>` as comment lines (query / distinct artists / distinct album|artist / song rows an unbounded concat would show: love 8/8/0, happy 8/8/0, hello 8/8/0, jay chou 1/7/0, 周杰倫 2/7/0, tame impala 1/5/2). Say plainly: the page fetches only SUGGEST_CAP hits and `artists` derives from the same hits as `songs`, so an unbounded concat rendered ZERO song rows for 5 of 6 live queries; songs are the only directly playable kind; 2 + 2 guarantees ≥ 4 song slots.
       c. The backfill/asymmetry rule: a short leading group lets songs expand to fill the cap (no holes); no songs → short output, the caps are ceilings on artist/album rows, NEVER a floor to backfill from. Do not "fix" the short list.
       d. `SUPERSEDED (was ql0/gm4 interleave):` followed by the old rationale quoted verbatim — "a few songs first, then a couple artists, then a couple albums near the top, then round-robin the remainder across all three kinds so none is starved below the cap. Guarantees song/artist/album rows all surface near the top when present." — and one line noting that grouping revokes that guarantee for artists/albums beyond their caps, by choice.

    4. STALE DOC COMMENTS — in the `deriveSuggestions` JSDoc bullet (lines ~59-61) replace "interleaved a few songs first ... so none is starved below the cap" with "grouped (quick-260919-pid): up to ARTIST_ROWS artists, then up to ALBUM_ROWS albums, then songs filling the rest, capped at SUGGEST_CAP — see the in-body decision record"; in the module header (line ~7) change "(dedupe / cap / interleave)" to "(dedupe / cap / group)".

    Tabs, single quotes, no fenced code in comments. Run the test file (all green), then `pnpm check`, then the full `pnpm test`. Commit as `feat(quick-260919-pid): bounded grouped typeahead — 2 artists, 2 albums, songs fill`.
  </action>
  <verify>
    <automated>cd /Users/laichan/code/tung/openmusic && pnpm vitest run src/lib/search/autocomplete-logic.test.ts 2>&1 | tail -15 && pnpm check 2>&1 | tail -5 && pnpm test 2>&1 | tail -8</automated>
  </verify>
  <done>`grep -c 'SONGS_FIRST\|ARTISTS_NEAR_TOP\|ALBUMS_NEAR_TOP' src/lib/search/autocomplete-logic.ts` → 0; `grep -c 'export const ARTIST_ROWS = 2\|export const ALBUM_ROWS = 2' src/lib/search/autocomplete-logic.ts` → 2; the `// --- albums (gm4):` line still exists; `grep -c 'quick-260919-pid' src/lib/search/autocomplete-logic.ts` ≥ 3 (two constants + body, plus JSDoc); the superseded interleave sentence and the words `tame impala` (evidence table) are present in the file; `pnpm vitest run src/lib/search/autocomplete-logic.test.ts`, `pnpm check`, and `pnpm test` all pass; `git diff --stat` shows exactly two files changed and `src/routes/(app)/search/+page.svelte` is NOT among them.</done>
</task>

</tasks>

<threat_model>
## Trust Boundaries

| Boundary | Description |
|----------|-------------|
| Deezer proxy → client | Untrusted `DeezerHit` fields (title/artist/album) enter `deriveSuggestions`; already trimmed, nullish-tolerant, never thrown on. Unchanged by this plan. |

## STRIDE Threat Register

| Threat ID | Category | Component | Disposition | Mitigation Plan |
|-----------|----------|-----------|-------------|-----------------|
| T-pid-01 | Tampering | deriveSuggestions input | accept | Pure reorder/slice of already-sanitised arrays; no new parsing, no new render path (page renders `{s.title}` as text). |
| T-pid-02 | Denial of Service | deriveSuggestions | accept | Input bounded at `SUGGEST_CAP` hits by the caller; slice+concat is O(n) and simpler than the loop it replaces. |
| T-pid-SC | Tampering | npm installs | accept | No dependencies added or changed. |
</threat_model>

<verification>
- `pnpm vitest run src/lib/search/autocomplete-logic.test.ts` green (bounded order, backfill, asymmetry, all preserved behaviour tests).
- `pnpm check` clean; `pnpm test` green.
- `git diff --stat` touches exactly `src/lib/search/autocomplete-logic.ts` and `src/lib/search/autocomplete-logic.test.ts`.
- Decision record present: `quick-260919-pid` tag, measured evidence table, backfill/asymmetry rule, superseded interleave rationale kept, `gm4` album-block comment intact.
</verification>

<success_criteria>
- Typeahead dropdown lists up to 2 artist (♪) rows, then up to 2 album (◎) rows, then song (♫) rows filling to 8, each group in its existing relevance order.
- For the measured queries (love / happy / hello / jay chou / 周杰倫) the dropdown now shows 4 song rows instead of 0.
- Short leading groups are backfilled by songs; a no-song result is short rather than padded with extra artists/albums.
- No behaviour change to dedupe, empty-skips, `MIN_QUERY_LEN`, empty-hits, `SUGGEST_CAP`, `suggestionKeyword`, or the search page.
</success_criteria>

<output>
Create `.planning/quick/260919-pid-group-typeahead-suggestions-artists-albu/260919-pid-SUMMARY.md` when done
</output>
