---
quick_id: 260630-sgw
slug: action-log-in-localstorage-with-viewer-i
title: Action log (localStorage ring buffer) + verbose player instrumentation + Settings viewer
status: complete
created: 2026-06-30
completed: 2026-06-30
tasks_completed: 5
tasks_total: 5
files_changed:
  - src/lib/diagnostics/action-log-logic.ts (new — pure, node-testable)
  - src/lib/diagnostics/action-log-logic.test.ts (new — 9 tests)
  - src/lib/stores/actionLog.svelte.ts (new — runes singleton + bare logAction)
  - src/lib/stores/player.svelte.ts (instrumented — additive log calls only)
  - src/routes/(app)/settings/activity/+page.svelte (new — viewer)
  - src/routes/(app)/settings/+page.svelte (Activity row added)
  - src/lib/i18n/{en,ar,de,es,fr,hi,id,it,pt,ru,th,tr,vi,zh-Hans,zh-Hant}.ts (7 new keys × 15 locales)
commits:
  - fd5379c feat(quick-260630-sgw-01) pure logic + tests
  - b0652ae feat(quick-260630-sgw-02) runes store + logAction
  - 0302d3b feat(quick-260630-sgw-03) player instrumentation
  - c1902bf feat(quick-260630-sgw-05) settings row + i18n (15 locales)
  - 4ec4dd2 feat(quick-260630-sgw-04) activity viewer
---

# Quick 260630-sgw — action log + Settings viewer (Summary)

A verbose, localStorage-backed action log so the player's behaviour is observable instead of
guessed. New **Settings → Activity log** screen renders a live, copyable, clearable ~2000-entry ring
buffer. This is the diagnostic foundation for the next bug (background auto-advance stall).

## What shipped

**Task 1 — pure logic module** (`src/lib/diagnostics/action-log-logic.ts`):
`ACTION_LOG_KEY = "openmusic:action-log:v1"`, `ACTION_LOG_CAP = 2000`, `ActionLogEntry { t, ev, d? }`,
plus pure `parseActionLog` (safe, per-entry shape validation), `appendEntry` (pure, capped — drops
oldest), `serializeActionLog`. 9 unit tests cover null/corrupt/non-array parse, malformed-entry drop,
cap-drop-oldest (custom + default cap), and serialize→parse round-trip.

**Task 2 — runes store** (`src/lib/stores/actionLog.svelte.ts`):
SSR-guarded `ActionLog` singleton wrapping the logic module. Reactive `entries`; `load()` hydrates
once in the browser; `log(ev, d?)` builds the entry, appends via the pure helper, reassigns `entries`,
and persists THROTTLED (~1s — bursts coalesce into one write). `clear()` empties + removes the key and
flushes immediately. The persist write is wrapped in try/catch with a quota fallback (halve the buffer,
retry once, then give up silently); `log()` itself is wrapped so it NEVER throws on the player's hot
path. Exports the `actionLog` instance plus a bare `logAction(ev, d?)` so the player imports a tiny
function, not the class — and the store does NOT import the player (no cycle).

**Task 3 — player instrumentation** (`src/lib/stores/player.svelte.ts`):
Imported `logAction`; added 16 ADDITIVE one-line log calls at the planned action points with NO logic
change and NONE inside the `timeupdate` firehose:
`play` (entry), `resolve.ok`/`resolve.fail`, `playing`, `pause` (deliberate flag), `ended`,
`audio.error` (uid/hasPlayed/reresolve), `ext-resume.schedule` + `ext-resume.play`, `advance`,
`retry-dead`, `grow.request`, `grow.added` (count), `mark-dead` (at the strike→promote point),
`fallback` (fromSource→toSource), `visibility` (hidden), `bfcache.restore`.

**Task 4 — viewer** (`src/routes/(app)/settings/activity/+page.svelte`):
`onMount(actionLog.load)`; renders entries NEWEST-FIRST (store keeps oldest-first for cheap
append/cap, the page `.reverse()`s a copy in a `$derived`). Each monospaced row shows
`HH:MM:SS.mmm` local time, the `ev`, and `d` as compact JSON, in its own scroll container — reactive,
so it live-updates as the player logs. Copy button writes the JSON to the clipboard → flash
`settings.activityCopied`; Clear button calls `actionLog.clear()`; empty state shows
`settings.activityEmpty`. Header/back/style mirror the other settings sub-pages.

**Task 5 — settings index row + i18n**:
Added an Activity row (`ScrollText` icon) before About in the settings index. Added 7 keys
(`settings.groupActivity`, `groupActivityDesc`, `activityHeading`, `activityEmpty`, `activityClear`,
`activityCopy`, `activityCopied`) to ALL 15 locale files using double quotes — English authoritative,
the 12 world locales carry the English diagnostics strings, zh-Hans/zh-Hant translated. The i18n
parity test enforces key-presence across all locales.

## Verification (all green)

| Check | Result |
| --- | --- |
| `npx vitest run src/lib/diagnostics/action-log-logic.test.ts` | 1 file, 9 tests passed |
| `npx vitest run src/lib/i18n/i18n.test.ts` | 1 file, 12 tests passed |
| `npx vitest run src/lib/stores/player.svelte.test.ts` | 1 file, 154 tests passed (instrumentation additive) |
| `npx vitest run` (full suite) | 67 files, 987 tests passed |
| `npx svelte-check --threshold error` | 0 errors / 0 warnings (4296 files) |

## Deviations from Plan

None — plan executed exactly as written. (The viewer page was committed AFTER the i18n/index commit
so each commit independently typechecks, since the new keys define the `TranslationKey` type that the
viewer references — a commit-ordering choice, not a content deviation.)

## Authentication gates

None.

## Known Stubs

None. The action log is a real, persisted, reactive store wired end-to-end (player → store →
localStorage → viewer).

## Self-Check: PASSED

- src/lib/diagnostics/action-log-logic.ts — FOUND
- src/lib/diagnostics/action-log-logic.test.ts — FOUND
- src/lib/stores/actionLog.svelte.ts — FOUND
- src/routes/(app)/settings/activity/+page.svelte — FOUND
- Commits fd5379c, b0652ae, 0302d3b, c1902bf, 4ec4dd2 — all FOUND in git log
