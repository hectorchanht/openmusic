---
phase: 26-minimal-api-click-to-play-redesign
plan: 08
subsystem: services/variants + services/dedupe + components/VersionPicker + i18n
tags: [version-picker, variants, dedupe, version-tag, lazy-fetch, gap-closure, i18n, 15-locale-parity, vitest, tdd, gap-4, gap-5]

# Dependency graph
requires:
  - src/lib/services/catalog.ts searchAll(keyword,page,prefs,signal) — the memoized all-source fan-out fetchVariants issues once
  - src/lib/services/dedupe.ts groupVariants/sameSongKey + private better()/key() — reused for identity + best-quality collapse
  - src/lib/components/VersionPicker.svelte (Phase 26-04) — the sheet this plan adds loading + distinct-label rendering to
  - src/lib/i18n/*.ts — the 15-locale dictionaries + i18n.test.ts parity guard
provides:
  - src/lib/services/variants.ts fetchVariants(track, signal?) — single on-demand cross-source variant fetch (never-throw, AbortSignal-honoring), the contract the 26-10 menu/up-next mount consumes
  - src/lib/services/dedupe.ts collapseVariants(tracks) — intra-source de-dup (source|album|tag bucket, best quality kept, cross-source preserved)
  - src/lib/services/dedupe.ts variantTag(title) + type VersionTag — title-parens version-tag parser (EN + CN → enum, raw-text fallback, null on none)
  - src/lib/components/VersionPicker.svelte — optional loading prop + spinner; renders collapseVariants with a version-tag badge + album subtitle distinguisher
  - i18n keys versions.loading / menu.versions / versions.tag.{live,acoustic,demo,cover,remix,instrumental,remaster} in all 15 locales
affects: [version-picker-everywhere, version-picker-distinct-rows, lazy-variant-discovery, api-call-cost]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Lazy single fan-out: fetchVariants fires EXACTLY ONE searchAll(query, 1, {}, signal) only when called (never a background/per-source loop), reuses searchAll's D-04 TTL so a repeat picker-open is free — the UAT API-cost constraint (T-26-08-01)"
    - "Identity reuse (no re-implementation): fetchVariants selects the matching group via groupVariants + sameSongKey; collapseVariants reuses the private better() for the best-quality pick — dedupe.ts stays the single source of truth for song identity + quality rank"
    - "Render-time collapse (no search-page edit): collapseVariants is applied INSIDE VersionPicker via $derived, so every picker mount (the shipped search page AND the 26-10 menu/up-next) is fixed with zero change to groupVariants' uid→group contract (T-26-08-03)"
    - "Bucket key source|normAlbum|tag: because `source` is part of the key, cross-source variants ALWAYS occupy different buckets (never collapsed = a real choice); intra-source truly-indistinguishable rows (same album, same/no tag) collapse to one"
    - "Literal-key i18n mapping (strict-safe): tagLabel maps the VersionTag enum to a LITERAL t('versions.tag.*') key via a switch (NO dynamic t('versions.tag.'+key), NO `as any`) — falls back to the raw title fragment for an unrecognized marker"
    - "Loading affordance mirrors TrackMenu's .row-spinner idiom incl. the prefers-reduced-motion + :root[data-reduce-motion] rule"

key-files:
  created:
    - src/lib/services/variants.ts
    - src/lib/services/variants.test.ts
    - .planning/phases/26-minimal-api-click-to-play-redesign/26-08-SUMMARY.md
  modified:
    - src/lib/services/dedupe.ts
    - src/lib/services/dedupe.test.ts
    - src/lib/components/VersionPicker.svelte
    - src/lib/i18n/en.ts
    - src/lib/i18n/zh-Hant.ts
    - src/lib/i18n/zh-Hans.ts
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
    - .planning/phases/26-minimal-api-click-to-play-redesign/deferred-items.md

key-decisions:
  - "fetchVariants builds its query from `${track.artist} ${track.title}` and selects the matching group by scanning groupVariants(...).values() for a member satisfying sameSongKey(member, track) — reuses the EXACT normalized identity (one source of truth), never re-implements it. Blank query / abort / throw / empty / no-match all → [] (never-throw); AbortSignal re-checked after the await for supersedence"
  - "collapseVariants lives beside groupVariants but is a SEPARATE export — groupVariants/dedupeBest/key/better/qualityRank are untouched, so the search page's uid→group lookup (buildVariantGroups) keeps working exactly as before (T-26-08-03). The Gap-5 fix is additive"
  - "The bucket tag component is `(tag?.key ?? tag?.text ?? '').toLowerCase()` — an unrecognized marker still buckets by its normalized raw text so two identical unknown markers collapse, while distinct tags (live vs studio) stay apart. Lowercasing the fallback text (a small correctness hardening over the plan's literal spec) makes mixed-case unknown markers collapse deterministically"
  - "VersionPicker restructured .ver-title into a flex line (.ver-name ellipsizes, .ver-tag pill never shrinks) so the version badge stays visible next to a long title; the album is the primary subtitle distinguisher when present, falling back to the existing qualityLabel"
  - "All 9 new keys added contiguously after versions.open in each locale (key order is irrelevant to the sorted-parity guard); menu.versions reuses each locale's versions.title phrasing per the plan"
  - "menu.versions is shipped now (label the 26-10 long-press menu will use) even though the menu mount lands in 26-10 — keeps this plan owning ALL new i18n keys so 26-10 needs no locale edit"

requirements-completed: [VERSIONS-01]

# Metrics
duration: 9min
completed: 2026-07-11
---

# Phase 26 Plan 08: Version-Picker Lazy Fetch + Distinct Rows (Gaps 4 & 5) Summary

**Builds the LAZY/OPT-IN foundation for Gap 4 (version selector everywhere) and closes Gap 5 (the picker showed ~10 visually-identical JOOX rows). Gap 4: a new node-testable `fetchVariants(track, signal?)` fires EXACTLY ONE all-source `searchAll` on demand (never a background fan-out — the UAT's API-cost constraint), groups by song identity, and returns the cross-source variant list; VersionPicker gains an optional `loading` prop + spinner so a non-search caller can open the sheet while that single fetch runs. Gap 5: a pure `collapseVariants` de-dups truly-indistinguishable rows WITHIN a source (bucketed by source|album|version-tag, best quality kept) while NEVER collapsing cross-source variants, and `variantTag` parses a distinguishing label from the title parens ((Live)/(Demo)/(现场)/…) normalized to a translated enum — applied at RENDER time inside VersionPicker so every picker mount (search page included) is fixed with NO search-page edit and NO change to `groupVariants`. New keys (versions.loading, menu.versions, versions.tag.*) added to all 15 locales at parity. Full suite green except the pre-existing deferred `searchHistory` SSR-guard failure.**

## Performance

- **Duration:** ~9 min
- **Completed:** 2026-07-11
- **Tasks:** 3 of 3 (Tasks 1 & 2 TDD RED→GREEN, no REFACTOR needed; Task 3 auto)
- **Files:** 3 created (variants.ts, variants.test.ts, this SUMMARY), 18 modified

## Accomplishments

- **Task 1 (Gap 4 — lazy on-demand variant fetch), TDD `f0c1a2c`→`63567e2`:**
  - Created `src/lib/services/variants.ts` exporting `async fetchVariants(track, signal?): Promise<Track[]>`.
  - Query = `${track.artist} ${track.title}`.trim() (blank → `[]` without any fetch); issues ONE `searchAll(query, 1, {}, signal)` (prefs `{}` = all enabled, the deliberate single fan-out); `groupVariants(result.interleaved)` then returns the group with a member satisfying `sameSongKey(member, track)`.
  - Never-throw (try/catch → `[]`); AbortSignal re-checked after the await (`signal.aborted → []`). Pure `.ts` — reuses `searchAll` + `groupVariants` + `sameSongKey`, no re-implemented identity, no `*.svelte.ts` import.
  - **RED→GREEN:** 7 tests — exactly-one-searchAll + prefs `{}`, same-song cross-source group returned, single-source returns one, blank/throw/empty/no-match/abort all `[]`. All failed RED (module absent); green after the impl.

- **Task 2 (Gap 5 — intra-source collapse + version-tag parser), TDD `098768b`→`2a66352`:**
  - Added to `dedupe.ts` (without touching groupVariants/dedupeBest/key/better/qualityRank): `type VersionTag`, `variantTag(title)`, `collapseVariants(tracks)`, plus a private `normAlbum` and `TAG_PATTERNS` (EN + CN, ordered first-match).
  - `variantTag`: extracts the first bracket marker with the SAME family `key()` uses (`/[（(【[](.*?)[)）]】]/`), maps to the enum (live/acoustic/demo/cover/remix/instrumental/remaster) case-insensitively, returns `{key,text}` (raw text fallback for an unknown marker) or `null` when no marker / empty marker.
  - `collapseVariants`: buckets by `${source}|${normAlbum(album)}|${(tag.key ?? tag.text ?? '').toLowerCase()}`, keeps the best-quality member via the private `better()`, first-appearance order. Cross-source variants never share a bucket.
  - **RED→GREEN:** 9 new tests (10-same-source→1 best-quality; Live vs studio → 2; two albums → 2; cross-source → 3; order preserved; variantTag EN + CN + unknown + plain/blank). All failed RED; green after the impl. The 4 existing groupVariants tests stayed green (contract untouched).

- **Task 3 (Gap 4/5 — VersionPicker loading + distinct rows + i18n), `d37f333`:**
  - VersionPicker: added optional `loading?: boolean` (default false) → a `.row-spinner` + `versions.loading` affordance (reduced-motion safe) in place of the list. `const shown = $derived(collapseVariants(versions))` replaces the raw `versions` iteration + empty check.
  - Per-row: `{@const vt = variantTag(v.title)}` → a `.ver-tag` badge via `tagLabel()` (literal-key `switch`, raw-text fallback); `.ver-sub` shows `dnArtist · dnTitle(album)` when the album is non-blank, else `dnArtist · quality`. Title row is now a flex line so the badge stays visible while the name ellipsizes. Props `versions/open/onclose/onpick` and the back-gesture `$effect` unchanged.
  - i18n: added `versions.loading`, `menu.versions`, and the 7 `versions.tag.*` keys to en.ts (canonical) + all 14 other locales with real translations, double quotes, contiguous after `versions.open`.

## Verification

- `pnpm test -- src/lib/services/variants.test.ts` — 7 passed.
- `pnpm test -- src/lib/services/dedupe.test.ts` — 13 passed (4 existing groupVariants + 9 new).
- `pnpm test -- src/lib/i18n/i18n.test.ts` — 12 passed (15-locale key-set parity + no-blank).
- Full `pnpm test` — 1192 passed, 1 failed (ONLY the pre-existing deferred `searchHistory.svelte.test.ts` SSR-guard failure; see Out of Scope). No file deletions in any task commit.
- `pnpm check` — 1 error + 1 warning, BOTH pre-existing/out-of-scope and NOT from this plan's files (see Out of Scope). `variants.ts` / `dedupe.ts` / `VersionPicker.svelte` / the 15 i18n files add ZERO new typecheck errors — no dynamic `t()` key, no `as any`.

## TDD Gate Compliance

- **Task 1:** `test(26-08)` commit `f0c1a2c` (RED — 7 tests fail: module not found) precedes `feat(26-08)` commit `63567e2` (GREEN — all 7 pass). Fail-fast honored: RED failed at import (module absent), no accidental pre-existing pass.
- **Task 2:** `test(26-08)` commit `098768b` (RED — 9 new tests fail: `collapseVariants`/`variantTag` undefined; the 4 existing groupVariants tests already green) precedes `feat(26-08)` commit `2a66352` (GREEN — 13 pass).
- **Task 3** (non-TDD `type="auto"`): a single `feat` commit `d37f333`; verified by the i18n parity test + `pnpm check`.
- No REFACTOR phase needed — both implementations were clean at GREEN.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 2 - Correctness] Lowercased the unknown-marker bucket component in collapseVariants**
- **Found during:** Task 2, defining the bucket key.
- **Issue:** The plan's literal spec `${tag?.key ?? tag?.text ?? ''}` would bucket two identical-but-differently-cased unknown markers (e.g. "(Radio Edit)" vs "(radio edit)") separately, leaving two near-identical rows uncollapsed.
- **Fix:** `.toLowerCase()` the whole tag component so unknown markers collapse deterministically; the normalized enum keys are already lowercase so this is a no-op for recognized tags. Single-line, in-spirit hardening.
- **Files modified:** src/lib/services/dedupe.ts
- **Commit:** 2a66352

### Out of Scope (logged, NOT fixed)

**Pre-existing `pnpm check` error: `album/[name]/+page.svelte:590` `swipeLike`**
- "Cannot find name 'swipeLike'." — introduced by the CONCURRENT UI session, committed to `main` at `dce0af0` ("song-row swipe-left = play next (was like)") which renamed the handler but left a stale `swipeLike(track)` in `use:swipeAction`. Not in this plan's file set; this plan's four source files add zero new errors. Logged to `deferred-items.md`; owned by the concurrent album-swipe session.

**Pre-existing test failure: `searchHistory.svelte.test.ts` SSR guard (Node native `localStorage`)**
- Node 25 exposes `globalThis.localStorage`, so `typeof … === 'undefined'` no longer holds. Documented in prior Phase-26 SUMMARYs + `deferred-items.md`. Untouched per the scope boundary.

**Pre-existing `pnpm check` warning: unused `.warn` CSS selector in `search/+page.svelte`**
- Present before this plan; unrelated. Untouched.

## Threat Model Compliance

- **T-26-08-01** (DoS — reintroducing a background fan-out) — mitigated: `fetchVariants` fires EXACTLY ONE `searchAll`, only when called (the 26-10 mount will gate it behind a picker-open tap); AbortSignal-cancelable; reuses the D-04 TTL memoization. The `variants.test.ts` `expect(spy).toHaveBeenCalledTimes(1)` assertion locks this in.
- **T-26-08-02** (Injection — variant rows / tag badge / album) — mitigated: the row renders the SAME `Track` text fields the shipped picker already renders (source label, `dnTitle`/`dnArtist`, album, quality); the tag is a NORMALIZED enum mapped to a static i18n string (or the raw title fragment) — no new external render surface.
- **T-26-08-03** (contract drift breaking the search page) — mitigated: `groupVariants` is NOT modified; the collapse happens at RENDER via a separate pure `collapseVariants`; the 4 existing groupVariants tests stay green.
- **T-26-08-SC** (package installs) — n/a: no new dependency added this plan.

## Known Stubs

None. `fetchVariants`, `collapseVariants`/`variantTag`, and the VersionPicker loading + distinct-label rendering are fully wired with tests. The `loading` prop defaults to false and is consumed by a real spinner branch — the caller that DRIVES it (opening the picker in the long-press menu / up-next and passing `loading` while `fetchVariants` runs) is deliberately deferred to plan 26-10; this plan owns only the independent contract + rendering, as scoped in the objective.

## Threat Flags

None. No new network endpoint, auth path, file access, or trust-boundary schema change beyond the already-modeled on-demand all-source search (T-26-08-01, in the plan's threat register). `fetchVariants` reuses the existing `searchAll` proxy seam.

## Notes for Next Plan

- **26-10 (mount — TrackMenu long-press + NowPlaying up-next):** import `fetchVariants` + open `VersionPicker` with `loading` bound to the in-flight state; use the `menu.versions` label for the long-press action. Gate the fetch behind the picker-open tap (keep the default row tap single-source/fast). Show the control only where >1 variant is (or can be) available.
- **Gap 6 (picked-variant resolve fallback/skip):** still open — routing a version-pick resolve failure (JOOX identity mismatch / null) into the gap-1 resolve-fallback + skip path with a toast is a player-store change, not this pure-service/UI plan. The distinct-rows + intra-source collapse here REDUCES the number of fragile JOOX n-indices offered (fewer identical rows) but does not itself fix the resolve path.

## Self-Check: PASSED

- All created files present on disk: `variants.ts`, `variants.test.ts` (+ this SUMMARY); all modified files present: `dedupe.ts`, `dedupe.test.ts`, `VersionPicker.svelte`, 15 i18n dictionaries, `deferred-items.md`.
- All 5 task commits present in git history: `f0c1a2c` (T1 RED), `63567e2` (T1 GREEN), `098768b` (T2 RED), `2a66352` (T2 GREEN), `d37f333` (T3 feat).
- key_links verified by grep: `VersionPicker.svelte` references `collapseVariants`/`variantTag` (4 hits); `variants.ts` references `searchAll`/`groupVariants` (10 hits).
