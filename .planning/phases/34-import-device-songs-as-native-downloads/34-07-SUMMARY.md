---
phase: 34-import-device-songs-as-native-downloads
plan: 07
subsystem: stores
tags: [device-import, runes-store, generation-guard, notice-channel, ui-contract-8]

requires:
  - phase: 34
    plan: 06
    provides: "syncDevice / SCAN_PAGE_SIZE / ImportSummary — the pure brain this store drives"
  - phase: 34
    plan: 04
    provides: "MediaStoreSaver.requestReadAudio / scanAudio — the permission + paging bridge"
  - phase: 34
    plan: 02
    provides: "library.setDownloads / clearUnavailable / isUnavailable — this store is their sole caller"
  - phase: 34
    plan: 03
    provides: "IMPORT_RULES_KEY / parseImportRules / validateCustomPattern"
  - phase: 34
    plan: 01
    provides: "isDeviceUid + blobStore.linkPublicUri"
  - phase: 34
    plan: 05
    provides: "menu.unavailable + the three toast.import* keys across 15 locales"
provides:
  - "deviceImport — the runes singleton: rules, phase, progress, summary, permission, patternError, notice, runImport/cancel"
  - "importNotice(summary, failed) — the single-slot completion-toast precedence, exported pure so it is testable without a 2s regex"
  - "Contract 8: the unavailable CircleAlert on every row surface and in DownloadControl"
  - "Contract 8: Download + Share hidden for device: entries in TrackMenu"
affects: [34-08 settings import page + layout notice host]

tech-stack:
  added: []
  patterns:
    - "Thin runes driver over a pure brain: the store owns I/O, paging and the generation guard; every DATA decision stays in services/device-import.ts"
    - "Single-slot notice precedence as an exported pure function — the toast mapping gets a deterministic unit test instead of an adversarial-regex integration test"

key-files:
  created:
    - src/lib/stores/device-import.svelte.ts
    - src/lib/stores/device-import.svelte.test.ts
  modified:
    - src/lib/components/RowBadges.svelte
    - src/lib/components/DownloadControl.svelte
    - src/lib/components/TrackMenu.svelte

key-decisions:
  - "plan.relink is applied BEFORE library.setDownloads (34-06's explicit handoff): the stored public URI must be in the index before the entry that needs it is published, or a relinked song is playable only after the next launch"
  - "The completion notice is a PRECEDENCE (failed > patternFellBack > done), not a sequence of assignments — the plan's sequential writes made toast.patternFellBack structurally unreachable, which contradicts UI-SPEC line 432"
  - "importNotice is exported so the toast mapping is unit-tested directly; reproducing a mid-run pattern demotion through the store would have cost a ~2.5s adversarial-regex test for a mapping that is three lines"
  - "'unsupported' is routed to toast.importFailed, NOT to `permission` — nothing the user can do in App info changes an API<=28 device"
  - "A rejecting requestReadAudio maps to the SOFT 'denied' state, so the CTA stays tappable and Android may ask again"

patterns-established:
  - "Reset-the-public-fields test helper: a module singleton's private plain guards (loaded/importGen) are deliberately NOT reset, which is what lets the idempotency case assert on `loaded` surviving"

requirements-completed: [34-D-05, 34-D-06, 34-D-07, 34-D-08, 34-D-12, 34-D-13, 34-D-14]

duration: 8min
completed: 2026-09-13
---

# Phase 34 Plan 07: The import store + Contract 8 glyphs Summary

**One tap now walks the device library page by page, hands the whole scan to the pure brain in a single call, and commits the result — relink first, then downloads — while a second tap is a no-op, a cancel keeps everything already found, and a download whose file has vanished turns red on every row in the app.**

## Performance

- **Duration:** ~8 min
- **Started:** 2026-09-14T02:46:00Z
- **Completed:** 2026-09-14T02:54:00Z
- **Tasks:** 2 of 2
- **Files modified:** 5 (2 created, 3 modified)

## Accomplishments

### Task 1 — `device-import.svelte.ts` (RED `49a78cc` → GREEN `a6fc25c`)

The singleton is a driver, not a second brain: it owns permission, paging, the generation guard and
persistence, and every decision about *data* stays in 34-06's pure module.

- **All three of this plan's handoffs are honoured.** The walk pages with `SCAN_PAGE_SIZE` and makes
  exactly ONE `syncDevice` call with the accumulated rows; `plan.relink` is applied **before**
  `library.setDownloads`; and `complete: false` is passed for a **failed** walk as well as a
  cancelled one — a rejecting page is as uninformative about "gone" as a cancel is.
- **The generation guard is the house idiom, re-checked after every await** (`myGen !== this.importGen`
  at the permission await and inside the page loop). `cancel()` is not a kill signal to the bridge:
  the in-flight page still resolves and is simply discarded, which is exactly why partial results
  survive it.
- **`loaded` and `importGen` are PLAIN private fields**, not `$state` — no template reads them, and a
  counter that invalidates the runes graph on every bump is pure churn (CLAUDE.md's internal-counter
  convention, stated inline).
- **No i18n, no toast store.** Completion travels as `notice: { key, params }`; the layout host maps
  it. `grep '\$lib/i18n\|\$lib/stores/toast'` on the store returns nothing.
- **`total` only ever grows** (`Math.max`), so the progress bar cannot move backwards when a page
  reports a smaller count mid-walk.
- **Defensive page shape.** `Array.isArray(page?.rows) ? page.rows : []` and `Number(page?.total) || 0`
  — the bridge payload is untrusted input crossing a process boundary, and a malformed page must
  degrade to "no rows" rather than throw halfway through a library rebuild (Rule 2).

19 `it()` cases (plan asked for ≥ 11), including the deferred-promise cancel case and the
re-entrancy case.

### Task 2 — Contract 8 (`52c4c70`)

- `RowBadges.svelte`: `unavailable` derived, the downloaded branch forked to `CircleAlert` in
  `#ff7a90` at full opacity, same `size`, same wrapper — so **no list page was edited** and every
  row surface (home / search / artist / up-next / library / related) inherits the state.
- `DownloadControl.svelte`: the same fork ahead of `isDownloaded`, non-interactive, same 40×40
  footprint.
- `TrackMenu.svelte`: `isDevice` derived from `isDeviceUid(track.uid)` gates the header Download
  fork, the list Download fork and the Share row. `track-menu-gate.ts` was **not** touched — it owns
  resolve timing, not visibility, and the one comment above the header fork says so.

## Verification Results

All commands were run; these are observed outputs.

| Check | Result |
|---|---|
| `pnpm vitest --run src/lib/stores/device-import.svelte.test.ts` (RED) | failed — `Cannot find module './device-import.svelte'` |
| `pnpm vitest --run src/lib/stores/device-import.svelte.test.ts` (GREEN) | **19 passed** |
| `pnpm vitest --run src/lib/components` | 11 passed (1 file) |
| `pnpm test` (full suite) | **125 files, 2372 tests passed** (baseline 124 / 2353 — no regression) |
| `pnpm check` | 4525 files, **0 errors, 0 warnings** |
| `grep '\$lib/i18n\|\$lib/stores/toast'` on the store | nothing |
| `grep 'private loaded = false;\|private importGen = 0;'` | 2 lines (78, 79) |
| `grep -c 'myGen !== this.importGen'` | 2 (lines 143, 169) |
| `grep 'library.setDownloads(plan.downloads)\|blobStore.linkPublicUri(r.uid, r.uri)\|if (complete) library.clearUnavailable()'` | 3 lines (199, 200, 202) |
| `grep 'export const deviceImport = new DeviceImport()'` | 1 line (239) |
| `grep -rn 'AlertCircle\|alert-circle' src/lib/components/` | nothing (the icon is `CircleAlert`) |
| `grep -c '{#if !isDevice}' TrackMenu.svelte` / `grep -c isDeviceUid` | 3 / 2 |
| `git diff --stat track-menu-gate.ts "(app)/library/+page.svelte"` | empty — neither touched |
| `git diff --diff-filter=D --name-only HEAD~1 HEAD` | empty — no deletions |

TDD gate observed for Task 1: the test file was written and run failing first (module-not-found),
committed as `test(...)`, then implemented to green as `feat(...)`. No REFACTOR gate was needed.

**Not verified (cannot be, here):** every on-device behaviour — that the permission dialog returns
the states the mapping expects, that a real MediaStore walk pages coherently, and that the red
`CircleAlert` renders as intended on a handset. All bridge calls are mocked. That is device UAT and
no claim is made about it.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] `toast.patternFellBack` was structurally unreachable as written**

- **Found during:** Task 1
- **Issue:** the plan's `<action>` writes the notices as three sequential assignments —
  `if (patternFellBack) notice = patternFellBack; if (failed) notice = failed; else notice = done;`
  — with no await between them. The last write always wins, so the `patternFellBack` assignment is
  dead code and the toast can never appear. UI-SPEC line 432 requires it to: *"falls back to the
  D-13 preset for the whole run and fires `toast.patternFellBack`"*.
- **Fix:** replaced the sequence with an exported pure precedence, `importNotice(summary, failed)` →
  `failed > patternFellBack > done`. The count is not lost by the middle case: the persistent summary
  panel the user is already looking at renders every count in full (UI-SPEC contract 4), whereas a
  silently demoted custom pattern has no other surface.
- **Consequence for the plan's own test bullet:** the plan asked to assert that after a run with
  `patternFellBack` the final `notice.key` is `'toast.importDone'`. That assertion encodes the bug,
  so it was replaced by three deterministic `importNotice` cases pinning the precedence.
- **Files modified:** `src/lib/stores/device-import.svelte.ts`, `src/lib/stores/device-import.svelte.test.ts`
- **Commit:** `a6fc25c`

**2. [Rule 2 - Missing critical functionality] relink ordering**

- **Found during:** Task 1
- **Issue:** the plan's `<action>` lists `library.setDownloads(plan.downloads)` *before* the relink
  loop; 34-06's handoff states the opposite and gives the reason.
- **Fix:** relink first, then the downloads commit, with the reason inline. The plan's acceptance
  greps are order-agnostic and both still pass.
- **Commit:** `a6fc25c`

### Added beyond the plan

- **Untrusted-page hardening** — `page.rows` / `page.total` are shape-checked before use. The scan
  payload crosses a JS↔Kotlin bridge; a malformed page must produce "no rows", not an exception
  thrown out of a loop that is halfway through rebuilding the user's library. One line each.
- **`this.notice = null` at the top of `runImport`** — otherwise the previous run's toast key is
  still live while the new scan is in flight, and a host that reads it on mount would re-show a
  stale toast.
- **A rejecting `requestReadAudio` is logged** via `logAction('import.permission', …)` like the
  other two permission outcomes, so the Activity log shows *why* a tap did nothing.

### Acceptance-criterion notes (not code changes)

Two of Task 2's greps are line-count based and comment-blind, in the same family as the notes 34-01,
34-02 and 34-06 each had to record:

- `grep -n "t('menu.unavailable')"` across both components returns **2 lines, not ≥ 4**. The intent
  (aria-label **and** title in each component) holds — both occurrences sit on one line per file,
  which is the existing house style for the `.rb.downloaded` badge directly above it. Splitting a
  one-line span across four lines to satisfy a line count would make the two badges inconsistent.
- `grep -c "#ff7a90" DownloadControl.svelte` returns **2, not 1**. The second is inside the tri-state
  header comment the plan's own `<action>` mandated (`unavailable → CircleAlert, #ff7a90, …`).

## Assumption Drift (advisory)

**The store's `notice` can only ever deliver ONE message per run**

- **Planned:** the plan's `<action>` comment frames the sequential assignments as "a later assignment
  supersedes — the host shows one toast", implying the earlier ones are a considered ordering.
- **Actual:** a single `$state` slot with no await between writes is not an ordering at all, it is a
  last-write-wins overwrite. Anything that needs two messages in one run needs a queue, not a slot.
- **Why it matters:** 34-08's host must treat `notice` as "the one thing worth saying", and anything
  else the run produced has to be read from `summary`. If a future phase needs both a warning and a
  completion toast, the slot becomes a queue — a change in this store, not in the host.

**`library.clearUnavailable()` clears marks for real-source uids too**

- **Planned:** "after a complete run `library.clearUnavailable()` was called with no args (every
  listed device entry was just confirmed present)."
- **Actual:** the no-arg form clears **every** mark, including any on a real-source download. Today
  that set is written only by the player's device-file-missing seam (34-02), so the two are the same
  set in practice — but the justification only covers device entries.
- **Why it matters:** if a later phase ever marks a streamed download unavailable, a device import
  would silently clear that mark. Shipped as planned (a device-only filter would need the store to
  reach into the set's contents, which `library` deliberately does not expose).

## Known Stubs

None. Every export is implemented and exercised. `deviceImport.load()`, `setRules`,
`setCustomPattern`, `cancel()` and `patternError` have no in-app caller yet — Plan 34-08's settings
page is their sole intended caller, and they are contract surface this plan was asked to create, not
placeholders.

## Threat Flags

None new. This plan closes the three mitigations the register assigned to it:

- **T-34-18 (interleaved scans)** — `runImport` returns immediately while `phase` is `'requesting'`
  or `'scanning'`; the `importGen` re-check is the second line of defence for a page already in
  flight. Pinned by the re-entrancy test (`requestReadAudio` and `scanAudio` called once each).
- **T-34-19 (rules payload tampering)** — `load()` is `browser`-guarded and try/caught around a
  tolerant `parseImportRules`; a corrupt payload leaves the working defaults in place (D-14).
- **T-34-20 (share URL for a local file)** — the Share row is now inside `{#if !isDevice}`, so no
  share URL carrying a `device:` uid can be produced from the menu.

No new network endpoint, auth path or schema. The only new writes are `openmusic:import-rules:v1`
(own data, own key) and the library payload `setDownloads` already owned.

## Notes for Future Phases

- **34-08** must call `deviceImport.load()` on mount (it is idempotent) and render progress from
  `done`/`total`/`phase` — never from page-local state, or navigating away kills the bar.
- The notice host maps `notice` through `t()` and **must clear it** (`deviceImport.notice = null`),
  or a remount re-shows the same toast.
- A cancelled run is rendered from `summary.complete === false` plus `summary.added` — there is no
  separate "cancelled" flag.
- `importNotice` is exported precisely so the host never re-derives the precedence.

## Self-Check: PASSED

- `src/lib/stores/device-import.svelte.ts` — FOUND
- `src/lib/stores/device-import.svelte.test.ts` — FOUND
- `src/lib/components/RowBadges.svelte` — FOUND (modified)
- `src/lib/components/DownloadControl.svelte` — FOUND (modified)
- `src/lib/components/TrackMenu.svelte` — FOUND (modified)
- Commit `49a78cc` (test, Task 1 RED) — FOUND
- Commit `a6fc25c` (feat, Task 1 GREEN) — FOUND
- Commit `52c4c70` (feat, Task 2) — FOUND
