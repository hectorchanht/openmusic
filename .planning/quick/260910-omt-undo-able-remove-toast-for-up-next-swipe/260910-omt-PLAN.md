---
phase: quick-260910-omt
plan: 01
type: execute
wave: 1
depends_on: []
files_modified:
  - src/lib/stores/player.svelte.ts
  - src/lib/stores/player.svelte.test.ts
  - src/lib/stores/toast.svelte.ts
  - src/lib/stores/toast.svelte.test.ts
  - src/lib/components/ToastHost.svelte
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
autonomous: false
requirements: [quick-260910-omt]

must_haves:
  truths:
    - "Swipe-left on a non-current Up Next row removes it AND shows a toast with an Undo button"
    - "Tapping Undo re-inserts the track at its ORIGINAL queue index (not appended), restores its manual pin iff it had one, and clears its removedUids exclusion so a later regenerate/ensureAhead can bring it back"
    - "Letting the toast expire (~5s) leaves the removal permanent; the queue is untouched"
    - "A second toast.show() while Undo is pending drops the pending Undo — the stale restore callback can never fire"
    - "Every existing toast.show(msg) call site (42) compiles unchanged; default duration stays 2000ms"
  artifacts:
    - path: "src/lib/stores/toast.svelte.ts"
      provides: "show(msg, opts?) with optional action + duration; act(); dismiss()"
      contains: "action = $state"
    - path: "src/lib/stores/toast.svelte.test.ts"
      provides: "fake-timer unit tests for duration/action/supersede semantics"
    - path: "src/lib/components/ToastHost.svelte"
      provides: "renders toast.action as a real <button>"
      contains: "toast.act()"
    - path: "src/lib/stores/player.svelte.ts"
      provides: "removeFromQueue returns QueueRemoval | null; restoreToQueue(r) reverses it"
      contains: "restoreToQueue"
    - path: "src/lib/components/NowPlaying.svelte"
      provides: "queueSwipeRemove wires removal → undo toast"
      contains: "restoreToQueue"
    - path: "src/lib/i18n/en.ts"
      provides: "toast.removedFromQueue + toast.undo keys"
      contains: "toast.undo"
  key_links:
    - from: "src/lib/components/NowPlaying.svelte"
      to: "player.restoreToQueue"
      via: "toast action callback closing over the QueueRemoval receipt"
      pattern: "run: \\(\\) => player\\.restoreToQueue"
    - from: "src/lib/components/ToastHost.svelte"
      to: "toast.act"
      via: "onclick on the action button"
      pattern: "toast\\.act\\(\\)"
    - from: "src/lib/stores/player.svelte.ts restoreToQueue"
      to: "removedUids"
      via: "removedUids.delete(uid) so regen/grow exclusion is lifted"
      pattern: "removedUids\\.delete"
---

<objective>
Make the Up Next swipe-left removal (shipped in quick-260910-nx6) reversible: show a toast "Removed from queue" with an Undo button; Undo puts the track back exactly where it was and fully reverses the side-state (`removedUids`, `manualUids`) so the removal leaves no trace.

Purpose: swipe-left is currently silent and irreversible — a mis-swipe permanently excludes a song from the session (D-10 `removedUids`) with no feedback.
Output: toast store with an optional action + per-call duration, a `<button>` in ToastHost, a `removeFromQueue` → `QueueRemoval` receipt + paired `restoreToQueue` in the player, the NowPlaying wiring, 2 new i18n keys × 15 locales, unit tests.
</objective>

<execution_context>
@/Users/laichan/.claude/plugins/cache/gsd-plugin/gsd/4.5.3/workflows/execute-plan.md
@/Users/laichan/.claude/plugins/cache/gsd-plugin/gsd/4.5.3/templates/summary.md
</execution_context>

<context>
@./CLAUDE.md
@src/lib/stores/toast.svelte.ts
@src/lib/components/ToastHost.svelte
@src/lib/stores/player.svelte.ts (removeFromQueue at ~2254; `manualUids` ~817, `removedUids` ~825 are plain private Sets, NOT $state)
@src/lib/components/NowPlaying.svelte (queueSwipeRemove ~674; Up Next row ~1486)
@src/lib/stores/player.svelte.test.ts (describe 'player.removeFromQueue / clearQueue / removedUids' at ~3600 — extend this block; `mk()` helper at 141; the block's beforeEach resets mockSimilar/queue; private-Set access idiom is `(player as unknown as { manualUids: Set<string> }).manualUids`)
@src/lib/i18n/i18n.test.ts (all-15-locale key parity guard)
@src/routes/(app)/+layout.svelte (lines 187-200 + 325-365: the existing never-stop notice pill with a Retry button — copy its `.retry` button style and flex row layout, do NOT touch this file)

<interfaces>
<!-- Existing contracts the executor builds against. Use directly. -->

From src/lib/stores/toast.svelte.ts (current):
```ts
class Toast { msg = $state(''); show(msg: string): void }   // hardcoded 2000ms, one at a time
export const toast: Toast;
```

From src/lib/stores/player.svelte.ts (current):
```ts
private manualUids = new Set<string>();   // plain Set, not $state
private removedUids = new Set<string>();  // plain Set, not $state
queue = $state<Track[]>([]);
removeFromQueue(uid: string): void   // early-return if uid === current?.uid; removedUids.add; manualUids.delete; filter queue; persist()
private persist(): void
```

From src/lib/actions/tapBounce.ts: `use:tapBounce` (already imported in NowPlaying; import it in ToastHost).
From src/lib/i18n/index.ts: `t(key: TranslationKey, params?)` — `TranslationKey` = keyof en dict.
</interfaces>
</context>

<tasks>

<task type="auto" tdd="true">
  <name>Task 1: Player — removeFromQueue returns a receipt; restoreToQueue reverses it exactly</name>
  <files>src/lib/stores/player.svelte.ts, src/lib/stores/player.svelte.test.ts</files>
  <behavior>
    Add to the existing describe block at ~3600 (reuse its beforeEach + `mk()`):
    - removeFromQueue(b.uid) on queue [a,b,c] returns `{ track: b, index: 1, wasManual: false, wasExcluded: false }`
    - removeFromQueue(current.uid) returns `null` and leaves the queue unchanged (CR-01 — keep the existing test, add the null assertion)
    - restoreToQueue(receipt) after removing b from [a,b,c] yields [a,b,c] again (ORIGINAL index 1, not appended)
    - after remove b (pinned via addToQueue) then restore: `manualUids.has(b.uid) === true`; after remove b (never pinned) then restore: `manualUids.has(b.uid) === false`
    - after remove+restore, `regenerate(seed)` exclude-Set does NOT contain b.uid (removedUids really cleared); after remove WITHOUT restore it does (existing D-10 test stays green)
    - restoreToQueue is idempotent: calling it twice, or when the uid is already in the queue, does not duplicate the entry
    - restoreToQueue clamps: receipt.index larger than the current queue length appends at the end rather than leaving a hole
  </behavior>
  <action>
    In `player.svelte.ts`, next to `removeFromQueue`:

    1. Export a type `QueueRemoval = { track: Track; index: number; wasManual: boolean; wasExcluded: boolean }` (module-level `export type`, PascalCase per conventions). It is the receipt a caller holds to reverse the removal.

    2. Change `removeFromQueue(uid: string): QueueRemoval | null`. Keep the CR-01 early return but `return null`. Before mutating, capture `index = this.queue.findIndex(t => t.uid === uid)`; if `index === -1` return null (nothing to remove — nothing to undo). Capture `wasManual = this.manualUids.has(uid)` and `wasExcluded = this.removedUids.has(uid)` BEFORE the add/delete. Then perform the existing four mutations unchanged and return the receipt with `track: this.queue[index]` (captured before the filter).

    3. Add `restoreToQueue(r: QueueRemoval): void` — the exact inverse (tag comment `quick-260910-omt`):
       - If `this.queue.some(t => t.uid === r.track.uid)` return (idempotent; a stale double-tap must not duplicate).
       - Re-read `this.queue` at write time (Pitfall 1 — never a closed-over snapshot): `const q = [...this.queue]; q.splice(Math.min(r.index, q.length), 0, r.track); this.queue = q;`. Original index is the contract; the clamp only matters if the queue shrank in the ~5s window.
       - `if (!r.wasExcluded) this.removedUids.delete(r.track.uid)` — lift the D-10 session exclusion ONLY if this removal introduced it (a uid that was already excluded before this swipe keeps that prior state).
       - `if (r.wasManual) this.manualUids.add(r.track.uid)` — restore the pin only if it existed.
       - `this.persist()`.

    4. Update the removeFromQueue doc comment: it now returns the receipt consumed by `restoreToQueue` (the Up Next undo toast). Do not remove existing D-10 / CR-01 / Pitfall 1 references.

    Write the tests first (RED), then implement (GREEN). Do not touch any other player method — supersession of a pending undo is handled in the toast layer (Task 2), not here.
  </action>
  <verify>
    <automated>cd /Users/laichan/code/tung/openmusic && pnpm vitest --run src/lib/stores/player.svelte.test.ts -t "removeFromQueue"</automated>
  </verify>
  <done>All behaviors above pass; the pre-existing removeFromQueue/regenerate D-10 tests still pass; `QueueRemoval` is exported; no component reaches into `manualUids`/`removedUids`.</done>
</task>

<task type="auto" tdd="true">
  <name>Task 2: Toast store — optional action + duration; ToastHost renders the button</name>
  <files>src/lib/stores/toast.svelte.ts, src/lib/stores/toast.svelte.test.ts, src/lib/components/ToastHost.svelte</files>
  <behavior>
    New `src/lib/stores/toast.svelte.test.ts` (node Vitest, `vi.mock('$app/environment', () => ({ browser: true }))`, `vi.useFakeTimers()` in beforeEach, `vi.useRealTimers()` in afterEach — same idiom as player.svelte.test.ts ~1264):
    - show('a') → msg 'a', action null; advance 2000ms → msg '' (default duration unchanged)
    - show('a', { action: { label: 'Undo', run } }) → action set; advance 2000ms → STILL visible; advance to 5000ms total → msg '' and action null, run NOT called
    - show('a', { duration: 300 }) → cleared after 300ms (explicit override wins)
    - act() calls `run` exactly once and immediately clears msg + action + timer (advancing further does nothing)
    - act() with no action is a no-op
    - supersede: show('a', { action: { run: r1 } }) then show('b') → action null; act() does NOT call r1; advancing 5000ms never calls r1 (stale undo can never fire)
    - supersede with a new action: show('a', {action r1}) then show('b', {action r2}) → act() calls r2 only
  </behavior>
  <action>
    `toast.svelte.ts` (tag `quick-260910-omt`):
    - Add `export type ToastAction = { label: string; run: () => void }` and a reactive field `action = $state<ToastAction | null>(null)` with an explicit generic (convention).
    - Change the signature to `show(msg: string, opts?: { action?: ToastAction; duration?: number }): void`. Every existing `toast.show(msg)` call (42 sites) keeps working because `opts` is optional. Duration: `opts?.duration ?? (opts?.action ? 5000 : 2000)` — 5000 when an action is present so Undo is hittable (decided; do not re-open), 2000 otherwise (locked default). Set `this.action = opts?.action ?? null` on EVERY show so a superseding plain toast drops a pending action — this is the documented answer to "what happens to a pending Undo when superseded": it is discarded, never fired. Store the timer as today; the timeout clears both `msg` and `action`.
    - Add `act(): void` — `const a = this.action; if (!a) return; this.dismiss(); a.run();` (dismiss BEFORE run so a callback that itself shows a toast is not immediately wiped).
    - Add `dismiss(): void` — clear timer, `msg = ''`, `action = null`.
    - Update the header comment: replace "The 2000ms duration is locked" with the new rule (2000 default / 5000 with action / explicit override), and document the supersede-drops-action contract.

    `ToastHost.svelte`:
    - Import `tapBounce` from `$lib/actions/tapBounce`.
    - Keep the container `<div class="toast" role="status" aria-live="polite" transition:fly>`. Inside: `<span class="msg">{toast.msg}</span>` and `{#if toast.action}<button type="button" class="act" onclick={() => toast.act()} use:tapBounce>{toast.action.label}</button>{/if}`. Text content only for both — still no `{@html}` (T-23-01); update the comment to say so and note the action button.
    - Accessibility: a native `<button>` inside the polite live region is keyboard-focusable and has its accessible name from its text; the live region announces "Removed from queue Undo" as one utterance. Keep `role="status"` (not `alert`) and do not add `aria-hidden` anywhere. Give the button a ≥ 32px tap target via padding.
    - Styles: make `.toast` a flex row (`display:flex; align-items:center; gap:12px; max-width:min(92vw,520px)`), keep the existing pill values byte-identical otherwise (grandfathered per UI-SPEC §1). Add `.toast .act` copied from `+layout.svelte` `.notice-toast .retry` (flex:none; primary background; white text; 999px radius; 5px 14px padding; 13px/600). Do NOT edit +layout.svelte.
  </action>
  <verify>
    <automated>cd /Users/laichan/code/tung/openmusic && pnpm vitest --run src/lib/stores/toast.svelte.test.ts && pnpm check 2>&1 | tail -5</automated>
  </verify>
  <done>Toast tests green; `pnpm check` reports 0 errors (proves all 42 existing `toast.show(msg)` sites typecheck unchanged); ToastHost renders a real `<button>` only when an action is present.</done>
</task>

<task type="auto">
  <name>Task 3: Wire NowPlaying swipe-left → undo toast; add the two i18n keys to all 15 locales</name>
  <files>src/lib/components/NowPlaying.svelte, src/lib/i18n/en.ts, src/lib/i18n/ar.ts, src/lib/i18n/de.ts, src/lib/i18n/es.ts, src/lib/i18n/fr.ts, src/lib/i18n/hi.ts, src/lib/i18n/id.ts, src/lib/i18n/it.ts, src/lib/i18n/pt.ts, src/lib/i18n/ru.ts, src/lib/i18n/th.ts, src/lib/i18n/tr.ts, src/lib/i18n/vi.ts, src/lib/i18n/zh-Hans.ts, src/lib/i18n/zh-Hant.ts</files>
  <action>
    NowPlaying.svelte `queueSwipeRemove` (~674): 
    `const r = player.removeFromQueue(track.uid); if (!r) return;` then `toast.show(t('toast.removedFromQueue'), { action: { label: t('toast.undo'), run: () => player.restoreToQueue(r) } }); hapticTick();`. The Undo callback lives here in the UI layer (stores stay i18n-free and never import UI); it closes over the receipt `r`, never over private player state. Rewrite the nx6 comment above it — it currently says "No toast on remove: the row vanishing IS the feedback and no i18n key exists" — replace with the quick-260910-omt rationale (silent + irreversible removal → undo toast; the receipt/restore pair reverses queue index, `removedUids` and `manualUids`; a superseding toast discards the pending undo by toast-store contract).

    i18n — add TWO keys to every locale, placed right after `"toast.addedToQueue"` in each file, DOUBLE QUOTES for key and value (manual convention). Match each locale's existing noun for "queue" from its `toast.addedToQueue` entry:
    - en: `"toast.removedFromQueue": "Removed from queue"`, `"toast.undo": "Undo"`
    - zh-Hant: `"已從待播清單移除"`, `"復原"`
    - zh-Hans: `"已从待播列表移除"`, `"撤销"`
    - de: `"Aus der Warteschlange entfernt"`, `"Rückgängig"`
    - es: `"Eliminado de la cola"`, `"Deshacer"`
    - fr: `"Retiré de la file d'attente"`, `"Annuler"`
    - it: `"Rimosso dalla coda"`, `"Annulla"`
    - pt: `"Removido da fila"`, `"Desfazer"`
    - ru: `"Удалено из очереди"`, `"Отменить"`
    - ar: `"تمت الإزالة من قائمة الانتظار"`, `"تراجع"`
    - hi: `"कतार से हटाया गया"`, `"पूर्ववत करें"`
    - id: `"Dihapus dari antrean"`, `"Urungkan"`
    - th: `"ลบออกจากคิวแล้ว"`, `"เลิกทำ"`
    - tr: `"Sıradan kaldırıldı"`, `"Geri al"`
    - vi: `"Đã xóa khỏi hàng đợi"`, `"Hoàn tác"`

    Then run the full gates: `pnpm check` (0 errors — `TranslationKey` is derived from `en`, so a typo in the key used in NowPlaying is a compile error) and `pnpm test` (i18n.test.ts parity across all 15 locales + the new toast/player tests + the rest of the ~101 files). Do NOT `git push`, deploy, or build the APK.
  </action>
  <verify>
    <automated>cd /Users/laichan/code/tung/openmusic && pnpm check 2>&1 | tail -3 && pnpm test 2>&1 | tail -8 && grep -c '"toast.undo"' src/lib/i18n/*.ts | grep -vc ':1$'</automated>
  </verify>
  <done>`pnpm check` 0 errors; `pnpm test` fully green (parity test proves 15/15 locales carry both keys); the last grep prints 0 (every locale file has exactly one `toast.undo`); NowPlaying swipe-left calls `restoreToQueue` from the toast action.</done>
</task>

<task type="checkpoint:human-verify" gate="blocking">
  <name>Task 4: Behavioural verification of the undo toast on the live app</name>
  <what-built>Up Next swipe-left now shows a "Removed from queue · Undo" toast (~5s). Undo restores the track at its original position and lifts the regen exclusion; expiry makes the removal permanent; a superseding toast discards the pending undo.</what-built>
  <how-to-verify>
    Run `pnpm dev` (port 4321 or 5173 — probe). kuwo resolves in this sandbox, so search any song, play it, open the expanded now-playing and scroll to Up Next (needs ≥ 3 rows; queue more via swipe-right on Related if needed).
    1. Swipe LEFT on the 2nd non-current row. Expected: row disappears, toast "Removed from queue" with an "Undo" button appears at the top. Verify the button is keyboard-reachable (Tab lands on it) on desktop.
    2. Tap Undo within 5s. Expected: the row reappears at the SAME position (between the same neighbours), toast dismisses immediately.
    3. Let the current song reach its end (or seek near the end) so the queue auto-grows / regenerates. Expected: the undone track is still there and was not silently dropped (proves `removedUids` was cleared).
    4. Swipe LEFT another row and wait > 5s without tapping. Expected: toast clears on its own; the row stays gone; open Settings → Activity log / reload — the track does not come back.
    5. Swipe LEFT a row, then immediately swipe RIGHT on a Related row (fires "Added to queue"). Expected: the second toast has NO Undo button; the removed row stays removed; the queue has no duplicate entries.
    6. Confirm swipe-left on the currently-playing row still does nothing (no toast).
    7. Switch app language to 繁體中文 in Settings and repeat step 1: toast reads "已從待播清單移除 · 復原".
  </how-to-verify>
  <files>none — verification only</files>
  <action>Start the dev server, then walk the user through the numbered steps in how-to-verify. Do not edit code in this task; report back any failing step for a follow-up.</action>
  <verify><human-check>Steps 1-7 in how-to-verify observed on the live app</human-check></verify>
  <done>User types "approved" (all 7 steps behave as expected)</done>
  <resume-signal>Type "approved" or describe what misbehaved (step number + observed vs expected)</resume-signal>
</task>

</tasks>

<threat_model>
## Trust Boundaries

| Boundary | Description |
|----------|-------------|
| toast text → DOM | localized strings rendered into the live region |
| toast action callback → player queue | UI closure mutates queue state via a public method |

## STRIDE Threat Register

| Threat ID | Category | Component | Disposition | Mitigation Plan |
|-----------|----------|-----------|-------------|-----------------|
| T-omt-01 | Tampering | ToastHost render | mitigate | text-content interpolation only for msg AND action label — no `{@html}` (T-23-01 preserved) |
| T-omt-02 | Tampering | stale undo closure vs moved-on queue | mitigate | supersede clears `action`; `restoreToQueue` is idempotent (uid-present check) and index-clamped; never touches private state from the component |
| T-omt-03 | Denial of Service | double-tap Undo | mitigate | `act()` dismisses before running so the second tap finds `action === null` |
| T-omt-SC | Tampering | npm installs | accept | no new dependencies in this plan |
</threat_model>

<verification>
- `pnpm check` → 0 errors (all 42 pre-existing `toast.show(msg)` callers compile unchanged; new i18n keys exist in `en`).
- `pnpm test` → green, including the 15-locale parity test, new `toast.svelte.test.ts`, and the extended removeFromQueue block.
- Human checkpoint steps 1-7 approved.
</verification>

<success_criteria>
- Swipe-left removal is reversible for ~5s via a visible, focusable Undo button.
- Undo restores original index + manual pin + lifts `removedUids`; verified by unit tests and live regen (step 3).
- Expired or superseded undo never fires; queue never duplicates.
- No push/deploy/APK build performed.
</success_criteria>

<output>
Create `.planning/quick/260910-omt-undo-able-remove-toast-for-up-next-swipe/260910-omt-SUMMARY.md` when done
</output>
