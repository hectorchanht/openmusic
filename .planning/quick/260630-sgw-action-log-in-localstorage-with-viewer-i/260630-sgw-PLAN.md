---
quick_id: 260630-sgw
slug: action-log-in-localstorage-with-viewer-i
title: Action log (localStorage ring buffer) + verbose player instrumentation + Settings viewer
status: planned
created: 2026-06-30
files_modified:
  - src/lib/diagnostics/action-log-logic.ts (new — pure, node-testable)
  - src/lib/diagnostics/action-log-logic.test.ts (new)
  - src/lib/stores/actionLog.svelte.ts (new — runes singleton wrapper)
  - src/lib/stores/player.svelte.ts (instrument action points)
  - src/routes/(app)/settings/activity/+page.svelte (new — viewer)
  - src/routes/(app)/settings/+page.svelte (add Activity row)
  - src/lib/i18n/*.ts (15 locales — new keys, parity)
---

# Quick 260630-sgw — action log + Settings viewer

## Goal

A verbose, localStorage-backed action log so the player's behavior is observable (no more guessing).
Entry point: a new **Activity log** screen in Settings. ~2000-entry ring buffer. This is also the
diagnostic foundation for the next bug (background auto-advance stall).

User decisions (locked): **Settings only** entry point; **verbose, ~2000 entries**.

## Conventions to follow (do NOT deviate)

- localStorage key format is `openmusic:<name>:v1` (NOT the stale `pikachu-*` in CLAUDE.md). Use
  `openmusic:action-log:v1`.
- Established pattern: a PURE node-testable logic module under `src/lib/<domain>/` + a runes store
  wrapper under `src/lib/stores/<name>.svelte.ts` that imports `browser` from `$app/environment` and
  is SSR-guarded. Mirror `search-history-logic.ts` + `searchHistory.svelte.ts`.
- i18n: all 15 locale files (ar, de, en, es, fr, hi, id, it, pt, ru, th, tr, vi, zh-Hans, zh-Hant)
  must carry every new key (i18n.test.ts enforces parity). Use DOUBLE quotes in every locale file
  (project convention — no formatter enforces it). English is authoritative; other locales may carry
  the English string for these diagnostics-only labels (acceptable; parity is key-presence).
- Settings sub-pages live at `src/routes/(app)/settings/<name>/+page.svelte`; the index lists them in
  `groups[]`. Match the existing header/back/list/style idiom exactly.

## Tasks

### Task 1 — pure logic module `src/lib/diagnostics/action-log-logic.ts` (+ test)

- Export `ACTION_LOG_KEY = "openmusic:action-log:v1"`, `ACTION_LOG_CAP = 2000`.
- `type ActionLogEntry = { t: number; ev: string; d?: Record<string, unknown> }` (t = epoch ms).
- `parseActionLog(raw: string | null): ActionLogEntry[]` — safe parse, returns [] on null/corrupt.
- `appendEntry(entries, entry, cap = ACTION_LOG_CAP): ActionLogEntry[]` — push + slice to last `cap`
  (drop oldest). Pure, returns a new array.
- `serializeActionLog(entries): string` — JSON.stringify.
- Test: parse(null)=[]; parse(corrupt)=[]; append caps at cap (oldest dropped, newest kept);
  round-trip serialize→parse equality.

### Task 2 — runes store `src/lib/stores/actionLog.svelte.ts`

- Singleton class `ActionLog` with `entries = $state<ActionLogEntry[]>([])`, `private loaded`.
- `load()` — once, browser-only, hydrate from localStorage via parseActionLog.
- `log(ev: string, d?: Record<string, unknown>)` — build `{ t: Date.now(), ev, d }`, append via
  appendEntry, assign back to `entries` (reactive), and persist THROTTLED (~1s; also flush
  immediately on `clear()`); SSR-guarded (no-op when `!browser`). Wrap the persist write in try/catch
  so a quota error drops to "trim harder" (halve and retry once) and never throws into the player.
  Must be cheap + must NEVER throw — the player calls this on hot paths.
- `clear()` — empty entries + remove the localStorage key.
- Export `const actionLog = new ActionLog();` plus a bare `export function logAction(ev, d?)` that
  calls `actionLog.log(ev, d)` (so the player imports a tiny function, not the class).
- IMPORTANT: this store must NOT import the player (no cycle). The player imports IT.

### Task 3 — instrument `src/lib/stores/player.svelte.ts` (verbose, additive only)

Import `logAction`. Add concise log calls at these action points — DO NOT change any logic, DO NOT
log inside the `timeupdate` firehose:
- `play()` entry: `logAction("play", { uid, source, fresh: !!opts?.fresh })`.
- resolve outcome in play(): `logAction("resolve.ok"/"resolve.fail", { uid, source, hasUrl })`.
- `playing` listener: `logAction("playing", { uid })`.
- `pause` listener: `logAction("pause", { deliberate })` (the consumed flag).
- external-pause self-heal: `logAction("ext-resume.schedule", { uid, budget })` in
  scheduleExternalResume and `logAction("ext-resume.play", { uid })` when it re-issues play().
- `ended` listener: `logAction("ended", { uid })`.
- `next()` / `advanceTo`: `logAction("advance", { toUid })`; for a dead retry
  `logAction("retry-dead", { uid })`; when growing `logAction("grow.request")`.
- `ensureAhead` grow result: `logAction("grow.added", { count })`.
- mark-dead promote (markUnplayable/where a uid enters unplayableUids):
  `logAction("mark-dead", { uid })`.
- `error` listener: `logAction("audio.error", { uid, hasPlayed, reresolve })`.
- `runFallback` / cross-source: `logAction("fallback", { fromSource, toSource })`.
- visibilitychange (the existing attach() handler): `logAction("visibility", { hidden })` on change;
  `pageshow` persisted restore: `logAction("bfcache.restore")`.
Keep each call one line, payload small. These must be side-effect-free w.r.t. playback.

### Task 4 — viewer `src/routes/(app)/settings/activity/+page.svelte`

- Header with back button to `/settings` (mirror other settings pages), `t("settings.activityHeading")`.
- `onMount(() => actionLog.load())`. Render `actionLog.entries` NEWEST-FIRST: each row shows a
  formatted time (HH:MM:SS.mmm), the `ev`, and `d` as compact JSON. Reactive — live-updates as the
  player logs.
- Buttons: **Copy** (copy the whole log as text/JSON to clipboard → toast `settings.activityCopied`),
  **Clear** (`actionLog.clear()`). Empty state: `t("settings.activityEmpty")`.
- Style consistent with the other settings sub-pages (reuse the surface/border tokens). The list must
  scroll inside its own container; rows monospaced for readability.

### Task 5 — Settings index row + i18n keys

- In `src/routes/(app)/settings/+page.svelte` add a row before About:
  `{ href: "/settings/activity", icon: ScrollText, title: "settings.groupActivity", desc: "settings.groupActivityDesc" }`
  (import `ScrollText` — or `Activity` — from `@lucide/svelte`).
- Add keys to ALL 15 locales (double quotes): `settings.groupActivity`, `settings.groupActivityDesc`,
  `settings.activityHeading`, `settings.activityEmpty`, `settings.activityClear`, `settings.activityCopy`,
  `settings.activityCopied`. English authoritative.

## Verify

- `npx vitest run src/lib/diagnostics/action-log-logic.test.ts` — green.
- `npx vitest run src/lib/i18n/i18n.test.ts` — parity green (all new keys in all locales).
- `npx vitest run src/lib/stores/player.svelte.test.ts` — still green (instrumentation is additive).
- `npx vitest run` — full suite green.
- `npx svelte-check --threshold error` — 0 errors / 0 warnings.

## Done

Verbose player actions are recorded to a ~2000-entry localStorage ring buffer, viewable + copyable +
clearable from Settings → Activity log. Logging never throws and never alters playback. Tests +
typecheck green; atomic commits on main (non-worktree).
