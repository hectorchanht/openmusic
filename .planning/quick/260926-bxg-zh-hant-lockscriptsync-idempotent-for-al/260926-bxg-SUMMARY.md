---
phase: quick-260926-bxg
plan: 01
status: complete
subsystem: i18n / Chinese script lock
tags: [zh-convert, script-lock, tongwen, names]
requires: [quick-260919-2jo, quick-260925-x8o]
provides:
  - "zh-Hant lockScriptSync merge that is idempotent on already-Traditional input"
  - "warmScript('zh-Hant') warms both s2t and t2s"
affects: [names.svelte.ts applyLock surfaces, lyric-script.svelte.ts]
tech-stack:
  added: []
  patterns: ["per-code-point merge over tongwen s2t/t2s (Array.from alignment)"]
key-files:
  created: []
  modified:
    - src/lib/services/zh-convert.ts
    - src/lib/services/zh-convert.test.ts
    - src/lib/stores/names.svelte.ts
    - src/lib/stores/names.test.ts
decisions:
  - "zh-Hant lock = per code point: a char t2s changed keeps the source spelling, every other char takes s2t of the Simplified fold (not a pure t2s→s2t round trip, which corrupts 鍾鎮濤/髮如雪/臺灣)"
  - "warmScript('zh-Hant') uses Promise.allSettled over both builds so names.warmLock's single rev bump fires after the merge is fully warm"
  - "lockAlias deleted; aliases route through the same applyLock as upstream names"
metrics:
  completed: 2026-09-26
  tasks: 2
  files: 4
---

# Quick 260926-bxg: zh-Hant lockScriptSync idempotent for already-Traditional input

The zh-Hant script lock now folds a line to Simplified, runs s2t on the fold, and keeps every source character that t2s changed. So 周杰倫 and 周杰伦 both render 周杰倫, and real Traditional names (鍾鎮濤, 髮如雪, 臺灣, 麵) are left alone. The alias-only `lockAlias` workaround is gone.

## Commits

| Task | Commit | Message |
|------|--------|---------|
| 1 | 99645089 | fix(quick-260926-bxg): make the zh-Hant script lock idempotent on already-Traditional text |
| 2 | a62ef07b | refactor(quick-260926-bxg): drop lockAlias now that the shared lock folds Traditional input |

## What changed

- `zh-convert.ts`: added a private `hantLockSync(text)` just above `lockScriptSync`. The zh-Hant branch of `lockScriptSync` now calls it; the zh-Hans branch is unchanged. It falls back to direct s2t when t2s is cold or the code-point lengths don't line up, and to identity (`?? text`) when s2t is cold. `warmScript('zh-Hant')` now awaits `Promise.allSettled([loadConvertLine(), loadT2sConvertLine()])`, and zh-Hans still awaits t2s only. I corrected the stale "already-Traditional is a no-op" doc comments on `s2tConvertLineSync` and `s2tConvertLines`, and added the ~22 KB gzip t2s cost for zh-Hant lock users to the COST block. All existing decision-ref comments are kept.
- `names.svelte.ts`: deleted `lockAlias`. `dnArtist` and `dnTitle` now call `this.applyLock(a)`. The x8o block comment now points to the shared merge, and the `warm()` comment notes that zh-Hant builds both dicts.
- `names.test.ts`: the alias `warmLock` helper is now a single `await zh.warmScript(target)`, and the comment no longer mentions `lockAlias`.

## Verification (observed)

- RED: before the fix, 5 of the 10 new tests failed for the expected reasons (周杰倫 → 周傑倫, 頭发 → 頭發, `Jay 周杰倫` → `Jay 周傑倫`, idempotence broken, and `warmScript('zh-Hant')` leaving t2s null). The partial-warm and zh-Hans round-trip tests already passed, because they pin behaviour that should not get worse.
- GREEN, targeted (`zh-convert`, `lyric-script`, `names` tests): 3 files, 93 tests passed, after both tasks.
- Full gate, after Task 1 and again after Task 2: `pnpm test`: 152 files / 3340 tests passed. `pnpm check`: 4604 files, 0 errors, 0 warnings. `pnpm build`: exit 0, adapter-cloudflare done.
- Plan greps: `Promise.allSettled([loadConvertLine(), loadT2sConvertLine()])` is at zh-convert.ts:358. `quick-260926-bxg` appears twice in zh-convert.test.ts. There are no `lockAlias(` matches. `this.applyLock(a)` appears twice.
- Not verified: the live browser render, which was not run. Coverage is from unit tests only.

## Notes

- **Source spelling is kept.** A source that itself spells 周傑倫 stays 周傑倫 under the lock. The merge keeps the source's spelling for any character that t2s changes. The lock controls script only; it does not normalise spelling, so two sources that use different Traditional spellings can still differ.
- **Out of scope:** `names.resolveTranslated`'s zh-Hant fast path and `translate.ts` still run raw s2t. That path is only reachable for mixed-script input, because `shouldTranslate` skips text that is already Traditional. If that path over-converts, the lock that runs afterwards keeps the result, because the merge treats a character t2s changes as the source spelling.

## Deviations from Plan

None. The plan was executed as written.

## Assumption Drift (advisory)

- **Found during:** Task 1 RED. **Planned:** the partial-warm test would fail before the fix. **Actual:** it passed before the fix. **Why:** with t2s cold the merge returns direct s2t, which is exactly what the old code did, so this test guards against getting worse rather than reproducing the bug. The dual-warm test did fail as expected.

## Known Stubs

None.

## Self-Check: PASSED

- FOUND: src/lib/services/zh-convert.ts, src/lib/services/zh-convert.test.ts, src/lib/stores/names.svelte.ts, src/lib/stores/names.test.ts
- FOUND: 99645089, a62ef07b
