---
phase: 34-import-device-songs-as-native-downloads
plan: 08
subsystem: ui
tags: [settings, device-import, runes, i18n, native-gate, toast-host, phase-36-merge]

requires:
  - phase: 34
    plan: 07
    provides: "deviceImport — rules/phase/done/total/summary/permission/patternError/notice + runImport/cancel/setRules/setCustomPattern"
  - phase: 34
    plan: 05
    provides: "the 37 import.* keys + toast.import* across 15 locales"
  - phase: 34
    plan: 03
    provides: "PRESET_ORDER / PRESET_LABELS / IMPORT_EXTENSIONS / parseFilename / validateCustomPattern"
  - phase: 36
    plan: "05"
    provides: "the /settings/downloads route and its settings-index row (retag) — MERGED WITH, not replaced"
provides:
  - "/settings/downloads — the import CTA, progress rail, persistent summary, permission notices and the collapsed rules accordion, sharing the page with Phase 36's retag control"
  - "the (app) layout's second store→UI notice host: deviceImport.notice → toast"
affects: [any later phase adding a control to /settings/downloads]

tech-stack:
  added: []
  patterns:
    - "Native gate in the PAGE BODY, not in the navigation — a route shared by a native-only and a cross-platform control cannot have its index row hidden"
    - "Draft-vs-saved split for validated free text: the page holds the typed string, the store holds the last accepted one, and the divergence on rejection IS the non-destructive contract"

key-files:
  created: []
  modified:
    - src/routes/(app)/settings/downloads/+page.svelte
    - src/routes/(app)/settings/+page.svelte
    - src/routes/(app)/+layout.svelte

key-decisions:
  - "The settings-index Downloads row is NOT native-gated, against UI-SPEC contract 7: Phase 36's retag control lives on the same page and works on the web build, so hiding the row would orphan a shipped feature. Contract 7's own rationale (a row leading to a capability the web can never have) no longer applies once the page has a cross-platform control. The native gate moved into the page body, where the import section shows the single honest `import.webOnly` line on web."
  - "Import block ABOVE retag, rules accordion between them: the CTA must be reachable without scrolling (contract 2), and the accordion belongs to the control it configures."
  - "`settings.groupDownloadsDesc` left at Phase 36's 'Tag downloaded files with metadata' — 34-05 deliberately did not overwrite it, and rewording 15 locale files is that plan's scope, not this one's."

requirements-completed: [34-D-11, 34-D-12, 34-D-13, 34-D-14]

duration: 18min
completed: 2026-09-13
---

# Phase 34 Plan 08: The import surface Summary

**`/settings/downloads` now opens with one accent-filled button that scans the phone and reports exactly what it did — a forward-only progress rail with a Cancel, then a persistent block naming only the categories that were non-zero — with every rule folded away behind a collapsed accordion and a regex escape hatch one level deeper still, all merged into the page Phase 36 already owned rather than over it.**

## Performance

- **Duration:** ~18 min
- **Tasks:** 3 of 3
- **Files modified:** 3 (0 created — the route file already existed)

## The route collision, resolved

Phase 34 and Phase 36 both claimed `/settings/downloads`. Phase 36 shipped first and owns both the
route file (a retag control, 36-D-17) and the settings-index row. **Nothing of Phase 36's was
replaced, moved or orphaned.** The merged page is:

```
‹  Downloads
   DEVICE IMPORT                 ← 34, native-only body gate
   [ Import songs from device ]  ← accent CTA, or the progress rail in its place
   result slot: permission | summary | empty
   ▸ IMPORT RULES                ← 34, collapsed accordion
   DOWNLOADS                     ← 36, unchanged retag button + hint + progress
```

Phase 36's script (`eligible` / `retag()` / `flash()` / its `onMount` probe loop), its markup and its
`.item` / `.flash` / `.hint` styles are byte-identical to what was on disk; the import work was added
around them. The one edit inside 36's block is a new `<h2><Tags/> …</h2>` heading, added because the
page now has two sections and an unlabelled one would read as part of the import block.

## Accomplishments

### Task 1 — CTA, progress, summary, permission, web fallback (`4aca123`)

Contracts 1-4 and 7. Every string is a `t()` key; `grep` for raw English returns nothing.

- **The CTA is replaced in place while scanning** — same full-width 48px footprint, so nothing below
  reflows. Indeterminate (`total === 0`) renders the `.sliver.motion-always` idiom lifted from
  `Nowbar.svelte`; determinate renders a `width` fill. Progress is read from the STORE, never
  page-local, so navigating away does not cancel the scan and returning re-attaches.
- **`aria-valuenow` only in the determinate phase**, `aria-valuetext={t('import.scanning')}` in the
  indeterminate one, both on a `role="progressbar"` with `aria-busy`.
- **Counts are `toLocaleString()`-formatted** — `3180` reads as noise at a glance.
- **A zero-count summary category renders nothing**, and `import.summaryRemoved` is last and the only
  line in `#ff7a90`. A cancelled run has no separate flag: it is `complete: false` plus whatever was
  added, which is the `summaryCancelled` branch.
- **Both denial states leave the CTA tappable** — a permanently-denied user gets the full OS path in
  words, not a disabled control.

### Task 2 — the rules accordion (`440e602`)

Contracts 5-6. `import.rulesNote` is the first child, before any control, per D-14.

- Preset and extension chips are LITERAL-labelled multi-select toggles with `aria-pressed`;
  `togglePreset` appends on enable so the user's DECLARED order (which is what `parseFilename`
  matches in) is preserved rather than re-sorted.
- **The custom pattern validates on blur and on accordion-collapse, never per keystroke.** The typed
  draft is page-local `$state`; the saved pattern is the store's. On rejection they diverge — the
  text stays under the user's eyes, the last working pattern stays in force, and the CTA stays
  enabled. `aria-invalid` + `aria-describedby` announce the message.
- **The live preview runs the SAVED (already probe-passed) pattern against one fixed sample string**
  (T-34-21). It can never see the draft and never sees a file list.
- `import.parsingNote` (D-15, "only used when a file has no embedded tags of its own") is present —
  without it the presets read as an override.

### Task 3 — index row + layout notice host (`0fe77f3`)

- **`(app)/+layout.svelte`** gains a second, much smaller `$effect` beside the player-notice host:
  it reads `deviceImport.notice`, localises it inside `untrack()` (WR-04 — keeps `settings.appLang`
  out of the dependency set) and clears the channel so a remount cannot re-show the same toast. This
  is why a completion toast fires for a user who navigated away mid-scan (contract 3).
- **`settings/+page.svelte`**: the row already existed from Phase 36 with the right `href` and the
  right two keys, so only the icon changed (`Download` → `HardDriveDownload`, which UI-SPEC picks
  precisely because `Download` is the per-row glyph). The deviation below explains why no
  native-gate `$derived` was added.

## Verification Results

All commands were run; these are the observed outputs.

| Check | Result |
|---|---|
| `pnpm check` (after each task) | 4525 files, **0 errors, 0 warnings** |
| `pnpm build` (adapter-cloudflare) | succeeded, `✔ done` |
| `pnpm test` | **125 files, 2372 tests passed** — identical to the stated baseline, no regression |
| `grep -c "t('import\."` on the page | **38** (plan asked ≥ 34) |
| raw-English grep (`Only available\|Import songs from device\|Scanning…`) | nothing |
| `grep -c '{@html'` on the page | **0** (T-34-22) |
| `grep -n 'isNativePlatform()'` | 1 line, inside `onMount` |
| `grep -c 'motion-always'` / `role="progressbar"` / `toLocaleString()` | 2 / 1 / 2 |
| `import.skipRule` (line 177) before `import.summaryRemoved` (line 179, `class="hint removed"`) | correct order |
| `grep -c AlertCircle` / `CircleAlert` | 0 / 3 |
| `grep -c 'oninput={commitPattern}'` / `'onblur={commitPattern}'` | 0 / 1 |
| `grep -c aria-pressed` | 4 lines (2 chip loops × 2 occurrences + 2 toggle rows) |
| `grep -c 'deviceImport.notice'` in the layout | 2 (read + clear) |
| `git diff --diff-filter=D --name-only` on all three commits | empty — no deletions |
| Phase 36 retag block still present (`retagDownloads` / `settings.retagDownloads` / `.flash`) | present, unchanged |

**Not verified (cannot be, here):** every on-device behaviour. `Capacitor.isNativePlatform()` is
`false` in this environment, so the entire import block — CTA, progress rail, permission notices,
summary, accordion — **was never rendered**. It type-checks, builds and is exercised by no test.
Nothing in this plan is a claim that the import page looks or behaves correctly on a handset; that
is device UAT, and it is the same gate Plan 34-07 flagged.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] `autocorrect` is not in Svelte's `<textarea>` attribute type**

- **Found during:** Task 2
- **Issue:** `pnpm check` failed with `'"autocorrect"' does not exist in type 'HTMLProps<"textarea">'`.
  Svelte's generated typings carry it for `<input>` but not for `<textarea>`. Dropping the attribute
  was not an option — UI-SPEC calls it out as a real iOS bug, not a nicety.
- **Fix:** `{...{ autocorrect: 'off' }}` spread on the textarea only. The attribute still reaches the
  DOM; the input keeps the plain form.
- **Commit:** `440e602`

### Deliberate departures from the plan text

**1. The settings-index row is NOT native-gated (UI-SPEC contract 7 / Task 3's `$derived`)**

- **Planned:** rename `groups` to `ALL_GROUPS`, add a `$derived` filter, and hide the Downloads row
  on web because "a disabled row that can never be enabled is a permanent lie in the navigation."
- **Actual:** the row is unchanged and visible everywhere; only the page body gates on native.
- **Why:** contract 7 was written when `/settings/downloads` did not exist. It now hosts Phase 36's
  retag control, which runs against `blobStore`/IndexedDB and **works on the web build**. Hiding the
  row on web would have made a shipped, working feature unreachable — the exact "orphan Phase 36's
  surface" outcome this plan was told to avoid. The contract's own rationale inverts: the row leads
  to something the web user can use, so showing it is the honest option. Contract 7's other half
  (the direct-URL fallback line) is honoured exactly — the import section renders
  `{t('import.webOnly')}` and makes no bridge call. Recorded as a comment above `groups`.

**2. The plan's `insert after playback, before data` step was a no-op**

The row was already in that exact position from Phase 36, with `settings.groupDownloads` /
`settings.groupDownloadsDesc`. Only the icon changed. Re-adding it would have produced a duplicate.

**3. `settings.groupDownloadsDesc` still reads "Tag downloaded files with metadata"**

It now under-describes a page that also imports. 34-05 deliberately did not overwrite Phase 36's
value, and rewording it across 15 locale dictionaries is an i18n change, not a UI one. Flagged for a
follow-up rather than smuggled in here.

### Acceptance-criterion notes (not code changes)

- `grep -n 'autocapitalize="off" autocorrect="off" spellcheck="false"'` returns **0 lines, not 2**.
  The criterion assumes all three attributes sit on one line; both fields are written multi-line
  (they carry 7-10 attributes each, and a single line would run past 300 characters). The intent
  holds: `grep -c autocapitalize='"off"'` = 2, `spellcheck="false"` = 2, `autocorrect` = 4 lines
  (2 attributes + 2 comment mentions).
- `grep -c "t('import\."` on the Task-1 commit was **20**, not the stated ≥ 16 — passes.
- Task 3's `grep -n "const groups = \$derived("` returns nothing, by the deliberate departure above.

## Assumption Drift (advisory)

**The plan assumed it was CREATING `/settings/downloads` and owned the settings-index row**

- **Planned:** `<action>` says "Create `src/routes/(app)/settings/downloads/+page.svelte`" and
  "insert `{ href: '/settings/downloads', … }`", and lists `min_lines: 200` for a new artifact.
  UI-SPEC contract 1 states plainly that the route "does not exist".
- **Actual:** both existed and were shipped by Phase 36 before this plan ran. Every Task-1 and
  Task-3 instruction had to be re-read as "merge into" rather than "write".
- **Why it matters:** the two phases were planned against snapshots taken at different times. Any
  later plan touching `/settings/downloads` should read the file on disk first rather than trusting
  a phase document's claim about what is there — this page now has two owners.

**Contract 7's web-gate rationale did not survive the merge**

- **Planned:** the whole route is native-only, so the row is a lie on web.
- **Actual:** the route is half native-only. A single boolean gate on the navigation entry can no
  longer express that; the gate had to move down a level, into the section that is actually
  native-only.
- **Why it matters:** if a third control lands on this page, the correct question is "is this row's
  page useful on web at all", not "is this feature native". The per-section gate is the pattern to
  copy.

## Known Stubs

None. Every control on the page reads and writes real store state. The accordion is collapsed by
default and its open state is deliberately not persisted (contract 2), which is a decision, not a
missing feature.

## Threat Flags

None new. The three mitigations this plan owned are closed:

- **T-34-21 (ReDoS via the preview)** — the preview derives from `deviceImport.rules.customPattern`
  (the saved, probe-passed value) against one 28-character constant. The draft string is never
  compiled outside `setCustomPattern`'s own validated path.
- **T-34-22 (XSS)** — `grep -c '{@html'` on the page is 0; every scan-derived value rendered here is
  a number.
- **T-34-23 (web build exposing a native-only route)** — accepted as specified: the route is in the
  web bundle, renders one line, and makes no bridge call. `deviceImport.load()` is
  `browser`-guarded inside the store and touches only localStorage.

No new network endpoint, auth path or schema.

## Notes for Future Phases

- **Device UAT is the remaining gate for the whole of Phase 34.** Nothing in the import path has been
  seen running: not the permission dialog, not the rail, not the summary. The Activity log
  (`import.permission` / `import.done` / `import.cancel`, written by 34-07) is the diagnostic to read
  on-device.
- `settings.groupDownloadsDesc` needs a reword across 15 locales now that the page does two things.
- If a third control joins this page, gate it per-section; the index row belongs to whichever control
  is the most broadly available.

## Self-Check: PASSED

- `src/routes/(app)/settings/downloads/+page.svelte` — FOUND (modified, 366 lines)
- `src/routes/(app)/settings/+page.svelte` — FOUND (modified)
- `src/routes/(app)/+layout.svelte` — FOUND (modified)
- Commit `4aca123` (feat, Task 1) — FOUND
- Commit `440e602` (feat, Task 2) — FOUND
- Commit `0fe77f3` (feat, Task 3) — FOUND
