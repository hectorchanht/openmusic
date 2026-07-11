---
phase: 26-minimal-api-click-to-play-redesign
plan: 04
subsystem: services/components/i18n
tags: [version-picker, dedupe, variant-grouping, search, overlay, back-gesture, i18n, svelte5, vitest, tdd, no-new-api-calls]

# Dependency graph
requires:
  - src/lib/services/dedupe.ts key()/dedupeBest — the single private title+artist identity normalization reused for grouping
  - src/lib/stores/overlays.svelte.ts open/dismiss — the History-API back-to-close overlay stack (single-dismiss-path invariant)
  - src/lib/stores/player.svelte.ts play/setListQueue — plays the chosen source variant
  - src/lib/sources/registry.ts SOURCES — registry-driven human source labels
  - src/lib/stores/names.svelte.ts dnTitle/dnArtist — reactive display-name resolvers for the variant rows
provides:
  - src/lib/services/dedupe.ts groupVariants(tracks) — pure Map<identityKey, Track[]> grouping of pre-dedupe cross-source variants; reuses dedupe's private key(); node-testable
  - src/lib/components/VersionPicker.svelte — mobile-first sheet listing per-source variants of one song; back-gesture-correct; onpick plays the exact variant
  - src/routes/(app)/search/+page.svelte version trigger + retained variantGroups — a leading per-row control (shown only when >1 source variant) opening the picker
affects: [search-row-ux, version-selection, click-to-play-source-choice]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "groupVariants is the inverse view of dedupeBest: same private key() identity (one source of truth), first-appearance order preserved, blank/untitled stubs keyed by uid so they never merge"
    - "variantGroups is a uid → group lookup (every variant uid maps to its full group) so a displayed deduped winner resolves its cross-source siblings WITHOUT the private key — set at every results-derivation point inside the existing race/abort guards in run()/loadMore()"
    - "VersionPicker mirrors TrackMenu's sheet idiom EXACTLY (scrim + .menu + transition:fly + use:dragClose + use:focusTrap + the overlays open/dismiss \$effect with untrack, dep on `open` only) so Back-gesture close converges on the single dismiss path"
    - "Version trigger is a SIBLING ≥44px tap target in a .row-line flex (mirroring CompactRow's .opt), placed BEFORE the swipeable play row — never nested inside the play button (no button-in-button)"
    - "aria-label resolved via a component-level \$derived(t('versions.open')) OUTSIDE the {#each results as t} block, because the loop variable `t` shadows the i18n t()"
    - "Zero new API calls: the picker consumes the already-fetched interleaved search variants dedupeBest discards (T-26-04-01 mitigated)"

key-files:
  created:
    - src/lib/services/dedupe.test.ts
    - src/lib/components/VersionPicker.svelte
  modified:
    - src/lib/services/dedupe.ts
    - src/routes/(app)/search/+page.svelte
    - src/lib/i18n/en.ts
    - src/lib/i18n/zh-Hans.ts
    - src/lib/i18n/zh-Hant.ts
    - src/lib/i18n/ar.ts
    - src/lib/i18n/de.ts
    - src/lib/i18n/es.ts
    - src/lib/i18n/fr.ts
    - src/lib/i18n/hi.ts
    - src/lib/i18n/id.ts
    - src/lib/i18n/it.ts
    - src/lib/i18n/pt.ts
    - src/lib/i18n/ru.ts
    - src/lib/i18n/th.ts
    - src/lib/i18n/tr.ts
    - src/lib/i18n/vi.ts

key-decisions:
  - "groupVariants reuses the EXISTING private key() normalization instead of re-implementing identity — dedupe stays the single source of truth for what counts as the same song, so the picker groups exactly what dedupeBest collapses."
  - "The search page keys variant groups by uid (every variant uid → its group) rather than by the private key(), so a displayed deduped winner resolves its group without exporting/duplicating key() — the winner is a member of its own group (proven by a dedupe.test.ts assertion)."
  - "variantGroups is set at every point `results` is derived (onPartial, final, loadMore, and cleared on a fresh query) inside the same race/abort guards, so the trigger visibility always matches the currently-displayed rows and a superseded query never leaks stale groups."
  - "The trigger renders ONLY when a song has >1 source variant (a single-source song has nothing to pick), so uncluttered rows stay uncluttered — it complements the kuwo-first fast default click rather than replacing it."
  - "VersionPicker takes plain props (versions/open/onclose/onpick) and owns no queue logic; the search page's onpick does setListQueue(results,'search') + play(variant,{fresh:true}) so the default row tap (deduped winner) is completely unchanged."
  - "On a restored in-session search (searchSession has no interleaved set), variantGroups is empty so no triggers show until a re-search — an accepted graceful degradation (no new API call to reconstruct variants from the deduped-only stored results)."

requirements-completed: [VERSIONS-01]

# Metrics
duration: 9min
completed: 2026-07-11
---

# Phase 26 Plan 04: Version Picker — Choose Which Source Plays Summary

**Gives the user explicit control over WHICH source version of a song plays. A leading version control (rendered only on multi-source rows) opens a mobile-first sheet listing every same-name+artist variant the search already returned across sources; tapping one plays that exact source's Track. Built on a new pure `groupVariants` helper that retains the pre-dedupe variants `dedupeBest` discards — so it costs ZERO new API calls (the data is already in the search result set) and complements the kuwo-first fast default click. The picker reuses TrackMenu's back-gesture-correct sheet idiom and ships parity-complete i18n across all 16 locales. Green typecheck + dedupe/i18n suites; human-verified on a mobile viewport (approved).**

## Performance

- **Duration:** ~9 min (implementation), plus a human-verify checkpoint
- **Started:** 2026-07-11T19:20Z (local +08)
- **Completed:** 2026-07-11
- **Tasks:** 4 of 4 (Task 1 TDD RED→GREEN; Tasks 2–3 autonomous; Task 4 human-verify — approved)
- **Files:** 2 created, 18 modified

## Accomplishments

- **Task 1 (VERSIONS-01 — `groupVariants` helper), TDD:**
  - **RED** (`52941e1`): 4 new failing tests — groups netease+qq+kuwo variants of one song under one key, keeps genuinely different songs separate, proves the dedupeBest winner is a member of its own group, and never merges distinct blank/untitled stubs.
  - **GREEN** (`c97f6fa`): implemented `groupVariants(tracks): Map<string, Track[]>` in `dedupe.ts` reusing the existing private `key()` normalization, preserving first-appearance order within each group and mirroring dedupeBest's blank-key guard (untitled stubs key by uid). Pure / never-throw / node-testable. `dedupeBest`/`sameSongKey` untouched.
- **Task 2 (VersionPicker sheet + i18n), autonomous** (`b32ca3b`):
  - Created `src/lib/components/VersionPicker.svelte` mirroring TrackMenu's sheet idiom EXACTLY — scrim button + `.menu` with `transition:fly`, `use:dragClose`, `use:focusTrap`, and the single `$effect` overlays open/dismiss (keyed `versionpicker`, `untrack`ed, dep on `open` only). Props `versions/open/onclose/onpick`; one `use:tapBounce` row per variant showing the registry-driven source label + quality (graceful `versions.unknownQuality` fallback) + `names.dnTitle`/`dnArtist`; tapping calls `onpick(variant)` then closes; empty list guards with `versions.empty`.
  - Added 4 keys (`versions.title/empty/unknownQuality/open`) to `en.ts` (canonical) AND all 15 other locales using the DOUBLE-QUOTE convention with real translations.
- **Task 3 (wire the control + retain variants), autonomous** (`4136aa0`):
  - Added `variantGroups` `$state` (uid → cross-source group) built via `buildVariantGroups(interleaved)` at every `results`-derivation point in `run()` (onPartial + final) and `loadMore()`, inside the existing race/abort guards; cleared on a fresh query.
  - Added a leading version trigger (`Layers` icon, `use:tapBounce`, `aria-label={verOpenLabel}`) as a sibling ≥44px tap target in a new `.row-line` flex BEFORE the swipeable play row, rendered only when the song has >1 variant. Restructured the row into `.row-line > .ver + .swipe-wrap` (swipe mechanics fully intact).
  - Mounted ONE `VersionPicker` driven by `pickerVersions`/`pickerOpen`; `onpick` runs `setListQueue(results,'search')` + `play(variant,{fresh:true})`. Default row tap unchanged.
- **Task 4 (human-verify on a mobile viewport):** presented running; user typed **"approved"**.

## Verification

- `pnpm check` — 0 errors, 0 warnings (4316 files).
- `pnpm test -- src/lib/services/dedupe.test.ts` — 4 passed.
- `pnpm test -- src/lib/i18n/i18n.test.ts` — 12 passed (identical key set across all 16 locales; new keys present in every file).
- `pnpm test -- src/lib/i18n/i18n.test.ts src/lib/services/dedupe.test.ts` — 16 passed.
- Grep verification: `search/+page.svelte` imports `groupVariants` + `VersionPicker`, builds `variantGroups` state (9 references), and mounts exactly ONE `<VersionPicker`.
- Full `pnpm test` — 1142 passed, 1 failed (the pre-existing deferred `searchHistory.svelte.test.ts` SSR-guard failure only; see Deviations).
- Human-verify (Task 4): control placement, variant list, per-source playback, and Back-gesture close — approved.

## TDD Gate Compliance

- Task 1 RED gate: `52941e1` `test(26-04): add failing tests for groupVariants …` — 4 tests failing with `groupVariants is not a function` before any implementation.
- Task 1 GREEN gate: `c97f6fa` `feat(26-04): export groupVariants …` — all 4 tests green.
- Tasks 2–3 are `type="auto"` (not TDD) — no RED/GREEN gate expected; verified via i18n parity + typecheck + grep.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] i18n verification target `dedupe.test.ts` did not exist yet**
- **Found during:** Task 1 read-first.
- **Issue:** The plan's `read_first` referenced `src/lib/services/dedupe.test.ts` ("harness + mk() factory to extend"), but no such file existed (`dedupe.ts` had no co-located test).
- **Fix:** Created `dedupe.test.ts` from scratch, mirroring the `mk()` Track-factory pattern used in the sibling `score-match.test.ts`/`catalog.test.ts` (makeUid + Partial<Track> override). This is the RED artifact for Task 1's TDD flow.
- **Files:** src/lib/services/dedupe.test.ts (created)
- **Commit:** 52941e1

**2. [Rule 3 - Blocking] Look up a row's variant group by uid, not by the private key()**
- **Found during:** Task 3 wiring.
- **Issue:** The plan says the trigger "looks up that row's variant group by the row track's `groupVariants` key", but `key()` is private to `dedupe.ts` and Task 1 only exports `groupVariants` (not a key helper).
- **Fix:** Built a `variantGroups: Record<uid, Track[]>` where every variant's uid maps to its full group. A displayed deduped winner's uid is a member of its own group, so `variantGroups[row.uid]` yields the source list without needing the private key — and no key() re-implementation/export was required (identity stays single-source in dedupe.ts).
- **Files:** src/routes/(app)/search/+page.svelte
- **Commit:** 4136aa0

**3. [Rule 3 - Blocking] i18n aria-label resolved outside the `{#each results as t}` shadow**
- **Found during:** Task 3 markup.
- **Issue:** The row loop binds the item to `t`, which shadows the imported i18n `t()`; `t('versions.open')` inside the loop would call the Track, not translate.
- **Fix:** Added a component-level `const verOpenLabel = $derived(t('versions.open'))` and bound the trigger's `aria-label` to it (re-resolves reactively on appLang change).
- **Files:** src/routes/(app)/search/+page.svelte
- **Commit:** 4136aa0

### Out of Scope (logged, NOT fixed)

**Pre-existing test failure: `searchHistory.svelte.test.ts` SSR guard (Node native `localStorage`)**
- Fails in isolation with zero Plan-26-04 code involved — the local runtime (Node 25.x) exposes `globalThis.localStorage`, so the assertion `typeof globalThis.localStorage === 'undefined'` no longer holds. Already documented in `deferred-items.md` (from Plan 26-05). Unrelated to this plan (dedupe / component / i18n / search markup) — not fixed per the scope boundary.

## Known Stubs

None. `groupVariants` is a fully wired pure helper; `VersionPicker` is a live component reached from every multi-source search row; the trigger plays the exact selected variant through the real player.

## Threat Flags

None. No new trust boundary or network/edge surface (T-26-04-01 mitigated): the picker consumes the already-fetched interleaved search variant set — ZERO new API calls to populate the modal. No new dependency (T-26-04-02): `Layers` is a per-icon `@lucide/svelte` import already used app-wide.

## Notes for Next Plan

- `groupVariants` is now the canonical retained-variant view; any future surface wanting per-source alternates (e.g. a now-playing "switch source") can reuse it rather than re-deriving identity.
- Variant groups are NOT persisted into `searchSession`, so a restored in-session search shows no triggers until re-search. If that gap matters later, store the interleaved set (or the per-uid groups) in the session — but weigh the memory cost against the accepted degradation.
- The version picker is the sanctioned opt-in "give me a different source" escape hatch; keep the default row tap single-source/fast (kuwo-first) — do not fan out on the default click.

## Self-Check: PASSED

- Created files present on disk: `src/lib/services/dedupe.test.ts`, `src/lib/components/VersionPicker.svelte`.
- Modified files present: `src/lib/services/dedupe.ts`, `src/routes/(app)/search/+page.svelte`, all 16 `src/lib/i18n/*.ts`.
- All 4 task commits present in git history: 52941e1 (test/RED), c97f6fa (feat/GREEN Task 1), b32ca3b (feat Task 2), 4136aa0 (feat Task 3).
