---
phase: quick-260926-vur
plan: 01
type: execute
wave: 1
depends_on: []
files_modified:
  - src/routes/api/comments/+server.ts
  - src/routes/api/comments/comments-endpoint.test.ts
  - src/routes/api/lyric-offset/+server.ts
  - src/routes/api/lyric-offset/lyric-offset-endpoint.test.ts
  - src/lib/stores/comments.svelte.test.ts
  - src/lib/services/lyric-hold.ts
  - src/lib/services/lyric-hold.test.ts
  - src/lib/components/NpLyrics.svelte
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
requirements: [QUICK-260926-VUR]
must_haves:
  truths:
    - "A comment posted on song A is still listed after switching to song B and back to A within 60 s (the browser no longer serves the pre-post GET)"
    - "The Cloudflare edge copy of GET /api/comments and GET /api/lyric-offset still carries public, max-age=N (edge caching unchanged)"
    - "Holding a lyric line no longer shifts the lyrics timing; tapping a line still seeks"
    - "With the timing row open, dragging the slider moves the highlighted lyric line live and re-centres it while dragging; -0.5s / +0.5s / readout-reset / 'Synced by listeners' still work"
    - "On a touch device, scrolling the lyrics and keeping the finger down never snaps the view back to the active line; ~3 s after the finger lifts (momentum included) auto-centre resumes"
    - "With a mouse, pressing and holding on the lyrics suspends auto-centre until release + 3 s; wheel scrolling suspends for 3 s"
  artifacts:
    - path: "src/lib/services/lyric-hold.ts"
      provides: "Pure hold/resume decision machine for the lyrics pane (holdStep, pointerHoldEvent, HOLD_IDLE)"
      exports: ["holdStep", "pointerHoldEvent", "HOLD_IDLE"]
    - path: "src/lib/services/lyric-hold.test.ts"
      provides: "Node unit test of the hold machine: touch hold through scroll takeover, lift + momentum, mouse path, wheel, force, multi-touch"
    - path: "src/lib/components/NpLyrics.svelte"
      provides: "Slider in the .sync row; touch-event hold tracking; no long-press sync"
      contains: "type=\"range\""
    - path: "src/routes/api/comments/+server.ts"
      provides: "Client-facing GET answers Cache-Control: no-cache on both the edge-hit and miss paths"
      contains: "no-cache"
    - path: "src/routes/api/lyric-offset/+server.ts"
      provides: "Client-facing GET answers Cache-Control: no-cache on both the edge-hit and miss paths"
      contains: "no-cache"
  key_links:
    - from: "src/lib/components/NpLyrics.svelte"
      to: "src/lib/services/lyric-hold.ts"
      via: "holdStep / pointerHoldEvent imports; every touch/pointer/wheel/scroll/seek/slider handler dispatches into the machine"
      pattern: "holdStep\\("
    - from: "src/lib/components/NpLyrics.svelte"
      to: "src/lib/stores/lyric-offset.svelte.ts"
      via: "slider oninput -> setLyricOffset + scheduleLyricOffsetVote"
      pattern: "setLyricOffset\\(uid, "
    - from: "src/routes/api/comments/+server.ts"
      to: "src/lib/proxy/http.ts"
      via: "jsonResponse(body, origin, { cacheControl: 'no-cache' }) on the GET reply; the explicit cache.put keeps public, max-age=COMMENTS_TTL"
      pattern: "cacheControl: 'no-cache'"
---

<objective>
Three user-visible fixes in the Now Playing lyrics/comments area:

1. A freshly posted comment survives a song change: `GET /api/comments` (and `GET /api/lyric-offset`) currently tell the BROWSER to cache the reply for 60 s / 300 s, so after post -> switch song -> come back, `comments.load()` refetches and the browser/WebView HTTP cache hands back the pre-post thread. The client-facing reply becomes `Cache-Control: no-cache` while the Cloudflare edge copy keeps its TTL.
2. The long-hold "sync this line to now" gesture is removed (it fought the user's hold-to-peek gesture) and replaced by a range slider in the timing row that shifts the offset live, with the highlighted line re-centring as you drag.
3. A held/peeked lyric is never yanked back by auto-centre on web or APK: touch contact is tracked with touch events (which keep firing through a native scroll takeover) instead of pointer events (where Android/iOS fire `pointercancel` with the finger still down). The decision logic lives in a pure, node-tested module.

Purpose: comments look broken ("my comment vanished"), the hold gesture conflicts with peeking, and auto-centre snapping back mid-hold makes the lyrics pane unusable on phones.
Output: two server routes + tests, one new pure service + test, the NpLyrics component, one comments store test, one i18n key removed from 15 locales.
</objective>

<execution_context>
@/Users/laichan/.claude/plugins/cache/gsd-plugin/gsd/4.5.3/workflows/execute-plan.md
@/Users/laichan/.claude/plugins/cache/gsd-plugin/gsd/4.5.3/templates/summary.md
</execution_context>

<context>
@.planning/STATE.md
@./CLAUDE.md
@src/routes/api/comments/+server.ts
@src/routes/api/lyric-offset/+server.ts
@src/routes/api/comments/comments-endpoint.test.ts
@src/routes/api/lyric-offset/lyric-offset-endpoint.test.ts
@src/lib/proxy/http.ts
@src/lib/stores/comments.svelte.ts
@src/lib/stores/comments.svelte.test.ts
@src/lib/components/NpLyrics.svelte
@src/lib/stores/lyric-offset.svelte.ts
@src/lib/services/lrc.ts

<interfaces>
<!-- Existing contracts the executor uses directly. Do not re-explore. -->

From src/lib/proxy/http.ts:
```typescript
export function jsonResponse(body: unknown, origin: string | null, opts: { ttl?: number; status?: number; cacheControl?: string } = {}): Response;
// precedence: opts.cacheControl wins; else ttl -> `public, max-age=<ttl>`; else no Cache-Control header
```

From src/lib/stores/lyric-offset.svelte.ts:
```typescript
export function setLyricOffset(uid: string, sec: number): void;            // normalizes (clamp ±600, round 0.1s), bumps version synchronously
export function getEffectiveLyricOffset(uid: string | null | undefined): number; // local ?? shared ?? 0
export function scheduleLyricOffsetVote(uid: string, lrc: string): void;   // 4 s debounce, votes the value AT FIRE TIME
export function lyricSyncOpen(): boolean;                                   // timing row open flag
```

From src/lib/services/lrc.ts:
```typescript
export const LYRIC_OFFSET_MAX = 600;
export function normalizeLyricOffset(n: number): number;
export function formatLyricOffset(sec: number): string;
```

From src/lib/i18n/en.ts (already exists — reuse, do not add a new key):
```typescript
"menu.lyricsTiming": "Adjust lyrics timing",
```

Endpoint test harness (both endpoint tests): `stubCaches()` returns `{ store, put, match, delete }` where `put` is a `vi.fn(async (req: Request, res: Response) => ...)` — the stored Response is reachable as `cache.put.mock.calls[0][1]` and its headers are still readable after the body was consumed.

Comments store test harness: `vi.stubGlobal('fetch', fetchMock)`; `comments.__reset()` + `__resetGovernor()` in `beforeEach`; `gets(fetchMock)` filters GET calls; tracks `A = { uid: 'qq:1', ... }`, `B = { uid: 'qq:2', ... }`; `item(id)` builds a CommentItem; `json(body)` builds a Response.

NEW contract this plan creates (Task 2) — src/lib/services/lyric-hold.ts:
```typescript
export interface HoldState { touches: number; mouse: boolean; suspended: boolean }
export type HoldEvent =
	| { type: 'touch'; touches: number }   // touchstart/touchend/touchcancel: contacts REMAINING (e.touches.length)
	| { type: 'mouse'; down: boolean }     // pointerdown/pointerup/pointercancel whose pointerType is 'mouse'
	| { type: 'wheel' }
	| { type: 'scroll' }
	| { type: 'force' }                    // seek / slider: resume now
	| { type: 'tick' };                    // the RESUME_MS timer fired
export type HoldAction = 'suspend' | 'arm' | 'resume' | 'none';
export const HOLD_IDLE: HoldState;
export function holdStep(s: HoldState, e: HoldEvent): { state: HoldState; action: HoldAction };
export function pointerHoldEvent(pointerType: string, down: boolean): HoldEvent | null; // null for touch/pen (the touch path owns them)
```
</interfaces>
</context>

<tasks>

<task type="auto" tdd="true">
  <name>Task 1: Client-facing GET replies stop being browser-cacheable; edge copy keeps its TTL</name>
  <files>src/routes/api/comments/+server.ts, src/routes/api/lyric-offset/+server.ts, src/routes/api/comments/comments-endpoint.test.ts, src/routes/api/lyric-offset/lyric-offset-endpoint.test.ts, src/lib/stores/comments.svelte.test.ts</files>
  <behavior>
    - comments-endpoint: 'no object → cacheable {ok, items:[]} …' now expects `res.headers.get('Cache-Control')` to be `'no-cache'` (rename the test to say the EDGE copy is cacheable, the client reply is not)
    - comments-endpoint: 'an edge-cache hit is served without touching R2' additionally expects `Cache-Control` to be `'no-cache'` on the hit reply
    - comments-endpoint: 'a miss writes the body to the edge cache …' additionally expects `cache.put.mock.calls[0][1].headers.get('Cache-Control')` to be `'public, max-age=60'` (the stored edge copy keeps its TTL)
    - lyric-offset-endpoint: same three expectations with `'public, max-age=300'` for the stored copy
    - comments store: new test 'a posted comment is refetched after a song change and back' — stub fetch to return `[item('a')]`; `load(A)`; wait for `loading` false; `replace([item('new'), item('a')])` (the post reply) and assert `items` shows it; `load(B)`; `load(A)` again; assert `gets(fetchMock)` length is 3 (A, B, A — the uid dedupe reset on the change) and `items` equals the last fetch reply, i.e. the store re-fetches rather than reusing the replaced thread
  </behavior>
  <action>
    Root cause (measured on production): `GET /api/comments` answers `Cache-Control: public, max-age=60` (and `/api/lyric-offset` `max-age=300`), so the browser / Android WebView HTTP cache serves the pre-post thread for up to 60 s after a post → song change → return. `apiFetch` only dedupes IN-FLIGHT GETs (no client response cache), so the fix is server-only and every client benefits.

    In BOTH route files, change the two client-facing GET replies — the edge-HIT `return jsonResponse(await hit.json(), origin, { ttl: … })` and the MISS `return jsonResponse(body, origin, { ttl: … })` — to `jsonResponse(…, origin, { cacheControl: 'no-cache' })`. Leave the explicit `cache.put(...)` untouched: its own `Cache-Control: public, max-age=${TTL}` header is what governs the Cloudflare edge copy, and PoP-local busting on POST already exists. Do NOT switch the client to `cache: 'no-store'` — keep the fix at the server. Add a one-line quick-260926-vur comment above the first changed reply in each route explaining that `no-cache` is for the BROWSER cache (the browser must revalidate; with no validator that is a refetch) while the edge TTL lives on the stored copy. Keep the `COMMENTS_TTL` / `SHARED_OFFSET_TTL` imports (still used by the put).

    Update the endpoint tests per the behavior block (RED first: run the two endpoint tests, see the `max-age` expectations fail after the route change, then fix the expectations). Add the store test to `src/lib/stores/comments.svelte.test.ts` per the behavior block — it documents that the post→replace→song-change→return path re-fetches (this is what makes the server fix sufficient; no store change is needed).
  </action>
  <verify>
    <automated>cd /Users/laichan/code/tung/openmusic && pnpm vitest --run src/routes/api/comments src/routes/api/lyric-offset src/lib/stores/comments.svelte.test.ts</automated>
  </verify>
  <done>Both routes' GET replies carry `Cache-Control: no-cache` on hit and miss; the stored edge copies still carry `public, max-age=60` / `public, max-age=300`; the three test files pass including the new store test; `grep -c "ttl:" src/routes/api/comments/+server.ts src/routes/api/lyric-offset/+server.ts` is 0 for both.</done>
</task>

<task type="auto" tdd="true">
  <name>Task 2: Pure lyric-hold machine + touch-event hold tracking in NpLyrics; remove hold-to-sync</name>
  <files>src/lib/services/lyric-hold.ts, src/lib/services/lyric-hold.test.ts, src/lib/components/NpLyrics.svelte</files>
  <behavior>
    Tests in src/lib/services/lyric-hold.test.ts (vitest, node, no DOM), each starting from HOLD_IDLE and chaining holdStep:
    - touch hold survives a scroll takeover: touch(1) → 'suspend'; pointerHoldEvent('touch', false) → null (a touch pointercancel is ignored); scroll → 'none' and state.suspended stays true (no timer armed while held)
    - lift then momentum: touch(1) → touch(0) → 'arm'; scroll → 'arm' (re-arm); scroll → 'arm'; tick → 'resume' and state.suspended false
    - tick while still held → 'none', suspended stays true
    - multi-touch: touch(1) → touch(2) → touch(1) → 'none' (still held); touch(0) → 'arm'
    - mouse path: pointerHoldEvent('mouse', true) equals { type:'mouse', down:true }; mouse down → 'suspend'; scroll → 'none'; mouse up → 'arm'; tick → 'resume'
    - pen is routed to the touch path: pointerHoldEvent('pen', true) → null
    - wheel → 'arm' with suspended true; tick → 'resume'
    - force while suspended → 'resume', suspended false; a later scroll while idle → 'none'
    - touch(0) when not suspended → 'none' (no spurious re-suspend)
  </behavior>
  <action>
    Root cause: `lyricsTouched` registers window CAPTURE listeners for `pointerup` AND `pointercancel` and treats both as the finger lifting. Android Chrome/WebView and iOS Safari fire `pointercancel` the instant a touch turns into a native scroll — with the finger still down — so `lyricsReleased()` arms the 3 s resume and auto-centre snaps the view back while the user is still holding/peeking. Touch events (`touchstart`/`touchend`/`touchcancel`) keep firing through a native scroll and `touchend` is the real lift, so the touch path uses them; the pointer path stays only for the mouse (no scroll takeover exists for a mouse).

    1. Create `src/lib/services/lyric-hold.ts` (PURE `.ts`, no runes, no imports) exporting the contract in the plan's `<interfaces>` block. Rules of `holdStep`, in this order:
       - `touch`: store `touches`. If `touches > 0` → `suspended = true`, action `'suspend'`. If `touches === 0` → action `'arm'` when `suspended && !mouse`, else `'none'` (suspended unchanged).
       - `mouse`: store `mouse = down`. `down` → `suspended = true`, `'suspend'`. Up → `'arm'` when `suspended && touches === 0`, else `'none'`.
       - `wheel` → `suspended = true`, `'arm'` (no release event exists for a wheel; pause and arm the same grace).
       - `scroll` → `'none'` if `!suspended` (the anchor pass's own smooth scroll must not re-suspend) or if held (`touches > 0 || mouse`); else `'arm'` (momentum after a lift keeps pushing the resume out).
       - `force` → `suspended = false`, `'resume'` (contacts unchanged).
       - `tick` → `'none'` if held; else `suspended = false`, `'resume'`.
       `pointerHoldEvent(pointerType, down)` returns `{ type: 'mouse', down }` only for `'mouse'`, else `null` — touch AND pen go through touch events (pens fire touch events on Android/iOS and get the same scroll takeover). Return a NEW state object each step (never mutate the input). Header comment: quick-260926-vur, the root cause above, and that the component maps `'suspend'` → autoScroll=false + clear timer, `'arm'` → autoScroll=false + restart the RESUME_MS timer, `'resume'` → clear timer + autoScroll=true.
    2. Write `src/lib/services/lyric-hold.test.ts` per the behavior block FIRST; run it (RED), then implement (GREEN).
    3. Rewire `src/lib/components/NpLyrics.svelte` (the block at roughly lines 119-176 and the `.lyrics` element attributes):
       - Add `let hold: HoldState = HOLD_IDLE;` as a PLAIN field (house convention: not `$state`, nothing renders it). Keep `autoScroll` as `$state` — the anchor `$effect` depends on it and must keep working unchanged. Keep `idleTimer` and `RESUME_MS = 3000`.
       - Add one `dispatch(e: HoldEvent)` function: `hold = holdStep(hold, e).state` and map the action exactly as documented in step 1; `'arm'` restarts `idleTimer = setTimeout(() => dispatch({ type: 'tick' }), RESUME_MS)`.
       - DELETE `pressedPointers`, `lyricsTouched`, `windowPointerUp`, `lyricsReleased`, `lyricsWheel`, `bumpResume` and their comment blocks; replace with a short quick-260926-vur comment naming the root cause and pointing at lyric-hold.ts.
       - Mouse pointer path: `onpointerdown` on `.lyrics` → `const ev = pointerHoldEvent(e.pointerType, true); if (!ev) return; dispatch(ev);` then add window CAPTURE listeners for `pointerup` and `pointercancel` (a single `windowMouseUp` handler that dispatches `pointerHoldEvent(e.pointerType, false)` when non-null, then removes both listeners). Touch pointers never reach the machine through this path.
       - Touch path on `.lyrics`: `ontouchstart`, `ontouchend`, `ontouchcancel` each dispatch `{ type: 'touch', touches: e.touches.length }` (`e.touches` is the set REMAINING after the event, so a lift reads 0). Never call `preventDefault` (Svelte 5 delegates touchstart as passive; the pane must keep native scrolling).
       - `onwheel` → `dispatch({ type: 'wheel' })`; `onscroll` → `dispatch({ type: 'scroll' })`.
       - `seekToLine`: replace the trailing `clearTimeout` + `autoScroll = true` with `dispatch({ type: 'force' })` (same D-02 semantics: the tap's own suspend is overridden so the anchor effect re-centres the tapped line).
       - REMOVE hold-to-sync: drop `use:longpress onlongpress={() => syncToLine(l)}` from the lyric `<p>`, delete `syncToLine` and its comment block, delete the now-unused imports `longpress` (`$lib/actions/longpress`) and `tick` (`$lib/util/haptics`) — both are used only there. Tap-to-seek (`onclick`, `onkeydown`) stays exactly as is. Leave `nudgeOffset` / `resetOffset` alone (Task 3 adds the slider beside them).
       - `anchorActiveLine` and its `$effect` are NOT edited: the early return on `!autoScroll` is what keeps the settle-pass timer from re-centring while suspended, and the effect must keep writing no `$state`.
       Add a cleanup: on component destroy (an `$effect` returning a teardown, or the existing pattern if one exists) clear `idleTimer` and remove the window listeners so an unmount mid-hold leaks nothing.
  </action>
  <verify>
    <automated>cd /Users/laichan/code/tung/openmusic && pnpm vitest --run src/lib/services/lyric-hold.test.ts && grep -c "pointercancel" src/lib/components/NpLyrics.svelte | xargs test 1 -le && ! grep -q "syncToLine\|use:longpress\|pressedPointers" src/lib/components/NpLyrics.svelte && grep -q "ontouchend" src/lib/components/NpLyrics.svelte</automated>
  </verify>
  <done>lyric-hold.test.ts passes all cases in the behavior block; NpLyrics has no `syncToLine`, `use:longpress`, `pressedPointers`, or `longpress`/`haptics` import; the `.lyrics` div carries `ontouchstart`/`ontouchend`/`ontouchcancel`/`onpointerdown`/`onwheel`/`onscroll` that all route through `holdStep`; the window `pointercancel` listener is only ever registered from the mouse path; `pnpm check` reports 0 errors / 0 warnings.</done>
</task>

<task type="auto">
  <name>Task 3: Timing slider in the .sync row; drop the hold hint from all 15 locales</name>
  <files>src/lib/components/NpLyrics.svelte, src/lib/i18n/en.ts, src/lib/i18n/ar.ts, src/lib/i18n/de.ts, src/lib/i18n/es.ts, src/lib/i18n/fr.ts, src/lib/i18n/hi.ts, src/lib/i18n/id.ts, src/lib/i18n/it.ts, src/lib/i18n/pt.ts, src/lib/i18n/ru.ts, src/lib/i18n/th.ts, src/lib/i18n/tr.ts, src/lib/i18n/vi.ts, src/lib/i18n/zh-Hans.ts, src/lib/i18n/zh-Hant.ts</files>
  <action>
    Slider (native `<input type="range">` — the same call the Nowbar volume control made: keyboard-operable, screen-reader-labelled and drag-correct for free; never hand-roll a pointer-drag slider):

    1. In `NpLyrics.svelte` import `LYRIC_OFFSET_MAX` from `$lib/services/lrc` (extend the existing import line). Add the slider range as a per-track RATCHET: a plain (non-`$state`) `let rangeFor = { uid: '', r: 60 }` plus `const sliderRange = $derived.by(...)` that computes `need = Math.min(LYRIC_OFFSET_MAX, Math.max(60, Math.ceil(Math.abs(lyricOffset) / 60) * 60))`, resets `rangeFor` when `player.current?.uid` changes, widens it when `need > rangeFor.r`, and returns `rangeFor.r`. Comment why it only ever widens within a track: if `max` shrank mid-drag the browser would re-map the thumb's x to a new value under the finger (offset 70 → range ±120 → drag to 59.9 → range ±60 → value jumps to ~30). ±60 s covers the stated case (20-40 s live intros); the ratchet covers a larger offset that arrived via ±0.5 s taps or a shared consensus.
    2. Add `function slideOffset(v: number)`: return unless `player.current?.uid` and `Number.isFinite(v)`; `setLyricOffset(uid, v)` (the store normalizes to 0.1 s and clamps); `scheduleLyricOffsetVote(uid, readLyrics(player.current) ?? '')` (existing 4 s debounce → only the settled value is voted); then `dispatch({ type: 'force' })` from Task 2 so auto-centre is on and the idle timer cleared — the highlighted line follows the drag (activeLineAt already reads `lyricOffset`) and re-centres dynamically. Comment (quick-260926-vur): the slider replaced hold-to-sync because the long-press fought hold-to-peek.
    3. Markup, inside the existing `{#if lyricSyncOpen()}<div class="sync">` block, after the ✕ button and in place of the `<span class="hint">` line: `<input class="slider" type="range" min={-sliderRange} max={sliderRange} step="0.1" value={lyricOffset} aria-label={t('menu.lyricsTiming')} oninput={(e) => slideOffset(e.currentTarget.valueAsNumber)} />`. One-way `value` (not `bind:`) — the readout/reset/nudges already write the store and the derived feeds the thumb back. Reuse `menu.lyricsTiming` ("Adjust lyrics timing") — no new i18n key. Keep −0.5s / readout (tap = reset) / +0.5s / "Synced by listeners" / ✕ exactly as they are. The row stays OUTSIDE `.lyrics` (so a drag never reaches the pane's hold handlers) and the NowPlaying panel has no sheet gesture of its own (coverSwipe is on `.cover-strip`, the grip has its own handlers), so no `data-no-drag` is needed.
    4. CSS: replace `.sync .hint { ... }` with `.sync .slider { flex-basis: 100%; width: min(100%, 320px); margin: 2px auto 0; accent-color: var(--color-primary); touch-action: none; }`. `touch-action: none` makes a slightly diagonal thumb drag stay a slider drag instead of becoming a `.panel` vertical scroll on Android. Update the `.sync` comment block above the row (the "hint" sentence → slider).
    5. i18n: DELETE the `"lyrics.offsetHint"` line from ALL 15 locale files (en, ar, de, es, fr, hi, id, it, pt, ru, th, tr, vi, zh-Hans, zh-Hant) — the slider is the affordance, and the old text described the removed hold gesture. `TranslationKey` is derived from `en`, so the remaining `t('lyrics.offsetHint')` reference would be a compile error — step 3 removes it. Double-quote convention is untouched because nothing is added. The parity test (`src/lib/i18n/i18n.test.ts` 'every locale exposes a key set IDENTICAL to en') must stay green.
  </action>
  <verify>
    <automated>cd /Users/laichan/code/tung/openmusic && ! grep -rq "offsetHint" src && grep -q 'type="range"' src/lib/components/NpLyrics.svelte && pnpm vitest --run src/lib/i18n src/lib/services/lyric-hold.test.ts && pnpm check 2>&1 | tail -3</automated>
  </verify>
  <done>The timing row shows a range slider (±60 s by default, wider only when the current offset exceeds it, step 0.1) whose `oninput` writes the offset live and votes after the 4 s debounce; `offsetHint` is gone from every locale and from the component; `pnpm test` is green and `pnpm check` reports 0 errors / 0 warnings.</done>
</task>

</tasks>

<threat_model>
## Trust Boundaries

| Boundary | Description |
|----------|-------------|
| browser → /api/comments, /api/lyric-offset GET | Public, unauthenticated reads; the reply's Cache-Control is a hint the client honours |
| slider input → lyric-offset store → POST vote | A user-controlled number reaches localStorage and, debounced, the shared vote endpoint |

## STRIDE Threat Register

| Threat ID | Category | Component | Disposition | Mitigation Plan |
|-----------|----------|-----------|-------------|-----------------|
| T-vur-01 | Denial of Service | GET /api/comments, GET /api/lyric-offset | mitigate | `no-cache` only removes the BROWSER cache; the Cloudflare edge copy keeps `public, max-age=N` via the explicit `cache.put`, so R2 read volume is unchanged (asserted by the new stored-copy header tests) |
| T-vur-02 | Tampering | slider → setLyricOffset | mitigate | `setLyricOffset` → `normalizeLyricOffset` clamps to ±LYRIC_OFFSET_MAX and rounds to 0.1 s on write AND read (T-mis-01 unchanged); `slideOffset` rejects non-finite values |
| T-vur-03 | Denial of Service | slider → scheduleLyricOffsetVote | accept | Every `oninput` re-arms the existing 4 s debounce, so a drag produces at most one POST; the server-side sybil/flood posture is unchanged from quick-260926-mzn |
| T-vur-04 | Information Disclosure | `no-cache` reply | accept | Public data only (hidden items already dropped server-side); the maintainer `?all=1` view was never cached and is untouched |
| T-vur-SC | Tampering | npm installs | accept | No package installs in this plan |
</threat_model>

<verification>
- `pnpm test` green (baseline ~690 test files) including the 5 edited/added test files.
- `pnpm check` 0 errors / 0 warnings.
- Orchestrator E2E (browser, dev server 4321 or 5173): post a comment → switch song → return → the comment is listed; open Track menu → Adjust lyrics timing → drag the slider → the highlighted line moves and stays centred; scroll the lyrics with a finger held (touch emulation) → the view does not snap back until ~3 s after release; hold a line → nothing changes, tap → seeks.
- Optional emulator check (Pixel_3a_API_34 + CDP): finger-hold scroll on the APK lyrics pane never snaps back while held.
</verification>

<success_criteria>
- Both GET routes answer `Cache-Control: no-cache` to the client on hit and miss; stored edge copies keep `public, max-age=60` / `300`.
- `src/lib/services/lyric-hold.ts` exists with `holdStep` / `pointerHoldEvent` / `HOLD_IDLE` and a passing node test covering touch-hold-through-scroll-takeover, lift + momentum, tick-while-held, multi-touch, mouse, pen→touch routing, wheel, force.
- NpLyrics: no long-press sync; touch events drive the hold; the `.sync` row has the range slider; `offsetHint` removed everywhere.
- All tests and `pnpm check` green.
</success_criteria>

<output>
Create `.planning/quick/260926-vur-fresh-comment-gets-lyrics-timing-slider-/260926-vur-SUMMARY.md` when done
</output>
