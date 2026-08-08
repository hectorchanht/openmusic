---
phase: 30-carrier-free-share-links-type-artist-title-api-og
plan: 05
subsystem: web
tags: [sveltekit, routing, ssr, open-graph, backward-compatibility, loader-tests, vitest, tdd, bugfix]

# Dependency graph
requires:
  - phase: 30-carrier-free-share-links-type-artist-title-api-og
    plan: 01
    provides: "decodePathSegment / ogImageUrl / OgType / buildOg({ type }) / isHttpsUrl"
  - phase: 30-carrier-free-share-links-type-artist-title-api-og
    plan: 04
    provides: "PageOg reading an optional og.type (default music.song) + the loader-test shape to copy"
provides:
  - "Every legacy query-carrier share URL (?n=&a=&c= / ?artist=&c=&dn=&da= / ?c=&dn=) keeps working with its card, pinned by tests"
  - "The live /album/50%25%20Off + /artist/50%25%20Cent 500 is dead (four double-decode sites deleted)"
  - "/artist/{name} is the DUAL handler — legacy c/dn carriers AND a carrier-free /api/og-backed card"
  - "Correct per-surface og:type on all three legacy loaders (music.song / music.album / profile)"
  - "The legacy song share page renders the carried album art as an <img>"
affects: [30-06]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Legacy-compat loader test: one describe block per carrier contract, so a future refactor that drops a query carrier fails a named test"
    - "og:image spliced OVER buildOg only when the sharer-supplied carrier is absent — the isHttpsUrl gate keeps its exact legacy precedence"
    - "A route param is decoded EXACTLY ONCE, by SvelteKit; grep decodeURIComponent(page.params too, not just decodeURIComponent(params"

key-files:
  created:
    - src/routes/(app)/song/[slug]/loader.test.ts
    - src/routes/(app)/album/[name]/loader.test.ts
    - src/routes/(app)/artist/[name]/loader.test.ts
  modified:
    - src/routes/(app)/song/[slug]/+page.ts
    - src/routes/(app)/song/[slug]/+page.svelte
    - src/routes/(app)/album/[name]/+page.ts
    - src/routes/(app)/album/[name]/+page.svelte
    - src/routes/(app)/artist/[name]/+page.ts
    - src/routes/(app)/artist/[name]/+page.svelte

key-decisions:
  - "FOUR double-decode sites existed, not the three RESEARCH §A.3 listed — artist/[name]/+page.svelte:45 was missed, and fixing only the loader left /artist/50%25%20Cent still 500ing during SSR render"
  - "The artist page keeps the RAW param as its resolution key (no decodePathSegment) — minimal diff, zero lookup-behavior change; the hyphen-vs-space resolution question is logged as deferred, not silently decided"
  - "On the legacy song page the <img> src is data.og.image directly, NOT apiUrl() — it is an absolute external CDN URL, the opposite of 30-04's own-origin /api/og case"
  - "The artist /api/og fallback is applied only when isHttpsUrl(c) is false, so the legacy carrier's precedence is provably unchanged"

patterns-established:
  - "Reproduce a live 500 as a unit assertion BEFORE deleting the offending line — the URIError in the RED run is the regression proof"

requirements-completed: [OG-COMPAT-01, OG-PAGE-01]

# Metrics
duration: 12min
completed: 2026-08-07
---

# Phase 30 Plan 05: Legacy Compatibility Lock + the Double-Decode 500 Summary

**Every `?n=&a=&c=` / `?artist=&c=&dn=&da=` / `?c=&dn=` link already sitting in someone's chat history now has a named test guarding it, the production `URIError` 500 on any entity name containing a literal `%` is dead at all four sites, `/artist/{name}` serves both link generations off one loader, and the legacy song landing finally shows the album art it has been carrying since `quick-260723-r4p`.**

## Performance

- **Duration:** ~12 min
- **Tasks:** 2/2 (Task 1 RED → GREEN, Task 2 plain)
- **Files:** 3 created, 6 modified

## The fail-first run — observed output, not a paraphrase

This is the plan's central proof, so it is recorded verbatim.

**Live pre-fix baseline** (resolved port `http://localhost:5173`, before any edit):

```
/album/50%25%20Off                       500
/artist/50%25%20Cent                     500
/album/Nevermind?artist=Nirvana          200
/artist/Nirvana                          200
```

**RED run** — `pnpm vitest --run` over the three new `loader.test.ts` files against HEAD `141358d`:

```
 Test Files  2 failed | 1 passed (3)
      Tests  9 failed | 20 passed (29)
```

```
 FAIL  src/routes/(app)/album/[name]/loader.test.ts > Pitfall 1 (the live 500)
       > does NOT throw on an already-decoded literal % in the name
AssertionError: expected [Function] to not throw an error but 'URIError: URI malformed' was thrown

 FAIL  src/routes/(app)/artist/[name]/loader.test.ts > Pitfall 1 (the live 500)
       > does NOT throw on an already-decoded literal % in the name
AssertionError: expected [Function] to not throw an error but 'URIError: URI malformed' was thrown
```

The other 7 reds were the not-yet-implemented `og:type` (`expected 'music.song' to be 'profile'`,
`… to be 'music.album'`) and the not-yet-implemented artist carrier-free image
(`expected null to be 'https://openmusic.lol/api/og?type=artist&artist=Nirvana'`).

`song/[slug]/loader.test.ts` was **green from HEAD** — that loader never decoded params, which is
exactly why PATTERNS §4 calls it the in-repo proof that the correct form already existed. Its value
is as a frozen compat gate, not as a bug reproduction.

RED commit `e2234ac`, GREEN commit `0412e6e`.

## What Was Built

### Task 1 — the loaders (`e2234ac` RED → `0412e6e` GREEN)

**Three `loader.test.ts` files (29 `it()` blocks)** in the 30-04 shape: `import { load, ssr, prerender } from './+page'`, a hand-built `{ params, url }` event, and the mandated 🔴 comment stating that `params` arrive ALREADY DECODED (passing `50%25%20Off` would have hidden the very bug). Each file has one `describe` per carrier contract, so a future refactor that drops `dn` or renames `c` fails a test with that name on it.

**Four `decodeURIComponent(params)` deletions.** RESEARCH §A.3 listed three; a repo-wide
`grep -rn 'decodeURIComponent(page\.params\|decodeURIComponent(params' src/` found a **fourth** —
`artist/[name]/+page.svelte:45`. That one matters: with only the loader fixed,
`/artist/50%25%20Cent` still 500ed, because the component throws during the SSR render. See
Deviations.

**`og:type` per surface** — `song/[slug]` → `music.song`, `album/[name]` → `music.album`,
`artist/[name]` → `profile`, all passed through `buildOg({ type })` so `PageOg` renders exactly one
tag. Live: `grep -c 'og:type'` = 1 on each surface with the correct value.

**`artist/[name]` is now the dual handler.** `decodePathSegment(params.name)` (which reverses the
`-`-for-space transform and never decodes), the `c`/`dn` reads kept with today's precedence, and:

```ts
if (!isHttpsUrl(c)) og.image = ogImageUrl(url.origin, 'artist', name);
```

The `isHttpsUrl` guard is what makes the compatibility claim provable rather than asserted — a legacy
link with an https `c` takes the identical branch it took before, and only a link *without* one gains
the own-origin card. Spliced over `buildOg`'s result (not passed as `cover`) for 30-04's documented
reason: that input is `isHttpsUrl`-gated and would drop an own-origin **http** dev URL. The LOCKED
hyphen→space loss is commented at the call site with its RESEARCH §B.8 justification.

Carriers left byte-for-byte alone: `song/[slug]`'s `n`/`a`/`c` reads, `album/[name]`'s
`artist`/`c`/`dn`/`da` reads. Every `DQ-1`/`DQ-2`/`D-01`/`D-07`/`quick-260723-r4p`/`quick-260723-ry1`
tag preserved (`grep -c 'DQ-1'` = 2); prose corrected where the deleted decode made it wrong. The
`?play=` reader at `(app)/+page.ts:15` and the album `goto` at `artist/[name]/+page.svelte:464` were
not touched, per plan.

### Task 2 — the legacy song page `<img>` (`cbba9fa`)

```svelte
{#if data.og.image && !coverFailed}
	<img class="cover" src={data.og.image} alt="" referrerpolicy="no-referrer"
	     onerror={() => (coverFailed = true)} />
{:else}
	<div class="cover cover--placeholder" aria-hidden="true"></div>
{/if}
```

`.cover` already carries `object-fit: cover`, so no CSS changed. `coverFailed` is the only new
`$state`; no store import was added, so the SSR-safety-by-construction import list (`PageOg`,
`browser`, `onMount`, `PageData`) is intact.

**`apiUrl()` deliberately does NOT apply here**, and the comment says why: `data.og.image` is the
legacy `c` carrier *after* `isHttpsUrl`, i.e. an absolute external CDN URL. Routing an absolute
cross-origin URL through `apiUrl()` would corrupt it. This is the mirror image of 30-04's case, where
the src was an own-origin `/api/og` path and `apiUrl()` was mandatory — the APK trap is real but it
lives on the *other* page.

The stale `:19` comment ("The cover is never carried") is corrected, `quick-260723-r4p` kept.
`.planning/todos/pending/song-share-stale-cover-comment.md` is **resolved by this commit** — the file
itself was left in place, per plan.

## Verification — commands actually run, with observed output

| Gate | Command | Observed |
|---|---|---|
| Pre-fix live 500 | `curl -o /dev/null -w '%{http_code}'` on both `%` URLs | `500` / `500` |
| Task 1 RED | `pnpm vitest --run` × 3 loader tests | `2 failed \| 1 passed (3)`, `9 failed \| 20 passed (29)`, `URIError: URI malformed` |
| Task 1 GREEN | same | `3 passed (3)`, `29 passed (29)` |
| Typecheck | `pnpm check` (after each task) | `4365 FILES 0 ERRORS 0 WARNINGS 0 FILES_WITH_PROBLEMS` |
| Full suite | `pnpm test` (after each task) | `89 passed (89)` files / `1494 passed (1494)` — baseline 86/1465, so +3 files / +29 tests, zero regressions |
| Web build | `pnpm build` | `@sveltejs/adapter-cloudflare ✔ done`, exit 0 |
| Native build | `pnpm build:native` | `@sveltejs/adapter-static Wrote site to "build" ✔ done`, exit 0 |
| Real decode calls gone | `grep -rn 'decodeURIComponent(params' album/[name] artist/[name]` | only 2 hits, both **test header comments**; `grep` on the two `+page.ts` files → `REAL CALLS: 0` |
| `+page.svelte` sites gone | `grep -c 'decodeURIComponent'` on album + artist pages | `0` / `0` |
| Repo-wide | `grep -rn 'decodeURIComponent(page\.params\|decodeURIComponent(params' src/` | 2 comment hits, 0 calls |
| Decision refs kept | `grep -c 'DQ-1' song/[slug]/+page.ts` | `2` |
| Task 2 greps | `data.og.image` / `cover--placeholder` / `quick-260723-r4p` / `never carried` | `3` / `3` / `1` / `0` |
| No deletions | `git diff --diff-filter=D --name-only HEAD~1 HEAD` per commit | empty |

### Live matrix — **resolved port `http://localhost:5173`**

Resolved with the mandated probe (`DEV=http://localhost:4321; curl -sf -o /dev/null "$DEV" || DEV=http://localhost:5173`). Nothing was listening on `:4321`; a dev server was already serving `:5173`. This is the same resolution 30-04 recorded.

| Request | Observed |
|---|---|
| `GET /album/50%25%20Off` | **200** (was 500) — `og:title "50% Off"` |
| `GET /artist/50%25%20Cent` | **200** (was 500) — `og:title "50% Cent"` |
| `GET /song/come-as-you-are-nirvana?n=…&a=Nirvana` | `200`, `grep -c 'og:title'` = 1, `og:type music.song` |
| `GET /album/Nevermind?artist=Nirvana` | `200`, `og:type music.album` |
| `GET /artist/Nirvana` (carrier-free) | `200`, `grep -c 'og:type'` = **1** value `profile`, `og:image http://localhost:5173/api/og?type=artist&artist=Nirvana` |
| `GET /artist/Nirvana?c=https%3A%2F%2Fcdn-images.dzcdn.net%2Fx.jpg&dn=Nirvana` | `og:image https://cdn-images.dzcdn.net/x.jpg` — the legacy carrier still wins |
| `GET /song/x?n=A&a=B&c=https%3A%2F%2Fcdn-images.dzcdn.net%2Fx.jpg` | `og:image` count 1, and the SERVER html contains `<img class="cover …" src="https://cdn-images.dzcdn.net/x.jpg" alt="" referrerpolicy="no-referrer" onerror=…>` |
| `GET /song/x?n=A&a=B` (no `c`) | `class="cover cover--placeholder …"`, `<img class="cover` count **0** — gradient preserved |
| `GET /song/Nirvana/Come-As-You-Are` | `200` (30-04 route unaffected) |
| `GET /album/Nirvana/Nevermind` | `200` |
| `GET /song/A/B/C` | `404` — §A.2 coexistence-by-depth holds |
| `GET /album/A/B/C` | `404` |

**Not verified here (no environment for it):**

- **Real crawler rendering** of the corrected `og:type` values (Facebook / WhatsApp / iMessage) — needs the deploy. 30-06 owns it.
- **Client-side resolve-and-play** from the legacy song page: unchanged code, but `playStub` fans out to the CN Meting hosts, unreachable from this sandbox (`sandbox-no-cn-upstream-network`).
- **The `<img>` on a real device.** The `src` is an absolute CDN URL so no `apiUrl()` origin question arises, but load success on-device is a 30-06 UAT item.
- **`/artist/{name}` carrier-free upstream artist LOOKUP** (as opposed to the card) — see Deferred.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 — Blocking] A FOURTH double-decode site: `artist/[name]/+page.svelte:45`**

- **Found during:** Task 1, immediately after fixing the artist loader.
- **Issue:** RESEARCH §A.3, CONTEXT and the plan's `<interfaces>` all enumerate exactly three
  `decodeURIComponent` sites. A repo-wide grep found a fourth,
  `const name = $derived(decodeURIComponent(page.params.name ?? ''))` at
  `artist/[name]/+page.svelte:45` — the exact twin of the listed `album/[name]/+page.svelte` line.
  With only the loader fixed, `GET /artist/50%25%20Cent` **still returns 500**, because the component
  throws during the SSR render. The plan's own acceptance criterion (that URL → 200) was
  unreachable without this.
- **Fix:** read `page.params.name` directly, with a comment naming it as the fourth site and stating
  that the literal param stays the resolution key so no lookup behavior changes.
- **Files modified:** `src/routes/(app)/artist/[name]/+page.svelte`
- **Commit:** `0412e6e`
- **Why it is the lazy fix, not scope creep:** it is the same one-line root cause at the same
  trust boundary, and the criterion cannot pass without it. Fixing three of four sites would have
  shipped a still-500ing route with a green test suite.

**2. [Rule 1 — Bug, in my own test] `A%20B` artist assertion was wrong**

- **Found during:** Task 1 GREEN run (28/29 passing).
- **Issue:** I asserted `run('A%20B').og.title === 'A B'`. `decodePathSegment` only reverses the
  `-`-for-space transform and (correctly) does not decode `%20`, so the real value is `'A%20B'`.
- **Fix:** corrected the assertion to `'A%20B'` with a comment stating that this is the *point* —
  a literal `%20` arriving at the loader is text, and turning it back into a space would be the
  re-decode the file exists to forbid. The production code was right; the test was wrong.
- **Commit:** `0412e6e`

### Plan-directed choices worth flagging (not deviations)

- **The legacy song `<img>` does NOT go through `apiUrl()`.** The plan's `<read_first>` mandates
  this and it is the opposite of 30-04's rule — worth stating twice because the two pages now sit
  side by side with contradictory-looking `src` handling. The discriminator is own-origin path vs
  absolute external URL.
- **The artist `/api/og` fallback is gated on `!isHttpsUrl(c)`, not on `!c`.** A carried but
  non-https `c` (which `buildOg` drops to `null`) now also gets the real card instead of `/og.svg`.
  Strictly better and still zero change to what an https carrier does.

## Assumption Drift (advisory)

**1. The bug's blast radius was one site larger than every planning artifact assumed**

- **Found during:** Task 1
- **Planned:** CONTEXT ("three loaders decode a second time"), RESEARCH §A.3 and the plan's
  `<interfaces>` all name exactly three sites, and 30-04's "Next Phase Readiness" repeats the list
  of three.
- **Actual:** four. `artist/[name]/+page.svelte:45` is a component-level twin that the
  `decodeURIComponent(params` search pattern used throughout the artifacts structurally cannot find
  — it reads `page.params`, not `params`.
- **Why it matters:** the "three sites" count is repeated in five documents, so a reader could
  reasonably believe the fix is complete after three deletions and ship a route that still 500s.
  Any future audit of this bug class must grep **both** `decodeURIComponent(params` and
  `decodeURIComponent(page.params`.

**2. The grep-scoping advisory 30-04 raised came true exactly as predicted**

- **Found during:** Task 1 acceptance checks
- **Planned:** `grep -rn 'decodeURIComponent(params' album/[name] artist/[name]` returns no matches.
- **Actual:** it returns 2 matches — both are header comments in my own new test files describing
  the deleted line. Scoped to the two `+page.ts` files, real calls are `0`.
- **Why it matters:** it confirms 30-04's advisory that this grep counts prose. The criterion is
  satisfied in substance; the raw command output is not self-explanatory without this note.

## Issues Encountered

None beyond the two auto-fixes above. `pnpm check` held at 0 errors / 0 warnings throughout, and the
suite went 86/1465 → 89/1494 with no pre-existing test touched.

## Deferred Issues

**Carrier-free `/artist/{name}` resolves against the hyphenated name.** Logged to
`deferred-items.md`. The loader now decodes `Post-Malone` → `Post Malone` for the *card*, but
`+page.svelte` still uses the raw param as the Last.fm/Deezer *lookup* key. Not fixed here because
switching the page to `decodePathSegment` would change resolution for legacy links whose artist name
genuinely contains a hyphen (`Jay-Z` → `Jay Z`) — a compatibility judgment CONTEXT locks only for the
card, not for the resolution path, and RESEARCH §B.8's `matchKey` justification covers *track*
matching, not the artist entity lookup. Needs a live upstream probe; good 30-06 UAT item.

Pre-existing items unchanged: `+layout.svelte`'s hardcoded `SITE`, and the Deezer artist-tier
`picture_xl` size.

## Known Stubs

None. Every surface is fully wired: real carriers read, real `og:type` per surface, a real `<img>`
from the real carried cover, and a real `/api/og` fallback. `.cover--placeholder` is an intentional
null/error fallback, not unfinished work.

## Threat Flags

None new — the register's dispositions are all discharged:

- **T-24-08 (S/SSRF)** — all three loaders remain synchronous and fetch-free (`grep -c 'async'` = 0);
  the legacy `c` is still `isHttpsUrl`-gated by `buildOg` with unchanged precedence, and the artist
  fallback image is a URL we construct on the request's own origin.
- **T-30-05 (Tampering, `<img src>`)** — the src only exists downstream of `isHttpsUrl` (absolute
  https, CSS-breaker-free), carries `referrerpolicy="no-referrer"`, and `onerror` degrades to the
  gradient (healCover precedent).
- **Pitfall 1 (DoS/500)** — all four sites deleted; both `%` URLs verified 200 live; two unit
  assertions pin them, each observed failing with `URIError` first.
- **T-gln-02 (XSS)** — `og:type` values come from the closed `OgType` union and reach the DOM only
  through `PageOg`'s `content={…}` binding.
- **T-{30}-SC** — zero packages installed.

No new security-relevant surface: no new route, endpoint, auth path or schema. The one new rendered
input (`data.og.image`) is strictly narrower than what already shipped in the `og:image` meta tag.

## User Setup Required

None.

## TDD Gate Compliance

Task 1 ran a real RED → GREEN cycle visible in `git log`: `test(30-05) e2234ac` →
`fix(30-05) 0412e6e`. The RED was observed failing with `URIError: URI malformed` — a reproduction of
the live production 500, not a module-resolution failure. No REFACTOR commit was needed. Task 2 was
not marked `tdd="true"` (a markup/comment change with no unit-testable logic; verified by `curl`
against the server HTML instead).

## Next Phase Readiness

- **Ready for 30-06.** All four share surfaces (2 legacy + 2 carrier-free) now emit a correct,
  distinct `og:type` and a real `og:image` on whatever origin serves the request, so the deploy
  checkpoint can validate real crawler cards for all of them.
- **For 30-06's UAT list, add:** (a) does the carrier-free `/artist/{name}` page actually resolve the
  artist when the name arrived hyphenated (the deferred item), and (b) the legacy song page `<img>`
  on-device.
- **No open plan work.** OG-COMPAT-01 and OG-PAGE-01 are complete; the phase's remaining plan is the
  deploy/verify checkpoint.

---
*Phase: 30-carrier-free-share-links-type-artist-title-api-og*
*Completed: 2026-08-07*

## Self-Check: PASSED

All 3 created test files + the SUMMARY exist on disk; all 3 task commits (`e2234ac`, `0412e6e`,
`cbba9fa`) resolve in `git log`.
