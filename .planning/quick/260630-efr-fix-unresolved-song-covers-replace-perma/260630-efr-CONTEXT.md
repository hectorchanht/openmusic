# Quick Task 260630-efr: Fix unresolved song covers — clearer manual clear-cache path - Context

**Gathered:** 2026-06-30
**Status:** Ready for planning

<domain>
## Task Boundary

User report: "some song cover is still not resolved" (after the prior 260629-nyl iTunes-fallback fix). User proposed a "Clear cover cache" Settings button and invited a better approach.

### Discovery findings (change the premise)
- **The "Clear cover cache" button ALREADY EXISTS and is wired**: `src/routes/(app)/settings/data/+page.svelte:54` → `clearCovers()` → `clearCoverCache()` (`src/lib/services/cover-cache.ts:59`). i18n keys `settings.clearCoverCache` / `settings.coverCacheCleared` exist in all locales.
- **Failures are NEVER cached**: `writeKey` no-ops on an empty/whitespace URL (`cover-cache.ts:100`) — only SOLID `https` covers are stored. So there is no negative-caching bug to fix.
- **Root cause of "still not resolved"**: the cache-hit path in `lazyCover.ts:69-74` serves a stored URL WITHOUT probing it. A cached cover whose CDN URL later goes dead is painted from localStorage forever; `lazyCover` fires once per row then unobserves, and there is no per-entry eviction — only the nuke-everything button. Clearing the whole cache forces a re-resolve on next view, which recovers stale covers.
</domain>

<decisions>
## Implementation Decisions (LOCKED via --discuss)

### Repair strategy
- **Manual clear only.** No automatic probe-on-cache-hit and no `<img onerror>` auto-repair/eviction. Rely on the EXISTING Settings → Data "Clear cover cache" button (wipe-all → next view re-resolves). Auto-repair (render-then-repair: evict one entry + re-resolve on the tile's real img onerror) was offered and DECLINED — keep it noted as a future enhancement, do NOT build it now.

### Proactive TTL
- **Reactive only — no TTL.** No `{url, timestamp}` storage migration. Cache values stay bare URL strings.

### Clear button
- **Keep + helper text.** Keep the existing button unchanged. Add a one-line muted hint beneath it so users discover it as the remedy for missing/outdated covers.
- **Copy must be ACCURATE to the manual behavior** — do NOT claim covers re-fetch "automatically." Frame it as: clearing removes saved cover art so missing/outdated covers are fetched again next time they're viewed. (The offered helper-text option mentioned "automatically"; that wording is wrong under manual-only and must not be used verbatim.)

### Claude's Discretion
- Exact EN copy and its translations into all locales; where exactly the hint sits visually (muted `<p>`/`<small>` directly under the cover button); the new i18n key name (suggest `settings.clearCoverCacheHint`).
</decisions>

<specifics>
## Specific Ideas

- New i18n key e.g. `settings.clearCoverCacheHint`. EN suggestion: "Removes saved cover art so missing or outdated covers are fetched again next time."
- Render a small muted hint line directly under the `clearCovers` button in `src/routes/(app)/settings/data/+page.svelte` (reuse the existing `.muted` style or add a tight `.hint` style).
- The key MUST be added to ALL 15 locales (ar, de, en, es, fr, hi, id, it, pt, ru, th, tr, vi, zh-Hans, zh-Hant) — `src/lib/i18n/i18n.test.ts` enforces key parity and will fail otherwise.
</specifics>

<canonical_refs>
## Canonical References

- `src/lib/services/cover-cache.ts` (clearCoverCache, writeKey no-op-on-empty)
- `src/lib/actions/lazyCover.ts` (cache-hit-without-probe = stale-cover root cause)
- `src/routes/(app)/settings/data/+page.svelte` (existing button)
- `src/lib/i18n/*.ts` + `i18n.test.ts` (key parity)
</canonical_refs>
