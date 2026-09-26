---
phase: quick-260926-mis
plan: 01
type: execute
wave: 1
depends_on: []
files_modified:
  - src/lib/services/lrc.ts
  - src/lib/services/lrc.test.ts
  - src/lib/stores/lyric-offset.svelte.ts
  - src/lib/stores/lyric-offset.svelte.test.ts
  - src/lib/components/NpLyrics.svelte
  - src/lib/components/Nowbar.svelte
  - src/lib/i18n/en.ts
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
  - src/lib/i18n/zh-Hans.ts
  - src/lib/i18n/zh-Hant.ts
autonomous: true
requirements: [QUICK-260926-mis]

must_haves:
  truths:
    - "Long-pressing a lyric line in the NowPlaying lyrics pane makes THAT line the active (highlighted) one right now, and the highlight stays realigned for the rest of the song — the offset = player.currentTime - line.time is stored for this song's uid"
    - "The offset is per song (keyed by track uid): a live version and its studio version keep independent offsets, and the offset survives a reload (localStorage openmusic:lyric-offset:v1, only non-zero values stored)"
    - "The Nowbar mini-player lyric line honours the same offset as the pane (both call activeLineAt with the same offsetSec)"
    - "Tap-to-seek on a lyric line lands at line.time + offset (never below 0) so a realigned line seeks to where it is actually sung"
    - "A quiet control row above the lyrics shows the actual current offset for this song (e.g. '+0.0s', '−2.3s') with −0.5s / +0.5s nudge buttons; tapping the readout resets to 0; a hint says to hold a line to sync it. Row exists only when lyrics exist"
    - "Offset changes repaint the highlight synchronously (a $state version bump, NOT a rAF-deferred one); offsets clamp to ±600s and round to 0.1s"
    - "A long-press does NOT also fire the line's tap-to-seek (longpress trailing-click guard)"
    - "Every locale dictionary exposes the four new lyrics.offset* keys (i18n.test.ts parity passes); pnpm test + pnpm check pass"
  artifacts:
    - path: "src/lib/services/lrc.ts"
      provides: "normalizeLyricOffset, formatLyricOffset; activeLineAt + lineSeekFraction take optional offsetSec"
      contains: "normalizeLyricOffset"
    - path: "src/lib/stores/lyric-offset.svelte.ts"
      provides: "getLyricOffset(uid) reactive read + setLyricOffset(uid, sec) write with sync version bump, localStorage openmusic:lyric-offset:v1"
      contains: "openmusic:lyric-offset:v1"
    - path: "src/lib/stores/lyric-offset.svelte.test.ts"
      provides: "node test of the store over a MemStorage stub"
      min_lines: 30
    - path: "src/lib/components/NpLyrics.svelte"
      provides: "use:longpress sync gesture, offset-aware active line + seek, .sync control row"
      contains: "getLyricOffset"
    - path: "src/lib/components/Nowbar.svelte"
      provides: "Nowbar lyric line honours the offset"
      contains: "getLyricOffset"
  key_links:
    - from: "src/lib/components/NpLyrics.svelte"
      to: "src/lib/services/lrc.ts"
      via: "activeLineAt(lines, player.currentTime, lyricOffset) and lineSeekFraction(line.time, player.duration, lyricOffset)"
      pattern: "activeLineAt\\(lines, player\\.currentTime, lyricOffset\\)"
    - from: "src/lib/components/NpLyrics.svelte"
      to: "src/lib/stores/lyric-offset.svelte.ts"
      via: "setLyricOffset(uid, player.currentTime - line.time) from the longpress handler"
      pattern: "setLyricOffset\\("
    - from: "src/lib/components/Nowbar.svelte"
      to: "src/lib/services/lrc.ts"
      via: "activeLineAt(lyricLines, player.currentTime, lyricOffset)"
      pattern: "activeLineAt\\(lyricLines, player\\.currentTime, lyricOffset\\)"
---

<objective>
Per-song lyric TIME realignment. A live recording (talking intro, different start) has LRC timestamps that do not match the audio; the user realigns them by holding the lyric line that is being sung right now ("sync to this line"), then optionally nudging ±0.5s from a quiet control row that shows the actual current offset. The offset is stored per track uid and applied everywhere the active line is computed (pane highlight, Nowbar line, tap-to-seek).

User's own words: "also add lyrics realign in time as a live can have different start time, allow user to realign lyrics"

Purpose: lyrics that drift from the audio are useless; one hold on the right line fixes a whole live set.
Output: two pure helpers + optional `offsetSec` on `activeLineAt` / `lineSeekFraction` (lrc.ts, tested); a tiny reactive per-uid offset store (tested); NpLyrics longpress-to-sync + control row; Nowbar one-line change; four i18n keys in all 15 locales.

Skipped on purpose (YAGNI — do NOT add): resetting the offset when the user picks different lyrics in the Fix-lyrics picker; cross-device sync of offsets; a Settings-page list of offsets; an entry cap on the record (values are 8-byte numbers, not LRC text — quota is not a concern the way it was for lyric-pins).
</objective>

<execution_context>
@/Users/laichan/.claude/plugins/cache/gsd-plugin/gsd/4.5.3/workflows/execute-plan.md
@/Users/laichan/.claude/plugins/cache/gsd-plugin/gsd/4.5.3/templates/summary.md
</execution_context>

<context>
@./CLAUDE.md
@src/lib/services/lrc.ts
@src/lib/services/lrc.test.ts
@src/lib/stores/lyric-pins.svelte.ts
@src/lib/stores/lyric-pins.svelte.test.ts
@src/lib/components/NpLyrics.svelte
@src/lib/components/Nowbar.svelte
@src/lib/actions/longpress.ts
@src/lib/util/haptics.ts
@src/lib/i18n/en.ts

<interfaces>
<!-- Extracted from the codebase. Use directly — no exploration needed. -->

From src/lib/services/lrc.ts — CURRENT signatures, to be extended (add a trailing optional param; every existing call/test stays valid):
```typescript
export interface LyricLine { time: number; text: string; fromParen?: boolean }
export function lineSeekFraction(time: number, duration: number): number | null
//   returns duration > 0 && Number.isFinite(duration) ? time / duration : null
export function activeLineAt(lines: LyricLine[], now: number): { idx: number; time: number }
//   forward scan; idx = FIRST entry of the same-timestamp group whose time <= now; {-1,-1} before first
```

From src/lib/stores/lyric-pins.svelte.ts — the reactive-wrapper idiom to COPY (minus the rAF deferral):
```typescript
const _v = $state({ n: 0 });                 // module-scoped version counter in a $state object
export function lyricVersion(): number { return _v.n; }   // CALL inside a $derived to take the dependency
export function readLyrics(track: Track | null | undefined): string | null  // reads _v.n, then the pure store
```
Its pure store (services/lyric-pins.ts) does `localStorage.getItem` inside try/catch and returns {} on absent / corrupt / unavailable — that try/catch IS the browser guard (no `$app/environment` import, so the file is node-testable with a MemStorage stub — see lyric-pins.svelte.test.ts lines 16-30 for the stub class and the `Object.defineProperty(globalThis, 'localStorage', { value: store, configurable: true, writable: true })` beforeEach idiom).

From src/lib/actions/longpress.ts:
```typescript
export const longpress: Action<HTMLElement, number | undefined, { onlongpress: (e: CustomEvent) => void }>
// usage: <el use:longpress onlongpress={() => ...}>  — fires after ~450ms hold, cancels on >8px move,
// suppresses contextmenu, and EATS the trailing native click (document capture-phase, one-shot) so the
// element's onclick does not also fire. Nothing else needed to keep tap-to-seek from firing on a hold.
```

From src/lib/util/haptics.ts: `export function tick(): void` — ~15ms vibrate, never throws, no-op on iOS.

From src/lib/i18n/index.ts: `export function t(key: TranslationKey, params?: Record<string, string | number>): string` — `{value}` tokens are interpolated from params.

From src/lib/stores/player.svelte.ts (public $state read by both components): `player.current: Track | null` (`.uid` string), `player.currentTime: number`, `player.duration: number`, `player.seekFraction(frac: number)` (clamps frac to [0,1] internally).

From src/lib/components/NpLyrics.svelte (current, verbatim):
```typescript
import { reorderPairs, splitParenLines, lineSeekFraction, activeLineAt, lyricAnchorMetrics, type LyricLine } from '$lib/services/lrc';
const active = $derived(activeLineAt(lines, player.currentTime));          // ~line 76
function seekToLine(line: LyricLine) {                                      // ~line 158
	const frac = lineSeekFraction(line.time, player.duration);
	if (frac !== null) player.seekFraction(frac); // D-03: auto-plays if paused
	if (idleTimer) clearTimeout(idleTimer);
	autoScroll = true;
}
// template ~line 396:
<p data-i={i} class:active={l.time === activeTime && activeTime >= 0} class:paren={l.fromParen} onclick={() => seekToLine(l)} onkeydown={(e) => seekToLineKey(e, l)} role="button" tabindex="0">
// The template's `{#if lines.length}` block renders `{#if translating}<p class="tr-hint">…` THEN `<div class="lyrics" …>`.
// `.lyrics` carries onpointerdown={lyricsTouched} (pauses autoScroll) — a sibling ABOVE it does not.
```

From src/lib/components/Nowbar.svelte (current, ~line 82 and ~line 120; NOTE this file uses 4-space indent + double quotes — match it):
```typescript
const lyricLines = $derived(parseLyrics(readLyrics(player.current)));
// inside lyricText $derived.by:
const { idx } = activeLineAt(lyricLines, player.currentTime);
```
</interfaces>
</context>

<tasks>

<task type="auto" tdd="true">
  <name>Task 1: Pure offset maths in lrc.ts + the reactive per-uid offset store</name>
  <files>src/lib/services/lrc.ts, src/lib/services/lrc.test.ts, src/lib/stores/lyric-offset.svelte.ts, src/lib/stores/lyric-offset.svelte.test.ts</files>
  <behavior>
    lrc.test.ts (new describes, existing tests untouched):
    - normalizeLyricOffset: NaN / Infinity / -Infinity → 0; 2.34 → 2.3; 2.35 → 2.4 (round half up via Math.round(n*10)/10); -0.04 → 0 (NOT -0: assert with Object.is(result, 0)); 9999 → 600; -9999 → -600; 0 → 0.
    - formatLyricOffset: 0 → "+0.0s"; 1.5 → "+1.5s"; -2.3 → "−2.3s" (U+2212 MINUS SIGN, not hyphen); 12 → "+12.0s".
    - activeLineAt with offsetSec: lines [L(5,'a'), L(10,'b')]: (now 7, offset 3) → lyric clock 4 → { idx:-1, time:-1 }; (now 7, offset -3) → clock 10 → { idx:1, time:10 }; (now 7) with offset omitted → identical to today ({ idx:0, time:5 }).
    - lineSeekFraction with offsetSec: (5, 100, 3) → 0.08; (5, 100, -10) → 0 (floored at 0, never negative); (5, 100) omitted → 0.05; (5, 0, 3) → null (duration guard still first).
    lyric-offset.svelte.test.ts (MemStorage stub, same beforeEach/afterEach as lyric-pins.svelte.test.ts):
    - getLyricOffset('netease:1') is 0 when nothing stored; getLyricOffset('') and getLyricOffset(undefined) are 0.
    - setLyricOffset('netease:1', 2.34) then getLyricOffset('netease:1') → 2.3, and the raw JSON at openmusic:lyric-offset:v1 is {"netease:1":2.3}.
    - setLyricOffset('netease:1', 0) DELETES the key (raw JSON becomes {}); setting NaN behaves as 0 (key absent).
    - two uids are independent (a live and a studio uid keep separate values).
    - corrupt JSON planted at the key → getLyricOffset returns 0 and a subsequent set overwrites cleanly; a stored non-number value (e.g. "abc") reads as 0.
    - setLyricOffset bumps lyricOffsetVersion() synchronously by exactly 1 per call (no rAF, no coalescing) — assert before/after.
    - setLyricOffset('', 3) is a no-op (no write, no bump).
  </behavior>
  <action>
    In `src/lib/services/lrc.ts` (tabs, single quotes), add two exported pure functions and one optional trailing parameter on two existing functions. Tag every addition with a `quick-260926-mis` comment explaining the SIGN CONVENTION once: `offsetSec` positive = lyrics shifted LATER (the audio has extra intro), so the lyric clock is `now - offsetSec` and a line is sung at `line.time + offsetSec`.

    - `export const LYRIC_OFFSET_MAX = 600;` (seconds, ±10 min — a sane bound that also caps a tampered localStorage value).
    - `normalizeLyricOffset(n: number): number` — non-finite → 0; clamp to [-LYRIC_OFFSET_MAX, LYRIC_OFFSET_MAX]; round to 0.1 via `Math.round(n * 10) / 10`; fold -0 to 0 (`|| 0`).
    - `formatLyricOffset(sec: number): string` — `(sec < 0 ? '−' : '+') + Math.abs(sec).toFixed(1) + 's'`.
    - `activeLineAt(lines, now, offsetSec = 0)` — the ONLY change is scanning against `now - offsetSec` (keep the GROUP CONTRACT comment and body otherwise verbatim). This puts the sign convention in ONE tested place instead of two `now - off` call sites that could drift.
    - `lineSeekFraction(time, duration, offsetSec = 0)` — keep the duration guard first; numerator becomes `Math.max(0, time + offsetSec)` so a negative target never leaves this function.

    Create `src/lib/stores/lyric-offset.svelte.ts` — a runes store in the lyric-pins.svelte.ts idiom but with NO separate pure `.ts` (the whole thing is ~40 lines; the pure record read/write stays inside this file, guarded by try/catch exactly like services/lyric-pins.ts so it is node-testable and needs no `$app/environment` import). Header comment: quick-260926-mis, per-uid (NOT name-keyed — a live and a studio version are different uids and MUST realign independently), value = seconds, only non-zero stored, and WHY the bump is synchronous (the anchor + highlight must repaint on the same tick; the verification browser has frozen rAF; rAF coalescing buys nothing for a write that happens on a user gesture).
    - `const KEY = 'openmusic:lyric-offset:v1';` record shape `Record<string, number>` (uid → seconds).
    - `const _v = $state({ n: 0 }); export function lyricOffsetVersion(): number { return _v.n; }`
    - module-private `readRec(): Record<string, number>` — `localStorage.getItem(KEY)` + JSON.parse inside try/catch; return `{}` on absent / corrupt / non-object / unavailable.
    - `export function getLyricOffset(uid: string | null | undefined): number` — reads `_v.n` first (reactive dependency), returns 0 for an empty uid, else `normalizeLyricOffset(typeof v === 'number' ? v : 0)` for `readRec()[uid]` (normalize on READ so a tampered stored value is clamped without a migration).
    - `export function setLyricOffset(uid: string, sec: number): void` — no-op on empty uid; `const n = normalizeLyricOffset(sec)`; read the record, `if (n === 0) delete rec[uid]; else rec[uid] = n;`, `localStorage.setItem(KEY, JSON.stringify(rec))` inside try/catch (quota / unavailable = non-fatal, the offset simply does not persist); then `_v.n++` SYNCHRONOUSLY, unconditionally, after the try/catch (readers re-read storage, so a failed write correctly shows the old value).
    - Import `normalizeLyricOffset` from `$lib/services/lrc`.

    Write the tests in the `<behavior>` block. lrc.test.ts: add `normalizeLyricOffset`, `formatLyricOffset` to the existing import and three new `describe`s (plus the two offset cases inside the existing `activeLineAt` / `lineSeekFraction` describes). lyric-offset.svelte.test.ts: copy the MemStorage class + the `Object.defineProperty(globalThis, 'localStorage', …)` beforeEach / restore afterEach from lyric-pins.svelte.test.ts verbatim; import `{ getLyricOffset, setLyricOffset, lyricOffsetVersion }` from './lyric-offset.svelte'.
  </action>
  <verify>
    <automated>cd /Users/laichan/code/tung/openmusic && pnpm vitest run src/lib/services/lrc.test.ts src/lib/stores/lyric-offset.svelte.test.ts && pnpm check</automated>
  </verify>
  <done>Both test files green (all pre-existing lrc tests still pass with the optional params defaulting to 0); `pnpm check` 0 errors; `grep -c "openmusic:lyric-offset:v1" src/lib/stores/lyric-offset.svelte.ts` ≥ 1.</done>
</task>

<task type="auto">
  <name>Task 2: Four i18n keys in all 15 locales</name>
  <files>src/lib/i18n/en.ts, src/lib/i18n/ar.ts, src/lib/i18n/de.ts, src/lib/i18n/es.ts, src/lib/i18n/fr.ts, src/lib/i18n/hi.ts, src/lib/i18n/id.ts, src/lib/i18n/it.ts, src/lib/i18n/pt.ts, src/lib/i18n/ru.ts, src/lib/i18n/th.ts, src/lib/i18n/tr.ts, src/lib/i18n/vi.ts, src/lib/i18n/zh-Hans.ts, src/lib/i18n/zh-Hant.ts</files>
  <action>
    Add these four keys to EVERY locale file (DOUBLE quotes for key and value — the i18n house convention, no formatter enforces it; place them directly after `"nowplaying.noLyrics"` in each file so the block is easy to find). `en` is the reference; translate the others faithfully (the m72 commit 37dace4f shows the exact same 15-file pattern):
    - `"lyrics.offsetHint": "Hold a line to sync it to now"`
    - `"lyrics.offsetEarlier": "Lyrics 0.5s earlier"`   (aria-label of the −0.5s button)
    - `"lyrics.offsetLater": "Lyrics 0.5s later"`       (aria-label of the +0.5s button)
    - `"lyrics.offsetReset": "Lyrics timing {value}. Tap to reset"`   (aria-label of the readout button; `{value}` is the formatted offset — keep the token verbatim in every locale)
    Do not touch any other key. i18n.test.ts asserts the key set of every locale equals `en`, so a missed file fails the suite.
  </action>
  <verify>
    <automated>cd /Users/laichan/code/tung/openmusic && pnpm vitest run src/lib/i18n/i18n.test.ts && for f in src/lib/i18n/{en,ar,de,es,fr,hi,id,it,pt,ru,th,tr,vi,zh-Hans,zh-Hant}.ts; do test "$(grep -c '"lyrics.offset' "$f")" -eq 4 || { echo "MISSING in $f"; exit 1; }; done && pnpm check</automated>
  </verify>
  <done>Every one of the 15 locale files contains exactly the four `lyrics.offset*` keys; i18n parity test passes; `pnpm check` 0 errors.</done>
</task>

<task type="auto">
  <name>Task 3: Wire the offset into NpLyrics (hold-to-sync, control row, seek) and the Nowbar line</name>
  <files>src/lib/components/NpLyrics.svelte, src/lib/components/Nowbar.svelte</files>
  <action>
    **NpLyrics.svelte** (tabs, single quotes; every edit tagged `quick-260926-mis`):
    1. Imports: add `formatLyricOffset` to the existing `$lib/services/lrc` import; `import { getLyricOffset, setLyricOffset } from '$lib/stores/lyric-offset.svelte';`, `import { longpress } from '$lib/actions/longpress';`, `import { tick } from '$lib/util/haptics';`.
    2. Below the `lines` derived: `const lyricOffset = $derived(getLyricOffset(player.current?.uid));` — a $derived so the localStorage read happens once per track change / offset write, NOT per timeupdate. Change `const active = $derived(activeLineAt(lines, player.currentTime));` to pass `lyricOffset` as the third arg. `activeLine` / `activeTime` and every downstream consumer (anchor $effect, sibling-active test) are untouched — `activeLineAt` still returns the line's OWN time.
    3. `seekToLine`: pass `lyricOffset` as the third arg to `lineSeekFraction` (comment: a realigned line seeks to where it is actually sung).
    4. New handlers (keep `autoScroll` / `idleTimer` handling identical to seekToLine so the anchor $effect re-centres the now-active line immediately):
       - `syncToLine(line: LyricLine)` — `const uid = player.current?.uid; if (!uid) return; setLyricOffset(uid, player.currentTime - line.time); tick(); if (idleTimer) clearTimeout(idleTimer); autoScroll = true;` Comment WHY: one hold beats dozens of ±0.5s taps for a live intro of 20-40s; the sign is derived from the lrc.ts convention (`currentTime - offset === line.time` ⇒ this line is active now).
       - `nudgeOffset(delta: number)` — `if (uid) setLyricOffset(uid, lyricOffset + delta)`.
       - `resetOffset()` — `if (uid) setLyricOffset(uid, 0)`.
    5. Template: on the lyric `<p data-i={i} …>` add `use:longpress onlongpress={() => syncToLine(l)}`. The action's trailing-click guard already eats the click so `seekToLine` does NOT also fire; do not add any extra guard. The `.sheet` ancestor already has `user-select: none`, so a hold does not start a text selection — add nothing for that.
    6. Control row: inside `{#if lines.length}`, BEFORE the `{#if translating}` hint and OUTSIDE `.lyrics` (so it does not sit inside the padding the anchor pass writes, and does not receive `.lyrics`' `onpointerdown={lyricsTouched}` — taps on it never pause auto-scroll). Markup:
       `<div class="sync"><button type="button" onclick={() => nudgeOffset(-0.5)} aria-label={t('lyrics.offsetEarlier')}>−0.5s</button><button type="button" class="readout" onclick={resetOffset} aria-label={t('lyrics.offsetReset', { value: formatLyricOffset(lyricOffset) })}>{formatLyricOffset(lyricOffset)}</button><button type="button" onclick={() => nudgeOffset(0.5)} aria-label={t('lyrics.offsetLater')}>+0.5s</button><span class="hint">{t('lyrics.offsetHint')}</span></div>`
       Use the literal U+2212 minus in the −0.5s label to match `formatLyricOffset`.
    7. CSS (append to the `<style>` block): `.sync { position: sticky; top: 0; z-index: 1; display: flex; align-items: center; justify-content: center; gap: 8px; padding: 4px 0 6px; font-size: 0.6875rem; color: var(--color-text-muted); background: var(--color-bg); }` `.sync button { background: none; border: 1px solid var(--color-text-muted); border-radius: 999px; color: inherit; font: inherit; padding: 2px 8px; min-width: 44px; min-height: 24px; }` `.sync .readout { font-variant-numeric: tabular-nums; border-style: dashed; }` `.sync .hint { flex-basis: 100%; text-align: center; font-size: 0.625rem; opacity: 0.7; }` plus `flex-wrap: wrap` on `.sync` so the hint wraps to a second line. Sticky-top keeps the readout visible while the user nudges after scrolling; it is in normal flow so the head/tail padding maths in `anchorActiveLine` are unaffected (a sibling above `.lyrics` shifts every line by the same amount, and `offsetWithin` is measured from live rects, so the scroll target is still exact). If the pane background token renders wrong over the blurred cover, use the token `.panel` actually paints (grep `--color-` in NowPlaying.svelte `.sheet`/`.panel` rules) — do not leave it transparent, the row must stay legible over scrolling lyrics.
    8. Leave `anchorActiveLine` and its `$effect` untouched — it still writes NO $state (the self-invalidating-effect class that froze the app before must not recur). The only new reactive write paths are the three user-gesture handlers.

    **Nowbar.svelte** (4-space indent, DOUBLE quotes — match the file): `import { getLyricOffset } from "$lib/stores/lyric-offset.svelte";` add `const lyricOffset = $derived(getLyricOffset(player.current?.uid));` next to `lyricLines`, and change the scan inside `lyricText` to `activeLineAt(lyricLines, player.currentTime, lyricOffset)`. One-line comment: quick-260926-mis — same offset as the pane, same function, so the two surfaces cannot drift.

    Then smoke it in the browser (dev server on 4321 or 5173 — probe, do not assume): play any song with synced lyrics, open the lyrics pane, hold a line ~1s: the highlight jumps to that line, the readout shows a non-zero value, and the line's onclick did NOT seek (the audio position did not jump). Tap −0.5s / +0.5s and watch the readout; tap the readout to reset to +0.0s. Confirm the Nowbar lyric line (Settings → nowbar lyrics on) shows the same line as the pane. Reload — the offset for that song survives; a different song reads +0.0s.
  </action>
  <verify>
    <automated>cd /Users/laichan/code/tung/openmusic && pnpm test && pnpm check && grep -c "activeLineAt(lines, player.currentTime, lyricOffset)" src/lib/components/NpLyrics.svelte && grep -c "activeLineAt(lyricLines, player.currentTime, lyricOffset)" src/lib/components/Nowbar.svelte && grep -c "use:longpress" src/lib/components/NpLyrics.svelte</automated>
  </verify>
  <done>`pnpm test` and `pnpm check` pass; holding a lyric line realigns the highlight to that line and stores a per-uid offset that survives reload; the control row shows the live offset with working ±0.5s and reset; tap-to-seek lands at line.time + offset; the Nowbar line matches the pane; a hold does not trigger a seek.</done>
</task>

</tasks>

<threat_model>
## Trust Boundaries

| Boundary | Description |
|----------|-------------|
| localStorage -> lyric-offset store | `openmusic:lyric-offset:v1` is user/extension-writable; a stored value is untrusted input |
| user gesture -> seek | offset feeds `player.seekFraction` via `lineSeekFraction` |

## STRIDE Threat Register

| Threat ID | Category | Component | Disposition | Mitigation Plan |
|-----------|----------|-----------|-------------|-----------------|
| T-mis-01 | Tampering | lyric-offset.svelte.ts getLyricOffset | mitigate | `normalizeLyricOffset` on READ (non-finite → 0, clamp ±600, round 0.1) and on WRITE; non-number / corrupt JSON → 0. Task 1 tests pin all three |
| T-mis-02 | Tampering | lineSeekFraction / seekFraction | mitigate | numerator floored at 0 in `lineSeekFraction`; `seekFraction` already clamps [0,1] — a hostile offset can only move the seek inside the track |
| T-mis-03 | DoS | NpLyrics anchor $effect | mitigate | the $effect is not edited and still writes no $state; the new writes happen only in user-gesture handlers, so the self-invalidating-effect loop class cannot recur |
| T-mis-04 | DoS | localStorage quota | accept | record is uid → 8-byte number; a write failure is swallowed (non-fatal) exactly like lyric-pins |
| T-mis-SC | Tampering | npm installs | accept | no packages installed by this plan |
</threat_model>

<verification>
- `pnpm test` green (lrc, lyric-offset, i18n parity, everything else untouched).
- `pnpm check` 0 errors.
- Browser smoke per Task 3: hold-to-sync realigns, ±0.5s nudges, readout resets, Nowbar matches, reload persists per song, hold does not seek.
</verification>

<success_criteria>
- Per-song (uid-keyed) lyric timing offset, persisted only when non-zero at `openmusic:lyric-offset:v1`, clamped ±600s, 0.1s resolution.
- Long-press a lyric line = that line is active now (offset = currentTime − line.time) with a haptic tick; no accompanying seek.
- Quiet sticky control row: −0.5s / live readout (tap = reset) / +0.5s + hint, only when lyrics exist, outside `.lyrics` padding flow, does not pause auto-scroll.
- Offset applied in all three places: pane highlight, Nowbar line, tap-to-seek — all through `activeLineAt` / `lineSeekFraction`'s single tested sign convention.
- Synchronous reactive repaint (no rAF dependency).
- Four i18n keys in all 15 locales; all tests + svelte-check pass.
</success_criteria>

<output>
Create `.planning/quick/260926-mis-per-song-lyrics-time-realign-offset-for-/260926-mis-SUMMARY.md` when done
</output>
