# Phase 31: Faster, smoother playback — Context

**Gathered:** 2026-08-09
**Status:** Ready for planning

<domain>
## Phase Boundary

Cut click-to-play latency, stop next-song silent failures, and make a broken downloaded blob re-enter the normal resolver chain instead of being skipped. Playback should feel streaming-instant and never dead-end.

**In scope:** resolve path, pre-warming, edge caching of resolve data, the offline-blob branch of `player.svelte.ts`, the prefetch/probe walk, and the strike/skip policy.

**Out of scope:** new sources, search ranking, new UI surfaces, changes to the download *acquisition* path (Phase 29 territory) beyond the background re-download triggered by an evicted bad blob.
</domain>

<decisions>
## Implementation Decisions

### Cold-resolve latency
- **D-01:** Leave `RESOLVE_WATCHDOG_MS` at 6000. Do NOT retune timeouts — the win comes from pre-warming, not from failing over sooner.
- **D-02:** No hedged/parallel source racing. The kuwo-first serial resolve from Phase 26 stands.
- **D-03:** Pre-warm (speculative resolve before the tap) on exactly two triggers: **the top search result when results render**, and **long-press / track-menu open**. Explicitly NOT scroll-into-view — that shape caused the `api-fetch-flood-freeze` class of bug.
- **D-04:** Keep the optimistic UI swap exactly as-is. Do not gate the now-playing swap on the `playing` event — that was tried, froze mobile playback, and was reverted.
- **D-05:** Phase 26's ~3-call floor is a *waste* target, not a hard cap. Spending 1–2 extra calls to make a play feel instant is an accepted trade.

### Edge cache
- **D-06:** Cache **all three layers**: (a) `name+artist → songid` lookup, (b) resolved audio URL, (c) source-availability hints ("kuwo has it, netease is dry").
- **D-07:** Store = **Cache API (`caches.default`)** inside the Worker — the pattern already proven by `/api/og` (1698ms → 2ms). **No new binding.** `open-music-db` (D1) and `open-music-audio` (R2) exist but stay unused; no KV is created.
- **D-08:** The cache is **advisory, never authoritative.** User's words: *"update audio url if fail, and even if cache fails, run client resolver after that and update cache. the goal is to serve songs asap with retry."* A miss OR a stale hit must fall through to the client resolver silently, then repair the entry.
- **D-09:** Invalidation = **bust on playback failure.** The client reports a dead entry so the edge drops/refreshes it. Requires a new report endpoint.
- **D-10:** Cache is **shared globally** across all users.
- **D-11:** **Accepted risk, must be designed for:** a globally-shared audio URL can be IP- or region-bound and will 403 for some other user. D-08 + D-09 are the mitigation, which means **the failure path is the load-bearing part of this feature, not an edge case.** Plan and test it as the primary path, not the exception.

### Broken-download recovery
- **D-12:** A blob-sourced playback error means: **evict the blob + the download record → re-resolve over the network and keep playing → quietly re-download in the background** so offline works next time. Self-repairing.
- **D-13:** Add a **cheap size/type sanity check when reading a blob from IDB** — reject zero-byte or absurdly small blobs before ever attaching them to `<audio>`.
- **D-14:** Surface it: **one toast** ("download was corrupted, streaming instead") plus a `logAction` entry for Settings → Activity log.

### Next-song failure policy
- **D-15:** A failed next track gets a **cross-source re-resolve before being skipped**. A track that fails on kuwo often plays on qq; silently dropping it is the actual complaint.
- **D-16:** Strikes get **more forgiving on both axes**: raise `STRIKE_CAP` above 2 **and** clear a track's strikes more eagerly (on network recovery / return to foreground), so a tunnel or Wi-Fi blip cannot blacklist half the queue for the session.
- **D-17:** **Tension to manage (flagged, not a blocker):** D-15 and D-16 both increase retry work per failing track — exactly the churn `STRIKE_CAP` was introduced to bound. The rapid-fire brake (`RAPID_ERROR_CAP=3`), the `FAILURE_CAP` error ceiling, and `SYSTEMIC_SKIP_CAP=5` must remain intact and become the real backstop. Verify no regression against the three known freeze classes before this ships.
- **D-18:** A skip is **surfaced with a toast** ("Couldn't play X — skipped"), not silent. Part of the complaint is not knowing a skip happened.
- **D-19:** Lookahead stays at **next-1 only**. Do not deepen the prefetch walk.

### Claude's Discretion
- The blob-vs-URL error signal. Either record it in `driveSrc()` (the existing single `audio.src` authority) or test the `blob:` prefix at error time — planner picks after reading the full error handler.
- Exact new `STRIKE_CAP` value and the precise strike-clearing trigger.
- Cache key shape, TTLs, and the report-endpoint contract.
- Toast copy and dedupe policy when several tracks fail in a row.
</decisions>

<specifics>
## Specific Ideas

- **"the goal is to serve songs asap with retry"** — the guiding sentence for the whole cache design. Serve optimistically, repair on failure, never block on correctness.
- The user explicitly rejected creating new Cloudflare infrastructure after being shown that `open-music-db` and `open-music-audio` were provisioned 2026-05-09 and never used. Cache API only.
</specifics>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### Resolve path / API budget
- `.claude/skills/spike-findings-openmusic/SKILL.md` — kuwo-first resolution, the never-fan-out-on-click rule, source-embedded covers, the ~3-call budget. Also `references/source-resolution.md` and `references/click-to-play-cost.md`.
- `.planning/phases/26-minimal-api-click-to-play-redesign/26-06-PLAN.md` + `26-06-SUMMARY.md` — the resolve-phase watchdog (`RESOLVE_WATCHDOG_MS`) this phase deliberately leaves alone.

### Playback engine
- `src/lib/stores/player.svelte.ts` — the whole surface. Specifically: the three blob reads at `:492` (restore), `:569` (reresolveCurrent), `:2533` (play); `driveSrc()` at `:1176`; the `audio.error` handler and error ceiling at `:1626`–`:1691`; `strikeUnplayable()` at `:854`.
- `src/lib/services/api-base.ts` — the `apiFetch` governor (`MAX_CONCURRENT_REQUESTS=8`, GET dedupe, circuit breaker). All new speculative traffic MUST route through it.
- `src/routes/api/og/` — the existing `caches.default` usage that D-07 says to copy.

### Codebase maps
- `.planning/codebase/ARCHITECTURE.md`, `.planning/codebase/CONCERNS.md` — layer boundaries and known debt (player.svelte.ts is a ~3625-line god object).

### No external specs
No ADRs or design docs exist for this area — `docs/adr/` is absent and there is no root `CONTEXT.md`. Requirements are fully captured in the decisions above.
</canonical_refs>

<code_context>
## Existing Code Insights

### The download bug's actual root cause (found during scouting)
`play()` at [player.svelte.ts:2532](src/lib/stores/player.svelte.ts:2532) and `restore()` at [:491](src/lib/stores/player.svelte.ts:491) both handle a **missing** blob correctly — they fall through to `ensureTrackDetails`. The break is a blob that **exists but is bad**: `audio.src = blob:` → `audio.error` → `reresolveCurrent()` at [:568](src/lib/stores/player.svelte.ts:568) re-reads the *same corrupt blob* and re-attaches it → error ceiling → `strikeUnplayable` + skip. **Nothing anywhere distinguishes "these bytes are bad" from "this URL is bad"**, so the download record is never evicted and the track stays dead on every future play. D-12/D-13 target exactly this.

### Reusable assets
- `driveSrc()` — already the single authority for setting `audio.src`. The natural place to record blob-vs-URL provenance (D-12 discretion item).
- `apiFetch` governor + circuit breaker in `api-base.ts` — pre-warming and cache-report calls plug into this rather than inventing new throttling.
- `caches.default` usage in `/api/og` — the working Cache API template for D-07.
- `logAction()` / `actionLog.svelte.ts` — the diagnostic channel for D-14 and D-18.
- `blobStore` (IndexedDB) — the read point for the D-13 size check.
- The `lazyCover` IntersectionObserver action — the pre-warm *pattern* exists, but D-03 deliberately does NOT reuse it for scroll-triggered resolves.

### Established patterns that constrain this phase
- **Generation guards** (`playGen`, `queueGen`, `pendingGen`, `fallbackGen`) — every new async path must snapshot and re-check after each `await`.
- **Never-throw services** — the edge cache client must map every failure to a null sentinel, never a rejection into the render tree (D-08 depends on this).
- **Never-stop** — every failure path SKIPs; only `SYSTEMIC_SKIP_CAP` STOPs.
- Three documented freeze classes must not regress: `nowbar-freeze-reresolve-loop`, `api-fetch-flood-freeze`, `restore-effect-self-invalidation-loop`.

### Integration points
- New edge route(s) under `src/routes/api/` for the cached resolve + the failure-report endpoint; CORS via the single seam in `src/hooks.server.ts`.
- Client resolve path in `src/lib/services/catalog.ts` (`ensureTrackDetails`) is where a cache-first lookup slots in ahead of the source adapter.
- Pre-warm triggers touch the search results page and `TrackMenu.svelte` / longpress action.

### Cloudflare infra recon (2026-08-09, via CF API)
- `open-music-db` D1 `a14554d5-7190-440a-b4f4-23ec93dfb4b4` — created 2026-05-09, **0 tables, not bound**. Stays unused per D-07.
- `open-music-audio` R2 — created 2026-05-09, **not bound**. Stays unused.
- **No KV namespace** for openmusic.
- Pages project `openmusic` production config carries only `JAMENDO_CLIENT_ID` + `JOOX_TOKEN` / `LASTFM_KEY` / `LASTFM_SECRET`. No `d1_databases` / `r2_buckets` / `kv_namespaces` bindings. Adding one is a config change, not just code.
</code_context>

<deferred>
## Deferred Ideas

- **Verify blobs at download time** so a corrupt download never enters the library at all — fixes the cause rather than the symptom, but it is a change to the download acquisition path (Phase 29 territory). This phase only repairs at playback time.
- **Scroll-into-view pre-warming** — highest hit rate, explicitly rejected for this phase because it is the shape that caused `api-fetch-flood-freeze`. Revisit only with hard evidence the governor holds.
- **Hedged parallel source resolve** (fire source #2 after ~1.5s) — rejected in favour of pre-warming; still the obvious next lever if pre-warm hit rates disappoint.
- **Deeper prefetch lookahead (next-2)** — D-19 keeps it at next-1. Revisit if fast double-skips remain cold.
- **Marking failed tracks in the Up Next list** (dimmed / warning state) instead of a toast — a new UI state, deferred in favour of D-18's toast.

### Reviewed todos (not folded)
The four todos matched by `todo.match-phase 31` are all Phase 30 share-card / OG issues (`artist-page-hyphenated-lookup-key`, `og-artist-tier-picture-xl-oversize`, `pageog-hardcoded-site-origin`, `song-share-stale-cover-comment`). They matched on generic keywords only and have nothing to do with playback. Not folded.
</deferred>

---

*Phase: 31-faster-smoother-playback-cut-click-to-play-latency-and-stop*
*Context gathered: 2026-08-09*
