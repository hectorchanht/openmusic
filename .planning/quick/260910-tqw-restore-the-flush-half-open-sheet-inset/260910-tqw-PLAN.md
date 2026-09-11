---
phase: quick-260910-tqw
plan: 01
type: execute
wave: 1
depends_on: []
files_modified:
  - src/lib/components/NowPlaying.svelte
autonomous: false
requirements: [quick-260910-tqw]

must_haves:
  truths:
    - "Resting in HALF — entered via the Related subnav tap (selectTab) AND via the grip — the sheet's top edge is flush with the transport row: |sheet.top - transport.bottom| <= 1px, measured after settling"
    - "CLOSED keeps its 22px transport→grip peek spacing from 76ade46 (unchanged); FULL is unaffected (.np.fullshrink hides .transport)"
    - "Entering half is a glide, not a hitch: the 22px margin collapse runs on the same 0.32s cubic-bezier(.22,1,.36,1) as the .cover/.meta reflow"
    - "No `effect_update_depth_exceeded` after entering half and the Related tab still populates (.rel-row > 0, 0 skeleton rows) — quick-260910-soj not regressed"
    - "The BUG-2 settled re-measure (untrack(measureOffsets) + cover transitionend + double-rAF + 340ms fallback) and measureOffsets' single halfOffset write are byte-identical"
    - "`applyHalfInset` and `--sheet-half-top` no longer exist anywhere in the file; no new $effect or $state"
  artifacts:
    - path: "src/lib/components/NowPlaying.svelte"
      provides: ".np.reflow .transport { margin-bottom: 0; } + transition: margin 0.32s on .transport; the inert half-inset machinery (function, 2 call sites, style:inset half branch, CSS var fallback) removed"
      contains: ".np.reflow .transport { margin-bottom: 0; }"
  key_links:
    - from: "<section class=\"np\" class:reflow={sheetState !== 'closed'}>"
      to: ".np.reflow .transport { margin-bottom: 0; }"
      via: "CSS class toggle — every half entry path (selectTab tap, gripKey Enter, gripUp snapTimer) converges on sheetState = 'half'"
      pattern: "\\.np\\.reflow \\.transport \\{ margin-bottom: 0; \\}"
    - from: ".transport rule"
      to: ".cover / .meta 0.32s reflow"
      via: "transition: margin 0.32s cubic-bezier(.22,1,.36,1) — identical personality so sheet top, cover and meta settle together"
      pattern: "margin: 10px 4px 22px; transition: margin 0\\.32s cubic-bezier\\(\\.22,1,\\.36,1\\);"
---

<objective>
Make the half-open Now Playing sheet rest flush against the transport row (today it sits 22px below it), and retire the inert `applyHalfInset()` / `--sheet-half-top` machinery that has misled two diagnoses into thinking an inset positions the sheet.

Purpose: user-visible dead gap in the most-used sheet state; plus removing a dead-code trap in a documented re-render hotspot.
Output: two CSS declarations and ~15 lines of deletions in `NowPlaying.svelte`, with a tagged decision record; no other file changes.
</objective>

<execution_context>
@/Users/laichan/.claude/plugins/cache/gsd-plugin/gsd/4.5.3/workflows/execute-plan.md
@/Users/laichan/.claude/plugins/cache/gsd-plugin/gsd/4.5.3/templates/summary.md
</execution_context>

<context>
@.planning/STATE.md
@CLAUDE.md
@src/lib/components/NowPlaying.svelte
@.planning/quick/260910-soj-fix-the-measureoffsets-self-invalidating/260910-soj-PLAN.md

<diagnosis>
Read at plan time, not assumed. The orchestrator's trace was right about the symptom (22px), the dead `applyHalfInset` stub (`df3221d`), and the loop-safety of the soj fix — but wrong at the load-bearing point, so BOTH of its candidate designs are no-ops:

1. **The sheet is `position: static` in every state.** `.sheet.half { /* position: absolute; */ … }` and `.sheet.full { /* position: absolute; */ … }` were commented out in `f251ed0` ("way better dragging ux", 2026-06-13 02:52 — 47 minutes AFTER `df3221d`). The `<style>` block has no other `position:` for `.sheet`, and no global stylesheet touches `.sheet`/`.transport`. `inset` (shorthand for top/right/bottom/left) applies only to positioned elements, so the inline `style:inset`, the `.sheet.half { inset: var(--sheet-half-top, 260px) 0 0 0 }` fallback, and anything `applyHalfInset()` would write into `--sheet-half-top` ALL have zero layout effect. Design (a) (un-stub) and design (b) (drive `style:inset` from `halfOffset`) would both leave the gap at exactly 22px. This is also why the `df3221d` stub never caused a visible regression: 47 minutes later the whole inset path went inert — the stub was dead-on-arrival, not the cause of the gap.

2. **The 22px IS `.transport`'s bottom margin.** DOM: `.np` (fixed, flex column, no `gap`) → `.np-top` (wrapper, `touch-action: pan-x`, no padding/margin; last child `.transport`) → `.sheet`. `.np-top` is a flex item, so it establishes an independent formatting context and `.transport`'s `margin-bottom` does NOT collapse through it — it adds to `.np-top`'s box. `.sheet.half { margin-top: 0 }`. Gap = `.transport { margin: 10px 4px 22px }` bottom margin = 22px, exactly the measured value. Origin: `76ade46` "remove grip padding" (2026-07-11) changed `.transport` margin `10px 4px` → `10px 4px 22px` and `.grip` padding `16px 0 0` → `0`, i.e. it moved the grip's 16px top padding into the transport's bottom margin so the CLOSED peek kept its spacing. The grip lives INSIDE the sheet and the transport OUTSIDE it, so the move also pushed the half-open sheet's top 22px below the transport (it had been 10px since `f251ed0`).

3. **`halfOffset` is not "thrown away".** Since `f251ed0` the template's `style:transform` uses `gripMoved` directly; `halfOffset` feeds `offsetFor()` → `sheetDragY` → the nearest-target snap decision in `gripUp`/`npTopUp` (`dHalf = |pos - halfOffset|`). The BUG-2 `$effect` keeps that snap geometry accurate after the cover reflow. It has never positioned the RESTING sheet since `f251ed0`; the "reactive so the resting-half transform updates" wording on its declaration is stale (left alone — soj's constraint: keep `halfOffset` as-is, proving otherwise is not this task). Side effect of this fix: with the margin gone, `halfOffset` (= transport.bottom − np.top) finally equals the real resting half top, so the snap math's notion of "half" matches the layout.
</diagnosis>

<decision>
Chosen: **design (c)** — collapse the transport's bottom margin while the sheet is half/full, transitioned like `.meta`:

- `.np.reflow .transport { margin-bottom: 0; }` — `.np.reflow` is already `class:reflow={sheetState !== 'closed'}` and already hosts per-state overrides (`.np.reflow .meta { margin-top: -42px }`), so this reuses the existing state hook (ponytail rung 2/4: existing pattern, CSS over JS). Closed keeps 22px (76ade46's peek spacing untouched); full hides `.transport` via `.np.fullshrink` so the rule is moot there.
- `.transport { …; transition: margin 0.32s cubic-bezier(.22,1,.36,1); }` — mirrors `.meta`'s exact declaration for the same reflow. Without it the 22px collapse is an instant hitch at t=0 while the cover glides 320ms (the "visible jump" constraint); with the same duration/curve the sheet top, cover and meta settle at the same instant. Margin is outside the border box, so this transition does not change `transportEl.getBoundingClientRect().bottom` (BUG-2's measurement) and its `transitionend` bubbles `.transport → .np-top → .np`, never reaching `coverEl`'s one-shot listener.

Rejected: (a)/(b) — no-ops on a static element; making them work means re-enabling `position: absolute`, reverting `f251ed0`'s normal-flow drag UX and re-validating the whole gesture machinery (a redesign, not a fix). `.sheet.half { margin-top: -22px }` — magic-number coupling to the transport's margin; collapsing the margin at its source is the direct fix.

Retire the inert machinery cleanly (constraint): `applyHalfInset()` (function + commented body), its two call sites, the `style:inset` half branch, and the `.sheet.half` `inset:` line with its stale `halfSheetTop()` comment. KEPT on purpose: both `/* position: absolute; */` lines (f251ed0's decision record, cited by the new comment); the `inset 0.28s` token in `style:transition` and the `.sheet.full` / `.np.fullshrink .sheet.full` `inset` rules — equally inert on a static sheet, but FULL-state and out of this task's scope (recorded, not touched).

Loop-safety (soj, commit 678b287 / 0e39660): zero reactive change — no template read of `halfOffset`, no new `$effect`/`$state`, `measureOffsets` and the half-rest `$effect` untouched. Pure CSS keyed on an existing class cannot form a dependency cycle.
</decision>
</context>

<tasks>

<task type="auto">
  <name>Task 1: Collapse the transport margin in .reflow (transitioned), retire the inert half-inset machinery, check + test</name>
  <files>src/lib/components/NowPlaying.svelte</files>
  <action>
Anchors are plan-time line numbers — grep for the identifiers first, do not trust the numbers blindly.

1. `.transport` rule (~1856, one-liner `.transport { display: flex; align-items: center; justify-content: space-between; margin: 10px 4px 22px; }`): keep it one line and append `transition: margin 0.32s cubic-bezier(.22,1,.36,1);` immediately after `margin: 10px 4px 22px;` so the text reads exactly `margin: 10px 4px 22px; transition: margin 0.32s cubic-bezier(.22,1,.36,1); }` (byte-identical curve/duration to `.meta` ~1804). Keep `margin: 10px 4px 22px` — closed-state peek spacing from 76ade46 is preserved. Add a short comment on the line above tagged `quick-260910-tqw`: the margin glides with the .cover/.meta reflow (same 0.32s curve); see `.np.reflow .transport`.

2. Directly after `.np.reflow .meta { … }` (~1810) add the new rule `.np.reflow .transport { margin-bottom: 0; }` (exactly that text, one line) preceded by a `quick-260910-tqw FLUSH HALF REST` comment block recording the decision in the house style: (i) in half the sheet is a static flex item following `.np-top` in normal flow — `position: absolute` was removed in f251ed0 ("way better dragging ux") — so the ONLY thing between transport.bottom and sheet.top is `.transport`'s margin-bottom; (ii) 76ade46 ("remove grip padding") moved the grip's 16px padding-top into that margin (10px → 22px) to keep the CLOSED peek spacing, which also pushed the half-open sheet 22px below the transport; (iii) collapsing it in `.reflow` makes half rest flush, closed keeps 22px, full hides `.transport` anyway (`.np.fullshrink`); (iv) inset-based designs — inline `style:inset`, `--sheet-half-top`, a `halfOffset`-driven inset — are no-ops on a static element, which is why df3221d's `applyHalfInset` stub never changed anything and why it is removed now; (v) `halfOffset` / `measureOffsets` / the half-rest effect are untouched: they feed the grip snap-decision geometry (`offsetFor → sheetDragY`), not the resting position, and with the margin gone `halfOffset` now equals the real half top. Do not write the literal tokens `$state(` or `$effect(` in this comment (the diff gate below counts them).

3. Retire the inert machinery — remove ALL of the following, leaving no dangling reference:
   a. The whole `function applyHalfInset() { return; // … }` (~1309-1318) including its commented-out body and the surrounding extra blank line.
   b. In `gripUp`'s `snapTimer` callback (~1137): delete `if (target === 'half') applyHalfInset();`. Keep `sheetState = target; sheetDragging = false; sheetDragY = 0;` and the 290ms.
   c. In `selectTab` (~1179-1181): delete the two comment lines ("small delay so layout is ready before we measure inset" / "(2 frames + short timeout is safer than immediate)") and `setTimeout(() => applyHalfInset(), 30);`. The `if (sheetState === 'closed') { sheetState = 'half'; }` block stays.
   d. The `style:inset` attribute (~1542-1547): drop the half branch and collapse to the single line `style:inset={sheetState === 'full' ? '0' : undefined}` — half now emits no inline inset (the old value was inert anyway), full output byte-identical (`inset: 0`). Do NOT touch the `style:transition` string.
   e. `.sheet.half` (~1873-1886): delete the line `/* inset-top will be set via inline style using halfSheetTop() */` and the line `inset: var(--sheet-half-top, 260px) 0 0 0;`. KEEP `/* position: absolute; */`. Extend the block's leading comment ("Half-open: sheet occupies the real area below the transport row, no transform hack.") with a `quick-260910-tqw` sentence: static since f251ed0 (the commented `position: absolute` is deliberate), so `inset` cannot move it — the `--sheet-half-top` / applyHalfInset() path was inert and is gone; the flush rest comes from `.np.reflow .transport { margin-bottom: 0 }`.

4. Do NOT touch: `measureOffsets` (single `halfOffset` write from `rawHalf`), `halfOffset`/`closedOffset` declarations, the half-rest `$effect` and its BUG-2 + quick-260910-soj comment blocks, `untrack(() => measureOffsets())`, `onSettled`, `offsetFor`, `gripKey`, `gripDown`, `.meta`, `.grip`, `.sheet.full`, `.np.fullshrink .sheet.full`, the `inset 0.28s` transition token. No new `$effect`, no new `$state`, no other file.

5. Run `pnpm check` (0 errors — also proves no dangling `applyHalfInset` reference survived) and the full `pnpm test` (all green; regression only — this change is CSS + deletions with no node-testable surface).
  </action>
  <verify>
    <automated>cd /Users/laichan/code/tung/openmusic && F=src/lib/components/NowPlaying.svelte && [ "$(grep -c 'applyHalfInset' "$F")" = "0" ] && [ "$(grep -c 'sheet-half-top' "$F")" = "0" ] && [ "$(grep -cF '.np.reflow .transport { margin-bottom: 0; }' "$F")" = "1" ] && grep -qF 'margin: 10px 4px 22px; transition: margin 0.32s cubic-bezier(.22,1,.36,1); }' "$F" && [ "$(grep -cF "style:inset={sheetState === 'full' ? '0' : undefined}" "$F")" = "1" ] && [ "$(grep -cF '/* position: absolute; */' "$F")" = "2" ] && [ "$(grep -c 'quick-260910-tqw' "$F")" -ge 2 ] && grep -qF 'untrack(() => measureOffsets())' "$F" && grep -qF 'const onSettled = () => measureOffsets();' "$F" && grep -qF 'BUG-2 ROOT CAUSE FIX' "$F" && grep -qF 'quick-260910-soj' "$F" && grep -qF 'let halfOffset = $state(150)' "$F" && [ "$(sed -n '/^\tfunction measureOffsets()/,/^\t}/p' "$F" | grep -v '^\s*//' | grep -c 'halfOffset = ')" = "1" ] && [ "$(git diff HEAD -- "$F" | grep -c '^+.*\$effect(')" = "0" ] && [ "$(git diff HEAD -- "$F" | grep -c '^+.*\$state[(<]')" = "0" ] && [ "$(git diff --name-only HEAD -- src | tr '\n' ' ')" = "src/lib/components/NowPlaying.svelte " ] && pnpm check 2>&1 | tail -2 && pnpm test 2>&1 | tail -5</automated>
  </verify>
  <done>`applyHalfInset` and `sheet-half-top` occur 0 times; `.np.reflow .transport { margin-bottom: 0; }` exactly once; `.transport` carries `margin: 10px 4px 22px; transition: margin 0.32s cubic-bezier(.22,1,.36,1);`; `style:inset` is the single full-only line; both `/* position: absolute; */` records kept; `quick-260910-tqw` tag present at least twice; soj/BUG-2 anchors (`untrack(() => measureOffsets())`, `onSettled`, `BUG-2 ROOT CAUSE FIX`, `quick-260910-soj`, `$state(150)`, one `halfOffset =` write) intact; no added `$effect(`/`$state(` lines; only `NowPlaying.svelte` modified under `src/`; `pnpm check` 0 errors; `pnpm test` green.</done>
</task>

<task type="checkpoint:human-verify" gate="blocking">
  <name>Task 2: Measured verification — flush half on both entry paths, closed unchanged, no depth error, Related populates</name>
  <files>none — verification only</files>
  <action>Run the numbered checks below against the dev server and report results. If the executor has a browser tool, run the console snippets itself first and paste the raw outputs into the checkpoint message; the human then confirms and does the real-browser items. No code changes in this task.</action>
  <what-built>`.np.reflow .transport { margin-bottom: 0; }` (transitioned 0.32s like `.meta`) makes the static, normal-flow sheet rest exactly at the transport's bottom edge in half; the inert `applyHalfInset` / `--sheet-half-top` / `style:inset` half branch are deleted. BUG-2 and soj machinery untouched.</what-built>
  <how-to-verify>
Dev server: `pnpm dev` (probe port 4321 or 5173). Sandbox: netease/qq upstreams are blocked here, kuwo + Deezer work — search results come from kuwo.

ENVIRONMENT CAVEAT (state it plainly in the report): the test browser pane has `requestAnimationFrame` frozen and `document.visibilityState === "hidden"`, so CSS transitions never advance there and the BUG-2 double-rAF never fires (the 340ms `setTimeout` fallback does, throttled to ~1s). Consequence for THIS fix: the new `.transport` margin transition may hold its START value (22px) forever in the pane, so before measuring, disable it inline (step 0) — the layout assertion then reads the settled CSS value synchronously via forced layout (`getBoundingClientRect`, no rAF needed). What CANNOT be confirmed in the pane and needs a real browser/device (step 6): the animated glide of the 22px collapse alongside the cover reflow, the rAF path of BUG-2, and finger-drag snap feel.

Setup: hard reload with DevTools open; clear the console. Search an artist (e.g. "Coldplay"), tap a song so it plays, expand Now Playing (sheet starts CLOSED).

0. Baseline + helper. In the console run:
   `window.__m = () => { const s = document.querySelector('.np .sheet'); const t = document.querySelector('.np .transport'); return { state: s.classList.contains('half') ? 'half' : s.classList.contains('full') ? 'full' : 'closed', gap: +(s.getBoundingClientRect().top - t.getBoundingClientRect().bottom).toFixed(2), sheetPosition: getComputedStyle(s).position, transportMarginBottom: getComputedStyle(t).marginBottom, inlineInset: s.style.inset || '(none)' }; }; document.querySelector('.np .transport').style.transition = 'none'; __m()`
   Expect (closed): `{ state: 'closed', gap: 22, sheetPosition: 'static', transportMarginBottom: '22px', inlineInset: '(none)' }` — confirms the premise (static sheet, 22px = the margin) and that closed is unchanged.

1. Tap path (selectTab): `document.querySelector('.subnav button[data-tab="related"]').click()`; wait >= 1.5s (lets the throttled 340ms fallback fire); run `__m()`. Expect `state: 'half'`, `|gap| <= 1` (should read 0), `transportMarginBottom: '0px'`, `inlineInset: '(none)'`. Console: NO `effect_update_depth_exceeded` / "Maximum update depth exceeded", no other uncaught error. Record the object and the console state.

2. Related populates (soj regression): still on Related, wait for the fan-out (~3-8s in sandbox). Run `[document.querySelectorAll('.rel-row').length, document.querySelectorAll('.panel .row.skel').length]`. Expect `[>0, 0]`.

3. Grip path via keyboard (`gripKey` sets the same `sheetState` the drag snap ends in): `const g = document.querySelector('.grip'); g.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));` → half→closed; wait 1.5s; `__m()` expect `state: 'closed', gap: 22, transportMarginBottom: '22px'`. Dispatch Enter again → closed→half; wait >= 1.5s; `__m()` expect `state: 'half'`, `|gap| <= 1`, `'0px'`. Console still clean. Also toggle Related ↔ Up Next twice: no error, `.rel-row` count unchanged.

4. Drag/snap path (gripUp → 290ms snapTimer) — best effort in the pane: `gripDown` calls `setPointerCapture(e.pointerId)`, which throws for synthetic pointer ids, so first stub it: `HTMLElement.prototype.setPointerCapture = () => {};`. Return to closed (Enter on the grip, as in step 3), then run:
   `const g = document.querySelector('.grip'); const ev = (type, y) => g.dispatchEvent(new PointerEvent(type, { pointerId: 1, clientX: 200, clientY: y, bubbles: true, isPrimary: true, pointerType: 'touch' })); ev('pointerdown', 700); ev('pointermove', 650); ev('pointermove', 450); ev('pointerup', 450);`
   Back-to-back synthetic events have near-identical timestamps → upward velocity far above FLICK_V → target 'half' → `snapTimer` commits `sheetState = 'half'` after 290ms. Wait >= 2s; `__m()` expect `state: 'half'`, `|gap| <= 1`, `'0px'`, console clean. If the sequence throws or the state does not change, record the raw error and mark the pointer-drag path as real-browser-only (its terminal write `sheetState = target` is the same `class:reflow` toggle steps 1 and 3 exercised — the fix is CSS keyed on that class, so no entry path can differ).

5. Cleanup: `document.querySelector('.np .transport').style.transition = ''; delete window.__m;` (or just reload).

6. Real browser / device (human): open Now Playing, tap a subnav tab from closed and, separately, drag the grip up to half. Expect the sheet's top edge to glide up together with the shrinking cover (no separate 22px hitch at the start) and rest touching the transport row with no dark gap; collapse to closed — the 22px peek spacing between transport and grip is as before; drag full → half snaps clean. Report what was observed.

Report per step: PASS/FAIL + the raw console output. Do NOT `git push`, deploy, or build an APK — pushes to main auto-deploy production.
  </how-to-verify>
  <verify>
    <human-check>Steps 0-4 reported PASS with raw `__m()` output: closed `gap: 22` / `'22px'` / `static` (baseline + step 3 re-check); half `|gap| <= 1` / `'0px'` / `inlineInset '(none)'` via the Related tap, via grip Enter, and via the synthetic drag (or the drag explicitly marked real-browser-only with the raw error); no `effect_update_depth_exceeded`; `.rel-row > 0` with 0 skeleton rows. Step 6 real-browser glide / flush rest / closed spacing reported, or explicitly deferred.</human-check>
  </verify>
  <done>Human (or executor with browser access, then human) confirms half rests flush (<= 1px) on the tap and grip paths, closed spacing is unchanged at 22px, no depth error, Related populates — all recorded in the SUMMARY with the raw console outputs and the sandbox caveat, plus the real-browser glide observation or an explicit deferral.</done>
  <resume-signal>Type "approved" or describe the failing step (number + raw console output)</resume-signal>
</task>

</tasks>

<threat_model>
## Trust Boundaries

| Boundary | Description |
|----------|-------------|
| CSS state class → layout | `class:reflow` (derived from `sheetState`) drives a margin override; no untrusted input, no reactive JS path added |

## STRIDE Threat Register

| Threat ID | Category | Component | Disposition | Mitigation Plan |
|-----------|----------|-----------|-------------|-----------------|
| T-tqw-01 | DoS (visual regression: wrong rest / instant hitch / closed spacing changed) | `.transport` margin + `.np.reflow .transport` | mitigate | Margin collapse scoped to `.np.reflow` (half/full only); `transition: margin 0.32s` byte-identical to `.meta`; Task 2 measures `|gap| <= 1` in half on two paths AND `gap: 22` in closed. |
| T-tqw-02 | DoS (regression of quick-260910-soj self-invalidation fix) | half-rest `$effect` / `measureOffsets` | mitigate | Zero reactive change — diff gates assert no added `$effect(`/`$state(` lines and the soj/BUG-2 anchors intact; Task 2 step 1-3 watch the console for `effect_update_depth_exceeded` and step 2 confirms Related populates. |
| T-tqw-03 | Tampering (dangling reference / scope creep after deleting applyHalfInset) | NowPlaying.svelte | mitigate | `pnpm check` 0 errors; grep gates `applyHalfInset` = 0 and `sheet-half-top` = 0; `git diff --name-only HEAD -- src` is exactly `NowPlaying.svelte`; both `/* position: absolute; */` records asserted kept. |
| T-tqw-SC | Tampering | npm installs | accept | No dependency changes in this plan. |
</threat_model>

<verification>
- `pnpm check` → 0 errors; `pnpm test` → full suite green (regression only).
- Grep gates (Task 1): `applyHalfInset` 0×, `sheet-half-top` 0×, `.np.reflow .transport { margin-bottom: 0; }` 1×, `.transport` has `margin: 10px 4px 22px; transition: margin 0.32s cubic-bezier(.22,1,.36,1);`, single-line full-only `style:inset`, 2× `/* position: absolute; */`, `quick-260910-tqw` >= 2×, soj/BUG-2 anchors intact, no added `$effect(`/`$state(` lines, only `NowPlaying.svelte` modified under `src/`.
- Browser checkpoint (Task 2): closed baseline `gap: 22` / `static` / `'22px'`; half `|gap| <= 1` / `'0px'` / no inline inset via the Related tap, via grip Enter, and via synthetic drag (or marked real-browser-only); no `effect_update_depth_exceeded`; `.rel-row > 0`, 0 skeleton rows; real-browser glide + flush rest + closed spacing observed or explicitly deferred.
- No `git push`, deploy, or APK build.
</verification>

<success_criteria>
- The half-open sheet rests flush against the transport row (<= 1px) on every entry path; closed keeps its 22px peek spacing; the collapse glides on the cover-reflow curve instead of hitching.
- `applyHalfInset`, its two call sites, the `style:inset` half branch and the `--sheet-half-top` CSS fallback are gone; both `/* position: absolute; */` decision records remain.
- BUG-2 and quick-260910-soj machinery byte-identical; no new `$effect`/`$state`; `player.svelte.ts` untouched.
- Decision recorded in-file (`quick-260910-tqw`): the sheet is static since f251ed0 so inset-based designs are inert; the gap is 76ade46's transport margin; collapse it in `.reflow`, transitioned like `.meta`.
</success_criteria>

<output>
Create `.planning/quick/260910-tqw-restore-the-flush-half-open-sheet-inset/260910-tqw-SUMMARY.md` when done.
</output>
