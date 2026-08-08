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
  - "Three Phase 30 deferred follow-ups promoted from prose into .planning/todos/pending/"
affects: [phase-30-verify-work, og-png-raster-followup, artist-page-lookup-key]

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
  - "Did NOT deploy and did NOT build the APK: both remaining tasks are checkpoint:human-verify with gate=blocking, and deploying is an outward-facing action only the user may authorize"

patterns-established:
  - "A phase gate records observed output, never a paraphrase of the verify line — every status/byte-count below was read off a real response"

requirements-completed: []

duration: 7min
completed: 2026-08-08
---

# Phase 30 Plan 06: Phase Gate Summary — PAUSED AT CHECKPOINT

**All four automated gates green (1494 tests / 4365 files / both builds) and the entire curl matrix verified against real responses — including a real-workerd `/api/og` edge-cache hit at 1698ms cold vs 2ms warm — with the two deploy-and-device human checkpoints still pending.**

> **STATUS: PAUSED.** Task 1 (the autonomous phase gate) is complete and committed. Tasks 2 and 3 are
> `checkpoint:human-verify` / `gate="blocking"` and are **NOT done** — see
> [Remaining Human Checkpoints](#remaining-human-checkpoints). Nothing was deployed, no APK was built,
> nothing was pushed.

## Performance

- **Duration:** 7 min
- **Started:** 2026-08-08T04:13:00Z
- **Completed (Task 1 only):** 2026-08-08T04:19:48Z
- **Tasks:** 1 of 3 complete (2 blocking human checkpoints pending)
- **Files modified:** 3 created (all `.planning/todos/pending/`), 0 source files

## Accomplishments

- **All four gates confirmed by observation**, not assumption.
- **The full curl matrix passes**, recorded verbatim below with the resolved port stated.
- **Real-workerd corroboration** of the `/api/og` cache layer, which `vite dev` structurally cannot
  show (`edgeCache()` is null there — RESEARCH Pitfall 8).
- **Three deferred follow-ups promoted to durable todos**, including the `og.png` raster the plan
  names as its artifact.

## Task Commits

1. **Task 1: Full automated phase gate + curl matrix + deferred-item todos** — `126da01` (docs)
2. **Task 2: Real messenger cards against the deployed URL** — **PENDING** (blocking human checkpoint)
3. **Task 3: APK song-page cover image** — **PENDING** (blocking human checkpoint)

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
| T-wv8-04 (DoS on deployed `/api/og`) | mitigate (verify) | **Partially verified.** A repeat request is a real cache hit under workerd (1698ms → 2ms). `cf-cache-status` and real edge TTL/eviction still need Task 2's deploy. |
| T-og-01 (crawler storms on junk queries) | mitigate (verify) | **Verified for the no-term case** — zero subrequests, ~2–4ms, inlined SVG. Note the drift above: a *fuzzy-matchable* junk query does cost subrequests. |
| T-30-06 (repudiation / auditable gate) | mitigate | **Discharged.** Every curl status, header, and byte count above was read off a real response and recorded verbatim. |
| T-{30}-SC (package installs) | accept | **Held.** Zero packages installed this phase; `package.json` untouched. |

## Known Stubs

None. This plan produced no code.

## Threat Flags

None. No source file, endpoint, auth path, file-access pattern, or schema was changed — only three
planning documents were added.

---

## Remaining Human Checkpoints

**Two `checkpoint:human-verify` tasks with `gate="blocking"` remain. Neither was performed, and
neither was simulated.** Both require actions outside this executor's authority: a public deploy and a
physical Android device.

### Checkpoint A — Task 2: Real messenger cards against the deployed URL (OG-VERIFY-01)

**Status: PENDING.** Nothing has been deployed. `https://openmusic.lol` currently serves the
**pre-Phase-30** build.

**Step 1 — deploy (only the user may authorize this):**

```bash
pnpm deploy      # = pnpm build && wrangler pages deploy .svelte-kit/cloudflare --project-name openmusic
```

**Step 2 — re-run the head checks against production:**

```bash
# Crawler user-agent — expect 200 with the og tags
curl -A 'facebookexternalhit/1.1' https://openmusic.lol/song/Nirvana/Come-As-You-Are | grep 'og:'

# The endpoint — expect 200, image/*, cache-control: public, max-age=86400, immutable
curl -sI 'https://openmusic.lol/api/og?type=song&artist=Nirvana&title=Come+As+You+Are'

# Run the SAME request a SECOND time and look for cf-cache-status: HIT
# (this is the ONLY place real edge TTL behavior is observable — T-wv8-04)
curl -sI 'https://openmusic.lol/api/og?type=song&artist=Nirvana&title=Come+As+You+Are' | grep -i cf-cache-status
```

**Step 3 — the human card checks (the actual gate):**

1. **Facebook Sharing Debugger** — <https://developers.facebook.com/tools/debug>, enter
   `https://openmusic.lol/song/Nirvana/Come-As-You-Are`. The card must show the **real Nirvana album
   art**, not the branded `og.svg`. If a bad first crawl got cached, press **Scrape Again**.
2. **Twitter/X Card Validator** (or a tweet draft) — the card renders with the art. A square cover
   center-cropped to 1.91:1 is **expected**, same as today.
3. **Paste the link into at least 3 real messengers** — WhatsApp, iMessage, Slack (Discord/Telegram
   bonus). Each must unfurl with the album art. Note that **Slack and iMessage are exactly the
   platforms that will not render the SVG fallback** — if a card is blank there, check whether
   `/api/og` returned `image/svg+xml` for that query before treating it as a Phase 30 bug (see
   `.planning/todos/pending/og-png-raster-fallback.md`).
4. **One CJK link** — `https://openmusic.lol/song/周杰倫/稻香` — the preview must show the decoded CJK
   title and a real cover (the kuwo tier; verified locally at 49,589 bytes).
5. **One legacy link from before this phase** (any old `?n=&a=&c=` URL) — its card must still render
   (OG-COMPAT-01 in the wild).

**Resume signal:** type `approved` naming which messengers rendered the art, or describe which
platform showed `og.svg`/blank so a gap plan can target it.

### Checkpoint B — Task 3: APK song-page cover image (OG-PAGE-01 native trap)

**Status: PENDING.** No APK was built (no device is available to this executor).

**Step 1 — build the debug APK:**

```bash
pnpm apk         # = pnpm build:native && npx cap sync android && cd android && ./gradlew assembleDebug
```

Confirm gradle exits 0. Note the web-side prerequisite is already proven: `pnpm build:native` exited
0 in this gate.

**Step 2 — on-device checks:**

1. Install the debug APK on an Android device.
2. Open a shared song link in the app, or navigate the WebView to a `/song/{artist}/{title}` URL.
3. **Confirm the album cover renders on the song landing page — not a broken-image icon.** This is the
   whole point: the `<img>` src goes through `apiUrl()` so it resolves to
   `https://openmusic.lol/api/og?…`. A bare `/api/og` would resolve to `https://localhost/api/og`
   inside the Capacitor WebView and show a broken image (RESEARCH Pitfall 7). **This check depends on
   Checkpoint A's deploy having happened first** — `VITE_API_BASE` points the APK at
   `https://openmusic.lol`, so if that origin has no `/api/og` yet, the image cannot load.
4. Kill the network and reopen — the **gradient fallback** must appear (the `onerror` path), never a
   broken image.

**Resume signal:** type `approved`, or describe the broken state (a screenshot of the landing page
helps).

---

## Next Phase Readiness

- **Not ready for `/gsd:verify-work`.** OG-VERIFY-01 and OG-PAGE-01 are the two requirements this plan
  carries and **both** end in a blocking human checkpoint; neither is satisfiable in a sandbox.
- **Everything automatable is done.** All four gates green, the whole curl matrix observed, the cache
  layer corroborated under real workerd. The only unverified surface is what needs a public origin
  (crawler cards, `cf-cache-status`, real TTL) and a physical device (the APK `<img>`).
- **Dependency between the two checkpoints:** A must precede B. The APK loads its cover from
  `VITE_API_BASE=https://openmusic.lol`, so Checkpoint B is meaningless until Checkpoint A's deploy
  has shipped `/api/og` to that origin.
- **Three follow-ups are queued** in `.planning/todos/pending/`; none blocks the phase. The
  `og.png` raster is the one most likely to be *revealed* by Checkpoint A (Slack/iMessage on a
  cover-less share).

## Self-Check

- `.planning/todos/pending/og-png-raster-fallback.md` — FOUND
- `.planning/todos/pending/og-artist-tier-picture-xl-oversize.md` — FOUND
- `.planning/todos/pending/artist-page-hyphenated-lookup-key.md` — FOUND
- commit `126da01` — FOUND in git log
- No deploy performed — CONFIRMED (`wrangler pages deploy` never invoked)
- No APK built — CONFIRMED (`pnpm apk` / gradle never invoked)
- No git push performed — CONFIRMED

## Self-Check: PASSED

---
*Phase: 30-carrier-free-share-links-type-artist-title-api-og*
*Task 1 completed: 2026-08-08 — Tasks 2 and 3 PAUSED awaiting human verification*
