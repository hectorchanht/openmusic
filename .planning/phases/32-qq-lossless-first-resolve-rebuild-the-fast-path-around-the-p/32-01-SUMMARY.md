---
phase: 32-qq-lossless-first-resolve-rebuild-the-fast-path-around-the-p
plan: 01
subsystem: sources / playback-quality
tags: [quality-tier, connection-detection, defaults, joox, kuwo]
requires: []
provides:
  - "effectiveQuality() — the single 'auto' → concrete-tier resolution seam"
  - "PLAYBACK_DEFAULTS.defaultQuality = 'auto'"
affects:
  - "src/lib/sources/qq.ts (plan 32-05 makes the identical one-line effectiveQuality change there)"
tech-stack:
  added: []
  patterns:
    - "local structural interface for a non-lib.dom.d.ts platform API (edge-cache.ts precedent), no any cast"
    - "typeof-probe feature detect instead of `import { browser }` in a file whose contract forbids $app"
    - "fail-closed whitelist for an untrusted/absent platform signal"
key-files:
  created: []
  modified:
    - src/lib/sources/quality.ts
    - src/lib/sources/quality.test.ts
    - src/lib/config/defaults.ts
    - src/lib/stores/settings.svelte.ts
    - src/lib/stores/settings.svelte.test.ts
    - src/lib/sources/kuwo.ts
    - src/lib/sources/kuwo.test.ts
    - src/lib/sources/joox.ts
    - src/lib/sources/joox.test.ts
decisions:
  - "32-D-02: 'auto' resolves in ONE function (effectiveQuality) that every pref-reading adapter calls; the default ships as 'auto'"
  - "32-D-03: no connection signal, or a type outside the wifi/ethernet whitelist, resolves to '320' — fail closed"
  - "32-D-04: the '128' rung selects song_play_url_standard (measured 98 kbps), not the '128–160k band' the old D-03 comment claimed"
metrics:
  duration: ~13 min
  completed: 2026-08-31
requirements: [D-02, D-03, D-04]
---

# Phase 32 Plan 01: The 'auto' quality seam Summary

`'auto'` now means lossless only on a positively-identified unmetered connection and `'320'`
everywhere else, resolved in one pure `effectiveQuality()` that kuwo and joox call before any
tier ladder runs; the shipped default moved `'128'` → `'auto'`.

## What Was Built

**`effectiveQuality(pref)` in `src/lib/sources/quality.ts`** (32-D-02/32-D-03). Non-`'auto'`
prefs pass through untouched. `'auto'` reads `navigator.connection` through a locally-narrowed
`NetInfo` interface and returns `'lossless'` only when `type` is `'wifi'`/`'ethernet'` and
`saveData !== true`; everything else — including no `navigator`, no `connection`, and any type
outside the whitelist — returns `'320'`. Return type is `Exclude<DefaultQuality, 'auto'>`, so
the compiler proves no adapter ladder can still receive `'auto'`.

Deliberate choices, all recorded in the doc-block:
- `effectiveType` is NOT consulted — it estimates speed, not metering, and fast cellular reports
  `'4g'`, which is the exact case 32-D-02 exists to prevent.
- `typeof navigator === 'undefined'` feature-detect rather than `import { browser }`, because
  this file's header contract is "NO runes, NO `$app`, NO store import". CLAUDE.md's browser-guard
  rule explicitly permits the feature-detect form.
- No `any` cast (`grep -c "as any"` = 0), following the `proxy/edge-cache.ts` local-interface
  precedent.
- iOS Safari and desktop Chrome land in the `'320'` branch by platform gap, not by accident —
  32-D-03, spelled out in the comment as an accepted tradeoff so a later reader does not "fix" it.

**Default flipped** in `config/defaults.ts` to `defaultQuality: 'auto'`, with the superseded
D-03 ref named rather than deleted, and the 32-D-04 correction (the `'128'` rung is
`song_play_url_standard`, measured 98 kbps) recorded at both non-qq sites (`defaults.ts`,
`settings.svelte.ts`). The two surviving `128–160k` strings are inside "superseded" notes, which
the acceptance criterion explicitly allows.

**kuwo + joox routed through the seam** — one line each, tagged 32-D-02. joox's stale doc-block
claim that `'lossless'/'auto'` keep the verbatim order was corrected in the same commit, since
`'auto'` no longer implies it.

`qq.ts` was NOT touched (owned by plan 32-05) — confirmed clean in `git status` before committing.

## Verification Evidence

Every command below was run and its real output observed.

| Gate | Command | Observed |
|---|---|---|
| RED (task 1) | `pnpm vitest --run src/lib/sources/quality.test.ts` | 7 failed / 6 passed — `TypeError: effectiveQuality is not a function` |
| GREEN (task 1) | same | 13 passed |
| Task 2 | `pnpm vitest --run src/lib/stores/settings.svelte.test.ts` | 22 passed |
| RED (task 3) | `pnpm vitest --run src/lib/sources/kuwo.test.ts src/lib/sources/joox.test.ts` | 1 failed / 25 passed — the joox gate-#2 case failed exactly as predicted |
| GREEN (task 3) | same | 26 passed |
| Full suite | `pnpm test` | **95 files / 1747 tests passed, 0 failed** |
| Typecheck | `pnpm check` | **4380 files, 0 ERRORS 0 WARNINGS** |

No pre-existing failures were encountered — the suite was green before and after.

Acceptance greps, all observed:
- `grep -c "as any" src/lib/sources/quality.ts` → `0`
- `grep -c "effectiveQuality" src/lib/sources/quality.ts` → `2`
- `grep -c "effectiveQuality"` → kuwo `2`, joox `3` (import + call + the explanatory comment; the
  plan predicted 2, the extra is a comment mention, and the substantive criterion — every
  `settings.defaultQuality` read is wrapped — holds in both files)
- `grep -n "defaultQuality: 'auto'" src/lib/config/defaults.ts` → exactly 1 line
- no file under `src/lib/i18n/` appears in any commit (the settings UI already ships
  `settings.optAuto`, so zero dictionaries changed)

**Gate #2 is pinned by an assertion on the first probed URL**, not just the outcome: the joox
test reads the fetch spy's calls and asserts the first non-`/api` request is the `OGG 320` tier,
proving the ladder was reordered *before* any probe ran and Atmos/FLAC were never reached.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 2 - Missing critical correctness] Reworded a `quality.ts` comment so the acceptance grep stays literal-clean**
- **Found during:** Task 1 acceptance check
- **Issue:** The doc comment contained the phrase "Never `as any`", which made
  `grep -c "as any" src/lib/sources/quality.ts` return `1` even though the file contains zero
  casts. The criterion is a mechanical grep, so a prose mention would read as a violation to any
  later verifier running it.
- **Fix:** Reworded to "No `any` cast — this repo has zero of those in production source."
- **Files modified:** `src/lib/sources/quality.ts`
- **Commit:** `747e601`

**2. [Rule 2 - Stale decision record] Corrected the `pickJooxPlayUrl` doc-block**
- **Found during:** Task 3
- **Issue:** The doc-block asserted "`'lossless'`/`'auto'` keep the verbatim order". After this
  plan that is false: `'auto'` keeps the verbatim order only on a wifi/ethernet connection. The
  plan named three stale-comment sites but not this fourth one, and leaving it would have been a
  live wrong claim in a file the plan already edits.
- **Fix:** Replaced with a 32-D-02 note naming what it supersedes (house rule: replace a
  decision-ref comment with one that says why, never delete it).
- **Files modified:** `src/lib/sources/joox.ts`
- **Commit:** `4196f53`

### Notable non-deviation

The kuwo `'auto'` test passed on first run (before the adapter change) — raw `'auto'` already
fell through to `level='zp'` because the branch only tests for `'128'`. That is coincidence, not
correctness: it is exactly the "lossless on cellular" behaviour gate #2 targets, and kuwo simply
has no distinct 320 rung to downgrade to. The test was kept as a regression pin and asserts
`not.toContain('auto')` so a future refactor cannot leak the literal token into the request. The
honesty gap (kuwo cannot honour `'320'`) is pre-existing, disclosed by
`settings.defaultQualityNote`, and recorded in a comment rather than "fixed", per the plan.

## Assumption Drift (advisory)

**joox `effectiveQuality` mention count**
- **Found during:** Task 3 acceptance
- **Planned:** the plan asserted `grep -c "effectiveQuality" joox.ts` = 2 (import + call).
- **Actual:** 3.
- **Why:** the house comment-density convention required an explanatory comment above the call
  site, and that comment names the function. The load-bearing half of the criterion — no raw
  `settings.defaultQuality` reaches a ladder — is satisfied.

## Known Stubs

None. No placeholder values, no unwired data paths.

## Threat Flags

None. The plan's threat register is unchanged: `effectiveQuality` reads two boolean-ish platform
fields, never transmits them, and reads neither `downlink` nor `rtt` (the fingerprinting-sensitive
pair). T-32-02 (FLAC on a metered link) is mitigated by the fail-closed whitelist and is now
pinned by the cellular / unknown-type / no-signal / `saveData` tests.

## Notes for Plan 32-05

`qq.ts:102` is the third pref read and still receives the raw pref. It needs the identical
one-line wrap:

```ts
const pref = effectiveQuality(quality ?? settings.defaultQuality);
```

Also still stale in `qq.ts` (the third 128–160k site, deliberately left for 32-05 to avoid a
collision): the `pickBestPlayUrl` doc-block at lines ~89-96 repeats the "~128kbps" / "128–160k
band" claim that 32-D-04 corrects to a measured 98 kbps.

## Self-Check: PASSED

- `src/lib/sources/quality.ts` — FOUND
- `src/lib/sources/quality.test.ts` — FOUND
- `src/lib/config/defaults.ts` — FOUND
- `src/lib/stores/settings.svelte.ts` — FOUND
- `src/lib/stores/settings.svelte.test.ts` — FOUND
- `src/lib/sources/kuwo.ts` / `kuwo.test.ts` — FOUND
- `src/lib/sources/joox.ts` / `joox.test.ts` — FOUND
- Commits `6189b87`, `747e601`, `88e4419`, `6fb68b6`, `4196f53` — all FOUND in `git log`
- Pre-existing dirty files (`.gitignore`, `CLAUDE.md`, `HANDOFF.json`, `docs/agents/`) — absent
  from all five commits (verified via `git status --short <explicit paths>` before each `git add`)
