---
phase: 25-zh-hant-offline-conversion-fallback-cascade
plan: 01
subsystem: services
tags: [i18n, translation, zh-hant, offline, tongwen, lazy-import, svelte5, vitest]

# Dependency graph
requires:
  - phase: (existing)
    provides: src/lib/i18n/detect.ts detectLang (kana/hangul-first LangTag classifier)
provides:
  - src/lib/services/zh-convert.ts — s2tConvertLines (lazy, memoized, never-throw Simplified→Traditional batch convert) + isChineseLine (D-04 offline-eligibility predicate)
  - tongwen-core@4.1.1 + tongwen-dict@1.0.2 pinned as the app's FIRST third-party runtime deps (legitimacy human-approved, T-25a-SC)
affects: [translation-choke-point, zh-hant-target, bundle-size]

# Tech tracking
tech-stack:
  added:
    - "tongwen-core@4.1.1 (MIT, pure JS s2t/t2s engine — imported walker-free via esm submodules)"
    - "tongwen-dict@1.0.2 (MIT, s2t/t2s dict JSON — only s2t char+phrase min dicts loaded)"
  patterns:
    - "Lazy dict via dynamic import() memoized in a module-scoped promise; a rejected build is NOT cached (nulled) so a transient chunk-load can retry (D-03)"
    - "Never-throw service boundary: any import/build/convert fault degrades to identity (input lines unchanged), never throws into the caller"
    - "Deep-import a package's walker-free esm SUBMODULES (tongwen-core/esm/{converter,dictionary}) to skip a DOM-only (NodeFilter) code path that breaks the node Vitest project and bloats the browser chunk"

key-files:
  created:
    - src/lib/services/zh-convert.ts
    - src/lib/services/zh-convert.test.ts
  modified:
    - package.json
    - pnpm-lock.yaml

key-decisions:
  - "D-01: TongWenTang s2t char + phrase dicts (phrase-level, disambiguates 头发→頭髮); t2s left empty (out of scope) to keep the lazy chunk near ~72 KB"
  - "D-03: converter runs client-side; tongwen pulled ONLY via dynamic import() — zero static/top-level tongwen import, stays out of the initial bundle"
  - "D-04: isChineseLine delegates to detectLang (kana→ja / hangul→ko classify BEFORE Han), so kana-bearing Japanese lines are NOT offline-converted — pinned by isChineseLine('さくら')===false"
  - "Import tongwen-core/esm/{converter,dictionary} submodules, NOT the top-level index (which `export * from ./walker` referencing the DOM global NodeFilter — undefined in the node test project)"

patterns-established:
  - "s2tConvertLines(lines): positionally-aligned batch (out.length===in.length), blank slots preserved, already-Traditional is a no-op"
  - "Memoize a ready-to-use (line)=>string closure (not the raw tongwen Converter) so LangType stays captured and callers never touch tongwen types"

requirements-completed: [D-01, D-03, D-04]

# Metrics
duration: 9min
completed: 2026-07-11
---

# Phase 25 Plan 01: Lazy TongWenTang s2t Converter + CJK/kana Predicate Summary

**Ships the offline Simplified→Traditional foundation the translate choke point (Plan 03) will wire in: a lazy, memoized, never-throw `s2tConvertLines` (dynamic-import of the s2t char+phrase dicts only) plus the D-04 `isChineseLine` predicate that rides the kana/hangul-first `detectLang` so Japanese-kanji lines are never mis-converted — with `tongwen-core@4.1.1` + `tongwen-dict@1.0.2` pinned as the repo's first third-party runtime deps behind a human-approved legitimacy gate.**

## Performance

- **Duration:** ~9 min
- **Started:** 2026-07-11T08:38:55Z
- **Completed:** 2026-07-11T08:48Z
- **Tasks:** 3 of 3 (Task 1 legitimacy checkpoint pre-approved by human; Tasks 2–3 autonomous)
- **Files:** 2 created (zh-convert.ts, zh-convert.test.ts) + 2 modified (package.json, pnpm-lock.yaml)

## Accomplishments
- **Task 1 (legitimacy gate — pre-approved):** `tongwen-core@4.1.1` + `tongwen-dict@1.0.2` (both MIT, org `tongwentang`) were human-approved in the orchestrator conversation with exact pins; treated as satisfied, no re-prompt (T-25a-SC mitigated).
- **Task 2 (install + converter, D-01/D-03/D-04):** `pnpm add tongwen-core@4.1.1 tongwen-dict@1.0.2` resolved to the EXACT approved versions (no `^`). Built `src/lib/services/zh-convert.ts`:
  - `s2tConvertLines(lines)` — lazily dynamic-imports ONLY the s2t char + phrase min dicts, builds a `createConverterMap({ s2t:[char,phrase], t2s:[] })`, memoizes the built `(line)=>phrase(s2t,line)` closure, converts each line (blank slots preserved, `out.length===in.length`), and on ANY fault returns the input unchanged (never-throw).
  - `isChineseLine(text)` — delegates to `detectLang`, true only for `'zh-Hant'|'zh-Hans'`; reuses the shared Unicode ranges (no redefinition).
- **Task 3 (tests, TDD-style):** `src/lib/services/zh-convert.test.ts` — 12 node tests (no jsdom): basic char (`简体中文→簡體中文`), phrase disambiguation (`头发→頭髮`), blank-slot alignment (`['','中国']→['','中國']`), Traditional no-op (`台灣`), empty-array, mixed batch; plus `isChineseLine` for zh-Hans/zh-Hant true and kana/hangul/Latin/empty false — including the explicit `isChineseLine('さくら')===false` JA guard (T-25a-02).
- **Bundle posture (D-03):** `grep -c "from 'tongwen"` (top-level) = 0; the tongwen import appears only inside `import(...)` — dict stays out of the initial chunk.

## Task Commits

1. **Task 1: legitimacy checkpoint** — no code (human-approved gate; T-25a-SC). No commit.
2. **Task 2: install + lazy s2t converter + isChineseLine** — `449901b` (feat)
3. **Task 3: walker-free deep-import fix + s2t/predicate unit tests** — `2d278ac` (fix)

## Files Created/Modified
- `src/lib/services/zh-convert.ts` (created) — lazy memoized never-throw s2t converter + `isChineseLine` predicate.
- `src/lib/services/zh-convert.test.ts` (created) — 12 node tests covering every `<behavior>` case incl. the JA-kanji guard.
- `package.json` (modified) — `tongwen-core: "4.1.1"`, `tongwen-dict: "1.0.2"` (exact) in `dependencies`.
- `pnpm-lock.yaml` (modified) — lock entries for the two pinned deps.

## Decisions Made
- Loaded the `.min.json` s2t dicts (smaller shipped bytes) and left `t2s: []` — Traditional→Simplified is Deferred and its tables are never pulled, keeping the lazy chunk near the measured ~72 KB.
- Memoized a ready-to-use `(line)=>string` closure rather than the raw tongwen `Converter`, so `LangType` stays captured inside the module and no tongwen type leaks to callers.
- A rejected build nulls the memo (not cached) so a transient dynamic-import failure can retry rather than permanently disabling offline conversion.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] Import tongwen `esm` submodules, not the top-level index (walker/NodeFilter)**
- **Found during:** Task 3 (first test run — all four conversion tests returned the INPUT unchanged, i.e. the never-throw fallback fired).
- **Issue:** The plan's `<interfaces>` sketch imported `createConverterMap`/`LangType` from `tongwen-core` (the package index). `tongwen-core/esm/index.js` does `export * from './walker'`, and the walker's module-eval references `NodeFilter` — a DOM global that is **undefined in the node Vitest project (no jsdom)**. So `import('tongwen-core')` THREW at load, the never-throw boundary swallowed it, and conversion silently degraded to identity (`头发`→`头发`). A probe pinned the exact `ReferenceError: NodeFilter is not defined` in `cjs/walker/constant/constant.js`.
- **Fix:** Import the walker-free submodules `tongwen-core/esm/converter` (→ `createConverterMap`) and `tongwen-core/esm/dictionary` (→ `LangType`) instead of the index. Verified (grep) that neither submodule references `walker`/`NodeFilter`. This also trims the DOM walker out of the browser chunk. Conversion then produced the exact expected Traditional strings.
- **Files modified:** src/lib/services/zh-convert.ts
- **Verification:** `pnpm test -- src/lib/services/zh-convert.test.ts` 12/12 green; `pnpm check` 0 errors.
- **Committed in:** `2d278ac` (Task 3 commit)

---

**Total deviations:** 1 auto-fixed (1 blocking-issue fix). No architectural changes, no scope creep.
**Impact on plan:** All acceptance criteria met; the converter actually converts (the plan's index-import would have shipped a silently-identity no-op under the node tests and pulled a useless DOM walker into the client bundle).

## Issues Encountered / Out-of-Scope (Deferred)
- **Pre-existing unrelated test failure:** `src/lib/stores/searchHistory.svelte.test.ts` (Phase 14-01, commit `188b495`) fails its SSR-guard case `expect(typeof globalThis.localStorage).toBe('undefined')` because the toolchain is **Node v25.9.0**, which exposes a native `globalThis.localStorage` (Web Storage API). Fails in isolation, no Phase-25 code involved, unrelated file — logged to `deferred-items.md`, NOT fixed (scope boundary). Full suite otherwise: **1097 passed / 1 pre-existing failure**.
- The tongwen `.js.map` sourcemap warnings during the test run are harmless package artifacts (maps reference original `.ts` sources not shipped in the tarball) — no effect on our code or results.

## Verification
- `pnpm check` → 0 errors, 0 warnings (4311 files).
- `pnpm test -- src/lib/services/zh-convert.test.ts` → 12/12 green.
- `grep -n "import(" src/lib/services/zh-convert.ts` → tongwen imports are all dynamic; `grep -c "from 'tongwen"` (top-level) → 0.
- `package.json` → `tongwen-core: "4.1.1"`, `tongwen-dict: "1.0.2"` (exact, no caret).

## Next Phase Readiness
- Plan 03 can now wire `isChineseLine` + `s2tConvertLines` into `translateLinesEx()` (D-02): offline-convert Chinese-detected lines when `to === 'zh-Hant'`, send only the remainder to the API cascade (Plan 02).
- No blockers. The single deviation is a correctness fix and is documented above.

## Threat Flags
None — no new network endpoints, auth paths, or trust-boundary surface introduced (pure client-side offline conversion; the supply-chain gate T-25a-SC was human-approved, T-25a-01 bundle-size and T-25a-02 JA-guard mitigations are both realized and tested).

## Self-Check: PASSED
- `src/lib/services/zh-convert.ts` — FOUND (exports `isChineseLine` + `s2tConvertLines`)
- `src/lib/services/zh-convert.test.ts` — FOUND (12 tests, incl. `isChineseLine('さくら')===false`)
- `.planning/phases/25-zh-hant-offline-conversion-fallback-cascade/25-01-SUMMARY.md` — FOUND
- Commits `449901b` (feat, Task 2) + `2d278ac` (fix, Task 3) — present in git log
- `pnpm check` 0 errors; `pnpm test -- zh-convert.test.ts` 12/12 green

---
*Phase: 25-zh-hant-offline-conversion-fallback-cascade*
*Completed: 2026-07-11*
