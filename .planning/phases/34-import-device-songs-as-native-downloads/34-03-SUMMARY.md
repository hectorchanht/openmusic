---
phase: 34-import-device-songs-as-native-downloads
plan: 03
subsystem: services
tags: [device-import, filename-parsing, redos, pure-module, rules]

requires:
  - phase: 29
    provides: "download-filename.ts — the `{artist} - {title}.{ext}` builder this module inverts, and its AUDIO_EXT set"
  - phase: 34.01
    provides: "the device: uid contract and the ParsedName precedence rule (tag → parsed filename → stem)"
provides:
  - "device-filename.ts — ImportRules model, zero-config defaults, tolerant parseImportRules, stemOf/extOf, three audited presets, D-16 stem fallback"
  - "validateCustomPattern — save-time ReDoS defence (layer 1 of RESEARCH Pitfall 8) with three distinct rejection reasons"
  - "AUDIO_EXTENSIONS exported from download-filename.ts as the single source of the audio-extension vocabulary"
affects: [34-06 import service, 34-07 rules store, 34-08 settings rules panel]

tech-stack:
  added: []
  patterns:
    - "Tolerant per-FIELD parse (KEY constant + pure parser) mirroring search/search-history-logic.ts, so one bad localStorage value cannot reset a whole panel"
    - "Bounded adversarial probe: keep the probe input short enough to be measurable and long enough to be exponential"
    - "Shared vocabulary export: the regex is derived from the tuple, so the two consumers cannot drift"

key-files:
  created:
    - src/lib/services/device-filename.ts
    - src/lib/services/device-filename.test.ts
  modified:
    - src/lib/services/download-filename.ts

key-decisions:
  - "Whitespace collapse + trim runs unconditionally, not only under stripBrackets — a bracket strip leaves a hole, and a raw MediaStore name can carry double spaces either way"
  - "stemOf keeps a dotfile-style name whole (`.mp3` stays `.mp3`) and extOf agrees, so the two helpers never disagree about where the extension starts"
  - "The probe budget is re-checked after EVERY battery string, not once at the end, so the first catastrophic probe aborts instead of running five more times"
  - "parseImportRules returns a deep-enough clone; the exported DEFAULT_IMPORT_RULES can never be mutated through a returned array reference"
  - "Empty `presets` / `extensions` arrays are accepted as a real user choice; only a missing or non-array field falls back to the default"

patterns-established:
  - "An untrusted regex is compiled with NO flags — a `g` flag's stateful lastIndex would silently skip every second item in a scan loop"

requirements-completed: [34-D-12, 34-D-13, 34-D-14, 34-D-16]

duration: 5min
completed: 2026-09-13
---

# Phase 34 Plan 03: Filename parsing and import rules Summary

**`Adele - Hello.mp3` now parses to artist `Adele` / title `Hello` with zero configuration, every D-12 preset and toggle is a pure audited function, and a user's raw regex is compiled, group-checked and time-probed before it can ever touch a 3000-file scan.**

## Performance

- **Duration:** ~5 min
- **Started:** 2026-09-14T02:03:52Z
- **Completed:** 2026-09-14T02:08:30Z
- **Tasks:** 2 of 2
- **Files modified:** 3 (2 created, 1 modified)

## Accomplishments

### Task 1 — rules model, presets, `parseFilename` (RED `db2dc0b` → GREEN `c34684d`)

`src/lib/services/device-filename.ts`, pure and store-free — its only import is `AUDIO_EXTENSIONS` from `download-filename.ts`. Exports everything the plan's `<interfaces>` block promised: `IMPORT_RULES_KEY`, `PRESET_ORDER`, `PRESET_LABELS`, `IMPORT_EXTENSIONS`, `ImportRules`, `DEFAULT_IMPORT_RULES`, `parseImportRules`, `ParsedName`, `stemOf`, `extOf`, `parseFilename`.

- **`download-filename.ts` now owns one vocabulary.** `AUDIO_EXTENSIONS` is an exported `as const` tuple and `AUDIO_EXT` is built from it (`new RegExp(\`\\.(${AUDIO_EXTENSIONS.join('|')})$\`, 'i')`). Behaviour is identical — `download-filename.test.ts` stayed green untouched — and the literal `mp3|flac|m4a|aac|ogg|wav` alternation no longer appears anywhere in the file.
- **Presets are three fixed, audited regexes** over the pre-processed stem, with a comment naming them as Pitfall 8 layer 3 (never user input). The separator is SPACE-HYPHEN-SPACE, which is the single choice that keeps `Jay-Z - 99 Problems.mp3` parsing as artist `Jay-Z` rather than artist `Jay`.
- **`stripTrackNo` requires a `.` or `-` separator** (`/^\d{1,3}\s*[.\-]\s*/`), marked `ponytail:` with its stated ceiling: a bare `01 Title` is not stripped, and that is exactly what keeps `24K Magic` and `2 Become 1` intact. Numbered lists use the `{track}. {title}` preset instead.
- **One bracket regex, lifted verbatim** from `services/match-key.ts:26` with a back-reference comment. Lines 27-28 of that chain (feat.-suffix strip, punctuation strip) are deliberately NOT applied, because `match-key` normalizes for comparison while this produces text a user will read.
- **D-16 is honoured twice**: once if the strip steps eat the whole stem (fall back to the raw display name), and once as the terminal `{ title: stem, artist: '' }` when nothing matches. `title` is never empty.
- `parseImportRules` defaults **per field**, so one corrupt value cannot reset a user's whole panel, and returns a fresh object so the exported defaults cannot be mutated through a returned array.

27 `it()` cases (plan asked for ≥ 18).

### Task 2 — `validateCustomPattern`, the save-time probe (RED `a834d62` → GREEN `16258cf`)

Four ordered gates: blank → `invalid`; `new RegExp(src)` throws → `invalid`; no `(?<title|artist|album|track>` → `no-groups`; battery over budget → `too-slow`.

- **No flags on the compiled RegExp**, with the reason inline: a `g` flag carries a stateful `lastIndex`, so `exec` would silently skip every second filename in the scan loop. `grep -c "new RegExp(src, "` returns 0.
- **Six probe strings**, each 25 chars (`PATTERN_PROBE_LEN` + a `!` tail): the five generic adversarial shapes plus one built from the pattern's own literal characters, so a pattern tuned to its own alphabet still gets a worst-case input. The `!` matters — it forces the FAILING match that triggers backtracking; a matching string returns early.
- **The budget is re-checked after every string**, not once at the end, so the first catastrophic probe aborts the battery rather than being repeated five more times.
- The comment block states the asymmetry that makes this work: `(a+)+` on 24 chars is ~2^24 steps (measurable, over budget, bounded), the same pattern on a 200-char filename would be ~2^200. Marked `ponytail:` with the named upgrade path — a pattern that is polynomial at 24 chars but exponential later slips through, and layer 2 (`device-import.ts` scan budget, Plan 34-06) is what bounds that.

## Verification Results

All commands were run; these are observed outputs, not restatements of the plan.

| Check | Result |
|---|---|
| `pnpm vitest --run src/lib/services/device-filename.test.ts src/lib/services/download-filename.test.ts` | 2 files, 40 passed |
| `pnpm vitest --run src/lib/services/device-filename.test.ts` (after Task 2) | 36 passed in 1.07 s (budget was 10 s) |
| `pnpm vitest --run` (full suite) | **123 files, 2301 tests passed** (baseline 122 / 2265 — no regression) |
| `pnpm check` | 4521 files, 0 errors, 0 warnings |
| `grep -n "export const AUDIO_EXTENSIONS" download-filename.ts` | 1 line (18) |
| `grep -c "mp3\|flac\|m4a\|aac\|ogg\|wav" (alternation) download-filename.ts` | 0 — the regex is derived |
| `grep -n "match-key.ts:26" device-filename.ts` | 1 line (181); bracket-regex count 1 |
| `grep -c "new RegExp(src, " device-filename.ts` | 0 — no flags, no `g` |
| `grep -n "export const PATTERN_PROBE_BUDGET_MS = 25"` | 1 line (258) |

TDD gates observed for both tasks: RED run first and seen failing (Task 1: module-not-found; Task 2: 9 failed / 27 passed), committed as `test(...)`, then implemented to green as `feat(...)`. No REFACTOR gate was needed.

## Deviations from Plan

### Auto-fixed Issues

None — no bugs, missing critical functionality, or blockers were encountered.

### Acceptance-criterion note (not a code change)

One acceptance grep is comment-blind, the same class as the note in `34-01-SUMMARY.md`:

```
grep -n "\$lib/stores\|\$lib/i18n\|\$app/" src/lib/services/device-filename.ts
```

It returns two lines (9-10) — the PURITY CONTRACT header, which *names* `$lib/stores/*` and `$lib/i18n` while stating that the module must never import them. The criterion's intent (no such **import**) holds: `grep -n "^import"` returns exactly one line, `import { AUDIO_EXTENSIONS } from './download-filename'`. Recorded here rather than silently reworded to dodge a grep, since the contract comment is the load-bearing part and it deliberately mirrors `download-filename.ts:8-11`.

## Assumption Drift (advisory)

**Whitespace collapse is unconditional, not part of the bracket-strip step**
- **Found during:** Task 1
- **Planned:** the `<action>` puts "collapse whitespace and trim" inside step (3), reading as though it belongs to `stripBrackets`.
- **Actual:** collapse + trim run on every call regardless of the toggles.
- **Why it matters:** the plan's own `<behavior>` bullet for `stripBrackets: false` says "display text preserved, only whitespace collapsed/trimmed", which only holds if the collapse is unconditional. A raw MediaStore `DISPLAY_NAME` can carry double spaces with no brackets involved, so this is also the more truthful behaviour. No test distinguishes the two readings in a way the plan didn't already pin.

**Probe-battery string length: RESEARCH says 48, the plan says 24**
- **Planned:** 34-RESEARCH Pitfall 8 suggests `'a'.repeat(48)` and a ~50 ms budget; the plan specifies `PATTERN_PROBE_LEN = 24` and 25 ms.
- **Actual:** shipped the plan's 24 / 25 ms — the plan is the later artifact and the numbers are self-consistent (halving the length halves the exponent, so the budget halves with it).
- **Why it matters:** RESEARCH flags both figures as `[ASSUMED — unmeasured starting points]`. The observed `(a+)+` probe cost is well inside the 2 s test ceiling (the whole 36-test file runs in 1.07 s, essentially all of it this one case), so 24/25 has real headroom. If a legitimate pattern is ever falsely rejected, `PATTERN_PROBE_BUDGET_MS` is the one knob and it is exported.

## Known Stubs

None. Every export is fully implemented and exercised by a test. `IMPORT_RULES_KEY`, `PRESET_LABELS` and `PRESET_ORDER` have no runtime consumer yet — that is Plan 34-07's store and 34-08's panel — but they are finished values, not placeholders, and each is pinned by a test.

## Threat Flags

None new. This plan *narrows* the phase's existing surface:

- **T-34-04 (ReDoS)** — layer 1 mitigated here as planned. Layers 2 and 3 remain: layer 3 (presets are fixed audited regexes, never user input) is also delivered here; layer 2 (the cumulative scan budget with preset fallback) is Plan 34-06's stated work and is the named upgrade path in the `ponytail:` comment.
- **T-34-05 (tampering via a malicious `DISPLAY_NAME`)** — `parseFilename` is a pure string transform that never touches a path. `baseOf` additionally strips any `/` or `\` prefix before parsing, so no path fragment reaches a title even if an app names a file with one.

## Notes for Future Phases

- **34-06** must implement layer 2 itself: a cumulative `performance.now()` budget across the parse pass that, on overrun, drops the custom pattern for the whole run and falls back to the D-13 preset with `toast.patternFellBack`. Layer 1 explicitly does not cover a pattern that is polynomial at 24 chars and exponential at 200.
- **34-07**'s store is a thin wrapper: `IMPORT_RULES_KEY` + `parseImportRules` + `JSON.stringify` on save, `browser`-guarded, exactly the `searchHistory.svelte.ts` shape. It must only ever persist a `customPattern` that passed `validateCustomPattern`.
- **34-08**'s live preview must run the candidate regex through `validateCustomPattern` (which is already bounded) rather than calling `parseFilename` with a raw user RegExp — UI-SPEC contract 6 requires the preview to share the save probe's budget, not open a second unbounded execution path.
- `DEFAULT_IMPORT_RULES.extensions` is spread from `AUDIO_EXTENSIONS`, so adding a container to `download-filename.ts` automatically turns it on by default for import. If that is ever not wanted, the defaults need their own literal list.

## Self-Check: PASSED

- `src/lib/services/device-filename.ts` — FOUND
- `src/lib/services/device-filename.test.ts` — FOUND
- `src/lib/services/download-filename.ts` — FOUND (modified)
- Commit `db2dc0b` (test, Task 1 RED) — FOUND
- Commit `c34684d` (feat, Task 1 GREEN) — FOUND
- Commit `a834d62` (test, Task 2 RED) — FOUND
- Commit `16258cf` (feat, Task 2 GREEN) — FOUND
