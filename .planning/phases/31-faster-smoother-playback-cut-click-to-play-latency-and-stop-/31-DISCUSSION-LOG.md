# Phase 31: Faster, smoother playback — Discussion Log

> **Audit trail only.** Do not use as input to planning, research, or execution agents.
> Decisions live in `31-CONTEXT.md` — this log preserves how they were reached.

**Date:** 2026-08-09
**Phase:** 31-faster-smoother-playback-cut-click-to-play-latency-and-stop
**Mode:** discuss (default, batched questions per area)
**Areas discussed:** Cold-resolve latency, Edge cache, Broken-download recovery, Next-song failure policy

## Area selection

All four offered gray areas were selected.

## Cold-resolve latency

| Question | Options presented | Selected |
|---|---|---|
| Latency target | Tighten watchdog to ~2.5s / Hedge: fire source #2 at ~1.5s / Leave the watchdog alone | **Leave the watchdog alone** |
| Pre-warm triggers (multi) | Nothing new / Top search result / Rows scrolled into view / Long-press or menu open | **Top search result + Long-press or menu open** |
| Slow-resolve UI | Optimistic swap (current) / Add progress feedback after ~1.5s | **Optimistic swap (current)** |
| Call budget | Latency wins, within reason / Hold the ~3-call budget | **Latency wins, within reason** |

Notes: scroll-into-view pre-warming was rejected on the grounds it is the shape behind the `api-fetch-flood-freeze` bug. Hedged parallel resolve was implicitly rejected by choosing "leave the watchdog alone", whose framing was "spend the phase on prefetch/warm instead".

## Edge cache (the CF question)

Claude opened the area by flagging the asymmetry: caching the *lookup* (name+artist → songid) is safe forever, caching the *URL* is risky because CN URLs are signed, short-lived, and sometimes IP-bound.

| Question | Options presented | Selected |
|---|---|---|
| What to cache (multi) | Lookup only / Resolved audio URL too / Source-availability hints / Nothing — client-side only | **All three** — lookup, URL, and availability hints |
| Store | Cache API / Bind existing D1 / KV | **Cache API** |
| TTL & invalidation | Long TTL for lookups, none for URLs / Short TTL on everything / Cache but bust on playback failure | **Bust on playback failure** |
| Sharing | Shared globally / Shared but URLs never shared | **Shared globally** |

User added, verbatim: *"update audio url if fail, and even if cache fails, run client resolver after that and update cache. the goal is to serve songs asap with retry"*

Claude flagged (factually, not as an objection) that a globally-shared audio URL will 403 for some users, making the failure path load-bearing rather than exceptional. The user's chosen design already mitigates this; the flag is recorded as D-11 so planning treats it as a primary path.

## Broken-download recovery

Claude presented scouting findings first: all three blob-read sites handle a *missing* blob correctly; none handle a *present but bad* blob, and `reresolveCurrent()` re-serves the same corrupt bytes so recovery cannot escape.

| Question | Options presented | Selected |
|---|---|---|
| Bad-blob policy | Evict + re-resolve silently / Keep record, play from network / Evict + re-resolve + re-download | **Evict + re-resolve + re-download** |
| Blob-vs-URL signal | Track it in driveSrc / Check src string at error time / You decide | **You decide** (→ Claude's Discretion) |
| Proactive validation | No, only react / Cheap size-type check on read / Verify at download time | **Cheap size/type check on read** |
| Visibility | Activity log only / Toast once / Nothing | **Toast once** |

Deferred: verifying blobs at download time (Phase 29 territory).

## Next-song failure policy

| Question | Options presented | Selected |
|---|---|---|
| Cross-source retry before skip | Yes, try other sources / Only if pre-warmed / No, keep skipping fast | **Yes — try other sources first** |
| STRIKE_CAP | Keep 2 but clear more eagerly / Raise the cap / Keep exactly as-is | **Both 1 and 2** — raise the cap AND clear more eagerly |
| Skip visibility | Toast on skip / Activity log only / Mark it in the queue | **Toast on skip** |
| Lookahead depth | Next 1 only / Next 2 / You decide | **Next 1 only** |

Claude flagged the tension (recorded as D-17): cross-source retry plus a raised, more-eagerly-cleared strike cap both increase retry work per failing track — the exact churn `STRIKE_CAP` was added to bound. The rapid-fire brake, `FAILURE_CAP`, and `SYSTEMIC_SKIP_CAP` must stay intact as the real backstop, verified against the three known freeze classes.

## Deferred ideas captured

- Verify blobs at download time (Phase 29 territory)
- Scroll-into-view pre-warming
- Hedged parallel source resolve
- Deeper prefetch lookahead (next-2)
- Dimmed/warning state for failed tracks in Up Next

## Todos reviewed, not folded

`todo.match-phase 31` returned four Phase 30 share-card/OG todos matched on generic keywords only. Unrelated to playback. Not folded.
