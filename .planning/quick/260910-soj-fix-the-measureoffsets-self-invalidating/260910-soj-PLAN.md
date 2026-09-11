---
phase: quick-260910-soj
plan: 01
type: execute
wave: 1
depends_on: []
files_modified:
  - src/lib/components/NowPlaying.svelte
autonomous: false
requirements: [quick-260910-soj]

must_haves:
  truths:
    - "With the sheet resting in HALF (entered by tapping a subnav tab from closed), the console shows NO `effect_update_depth_exceeded`"
    - "The Related tab leaves 'Loading related…' and renders `.rel-row` rows once `searchAll(artist)` settles"
    - "The half-open sheet still sits flush against the transport row (|sheet.top - transport.bottom| <= 1px), including via the tap-into-half path and after the 0.32s cover reflow"
    - "The BUG-2 deferred re-measure (transitionend + double-rAF + 340ms fallback) is byte-identical apart from the tagged comment"
    - "`halfOffset` stays `$state`; `closedOffset` stays a plain field; player.svelte.ts has zero diff"
  artifacts:
    - path: "src/lib/components/NowPlaying.svelte"
      provides: "measureOffsets() assigns halfOffset exactly once from a local (never reads the $state it writes); the half-rest $effect calls it under untrack()"
      contains: "untrack(() => measureOffsets())"
  key_links:
    - from: "src/lib/components/NowPlaying.svelte half-rest $effect (~1194)"
      to: "measureOffsets()"
      via: "untrack() wrapper — effect deps become exactly sheetState / sheetDragging / coverEl"
      pattern: "untrack\\(\\(\\) => measureOffsets\\(\\)\\)"
    - from: "measureOffsets()"
      to: "halfOffset ($state)"
      via: "single assignment from local rawHalf — no read of halfOffset inside the function"
      pattern: "halfOffset = Math\\.max\\(20, Math\\.min\\(closedOffset - 20, rawHalf\\)\\)"
---

<objective>
Break the self-invalidating `$effect` in `NowPlaying.svelte` that throws `effect_update_depth_exceeded` when the sheet rests in half, which leaves the component unable to process effects (user-visible: the Related tab sits on "Loading related…" forever although its data arrived).

Purpose: real, pre-existing, user-facing bug (bisected to before `88b37e6`); one of the three documented loop classes in this repo (`restore-effect-self-invalidation-loop`).
Output: two one-line changes in `NowPlaying.svelte` plus tagged decision comments; no other file changes.
</objective>

<execution_context>
@/Users/laichan/.claude/plugins/cache/gsd-plugin/gsd/4.5.3/workflows/execute-plan.md
@/Users/laichan/.claude/plugins/cache/gsd-plugin/gsd/4.5.3/templates/summary.md
</execution_context>

<context>
@.planning/STATE.md
@CLAUDE.md
@src/lib/components/NowPlaying.svelte

<diagnosis>
Root cause (orchestrator-bisected; do NOT re-investigate): `measureOffsets()` (~981-999) writes `halfOffset` ($state, ~967) at ~994 and then at ~998 READS it back and writes it again (`halfOffset = Math.max(20, Math.min(closedOffset - 20, halfOffset))`). The half-rest `$effect` (~1194) calls `measureOffsets()` bare in its synchronous body, so the effect both depends on and writes `halfOffset`. Svelte 5 re-schedules an effect that writes a signal it read (self-invalidation); while the `.cover` 0.32s reflow is in flight each re-run measures a different `transportEl.bottom`, the write is non-equal every time, and the flush trips `effect_update_depth_exceeded` at 1000 iterations. After the throw the component stops processing effects → `relatedLoading` never flips false.

Confirmed at plan time (read, not assumed):
- Call sites: ~924 `startGripFromCover` and ~1053 `gripDown` are pointer handlers (not reactive — leave alone); ~1197 inside the `$effect` is the ONLY reactive caller; ~1200 `onSettled = () => measureOffsets()` is invoked later from `transitionend` / rAF / `setTimeout` tasks where `active_reaction`/`active_effect` are null, so those reads register no dependencies — they need NO `untrack`.
- `untrack` is already imported (line 12) and used for exactly this class at ~639 (`backfillCovers` under untrack, "SELF-INVALIDATION GUARD" comment) and ~784 (`overlays.open`).
- `.transport` (bind ~1494), `.sheet` (~1515) and `.cover` (~1379) are bound unconditionally at top level of `.np`, and `sheetState` starts `'closed'`, so the refs are bound before the effect can pass its half gate. Moving the `sheetEl`/`transportEl` reads under `untrack` loses no needed re-run; the effect still tracks `sheetState`, `sheetDragging` (gate line) and `coverEl` (`const cover = coverEl`).
- OUT OF SCOPE observation (record, do not touch): `applyHalfInset()` (~1293) is a bare `return;` stub and nothing sets `--sheet-half-top`, so `.sheet.half` rests on the CSS fallback / normal flow below the transport row. `halfOffset` therefore has no reactive consumer today — it only feeds the imperative drag/snap math via `offsetFor`. Constraint: keep `halfOffset` as `$state` regardless (its declaration comment calls the reactivity load-bearing; proving otherwise is not this task).
</diagnosis>

<decision>
Chosen: BOTH one-liners, each for a distinct reason.
1. Root cause, in the shared function (the ponytail "fix it once where all callers route through"): compute the measured value into a local and assign `halfOffset` ONCE. `measureOffsets` then never reads the `$state` it writes, so NO caller — present or future — can form a self-dependency through it, and a converging re-measure hits Svelte's equality short-circuit on a single write.
2. House idiom at the only reactive call site: `untrack(() => measureOffsets())`. Matches ~639/~784 and the `restore-effect-self-invalidation-loop` fix, makes the effect's dependency set explicit (`sheetState`, `sheetDragging`, `coverEl` — all written only by gesture/tap handlers, never by `measureOffsets`), and stays correct even if someone later adds a reactive read inside `measureOffsets`. Strictly redundant with (1) for today's code; kept because it costs one token in a file with a documented freeze history.
Not done: no `untrack` on the deferred `onSettled` closures (reasoning above); no extraction of the clamp into a pure function — it is a one-line `Math.max/min`, extracting it for a test would be artificial (constraint + ponytail); no change to `closedOffset` (plain) or `halfOffset` (`$state`); no CSS/template change.
</decision>
</context>

<tasks>

<task type="auto">
  <name>Task 1: Remove the read-write pair in measureOffsets and untrack the effect's call; check + full test suite</name>
  <files>src/lib/components/NowPlaying.svelte</files>
  <action>
Anchors are plan-time line numbers — grep for the identifiers first, do not trust the numbers blindly.

1. In `measureOffsets()` (~981-999): replace the two `halfOffset` assignments (~994-996 and ~998) with a single one. Introduce `const rawHalf = transportEl ? Math.round(transportEl.getBoundingClientRect().bottom - npRect.top) : Math.round(npRect.height * 0.5);` (same expression as today), keep the existing "Flush half-open …" and "Keep ordering sane …" comments where they are, and make the ONLY write `halfOffset = Math.max(20, Math.min(closedOffset - 20, rawHalf));`. Add one comment line tagged `quick-260910-soj` above the write: measureOffsets must never READ the `$state` it writes — computing into a local and assigning once means no reactive caller can become self-invalidating through this function (see the half-rest `$effect`). Leave `closedOffset` logic, the null-ref guard, and the JSDoc untouched.

2. In the half-rest `$effect` (~1194-1215): change the bare `measureOffsets();` after the gate line (~1197) to `untrack(() => measureOffsets());`. Do NOT touch `onSettled`, the `transitionend` listener, the double-rAF, the 340ms fallback, or the cleanup — the BUG-2 mechanism stays byte-identical. Keep the "Measure immediately (best-effort) …" comment.

3. Extend the effect's existing comment block (~1181-1193, keep every existing line incl. "BUG-2 ROOT CAUSE FIX") with a `quick-260910-soj SELF-INVALIDATION GUARD (cf. restore-effect-self-invalidation-loop)` paragraph recording: measureOffsets() writes halfOffset ($state); called bare here the write re-scheduled this effect (Svelte 5 self-invalidation), and during the 0.32s cover reflow each re-run measured a different transportEl.bottom, so the flush hit effect_update_depth_exceeded and the component stopped processing effects (Related stuck on "Loading related…"). untrack() drops halfOffset/sheetEl/transportEl from this effect's deps — sheetState/sheetDragging/coverEl remain tracked via the direct reads — and the refs are bound unconditionally at mount before the sheet can be half, so nothing is lost. The deferred onSettled calls run from transitionend/rAF/setTimeout tasks outside any reaction, register no dependencies, and deliberately are NOT wrapped.

4. Do not edit `src/lib/stores/player.svelte.ts` or any other file. Do not convert `closedOffset` to `$state`; do not remove `$state` from `halfOffset`. The two pointer-handler call sites (~924, ~1053) stay bare.

5. Run `pnpm check` (0 errors) and the full `pnpm test` (all green — regression only; this change has no node-testable surface).
  </action>
  <verify>
    <automated>cd /Users/laichan/code/tung/openmusic && F=src/lib/components/NowPlaying.svelte && [ "$(sed -n '/^\tfunction measureOffsets()/,/^\t}/p' "$F" | grep -v '^\s*//' | grep -c 'halfOffset = ')" = "1" ] && ! sed -n '/^\tfunction measureOffsets()/,/^\t}/p' "$F" | grep -v '^\s*//' | grep -q 'halfOffset))' && [ "$(grep -c 'untrack(() => measureOffsets())' "$F")" = "1" ] && [ "$(grep -c $'^\t\tmeasureOffsets();' "$F")" = "2" ] && grep -q 'const onSettled = () => measureOffsets();' "$F" && grep -q 'let halfOffset = \$state(150)' "$F" && grep -q '^\tlet closedOffset = 300;' "$F" && grep -q 'BUG-2 ROOT CAUSE FIX' "$F" && grep -q 'quick-260910-soj' "$F" && [ "$(git diff --name-only HEAD -- src | tr '\n' ' ')" = "src/lib/components/NowPlaying.svelte " ] && pnpm check 2>&1 | tail -2 && pnpm test 2>&1 | tail -5</automated>
  </verify>
  <done>Inside `measureOffsets` there is exactly ONE non-comment `halfOffset =` assignment and no `halfOffset))` read; `untrack(() => measureOffsets())` appears once (the effect); the two bare pointer-handler calls and the `onSettled` arrow are unchanged; `halfOffset` is still `$state(150)`, `closedOffset` still a plain `300`; BUG-2 comment intact; `quick-260910-soj` tag present; the only modified source file is `NowPlaying.svelte`; `pnpm check` 0 errors; `pnpm test` green.</done>
</task>

<task type="checkpoint:human-verify" gate="blocking">
  <name>Task 2: Behavioural verification — no depth error, Related populates, half-rest still flush</name>
  <files>none — verification only</files>
  <action>Run the numbered checks below against the dev server and report results. If the executor has a browser tool, run the console snippets itself first and paste the raw outputs into the checkpoint message; the human then confirms. No code changes in this task.</action>
  <what-built>`measureOffsets()` no longer reads the `$state` it writes (single assignment from a local) and the half-rest `$effect` calls it under `untrack()`; BUG-2's deferred re-measure is untouched.</what-built>
  <how-to-verify>
Dev server: `pnpm dev` (probe port 4321 or 5173). Sandbox: netease/qq upstreams are blocked here, kuwo + Deezer work — search results come from kuwo; the Related fan-out still completes (the bug was observed here with kuwo 500 and the others 200).

ENVIRONMENT CAVEAT (say so plainly in the report): the test browser pane has `requestAnimationFrame` frozen and `document.visibilityState === "hidden"`. Consequences: the double-rAF re-measure never fires there (the 340ms `setTimeout` fallback still does, throttled to ~1s in a hidden tab); CSS transitions and any visual repaint are NOT observable. So every check below reads state via the console (errors, DOM counts, forced-layout `getBoundingClientRect`), which does not depend on rAF. What CANNOT be confirmed in this pane and needs a real browser/device pass: the animated visual of the sheet snapping into half, the rAF path of the BUG-2 re-measure, and gesture feel of the grip drag.

Setup: hard reload with DevTools open; clear the console. Search an artist (e.g. "Coldplay"), tap a song so it plays, expand Now Playing (sheet starts CLOSED).

1. (a) No depth error via the tap-into-half path — the exact loop trigger: click the "Related" subnav button (from closed this runs `selectTab` → `sheetState = 'half'`; this path never called `measureOffsets()` except through the effect). Wait ~2s. Expect: console shows NO `effect_update_depth_exceeded` / "Maximum update depth exceeded" and no other uncaught error. Then also enter half via the grip: press Enter on the focused grip (`gripKey`) or click the grip — again no error. Record the exact console state ("clean" or paste the error).

2. (b) Related actually populates: still on the Related tab, wait for the fan-out (~3-8s in sandbox). Run in the console: `[document.querySelectorAll('.rel-row').length, document.querySelectorAll('.panel .row.skel').length, !!document.querySelector('.panel .vh')]`. Expect: first number > 0, second number 0, third `false` (no "Loading related…" skeleton or SR label left). Before the fix this reads `[0, 8, true]` forever. Optional confirmation in the Network panel: the `search` requests for the artist completed while the list stayed empty only BEFORE the fix.

3. (c) Half-rest still flush — tap path: with the sheet resting in half (no drag in progress), wait ≥1.5s (lets the throttled 340ms fallback fire) then run: `(() => { const s = document.querySelector('.sheet.half'); const t = document.querySelector('.np .transport'); const np = document.querySelector('.np'); const gap = s.getBoundingClientRect().top - t.getBoundingClientRect().bottom; return { gap, halfTopCss: getComputedStyle(s).getPropertyValue('--sheet-half-top') || '(fallback 260px)', transportBottomRelNp: Math.round(t.getBoundingClientRect().bottom - np.getBoundingClientRect().top) }; })()`. Expect `|gap| <= 1`. Record the object. (`halfTopCss` is informational: it confirms the plan-time observation that nothing sets the var — the flush rest comes from flow, not from `halfOffset`.)

4. (c) Half-rest after a cover reflow: collapse to closed (tap the cover: `half → closed`), wait 1s, re-enter half via the Related button, wait ≥1.5s, re-run the snippet from step 3. Expect `|gap| <= 1` again and still no console error. Then toggle Related ↔ Up Next twice: no error, `.rel-row` count unchanged.

5. No regressions on the untouched paths: drag the grip up to FULL and release, then drag back to half — sheet snaps, no console error; Up Next tab still lists rows; playback unaffected. (Gesture feel itself is not assessable in the pane — state that.)

Report per step: PASS/FAIL + the raw console output. Do NOT `git push`, deploy, or build an APK.
  </how-to-verify>
  <verify>
    <human-check>Steps 1-5 reported PASS with raw console output: no `effect_update_depth_exceeded` after entering half via tap AND grip; `.rel-row` count > 0 with 0 `.skel` rows; `|gap| <= 1` on the tap path and after a cover reflow; grip drag full→half clean. rAF re-measure + visual animation explicitly noted as unconfirmable in the sandbox pane.</human-check>
  </verify>
  <done>Human (or executor with browser access, then human) confirms (a) no depth error, (b) Related populates, (c) half-rest flush within 1px — all recorded in the SUMMARY with the raw console outputs and the sandbox caveat.</done>
  <resume-signal>Type "approved" or describe the failing step (number + raw console output)</resume-signal>
</task>

</tasks>

<threat_model>
## Trust Boundaries

| Boundary | Description |
|----------|-------------|
| DOM layout measurement → reactive `$state` | `measureOffsets` reads `getBoundingClientRect()` and writes `halfOffset`; no untrusted input, but a reactive write path inside an effect |

## STRIDE Threat Register

| Threat ID | Category | Component | Disposition | Mitigation Plan |
|-----------|----------|-----------|-------------|-----------------|
| T-soj-01 | DoS (self-invalidation loop / main-thread freeze) | NowPlaying half-rest `$effect` → `measureOffsets` | mitigate | `measureOffsets` assigns `halfOffset` once from a local (no read of the written signal) AND the effect calls it under `untrack()`; effect deps reduce to `sheetState`/`sheetDragging`/`coverEl`, none written by `measureOffsets`. Grep gates in Task 1 assert both. |
| T-soj-02 | DoS (regression: dead gap / stale half offset) | BUG-2 deferred re-measure | mitigate | `onSettled`, `transitionend`, double-rAF, 340ms fallback and cleanup are untouched (grep gate on `const onSettled = () => measureOffsets();`); Task 2 steps 3-4 measure `|sheet.top - transport.bottom| <= 1` on the tap path and after a cover reflow. |
| T-soj-03 | Tampering (scope creep in a hotspot file) | NowPlaying.svelte / player.svelte.ts | mitigate | Task 1 gate: `git diff --name-only HEAD -- src` is exactly `NowPlaying.svelte`; `halfOffset` `$state` and plain `closedOffset` asserted unchanged. |
| T-soj-SC | Tampering | npm installs | accept | No dependency changes in this plan. |
</threat_model>

<verification>
- `pnpm check` → 0 errors; `pnpm test` → full suite green (regression only).
- Grep gates (Task 1): one non-comment `halfOffset =` inside `measureOffsets`, no `halfOffset))` read; `untrack(() => measureOffsets())` exactly once; two bare `measureOffsets();` (pointer handlers) and the `onSettled` arrow unchanged; `let halfOffset = $state(150)` and `let closedOffset = 300;` intact; `BUG-2 ROOT CAUSE FIX` and `quick-260910-soj` present; only `NowPlaying.svelte` modified.
- Browser checkpoint (Task 2): (a) no `effect_update_depth_exceeded` after entering half via tap AND via grip; (b) `.rel-row` count > 0 with 0 skeleton rows; (c) `|gap| <= 1px` on the tap path and after a cover reflow; grip drag to full and back still clean. The rAF re-measure path and visual animation are explicitly unconfirmable in the sandbox pane and are reported as such.
- No `git push`, deploy, or APK build.
</verification>

<success_criteria>
- Resting in half no longer throws `effect_update_depth_exceeded`; the component keeps processing effects, so the Related tab populates.
- The half-open sheet still sits flush against the transport row; the BUG-2 deferred re-measure is byte-identical.
- The diff is two one-line changes plus tagged comments in `NowPlaying.svelte`; `halfOffset` stays `$state`, `closedOffset` stays plain, `player.svelte.ts` untouched.
- Decision recorded in-file (`quick-260910-soj`): fix at the source (single assignment) + house `untrack` idiom at the only reactive caller; deferred closures deliberately unwrapped.
</success_criteria>

<output>
Create `.planning/quick/260910-soj-fix-the-measureoffsets-self-invalidating/260910-soj-SUMMARY.md` when done.
</output>
