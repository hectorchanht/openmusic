---
phase: quick-260926-qat
plan: 01
type: execute
wave: 1
depends_on: []
files_modified:
  - src/lib/stores/lyric-offset.svelte.ts
  - src/lib/stores/lyric-offset.svelte.test.ts
  - src/lib/components/NpLyrics.svelte
  - src/lib/components/TrackMenu.svelte
  - src/lib/components/NowPlaying.svelte
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
requirements: [QUICK-260926-QAT]
must_haves:
  truths:
    - "A fresh app start shows the lyrics pane with NO -0.5s / readout / +0.5s row; the lyrics are still time-shifted by the local or listeners' offset exactly as before"
    - "The track menu (⋮) for the CURRENTLY PLAYING track that has lyrics shows an 'Adjust lyrics timing' row right after 'Fix lyrics'; a menu for a different track, or a current track with no lyrics, has no such row"
    - "Tapping that row closes the menu, shows the timing row at the top of the lyrics pane, and on the narrow layout switches Now Playing to the Lyrics tab if it was on another tab; on the wide (>=1280px) layout nothing but the row appears"
    - "While the row is shown the menu row reads 'Hide lyrics timing' (highlighted); tapping it, or the ✕ in the row, hides the row again; the row also stays open across track changes until hidden"
    - "Holding a lyric line realigns the lyrics ONLY while the row is shown; with the row hidden a hold does nothing and a tap still seeks"
    - "The active line re-anchors the instant the row appears or disappears (no line parked under the sticky row)"
  artifacts:
    - path: "src/lib/stores/lyric-offset.svelte.ts"
      provides: "In-memory, session-only open flag + bring-into-view request counter for the timing row"
      exports: ["lyricSyncOpen", "setLyricSyncOpen", "toggleLyricSyncOpen", "lyricSyncRequest"]
    - path: "src/lib/stores/lyric-offset.svelte.test.ts"
      provides: "toggle / request-counter / offsets-unaffected tests"
      contains: "lyricSyncRequest"
    - path: "src/lib/components/NpLyrics.svelte"
      provides: "the .sync row gated on the flag, ✕ close, hold-to-sync guarded, anchor re-reads the flag"
      contains: "{#if lyricSyncOpen()}"
    - path: "src/lib/components/TrackMenu.svelte"
      provides: "Adjust / Hide lyrics timing toggle row for the current track with lyrics"
      contains: "toggleLyricSyncOpen"
    - path: "src/lib/components/NowPlaying.svelte"
      provides: "request-counter effect that switches the narrow layout to the Lyrics tab"
      contains: "lyricSyncRequest()"
  key_links:
    - from: "src/lib/components/TrackMenu.svelte"
      to: "src/lib/stores/lyric-offset.svelte.ts"
      via: "row onclick → toggleLyricSyncOpen() then close()"
      pattern: "toggleLyricSyncOpen\\(\\)"
    - from: "src/lib/components/NowPlaying.svelte"
      to: "src/lib/stores/lyric-offset.svelte.ts"
      via: "$effect reads lyricSyncRequest() only; selectTab('lyrics') inside untrack"
      pattern: "untrack\\(\\(\\) => \\{ if \\(!wide\\) selectTab\\('lyrics'\\)"
    - from: "src/lib/components/NpLyrics.svelte"
      to: "src/lib/stores/lyric-offset.svelte.ts"
      via: "{#if lyricSyncOpen()} around .sync; syncToLine early-returns on !lyricSyncOpen(); anchorActiveLine reads lyricSyncOpen() at the top"
      pattern: "if \\(!lyricSyncOpen\\(\\)\\) return"
---

<objective>
User (verbatim): "the lyrics realignment bar only show up if toggled in the menu".

The `.sync` row in the lyrics pane (−0.5s / offset readout / +0.5s / "Synced by listeners" / hint — quick-260926-mis + 260926-mzn) is always on. Make it hidden by default and shown only from the track menu of the currently playing track ("Adjust lyrics timing" / "Hide lyrics timing"), with a ✕ in the row itself. Offsets keep applying whether or not the row is visible — this hides the controls, not the effect.

Purpose: a clean lyrics pane for everyone; the realign tools one menu tap away for the few who need them.
Output: 4 exports + tests in the offset store, gated row in NpLyrics, a menu row in TrackMenu, a tab-switch effect in NowPlaying, 2 keys x 15 locales.
</objective>

<execution_context>
@/Users/laichan/.claude/plugins/cache/gsd-plugin/gsd/4.5.3/workflows/execute-plan.md
@/Users/laichan/.claude/plugins/cache/gsd-plugin/gsd/4.5.3/templates/summary.md
</execution_context>

<context>
@./CLAUDE.md
@src/lib/stores/lyric-offset.svelte.ts
@src/lib/stores/lyric-offset.svelte.test.ts
@src/lib/components/NpLyrics.svelte

<interfaces>
<!-- Facts read once from the codebase. Use directly; do not re-explore. -->

src/lib/stores/lyric-offset.svelte.ts: a `.svelte.ts` module with NO `$app/environment` import (node-testable). Module-scope `$state` is already the idiom there: `const _v = $state({ n: 0 })` + `export function lyricOffsetVersion(): number { return _v.n; }`. Ends with `__resetSharedLyricOffsets()` (test-only).

src/lib/components/NpLyrics.svelte (517 lines):
- imports from the offset store at ~line 32-40 (one `import { … } from '$lib/stores/lyric-offset.svelte'` block); no `@lucide/svelte` import yet.
- `function syncToLine(line: LyricLine)` ~line 192: first statement is `const uid = player.current?.uid;`.
- `function anchorActiveLine()` ~line 226: reads `activeLine`, `void sheetState;`, `settings.lyricsAnchor` at the top, THEN `if (!autoScroll || idx < 0 || !lyricsEl) return;`. Later: `const syncH = container.querySelector<HTMLElement>('.sync')?.offsetHeight ?? 0;` — already null-safe, so an absent row measures 0.
- template ~line 449-457: `{#if lines.length}` → `<div class="sync">` (three buttons, `{#if offsetShared}<span class="shared">`, `<span class="hint">`) → `{#if translating}` → `<div class="lyrics" …>`.
- each line: `<p … use:longpress onlongpress={() => syncToLine(l)} onclick={() => seekToLine(l)} …>` ~line 473. The longpress action eats the trailing click after a hold, so a hold with the row hidden must simply no-op (no seek either — that is fine, a hold is not a tap).
- styles: `.sync { position: sticky; … }`, `.sync button { … min-width: 44px; min-height: 24px; … }`, `.sync .readout`, `.sync .hint`, `.sync .shared`.

src/lib/components/TrackMenu.svelte (1653 lines):
- line 5: the single `@lucide/svelte` import list (`…, Mic2, EyeOff`). `Timer` exists in `node_modules/@lucide/svelte/dist/icons/timer.*`.
- line 72: `import { readLyrics, pinLyrics, unpinLyrics } from '$lib/stores/lyric-pins.svelte';`
- line 288: `function close()` (resets sheet flags, aborts fan-outs, calls `onclose()`); row handlers follow the `function x() { …; close(); }` shape (e.g. `shuffleQueue`, `cycleRepeatMode` ~line 476-487).
- line ~1122 (inside the `{#if track}` block): `<button class="mi" disabled={!track.uid} onclick={openLyricsPicker} use:tapBounce><Mic2 size={18} /> {t('menu.fixLyrics')}</button>` — insert the new row directly after it.
- "is this the current track" idiom: `player.current?.uid === track.uid` (lines 175, 381, 1489). Toggle-row idiom (Repeat, ~line 1158): `class:on={…} aria-pressed={…}` + a label that swaps with state; `.mi.on { color: var(--color-primary); }` exists.

src/lib/components/NowPlaying.svelte (1514 lines):
- line 2: `import { untrack } from 'svelte';`
- line 67-68: `type Tab = 'queue' | 'lyrics' | 'comments' | 'related'; let tab = $state<Tab>('lyrics');` — lyrics is the DEFAULT tab on mount.
- line 93-101: `let wide = $state(…)` (>=1280px media query).
- line 585: `let sheetState = $state<SheetState>('closed');`
- lines 595-599: the quick-260926-pb0 comments effect — the pattern to mirror: read the trigger, then `untrack(() => …)`.
- line 819-832: `function selectTab(next: Tab)` — sets `tab`, and `sheetState = 'half'` when closed and `!wide`. On the wide layout `tab` only picks the Comments | Related column; lyrics is always the middle column.
- line 915: the ⋮ button → `openMenu(player.current)`; `openMenu` (line 136) sets `menuTrack` / `menuOpen`.
- `<NpLyrics {sheetState} />` is mounted only on the lyrics tab (narrow) or always (wide).

i18n: 15 locale files `src/lib/i18n/{en,ar,de,es,fr,hi,id,it,pt,ru,th,tr,vi,zh-Hans,zh-Hant}.ts`; every one has a `"menu.fixLyrics"` line (line 425 in en, 362 in most, 384 in zh-*) — insert the two new keys directly after it. DOUBLE quotes for key and value. `i18n.test.ts` fails on key-set drift. No existing key becomes dead: `lyrics.offsetHint` ("Hold a line to sync it to now") stays inside the row and hold-to-sync only works while the row is shown, so it remains accurate.
</interfaces>
</context>

<tasks>

<task type="auto" tdd="true">
  <name>Task 1: session-only open flag + bring-into-view counter in the offset store</name>
  <files>src/lib/stores/lyric-offset.svelte.ts, src/lib/stores/lyric-offset.svelte.test.ts</files>
  <behavior>
    - closed by default: after `setLyricSyncOpen(false)`, `lyricSyncOpen()` is false and `lyricSyncRequest()` is a number
    - `toggleLyricSyncOpen()` from closed → `lyricSyncOpen()` true AND `lyricSyncRequest()` is exactly previous + 1
    - `toggleLyricSyncOpen()` from open → `lyricSyncOpen()` false AND `lyricSyncRequest()` unchanged (closing never requests a tab switch)
    - `setLyricSyncOpen(true)` while already open → still open, counter +1 (every "show me" request brings the row into view)
    - `setLyricSyncOpen(false)` while already closed → counter unchanged
    - the flag never touches localStorage: after the toggles above, `store.getItem('openmusic:lyric-offset:v1')` is still null (nothing written) and no other key exists in the MemStorage
    - offsets are independent of the flag: `setLyricOffset(UID, 2)`, `setLyricSyncOpen(false)` → `getEffectiveLyricOffset(UID)` is still 2
  </behavior>
  <action>
Append to `src/lib/stores/lyric-offset.svelte.ts` (after the shared-consensus section, before `__resetSharedLyricOffsets`) a small block headed by a decision-record comment: `// ---- quick-260926-qat: the timing row's open flag ----` explaining that it is IN-MEMORY and SESSION-ONLY on purpose (a fresh app start shows clean lyrics; never persisted), that it stays open across track changes (a user realigning a whole live album), and that `req` is a monotonic "bring the row into view" counter NowPlaying reacts to — the same reactive-counter shape as `_v.n`, so the NowPlaying effect can depend on the counter alone and never on the flag or on any tab state.

Implement with one module `$state` object, mirroring `_v`: `const _bar = $state({ open: false, req: 0 });` and four exports:
- `lyricSyncOpen(): boolean` → `_bar.open` (call inside a $derived/template/effect to depend on it — same doc line as `lyricOffsetVersion`).
- `lyricSyncRequest(): number` → `_bar.req`.
- `setLyricSyncOpen(v: boolean): void` → `_bar.open = v; if (v) _bar.req++;`.
- `toggleLyricSyncOpen(): void` → `setLyricSyncOpen(!_bar.open)`.

No localStorage, no `browser` import, no reset hook (the tests read the counter relatively; there is nothing to leak). Do NOT extend `__resetSharedLyricOffsets`.

Tests: add a new `describe('lyric timing row flag (quick-260926-qat)')` block at the end of `src/lib/stores/lyric-offset.svelte.test.ts`, inside the existing file so it reuses the `MemStorage` `beforeEach` (add the four new names to the existing import list). One `it` per `<behavior>` line above (the two "already open/closed" lines may share one `it`). Use `const r = lyricSyncRequest()` before each toggle and assert `r + 1` / `r` — never absolute values, since describe blocks share the module instance.
  </action>
  <verify>
    <automated>cd /Users/laichan/code/tung/openmusic && pnpm vitest run src/lib/stores/lyric-offset.svelte.test.ts && test "$(grep -c 'export function lyricSyncOpen\|export function setLyricSyncOpen\|export function toggleLyricSyncOpen\|export function lyricSyncRequest' src/lib/stores/lyric-offset.svelte.ts)" = "4" && test "$(grep -v '^\s*//' src/lib/stores/lyric-offset.svelte.ts | grep -c 'lyric-sync\|LYRIC_SYNC')" = "0"</automated>
  </verify>
  <done>Four exports exist, backed by one module `$state`; opening bumps the request counter, closing does not; nothing is persisted; all new tests plus the existing offset tests pass.</done>
</task>

<task type="auto">
  <name>Task 2: gate the row, add the menu toggle, switch to the Lyrics tab, i18n</name>
  <files>src/lib/components/NpLyrics.svelte, src/lib/components/TrackMenu.svelte, src/lib/components/NowPlaying.svelte, src/lib/i18n/en.ts, src/lib/i18n/ar.ts, src/lib/i18n/de.ts, src/lib/i18n/es.ts, src/lib/i18n/fr.ts, src/lib/i18n/hi.ts, src/lib/i18n/id.ts, src/lib/i18n/it.ts, src/lib/i18n/pt.ts, src/lib/i18n/ru.ts, src/lib/i18n/th.ts, src/lib/i18n/tr.ts, src/lib/i18n/vi.ts, src/lib/i18n/zh-Hans.ts, src/lib/i18n/zh-Hant.ts</files>
  <action>
**i18n first** (keeps `pnpm check` green at every step). In all 15 locale files add, directly after the `"menu.fixLyrics"` line, two keys with DOUBLE quotes, `menu.lyricsTiming` and `menu.lyricsTimingHide`:
- en: "Adjust lyrics timing" / "Hide lyrics timing"
- ar: "ضبط توقيت كلمات الأغنية" / "إخفاء توقيت كلمات الأغنية"
- de: "Songtext-Timing anpassen" / "Songtext-Timing ausblenden"
- es: "Ajustar sincronía de la letra" / "Ocultar sincronía de la letra"
- fr: "Ajuster le timing des paroles" / "Masquer le timing des paroles"
- hi: "बोल का समय समायोजित करें" / "बोल का समय छिपाएँ"
- id: "Sesuaikan waktu lirik" / "Sembunyikan waktu lirik"
- it: "Regola il tempo del testo" / "Nascondi il tempo del testo"
- pt: "Ajustar tempo da letra" / "Ocultar tempo da letra"
- ru: "Настроить тайминг текста" / "Скрыть тайминг текста"
- th: "ปรับจังหวะเนื้อเพลง" / "ซ่อนการปรับจังหวะเนื้อเพลง"
- tr: "Şarkı sözü zamanlamasını ayarla" / "Şarkı sözü zamanlamasını gizle"
- vi: "Chỉnh thời gian lời bài hát" / "Ẩn chỉnh thời gian lời bài hát"
- zh-Hans: "调整歌词时间" / "隐藏歌词时间调整"
- zh-Hant: "調整歌詞時間" / "隱藏歌詞時間調整"
Remove nothing — no existing key becomes dead (see interfaces).

**NpLyrics.svelte**:
1. Add `lyricSyncOpen` and `setLyricSyncOpen` to the existing `$lib/stores/lyric-offset.svelte` import block; add `import { X } from '@lucide/svelte';` (per-icon import).
2. Wrap the whole `<div class="sync">…</div>` in `{#if lyricSyncOpen()}` … `{/if}` (still inside `{#if lines.length}`). Append a close button as the LAST child of the row: `<button type="button" class="close" onclick={() => setLyricSyncOpen(false)} aria-label={t('menu.lyricsTimingHide')}><X size={14} /></button>`. Extend the row's comment: quick-260926-qat — hidden by default, opened from the track menu (TrackMenu "Adjust lyrics timing"); the flag lives in the offset store so the menu, this pane and NowPlaying's tab switch share one source.
3. `syncToLine`: make the FIRST statement `if (!lyricSyncOpen()) return;` with a comment: hold-to-sync only while the row is shown — with the readout hidden an accidental hold would shift the lyrics silently (quick-260926-qat). Tap-to-seek (`seekToLine`) is untouched.
4. `anchorActiveLine`: add `lyricSyncOpen();` (bare read) right after `const anchorPct = settings.lyricsAnchor;` and BEFORE the `if (!autoScroll || …) return;` line, with a comment: quick-260926-qat — the row's height enters/leaves `syncH` when it toggles, so the effect must re-anchor on the flag; read at the top so the synchronous pass registers it. The function still writes no `$state`. The existing `syncH` line already yields 0 when the row is absent — do not change it.
5. Style: `.sync .close { min-width: 24px; min-height: 24px; padding: 2px 4px; border: none; display: inline-flex; align-items: center; }`.

**TrackMenu.svelte**:
1. Add `Timer` to the line-5 `@lucide/svelte` import list.
2. Add `import { lyricSyncOpen, toggleLyricSyncOpen } from '$lib/stores/lyric-offset.svelte';` next to the `lyric-pins` import (line 72).
3. Add a handler in the row-handler cluster (~line 476): `function toggleLyricsTiming() { toggleLyricSyncOpen(); close(); }`.
4. Directly after the Fix-lyrics `<button …>{t('menu.fixLyrics')}</button>` (~line 1122) insert, with a decision comment (quick-260926-qat: shown ONLY for the currently playing track that actually has lyrics — the row it reveals lives in the Now Playing lyrics pane of `player.current`, so for any other track it would toggle something the user cannot see; `readLyrics(player.current)` is D-4's single read, pin → track.lrc → null, and it takes the lyricVersion dependency so a Fix-lyrics pick that lands lyrics makes the row appear live):
```
{#if player.current?.uid === track.uid && readLyrics(player.current)}
	<button class="mi" class:on={lyricSyncOpen()} aria-pressed={lyricSyncOpen()} onclick={toggleLyricsTiming} use:tapBounce><Timer size={18} /> {lyricSyncOpen() ? t('menu.lyricsTimingHide') : t('menu.lyricsTiming')}</button>
{/if}
```
(Repeat-row idiom: `class:on` + `aria-pressed` + a swapping label, because the menu closes on tap and is read cold each time.)

**NowPlaying.svelte**:
1. Import `{ lyricSyncRequest } from '$lib/stores/lyric-offset.svelte'`.
2. After `let tab = $state<Tab>('lyrics');` add a PLAIN field (house convention — nothing renders it): `let seenSyncReq = lyricSyncRequest();` with a comment: quick-260926-qat — snapshot at mount so a request raised while this component was unmounted (menu opened from the Nowbar / a list row) is not replayed on the next expand; `tab` already defaults to `'lyrics'` on mount, so the row is on screen anyway.
3. Add one `$effect` next to the comments effect (~line 599), mirroring its shape exactly:
```
$effect(() => {
	const n = lyricSyncRequest();
	if (n === seenSyncReq) return;
	seenSyncReq = n;
	untrack(() => { if (!wide) selectTab('lyrics'); });
});
```
Comment: reads ONLY the request counter; `wide`, `tab`, `sheetState`, `subnavMoved` are read inside `untrack` so this can never re-run on its own writes (cf. restore-effect-self-invalidation-loop). Wide layout: lyrics is always the middle column and `selectTab` there would only flip the Comments | Related column, so it is skipped. Narrow: `selectTab('lyrics')` is the same call the tab button makes — it also opens the sheet to half from closed, nothing more. `subnavMoved` is false here (the request comes from a menu tap, not a subnav drag).

Then run the full suite and the type check; both must be green.
  </action>
  <verify>
    <automated>cd /Users/laichan/code/tung/openmusic && test "$(grep -c '{#if lyricSyncOpen()}' src/lib/components/NpLyrics.svelte)" = "1" && test "$(sed -n '/function syncToLine/,/^\t}/p' src/lib/components/NpLyrics.svelte | grep -c 'if (!lyricSyncOpen()) return')" = "1" && test "$(sed -n '/function anchorActiveLine/,/if (!autoScroll/p' src/lib/components/NpLyrics.svelte | grep -c 'lyricSyncOpen()')" = "1" && test "$(grep -c 'setLyricSyncOpen(false)' src/lib/components/NpLyrics.svelte)" = "1" && test "$(grep -c 'toggleLyricSyncOpen()' src/lib/components/TrackMenu.svelte)" = "1" && test "$(grep -c "player.current?.uid === track.uid && readLyrics(player.current)" src/lib/components/TrackMenu.svelte)" = "1" && test "$(grep -c "untrack(() => { if (!wide) selectTab('lyrics'); })" src/lib/components/NowPlaying.svelte)" = "1" && test "$(grep -l '"menu.lyricsTiming"' src/lib/i18n/*.ts | wc -l | tr -d ' ')" = "15" && test "$(grep -l '"menu.lyricsTimingHide"' src/lib/i18n/*.ts | wc -l | tr -d ' ')" = "15" && pnpm test && pnpm check</automated>
  </verify>
  <done>The `.sync` row renders only while the flag is on and carries a ✕; hold-to-sync no-ops while hidden; the anchor re-reads the flag; the menu shows Adjust/Hide lyrics timing only for the current track with lyrics and closes on tap; NowPlaying switches the narrow layout to the Lyrics tab on each open request via the counter; 2 keys x 15 locales; `pnpm test` and `pnpm check` green.</done>
</task>

</tasks>

<threat_model>
## Trust Boundaries

| Boundary | Description |
|----------|-------------|
| none new | The flag is client-only, in-memory, set by the user's own tap; no input crosses a boundary and nothing is persisted |

## STRIDE Threat Register

| Threat ID | Category | Component | Disposition | Mitigation Plan |
|-----------|----------|-----------|-------------|-----------------|
| T-qat-01 | Tampering | lyric-offset store flag | accept | Session-only boolean, no storage read (nothing to tamper); offsets keep their existing normalize-on-read clamp (T-mis-01) |
| T-qat-02 | Denial of service | NowPlaying tab-switch effect | mitigate | Effect depends on the request counter only; all other reads inside `untrack`; plain `seenSyncReq` guard — cannot self-invalidate |
| T-qat-SC | Tampering | package installs | accept | No new packages |
</threat_model>

<verification>
- Task 1: `pnpm vitest run src/lib/stores/lyric-offset.svelte.test.ts` green.
- Task 2: grep gates + `pnpm test` + `pnpm check` green (i18n parity test proves 15 locales).
- Orchestrator browser E2E: play a song with lyrics → Now Playing lyrics pane has no timing row; ⋮ → "Adjust lyrics timing" present (after Fix lyrics) → tap: menu closes, row appears with ✕; switch to Up Next tab, ⋮ → "Hide lyrics timing" shown highlighted → instead pick nothing, close, ⋮ on a queue row (other track) → no timing row in that menu; from Up Next tab open ⋮ → the row reads "Hide…" — tap ✕ path: back on Lyrics, tap ✕ → row gone; ⋮ → "Adjust lyrics timing" again → tap while on the Up Next tab → the sheet switches to Lyrics and the row is visible; hold a line with the row hidden → no offset change.
</verification>

<success_criteria>
- Timing row hidden on a fresh start; offsets still applied.
- Menu row appears only for the current track with lyrics; label and highlight reflect state; toggles and closes the menu.
- Turning it on brings the row into view (narrow: Lyrics tab), off hides it; ✕ in the row hides it; state survives track changes within a session.
- Hold-to-sync gated on the row; tap-to-seek unchanged; anchor re-runs on toggle.
- 2 new keys in 15 locales, no dead keys; tests and typecheck green.
</success_criteria>

<output>
Create `.planning/quick/260926-qat-lyrics-timing-bar-hidden-until-toggled-f/260926-qat-SUMMARY.md` when done.
</output>
