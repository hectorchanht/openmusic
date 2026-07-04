---
phase: quick-260704-cq9
plan: 01
subsystem: docs
tags: [readme, about-page, copy, sources, discovery, test-count]
requires: []
provides:
  - "README.md: refreshed 7-source framing, consistent discovery attribution, real test count (1060)"
  - "about/+page.svelte: refreshed features array covering all 7 sources"
affects:
  - README.md
  - src/routes/(app)/settings/about/+page.svelte
tech-stack:
  added: []
  patterns: []
key-files:
  created: []
  modified:
    - README.md
    - src/routes/(app)/settings/about/+page.svelte
decisions:
  - "Docs written to the LIVE enabledByDefault:true reality for all 7 sources (planner override of orchestrator brief) — NOT 'opt-in only' for fivesing/jamendo/audius"
  - "Discovery attributed consistently in both docs: Last.fm genre/region shelves + Deezer top-hits/top-artists chart; covers Deezer -> iTunes -> CN"
  - "Real Vitest total is 1060 (69 files) — replaced both stale '414' figures; verified by running pnpm test, not guessed"
metrics:
  duration: 2 min
  completed: 2026-07-04
---

# Phase quick-260704-cq9 Plan 01: Update README + Settings → About Summary

Copy-only refresh of the public README and the in-app Settings → About page so both accurately describe the shipped app: the source list grew from 4 to 7 (5sing, Jamendo, Audius added), discovery attribution was inconsistent between the two docs, and the README test-count figure was stale.

## What Was Done

**Task 1 — README source framing + discovery attribution** (commit `1f72493`)
- Intro paragraph: broadened the "aggregated from NetEase, QQ, Kuwo and JOOX" + "Last.fm-powered discovery" framing to all seven sources (4 mainstream CN + 5sing UGC + Jamendo CC indie + Audius), noting all are searched by default and each is toggleable in Settings → Playback. Discovery reframed as Last.fm genre/region shelves + Deezer top-hits chart; kept "Deezer cover art" and "15-language UI".
- Source-adapter registry bullet: now states 7 adapters spanning CN mainstream / CN UGC / Western-global; kept the "adding a source = new client + proxy + one import" explanation.
- Features: search bullet reflects all 7 sources; discovery bullet reworded to the accurate Deezer-chart + Last.fm-shelves split with "the enabled sources" resolution; cover-art bullet (Deezer → iTunes → CN) left as-is (already correct).
- Scope & honesty notes: acknowledged the mix now includes legitimately-open catalogs (Jamendo CC, decentralized Audius) alongside the CN proxies; kept the demo/educational honesty.

**Task 2 — About-page features array** (commit `dbe8d42`)
- Edited ONLY the literal `features: string[]` array (the display-string comment on line 14 preserved verbatim; tabs + single quotes retained).
- features[0]: names all 7 sources, searched by default, toggleable in Settings → Playback.
- features[1]: discovery = Deezer top-hits/top-artists chart + Last.fm genre/region shelves (was single-source "Deezer-powered").
- features[2]: "the enabled sources" replaces "the CN sources".
- features[3]: aligned to the full Deezer → iTunes → CN cover chain.
- features[4] kept "15 UI languages" unchanged. `pnpm check` (svelte-check): 4298 files, 0 errors, 0 warnings.

**Task 3 — README test-count reconciliation** (commit `10e23d8`)
- Ran the full Vitest suite: **69 test files, 1060 tests passed** (all green, 12.44s).
- Replaced BOTH stale "414" figures (getting-started code comment + Architecture services line) with **1060**. No other numbers changed.

## Verification

- `grep '414' README.md` → nothing (stale figure gone).
- Both docs name 5sing/fivesing, Jamendo, Audius.
- Both docs attribute discovery as Last.fm shelves + Deezer top-hits chart; neither implies one source powers everything.
- "15" language count preserved in both docs; zero "16".
- `pnpm check` → 0 errors / 0 warnings.
- `pnpm test` → 1060/1060 passed, 69/69 files.
- `git diff --stat` over the three commits shows ONLY README.md and about/+page.svelte changed — no adapter, i18n, or other files touched.

## Deviations from Plan

None — plan executed exactly as written. Copy-only, no source-logic / dependency / refactor changes.

## Follow-up: comment↔value drift (flagged, NOT fixed — copy-only task)

The orchestrator brief assumed the 3 new sources ship `enabledByDefault: false` (opt-in). This is WRONG per the live code — all 7 adapters ship `enabledByDefault: true` in the working tree. The docs were written to the live boolean. The stale prose comments that still SAY `false`/opt-in were left untouched (out of scope for a copy task) and are candidates for a follow-up code-comment fix:

| File | Line | Stale comment |
|------|------|---------------|
| `src/lib/sources/fivesing.ts` | 8 | `// Ships `enabledByDefault: false` (UGC supply is noisier…` — actual value at line 71 is `true` |
| `src/lib/sources/jamendo.ts` | 7 | `// Ships `enabledByDefault: false` (CC indie is a different intent…` — actual value at line 45 is `true` |
| `src/lib/sources/registry.test.ts` | 9-10 | comments `5sing … enabledByDefault:false` and `jamendo … enabledByDefault:false` — both adapters ship `true` |

The test at `registry.test.ts` asserts against the real adapter values (`if (a.enabledByDefault) …`), so the stale COMMENTS do not affect test correctness — only reader accuracy. A one-line comment fix per file would resolve the drift; deferred to the user's decision.

## Self-Check: PASSED

- README.md exists, modified (3 commits: 1f72493, dbe8d42 is the .svelte, 10e23d8).
- src/routes/(app)/settings/about/+page.svelte exists, modified.
- Commits verified in git log: 1f72493, dbe8d42, 10e23d8 all present on main.
