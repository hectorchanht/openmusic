---
quick_id: 260809-cyk
slug: fix-pre-warm-over-fire-pre-warm-top-sear
date: 2026-08-09
type: execute
status: complete
relates_to: phase 31 (31-D-03, 31-D-05)
commits:
  - 4fc914f
key-files:
  modified:
    - src/routes/(app)/search/+page.svelte
decisions:
  - "The Deezer-boost promise chain's tail IS the terminal ranking event — nothing can reassign `results` after it, so it is the only place the settled top row is known"
  - "A `.catch(() => {})` between the boost handler and the pre-warm handler is the abort/reject fallback — no timer, no second call site"
metrics:
  duration: 6 min
  completed: 2026-08-09
---

# Quick Task 260809-cyk: Pre-warm the top search result once per settled search

Moved the 31-D-03 pre-warm off a reactive `$effect` on `results[0]` and onto the tail of the
Deezer-boost promise chain, collapsing 5 speculative `/api/resolve` calls per search down to 1.

## What Changed

`src/routes/(app)/search/+page.svelte` — one file, +50/-31.

**Deleted:** the `$effect` that read `results[0]` and its 17-line comment block (which sat stacked
above the pagination `IntersectionObserver` effect).

**Added:** a terminal handler chained onto the existing `dedupeBestWithDeezer(...)` call in `run()`:

```
void dedupeBestWithDeezer(...)
  .then((boosted) => { /* supersede guard; results = rankList(boosted, kw); persistSession() */ })
  .catch(() => {})          // boost defect -> pre-warm the pre-boost ranking instead of losing it
  .then(() => { /* supersede guard; prewarmTrack(results[0]) if uid !== lastPrewarmedUid */ });
```

`lastPrewarmedUid` was kept as-is (PLAIN field, not `$state`) and moved to sit directly above `run()`
with the rewritten comment block. Both existing reset sites (`resetResults()` and the top of `run()`)
were already correct and needed no change.

## Why This Shape

The plan asked for the terminal ranking event and left the mechanism open. Reading
`dedupe-deezer.ts` settled it: `dedupeBestWithDeezer` **never throws** — it returns the sync
`baseline` on Deezer miss, abort, or no key (`dedupe-deezer.ts:87`, plus explicit `signal?.aborted`
early-returns at :95, :113, :140). It also always resolves, because its only network leg
(`deezerSearchTopN`) rides `apiFetch`'s 25s timeout.

That makes chaining onto the same promise a complete fallback rather than a partial one: the
boost-aborts and boost-misses cases already land in the success handler and fall through to the
pre-warm; the `.catch` covers only a defect in the handler above it. No second call site at the
`:378` authoritative settle was needed — which is what would have produced 2 pre-warms instead of 1.

Gating on `!loading` was confirmed non-viable as the plan predicted: the boost is `void ...then(...)`
and lands after the `finally` clears `loading`.

## Deviations from Plan

None — plan executed as written. The plan's "if you find a cleaner seam while reading the file, take
it" latitude was used to skip introducing a new guard field: `lastPrewarmedUid` already existed, was
already reset at both required sites, and is now defence-in-depth behind a call site that structurally
fires once per `run()`.

## Comment Rewrite (required deliverable)

The old block's "Pitfall 5" paragraph documented the 4-8x firing as accepted and argued FOR the
reactive approach. The replacement:
- states the behaviour is now one pre-warm per settled search, fired imperatively
- records the measured before/after (5 `/api/resolve` per search -> 1) and why the reactive uid
  compare could not collapse the fires (the *identity* of `results[0]` changes across every partial)
- notes why `!loading` gating does not work
- **carries forward both still-load-bearing rules verbatim in substance:** (a) no timer/debounce
  composing a fresh local bound with the `apiFetch` governor — the documented root cause of the
  `api-fetch-flood-freeze` bug class, and the three composed-free bounds (`lastPrewarmedUid` ->
  `prewarmTrack`'s uid Set -> `apiFetch`'s in-flight GET dedupe); (b) gesture-only, nothing pre-warms
  on scroll.

Line references inside the new block (`:373`, `:378`) were corrected after the insertion shifted them.

## Verification — Observed Results

| Gate | Command | Observed |
|------|---------|----------|
| Tests | `pnpm test` | **95 test files passed, 1734 tests passed**, 0 failed (9.54s) |
| Typecheck | `pnpm check` | **4380 FILES 0 ERRORS 0 WARNINGS 0 FILES_WITH_PROBLEMS** |

Byte-identical check — `git diff --stat` over `src/lib/services/prewarm.ts`,
`src/lib/services/prewarm.test.ts`, `src/lib/components/TrackMenu.svelte`, `wrangler.jsonc`,
`package.json`, `pnpm-lock.yaml`: **empty output** (exit 0). None were touched.

No-new-timer check — every `setTimeout` / `debounce` / `IntersectionObserver` hit in the file is
pre-existing and unrelated to pre-warm: the skeleton dwell floor (:113), the typeahead debounce
(:130), the blur delay (:550), and the pagination observer (:523). The pre-warm path contains none.

`prewarmTrack` now has exactly **one** call site in the file (:411), inside the terminal `.then`,
inside the supersede guard.

Post-commit deletion check: no files deleted by 4fc914f.

## NOT Verified

**The actual call-count reduction has NOT been observed at runtime by this executor.** There is no
jsdom project in this repo (`vite.config.ts` defines a single node `server` project), so a page-level
promise chain is not unit-testable; per the plan, no test was invented and no test project was added.
The `5 -> 1` figure in the comment block is the plan's pre-existing measurement plus the structural
argument above, not a fresh measurement.

The proof obligation that remains: a live re-measure against `pnpm preview` (port 4173) with a
`window.fetch` wrap, confirming **exactly one `/api/resolve` per settled search**. The orchestrator
runs this.

## Live Re-Measure — DONE by the orchestrator (obligation above discharged)

`pnpm build` + `pnpm preview` (wrangler 4.98.0 / Miniflare, port 4173), mobile viewport 375×812,
`window.fetch` wrapped and `window.__net` reset at the query boundary. Two independent queries, each
allowed ~16s to fully settle (past the Deezer boost):

| Query | `/api/resolve` calls | Target pre-warmed | Final top row |
|---|---|---|---|
| `coldplay yellow` | **1** | `a=Coldplay&t=Yellow-《少年时代》电影插曲` | `Yellow-《少年时代》电影插曲 \| Coldplay` |
| `oasis wonderwall` | **1** | `a=Oasis&t=Wonderwall (Remastered) (Remaster)` | `Wonderwall (Remastered) (Remaster) \| Oasis` |

Both fired **exactly once**, and in both cases the pre-warmed track is the **final settled top row**,
not an intermediate ranking — which is the part that matters. A count of 1 alone could have meant
"fires once, on the wrong (pre-boost) row"; matching the final row proves the call moved to the
terminal ranking event rather than merely being deduped.

**Before → after: 5 and 2 calls per search → 1 and 1.** Back inside D-05's accepted "1-2 extra calls".

Total fetches per search (101 and 141) are unchanged in character — that is search-page fan-out,
a separate concern from this phase and untouched here.

## Working-Tree Note

`src/lib/components/NowPlaying.svelte` and `src/lib/components/Nowbar.svelte` were dirty in the
working tree during this run but were **not** modified by this task (a concurrent session in the same
folder — the tool hook reported another dev server running here). They were deliberately left
unstaged; commit 4fc914f contains `src/routes/(app)/search/+page.svelte` only (`1 file changed`).

## Self-Check: PASSED

- `src/routes/(app)/search/+page.svelte` — FOUND, modified
- Commit `4fc914f` — FOUND in `git log`
- `src/lib/services/prewarm.ts` — FOUND, unmodified (byte-identical)
- `src/lib/components/TrackMenu.svelte` — FOUND, unmodified (byte-identical)
