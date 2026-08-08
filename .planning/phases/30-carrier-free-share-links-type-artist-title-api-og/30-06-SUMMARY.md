---
phase: 30-carrier-free-share-links-type-artist-title-api-og
plan: 06
status: paused
subsystem: testing
tags: [phase-gate, vitest, svelte-check, wrangler, workerd, curl, open-graph, edge-cache]

requires:
  - phase: 30-01
    provides: "songShareUrl / entityCardUrl / ogImageUrl carrier-free codec + decodePathSegment"
  - phase: 30-02
    provides: "$lib/proxy/deezer-cover.ts extraction (pinned deezer-endpoint.test.ts harness)"
  - phase: 30-03
    provides: "/api/og tiered resolve endpoint + og-cover.ts + inlined SVG fallback"
  - phase: 30-04
    provides: "the two new carrier-free routes + PageOg origin/og:type fix"
  - phase: 30-05
    provides: "legacy dual-shape loaders + the double-decode 500 fix"
provides:
  - "Observed-output phase gate for Phase 30: pnpm test / check / build / build:native all green"
  - "The full curl matrix recorded verbatim against a resolved dev port (route coexistence, the % 500 fix, /api/og tiers, per-surface og heads, legacy carrier precedence)"
  - "Real-workerd corroboration of the /api/og caches.default layer (1698ms cold -> 2ms warm on identical bytes)"
  - "OG-VERIFY-01 DISCHARGED: deployed to openmusic.lol, production heads verified, a real WhatsApp card with real album art confirmed by user screenshot (scope limit: WhatsApp only, not the >=3 messengers the plan named)"
  - "The % 500 fix confirmed IN PRODUCTION (/album/50%25%20Off and /artist/50%25%20Cent both 200, both 500 before this phase)"
  - "A corrected instrument for T-wv8-04: cf-cache-status is DYNAMIC on every /api/og request by construction; warm-vs-cold response timing on byte-identical responses is the real evidence"
  - "A debug APK at android/app/build/outputs/apk/debug/app-debug.apk (5.2 MB) awaiting device UAT"
  - "Three Phase 30 deferred follow-ups promoted from prose into .planning/todos/pending/"
affects: [phase-30-verify-work, og-png-raster-followup, artist-page-lookup-key, native-build-jdk21-toolchain]

tech-stack:
  added: []
  patterns:
    - "Resolve the dev port before curling (4321 strictPort via launch.json vs 5173 bare pnpm dev) — a curl against the wrong port is not a gate failure"
    - "pnpm preview (wrangler pages dev = real workerd) is the local proof that edgeCache() is non-null and the cache-write path executes; vite dev cannot show it (Pitfall 8)"

key-files:
  created:
    - .planning/todos/pending/og-png-raster-fallback.md
    - .planning/todos/pending/og-artist-tier-picture-xl-oversize.md
    - .planning/todos/pending/artist-page-hyphenated-lookup-key.md
  modified: []

key-decisions:
  - "Ran pnpm preview (real workerd) even though the plan marked it optional — it is the only sandbox-observable proof that the caches.default write path actually executes; real TTL/eviction still needs the deploy"
  - "Promoted 30-03's and 30-05's deferred items out of deferred-items.md into real pending todo files — a phase-local file is not a durable backlog"
  - "cf-cache-status is the WRONG instrument for T-wv8-04 and the plan/VALIDATION both named it wrongly: it reports DYNAMIC on every /api/og request by construction (it describes the zone CDN's decision for a Pages Function response, and a Worker-level caches.default hit never surfaces there). Warm-vs-cold timing on byte-identical responses is the correct evidence"
  - "Checkpoint A closed on WhatsApp evidence alone (user's explicit call), not the >=3 messengers the plan named — recorded as a scope limit, not as full coverage"

patterns-established:
  - "A phase gate records observed output, never a paraphrase of the verify line — every status/byte-count below was read off a real response"
  - "When an acceptance criterion names an instrument that cannot observe the thing (cf-cache-status for a Worker-level cache hit), correct the criterion and record the substitute measurement — do not log it as a failure and do not claim the header showed a hit"

requirements-completed: []  # OG-VERIFY-01 is DISCHARGED but stays unlisted until the plan closes; OG-PAGE-01 still needs its device run

duration: 7min (Task 1) + deploy/APK cycle
completed: 2026-08-08
---

# Phase 30 Plan 06: Phase Gate Summary — CHECKPOINT A PASSED, B AWAITING DEVICE UAT

**All four automated gates green (1494 tests / 4365 files / both builds), the entire curl matrix verified against real responses locally AND in production, a real WhatsApp card rendering real album art from the deployed `/api/og` — with only the on-device APK cover check outstanding.**

> **STATUS: PAUSED — the plan is NOT complete.**
> - Task 1 (autonomous phase gate) — **COMPLETE**, committed `126da01`.
> - Task 2 / Checkpoint A (OG-VERIFY-01, deployed messenger cards) — **PASSED**, with a stated scope
>   limit (WhatsApp only). See [Checkpoint A](#checkpoint-a--task-2-og-verify-01--passed).
> - Task 3 / Checkpoint B (OG-PAGE-01, APK cover on-device) — **APK BUILT, DEVICE TEST PENDING.** The
>   artifact exists; nobody has run it on a phone. See
>   [Checkpoint B](#checkpoint-b--task-3-og-page-01--apk-built-device-test-pending).
>
> This executor performed no deploy, built no APK, and pushed nothing. The deploy and the APK build
> were authorized and run by the user/orchestrator; their results are recorded here as reported
> observations.

## Performance

- **Duration:** 7 min (Task 1, this executor) + the user-run deploy and APK build
- **Started:** 2026-08-08T04:13:00Z
- **Task 1 completed:** 2026-08-08T04:19:48Z
- **Tasks:** 2 of 3 complete (1 blocking human checkpoint pending: the device run)
- **Files modified:** 3 created (all `.planning/todos/pending/`), 0 source files

## Accomplishments

- **All four gates confirmed by observation**, not assumption.
- **The full curl matrix passes**, recorded verbatim below with the resolved port stated.
- **Real-workerd corroboration** of the `/api/og` cache layer, which `vite dev` structurally cannot
  show (`edgeCache()` is null there — RESEARCH Pitfall 8).
- **Shipped and verified in production.** `openmusic.lol` serves this phase; every head assertion holds
  against the live origin, and **the `%` 500 fix is confirmed in production** (both URLs that returned
  500 before this phase now return 200).
- **A real crawler card with real album art**, screenshot-confirmed in WhatsApp — the end-to-end proof
  OG-VERIFY-01 exists for, and the only thing no sandbox can produce.
- **Corrected a wrong acceptance criterion.** `cf-cache-status` cannot observe a Worker-level
  `caches.default` hit; the substitute measurement (warm-vs-cold timing on byte-identical responses) is
  recorded instead.
- **Three deferred follow-ups promoted to durable todos**, including the `og.png` raster the plan
  names as its artifact.

## Task Commits

1. **Task 1: Full automated phase gate + curl matrix + deferred-item todos** — `126da01` (docs)
2. **Task 2 / Checkpoint A: Real messenger cards against the deployed URL** — **PASSED** (no commit; a
   deploy + human verification, not a code change). Scope limit recorded below.
3. **Task 3 / Checkpoint B: APK song-page cover image** — **APK BUILT, DEVICE TEST PENDING** (no
   commit; the APK is a build artifact under `android/app/build/`, which is gitignored)

**Plan metadata:** `fa83e97` (partial summary), `8acc415` (STATE + ROADMAP paused), plus this update.

---

## Gate 1–4: Automated Gates (all observed)

| Gate | Command | Observed result |
|---|---|---|
| Suite | `pnpm test` | **89 test files passed (89) / 1494 tests passed (1494)**, duration 8.82s — vitest 4.1.8 |
| Types | `pnpm check` | `COMPLETED 4365 FILES 0 ERRORS 0 WARNINGS 0 FILES_WITH_PROBLEMS` |
| Web build | `pnpm build` | **exit 0** — `✓ built in 5.88s`, `Using @sveltejs/adapter-cloudflare ✔ done` |
| Native build | `pnpm build:native` | **exit 0** — `Using @sveltejs/adapter-static / Wrote site to "build" ✔ done` |

Exit codes were captured explicitly (`WEB_BUILD_EXIT=0`, `NATIVE_BUILD_EXIT=0`), not inferred from
console output. `pnpm build` was re-run last so the tree is left with the web (adapter-cloudflare)
output in `.svelte-kit/cloudflare` rather than the native one.

The only console noise is pre-existing: `tongwen-core` sourcemap warnings (a `zh-convert` dependency,
unrelated to this phase) and a rolldown `PLUGIN_TIMINGS` breakdown.

---

## The curl matrix (observed output)

**Resolved port: `http://localhost:5173`.** Resolution ran as specified —
`DEV=http://localhost:4321; curl -sf -o /dev/null "$DEV" || DEV=http://localhost:5173` — and `:4321`
was **not** listening, so `:5173` (a bare `pnpm dev`) was used. Confirmed it is this app and this
working tree: `<title>openmusic — music streaming for earth</title>` and the 2-segment route already
emitting `og:type`.

### 1. Route coexistence (RESEARCH §A.2)

| Request | Status | Expected |
|---|---|---|
| `/song/come-as-you-are-nirvana?n=Come%20As%20You%20Are&a=Nirvana` (legacy `[slug]`) | **200** | 200 ✅ |
| `/song/Nirvana/Come-As-You-Are` (new 2-segment) | **200** | 200 ✅ |
| `/album/Nevermind?artist=Nirvana` (legacy `[name]`) | **200** | 200 ✅ |
| `/album/Nirvana/Nevermind` (new 2-segment) | **200** | 200 ✅ |
| `/artist/Nirvana` | **200** | 200 ✅ |
| `/song/A/B/C` (over-deep) | **404** | 404 ✅ |

Both route shapes coexist with no `prevent_conflicts` collision, exactly as §A.2 predicted.

### 2. The `%`-name 500 fix (OG-COMPAT-01)

| Request | Status | Before this phase |
|---|---|---|
| `/album/50%25%20Off` | **200** | 500 (`URIError` from the double decode) ✅ fixed |
| `/artist/50%25%20Cent` | **200** | 500 ✅ fixed |
| `/album/Nirvana/50%25%20Off` (new route) | **200** | n/a — new ✅ |

### 3. `/api/og` tiers

| Request | Status | `content-type` | `cache-control` | Bytes |
|---|---|---|---|---|
| `?type=song&artist=Nirvana&title=Come+As+You+Are` | **200** | `image/jpeg` | `public, max-age=86400, immutable` | 72,650 |
| `?type=album&artist=Nirvana&title=Nevermind` | **200** | `image/jpeg` | `public, max-age=86400, immutable` | 70,313 |
| `?type=artist&artist=Nirvana` | **200** | `image/jpeg` | `public, max-age=86400, immutable` | 199,741 (see Deferred) |
| `/api/og` — **no params** | **200** | **`image/svg+xml`** | `public, max-age=86400, immutable` | 1,493 |
| `?type=banana&…` — **bad type** | **200** | `image/jpeg` | `public, max-age=86400, immutable` | 72,650 (coerced to `song`) |
| `?artist=zzqqxx9&title=zzqqxx9nosuchsong` — all-tier miss | **200** | `image/svg+xml` | `public, max-age=86400, immutable` | 1,493 |
| `?type=song&artist=周杰倫&title=稻香` (CJK, kuwo tier) | **200** | `image/jpeg` | `public, max-age=86400, immutable` | 49,589 |
| `OPTIONS /api/og` | **204** | — | — | — |

Full response headers on the known-song request, verbatim:

```
HTTP/1.1 200 OK
access-control-allow-headers: Content-Type, Range
access-control-allow-methods: GET, POST, OPTIONS
cache-control: public, max-age=86400, immutable
content-length: 72650
content-type: image/jpeg
```

Never a `30x` on any of the eight requests, never a `500` — including on the bad-type and total-miss
paths. `content-length` is always present (the explicit cap RESEARCH §C.13 asks for).

### 4. Per-surface OG heads

`grep -c 'og:type'` returned exactly **1** on all five routes. `og:url` shows the **requested**
origin (`http://localhost:5173`, not the old hardcoded `openmusic.lol`) on every one:

| Route | `og:type` count | `og:type` | `og:url` | `og:image` |
|---|---|---|---|---|
| `/song/Nirvana/Come-As-You-Are` | **1** | `music.song` | `http://localhost:5173/song/Nirvana/Come-As-You-Are` | `…/api/og?type=song&artist=Nirvana&title=Come%20As%20You%20Are` |
| `/album/Nirvana/Nevermind` | **1** | `music.album` | `http://localhost:5173/album/Nirvana/Nevermind` | `…/api/og?type=album&artist=Nirvana&title=Nevermind` |
| `/artist/Nirvana` | **1** | `profile` | `http://localhost:5173/artist/Nirvana` | `…/api/og?type=artist&artist=Nirvana` |
| `/song/come-as-you-are-nirvana?n=&a=` (legacy, no `c`) | **1** | `music.song` | `http://localhost:5173/song/come-as-you-are-nirvana` | `http://localhost:5173/og.svg` |
| `/album/Nevermind?artist=Nirvana` (legacy, no `c`) | **1** | `music.album` | `http://localhost:5173/album/Nevermind` | `http://localhost:5173/og.svg` |

`music.song` / `music.album` / `profile` are all three correct per route — the pre-phase behavior
emitted `music.song` everywhere. `og:image` is absolute on every surface (crawlers reject a relative
one).

### 5. Legacy carrier precedence (OG-COMPAT-01 in detail)

With a real https `c=` carrier appended, all three legacy shapes emit the **carrier** as `og:image`,
unchanged from pre-phase behavior:

| Route | `og:image` |
|---|---|
| `/song/…?n=&a=&c=<https dzcdn>` | `https://cdn-images.dzcdn.net/images/cover/fe1082c5…/1000x1000-000000-80-0-0.jpg` |
| `/album/Nevermind?artist=Nirvana&c=<https dzcdn>` | `https://cdn-images.dzcdn.net/images/cover/fe1082c5…/1000x1000-000000-80-0-0.jpg` |
| `/artist/Nirvana?c=<https dzcdn>` | `https://cdn-images.dzcdn.net/images/cover/fe1082c5…/1000x1000-000000-80-0-0.jpg` |
| `/artist/Nirvana?c=<**http** insecure>` | `http://localhost:5173/api/og?type=artist&artist=Nirvana` |

The last row is the https gate proving itself: a non-https carrier is rejected and the new `/api/og`
fallback takes over, exactly as 30-05 documented.

### 6. CJK carrier-free page

```
GET /song/%E5%91%A8%E6%9D%B0%E5%80%AB/%E7%A8%BB%E9%A6%99  -> 200
   og:title" content="稻香 • 周杰倫"
   og:image" content="…/api/og?type=song&artist=%E5%91%A8%E6%9D%B0%E5%80%AB&title=%E7%A8%BB%E9%A6%99"
```

Decoded CJK renders in the card title and round-trips into the `/api/og` query.

### 7. Real workerd — `caches.default` corroboration (`pnpm preview`, `:4173`)

The plan marked this optional; it was run because it is the **only** locally observable proof that
the cache-write path executes at all (`edgeCache()` is null under `vite dev`, Pitfall 8).

```
request #1 -> status=200 ct=image/jpeg bytes=72650 time=1.699138s
request #2 -> status=200 ct=image/jpeg bytes=72650 time=0.003095s
request #3 -> status=200 ct=image/jpeg bytes=72650 time=0.002537s
```

Wrangler's own request log agrees: `GET /api/og 200 OK (1698ms)` then `(2ms)`, `(2ms)`. **~550× faster
on identical bytes with identical headers** — a real `caches.default` hit, and the served copy still
carries `Cache-Control: public, max-age=86400, immutable` and no CORS-restrictive headers.

**T-og-01 (junk-query DoS)** — a no-term request costs **zero subrequests**: 4.0ms then 2.2ms,
`image/svg+xml`, 1,493 bytes, served straight from the inlined module constant with no network at all.

All five new/legacy route shapes were re-confirmed under workerd (not just vite dev):
`/song/Nirvana/Come-As-You-Are` 200, `/album/Nirvana/Nevermind` 200, `/artist/Nirvana` 200,
`/album/50%25%20Off` **200**, `/song/A/B/C` 404.

**What this does NOT prove** (still deploy-only, per 30-VALIDATION's Manual-Only table): real edge
**TTL**, **eviction**, and cross-PoP **hit-rate**. `pnpm preview` simulates the Cache API; it does not
simulate cache lifetime. `cf-cache-status` does not exist locally. T-wv8-04 remains
`mitigate (verify)` until Task 2's deploy.

---

## Files Created/Modified

- `.planning/todos/pending/og-png-raster-fallback.md` — the plan's named artifact: RESEARCH §C.11's
  raster recommendation, with the explicit note that the SVG fallback is the **pre-existing status
  quo, not a Phase 30 regression**, plus the `qlmanage -t` recipe and the one-constant swap.
- `.planning/todos/pending/og-artist-tier-picture-xl-oversize.md` — 30-03's artist-tier
  `picture_xl` (199,741 bytes observed vs 70–73 KB) because `prefer` reaches `pickAlbumCover` only.
- `.planning/todos/pending/artist-page-hyphenated-lookup-key.md` — 30-05's open question, written as
  **probe-before-changing** with `Jay-Z` named as the risk case.

No source file was touched by this plan.

## Decisions Made

- **Ran `pnpm preview` despite it being optional.** It is the single local check that distinguishes
  "the cache code compiles" from "the cache actually caches". Cheap (one build already existed) and it
  produced the strongest evidence in this gate.
- **Promoted the deferred items to real todo files.** `deferred-items.md` is phase-local and dies with
  the phase directory's relevance; `.planning/todos/pending/` is the durable backlog. The task
  explicitly required real files, not prose.
- **The artist-lookup todo prescribes a probe, not a fix.** Switching `+page.svelte` to
  `decodePathSegment` would silently change resolution for legacy `Jay-Z`-style names — a
  compatibility judgment CONTEXT locks only for the card. Writing the fix into the todo would have
  smuggled an unmade decision into the backlog.

## Deviations from Plan

None — Task 1 executed exactly as written. The matrix was extended beyond the literal requirement
(legacy carrier precedence, the insecure-`http` gate, the CJK page, and the workerd run), which is
additional evidence, not a deviation.

## Assumption Drift (advisory)

**1. The dev server was already running on `:5173`, not started by this executor**

- **Found during:** Task 1, port resolution.
- **Planned:** the plan and VALIDATION both frame `:5173` as "the port the executor gets when it
  starts its own `pnpm dev`", with `:4321` as the launch.json/`preview_start` path.
- **Actual:** `:4321` was not listening and `:5173` already was, so the matrix ran against a
  pre-existing bare `pnpm dev`.
- **Why it matters:** the port was resolved by probe exactly as instructed, and the server was
  verified to be this app on this working tree (title + the 2-segment route emitting `og:type`) before
  any result was trusted. Recording it so a reader knows the matrix ran against a server this executor
  did not start.

**2. Nonsense queries do not reliably reach the SVG fallback**

- **Found during:** Task 1, the workerd junk-query storm (T-og-01 spot-check).
- **Planned/assumed:** a junk query misses every tier and falls through to the branded SVG.
- **Actual:** the specific pair 30-03 used (`zzqqxx9` / `zzqqxx9nosuchsong`) does return
  `image/svg+xml`, reproducibly. But 4 of 5 *other* nonsense pairs (`zzq1`/`nosuchsong1`, …) returned
  `image/jpeg` — the upstreams fuzzy-match garbage to a real cover rather than returning a clean
  no-match.
- **Why it matters:** the miss path is genuinely exercised (proven by the `zzqqxx9` case and by the
  no-params case), but "any junk query hits the fallback" is not true. It also means junk crawler
  traffic costs real subrequests: those requests took **1.8–3.9s** in this sandbox. That total exceeds
  the ~2.5s resolve deadline because the deadline bounds the *resolve chain*, not the subsequent image
  stream — and sandbox→Deezer/kuwo latency is far worse than edge→upstream latency. Not a regression
  and inside the 3–10s crawler budget RESEARCH §D.15 cites, but it is the real shape of the
  cold-junk-query path.

## Issues Encountered

None. `pnpm build:native` leaves `.svelte-kit` in adapter-static state, so `pnpm build` was re-run
afterwards to restore the web output — housekeeping, not an issue.

## Threat Model Status

| Threat ID | Disposition | Status after this plan |
|---|---|---|
| T-wv8-04 (DoS on deployed `/api/og`) | mitigate (verify) | **Verified in production, by the corrected instrument.** Repeat requests warm at 0.304/0.348/0.403s on byte-identical 30,840B responses; a previously-unrequested song went cold 0.979s → warm 0.396s on identical 111,258B — a ~2.5× drop with no byte change, i.e. the cache path working. `cf-cache-status` was the **wrong** instrument (see the correction below). Real TTL/eviction over 24h remains unobserved. |
| T-og-01 (crawler storms on junk queries) | mitigate (verify) | **Verified for the no-term case** — zero subrequests, ~2–4ms, inlined SVG. Note the drift above: a *fuzzy-matchable* junk query does cost subrequests. |
| T-30-06 (repudiation / auditable gate) | mitigate | **Discharged.** Every curl status, header, and byte count above was read off a real response and recorded verbatim. |
| T-{30}-SC (package installs) | accept | **Held.** Zero packages installed this phase; `package.json` untouched. |

## Known Stubs

None. This plan produced no code.

## Threat Flags

None. No source file, endpoint, auth path, file-access pattern, or schema was changed — only three
planning documents were added.

---

## Human Checkpoints

### Checkpoint A — Task 2: OG-VERIFY-01 — **PASSED**

**Deployed.** `https://openmusic.lol` serves this phase's code. The user authorized and ran
`pnpm deploy`; this executor did not deploy.

#### A.1 The real messenger card (the actual gate) — CONFIRMED

**WhatsApp, confirmed by user screenshot.** A link typed as
`https://openmusic.lol/song/Olivia-Dean/Man-I-Need` unfurled as a **large-image card** showing:

- the **full album art** (not the branded `og.svg`),
- title `Man I Need • Olivia Dean`,
- description `Listen on openmusic`,
- attribution `openmusic.lol`.

A second card in the same thread, from `openmusic.pages.dev`, showed `Come As You Are • Nirvana` with
its cover — so **both origins produce correct cards**, which is the `PageOg` origin fix (30-04) paying
off in the wild rather than only in a curl.

This is the one thing no sandbox can produce: a third-party crawler fetching our own-origin `/api/og`
and rendering the bytes. **OG-VERIFY-01's end-to-end proof exists.**

#### A.2 Scope limit — state this honestly

**Only WhatsApp was tested.** The plan specified **≥3 messengers** plus the Facebook Sharing Debugger
and the Twitter/X Card Validator. None of those were run:

| Check the plan named | Status |
|---|---|
| WhatsApp | ✅ **confirmed** (screenshot) |
| iMessage | ❌ not tested |
| Slack | ❌ not tested |
| Discord / Telegram (bonus) | ❌ not tested |
| Facebook Sharing Debugger | ❌ not run |
| Twitter/X Card Validator | ❌ not run |

**The user explicitly chose to close A on the WhatsApp evidence.** Recorded as a deliberate scope
reduction, not as coverage.

Mitigating context, not a substitute for the missing checks: **WhatsApp is the strictest platform in
the set** on `og:image` byte size and on redirect-following (RESEARCH §D.15 — it is the crawler the
"stream, do not 302" decision was made *for*). So it is the highest-value single data point available.
But **no claim is made about iMessage or Slack**, and those two are precisely the platforms that will
not render the SVG fallback if a share ever misses every tier — see
`.planning/todos/pending/og-png-raster-fallback.md`.

#### A.3 Production head verification (orchestrator-observed, all on `https://openmusic.lol`)

| Check | Observed |
|---|---|
| `/song/Olivia-Dean/Man-I-Need` | **200**; `og:type` count exactly **1**, value `music.song` |
| ↳ `og:title` | `Man I Need • Olivia Dean` |
| ↳ `og:url` | `https://openmusic.lol/song/Olivia-Dean/Man-I-Need` — the **requested** origin, proving the `PageOg` hardcode fix in production |
| ↳ `og:image` | `https://openmusic.lol/api/og?type=song&artist=Olivia%20Dean&title=Man%20I%20Need` — absolute |
| ↳ `twitter:card` | `summary_large_image` |
| `/album/Nirvana/Nevermind` | `og:type` = `music.album` |
| `/artist/Nirvana` | `og:type` = `profile` |
| `/song/%E5%91%A8%E6%9D%B0%E5%80%AB/%E7%A8%BB%E9%A6%99` (CJK) | **200**, `og:title` = `稻香 • 周杰倫` |
| `/song/come-as-you-are-nirvana?n=Come%20As%20You%20Are&a=Nirvana` (legacy) | **200**, card intact — OG-COMPAT-01 in the wild |
| `/song/A/B/C` | **404** |
| **`/album/50%25%20Off`** | **200** — **was 500 before this phase** |
| **`/artist/50%25%20Cent`** | **200** — **was 500 before this phase** |
| `/api/og?type=song&artist=Olivia+Dean&title=Man+I+Need` | **200** `image/jpeg`, `content-length: 30840`, `cache-control: public, max-age=86400, immutable` |

The `%`-name 500 fix is therefore confirmed **in production**, not merely in dev — the strongest single
line in this gate, because it is a live bug that existed before the phase and is now gone.

#### A.4 Correction to the plan's own acceptance criterion — `cf-cache-status` is the wrong instrument

Both `30-06-PLAN.md` and `30-VALIDATION.md` name `cf-cache-status` as *"the only place real edge TTL
behavior is observable"* for **T-wv8-04**. **That criterion is wrong and cannot be satisfied.**

`cf-cache-status` reports **`DYNAMIC` on every `/api/og` request, and always will**, because it
describes the *zone CDN's* decision about a Pages Function response. A **Worker-level
`caches.default` hit does not surface in that header at all.** No amount of correct caching would make
it say `HIT`.

This is recorded as a **defective criterion, not a failed one.** No claim is made that the header
showed a hit.

**The correct instrument is response timing on byte-identical responses.** Measured on production:

| Measurement | Observed |
|---|---|
| Repeat requests, warm (`Olivia Dean / Man I Need`) | **0.304s / 0.348s / 0.403s**, all **30,840 B** |
| A previously-unrequested song (`Radiohead / Weird Fishes`) | cold **0.979s** → warm **0.396s**, **111,258 B** both times |

A ~2.5× drop with **zero byte change** is the cache path working. Combined with the local workerd
result (1698ms → 2ms), the `caches.default` layer is verified at both levels.

**Still unobserved:** real **TTL** over the 24h `max-age` window, and **eviction**. Those need
elapsed wall-clock time, not another request, and remain open.

### Checkpoint B — Task 3: OG-PAGE-01 — **APK BUILT, DEVICE TEST PENDING**

**Status: the artifact exists; nobody has run it on a phone.** This is the one genuinely unfinished
item in the plan, and it is why the plan stays open.

#### B.1 Build — succeeded

| Step | Result |
|---|---|
| `pnpm run build:native` | **exit 0** |
| `npx cap sync android` | **exit 0** |
| `./gradlew assembleDebug` | **BUILD SUCCESSFUL** |

**Artifact:** `android/app/build/outputs/apk/debug/app-debug.apk` — **5.2 MB**. (Gitignored build
output, so there is no commit for this step.)

#### B.2 Build-environment gotcha — JDK 21 is installed but invisible to Gradle

`pnpm run apk` **initially failed**:

```
Cannot find a Java installation … matching {languageVersion=21}
```

`/usr/libexec/java_home -V` lists only **JDK 20, 17 and 11** — but `openjdk@21` **is** installed via
Homebrew at:

```
/opt/homebrew/opt/openjdk@21/libexec/openjdk.jdk/Contents/Home
```

It is simply **not registered with `java_home`**, so Gradle's toolchain auto-detection cannot see it.
Building with `JAVA_HOME` set to that path succeeded. **No system or repo config was changed** — the
fix was a per-invocation env var, not a committed change.

Worth knowing for the next native pass: `pnpm apk` is not self-sufficient on this machine. Either
export `JAVA_HOME` for the invocation, or `sudo ln -s` the Homebrew JDK into
`/Library/Java/JavaVirtualMachines/` to register it properly. Deliberately **not** committed — a
developer-machine concern, not a repo one.

#### B.3 Construction-level evidence (NOT a device run)

Static inspection of the built SPA confirms the APK will hit the right host:

- `https://openmusic.lol` is baked into the built chunks (`VITE_API_BASE`),
- `api/og?type=song` is present in the bundle.

So the `<img>` resolves against the **deployed origin** rather than `https://localhost` — which is
exactly the trap OG-PAGE-01 exists to catch (RESEARCH Pitfall 7). **This is construction-level
evidence only.** It proves the URL was built correctly; it does **not** prove the image renders on a
real WebView. Do not read B.3 as satisfying B.

#### B.4 Remaining device steps (the actual gate)

1. Install `android/app/build/outputs/apk/debug/app-debug.apk` on an Android device.
2. Open a shared song link in the app, or navigate the WebView to a `/song/{artist}/{title}` URL —
   e.g. `/song/Olivia-Dean/Man-I-Need`, which is already proven to return a real 30,840 B JPEG from
   production.
3. **Confirm the album cover renders on the song landing page — not a broken-image icon.**
4. Kill the network and reopen — the **gradient fallback** must appear (the `onerror` path), never a
   broken image.

Checkpoint A's deploy is done, so B's prerequisite is satisfied: `/api/og` is live on
`https://openmusic.lol`, the origin the APK targets.

**Resume signal:** type `approved`, or describe the broken state (a screenshot of the landing page
helps).

---

## Next Phase Readiness

- **OG-VERIFY-01 is discharged** — deployed, production heads verified, a real WhatsApp card with real
  album art. Carries the stated scope limit (WhatsApp only, no validators).
- **OG-PAGE-01 is not** — the APK is built but unrun on hardware. **This single item is what keeps the
  plan and the phase open.**
- **Everything else is done.** All four gates green, the curl matrix observed locally *and* in
  production, the `/api/og` cache layer verified at both the workerd and the production level, the `%`
  500 fix confirmed live.
- **Do not run `/gsd:verify-work` for Phase 30 yet.** One of the plan's two requirements still has an
  unrun blocking checkpoint.
- **Two items stay genuinely unobserved and should not be quietly dropped:** real edge cache **TTL /
  eviction** over the 24h window (needs elapsed time), and **iMessage / Slack** card rendering (the two
  platforms most sensitive to the SVG fallback).
- **Three follow-ups are queued** in `.planning/todos/pending/`; none blocks the phase. The `og.png`
  raster is the one most likely to surface once iMessage/Slack are eventually checked on a cover-less
  share.
- **Not committed by design:** the `JAVA_HOME` workaround for the invisible Homebrew JDK 21 (B.2) — a
  developer-machine concern, not a repo one.

## Self-Check

- `.planning/todos/pending/og-png-raster-fallback.md` — FOUND
- `.planning/todos/pending/og-artist-tier-picture-xl-oversize.md` — FOUND
- `.planning/todos/pending/artist-page-hyphenated-lookup-key.md` — FOUND
- commits `126da01`, `fa83e97`, `8acc415` — FOUND in git log
- No deploy performed **by this executor** — CONFIRMED (the deploy was user-authorized and user-run;
  its results are recorded above as reported observations, and marked as such)
- No APK built **by this executor** — CONFIRMED (same: user-authorized and user-run)
- No git push performed — CONFIRMED
- Plan **not** marked complete; plan counter **not** advanced; ROADMAP checkbox for 30-06 **still
  unchecked** — CONFIRMED (Checkpoint B is genuinely unfinished)

## Self-Check: PASSED

---
*Phase: 30-carrier-free-share-links-type-artist-title-api-og*
*Task 1 completed 2026-08-08. Checkpoint A (OG-VERIFY-01) PASSED — deployed, WhatsApp card confirmed.*
*Checkpoint B (OG-PAGE-01) APK built, device UAT PENDING — the plan remains OPEN.*
