---
phase: 26-minimal-api-click-to-play-redesign
plan: 10
subsystem: components/NowPlaying + components/TrackMenu (UI mount of the 26-07/26-08 contracts)
tags: [up-next, seeded-covers, version-picker, lazy-fetch, fetchVariants, gap-closure, gap-3, gap-4, no-fan-out, single-dismiss-path, human-verified]

# Dependency graph
requires:
  - src/lib/services/similar.ts nameStub image seed (26-07) — the Last.fm https cover the Up-Next tile now paints from
  - src/lib/services/variants.ts fetchVariants(track, signal?) (26-08) — the single on-demand cross-source variant fetch the picker triggers open lazily
  - src/lib/components/VersionPicker.svelte (26-08) — the sheet (loading prop + collapseVariants distinct rows + self-registered 'versionpicker' overlay) both new mounts consume
  - src/lib/i18n menu.versions / versions.open / versions.loading (26-08) — labels used by the new trigger + menu row
provides:
  - src/lib/components/NowPlaying.svelte — Up-Next LIST tile paints from track.cover (seeded) with NO per-tile lazyCover chain; a per-row .ver version trigger opening ONE lazily-fed VersionPicker
  - src/lib/components/TrackMenu.svelte — a "Play from source" (menu.versions) action opening the same lazily-fed VersionPicker
affects: [up-next-tile-cover-cost, version-picker-everywhere, lazy-variant-discovery, api-call-cost]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Zero-fan-out list surface: the Up-Next tile drops use:lazyCover entirely and reads the SEEDED track.cover (26-07 Last.fm image) → 0 per-tile Deezer→iTunes→CN calls on render (T-26-10-01). The resolvedCovers[uid] read is KEPT because the prev/next carousel cells still feed the map — a zero-cost benefit for a row that was recently a neighbor, but the list resolves nothing itself"
    - "Lazy variant discovery gated behind a tap: fetchVariants fires ONLY inside openVersionPicker/openVersions (a trigger onclick), NEVER on list render or menu open — the picker opens INSTANTLY with a spinner (loading=true) while the single searchAll runs behind the sheet (T-26-10-02)"
    - "Plain (non-reactive) supersedence guard reused for the picker fetch: `versionGen` (a plain number, bumped per open) + a per-open AbortController — a re-open bumps the token and aborts the prior fetch, and the post-await guard `gen !== versionGen || signal.aborted` drops a stale result. Mirrors player.svelte.ts playGen; NOT $state (the UI never reads the counter reactively)"
    - "One overlay registration per sheet (single dismiss path): both mounts rely on VersionPicker's OWN self-registered 'versionpicker' overlay entry (the exact pattern the search page uses) — no host-side trackmenu-versions/nowplaying-versions overlay $effect, which would double-push a history state per open and over-pop the Back gesture"
    - "Version trigger is a SIBLING, never nested: the .ver button is a flex sibling of the swipeable/tappable row button (search .row-line/.ver idiom) so use:swipeRemove/longpress/grip/swipeAction stay intact (no button-in-button)"

key-files:
  created:
    - .planning/phases/26-minimal-api-click-to-play-redesign/26-10-SUMMARY.md
  modified:
    - src/lib/components/NowPlaying.svelte
    - src/lib/components/TrackMenu.svelte

key-decisions:
  - "Gap 3: removed use:lazyCover from ONLY the Up-Next LIST tile (`.q-art` inside the `.q-row` each-block). The prev/next carousel cover-cells KEEP their bounded 2-tile lazyCover (unchanged). The tile background-image expression is byte-for-byte the same (`resolvedCovers[uid] ?? track.cover`, gradient fallback) — only the resolving action is dropped. Accepted trade-off (documented inline + in the UAT): an Up-Next tile no longer self-heals a dead cover via the chain; only the now-playing track gets the optional HQ upgrade"
  - "Gap 4: the version trigger is shown on EVERY Up-Next row and the Play-from-source row exists for every track (including the current one — you may want to switch the playing source). Variant count is unknown until the on-demand fetch, so the picker's loading + empty ('No other versions') states cover a ≤1-variant song rather than pre-gating the control (unlike the search row, which already holds the pre-dedupe group and gates on >1)"
  - "DEVIATION (Rule 1): did NOT add a host-side `trackmenu-versions` / nowplaying overlay $effect despite the plan's literal 'register its own overlays entry' instruction. VersionPicker already self-registers 'versionpicker' (VersionPicker.svelte:93-98), the same registration the shipped search-page mount relies on. Adding a second entry would push TWO history states for one visible sheet → the Back gesture pops only one → over-pop (the exact single-dismiss invariant the plan names and Task 3 step 5 verifies). Relying on the single self-registered entry is the correct implementation"
  - "onpick plays the chosen variant via player.play(variant, { fresh: true }) — fresh because the user explicitly re-picked the source. In TrackMenu, onpick also calls close() to dismiss the menu after the pick; VersionPicker's pick() then calls onclose() (→ closeVersions) so both sheets converge on their own single dismiss. In NowPlaying, onpick just plays (no queue install — the up-next surface is not a list-queue seed like the search page)"
  - "Icon: reused the existing @lucide/svelte `Layers` (the app-wide version-picker glyph — search row + now the up-next row + the menu row all use it) rather than `Disc`, for a consistent 'sources/variants' affordance. No new dependency (T-26-10-SC accept honored)"

requirements-completed: [COVER-01, VERSIONS-01]

# Metrics
duration: 9min
completed: 2026-07-11
---

# Phase 26 Plan 10: Up-Next Seeded Covers + Version Picker Everywhere (Gaps 3 & 4 UI) Summary

**Wires the 26-07 (seeded stub covers) and 26-08 (fetchVariants + VersionPicker loading/distinct rows) service contracts into the two remaining play surfaces. Gap 3: the Up-Next LIST tile drops `use:lazyCover` and paints directly from the seeded `track.cover` (the Last.fm image 26-07 seeds onto name stubs) with a gradient on a true miss — killing the per-tile Deezer→iTunes→CN flood observed on up-next render (T-26-10-01); the prev/next carousel cells keep their bounded 2-tile lazyCover, and only the now-playing track keeps the optional HQ upgrade. Gap 4: a version selector is now reachable from BOTH the Up-Next rows (a per-row `Layers` `.ver` trigger, a sibling of the swipeable row button) AND the long-press TrackMenu (a "Play from source" action), each opening ONE VersionPicker that fires `fetchVariants` LAZILY on open — a single cross-source search gated behind the tap, AbortController + generation-guarded, never a background/per-tile fan-out (T-26-10-02); picking a variant plays that exact source fresh. Both mounts rely on VersionPicker's own self-registered overlay for the single Back-dismiss path (no double-registration). Human-verified on a mobile viewport (approved). Full suite green except the pre-existing deferred `searchHistory` SSR-guard failure.**

## Performance

- **Duration:** ~9 min (+ human-verify checkpoint wait)
- **Completed:** 2026-07-11
- **Tasks:** 3 of 3 (Tasks 1 & 2 `type=auto`; Task 3 `checkpoint:human-verify` — approved)
- **Files:** 1 created (this SUMMARY), 2 modified

## Accomplishments

- **Task 1 (Gap 3 tile cover + Gap 4 up-next trigger), `610225c`:**
  - **Gap 3:** removed `use:lazyCover={{ track, onResolved: onCoverResolved }}` from the Up-Next LIST tile's `<span class="q-art">` (inside the `.q-row` each-block). The tile now paints from `resolvedCovers[track.uid] ?? track.cover` with `fallbackCover(track)` on a true miss — the background-image expression is unchanged; only the resolving action is dropped, so the list fires 0 per-tile cover chains. The prev/next carousel `cover-cell` lazyCover (2 cells) is left untouched.
  - **Gap 4:** added a per-row `.ver` version trigger (`<Layers size={18} />`) as a SIBLING placed BEFORE the swipeable `.q-row` button (never nested — swipeRemove/longpress/grip preserved), shown on every row. Wired to `openVersionPicker(track)` which bumps `versionGen`, aborts any prior `AbortController`, opens the picker immediately with `pickerLoading=true`, awaits `fetchVariants(track, signal)`, then (under a `gen !== versionGen || signal.aborted` guard) sets `pickerVersions` + `pickerLoading=false`. Mounted exactly ONE `<VersionPicker loading={pickerLoading} …>`; `onpick` → `player.play(v, { fresh: true })`; `onclose`/`closeVersionPicker` flips open false + aborts. Added `Layers` to the lucide import, `fetchVariants` + `VersionPicker` imports, and a `.ver` CSS rule (44px tap target) mirroring the search page. `verOpenLabel = $derived(t('versions.open'))` resolved outside the each-loop.

- **Task 2 (Gap 4 — TrackMenu Play-from-source), `7423fbf`:**
  - Added a `.mi` action row `{t('menu.versions')}` with a `Layers` icon, placed after the Remix row (playback-actions cluster), available for every track including the current one. `onclick={openVersions}` fires the SINGLE lazy `fetchVariants` fan-out — only on this tap, never in the menu-open `$effect` (verified: `fetchVariants` appears only in `openVersions`, and the only `overlays.open("trackmenu-menu"…)` is the untouched menu effect). Same generation + AbortController guard as Task 1 (`versionGen`/`versionAc`).
  - Mounted one `<VersionPicker loading={versionsLoading} …>` OUTSIDE the `{#if open && track}` block (like the playlist-picker/detail sub-sheets) so it survives the menu closing on a pick. `onpick` plays the chosen variant fresh then calls `close()` to dismiss the menu; `onclose`/`closeVersions` flips open false + aborts. Added `Layers`, `fetchVariants`, and `VersionPicker` imports.

- **Task 3 (human-verify checkpoint), approved:**
  - Started the Vite dev server (bound `http://localhost:5174/` — port 4321's strictPort was not in effect on the current config; 5173 was in use) so the human verified without running any CLI. User approved: no up-next cover flood, the version selector works from both the Up-Next rows and the TrackMenu, picking plays the exact source, and the Back gesture closes the picker via the single dismiss path.

## Verification

- `pnpm check` — the ONLY error is the pre-existing out-of-scope `album/[name]/+page.svelte:590 swipeLike` (introduced by the concurrent album-swipe session, owned by it) + the pre-existing `.warn` unused-CSS warning. `NowPlaying.svelte` and `TrackMenu.svelte` add ZERO new typecheck errors (no `as any`, no dynamic `t()` key).
- `pnpm test -- src/lib/services/variants.test.ts src/lib/services/similar.test.ts` — 23 passed (Task 1 verify).
- `pnpm test -- src/lib/i18n/i18n.test.ts` — 12 passed (Task 2 verify — 15-locale parity intact).
- Full `pnpm test` — 1201 passed, 1 failed (ONLY the pre-existing deferred `searchHistory.svelte.test.ts` SSR-guard failure; see Out of Scope). No file deletions in either task commit.
- grep confirms the key-links: NowPlaying mounts exactly 1 VersionPicker, has 0 `use:lazyCover` on the up-next `.q-art`, and keeps 2 carousel `cover-cell` lazyCover cells; TrackMenu mounts 1 VersionPicker and calls `fetchVariants` only from `openVersions`.

## Deviations from Plan

### Design deviations (documented, in-spirit)

**1. [Rule 1 - Bug prevention] No host-side overlay registration for the versions sheet**
- **Found during:** Task 2 (and applied consistently in Task 1).
- **Issue:** The plan's Task 2 action said to "register its own overlays entry … keyed e.g. 'trackmenu-versions' … the SINGLE dismiss path invariant." But `VersionPicker.svelte` ALREADY self-registers a `'versionpicker'` overlay entry (lines 93-98) — the exact registration the shipped search-page mount relies on. A host-side second entry would push TWO history states for ONE visible sheet, so the Back gesture would pop only one → an orphan overlay entry → over-pop (the precise invariant the plan names and Task 3 step 5 verifies).
- **Fix:** Rely on VersionPicker's own self-registered `'versionpicker'` entry (search-page pattern) in BOTH NowPlaying and TrackMenu — one `open()` matched by one `dismiss()`. Verified against the overlays store contract (`dismiss` pops exactly one history state; `closeTop` no-ops a stale dismiss).
- **Files modified:** src/lib/components/NowPlaying.svelte, src/lib/components/TrackMenu.svelte
- **Commits:** 610225c, 7423fbf

**2. [in-spirit] Kept the `resolvedCovers[uid] ??` read on the Up-Next tile**
- The plan allowed reading `track.cover` directly OR keeping `resolvedCovers[track.uid] ?? track.cover` "only if it still helps." Kept it: the map is still populated by the prev/next carousel neighbors, so a row that was recently a neighbor keeps its resolved cover at zero cost — while the list resolves nothing itself (lazyCover dropped). The primary requirement (no per-tile chain) is met.

### Out of Scope (logged, NOT fixed)

**Pre-existing `pnpm check` error: `album/[name]/+page.svelte:590` `swipeLike`**
- "Cannot find name 'swipeLike'." — introduced by the CONCURRENT UI session (committed to main at `dce0af0`), documented in 26-08-SUMMARY + `deferred-items.md`. Not in this plan's file set; explicitly out of scope per the executor brief.

**Pre-existing test failure: `searchHistory.svelte.test.ts` SSR guard (Node native `localStorage`)**
- Node exposes `globalThis.localStorage`, so `typeof … === 'undefined'` no longer holds. Documented in prior Phase-26 SUMMARYs. Untouched.

**Pre-existing `pnpm check` warning: unused `.warn` CSS selector in `search/+page.svelte`** — pre-existing; untouched.

## Threat Model Compliance

- **T-26-10-01** (DoS — per-tile cover chain on the Up-Next list) — mitigated: `use:lazyCover` removed from the up-next LIST tile; it paints from the seeded https cover → 0 per-tile Deezer→iTunes→CN calls on render. Human-verified via the Network panel (no `/api/deezer/search` flood on up-next render).
- **T-26-10-02** (DoS — version discovery reintroducing a fan-out) — mitigated: `fetchVariants` is called ONLY from the trigger onclick handlers (`openVersionPicker` / `openVersions`), never on list render or menu open; AbortController + generation-guarded; reuses searchAll's D-04 TTL. Verified by grep (single call site each) + human-verify (one search fired on open).
- **T-26-10-03** (Injection — seeded cover / variant rows) — mitigated: the cover is the https-guarded seeded value (26-07); the variant rows reuse the shipped VersionPicker render surface (26-08) — no new injection surface added.
- **T-26-10-SC** (package installs) — n/a / accept honored: no new dependency; `Layers` is an existing `@lucide/svelte` icon.

## Known Stubs

None. Both mounts consume real 26-07/26-08 contracts: the tile paints from a real seeded https cover (gradient is the honest no-data state, not a placeholder), and the picker lists real cross-source variants fetched on demand (empty "No other versions" is the honest ≤1-variant state). The `loading` prop drives the shipped spinner branch.

## Threat Flags

None. No new network endpoint, auth path, file access, or trust-boundary schema change beyond the already-modeled on-demand all-source search (T-26-10-02, in the plan's threat register). Both mounts reuse the existing `fetchVariants` → `searchAll` proxy seam.

## Notes for Next Plan

- **Gap 6 (picked-variant resolve fallback/skip) is STILL OPEN** and is the last Phase-26 UAT gap. This plan surfaces the version picker in two more places (up-next + menu) — which means more opportunities to pick a fragile JOOX n-indexed variant whose resolve throws an identity mismatch. Routing a version-pick resolve failure (identity mismatch / null) into the gap-1 resolve-fallback + skip path with a "couldn't play this version" toast is a `player.svelte.ts` change (not this UI plan's scope). Until Gap 6 lands, a picked JOOX variant that can't be identity-verified may still surface a stuck nowbar error — the distinct-rows collapse (26-08) reduces but does not eliminate the fragile indices offered.

## Self-Check: PASSED

- Both modified files present on disk: `src/lib/components/NowPlaying.svelte`, `src/lib/components/TrackMenu.svelte`; `26-10-SUMMARY.md` created.
- Both task commits present in git history: `610225c` (Task 1), `7423fbf` (Task 2).
- key-links verified by grep: NowPlaying — 1 `<VersionPicker>` mount, 0 `use:lazyCover` on the up-next `.q-art`, 2 carousel `cover-cell` lazyCover cells (preserved); TrackMenu — 1 `<VersionPicker>` mount, `fetchVariants` called only from `openVersions`.
