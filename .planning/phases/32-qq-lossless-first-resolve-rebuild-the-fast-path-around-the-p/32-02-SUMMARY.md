---
phase: 32-qq-lossless-first-resolve-rebuild-the-fast-path-around-the-p
plan: 02
subsystem: dedupe-ranking / fetch-seam
tags: [dedupe, source-rank, latency, api-base, native-build, url-construction]
requires: []
provides:
  - "SOURCE_RANK with qq at the top — the deduped search survivor carries song_mid"
  - "apiUrl returns an already-absolute http(s) url untouched on BOTH build targets"
affects:
  - "src/lib/sources/qq.ts (plan 32-05: the D-12 direct tang call depends on the apiUrl guard)"
  - "every surface that renders a deduped list — qq title/album metadata now wins a disagreement"
tech-stack:
  added: []
  patterns:
    - "root-cause guard placement: one check in the shared seam instead of per-call-site branching"
    - "fixture-inversion as a recorded decision change (rename + comment), never a weakened assertion"
key-files:
  created: []
  modified:
    - src/lib/services/dedupe.ts
    - src/lib/services/dedupe.test.ts
    - src/lib/services/api-base.ts
    - src/lib/services/api-base.test.ts
    - src/lib/stores/player.svelte.test.ts
    - src/lib/services/discovery.test.ts
decisions:
  - "32-D-08: qq and netease SWAPPED in SOURCE_RANK (3/4, not a bump to 5) so the range and every other rank's justified meaning stay unchanged"
  - "32-D-08: three player/discovery fixtures whose premise was 'netease wins the tie' were inverted as a decision change — the premise itself changed, so the fixtures moved rather than the assertions loosening"
  - "32-D-13: the absolute-url guard lives in apiUrl, not at the qq call site, so every present and future absolute caller is covered and all stay inside the apiFetch governor"
metrics:
  duration: ~7 min
  completed: 2026-08-31
requirements: [D-08, D-13]
---

# Phase 32 Plan 02: Two one-line levers — qq-first dedupe + the absolute-url guard Summary

`qq` now wins an equal-quality dedupe tie, so the surviving search row already carries `song_mid`
and most first plays need zero lookup (32-D-10b's latency lever); and `apiUrl` returns an
already-absolute url untouched, which unbreaks the direct-upstream path on the native build.

## What Was Built

**`SOURCE_RANK` swap in `src/lib/services/dedupe.ts`** (32-D-08). `{ netease: 4, qq: 3 }` →
`{ netease: 3, qq: 4 }` — a swap, not a bump to 5, so the range and every other source's
relative meaning stated in the 20-line justification block above it stay exactly as written. The
block gained a `32-D-08` paragraph in the file's existing prose style, recording: that netease
winning this tie is WHY a mid-less stub was the common case (at search time every stub is
`quality: null` → `qualityRank` 0, so this rank is the SOLE tie-break and decided every
cross-source row); that a qq survivor carries `song_mid` in the search body so most first plays
are lossless with no lookup at all; the accepted side effect that qq's title/album metadata wins
a disagreement; that identity is unaffected because it stays uid-based (`makeUid`) and this rank
never decides identity; and a cross-ref to the roadmap's pending "netease upstream health-gate"
item that already suspected the rank-4.

**The first winner-source assertions this repo has ever had**, in `dedupe.test.ts` — three cases
using the file's existing `mk()` factory: qq wins in BOTH input orders (so the win is provably
rank-driven, not first-appearance-driven), the survivor's `songMid`/`songid` are the qq row's
(32-D-10b's premise pinned as a test rather than left as prose), and an explicit
`preferred: 'netease'` still outranks the static rank (existing contract unchanged).

**Absolute-url guard in `src/lib/services/api-base.ts`** (32-D-13). One line at the top of
`apiUrl` — `if (/^https?:\/\//i.test(path)) return path;` — with `BASE` still read lazily INSIDE
the function, because the module's own doc-block records that `vi.stubEnv` depends on that. The
posture doc-block gained a matching third-branch bullet in the same voice, naming the native
failure mode concretely: `'https://openmusic.lol' + 'https://tang…'` parses its authority as
`openmusic.lolhttps:` with `//tang…` as the port, which is not a valid URL, so `fetch` throws a
hard `TypeError`. The guard is in `apiUrl` rather than at the 32-D-12 qq call site so every
present and future absolute caller is covered by one check.

**The governor is byte-unchanged.** `git diff --stat src/lib/services/api-base.ts` is
`16 insertions(+), 0 deletions(-)`, and the diff's three hunks are all pure additions
(`@@ -12,0 +13,10 @@`, `@@ -24,0 +35 @@`, `@@ -26,0 +38,5 @@`) — nothing in the
`api-fetch-flood-freeze` machinery was reordered, restructured or removed. All four protections
verified still present by grep: in-flight GET dedupe (`inflight` Map, api-base.ts:186),
`MAX_CONCURRENT_REQUESTS = 8` (:71), `REQUEST_TIMEOUT_MS = 25_000` (:73), and the circuit breaker
(`CIRCUIT_FAILURE_THRESHOLD = 30` :99 / `CIRCUIT_COOLDOWN_MS = 10_000` :102). They all still apply
to the absolute-url path, which is the entire point of 32-D-13: the dedupe key is the RESOLVED url
(`inflight.get(url)` at :268, where `url = apiUrl(path)`), so a direct tang call is deduped,
queued, timed out and breaker-counted exactly like an `/api/*` one. Going direct loses no
protection. This is also stated in the new doc-block bullet so a later reader does not have to
re-derive it.

## Verification Evidence

Every command below was actually run and its real output observed.

| Gate | Command | Observed |
|---|---|---|
| RED (task 1) | `pnpm vitest --run src/lib/services/dedupe.test.ts` | **2 failed / 14 passed** — `expected undefined to be '003aAYrm3GE0Ac'` (the netease row was surviving, so it carried no mid) |
| GREEN (task 1) | `pnpm vitest --run dedupe.test.ts player.svelte.test.ts` | **245 passed** |
| RED (task 2) | `pnpm vitest --run src/lib/services/api-base.test.ts` | **1 failed / 12 passed** — received `'https://base.examplehttps://tang.api.s01s.cn/…'`, byte-for-byte the corruption 32-RESEARCH § Q4 predicted |
| GREEN (task 2) | same | **13 passed** |
| Full suite | `pnpm test` | **95 files / 1751 tests passed, 0 failed** |
| Typecheck | `pnpm check` | **4380 files, 0 ERRORS 0 WARNINGS 0 FILES_WITH_PROBLEMS** |

1751 = the 32-01 baseline of 1747 plus exactly the 4 new cases (3 dedupe + 1 api-base). No test
was deleted, skipped or disabled to reach green.

Acceptance greps, all observed:
- `grep -n "qq: 4" src/lib/services/dedupe.ts` → line 37, the `SOURCE_RANK` literal
- `grep -c "netease: 3" src/lib/services/dedupe.ts` → `1`
- `grep -c "32-D-08" src/lib/services/dedupe.ts` → `1`
- the guard's regex sits inside `apiUrl` BEFORE the `BASE` read (api-base.ts:38, `BASE` at :39)
- existing `apiUrl` cases (unset base → path as-is; set base → prefixed relative path) pass
  **unmodified** — neither was edited

Scope guards, both verified by git rather than asserted:
- **D-16 honoured** — `git diff --name-only 888a143~1 HEAD | grep -c "stores/player.svelte.ts$"`
  → `0`. The store itself was never opened for edit; only its test file.
- **No pre-existing dirty file entered any commit.** `.gitignore`, `CLAUDE.md`,
  `.planning/HANDOFF.json`, `docs/agents/` and the phase-31 `.gitkeep` were all still dirty/
  untracked after the last commit, exactly as they were before the first. Every `git add` named
  explicit paths; no `git add .`/`-A`/`commit -a` was used.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] A third test file's fixture premise inverted — `discovery.test.ts`**
- **Found during:** Task 2, on the full-suite gate (the plan predicted fallout only in
  `player.svelte.test.ts`, so this one was unforecast)
- **Issue:** `resolveStub — returns the FIRST track (best cross-source hit) when several are
  returned` failed: `expected 'qq:second' to be 'netease:first'`. Its two fixtures are the SAME
  song (周杰伦 / 稻香) from netease and qq, so `dedupeBest` collapses them to ONE candidate and
  `SOURCE_RANK` alone picks the survivor — `scoreMatch` never gets a choice to make.
- **Fix:** The case's two readings, "the first row in the interleaved list" and "the rank winner",
  only ever coincided because netease was both; the case could not tell them apart. 32-D-08
  separates them, and the contract `resolveStub` actually offers for same-song rows is "the dedupe
  winner", not "index 0". So the assertion was retargeted to the qq row — still an exact `uid`
  comparison, not a loosened check — and the case renamed to
  `returns the SOURCE_RANK winner when several same-song rows are returned (32-D-08)` so the name
  states what is really pinned. Recorded with a `32-D-08` comment explaining the conflation.
- **Files modified:** `src/lib/services/discovery.test.ts`
- **Commit:** `2f533ab`

### Deliberate decision changes (not deviations — the plan directed these)

Two `player.svelte.test.ts` cases both still **passed** after the swap, but *vacuously* — their
fixtures assumed netease wins the tie, and with that premise inverted they no longer exercised
what they were written to prove. Per the plan these were updated as decision changes, by moving
the fixture to the source that now loses, never by touching an assertion:

1. `regenerate keeps the exact current seed anchored when dedupeBest prefers another source` —
   was `seed=qq, variant=netease`. Post-swap the seed WAS the dedupe winner, so the case proved
   nothing about anchoring. Sources swapped to `seed=netease, variant=qq`, restoring the seed to
   the losing side. Assertions unchanged.
2. `list-tap pattern … tapped lower-ranked variant survives dedupe drop` — was `tapped=qq`,
   with an inline comment claiming netease "outranks qq → dedupe winner slot", now false. Which
   source is "lower-ranked" inverted, so the tapped fixture moved to netease and the stale
   comment was corrected. The regression it guards (a tapped row orphaned by dedupe, killing
   `next()`) is unchanged and now actually exercised again.

A third case, `matches current by same-song key when the list entry is a different SOURCE variant
(Bug 2)`, was left alone deliberately: it has `current=netease` with a qq row in the list, so the
swap moves it from "current is the natural dedupe winner" to "current is the LOSER" — i.e. the
swap made it strictly the harder path, and its comment carried no rank claim to go stale.

## Follow-up Observations (not fixed — out of scope)

- **`src/lib/services/itunes-cover.ts:170-171`** carries a comment justifying a RAW `fetch` on the
  grounds that "apiFetch prepends the /api base → would corrupt it". The 32-D-13 guard makes that
  justification obsolete — an absolute url now passes through `apiUrl` untouched, so that call
  *could* be routed through the governor and gain dedupe/cap/timeout/breaker coverage. Explicitly
  left untouched (outside this plan's `files_modified`); worth a one-line quick task, and note the
  comment is now a stale decision record that will mislead the next reader.
- **`catalog.ts:323-326`** — 32-CONTEXT D-10b already flags this: the mid cache is read
  unconditionally at up to 400ms, which post-32-D-08 is pure waste on the now-common path where the
  deduped row already carries the mid. Called out here only because 32-D-08 is what makes it waste;
  it belongs to a later plan in this phase.
- **No new threat surface.** No endpoint, auth path, file access or schema changed. The plan's
  threat register is unchanged: `T-32-03` (qq metadata winning ties) stays `accept` and is recorded
  in the new `dedupe.ts` comment; `T-32-04` (malformed absolute url reaching fetch on native) is
  now `mitigate`d by the guard and pinned by the `stubEnv` test.

## Known Stubs

None. Both changes are complete behavior, not placeholders — no hardcoded empty value, no
TODO/FIXME, and no component left unwired was introduced by this plan.

## Self-Check: PASSED

- All six modified files verified present on disk.
- All three commits verified present in `git log --all`: `888a143`, `2f533ab`, `cb240c1`.
- `git show --stat` on all three confirms they touch ONLY the six intended `src/**` files — no
  `.planning/`, `CLAUDE.md`, `.gitignore` or `docs/` path appears in any of them.
