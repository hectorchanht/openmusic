---
quick_id: 260809-cyk
slug: fix-pre-warm-over-fire-pre-warm-top-sear
date: 2026-08-09
type: execute
files_modified:
  - src/routes/(app)/search/+page.svelte
autonomous: true
relates_to: phase 31 (31-D-03, 31-D-05)

must_haves:
  truths:
    - "A settled search pre-warms exactly ONE track — the final top result — not one per intermediate ranking"
    - "A search whose Deezer boost aborts, rejects, or never resolves still pre-warms exactly once"
    - "A superseded query never pre-warms its stale top result"
    - "No timer, debounce, or new throttle composes with the apiFetch governor"
  artifacts:
    - path: "src/routes/(app)/search/+page.svelte"
      provides: "pre-warm fired at the terminal ranking event instead of reactively per results[0] identity change"
      contains: "prewarmTrack"
---

<objective>
Pre-warm the top search result ONCE per settled search instead of 4-8 times.
</objective>

<diagnosis>
Verified live on the workerd preview build (`pnpm preview`, port 4173) with a `window.fetch` wrap:
**5 `/api/resolve` calls on one search, 2 on another.** D-05 accepted "1-2 extra calls"; 5 is past that.

`src/routes/(app)/search/+page.svelte:492-498` pre-warms reactively:

    let lastPrewarmedUid = '';
    $effect(() => {
        const top = results[0];
        if (!top || top.uid === lastPrewarmedUid) return;
        lastPrewarmedUid = top.uid;
        prewarmTrack(top);
    });

`results` is reassigned 4+ times per query — per-source partials inside `onPartial` (:346), the
authoritative final settle (:351), and the Deezer-boosted re-rank (:366). The **identity** of
`results[0]` changes across those, so the uid guard does not collapse them: the effect fires once per
DISTINCT top result.

Cost per extra fire: one own-origin round-trip for the client, plus — on a cache miss — an edge-side
kuwo fill (~2 upstream subrequests) for a track the user may never play.

**Why gating on `!loading` does NOT fix it:** `dedupeBestWithDeezer(...)` at :363 is `void ...then(...)`
— fire-and-forget — so the boosted re-rank lands AFTER `loading = false` in the `finally` at :376.
Gating on settle yields 2 pre-warms (pre-boost + post-boost), not 1. Separately, the comment at :92-95
records that gating directly on `loading` was already tried for the skeleton and failed, because on a
fast settle `loading` flips true→false within a single microtask before `onPartial` overwrites
`results` in the next microtask.
</diagnosis>

<tasks>

<task type="execute">
  <name>Task 1: Fire pre-warm at the terminal ranking event, once per settled search</name>
  <files>src/routes/(app)/search/+page.svelte</files>
  <read_first>
    - src/routes/(app)/search/+page.svelte — read `run()` in full (:308-385), the reactive pre-warm effect (:475-498), the `loading` microtask warning (:92-95), and both `lastPrewarmedUid` reset sites (:174, :328)
    - src/lib/services/prewarm.ts — confirm `prewarmTrack`'s own uid Set stays the second bound
  </read_first>
  <action>
Replace the reactive `$effect` pre-warm with an imperative call at the TERMINAL ranking event.

Concretely:
- Delete the `$effect` at :493-498. Keep a plain (NOT `$state`) per-query guard field so a single
  settled search can only pre-warm once — the house idiom is TrackMenu's `versionGen` and the
  existing `lastPrewarmedUid`.
- Call `prewarmTrack(results[0])` inside the `dedupeBestWithDeezer(...).then(...)` callback at :363-368,
  AFTER `results = rankList(boosted, kw)` — that is the true final ranking.
- Add a fallback so a search still pre-warms exactly once when the boost aborts, rejects, or never
  resolves. Attach it to the same promise (e.g. a `.catch`, or a `.finally`-equivalent that respects
  the supersede guard) — NOT a timer.
- Every call site must sit inside the existing supersede guard `if (myAc.signal.aborted || kw !== q.trim()) return;`
  so a superseded query never pre-warms its stale top result.
- Reset the per-query guard at both existing reset points (:174 and :328) alongside the current
  `lastPrewarmedUid` handling, so a genuinely new query is allowed its own single pre-warm.

If you find a cleaner seam while reading the file, take it — the requirement is **one pre-warm per
settled search**, not a specific mechanism.

Then rewrite the `31-D-03` comment block at :475-491 so it describes the new behaviour. Its current
"Pitfall 5" paragraph documents the 4-8x firing as accepted and explicitly argues for the reactive
approach — that is now wrong and must not be left to mislead the next reader. Keep and carry forward
the two rules that are still correct and still load-bearing:
  (a) no timer/debounce composing a fresh local bound with the apiFetch governor — that is the
      documented root cause of the api-fetch-flood-freeze class of bug;
  (b) gesture-only, nothing pre-warms on scroll.
Record the measured before/after (5 calls per search → 1) so the next reader knows why this shape.
  </action>
  <verify>
    <automated>pnpm test && pnpm check</automated>
  </verify>
  <acceptance_criteria>
    - The `$effect` that reads `results[0]` for pre-warm no longer exists in the file
    - `prewarmTrack` is called from inside `run()`'s terminal ranking path, within the supersede guard
    - A boost abort/rejection path still results in exactly one pre-warm per settled search
    - `grep -c 'setTimeout\|setInterval\|debounce' ` over the pre-warm code path shows no NEW timer introduced for pre-warm
    - No IntersectionObserver / scroll trigger added anywhere
    - `src/lib/services/prewarm.ts` and its test are byte-identical (`git diff --stat` empty)
    - `src/lib/components/TrackMenu.svelte` is byte-identical (`git diff --stat` empty) — trigger 2 is correct
    - `pnpm test` green, `pnpm check` 0 errors 0 warnings
    - `git diff` on wrangler.jsonc / package.json / pnpm-lock.yaml is EMPTY
    - The 31-D-03 comment block describes one-per-settled-search and no longer claims 4-8x is accepted
  </acceptance_criteria>
  <done>A settled search issues exactly one `/api/resolve` pre-warm; the comment block matches reality.</done>
</task>

</tasks>

<constraints>
- Do NOT add a timer/debounce that composes a fresh local bound with the apiFetch governor (:480-487 is right about this).
- Do NOT remove the other two bounds: `prewarmTrack`'s uid Set and apiFetch's in-flight GET dedupe.
- Do NOT add any scroll / IntersectionObserver trigger (rejected by 31-D-03).
- Do NOT touch TrackMenu.svelte — trigger 2 already fires once per menu open.
- Guard constants frozen: STRIKE_CAP=3, RAPID_ERROR_CAP=3, FAILURE_CAP=5, SYSTEMIC_SKIP_CAP=5, RESOLVE_WATCHDOG_MS=6000.
- Do NOT edit the D-17 regression suites. `-t "SYSTEMIC"` is UPPERCASE — lowercase matches nothing and reports a false green.
- Do NOT modify wrangler.jsonc / package.json / pnpm-lock.yaml.
- Svelte 5 runes FORCED. Internal guards are PLAIN fields, not `$state`. Tabs, single quotes, high comment density.
</constraints>

<verification>
No jsdom project exists, so a page-level effect is not unit-testable — there is no unit test to add here
and none should be invented. The real verification is a live re-measure the orchestrator performs against
`pnpm preview` after this lands: exactly one `/api/resolve` per settled search.

Run and report: `pnpm test`, `pnpm check`.
</verification>
