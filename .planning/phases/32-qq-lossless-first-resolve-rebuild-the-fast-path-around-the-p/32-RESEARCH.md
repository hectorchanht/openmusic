# Phase 32: QQ-lossless-first resolve — rebuild the fast path around the permanent `song_mid` - Research

**Researched:** 2026-08-31
**Domain:** Client-side audio resolve routing, Cloudflare edge caching, browser network/CORS semantics, HTML `<audio>` codec + blob handling
**Confidence:** HIGH (every load-bearing claim was probed live against the real upstream, the real CDN, and MDN's browser-compat-data; the two exceptions are tagged inline)

## Summary

Every open question from the brief resolved in this session, and two of the five resolved **in favour of the locked decisions** with better mechanisms than the decisions assumed. `Content-Length` **is** readable on the QQ CDN cross-origin (`access-control-expose-headers: Content-Length,Content-Range` is present on both `200` and `206`), so D-15 stands as written — and it turns out the size is *also* available for free in the tang detail body (`song_size_sq_str` etc.), which is strictly better because it is known before the first byte is requested. Connection detection resolves cleanly too: `NetworkInformation.type` — the accurate `'wifi'`/`'cellular'` value — is supported on **Chrome Android 38+ and WebView Android 50+** (so the Capacitor APK gets it) and is `false` on Safari/iOS, exactly the split D-03 predicted and accepted. `type` is gated *differently* from `effectiveType`: on Chrome **desktop** `type` is ChromeOS-only, so desktop web also falls to the no-signal `'320'` branch.

Three findings change what the plan should contain. First, `'auto'` is read by **three** adapters (`qq.ts`, `kuwo.ts`, `joox.ts`) and `quality.ts` treats `'auto'` identically to `'lossless'` today — so flipping the default without a single central resolution point silently sends kuwo and JOOX to lossless on cellular as well. The resolution belongs in `src/lib/sources/quality.ts` (one new exported function, three one-line call-site edits), not inside `qq.ts`. Second, the `'320'` rung selects `song_play_url_hq`, which measured **193 kbps m4a on all three probed tracks** — the same class of stale claim D-04 exists to correct, and `inferQualityFromUrl` then *labels* it `320K`. Third, the ladder's `accom` rung sits **above** `hq` and serves a `.ogg` file; `accom` is 伴奏 — the accompaniment/instrumental mix — and the rung is inherited verbatim from upstream `index.html:2373` rather than chosen. It is reachable whenever `sq` and `pq` are both absent, and `.ogg` additionally does not decode in iOS Safari.

The one genuine tension the research surfaced is latency arithmetic, in **Decisions At Risk**: the D-10 mid cache saves *one* of the two tang calls but cannot remove the tang detail RTT, which measured 2.0–3.8s from this sandbox. The fast path is therefore D-08 (a QQ-sourced row already carries the mid), not D-10 — and on that path the existing unconditional 400ms `/api/resolve` lookup in `catalog.ts:326` becomes pure waste and should be skipped.

**Primary recommendation:** Put the `'auto'` → `'lossless'|'320'` resolution in one new `effectiveQuality()` in `src/lib/sources/quality.ts` behind a `browser`-guarded `NetworkInformation.type` whitelist (`'wifi'|'ethernet'` and not `saveData` → lossless, everything else → `'320'`); read the D-15 size ceiling from the tang detail body's `song_size_*_str` at resolve time rather than from `Content-Length` at prebuffer time; skip the `/api/resolve` lookup when the track already carries a QQ mid.

---

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions

#### Resolve source and quality tier
- **D-01:** QQ (the `tang.api.s01s.cn/music_open_api.php` endpoint behind `sources/qq.ts`) becomes the
  PRIMARY resolve for playback. The existing kuwo/netease/joox cross-source ladder stays intact as the
  FAILURE path — a tang outage must degrade quality, never break playback.
- **D-02:** `PLAYBACK_DEFAULTS.defaultQuality` changes from `'128'` to `'auto'`. `'auto'` gains a real
  meaning for the first time: **lossless on wifi, `'320'` on cellular.** The rung already exists in the
  `DefaultQuality` union (`settings.svelte.ts:50`) and is already persisted — today it means nothing
  (`joox.ts:145` treats it identically to `'lossless'`; QQ's ladder just falls through).
- **D-03:** **With no connection signal, `'auto'` resolves to `'320'`.** iOS Safari ships no Network
  Information API, so `navigator.connection` is `undefined` there and every iPhone gets 320 under the
  default setting. This is a DELIBERATE, accepted consequence, chosen with the tradeoff on the table:
  iOS — the platform `CLAUDE.md` names first — does NOT get lossless by default. Android Chrome and
  users who pick `'lossless'` by hand do. **Do not "fix" this as a bug**; a verifier finding it should
  read this decision and stop.
- **D-04:** Correct the stale claim while changing the default: `defaults.ts:82` says
  `'128' // D-03 — 128–160k band`, but `'128'` selects `song_play_url_standard`, measured at
  **98 kbps**. Fix the comment; do not silently leave a wrong decision record in place.
- **D-05:** Upgrade returned QQ audio URLs `http:` → `https:`. The upstream returns
  `http://isure6.stream.qqmusic.qq.com/...`, which is mixed-content-blocked on our https origin; the
  same host serves https correctly (verified: `206`, `audio/x-flac`, first bytes in 0.31s).

#### First play and mid acquisition
- **D-06:** **Never block the first note.** If the tapped track has no QQ `song_mid`, play whatever URL
  is already resolvable IMMEDIATELY and resolve the QQ mid in the background.
- **D-07:** **Never swap `audio.src` mid-song for a quality upgrade.** The background mid resolve writes
  to cache only; lossless applies from the NEXT play of that song. No swap machinery, no audible seam,
  no extra `driveSrc` re-drive. (Context: one deliberate swap would not trip the brake —
  `SRC_REDRIVE_CAP=4` in `SRC_REDRIVE_WINDOW_MS=1500` — but the seam was judged not worth the code.)
- **D-08:** Promote `qq` to the top of dedupe's `SOURCE_RANK` (`dedupe.ts:25`, currently
  `netease: 4, qq: 3`). netease winning the tie is WHY mid-less stubs are the common case rather than
  the rare one. With qq winning, the surviving deduped row already carries `song_mid`, so most FIRST
  plays are lossless with no wait and D-06/D-07 become the uncommon path. Accepted side effect: qq's
  title/album metadata wins where the two sources disagree. Cross-reference: the roadmap's pending
  "netease upstream health-gate" item already suspects that rank-4.
- **D-09:** Strip the `msg`/`qqSearchKey`/`keyword` threading from the QQ DETAIL call. Verified: the
  endpoint **ignores `msg`** — `mid` alone returns the full ladder, and a deliberately WRONG `msg` with
  the right `mid` still returns the correct song. QQ resolve is exactly ONE call given a mid.

#### Cache shape
- **D-10:** Cache **`matchKey → song_mid`**, permanently. `song_mid` never expires (unlike the signed
  audio URL Phase 31 cached), so this entry needs **no TTL and no bust machinery**. It stays edge-side
  so it is shared across all users, per Phase 31 D-10.
- **D-11:** Phase 31 D-08 / D-09 / D-11 carry forward unchanged: the cache is **advisory, never
  authoritative**. A miss or a stale hit falls through to the client resolver silently and repairs the
  entry. The failure path remains load-bearing, not an edge case.

#### Hop routing
- **D-12:** **Split by what each call needs.** The `matchKey → song_mid` lookup stays on `/api` (it is
  cacheable forever and shared, so the hop pays for itself). The hot audio-URL DETAIL call goes
  **direct to the upstream**, saving the measured ~1s. The proxy route is RETAINED as a fallback for the
  day the upstream drops its `access-control-allow-origin: *`.
- **D-13:** Direct calls go through **`apiFetch`, not raw `fetch`** — the governor's dedupe,
  `MAX_CONCURRENT_REQUESTS`, timeout and circuit breaker are URL-agnostic, so none of the
  `api-fetch-flood-freeze` protections are lost by going direct. `apiUrl` (`api-base.ts:26`) is a bare
  `BASE + path` concat, so it needs an "already absolute" guard for the NATIVE build where
  `VITE_API_BASE` is set. Media bytes keep using raw `fetch` as they do today.
- **D-14:** IP exposure was weighed and accepted: `<audio src>` already points straight at
  `isure6.stream.qqmusic.qq.com`, so Tencent's CDN already sees every listener's real IP on every play.
  A direct metadata call adds a hostname, not a new category of exposure.

#### Next-track cost
- **D-15:** `prebufferNext` keeps running and **inherits whatever tier `'auto'` picked** — so cellular
  is already ~10MB rather than ~28MB. Add ONE guard: check `Content-Length` and skip the blob (stream
  instead) above a ceiling, so a low-end phone never holds a huge Blob per advance. This preserves the
  `bg-lockscreen-stall-noskip` fix wherever it is affordable. That prebuffer is a STABILITY mechanism,
  not a gapless nicety — dropping it for FLAC would trade the "next song plays" goal for the "plays
  fast" goal.
- **D-16:** **Do NOT re-architect the post-resolve tail.** Measured and cleared:
  `player.svelte.ts:2892-3033` already sets `audio.src` + `play()` immediately after the resolve, with
  only synchronous localStorage/MediaSession work between; covers, lyrics, prefetch and `ensureAhead`
  all run AFTER playback starts. "Play the instant it resolves, parallelize the rest" is already the
  implemented behavior. The spinner is `ensureTrackDetails` and nothing else.
- **D-17:** Phase 31 D-19 carries forward: lookahead stays **next-1 only**. Do not deepen the walk.

### Claude's Discretion
- The exact `Content-Length` ceiling value for D-15.
- The wifi-vs-cellular detection shape for D-02/D-03 (`navigator.connection.type` /
  `effectiveType` / `saveData`), and where it lives — no connection-awareness code exists anywhere in
  `src/` today, so this is net-new.
- Where the D-05 https upgrade belongs (client adapter vs proxy adapter).
- Cache-key normalization for D-10 — `matchKey` already exists (`services/match-key.ts`) and is what
  Phase 31's entry keyed on; reuse it unless there is a reason not to.
- Whether a tier downgrade under `'auto'` is surfaced to the user at all, and if so how.
- The new numeric value for qq in `SOURCE_RANK` (D-08).

### Deferred Ideas (OUT OF SCOPE)
- **Second lossless provider / tang redundancy** — tracked as Q1 in `.planning/research/questions.md`,
  to be handled as its own `/gsd:spike`. Explicitly NOT folded into this phase; Phase 32 ships on tang
  alone with the existing ladder as the safety net.
- **Mid-song quality hot-swap** — rejected by D-07, not merely postponed. If it is ever revisited it
  needs its own decision record, because it adds a second `audio.src` attach path.
- **A user-facing data-saver toggle** — considered for D-02 and not taken; `'auto'` plus the existing
  manual `'320'`/`'128'` pickers cover it without new settings or 16 dictionary updates.

#### Reviewed Todos (not folded)
- `artist-page-hyphenated-lookup-key.md`, `og-artist-tier-picture-xl-oversize.md`,
  `pageog-hardcoded-site-origin.md`, `song-share-stale-cover-comment.md` — all four matched on keyword
  noise only. Left pending.
</user_constraints>

---

<phase_requirements>
## Phase Requirements

No `REQUIREMENTS.md` REQ-ID mapping exists for this phase. The traceability keys are the **D-numbers
from `32-CONTEXT.md`**, exactly as in Phase 31.

| ID | Description | Research Support |
|----|-------------|------------------|
| D-01 | QQ becomes primary resolve; ladder stays as failure path | Q5 confirms a `mid`-only detail returns every `Track` field; **Supersession Map** records what this overrides in `Skill("spike-findings-openmusic")`; **Decisions At Risk #3** flags the spike's "qq search is flaky" counter-evidence and why it does *not* invalidate D-01 |
| D-02 | `defaultQuality: '128'` → `'auto'`; auto = lossless-on-wifi / 320-on-cellular | **Finding 2** (three adapters read the pref; `'auto'` currently === `'lossless'` in `quality.ts:31`) → single-seam `effectiveQuality()` in `quality.ts`. **Finding 3**: `'320'` is really 193 kbps |
| D-03 | No connection signal → `'320'` | **Finding 1** — MDN BCD: `type` is `false` on safari/safari_ios, ChromeOS-only on Chrome desktop; supported Chrome Android 38+ / WebView Android 50+. D-03's premise is exactly correct and now has an authoritative citation |
| D-04 | Correct the stale `'128'` comment | **Finding 3** — measured `kbps_standard: 97` on 2/2 real tracks. Also finds the *same class* of stale claim on `'320'` (`kbps_hq: 193`) and on `inferQualityFromUrl`'s `320K` label |
| D-05 | `http:` → `https:` upgrade | **Finding 4** — live 200 + 206 over https confirmed; **recommended placement** = `sources/qq.ts` `pickBestPlayUrl` return. Existing fixture is already `https://` so the upgrade is untested → Wave 0 fixture item |
| D-06 | Never block the first note | Existing `catalog.ts:371` `resolveNameStub` + `player`'s never-throw path already implement "fall through and keep playing". **Pattern 3** |
| D-07 | Never swap `audio.src` mid-song | Confirmed `driveSrc` is the single authority; no new attach path needed. No research risk |
| D-08 | Promote `qq` in `SOURCE_RANK` | **Finding 5** — `qualityRank` is 0 for every pre-resolve stub, so `SOURCE_RANK` is the *sole* tie-break in a search list; `dedupe.test.ts` has **zero** winner-source assertions → the one-line change is test-safe |
| D-09 | Strip `msg` from the detail call | Q5 — full body returned with `mid` alone; **no test asserts `msg=`** in the URL. Zero-cost |
| D-10 | Cache `matchKey → song_mid`, permanent | **Q3 / Pattern 4** — concrete list of what shrinks. **Decisions At Risk #1** (negative entries must keep a TTL) and **#2** (mid cache cannot remove the tang RTT) |
| D-11 | Cache advisory, failure path load-bearing | `resolve-cache-client.ts` already maps every failure to `null`; the new entry shape needs no change to that contract |
| D-12 | Lookup on `/api`, detail direct | **Q4** — direct GET stays a **simple request** (no preflight); tang sends `ACAO: *`. **Decisions At Risk #4** — the shared circuit breaker now counts tang failures |
| D-13 | Direct calls via `apiFetch`; `apiUrl` needs an absolute guard | **Q4** — exact failure mode on each build documented; one-line guard given; `api-base.test.ts:36` stays green |
| D-14 | IP exposure accepted | No research needed; the CDN probe reflected `client-ip:` back, confirming the premise |
| D-15 | Size ceiling on the prebuffer blob | **Q1** — `Content-Length` **is** exposed (`access-control-expose-headers`). Plus a strictly better free source: `song_size_*_str` in the detail body. Real worst case is **52.8MB / ~12MB per minute**, not the 7MB/min the note assumed |
| D-16 | Do not touch the post-resolve tail | Honoured — nothing in this research recommends an edit inside `player.svelte.ts:2892-3033` |
| D-17 | Lookahead next-1 only | Honoured — the D-15 guard is inside the existing `prebufferNext`, no walk deepening |

</phase_requirements>

---

## Architectural Responsibility Map

| Capability | Primary Tier | Secondary Tier | Rationale |
|------------|-------------|----------------|-----------|
| `'auto'` → concrete tier resolution | Browser / Client (`sources/quality.ts`) | — | `navigator.connection` only exists client-side; the tier must be decided before the adapter picks a rung. Three adapters read the pref, so it must be ONE shared function, not per-adapter |
| QQ audio-URL detail call | Browser / Client → **direct** to upstream | API proxy (`/api/qq/detail`, retained fallback) | D-12: the upstream is CORS-open and needs no edge secret; the CF hop is measured pure overhead (~1s) |
| `matchKey → song_mid` lookup | API / Backend (`/api/resolve` on `caches.default`) | — | Shared across all users and cacheable indefinitely; a client write path would let one request change what everyone in the PoP resolves (the anti-poisoning invariant `resolve-edge.ts` exists to hold) |
| `http:` → `https:` scheme upgrade | Browser / Client (`sources/qq.ts`) | — | The direct call bypasses the proxy entirely under D-12, so a proxy-side upgrade would not fire on the hot path. Must be client-side |
| Byte-size ceiling / prebuffer decision | Browser / Client (`player.svelte.ts` `prebufferNext`) | — | Memory pressure is a device property; only the client knows it. Also the only tier that holds the Blob |
| Audio byte transfer | CDN / Static (`isure6.stream.qqmusic.qq.com`) | — | Unchanged; already direct today, which is why D-14's premise holds |
| Codec decode | Browser / Client (`<audio>`) | — | FLAC/m4a/ogg support is a per-browser fact; drives the `accom` `.ogg` pitfall |

---

## Decisions At Risk

> Four items. None invalidates a decision outright; **#1 and #2 change what a compliant plan must
> contain**, and skipping them would ship a real regression while technically satisfying the words of
> the decision.

### #1 — D-10 "no TTL" is UNSAFE for NEGATIVE entries (must be scoped to positives)

**Severity: HIGH — this one will bite in production.**

D-10 says the entry needs "no TTL and no bust machinery" because `song_mid` is permanent. That is true
of a **positive** entry. It is not true of the **negative** one, and Phase 31's design writes negatives
deliberately:

> `resolve-cache.ts:89-100` — "a CLEAN 'kuwo searched and this song is not there' IS written … because
> a genuine negative makes the repeat crawl cost ZERO subrequests."

The evidence that makes this dangerous is in the project's own skill, from a 38-song empirical spike:

> `Skill("spike-findings-openmusic")` › `source-resolution.md`: **"`qq` search is flaky (returns 0 rows
> intermittently under load, no throw)"** [CITED: .claude/skills/spike-findings-openmusic/references/source-resolution.md]

A flaky 0-row QQ search returns a **clean, well-formed, non-throwing** body. It is
byte-indistinguishable from "this song genuinely has no QQ version" — which is exactly the case
`resolve-edge.ts` classifies as `DRY` and **caches**. Under Phase 31's `RESOLVE_TTL_S = 900` a
false negative self-heals in 15 minutes. Under D-10's "no TTL" it is **pinned for the lifetime of the
PoP's cache entry**, and D-10 also removes the bust machinery that could repair it. Result: a song that
*does* have a QQ FLAC is permanently marked mid-less for every user in that data center, permanently
falling back to a lossy source — the exact opposite of the phase goal, silently.

**Recommendation (preserves D-10's intent, adds ~4 lines):** make permanence a property of the
*payload*, not the entry.
- Positive entry (`songid` present) → `Cache-Control: public, max-age=31536000` — permanent, per D-10.
- Negative / `DRY` entry → keep a short TTL (reuse `RESOLVE_TTL_S = 900`), **or** do not cache negatives
  at all. Cheapest correct option: keep the TTL; it is one ternary in `writeResolveEntry`.

Corollary: **the POST bust handler should be KEPT, not deleted.** D-11 explicitly says "a … stale hit
falls through to the client resolver silently and **repairs the entry**", and there is deliberately no
client *write* path (`resolve-edge.ts:9`), so bust-then-refill *is* the repair mechanism. A wrong mid
from a `matchKey` collision (two different songs normalizing to one key) is otherwise unrepairable
forever.

### #2 — D-10's mid cache cannot make click-to-play fast; it saves one call, not the RTT

**Severity: MEDIUM — reframes what "success" means, does not block anything.**

Arithmetic from the phase's own measurement table, for a **cross-source stub** (the case D-10 exists to
serve):

| Path | Round trips | Measured |
|---|---|---|
| Phase 31 cache HIT (url) | 1 own-origin | **0.44s** → playable URL immediately |
| Phase 32 cache HIT (mid) | 1 own-origin **then serially** 1 direct tang detail | 0.4s + 2.0–3.8s = **2.4–4.2s** |

The mid is not playable. It is a key you must then spend a tang RTT on. So D-10 collapses *2 tang calls
→ 1* (real, worth having) but the wall-clock floor for a cross-source stub is the tang detail RTT, which
is 2.0–3.8s from this sandbox. The ROADMAP's stated goal — *"Tap→audio in under a second"* — is
therefore **not** achievable via D-10.

It **is** achievable via **D-08**: a QQ-sourced deduped row already carries `song_mid` in the search
stub, so click→play is one direct tang call with zero lookup. D-08 is the latency decision; D-10 is a
call-count decision. The plan should say so, and verification should measure the two paths separately.

Two concrete consequences for the plan:
1. **Skip the `/api/resolve` lookup when the track already has a QQ mid.** `catalog.ts:323-326` reads
   the cache **unconditionally** (only `lrcUnresolved` bypasses it) with `RESOLVE_CACHE_TIMEOUT_MS =
   400`. Under D-10 the entry stores a mid, so for a track that *already has* a mid the lookup can
   never save anything — it is 0–400ms of pure serial waste on the *most common* post-D-08 path. One
   guard clause is the single largest latency win in this phase.
2. Do not let a verifier read "under a second" as a pass/fail gate on the cross-source path. State the
   sandbox-vs-real caveat: these are CN hosts probed from a US sandbox, so absolute values are
   inflated and ratios are what hold (the measurement note already says this).

### #3 — the project skill says qq is "not primary" material; D-01 overrides it, and that is defensible

**Severity: LOW — resolved in D-01's favour, recorded so the supersession is deliberate.**

`Skill("spike-findings-openmusic")` states, from 38 real songs across 14 segments:
`"qq search is flaky (returns 0 rows intermittently under load, no throw) — fine as fallback #2, not
primary."` and `"Try kuwo. It works ~100% of the time with cover inline. That's the whole hot path."`

This reads as a direct contradiction of D-01, but it is not, because the flakiness is in **search**, not
**detail**:
- **D-08 path** (QQ-sourced row, mid in hand): no search occurs at resolve time. Unaffected.
- **D-08 itself**: dedupe can only rank rows that exist. A 0-row QQ search means netease wins the row,
  exactly as today. Self-healing, no regression.
- **D-06 path** (cross-source stub, needs a QQ search for the mid): affected — and D-06 already says
  "never block the first note", which *is* the mitigation.
- **D-10 edge fill** (server-side QQ search): affected, and this is where the flakiness becomes
  permanent damage → see Decisions At Risk #1.

Verdict: **D-01 stands.** The skill's kuwo-first requirement is superseded for the resolve *head*; its
fallback chain survives as the failure path per D-01's second sentence. See the Supersession Map.

### #4 — the direct call puts tang failures into the SHARED circuit breaker

**Severity: LOW — accept and note, or add one line.**

`api-base.ts` `governedFetch` maintains ONE global breaker (`CIRCUIT_FAILURE_THRESHOLD = 30` failures in
`CIRCUIT_WINDOW_MS = 3000`) across every URL it fetches. D-13 routes the direct tang call through
`apiFetch`, so a tang outage now counts toward the breaker that also gates covers, lyrics, translate and
every `/api/*` call. When it trips, **all** of those fast-reject for `CIRCUIT_COOLDOWN_MS = 10_000`.

This is not a change in *kind* — today's `/api/qq/detail` failures already count. But two things get
slightly worse: (a) direct failures return ~1s faster than proxied ones, so a churn loop reaches 30
failures sooner, and (b) tang is a single unmaintained free API (the phase's own risk #2), so it is the
most likely thing to produce 30 fast failures.

Verdict: **accept.** Tripping the breaker under a tang outage is arguably *correct* behaviour (stop
hammering), and every caller degrades to a null sentinel. Note it in a comment so a future debugger does
not read "covers stopped loading" as a cover bug. Do **not** add a second per-host breaker — composing
local bounds is the named `api-fetch-flood-freeze` root cause.

---

## Research Questions — Answers

### Q1 — Is `Content-Length` readable on the QQ audio CDN from a browser? **YES.**

Probed live, 2026-08-31, with a fresh `song_play_url_sq` from tang, over **https**, with
`Origin: https://openmusic.lol` set. [VERIFIED: live probe]

```
HTTP/2 206
content-type: application/x-www-form-urlencoded
content-range: bytes 0-1023/55397039
content-length: 1024
access-control-allow-origin: *
access-control-allow-headers: Origin,origin,range,Range
access-control-allow-methods: GET,OPTIONS
access-control-expose-headers: Content-Length,Content-Range      ← the answer
```

Full (non-Range) `GET` exposes it identically:

```
HTTP/2 200
content-length: 55397039
accept-ranges: bytes
access-control-expose-headers: Content-Length,Content-Range
```

`Content-Length` is **not** a CORS-safelisted response header, so the explicit
`Access-Control-Expose-Headers` is exactly what makes `resp.headers.get('content-length')` return a
value instead of `null` cross-origin. It is present on both `200` and `206`, with and without an
`Origin` request header. **D-15 as written works.**

#### But use the detail body instead — it is free and known earlier

The tang detail body carries an exact byte count **per tier**, so the size is known **before any byte of
audio is requested**: [VERIFIED: live probe]

```
song_size_sq: "52.83MB"   song_size_sq_str: 55397039
song_size_pq: "29.72MB"   song_size_pq_str: 31168013
song_size_hq: "6.22MB"    song_size_hq_str:  6519764
song_size_standard: "3.13MB"  song_size_standard_str: 3283546
song_size_fq: "1.57MB"    song_size_fq_str:  1642440
```

| | `Content-Length` at prebuffer | `song_size_*_str` at resolve |
|---|---|---|
| Cost | opens a TCP connection + TLS + request head before deciding | free, already in a body we parse |
| Coverage | **all sources** | qq only |
| Timing | after the fetch starts (needs `resp.body.cancel()`) | before anything |

**Recommendation: implement BOTH, in that order of code size.**
1. **Primary (all sources, ~4 lines, root-cause placement):** in `prebufferNext`, after `await fetch(...)`
   resolves the head, read `resp.headers.get('content-length')`; if it parses above the ceiling, call
   `resp.body?.cancel()` and return with the uid still claimed (matching the existing flood-fix
   discipline at `player.svelte.ts:2601`). This guard covers kuwo/netease/joox too and needs no new
   `Track` field.
2. **Optional refinement (qq only):** stash the picked tier's `song_size_*_str` on the `Track` in
   `pickBestPlayUrl` so the decision is free. Only add this if the ~200ms of a wasted connection setup
   measurably matters — it probably does not. `ponytail: skipped the Track-field plumbing; add when the head-request cost shows up in a measurement.`

**Ceiling recommendation: 24 MB** (Claude's Discretion). Rationale from the measured ladder: it admits
every `hq` (6–7 MB) and `standard` (3 MB) tier unconditionally — so the `bg-lockscreen-stall-noskip`
protection is fully preserved on the cellular/`'320'` path, which is the path most likely to be
backgrounded — and rejects every `sq` (34–53 MB) and `pq` (30 MB) FLAC. Set it as an exported module
constant next to the other tunables so it is tweakable without hunting.

Note this makes D-15's guard effectively "prebuffer lossy tiers, stream lossless tiers", which is the
honest reading of D-15's own tradeoff sentence.

#### One correction to the phase note's FLAC weight

The note estimates *"933kbps ≈ 7MB/min"*. Measured across three real tracks, `kbps_sq` is **959–1647**,
not 933, and 晴天 is **52.83 MB for 4:29 ≈ 11.8 MB/min**. Plan for a ~12 MB/min worst case, not 7. This
makes D-15 *more* necessary, not less.

### Q2 — Connection detection: what is actually available? **`type` on Android only; nothing on iOS.**

`grep -rn "navigator\.connection\|effectiveType\|saveData\|NetworkInformation\|mozConnection\|webkitConnection" src/` → **NONE FOUND**. Confirmed net-new. [VERIFIED: codebase grep]

Authoritative support matrix, from MDN's `browser-compat-data` (`api/NetworkInformation.json`, `main`):
[VERIFIED: github.com/mdn/browser-compat-data]

| Property | Chrome | Chrome Android | WebView Android | Safari | Safari iOS | Firefox |
|---|---|---|---|---|---|---|
| **`type`** (`'wifi'`/`'cellular'`/…) | 61 — **partial, "Only supported on ChromeOS"** | **38 ✓** | **50 ✓** | **false** | **false** | 31, **removed in 32** |
| `effectiveType` (`'4g'`…) | 61 ✓ | 38 ✓ | 50 ✓ | **false** | **false** | **false** |
| `saveData` | 65 ✓ | ✓ (mirror) | ✓ (mirror) | **false** | **false** | **false** |
| `downlink` / `rtt` | 61 ✓ (clamped ≤10 Mbps / ≤3000 ms, anti-fingerprinting) | 38 ✓ | 50 ✓ | false | false | false |

`type` status: `experimental: true`. `effectiveType`/`saveData`: `experimental: false`, standard-track.

**Yes, `type` is gated differently from `effectiveType`.** `type` is Android + WebView + ChromeOS only;
`effectiveType` is all Chromium including desktop. Three consequences:

1. **D-03's premise is exactly right, with a citation.** iOS Safari ships none of it → `'320'`. Not a
   bug; a documented platform gap.
2. **Chrome desktop also lands in the no-signal branch** (its `type` is ChromeOS-only). Desktop web gets
   `'320'` under `'auto'` too. CONTEXT does not mention this; it is consistent with D-03's rule and worth
   one comment so it is not later read as a bug.
3. **The Capacitor Android APK DOES get `type`** (WebView Android 50+). The native build gets
   wifi-lossless without any Capacitor plugin — do **not** reach for `@capacitor/network`.

#### Recommended detection expression

Use `type` as a **whitelist that fails closed to `'320'`**. Do **not** use `effectiveType` as the
metering signal: it is a *speed* estimate, and fast cellular reports `'4g'` — using it would hand FLAC
to exactly the connection D-02 wants to protect.

```ts
// src/lib/sources/quality.ts

/** The Network Information API subset we read. NOT in lib.dom.d.ts, so narrow it locally —
 *  the same discipline `proxy/edge-cache.ts` uses for the Cloudflare `caches.default` gap
 *  (a proper interface, never an `as any` — the repo has zero in production source). */
interface NetInfo {
	type?: 'bluetooth' | 'cellular' | 'ethernet' | 'none' | 'wifi' | 'wimax' | 'other' | 'unknown';
	saveData?: boolean;
}

/**
 * Resolve the `'auto'` rung to a concrete tier (32-D-02 / 32-D-03).
 *
 * WHITELIST, fail-closed: lossless ONLY on a connection we can positively identify as unmetered.
 * `NetworkInformation.type` is the accurate value and is supported on Chrome Android 38+ and
 * WebView Android 50+ (so the Capacitor APK gets it) — but is FALSE on Safari/iOS entirely and
 * ChromeOS-only on Chrome desktop [MDN browser-compat-data]. Those platforms therefore get '320'
 * under the default, which is 32-D-03: a DELIBERATE accepted tradeoff, NOT a bug to fix.
 *
 * `effectiveType` is deliberately NOT consulted: it estimates SPEED, not metering, so fast
 * cellular reports '4g' and would be handed FLAC — the exact case D-02 exists to avoid.
 */
export function effectiveQuality(pref: DefaultQuality): Exclude<DefaultQuality, 'auto'> {
	if (pref !== 'auto') return pref;
	if (!browser) return '320';
	const c = (navigator as Navigator & { connection?: NetInfo }).connection;
	if (!c || c.saveData === true) return '320';
	return c.type === 'wifi' || c.type === 'ethernet' ? 'lossless' : '320';
}
```

- `browser` guard per CLAUDE.md's SSR rule (the app SSRs on Cloudflare and builds as a Capacitor SPA).
- No vendor prefixes: `mozConnection` was removed in Firefox 32/99 and `webkitConnection` is dead. Adding
  them is dead code.
- `saveData` honoured because it is free and it is the one signal a user explicitly opts into.
- Return type excludes `'auto'` so the compiler proves no adapter can still see `'auto'`.
- Pure `.ts`, **not** `.svelte.ts` — nothing here is UI-read reactively, so no runes. This also keeps it
  node-testable under the single Vitest server project.

**On surfacing the downgrade to the user (discretion): don't.** It costs 16 i18n dictionaries and a new
UI surface, and the Deferred Ideas section already rejected a data-saver toggle for the same reason. The
existing `settings.defaultQualityNote` ("Best-effort — sources don't all expose bitrate…") is already
the honest disclaimer; extend that one string if anything.

### Q3 — Cache API patterns for a permanent entry; what shrinks

#### How the existing entry encodes TTL and version

| Mechanism | Where | Value |
|---|---|---|
| Entry-shape **version** | *in the cache key*, `resolve-cache.ts:58` — `?v=${RESOLVE_CACHE_VERSION}&k=…` | `'1'` |
| Entry **TTL** | `Cache-Control` on the **stored** `Response`, `resolve-cache.ts:115` | `public, max-age=900` |
| Response TTL | `Cache-Control` on the **route** response, `+server.ts:57` | `no-store` (deliberate — see below) |
| Bust | `bustResolveEntry` → `cache.delete`, PoP-local | `resolve-cache.ts:129` |

The version-in-key idiom is documented as intentional: `cache.delete` is PoP-local, so a shape change
can never be migrated in place — bumping `v` makes every PoP miss onto a new namespace and lets the old
one expire (`resolve-cache.ts:15-19`). **D-10 changes the entry shape, so `RESOLVE_CACHE_VERSION` MUST be
bumped to `'2'`.** That is the single most important line in the whole cache change and it is easy to
miss.

The `no-store` on the route response is load-bearing and must **stay**. Its comment records a real bug:
shipping `public, max-age=RESOLVE_TTL_S` there made Cloudflare store the `{hit:true, entry}` JSON in the
automatic response cache, so a successful POST bust was followed by `{hit:true}` + `CF-Cache-Status: HIT`
for up to 900s — handing back the exact dead URL just reported.

#### Cloudflare `caches.default` constraints for a "permanent" entry

[CITED: developers.cloudflare.com/workers/runtime-apis/cache/]
- **No documented maximum `max-age` / edge TTL.** `max-age=31536000` (1 year) is accepted.
- **Persistence is NOT guaranteed.** Contents "do not replicate outside of the originating data center"
  and are subject to eviction. "Permanent" means *no expiry*, not *guaranteed present* — which is fine
  precisely because D-11 makes the cache advisory.
- `put()` **throws** on: a non-`GET` request, a `206 Partial Content` response, or `Vary: *`.
  Responses carrying `Set-Cookie` are never cached. `resolve-cache.ts:97-100` already handles all of
  this by constructing a fresh `Response` with a two-header allow-list — **keep that pattern verbatim.**
- A `413` is returned if the response is too large or `Cache-Control` says don't cache.

#### `/api/og`'s proven pattern (the 1698ms → 2ms precedent)

`src/routes/api/og/+server.ts` runs **two** layers, both keyed through `ownOriginCacheKey` (never an
upstream URL — the secret-leak invariant):

```
TTL         = 86400                                    // og/+server.ts:67
CACHE_CONTROL = `public, max-age=${TTL}, immutable`     // og/+server.ts:68
resolveKey  = ownOriginCacheKey(
                `${url.origin}/api/og/_resolve?k=${matchKey(artist,title)}&t=${type}`)  // :298
bytesKey    = ownOriginCacheKey(url)                    // :268
```

The transferable parts: (a) `matchKey`-folded synthetic own-origin key on a non-route path so query-order
and hyphen-for-space variants collapse onto one entry; (b) `immutable` in the `Cache-Control` alongside a
long `max-age`; (c) fault vs clean-negative discipline — "a fault must be retried next request, not
pinned for the whole TTL" (`og/+server.ts:149`). `/api/resolve` already copies (a) and (c). D-10's
change is to add `immutable` and stretch `max-age` **for positive entries only** (Decisions At Risk #1).

#### What specifically DELETES / SHRINKS

| Code | Fate | Why |
|---|---|---|
| `ResolveEntry.url: string \| null` | **DELETE the field** | It is the *only* reason the entry expires. Removing it is what makes D-10 true |
| `resolve-edge.ts` kuwo **detail** call (lines 85-98, ~14 lines) | **DELETE** | `song_mid` arrives on every QQ **search** row (measurement note, Finding 3) → the fill drops from **2 subrequests to 1**. Fewer edge subrequests, faster fill, less to fault on |
| `resolve-edge.ts` kuwo search + `KuwoSearchRow` + `kuwoProxy` import | **REPLACE** with `qqProxy.buildUrl('search', …)` + a `QQSearchRow { song_mid, song_title, singer_name }` | The proxy adapter already builds the tang URL in exactly one place; reuse it. Roughly line-for-line, not a growth |
| `resolve-cache.ts` `RESOLVE_TTL_S = 900` | **KEEP, narrow the comment** | Still used for negative entries (Decisions At Risk #1). Add `RESOLVE_MID_TTL_S = 31_536_000` for positives |
| `RESOLVE_CACHE_VERSION` | `'1'` → **`'2'`** | Mandatory. Shape change = key change |
| `bustResolveEntry` + `POST` handler + `reportDeadUrl` | **KEEP** | D-11's "repairs the entry" has no other mechanism; a `matchKey`-collision wrong-mid is otherwise permanent. See Decisions At Risk #1 |
| `avail: Record<string,'ok'\|'dry'>` | **KEEP** | `catalog.ts:373` threads it into `resolveNameStub` to skip a known-dry source — independent of the url change |
| `catalog.ts:328-356` cache-HIT branch | **SIMPLIFIES** | See below |
| `+server.ts` `jsonResult` `no-store` | **KEEP verbatim** | Documented bug-prevention |
| `edge-cache.ts` | **NO CHANGE** | `EdgeCache.delete` stays used |

**The `catalog.ts` hit branch gets strictly simpler**, which is worth calling out because it is a rare
net-negative diff. Today a hit yields `{ audioUrl, detailsLoaded: true, lrcUnresolved: true }` — the
`lrcUnresolved` flag exists solely because the cached URL carries no lyrics, forcing a later re-resolve
just for the lyric pane. Under D-10 a hit yields a **mid**, which then flows into
`SOURCES['qq'].resolve()`, and that one direct call returns **url + timestamped LRC + duration +
album_pic together** (Q5). So:

> the `lrcUnresolved: true` marker and its whole re-resolve round trip are **not needed on the mid-cache
> hit path**. A mid-cache hit is a *complete* resolve; a Phase-31 url-cache hit never was.

New hit-branch shape (a mid rewrite that falls THROUGH to the resolve, rather than short-circuiting it):

```ts
// 32-D-10: the entry now holds a PERMANENT qq song_mid, not an expiring url. A hit is not a
// finished resolve — it is a shortcut past the qq SEARCH. Rewrite identity onto qq and fall
// through to the one direct tang detail call below, which returns url + lrc + duration + cover
// together (so the 31-D-08 `lrcUnresolved` re-resolve is not needed on this path).
```

### Q4 — The direct-fetch seam

#### What breaks if an absolute URL is passed to `apiFetch` today

`apiUrl` is a bare concat (`api-base.ts:26-29`):

```ts
export function apiUrl(path: string): string {
	const BASE = import.meta.env.VITE_API_BASE ?? '';
	return BASE + path;
}
```

| Build | `VITE_API_BASE` | `apiUrl('https://tang.api.s01s.cn/…')` | Outcome |
|---|---|---|---|
| **Web** | unset → `''` | `'https://tang.api.s01s.cn/…'` | **Works today, unchanged.** Absolute in, absolute out |
| **Native** (`pnpm build:native`) | `'https://openmusic.lol'` | `'https://openmusic.lolhttps://tang.api.s01s.cn/…'` | **Hard `TypeError` at `fetch`.** After `https://` the authority parses as `openmusic.lolhttps:` and the port component is `//tang…`, which is not a valid port → URL parse failure |

The native failure is at least **deterministic and loud**, not a silently wrong request — but it means
the direct path is broken in the APK, i.e. broken on the exact platform whose WebView *does* expose
`NetworkInformation.type` and therefore gets lossless. Not optional.

**Minimal guard — one line, at the top of `apiUrl`:**

```ts
export function apiUrl(path: string): string {
	// 32-D-13: an ABSOLUTE url is already fully resolved — return it untouched. Without this the
	// NATIVE build (VITE_API_BASE set) concatenates into 'https://openmusic.lolhttps://tang…',
	// which is not a parseable URL and throws at fetch. The direct qq detail call (32-D-12) is the
	// first caller to pass one; every /api/* caller still takes the BASE + path branch below.
	if (/^https?:\/\//i.test(path)) return path;
	const BASE = import.meta.env.VITE_API_BASE ?? '';
	return BASE + path;
}
```

Placing it in `apiUrl` rather than at the qq call site is the root-cause placement: every current and
future absolute-URL caller is covered by one guard instead of each caller remembering. `api-base.test.ts`
lines 31 and 36 both pass relative paths, so both stay green.

#### Does anything trigger a CORS preflight? **No — the direct GET stays a simple request.**

Traced end to end:
- `sources/qq.ts` `resolve()` calls `apiFetch(path, { signal })` — `signal` only, **no `headers`**.
- `apiFetch` → `governedFetch` → `fetch(url, { ...init, signal: timeout.signal })`. It **adds no
  headers**, never sets `credentials`, never sets `mode`, and for GET it strips only `signal`.
- Method `GET`, no author-set request headers, `credentials` defaulting to `'same-origin'` (→ omitted
  cross-origin) = a **simple request**. No `OPTIONS`.

Live confirmation of the tang response: [VERIFIED: live probe]

```
HTTP/2 200
content-type: application/json;charset=utf-8
access-control-allow-origin: *
access-control-allow-methods: *
access-control-allow-headers: Content-Type
set-cookie: server_name_session=…; Max-Age=86400; httponly; path=/
```

Two things to protect in the plan:
1. **Never set `credentials: 'include'` on the direct call.** tang sends `ACAO: *` and **no**
   `Access-Control-Allow-Credentials`, so a credentialed request is a hard CORS failure. It also sends
   `Set-Cookie`, which is the kind of thing that invites someone to "fix" it with `include`. Nothing sets
   it today; add a comment so nobody starts.
2. **Never add a request header to the direct call.** tang's `Access-Control-Allow-Headers` is only
   `Content-Type`, so any custom header both triggers a preflight *and* fails it. A preflight measured
   **1.016s** against the CDN — adding one back would defeat the ~1s the whole D-12 split exists to
   save.

For completeness, the CDN's own preflight response (only relevant if a `Range` header were ever set
explicitly): `access-control-allow-methods: GET,OPTIONS`, `access-control-allow-headers:
Origin,origin,range,Range`, `access-control-max-age: 60`. `Range` is safelisted for simple values
anyway, and `<audio>`/`prebufferNext` do not set it.

**Which URL to build.** `proxy/qq.ts` already holds `TANG_BASE` and the param mapping in exactly one
place. Do **not** hardcode a second copy of the host in `sources/qq.ts`. `qqProxy.buildUrl('detail', new
URLSearchParams({ mid }), undefined)` returns the exact absolute upstream URL and keeps D-12's "the proxy
route is RETAINED as a fallback" cheap — the fallback is then `apiFetch('/api/qq/detail?…')` with the
same params. Note `qqProxy.buildUrl` currently always sets `type=json` and copies `msg` only when
present, so a `mid`-only call already produces the right URL with no edit.

### Q5 — QQ detail completeness on `mid` alone: **nothing is lost. D-09 is free.**

Live `GET https://tang.api.s01s.cn/music_open_api.php?type=json&mid=0039MnYb0qxYhV` (no `msg`), 2.29s,
HTTP 200. [VERIFIED: live probe]

| `Track` field | Detail key | Present? | Value |
|---|---|---|---|
| `duration` | `song_play_time` | ✓ | `269` (number, seconds) |
| `lrc` (timestamped) | `song_lyric` | ✓ | 1388 chars, `[ti:晴天][ar:周杰伦]…[00:02.25]…` — real LRC |
| `lrc` (plain fallback) | `lyric` | ✓ | 715 chars |
| `cover` | `album_pic` | ✓ | `http://y.gtimg.cn/music/photo_new/T002R500x500M000…jpg` |
| `cover` (fallback) | `singer_pic` | ✓ | present |
| `album` | `album_name` / `album_title` | ✓ | `叶惠美` |
| `title` | `song_title` / `song_name` | ✓ | `晴天` |
| `artist` | `singer_name` | ✓ | `周杰伦` |
| `pageUrl` | `song_h5_url` | ✓ | present |
| `qqQualityText` | `vip` | ✓ | `付费` |
| identity guard | `song_mid` | ✓ | echoed back |
| **all six** `song_play_url_*` | — | ✓ | full ladder |
| **bonus** | `song_size_*_str` | ✓ | exact bytes per tier — see Q1 |

Also present and unused today: `language`, `genre`, `public_time`, `singer_mid`, `duration` as
`"00:04:29"`, `qrc` (a Chinese notice that per-character lyrics are no longer served), `tips`.

**Conclusion: `msg` contributes nothing. Removing it costs zero fields.** And no test asserts `msg=` in
the URL (`qq.test.ts:148-150` asserts only the `/api/qq/detail?` prefix and `mid=`), so D-09 is
test-safe on its own.

#### Failure shapes — three distinct ones, all already handled

| Input | HTTP | Body | Current handling |
|---|---|---|---|
| **Bad/unknown mid** (`mid=NOTAREALMIDXX`) | **200** | Valid JSON, **every field `null`**, `kbps_*: 0`, `song_play_url_*: null`, `duration: "00:00:00"` | `qq.ts:225` `if (!d \|\| typeof d !== 'object' \|\| !d.song_mid) throw` — **already correct**. `detailsLoaded` stays `false`, next play retries |
| **Empty mid** (`mid=`) | **200** | Plain text `参数错误` ("parameter error") — **not JSON** | `res.json()` rejects → caught at `qq.ts:281` → rethrown. Correct, but note a **non-JSON 200 is possible**, so never assume `res.ok` implies parseable JSON |
| Absent mid on the Track | — | — | `qq.ts:218` throws `missing mid` before any fetch. Correct — and it is why the empty-mid case above should never be reachable from `resolve()` |

Two planning notes: (a) a bad mid returns **200**, so `governedFetch` records it as a breaker
**success** — correct, the upstream *is* alive; (b) the all-null body has `vip: "免费"`, so `vip` is
**not** a usable liveness discriminator. Only `song_mid` is, which is exactly what the existing guard
checks.

### Q6 — Existing test surface, and exactly what breaks

**Framework:** Vitest `^4.1.3`, single `node` project (no jsdom), `include:
['src/**/*.{test,spec}.{js,ts}']`, **`expect: { requireAssertions: true }`** — every test must assert.
95 test files. `pnpm test` = `vitest --run`; `pnpm check` = `svelte-kit sync && svelte-check`.

| File | Lines | Covers |
|---|---|---|
| `src/lib/sources/qq.test.ts` | 249 | 3 search + 10 resolve cases, fixture-backed off `__fixtures__/qq.detail.json` |
| `src/lib/services/dedupe.test.ts` | 177 | `groupVariants`, `collapseVariants`, `variantTag` |
| `src/lib/services/api-base.test.ts` | 337 | `apiUrl` both branches, dedupe, concurrency cap, circuit breaker, the Pitfall-3 absolute-URL case |
| `src/lib/proxy/resolve-cache.test.ts` | — | key building, read/write/bust primitives |
| `src/lib/proxy/resolve-edge.test.ts` | — | the kuwo search+detail edge fill |
| `src/routes/api/resolve/resolve-endpoint.test.ts` | — | GET/POST/OPTIONS handlers |
| `src/lib/services/resolve-cache-client.test.ts` | — | never-throw mapping, served-url registry, one-shot report |
| `src/lib/services/match-key.test.ts` | — | normalization |

#### Breakage map

| Change | Test | Verdict |
|---|---|---|
| **D-12** direct URL | `qq.test.ts:148-150` — `expect(calledUrl).toMatch(/^\/api\/qq\/detail\?/)` | **BREAKS.** Must assert the absolute tang URL. This is a *good* break — it is the one assertion that pins the hop |
| **D-09** `msg` removal | — | **Safe.** Nothing asserts `msg=`. Consider ADDING `expect(calledUrl).not.toContain('msg=')` so the removal is pinned |
| **D-02** default `'auto'` | `qq.test.ts:86-95` pins `settings.defaultQuality` per case in `beforeEach`/`afterEach` | **Safe** — deliberately insulated from the live default. But the comment *"rather than the live default ('128')"* becomes stale → D-04-class comment fix |
| **D-02** new `'auto'` behaviour | — | **GAP.** No test exercises `'auto'`. New tests required (see Wave 0) |
| **D-05** https upgrade | `qq.test.ts:133`, `:215`, `:227` assert `toBe(detailFixture.song_play_url_*)` | **Stay green — and that is the problem.** `__fixtures__/qq.detail.json` is already `https://dl.stream.qqmusic.qq.com/…`, so an idempotent upgrade changes nothing and D-05 ships **untested**. **Wave 0: change the fixture to the real `http://isure6.stream.qqmusic.qq.com/…` shape** so the upgrade is actually asserted |
| **D-08** `SOURCE_RANK` | `dedupe.test.ts` | **Safe.** Zero winner-*source* assertions; the netease/qq/kuwo cases assert *grouping* and *order preservation*, not who wins. `dedupeBest` tie-break is untested → new test (Wave 0) |
| **D-13** `apiUrl` guard | `api-base.test.ts:31`, `:36` | **Safe** — both pass relative paths. New absolute-path case required |
| **D-10** entry shape | `resolve-cache.test.ts`, `resolve-edge.test.ts`, `resolve-endpoint.test.ts`, `resolve-cache-client.test.ts` | **BREAK broadly.** `ResolveEntry.url` disappears and the edge fill switches kuwo→qq. Rewrite, do not patch |
| **D-15** ceiling | — | **GAP.** `prebufferNext` is private; assert via the ceiling helper (see Wave 0) |

Also: `src/lib/stores/player.svelte.test.ts` imports `dedupeBest` — check its cases when D-08 lands.
`pnpm check` (`svelte-check`) is the second gate and will catch the `ResolveEntry.url` removal at every
call site, which is the cheapest way to find them all.

---

## Standard Stack

**No new dependencies. Zero.** The web app has no third-party runtime npm deps by design and this phase
adds none — every capability needed is a platform API already in use.

### Core (existing, unchanged versions)
| Library | Version | Purpose | Why Standard |
|---|---|---|---|
| Svelte | `5.56.2` (runes, forced) | stores/UI | project standard |
| SvelteKit | `2.63.0` | routing, edge endpoints | project standard |
| Vitest | `^4.1.3` | tests, node project | project standard |
| TypeScript | `~5.9` strict | all logic | project standard |

### Platform APIs this phase newly uses
| API | Purpose | Availability | Guard needed |
|---|---|---|---|
| `navigator.connection` (`NetworkInformation`) | D-02/D-03 wifi-vs-cellular | Chrome Android 38+, WebView Android 50+, Chrome desktop (ChromeOS only for `type`); **none** on Safari/iOS/Firefox | `browser` + `if (!c)` + local narrowing interface (not in `lib.dom.d.ts`) |
| `Response.headers.get('content-length')` cross-origin | D-15 ceiling | requires `Access-Control-Expose-Headers` — **verified present** on the QQ CDN | `Number.isFinite` on the parse |
| `ReadableStream.cancel()` via `resp.body?.cancel()` | abandon an over-ceiling prebuffer without downloading | universal | optional-chain (absent in some test doubles) |
| `caches.default` `Cache-Control: immutable` + long `max-age` | D-10 permanence | Cloudflare Workers | already via `edgeCache()` |

### Alternatives Considered
| Instead of | Could Use | Tradeoff |
|---|---|---|
| `NetworkInformation.type` | `@capacitor/network` plugin | Only helps the APK — and WebView Android 50+ **already** exposes `type`, so the plugin adds a dependency, a native sync, and a web/native code split for zero coverage. **Rejected** |
| `NetworkInformation.type` | `effectiveType === '4g'` | Measures speed, not metering. Fast cellular reports `'4g'` → hands FLAC to the connection D-02 protects. **Rejected as the metering signal** |
| `Content-Length` at prebuffer | `song_size_*_str` at resolve | Free and earlier, but qq-only and needs a new `Track` field. **Use as an optional refinement, not the primary** |
| `Content-Length` at prebuffer | a `HEAD` request first | The CDN's `Access-Control-Allow-Methods` is `GET,OPTIONS` — `HEAD` is not advertised. And it adds a full RTT for information the GET head already carries. **Rejected** |
| Deleting the POST bust | keeping it | See Decisions At Risk #1 — a wrong mid from a `matchKey` collision is otherwise permanent |

**Installation:** none.

## Package Legitimacy Audit

**Not applicable — this phase installs no external packages.** No `npm install` step exists in any
recommendation above; the slopcheck gate has nothing to evaluate. The only external artifacts touched are
HTTP endpoints already in production use (`tang.api.s01s.cn`, `isure6.stream.qqmusic.qq.com`).

---

## Architecture Patterns

### System Architecture Diagram

```text
                            ┌──────────────── USER TAPS A ROW ────────────────┐
                            │                                                │
                   row.source === 'qq'                             row.source !== 'qq'
                   (song_mid IN HAND — the                         (no qq mid — the D-06
                    D-08 fast path)                                 uncommon path)
                            │                                                │
                            │                                    ┌───────────┴───────────┐
                            │                                    │  play whatever URL    │
                            │                                    │  resolves NOW —       │
                            │                                    │  never block the      │
                            │                                    │  first note (D-06)    │
                            │                                    └───────────┬───────────┘
                            │                                                │ background,
                            │                                                │ fire-and-forget
                            │                                    ┌───────────▼───────────┐
                            │                                    │ GET /api/resolve?a&t  │
                            │                                    │ (own-origin, ≤400ms,  │
                            │                                    │  caches.default)      │
                            │                                    └───────────┬───────────┘
                            │                                     HIT: mid   │  MISS: {hit:false}
                            │                                                │  + waitUntil edge fill
                            │                                                │    (ONE qq search →
                            │                                                │     song_mid, D-10)
                            │                                    ┌───────────▼───────────┐
                            │                                    │ write cache ONLY.     │
                            │                                    │ NO audio.src swap     │
                            │                                    │ (D-07) — lossless     │
                            │                                    │ applies NEXT play     │
                            │                                    └───────────────────────┘
                            │
   ┌────────────────────────▼────────────────────────┐
   │ SKIP the /api/resolve lookup entirely           │  ← Decisions At Risk #2:
   │ (a mid is already held; the entry stores a mid, │    saves 0-400ms of serial
   │  so it can never save a call here)              │    waste on the COMMON path
   └────────────────────────┬────────────────────────┘
                            │
   ┌────────────────────────▼────────────────────────────────────────────────┐
   │ effectiveQuality(settings.defaultQuality)   [sources/quality.ts]        │
   │   'auto' + navigator.connection.type ∈ {wifi, ethernet} + !saveData     │
   │            → 'lossless'                                                 │
   │   'auto' + anything else (incl. undefined = iOS/desktop) → '320'        │
   └────────────────────────┬────────────────────────────────────────────────┘
                            │
   ┌────────────────────────▼────────────────────────────────────────────────┐
   │ ONE DIRECT CORS GET (simple request, no preflight)   [D-12/D-13]        │
   │   apiFetch(qqProxy.buildUrl('detail', {mid}))                          │
   │   → tang.api.s01s.cn   (governor: dedupe + cap 8 + 25s + breaker)      │
   │   fallback on CORS loss: apiFetch('/api/qq/detail?…')                  │
   └────────────────────────┬────────────────────────────────────────────────┘
                            │  ONE body carries EVERYTHING (Q5):
                            │  ladder urls · song_size_*_str · song_play_time
                            │  · song_lyric (LRC) · album_pic · album_name
   ┌────────────────────────▼────────────────────────────────────────────────┐
   │ pickBestPlayUrl(detail, tier)   [sources/qq.ts]                         │
   │   tier → rung;  http: → https: UPGRADE (D-05);  drop/demote `accom`     │
   │   (.ogg 伴奏 — see Pitfall 1)                                           │
   └────────────────────────┬────────────────────────────────────────────────┘
                            │
   ┌────────────────────────▼────────────────────────────────────────────────┐
   │ POST-RESOLVE TAIL — DO NOT TOUCH (D-16, measured & cleared)             │
   │ driveSrc() → audio.play()   then, AFTER playback starts:                │
   │   persist · adoptCover · writeCoverBoth · MediaSession · backfillLyrics │
   └────────────────────────┬────────────────────────────────────────────────┘
                            │ ≥5s timeupdate gate → prewarmNextAssets(next-1 only, D-17)
   ┌────────────────────────▼────────────────────────────────────────────────┐
   │ prebufferNext(next)  [raw fetch — media NEVER via apiFetch]             │
   │   read Content-Length from the response head        (D-15, Q1)          │
   │     ≤ CEILING → resp.blob() → blob: URL (bg-stall protection kept)      │
   │     > CEILING → resp.body?.cancel(); claim uid; STREAM from CDN instead  │
   └─────────────────────────────────────────────────────────────────────────┘
```

### Recommended Project Structure

No new directories. Every change lands in an existing file — which is the point.

```
src/lib/
├── sources/
│   ├── quality.ts          # + effectiveQuality() — the ONE 'auto' resolution seam (D-02/D-03)
│   ├── qq.ts               # tier pick, https upgrade, msg removal, direct-vs-proxy (D-04/05/09/12)
│   ├── kuwo.ts             # 1 line: route the pref through effectiveQuality
│   └── joox.ts             # 1 line: route the pref through effectiveQuality
├── services/
│   ├── api-base.ts         # + absolute-URL guard in apiUrl (D-13)
│   ├── dedupe.ts           # 1 line: SOURCE_RANK (D-08)
│   └── catalog.ts          # hit branch: mid rewrite + fall through; skip lookup when mid held
├── proxy/
│   ├── resolve-cache.ts    # ResolveEntry.url out; VERSION 1→2; split positive/negative TTL
│   └── resolve-edge.ts     # kuwo search+detail → ONE qq search for song_mid (D-10)
├── config/defaults.ts      # defaultQuality '128' → 'auto' + corrected comment (D-02/D-04)
└── stores/player.svelte.ts # prebufferNext ONLY: the size ceiling (D-15). NOTHING in 2892-3033 (D-16)
```

### Pattern 1: One resolution seam for `'auto'`, not three

**What:** A single exported `effectiveQuality(pref)` in `sources/quality.ts` maps `'auto'` to a concrete
tier; every adapter calls it instead of reading `settings.defaultQuality` raw.

**When to use:** Mandatory for D-02. **This is the difference between D-02 working and D-02 shipping a
cellular data regression on two other sources.**

The pref is read in **three** adapters, and `quality.ts:31` currently treats `'auto'` as `'lossless'`:

```
src/lib/sources/qq.ts:102     const pref = quality ?? settings.defaultQuality;
src/lib/sources/kuwo.ts:104   const level = (quality ?? settings.defaultQuality) === '128' ? '128k' : 'zp';
src/lib/sources/joox.ts:155   const order = pickByQualityPref(JOOX_QUALITY_ORDER, quality ?? settings.defaultQuality);
src/lib/sources/quality.ts:30 const band = pref === '128' ? BAND_128 : pref === '320' ? BAND_320 : null;
src/lib/sources/quality.ts:31 // 'lossless' / 'auto' → leave the ladder as-is (top tier first).
```

Flip the default to `'auto'` and touch only `qq.ts`, and **kuwo goes to `'zp'` (its top tier) and JOOX
keeps its Atmos/FLAC-first verbatim order — on cellular, by default, silently.** Fixing it inside each
adapter is three copies of the same connection check. One shared function, three one-line call sites:

```ts
// each adapter, one line changed:
const pref = effectiveQuality(quality ?? settings.defaultQuality);
```

`quality.ts` is already the shared quality module and is already imported by `joox.ts`, so this adds no
new import edge and no cycle risk. Note `kuwo.ts` has no distinct 320 rung — `'320'` maps to `'zp'`
there either way; that is a pre-existing honesty gap covered by `settings.defaultQualityNote`, not a new
one.

### Pattern 2: Build the direct upstream URL from the proxy adapter

**What:** `qqProxy.buildUrl('detail', new URLSearchParams({ mid }), undefined)` returns the absolute
tang URL. Pass that to `apiFetch`.

**When to use:** The D-12 direct call, and its D-12 proxy fallback.

**Why:** `proxy/qq.ts` already holds `TANG_BASE` and the param mapping "in exactly ONE place" per its own
header comment. A second hardcoded host in `sources/qq.ts` would be the second place. It also makes the
retained-proxy fallback trivially symmetric — same params, different prefix.

```ts
// Source: src/lib/proxy/qq.ts:11-40 (existing, no edit needed for a mid-only call)
const upstream = new URL(TANG_BASE);        // https://tang.api.s01s.cn/music_open_api.php
upstream.searchParams.set('type', 'json');
const msg = searchParams.get('msg'); if (msg !== null) upstream.searchParams.set('msg', msg);
const mid = searchParams.get('mid'); if (mid !== null) upstream.searchParams.set('mid', mid);
```

`proxy/qq.ts` needs **no change** — omitting `msg` already produces the correct `mid`-only URL. One
caveat: `proxy/qq.ts` is edge code and `sources/qq.ts` is client code; the import direction is
client→proxy for a pure `buildUrl` (no `env`, no fetch), which is the same direction `resolve-edge.ts`
already uses. Confirm `svelte-check` is happy; if a bundling concern appears, hoist `TANG_BASE` into a
shared const rather than duplicating the host.

### Pattern 3: Never-throw + generation-guard, unchanged

**What:** The background mid resolve (D-06) must either follow the `playGen` re-read-after-await idiom or
be explicitly fire-and-forget with no write-back to `player.current`.

**Recommendation: fire-and-forget with no write-back.** D-07 already forbids the mid-song swap, so the
background resolve's *only* effect is a cache write. With no write-back there is nothing to supersede,
so no new generation counter is needed at all — the simplest correct shape, and it is why D-07 was
chosen.

The existing never-throw boundary already covers the failure path: `resolve-cache-client.ts` maps a
non-ok response, `{hit:false}`, malformed JSON, an abort, its 400ms timeout **and an open circuit
breaker** all to `null`, and `catalog.ts:359` documents the fall-through as having "no side effect".

### Pattern 4: Permanence as a payload property, not an entry property

**What:** `writeResolveEntry` picks the `max-age` from the payload:

```ts
// 32-D-10: a POSITIVE entry holds a permanent song_mid → cache it forever. A NEGATIVE (DRY)
// entry is only "qq had no row for this key RIGHT NOW" — and qq search is empirically flaky
// (returns 0 rows intermittently, no throw: Skill(spike-findings-openmusic)/source-resolution.md),
// so a clean 0-row body is INDISTINGUISHABLE from a genuine miss. Pinning that forever would
// permanently mark a song mid-less for every user in the PoP. Negatives keep the 31 TTL.
const maxAge = entry.songid ? RESOLVE_MID_TTL_S : RESOLVE_TTL_S;
```

See Decisions At Risk #1.

### Anti-Patterns to Avoid

- **Putting the `'auto'` resolution inside `qq.ts`** — silently sends kuwo and JOOX to lossless on
  cellular. See Pattern 1.
- **Doing the D-05 https upgrade in `proxy/qq.ts`** — under D-12 the hot path *bypasses the proxy*, so a
  proxy-side upgrade never fires where it matters. Client-side, in `pickBestPlayUrl`'s return.
- **Adding a request header (or `credentials: 'include'`) to the direct call** — triggers a preflight
  that tang's `Allow-Headers: Content-Type` will fail, and a preflight measured 1.016s: it gives back
  most of the ~1s D-12 exists to save. See Q4.
- **Routing media bytes through `apiFetch`** — `prebufferNext`'s comment names this explicitly, and the
  `api-fetch-flood-freeze` record confirms media/blob use raw `fetch`. The D-15 guard is inside the
  existing raw fetch; do not "unify" it.
- **A second per-host circuit breaker for tang** — composing local bounds *is* the named root cause. See
  Decisions At Risk #4.
- **Deleting `bustResolveEntry` / the POST handler** because "a mid is permanent" — leaves a
  `matchKey`-collision wrong mid unrepairable forever, and D-11 has no other repair mechanism.
- **Forgetting `RESOLVE_CACHE_VERSION` `'1'` → `'2'`** — old-shape entries with a `url` and no usable
  `songid` semantics would be read as new-shape. `cache.delete` is PoP-local, so there is no way to fix
  this after the fact except waiting out the old TTL.
- **Adding a `@capacitor/network` dependency** — WebView Android 50+ already exposes
  `NetworkInformation.type`.
- **Reading `effectiveType` as a metering signal** — it is a speed estimate; fast cellular is `'4g'`.

---

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---|---|---|---|
| Cellular vs wifi detection | A speed probe / RTT heuristic / download-timing test | `navigator.connection.type` whitelist | The platform already knows. A probe costs a request, is wrong on a fast train, and reinvents `downlink`/`rtt` (which Chrome deliberately clamps for anti-fingerprinting) |
| Byte size before download | A `HEAD` request, or a Range-probe-and-parse-`Content-Range` | `Content-Length` off the GET head (exposed — Q1), or `song_size_*_str` from the detail body | The GET you are already making carries it. The CDN does not even advertise `HEAD` in `Allow-Methods` |
| Native network state in the APK | `@capacitor/network` | The same `navigator.connection` | WebView Android 50+ supports it; a plugin adds a dep, a `cap sync`, and a web/native split for zero coverage |
| Building the tang URL | A second `const TANG_BASE` in `sources/qq.ts` | `qqProxy.buildUrl(...)` | `proxy/qq.ts:8` states the one-place invariant; a second copy is how the two drift |
| Absolute-vs-relative URL handling | Per-call-site branching | One regex guard in `apiUrl` | One guard covers every future absolute caller; per-call-site is N chances to forget |
| Cross-source name normalization | A local lowercase/strip | `services/match-key.ts` `matchKey` | `resolve-edge.ts:75` records why: the edge must fold *identically* to dedupe, the cover cache and the lyric fallback |
| Concurrency/dedupe/timeout on the direct call | A bespoke limiter for the new host | `apiFetch` (D-13) | It is URL-agnostic. A second limiter is the `api-fetch-flood-freeze` root cause verbatim |
| Cancelling an over-ceiling download | An `AbortController` per prebuffer just for the size check | `resp.body?.cancel()` | The controller already exists (`prebufferController`); `body.cancel()` releases the stream without unwinding the abort machinery |

**Key insight:** every capability this phase needs is already present — in the platform, in the existing
detail body, or in a module written for a neighbouring purpose. The measured wins (drop a hop, drop a
call, drop a rung) all come from **removing** code paths. If a task's diff is net-positive by more than
~30 lines outside the tests, it is probably building something that already exists.

---

## Common Pitfalls

### Pitfall 1: The `accom` rung is 伴奏 — the instrumental — and it is `.ogg`, above `hq`

**What goes wrong:** A user gets the karaoke/backing track instead of the song, or on iOS gets silence
followed by a cross-source fallback.

**Why it happens:** `qq.ts` `pickBestPlayUrl` orders `sq > pq > **accom** > hq > standard > fq`. When
`sq` and `pq` are both absent — the exact case the lossless-first ladder is designed to fall through —
`song_play_url_accom` wins. Measured: [VERIFIED: live probe]

```
song_filename_accom: "O8010049m3up3X6Q8s.ogg"   kbps_accom: 689
```

`accom` is the standard QQ abbreviation for **伴奏** (accompaniment). `qq.ts` labels it
`tag:'hq', label:'HQ'`, i.e. it is presented to the user as a quality tier rather than a different mix.
The rung is inherited **verbatim** from the upstream monolith:

```
upstream/main:index.html:2373
  if (d.song_play_url_accom) return { url: d.song_play_url_accom, tag: 'hq', label: 'HQ', text: `ACCOM ${d.kbps_accom || ''}`.trim() };
```

— a copy-forward, not a considered choice. Two compounding problems: (a) it may be the wrong *audio*;
(b) `.ogg` (Vorbis) **does not decode in iOS Safari's `<audio>`**, so on the platform CLAUDE.md names
first it is a guaranteed load failure that burns a never-stop fallback cycle.

**How to avoid:** Demote `accom` **below** `fq`, or drop the rung entirely. One line either way. Do not
"fix" it by adding a Safari sniff — the rung is questionable on every platform.

**Warning signs:** A track playing an instrumental with no vocals; a `LOSSLESS`/`HQ` badge on an `.ogg`
URL; iOS-only playback failures on tracks where `kbps_sq` is `0`.

**Confidence: MEDIUM-HIGH** on "accom is the instrumental" (naming convention + a distinct filename
prefix `O801…` vs the song's `C600…`/`F000…`, and a distinct container). Recommend one
`checkpoint:human-verify` — play a `song_play_url_accom` and listen. **HIGH** on the `.ogg`/iOS half,
which stands on its own.

### Pitfall 2: `'320'` does not mean 320 kbps, and `inferQualityFromUrl` then lies about it

**What goes wrong:** D-02 routes cellular to `'320'`, which is documented and displayed as 320k but is
measured at **193 kbps**. Exactly the class of stale decision record D-04 exists to correct — and
correcting only the `'128'` half leaves the other half wrong in the same file.

**Why it happens:** Two independent inaccuracies compound.

Measured tiers, three real tracks: [VERIFIED: live probe]

| Tier | 晴天 | 七里香 | Container | Size | What the code claims |
|---|---|---|---|---|---|
| `sq` | **1647** | **959** | `.flac` | 52.8 / 34.2 MB | `LOSSLESS` ✓ |
| `pq` | 926 | 934 | `.flac` | 29.7 MB | `LOSSLESS` ✓ |
| `accom` | 689 | 689 | **`.ogg`** | 22.1 MB | `HQ` ✗ — Pitfall 1 |
| `hq` (= `song_play_url`) | **193** | **193** | `.m4a` | 6.2 / 6.9 MB | `joox.ts:143` / `qq.ts:106` say **"~320k"** ✗ |
| `standard` | **97** | **97** | `.m4a` | 3.1 MB | `defaults.ts:82` says **"128–160k"** ✗ (this is D-04) |
| `fq` | 48 | 48 | `.m4a` | 1.6 MB | `LOW` ✓ |

Then `inferQualityFromUrl` (`services/lrc.ts:270-281`) **overwrites** whatever `pickBestPlayUrl`
decided, purely on file extension:

```ts
const losslessExts = ['flac','wav','ape','alac','aiff'];
if (losslessExts.includes(ext)) return { tag: 'lossless', label: 'LOSSLESS' };
// 其他一律当作 320K 显示 — everything else displays as 320K.
return { tag: '320k', label: '320K' };
```

`qq.ts:265-271` applies this **after** the tier pick, so **every non-FLAC QQ tier is labelled `320K`** —
the 97 kbps standard tier and the 48 kbps fq tier included. That is what users see today under the
`'128'` default.

**How to avoid:** Extend D-04's comment fix to cover the `'320'`→`hq` rung in both `qq.ts:106` and
`joox.ts:143`. Say `~193k m4a (AAC)`, not `~320k`. And do **not** let `inferQualityFromUrl` clobber a
tier the ladder positively identified — `qq.ts` should only fall back to it when `best.tag` is null.
`ponytail: leaving inferQualityFromUrl itself alone; it is a shared display helper and other sources depend on its guess. Gate the CALL, not the function.`

**Warning signs:** A `320K` badge on a `.m4a`; `qqQualityText` reading `HQ 193` next to a `320K` label.

### Pitfall 3: The QQ CDN returns `content-type: application/x-www-form-urlencoded` for audio

**What goes wrong:** A `Blob` created from `resp.blob()` inherits that MIME, so
`URL.createObjectURL(blob)` yields a `blob:` URL that declares itself to be form data. A strict media
pipeline can refuse it.

**Why it happens:** Tencent's `Lego Server` sets one content type for all objects. Verified on **both**
the FLAC and the m4a: [VERIFIED: live probe]

```
F000003Qui1q2u1Zho.flac → content-type: application/x-www-form-urlencoded
C400003Qui1q2u1Zho.m4a  → content-type: application/x-www-form-urlencoded
```

**Why this is LOW risk, and worth stating so nobody over-builds:** this is **already the shipping
condition**. `prebufferNext` fetches QQ m4a bytes from this same CDN today with this same wrong MIME, and
the `bg-lockscreen-stall-noskip` fix it implements was verified working on device. Browsers sniff the
container for `<audio src=blob:>`. So the pattern is proven — for m4a.

**The residual unknown is FLAC specifically on iOS Safari.** Safari has decoded `.flac` since Safari 11 /
iOS 11 `[ASSUMED — training knowledge, not verified this session]`, but Safari is historically the
strictest about MIME for media, and this exact combination (FLAC + wrong MIME + `blob:` URL) has not been
exercised in this codebase. Note that under the recommended 24 MB ceiling **FLAC never reaches the blob
path anyway** (every `sq`/`pq` is 30–53 MB), so on the default configuration this is unreachable. It
becomes reachable only for a manually-selected `'lossless'` on a short track.

**How to avoid (one line, if it ever bites):** re-type the Blob with a zero-copy slice before creating
the object URL —

```ts
// Tencent's CDN sends content-type: application/x-www-form-urlencoded for every object, audio
// included. Re-type from the URL extension so a strict media pipeline (Safari) is not handed a
// blob: URL claiming to be form data. Zero-copy — slice() only rewrites the type.
const typed = /\.flac(?:\?|$)/i.test(url) ? blob.slice(0, blob.size, 'audio/flac') : blob;
```

**How to avoid (better): don't add it yet.** `ponytail: skipped the MIME re-type — the m4a path already ships with this MIME and works, and the 24MB ceiling keeps FLAC off the blob path entirely. Add it if a manually-selected lossless short track fails to play from the prebuffer on iOS.`

**Warning signs:** iOS-only failure to play the *next* track after an advance, while the same track plays
fine when tapped directly (blob path vs CDN path).

### Pitfall 4: A false negative in a permanent cache is permanent

Covered in full as **Decisions At Risk #1**. Warning sign: a song that plays lossless for one user and
lossy for everyone else in the same region, indefinitely.

### Pitfall 5: A `200` from tang does not mean parseable JSON, and does not mean a real song

Three distinct 200-responses (Q5): a real body; an all-`null` body for an unknown mid; and the plain-text
`参数错误` for an empty mid. The existing `!d.song_mid` guard handles the second and `res.json()`'s
rejection handles the third — **do not "simplify" either away** while removing `msg`. In particular, do
not replace the `song_mid` check with an `res.ok` check.

**Warning sign:** a play that silently attaches `audioUrl: null` instead of throwing (that would mean the
`song_mid` guard was weakened).

### Pitfall 6: The `/api/resolve` lookup runs on plays that cannot benefit from it

Covered in **Decisions At Risk #2**. `catalog.ts:323-326` reads the cache on every play except a
lyric re-resolve, at up to 400ms. Post-D-08 the common row already carries a mid, and the entry stores a
mid, so the lookup can only ever return what the caller already has.

**Warning sign:** the click-to-play measurement showing a flat ~400ms floor that does not move when the
tang call gets faster.

---

## Code Examples

Every snippet below is either copied from this repo or derived from a live probe in this session.

### Reading the size ceiling in `prebufferNext` (D-15)

```ts
// Source: derived from src/lib/stores/player.svelte.ts:2596-2607 (existing shape preserved)

/** 32-D-15 ceiling. Admits every LOSSY tier unconditionally (qq hq ≈6-7MB, standard ≈3MB) so the
 *  bg-lockscreen-stall-noskip protection is fully intact on the cellular/'320' path — and rejects
 *  every FLAC (measured sq 34-53MB, pq ≈30MB) so a low-end phone never holds one per advance.
 *  Measured worst case is ~12MB/min at kbps_sq=1647, NOT the 7MB/min the phase note estimated. */
const PREBUFFER_MAX_BYTES = 24 * 1024 * 1024;

try {
	const resp = await fetch(url, { signal: sig, referrerPolicy: 'no-referrer' });
	if (sig.aborted) return;
	if (!resp.ok) return; // dead URL — uid stays claimed (existing flood-fix discipline)

	// 32-D-15: decide from the response HEAD, before a single body byte is read. Content-Length IS
	// readable cross-origin here: the QQ CDN sends `access-control-expose-headers:
	// Content-Length,Content-Range` on both 200 and 206 (verified live 2026-08-31) — without that
	// header this would be null, since Content-Length is not CORS-safelisted. A missing/unparseable
	// value falls THROUGH to the blob (unknown size behaves as it does today, no regression).
	const len = Number(resp.headers.get('content-length'));
	if (Number.isFinite(len) && len > PREBUFFER_MAX_BYTES) {
		// Release the stream without downloading it. The uid stays CLAIMED so this is not retried on
		// churn, and play() falls back to the CDN URL — i.e. it STREAMS, which is exactly D-15's
		// "skip the blob (stream instead) above a ceiling".
		try { await resp.body?.cancel(); } catch { /* best-effort */ }
		return;
	}

	const blob = await resp.blob();
	if (sig.aborted) return;
	if (this.prebufferedBlobUrl) URL.revokeObjectURL(this.prebufferedBlobUrl);
	this.prebufferedBlobUrl = URL.createObjectURL(blob);
} catch {
	/* abort / CORS / network — uid stays claimed (no re-fetch); play() falls back to the CDN URL */
}
```

Note the `return` leaves `prebufferedUid` claimed, which is deliberate and matches the existing
f7c2580 flood-fix contract documented at `player.svelte.ts:2576-2582`. Extract the size test into an
exported pure predicate (`overPrebufferCeiling(headerValue: string | null): boolean`) so it is testable —
`prebufferNext` itself is private.

### The `'auto'` resolution (D-02/D-03)

See Q2 for the full annotated `effectiveQuality()`. Call sites:

```ts
// src/lib/sources/qq.ts:102
const pref = effectiveQuality(quality ?? settings.defaultQuality);

// src/lib/sources/kuwo.ts:104
const level = effectiveQuality(quality ?? settings.defaultQuality) === '128' ? '128k' : 'zp';

// src/lib/sources/joox.ts:155
const order = pickByQualityPref(JOOX_QUALITY_ORDER, effectiveQuality(quality ?? settings.defaultQuality));
```

### The https upgrade (D-05), inside `pickBestPlayUrl`

```ts
// Source: src/lib/sources/qq.ts:98-138 (add ONE helper + route every return through it)

/** 32-D-05: the tang detail returns `http://isure6.stream.qqmusic.qq.com/...`, which is
 *  mixed-content-BLOCKED on our https origin. The same host serves https correctly (verified live:
 *  200 + 206, accept-ranges: bytes, first bytes in 0.31s). Client-side and NOT in proxy/qq.ts,
 *  because 32-D-12 sends the hot detail call DIRECT — a proxy-side upgrade would never fire on the
 *  path that matters. Idempotent: an already-https url passes through unchanged. */
function https(url: string | null): string | null {
	return url ? url.replace(/^http:\/\//i, 'https://') : url;
}
```

Route it through the single `return` boundary rather than at all seven rung returns — one call site, not
seven chances to miss one.

### The bad-mid failure shape (Q5) — the guard that must survive D-09

```jsonc
// Live: GET tang…?type=json&mid=NOTAREALMIDXX  →  HTTP 200 (not an error status!)
{
  "song_name": null, "song_title": null, "song_id": null, "song_mid": null,
  "vip": "免费",                      // ← NOT a liveness discriminator; the real body says "付费"
  "song_play_time": null, "duration": "00:00:00",
  "kbps": 0, "kbps_sq": 0, "kbps_hq": 0, "kbps_standard": 0, "kbps_fq": 0,
  "song_play_url": null, "song_play_url_sq": null, "song_play_url_hq": null
}
```

```ts
// Source: src/lib/sources/qq.ts:225-227 — ALREADY correct, keep verbatim through the D-09 edit.
// `song_mid` is the ONLY reliable discriminator: the upstream answers 200 with an all-null body for
// an unknown mid, and `vip` is populated even then.
if (!d || typeof d !== 'object' || !d.song_mid) {
	throw new Error('qq detail error (invalid response)');
}
```

### The permanence split (D-10, Pattern 4)

```ts
// Source: derived from src/lib/proxy/resolve-cache.ts:102-122

export const RESOLVE_CACHE_VERSION = '2';           // 32-D-10: SHAPE CHANGE = KEY CHANGE. Mandatory.
export const RESOLVE_TTL_S = 900;                   // negatives only, now
export const RESOLVE_MID_TTL_S = 31_536_000;        // 1y — song_mid never expires (32-D-10)

export interface ResolveEntry {
	source: string | null;
	songid: string | null;   // 32-D-10: now a PERMANENT qq song_mid, not a kuwo rid
	avail: Record<string, 'ok' | 'dry'>;
	// `url` REMOVED — it was the only reason this entry had to expire.
}

// ...inside writeResolveEntry, replacing the single max-age:
const maxAge = entry.songid ? RESOLVE_MID_TTL_S : RESOLVE_TTL_S;
headers: {
	'content-type': 'application/json',
	// `immutable` follows /api/og's proven pattern (og/+server.ts:68) for a positive entry.
	'Cache-Control': entry.songid
		? `public, max-age=${maxAge}, immutable`
		: `public, max-age=${maxAge}`
}
```

Keep the fresh-`Response` + two-header allow-list construction exactly as it is — the existing comment
records that a passed-through response carries `Vary: Origin` (fragmenting the entry per requester
origin) and that `Vary: *` makes `cache.put` throw outright.

---

## Runtime State Inventory

Not a rename/refactor phase — but D-10 changes a **stored cache entry shape**, which has the same
"the repo is updated but the runtime still holds the old value" hazard. Recording the equivalent
inventory:

| Category | Items Found | Action Required |
|---|---|---|
| Stored data (edge) | `caches.default` entries at `/api/resolve/_k?v=1&k=<matchKey>` holding the old `{source,songid,url,avail}` shape, in every PoP that has served a play since Phase 31 | **Bump `RESOLVE_CACHE_VERSION` `'1'` → `'2'`.** `cache.delete` is PoP-local so there is no global purge; the version bump makes every PoP miss onto the new namespace and lets `v=1` expire on its own 900s TTL. This is the documented mechanism (`resolve-cache.ts:15-19`) |
| Stored data (client) | `localStorage` `openmusic:player:v1` may hold a persisted `current`/`queue` whose tracks carry a stale `audioUrl` and `qqSearchKey`. `openmusic:library:v1` holds downloaded-blob records | **None.** `qqSearchKey` becoming unread is harmless (the field just stops being consulted); a stale `audioUrl` already routes through the existing error → re-resolve → fallback chain. Do **not** bump either key — that would drop users' libraries for no gain |
| Live service config | **None.** No n8n workflow, Datadog service, Tailscale ACL or Cloudflare Tunnel references anything in this phase. `wrangler.jsonc` `vars` (`JAMENDO_CLIENT_ID`) and the Pages secrets (`JOOX_TOKEN`, `LASTFM_*`) are untouched | None |
| OS-registered state | **None.** No Task Scheduler / launchd / pm2 / systemd registration involved. The Android CI workflows (`android-main.yml`, `android-release.yml`) need no change | None |
| Secrets / env vars | `VITE_API_BASE` is **read** by the new `apiUrl` guard but its value and name are unchanged. No new secret; the direct tang call needs none (that is *why* it can go direct) | None |
| Build artifacts | The native APK bakes `VITE_API_BASE=https://openmusic.lol` at build time. An APK built **before** the D-13 `apiUrl` guard would `TypeError` on the direct call | **`pnpm apk` must be rebuilt** after the guard lands. Verify the direct path on-device, not just on web |
| In-memory (per session) | `api-base.ts` module state: `inflight`, `failureTimes`, `circuitOpenUntil`. `resolve-cache-client.ts`: `servedUrls`, `reported`. `player`: `prebufferedUid`/`prebufferedBlobUrl` | **None in production** (page reload clears them). **In tests: `__resetGovernor()` and `__resetResolveCacheClient()` must be called** or a tripped breaker leaks across cases — both exist for exactly this |

---

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|---|---|---|---|
| `navigator.connection.type` as the general connection API | `type` survives on Android/WebView/ChromeOS; `effectiveType` is the cross-Chromium one; **neither** on Safari or Firefox | Firefox removed `type` in 32 (desktop) / 99 (Android); Chrome moved to `effectiveType` in 61 | There is no portable metering signal. A whitelist that fails closed is the only correct shape — which is why D-03 is a decision rather than a bug |
| `downlink` / `rtt` as real numbers | Clamped by Chrome as anti-fingerprinting (`downlink` ≤ 10 Mbps, `rtt` ≤ 3000 ms) | ongoing | Do not build a bandwidth heuristic on them |
| `Content-Length` assumed readable cross-origin | Requires explicit `Access-Control-Expose-Headers` (it is not CORS-safelisted) | Fetch spec, long-standing | Must be *verified per host*. Verified present here — but a second lossless provider (Q1 spike) may not expose it, and the D-15 guard must keep falling through on a null |
| `caches.default` entries as durable storage | No documented max TTL, **no persistence guarantee**, PoP-local, LRU-evicted | Cloudflare, current docs | "Permanent" = no expiry, not guaranteed present. Safe only because D-11 makes the cache advisory |

**Deprecated / outdated in this codebase:**
- `qqSearchKey` / `keyword` threading into the QQ **detail** URL — dead weight (D-09). Note
  `Track.qqSearchKey` is still *written* at search time (`qq.ts:196`); D-09 only removes the *read* in
  `resolve()`. Removing the field itself is a wider `Track`-shape change and is not required.
- `defaults.ts:82` `// D-03 — 128–160k band` — wrong (97 kbps measured). D-04.
- `qq.ts:106` / `joox.ts:143` `'320' → ~320k` — wrong (193 kbps measured). Pitfall 2.
- `qq.ts` `accom` rung above `hq` — inherited verbatim from `upstream/main:index.html:2373`; `.ogg`,
  probably the instrumental. Pitfall 1.
- `ResolveEntry.url` and the kuwo-only `resolveOnEdge` — superseded by D-10 / D-01.
- `mozConnection` / `webkitConnection` prefixes — both dead; do not add them.

---

## Supersession Map — `Skill("spike-findings-openmusic")`

Read and diffed so the supersession is deliberate, per CONTEXT's `canonical_refs` instruction.

| Skill finding | Phase 32 | Verdict |
|---|---|---|
| `source-resolution.md`: *"Resolve every play through `kuwo` first — one call returns audio + cover"* | **D-01** makes qq primary | **SUPERSEDED.** The reason is explicit and new: kuwo tops out at 320k mp3, so kuwo-first and lossless are mutually exclusive (measurement note, Finding 5). Reliability was the old axis; quality is the new one |
| *"Fallback chain: `kuwo → qq → netease → joox → …`. Reorder the registry default away from netease-first"* | **D-01** keeps the ladder as the FAILURE path; **D-08** moves qq to the head of `SOURCE_RANK` | **PARTIALLY SUPERSEDED.** The head becomes qq; the tail order survives untouched. The skill's "away from netease-first" instruction is *reinforced*, not contradicted |
| *"`qq` search is flaky (returns 0 rows intermittently under load, no throw) — fine as fallback #2, not primary"* | D-01/D-08/D-10 | **CONTRADICTS — resolved in D-01's favour, with a required mitigation.** Full analysis in Decisions At Risk #3; the mitigation it forces is Decisions At Risk #1 (negatives keep a TTL). **This is the single most valuable line in the skill for this phase** |
| *"Never fan out all 7 sources on click. Fan-out is a search-page concern"* | unchanged | **STANDS.** Nothing here adds a click-time fan-out; D-12 makes the click *one* call |
| *"Use the source-embedded cover on the hot path; upgrade to Deezer HQ lazily"* | unchanged | **STANDS and STRENGTHENS.** qq's `album_pic` arrives in the same detail body (Q5), so D-08 (qq wins dedupe) means *more* plays get an inline cover |
| *"`qq` is the ONLY source that returns duration (`song_play_time`); kuwo-primary plays have unknown duration"* | D-01/D-08 | **STANDS, and becomes a BONUS.** qq-primary means `duration` is now populated on the common path — a silent improvement the phase should claim, and a cheap verification signal |
| *"Do NOT rely on `joox` for covers (0/38)"* | unchanged | **STANDS** |
| *"Do NOT put `jamendo`/`audius` on the hot path"* | unchanged | **STANDS.** `SOURCE_RANK` keeps them at `-1` |
| `click-to-play-cost.md`: *"Target: a single-song play costs ~3 API calls, not ~59"* | Phase 31 D-05 (*"the ~3-call floor is a waste target, not a hard cap"*) | **REFRAMED by Phase 31, not by 32.** D-12 *reduces* the count further (one direct call replaces a proxied one; D-10 collapses 2 tang calls to 1) |
| `click-to-play-cost.md`: *"Watch the player's generation guards when reworking resolve/up-next"* | Pattern 3 | **STANDS.** D-07's no-write-back shape is how this phase discharges it |

---

## Project Constraints (from CLAUDE.md)

Directives that constrain this phase's plan. Treat with the same authority as a locked decision.

| Constraint | Applies here as |
|---|---|
| **GSD Workflow Enforcement** — "Before using Edit, Write… start work through a GSD command" | Implementation must run via `/gsd:execute-phase`, not ad-hoc edits |
| **Svelte 5 runes forced project-wide**; `$state`/`$derived`/`$effect`/`$props` only | Nothing new here needs runes. `effectiveQuality` stays a pure `.ts` |
| **Runes files MUST be `*.svelte.ts`**; pure logic stays `.ts` | `sources/quality.ts` stays `.ts` → node-testable under the single Vitest server project |
| **Internal non-reactive counters use PLAIN class fields, not `$state`** | `prebufferedUid`, `prebufferController` are already plain. The D-15 ceiling adds no field |
| **Indentation is tabs**; single quotes, **except `src/lib/i18n/*.ts` which is double quotes** | No i18n change is recommended (the downgrade is deliberately not surfaced). If one is added: **double quotes**, and **all 16 locales** — `i18n.test.ts` guards key-set parity |
| **`browser` guards** on anything touching `navigator`/`window`/`localStorage` | `effectiveQuality` reads `navigator.connection` → **mandatory** `browser` early-return |
| **Never-throw services** — map any rejection to a null/empty sentinel at the exported boundary | The direct fetch must preserve this. `qq.ts` `resolve()` legitimately re-throws (catalog/allSettled records it); `resolve-cache-client` maps to null. Keep both as they are |
| **Generation guards** — re-read the counter after every await | Pattern 3: D-06's background resolve is fire-and-forget with no write-back, so no new counter |
| **Single `audio.src` authority** — `driveSrc()` is the ONE place src is set | D-07 adds no second attach path. Do not add one |
| **Zero `as any` in production source**; prefer `satisfies` / `as const`; only 6 `@ts-expect-error` | `navigator.connection` needs a **local narrowing interface**, following `proxy/edge-cache.ts`'s precedent — never a cast |
| **High comment density; tag with a quick-task ID or decision ref (`D-09`, `PLAY-08`, `WR-03`)** | Every change above needs a `32-D-NN` tag. Do **not** remove existing decision-ref comments |
| **Always use path aliases** (`$lib/…`), `import type` for type-only | `import type { DefaultQuality }` in `quality.ts` |
| **`svelte-check` is the only quality gate** besides Vitest (no prettier/eslint/biome) | `pnpm check` must be green. It is also the cheapest way to find every `ResolveEntry.url` call site |
| **Secrets only in Cloudflare `platform.env`, never in the client bundle** | The direct tang call carries **no** secret — that is precisely why D-12 is possible. JOOX keeps its proxy |
| **CORS: all `/api/*` get allowlisted CORS via `hooks.server.ts` — never `*`** | Unchanged. The `ACAO: *` in this research is the **upstream's** header on *their* response, not ours |
| **Mobile browsers first (iOS Safari + Android Chrome)** | The constraint **D-03 knowingly trades against**. Pitfalls 1 and 3 are both iOS-specific and are where this constraint still bites |
| **`pnpm run deploy`, not `pnpm deploy`** (a pnpm builtin shadows it) | If any task deploys |

---

## Validation Architecture

### Test Framework
| Property | Value |
|---|---|
| Framework | Vitest `^4.1.3` (single `node` project, no jsdom) |
| Config file | `vite.config.ts` → `test.projects[0]`, `include: ['src/**/*.{test,spec}.{js,ts}']`, `expect: { requireAssertions: true }` |
| Quick run command | `pnpm vitest --run src/lib/sources/qq.test.ts src/lib/sources/quality.test.ts src/lib/services/api-base.test.ts` |
| Full suite command | `pnpm test && pnpm check` |

`requireAssertions: true` means **every** new `it()` must contain at least one `expect`. Second gate is
`pnpm check` (`svelte-kit sync && svelte-check`) — treat a type error as a test failure.

### Phase Requirements → Test Map

| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|---|---|---|---|---|
| D-01 | qq resolve succeeds on a `mid`-only detail body | unit | `pnpm vitest --run src/lib/sources/qq.test.ts` | ✅ (extend) |
| D-01 | a qq resolve FAILURE still falls through to the cross-source ladder | unit | `pnpm vitest --run src/lib/services/fallback.test.ts` | ✅ verify coverage |
| D-02 | `'auto'` + `type:'wifi'` → `'lossless'` | unit | `pnpm vitest --run src/lib/sources/quality.test.ts -t "wifi"` | ❌ Wave 0 |
| D-02 | `'auto'` + `type:'cellular'` → `'320'` | unit | `… -t "cellular"` | ❌ Wave 0 |
| D-02 | `'auto'` + `saveData:true` on wifi → `'320'` | unit | `… -t "saveData"` | ❌ Wave 0 |
| D-02 | a non-`'auto'` pref passes through untouched (all 3 values) | unit | `… -t "passes through"` | ❌ Wave 0 |
| D-02 | **kuwo and joox** receive a RESOLVED tier, never `'auto'` | unit | `pnpm vitest --run src/lib/sources/kuwo.test.ts src/lib/sources/joox.test.ts` | ❌ Wave 0 — **the regression Pattern 1 exists to prevent** |
| D-03 | `navigator.connection === undefined` → `'320'` | unit | `… -t "no signal"` | ❌ Wave 0 |
| D-03 | `type:'unknown'` / `'other'` / `'none'` → `'320'` (whitelist, fails closed) | unit | `… -t "whitelist"` | ❌ Wave 0 |
| D-04 | `'128'` still selects `song_play_url_standard` | unit | `pnpm vitest --run src/lib/sources/qq.test.ts -t "128"` | ✅ green (comment fix only) |
| D-05 | an `http://` tier URL is returned as `https://` | unit | `pnpm vitest --run src/lib/sources/qq.test.ts -t "https"` | ❌ Wave 0 — **requires the fixture change**, see below |
| D-05 | an already-`https://` URL is unchanged (idempotent) | unit | `… -t "idempotent"` | ❌ Wave 0 |
| D-06 | a mid-less stub plays without waiting on the mid lookup | unit | `pnpm vitest --run src/lib/services/catalog.test.ts` | ✅ verify + extend |
| D-07 | the background mid resolve performs **no** `audio.src` write | unit | `pnpm vitest --run src/lib/stores/player.svelte.test.ts -t "no src"` | ❌ Wave 0 |
| D-08 | qq beats netease in `dedupeBest` on an equal-quality tie | unit | `pnpm vitest --run src/lib/services/dedupe.test.ts -t "tie"` | ❌ Wave 0 (no rank test exists) |
| D-08 | the surviving deduped row carries `song_mid` | unit | `… -t "song_mid"` | ❌ Wave 0 |
| D-09 | the detail URL contains **no** `msg` param | unit | `pnpm vitest --run src/lib/sources/qq.test.ts -t "msg"` | ❌ Wave 0 |
| D-09 | resolve still populates duration + lrc + cover + album with `mid` alone | unit | existing `:177`, `:155`, `:167` cases | ✅ green |
| D-10 | a POSITIVE entry writes `max-age=31536000, immutable` | unit | `pnpm vitest --run src/lib/proxy/resolve-cache.test.ts -t "permanent"` | ⚠️ rewrite |
| D-10 | a NEGATIVE/`DRY` entry writes the SHORT `max-age` (Decisions At Risk #1) | unit | `… -t "negative"` | ❌ Wave 0 — **highest-value new test in the phase** |
| D-10 | `RESOLVE_CACHE_VERSION === '2'` and appears in the key | unit | `… -t "version"` | ⚠️ rewrite |
| D-10 | the edge fill makes **ONE** subrequest (qq search) and returns a `song_mid` | unit | `pnpm vitest --run src/lib/proxy/resolve-edge.test.ts` | ⚠️ rewrite (kuwo → qq) |
| D-11 | a miss / 500 / malformed JSON / abort / open breaker each → `null`, caller unaffected | unit | `pnpm vitest --run src/lib/services/resolve-cache-client.test.ts` | ✅ green (verify shape) |
| D-12 | the detail call targets `tang.api.s01s.cn` absolutely | unit | `pnpm vitest --run src/lib/sources/qq.test.ts -t "direct"` | ⚠️ **rewrites `:148-150`** |
| D-12 | the retained proxy fallback still targets `/api/qq/detail` | unit | `… -t "proxy fallback"` | ❌ Wave 0 |
| D-13 | `apiUrl` returns an absolute URL unchanged with `VITE_API_BASE` **set** | unit | `pnpm vitest --run src/lib/services/api-base.test.ts -t "absolute"` | ❌ Wave 0 — **the native-build break** |
| D-13 | `apiUrl` still prefixes a relative path with the base | unit | existing `:36` | ✅ green |
| D-13 | the direct call sets **no** request headers and no `credentials` (stays a simple request) | unit | `pnpm vitest --run src/lib/sources/qq.test.ts -t "simple request"` | ❌ Wave 0 |
| D-15 | `content-length` over the ceiling → no blob, `body.cancel()` called | unit | `pnpm vitest --run src/lib/stores/player.svelte.test.ts -t "ceiling"` | ❌ Wave 0 (via an exported predicate) |
| D-15 | `content-length` under the ceiling → blob created | unit | `… -t "under ceiling"` | ❌ Wave 0 |
| D-15 | a **missing/unparseable** `content-length` falls through to the blob (no regression) | unit | `… -t "unknown length"` | ❌ Wave 0 |
| D-16 | — | none | *no test; the requirement is "do not edit". Enforce by review: the diff must not touch `player.svelte.ts:2892-3033`* | n/a |
| D-17 | prewarm still touches next-1 only | unit | `pnpm vitest --run src/lib/stores/player.svelte.test.ts -t "next-1"` | ✅ verify exists |
| Pitfall 1 | `accom` never wins over `hq` | unit | `pnpm vitest --run src/lib/sources/qq.test.ts -t "accom"` | ❌ Wave 0 |
| Pitfall 2 | a positively-identified tier tag is not clobbered by `inferQualityFromUrl` | unit | `… -t "tag not clobbered"` | ❌ Wave 0 |

### Manual-only verification (justified)

These cannot be automated under a node-only Vitest project with no jsdom and no device:

| Behavior | Why manual | Gate |
|---|---|---|
| Real wifi → lossless / real cellular → 320 on an Android device | `navigator.connection.type` cannot be faked outside a real network stack; the node project has no `navigator` | `checkpoint:human-verify` — toggle wifi off, play, check the badge + Settings → Activity log |
| FLAC actually plays on iOS Safari from a manually-selected `'lossless'` | No jsdom, no iOS runner. Pitfall 3's residual risk | `checkpoint:human-verify` on device |
| The `accom` tier is the instrumental mix (Pitfall 1) | Requires listening | `checkpoint:human-verify` — play a `song_play_url_accom` |
| The APK's direct call works with `VITE_API_BASE` baked in (D-13) | The unit test proves `apiUrl`; only a real build proves the whole path | `pnpm apk` + on-device play. See Runtime State Inventory |
| Real end-to-end click→play latency, per path | Wall-clock, network-dependent | Measure D-08 (mid in hand) and D-06 (cross-source stub) **separately** — Decisions At Risk #2 |
| No freeze regression (the three named classes) | Requires a live session | Re-run `31-VALIDATION.md`'s freeze checks: `audio.error` re-resolve storm, `/api/*` fetch flood, restore-effect self-invalidation |

### Sampling Rate
- **Per task commit:** `pnpm vitest --run <the touched test files>` — under 30s.
- **Per wave merge:** `pnpm test && pnpm check` (full suite + typecheck).
- **Phase gate:** full suite green **plus** every `checkpoint:human-verify` above discharged, before
  `/gsd:verify-work`.

### Wave 0 Gaps

- [ ] **`src/lib/sources/quality.test.ts`** — NEW file. Covers D-02, D-03. Stub `navigator.connection`
      via `vi.stubGlobal('navigator', { connection: { type: 'wifi' } })` and assert `effectiveQuality`
      across: `wifi`, `ethernet`, `cellular`, `unknown`, `none`, `undefined` connection, `saveData:true`,
      and each non-`'auto'` pref passing through.
- [ ] **`src/lib/sources/__fixtures__/qq.detail.json`** — change every `song_play_url_*` from
      `https://dl.stream.qqmusic.qq.com/…` to the **real** `http://isure6.stream.qqmusic.qq.com/…` shape,
      and add the real `song_size_*_str` keys. Without this **D-05 ships untested** (the existing
      assertions pass because the fixture is already https, so an idempotent upgrade is a no-op) and D-15
      has no fixture data. Consider adding a second fixture captured from the live probe in this
      research — `kbps_sq: 1647`, `kbps_hq: 193`, `kbps_standard: 97` — so the ladder is tested against
      real numbers rather than the current placeholders.
- [ ] **Exported pure predicate for the D-15 ceiling** — e.g. `overPrebufferCeiling(header: string |
      null): boolean` exported from `player.svelte.ts` (or a small `services/prebuffer-ceiling.ts` if the
      god-object rule bites). `prebufferNext` is private and does a real `fetch`; a pure predicate is the
      testable seam. Matches the house "pure functions are extracted and exported for testability"
      convention.
- [ ] **`src/lib/proxy/resolve-edge.test.ts`** — rewrite kuwo→qq; assert **ONE** subrequest and a
      `song_mid` payload.
- [ ] **`src/lib/proxy/resolve-cache.test.ts`** — rewrite for the `url`-less entry, `VERSION '2'`, and
      the positive-vs-negative `max-age` split.
- [ ] **`src/routes/api/resolve/resolve-endpoint.test.ts`** — update for the new entry shape; keep the
      `no-store` assertion and the DELETE-only POST assertions **unchanged**.
- [ ] **`src/lib/services/api-base.test.ts`** — add the absolute-URL case with `VITE_API_BASE` **set**
      (`vi.stubEnv`, which the existing tests already use).
- [ ] **`src/lib/sources/qq.test.ts`** — rewrite the `:148-150` URL assertion for the direct host; add
      the `not.toContain('msg=')`, https-upgrade, idempotency, accom-demotion, no-headers and
      tag-not-clobbered cases; fix the stale `"the live default ('128')"` comment at `:88`.
- [ ] **`src/lib/services/dedupe.test.ts`** — add the first `SOURCE_RANK` tie-break test (qq beats
      netease at equal quality; the surviving row carries `song_mid`).
- [ ] Framework install: **none needed.**

---

## Security Domain

### Applicable ASVS Categories

| ASVS Category | Applies | Standard Control |
|---|---|---|
| V2 Authentication | no | No user accounts. The direct call carries no credential — that is *why* it can go direct |
| V3 Session Management | no | No sessions. **But:** tang sets `server_name_session` via `Set-Cookie`; with `credentials` unset (default `'same-origin'`) the browser neither sends nor stores it cross-origin. **Never set `credentials: 'include'`** (Q4) |
| V4 Access Control | **yes** | The `/api/resolve` entry is **shared across every user in the PoP**, so a client write path would let one crafted request change what everyone else resolves. The existing control — POST is **structurally** DELETE-only, contains no `cache.put`, and never reads a payload field beyond `a`/`t` (`+server.ts:107-119`, `resolve-edge.ts:9`) — **must be preserved verbatim** through the D-10 shape change |
| V5 Input Validation | **yes** | `capTerm` caps `a`/`t` at `MAX_TERM_CHARS = 200`. `matchKey` folding is done **edge-side** and is lossy, so a client cannot hand-craft a key namespace. A **new** ingress: `mid` must be validated/encoded before it enters a URL — `encodeURIComponent` already at `qq.ts:222`; keep it on the direct path |
| V6 Cryptography | no | No crypto. `vkey` in the audio URL is upstream-signed; we neither generate nor verify it |
| V9 Communications | **yes** | D-05's `http:`→`https:` upgrade *is* a security control, not just a mixed-content workaround: it removes a plaintext audio stream. `strict-transport-security: max-age=31536000` observed on tang |
| V14 Configuration | **yes** | Secrets stay in Cloudflare `platform.env`. The direct call needs none. **JOOX keeps its proxy** — `JOOX_TOKEN` must never reach the client |

### Known Threat Patterns for this stack

| Pattern | STRIDE | Standard Mitigation |
|---|---|---|
| Shared-cache poisoning (one request changes what everyone plays) | Tampering | Server-side derivation only; POST is structurally delete-only; `ownOriginCacheKey` for every key. **Preserve through D-10** |
| Secret-bearing URL becoming a cache key | Information Disclosure | `ownOriginCacheKey` (`edge-cache.ts:45`) — the `T-09-05`/`T-wv8-06` invariant. Unchanged: no secret is in scope on the qq path |
| Cache-key collision serving the wrong song | Tampering / Integrity | `catalog.ts:348` documents the load-bearing `source`+`songid` equality check. The D-10 mid path must keep an equivalent identity check — and this is **why the POST bust must survive** (Decisions At Risk #1) |
| Mixed-content downgrade | Info Disclosure / Tampering | D-05 https upgrade |
| `Set-Cookie` from a third party entering the edge cache | Info Disclosure | `cache.put` never caches a `Set-Cookie` response, and `writeResolveEntry` builds a **fresh** `Response` with a two-header allow-list. Do not "simplify" that construction |
| CORS wildcard on **our** routes | Info Disclosure | `hooks.server.ts` allowlists — **never `*`**. The `ACAO: *` in this research is the *upstream's* header on *their* response |
| DoS via the resolve/detail endpoints | DoS | `apiFetch` cap (8) + 25s timeout + circuit breaker; `resolve-edge` bounds (`limit=10`, `retries=1`); POST bust is idempotent and self-limiting (worst case = a cold resolve). Rate limiting is deliberately a WAF rule, not code (`+server.ts:113-118`) |
| Client IP exposure to a third-party CDN | Info Disclosure | **Accepted, D-14** — `<audio src>` already points at `isure6.stream.qqmusic.qq.com`. The probe confirmed the CDN reflects `client-ip:` back. A metadata call adds a hostname, not a category |
| Unbounded memory from a large Blob | DoS (self) | **D-15** — this is the control |

---

## Assumptions Log

| # | Claim | Section | Risk if Wrong |
|---|---|---|---|
| A1 | iOS Safari `<audio>` decodes `.flac` (since Safari 11 / iOS 11) | Pitfall 3 | If wrong, a manually-selected `'lossless'` is silent on iOS. **Low blast radius**: D-03 already sends iOS to `'320'` by default, so only a manual override is affected. Discharge with one on-device play |
| A2 | iOS Safari `<audio>` does **not** decode `.ogg` (Vorbis) | Pitfall 1 | If wrong, only the *urgency* of the accom demotion drops — the "it may be the instrumental" half stands independently |
| A3 | `accom` = 伴奏 (accompaniment/instrumental), not a quality tier | Pitfall 1 | If wrong, demoting the rung costs a little quality when `sq`+`pq` are absent. Cheap either way. **Discharge by listening** — the `.ogg` + iOS half justifies the demotion regardless |
| A4 | Browsers content-sniff `<audio src=blob:>` rather than trusting the Blob's MIME | Pitfall 3 | Partially self-discharging: the m4a path already ships this way and works. FLAC-specific risk is A1 |
| A5 | `fetch('https://openmusic.lolhttps://tang…')` throws a `TypeError` (URL parse failure) rather than silently issuing a wrong request | Q4 | If it instead resolves to something odd, the failure is quieter but the guard is identical. Discharge with the Wave-0 `apiUrl` absolute test |
| A6 | Chrome's `kbps_hq: 193` observation generalizes (`'320'` never really means 320 on qq) | Pitfall 2 | 3/3 tracks agreed. If some catalogue segment does return ~320, the comment fix is over-strong — harmless. Only the comment is affected, not behaviour |
| A7 | `sources/qq.ts` (client) may import `proxy/qq.ts` `buildUrl` without a bundling problem | Pattern 2 | If `svelte-check` or the bundler objects, hoist `TANG_BASE` to a shared const instead of duplicating the host. Discharge at implementation time in seconds |
| A8 | The tang detail RTT measured from this US sandbox (2.0–3.8s) overstates real-user latency to CN hosts | Decisions At Risk #2 | If real-user latency is genuinely 2-4s, "tap→audio under a second" is unreachable on any path and the phase's success criterion needs restating. **Measure on a real device before treating the goal as achievable** |

Everything else in this document is tagged `[VERIFIED: live probe]`, `[VERIFIED: codebase grep]`,
`[VERIFIED: github.com/mdn/browser-compat-data]` or `[CITED: …]` inline.

---

## Open Questions

1. **What is the real-world tang detail RTT from a mobile client?**
   - What we know: 2.0–3.8s direct, 3.9–4.7s proxied, both from a US sandbox to CN hosts.
   - What's unclear: whether a real user near the upstream sees 300ms or 3s. This decides whether the
     ROADMAP's "under a second" is reachable at all.
   - Recommendation: measure both paths (D-08 mid-in-hand, D-06 cross-source) on a real device early in
     the phase. If the floor really is seconds, restate the goal as "lossless by default with no *added*
     latency" rather than an absolute number. **Do not discover this at verification time.**

2. **How often is a QQ mid actually absent after D-08?**
   - What we know: D-08 makes qq win equal-quality ties, so most deduped rows should carry a mid. The
     skill records that qq search intermittently returns 0 rows.
   - What's unclear: the real hit rate. It determines whether D-06/D-10 are the "uncommon path" D-08
     claims or a routine one — and therefore how much the D-10 machinery is worth.
   - Recommendation: one `logAction` counter on the mid-less branch. It is one line, it uses the existing
     Activity-log diagnostic, and it answers the question with real data instead of a guess.

3. **Does `matchKey` collide often enough to serve a wrong mid?**
   - What we know: `matchKey` strips spaces and punctuation and is deliberately lossy. Phase 31's
     `source`+`songid` equality check at `catalog.ts:348` exists precisely because "a cached hit can
     legitimately belong to a DIFFERENT version of the same song".
   - What's unclear: whether a **permanent** entry makes an occasional collision materially worse than a
     900s one did.
   - Recommendation: **keep the POST bust** (Decisions At Risk #1). That is the mitigation, and it costs
     nothing because the code already exists.

4. **Should `RESOLVE_MID_TTL_S` be 1 year or genuinely absent?**
   - What we know: Cloudflare documents no maximum `max-age`, but also no persistence guarantee — LRU
     eviction happens regardless.
   - What's unclear: whether omitting `Cache-Control` entirely behaves better or worse than a 1-year
     `max-age` in `caches.default`.
   - Recommendation: use `max-age=31536000, immutable` — explicit, matches `/api/og`'s proven pattern,
     and never relies on undocumented default behaviour. Not worth a spike.

---

## Environment Availability

Probed live from this sandbox, 2026-08-31.

| Dependency | Required By | Available | Version / Result | Fallback |
|---|---|---|---|---|
| `tang.api.s01s.cn` (QQ metadata) | D-01, D-09, D-12, D-10 fill | ✓ | HTTP 200, `ACAO: *`, 2.29–2.37s | The retained `/api/qq/detail` proxy (D-12), then the kuwo/netease/joox ladder (D-01) |
| `isure6.stream.qqmusic.qq.com` over **https** | D-05, D-15 | ✓ | 200 + 206, `accept-ranges: bytes`, `access-control-expose-headers: Content-Length,Content-Range`, 0.34–0.42s | none needed |
| `oiapi.net/api/Kuwo` (kuwo) | D-01 failure path | ✓ | reachable per project memory `sandbox-no-cn-upstream-network` | — |
| Deezer proxy | not used by this phase | ✓ | reachable | — |
| `api.qijieya.cn` (netease/qq Meting) | netease in the failure path | **✗** | blocked in this sandbox | Sandbox-only limitation, **not** a production one. Any netease-path test must be fixture-backed, never live |
| Node.js | tooling | ✓ | `>=22` per `.nvmrc` | — |
| pnpm | tooling | ✓ | `8.15.5` pinned | — |
| Vitest | tests | ✓ | `^4.1.3` | — |
| `caches.default` (Cloudflare Cache API) | D-10 | **✗ under `vite dev`** | `edgeCache()` returns `null` when `typeof caches === 'undefined'` (`edge-cache.ts:34`) | **Already handled** — every read degrades to "miss" and every write is a no-op, so local dev hits live upstream. D-10 cache behaviour **cannot** be verified with `pnpm dev`; use `pnpm preview` (`wrangler pages dev`) or the deployed Pages URL |
| Android device / emulator | D-02/D-03 real connection detection, D-13 native path | **✗ in sandbox** | — | `checkpoint:human-verify` |
| iOS device | Pitfall 1 (`.ogg`), Pitfall 3 (FLAC blob), D-03 | **✗ in sandbox** | — | `checkpoint:human-verify` |

**Missing dependencies with no fallback:** none block *implementation*. Two block *verification*: real
Android and real iOS devices, and both are already scoped as `checkpoint:human-verify`.

**Missing dependencies with fallback:**
- `caches.default` absent under `vite dev` → use `pnpm preview` or the deployed URL for any D-10 check.
  A plan that verifies D-10 with `pnpm dev` verifies nothing.
- `api.qijieya.cn` blocked → netease-path tests must be fixture-backed.

---

## Sources

### Primary (HIGH confidence)
- **Live probe: `https://tang.api.s01s.cn/music_open_api.php?type=json&mid=…`** — three real mids
  (`0039MnYb0qxYhV` 晴天, `004Z8Ihr0JIu5s` 七里香, plus a deliberately invalid mid and an empty mid).
  Full key dump, complete tier ladder, `song_size_*_str`, `song_lyric`/`lyric`, response headers, three
  distinct failure shapes.
- **Live probe: `https://isure6.stream.qqmusic.qq.com/…`** — `200` and `206`, with and without an
  `Origin` header, plus an explicit `OPTIONS` preflight. Established `access-control-expose-headers`,
  `content-type`, `accept-ranges` and the 1.016s preflight cost.
- **`github.com/mdn/browser-compat-data` → `api/NetworkInformation.json`** (`main`) — authoritative
  per-browser support for `type`, `effectiveType`, `saveData`, `downlink`, `rtt`. This is the same data
  MDN's compat tables render (the rendered tables did not survive WebFetch; the JSON is the source).
- **Codebase reads** — `sources/qq.ts`, `sources/quality.ts`, `sources/kuwo.ts`, `sources/joox.ts`,
  `proxy/qq.ts`, `proxy/resolve-cache.ts`, `proxy/resolve-edge.ts`, `proxy/edge-cache.ts`,
  `routes/api/resolve/+server.ts`, `routes/api/og/+server.ts`, `services/api-base.ts`,
  `services/catalog.ts`, `services/dedupe.ts`, `services/lrc.ts`, `services/resolve-cache-client.ts`,
  `config/defaults.ts`, `stores/settings.svelte.ts`, `stores/player.svelte.ts` (`prebufferNext` region
  only, per D-16), `routes/(app)/settings/playback/+page.svelte`, `vite.config.ts`, `package.json`,
  and the eight relevant `*.test.ts` files + `__fixtures__/qq.detail.json`.
- **`git show upstream/main:index.html`** — line 2373, confirming the `accom` rung is inherited verbatim.
- **`Skill("spike-findings-openmusic")`** — `references/source-resolution.md`,
  `references/click-to-play-cost.md`. Empirical, 20 + 38 real songs across 14 segments.
- **`.planning/notes/qq-lossless-first-resolve.md`** — the phase's own measurement table (treated as
  established fact per the brief; one figure corrected — FLAC weight, see Q1).
- **`.planning/phases/31-…/31-CONTEXT.md`** — the carried-forward D-02/04/05/08/09/10/11/12/13/19.

### Secondary (MEDIUM confidence)
- **`developers.cloudflare.com/workers/runtime-apis/cache/`** — `cache.put` throw conditions, no
  documented max TTL, no persistence guarantee, `413` on oversize.
- **MDN `Web/API/Network_Information_API`, `NetworkInformation/type`, `NetworkInformation/effectiveType`**
  — enumerated values, "Limited availability / not Baseline", `type` marked experimental. (Compat tables
  did not render; superseded by the BCD JSON above.)

### Tertiary (LOW confidence — flagged for validation)
- Codec support claims for iOS Safari (`.flac` yes, `.ogg` no) — training knowledge only, **not verified
  this session**. Tracked as A1/A2 in the Assumptions Log, each with a `checkpoint:human-verify`.
- `accom` = 伴奏 — inference from the naming convention plus a distinct filename prefix (`O801…` vs
  `C600…`/`F000…`) and a distinct container. Tracked as A3.
- Browser content-sniffing of `blob:` media URLs — A4, partially discharged by the fact that the m4a path
  already ships this way.

---

## Metadata

**Confidence breakdown:**
- **Standard stack: HIGH** — zero new dependencies, so there is nothing to get wrong. Every platform API
  was verified against MDN BCD or a live probe.
- **Q1 (`Content-Length`): HIGH** — directly probed, `200` and `206`, with and without `Origin`.
- **Q2 (connection detection): HIGH** — MDN browser-compat-data JSON, the authoritative source.
- **Q3 (cache patterns): HIGH** on the codebase mechanics (read in full); **MEDIUM** on Cloudflare's
  undocumented long-TTL behaviour, mitigated by the explicit-`max-age` recommendation.
- **Q4 (direct-fetch seam): HIGH** — `api-base.ts` read line by line; CORS semantics confirmed by live
  probe of both tang and the CDN.
- **Q5 (detail completeness): HIGH** — live body, every field enumerated, three failure shapes probed.
- **Q6 (test surface): HIGH** — every relevant test file and fixture read; breakages traced to exact
  line numbers.
- **Architecture: HIGH** — no new components; every recommendation lands in an existing file with an
  existing pattern.
- **Pitfalls: HIGH** for 2, 4, 5, 6 (measured / read from source). **MEDIUM** for 1 (the 伴奏 inference —
  though the `.ogg`/iOS half is HIGH and sufficient on its own) and 3 (iOS FLAC codec, A1).
- **Decisions At Risk: HIGH** on #1 (the skill's flakiness finding plus the code's own negative-caching
  rule are both documented) and #2 (arithmetic on the phase's own measurements). **MEDIUM** on #4.

**Research date:** 2026-08-31
**Valid until:** **7 days** for anything touching `tang.api.s01s.cn` — a single unmaintained free API is
the phase's own named risk #2, and every URL in a detail body is signed and short-lived. Re-probe the
detail endpoint before implementation if more than a week passes. **30 days** for the browser-compat and
Cloudflare findings, and for everything read out of this codebase.
