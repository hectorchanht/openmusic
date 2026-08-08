---
phase: 30-carrier-free-share-links-type-artist-title-api-og
plan: 04
subsystem: web
tags: [sveltekit, routing, ssr, open-graph, loader-tests, capacitor, vitest, tdd]

# Dependency graph
requires:
  - phase: 30-carrier-free-share-links-type-artist-title-api-og
    plan: 01
    provides: "decodePathSegment / ogImageUrl / OgType / buildOg({ type })"
  - phase: 30-carrier-free-share-links-type-artist-title-api-og
    plan: 03
    provides: "the live GET /api/og streaming cover endpoint og:image now points at"
provides:
  - "/song/{artist}/{title} — carrier-free SSR song share route (loader + landing page)"
  - "/album/{artist}/{name} — carrier-free SSR album OG landing that forwards to the legacy album page"
  - "PageOg emits request-origin og:url/og:image and a per-surface og:type"
  - "The repo's first two +page.ts loader tests (the Wave 0 loader-test gap for the NEW routes)"
affects: [30-05, 30-06]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Loader test: import { load, ssr, prerender } from './+page' with a hand-built { params, url } event and ALREADY-DECODED params"
    - "og:image is spliced OVER buildOg's result (never passed as `cover`) so an own-origin /api/og URL survives the isHttpsUrl carrier gate on an http origin"
    - "SSR OG landing + browser-guarded replaceState goto: one crawler-facing route, zero duplication of the real page"
    - "In-app cover <img> goes through apiUrl(); data.og.image stays meta-tag-only (APK origin is https://localhost)"

key-files:
  created:
    - src/routes/(app)/song/[artist]/[title]/+page.ts
    - src/routes/(app)/song/[artist]/[title]/+page.svelte
    - src/routes/(app)/song/[artist]/[title]/loader.test.ts
    - src/routes/(app)/album/[artist]/[name]/+page.ts
    - src/routes/(app)/album/[artist]/[name]/+page.svelte
    - src/routes/(app)/album/[artist]/[name]/loader.test.ts
  modified:
    - src/lib/components/PageOg.svelte

key-decisions:
  - "The new album route is an SSR OG LANDING that replaceState-forwards to the one existing album page, not a second album implementation"
  - "Because of that redirect, the in-app album nav (artist/[name]/+page.svelte:464) deliberately STAYS on the legacy ?artist= shape — repointing it would double-hop (deviates from RESEARCH Open Question 2 / Pitfall 10's recommendation)"
  - "The <img> src is built from data.artist/data.name via apiUrl(), not from data.og.image (Pitfall 7)"
  - "PageOg keeps SITE_FALLBACK for an empty origin only; og:image stays ABSOLUTE because crawlers reject a relative one"

patterns-established:
  - "A +page.ts is unit-testable iff it is synchronous, fetch-free, and imports ./$types type-only — treat those as loader design constraints, not test conveniences"

requirements-completed: [OG-PATH-01, OG-PAGE-01]

# Metrics
duration: 7min
completed: 2026-08-08
---

# Phase 30 Plan 04: Carrier-Free Route Pair + PageOg Fix Summary

**`/song/{artist}/{title}` and `/album/{artist}/{name}` now SSR-render a complete, correct OG card from path text alone — pointed at the live `/api/og` cover on whatever origin served the request — and `PageOg` stopped hardcoding `openmusic.lol` and `og:type = music.song`.**

## Performance

- **Duration:** 7 min (03:48:26Z → 03:55:42Z)
- **Tasks:** 3/3 (Task 1 plain; Tasks 2 and 3 each RED → GREEN)
- **Files:** 6 created, 1 modified

## What Was Built

### Task 1 — `PageOg.svelte` (`48cf6a0`)

- `SITE_FALLBACK = 'https://openmusic.lol'` retained **only** as the empty-origin fallback;
  `origin = $derived(page.url.origin || SITE_FALLBACK)` now drives both `og:url` and the `/og.svg`
  image fallback, so a share from a preview / `pages.dev` deploy emits same-origin absolute values.
  Folds the `pageog-hardcoded-site-origin.md` todo.
- Prop widened to `{ title; description; image: string | null; type?: OgType }` (`import type` from
  `$lib/services/share`) and `og:type` is now `content={og.type ?? 'music.song'}` — the default
  means zero callers needed changing, and every unconverted route emits the identical card.
- Every value still bound via `content={...}` (T-gln-02 preserved, 2 references). No
  `og:image:width/height` added (§D.15 — the streamed cover is square). New lines single-quoted per
  CLAUDE.md; the file's existing double-quoted lines were left alone (§6 style deviation).
- `+layout.svelte`'s own hardcoded-`SITE` bug was NOT touched (logged out-of-scope todo).

### Task 2 — `/song/[artist]/[title]` (RED `ea819c9` → GREEN `39b387e`)

`+page.ts`: `ssr = true` / `prerender = false`, a **synchronous, fetch-free** `load` reading
`decodePathSegment(params.artist)` / `decodePathSegment(params.title)`. Five header blocks restate
D-01/D-03 (universal `+page.ts`, never `+page.server.ts` — Pitfall 5 / T-24-09), T-24-08 (no fetch;
`og:image` is an own-origin URL emitted into a meta tag), and Pitfall 1 (params arrive already
decoded). OG is `{ ...buildOg({ title: title || 'openmusic', artist: artist || undefined, type: 'music.song' }), image: ogImageUrl(url.origin, 'song', artist, title) }`
— the splice is deliberate and documented: `buildOg`'s `cover` input is `isHttpsUrl`-gated and would
drop the image on an http dev origin. Returns `{ og, name: title, artist }`, the `[slug]` contract.

`+page.svelte`: near-copy of `song/[slug]/+page.svelte` — same SSR-safety-by-construction header and
import discipline (`PageOg`, `browser`, `onMount`, `PageData`, plus pure store-free `apiUrl`), same
`resolveAndPlay` including the `pendingTrack` supersede-vs-miss nuance and the lazy `player`/`t`
imports. The cover block became:

```svelte
<img class="cover" src={coverSrc} alt="" onerror={() => (coverFailed = true)} />
```

with `coverSrc = $derived(apiUrl('/api/og?type=song&artist=…&title=…'))` built from
`data.artist`/`data.name`, **not** `data.og.image` (Pitfall 7 — the APK WebView origin is
`https://localhost`), and `coverFailed` flipping to the pre-existing `.cover--placeholder` gradient.

`loader.test.ts`: the repo's first loader test — 9 `it()` blocks over the opt-ins, the `50% Off`
literal-`%` passthrough, hyphen↔space, CJK/emoji/RTL, the `'-'` empty guard, `music.song`, and
`og.image` on both an https and an **http** origin.

### Task 3 — `/album/[artist]/[name]` (RED `7621e57` → GREEN `6b9d347`)

Loader is the same species (sync, fetch-free, no `decodeURIComponent`), `type: 'music.album'`, and
passes BOTH segments so the card reads `Name • Artist` like the legacy album card (RESEARCH Open
Question 4). Returns `{ og, name, artist }`.

Page is an **SSR OG landing**, documented in its header as a planner decision: it emits the head
plus a minimal title block, then in `onMount` under a `browser` guard calls
`goto('/album/' + encodeURIComponent(name) + (artist ? '?artist=' + … : ''), { replaceState: true })`,
handing the recipient to the ONE existing ~1000-line album implementation rather than duplicating
tracklist / enrich / download / share. Crawlers never run JS, so they keep the SSR head.

`loader.test.ts`: 9 `it()` blocks — CJK `范特西 • 周杰倫`, the `'-'` empty-artist guard decoding to
`''`, literal `%`, hyphen↔space, emoji, fully-empty segments, `music.album`, and the request-origin
`/api/og?type=album` image on https and http.

## Verification — commands actually run, with observed output

| Gate | Command | Observed |
|---|---|---|
| Task 1 typecheck | `pnpm check` | `4352 FILES 0 ERRORS 0 WARNINGS` |
| Task 1 suite | `pnpm test` | `84 passed (84)` files / `1447 passed (1447)` — baseline held exactly |
| Task 2 RED | `pnpm vitest --run '…/song/[artist]/[title]/loader.test.ts'` | `1 failed`, `Failed to load … './+page'` |
| Task 2 GREEN | same | `1 passed`, `9 passed (9)` |
| Task 3 RED | `pnpm vitest --run '…/album/[artist]/[name]/loader.test.ts'` | `1 failed`, cannot resolve `./+page` |
| Task 3 GREEN | same | `1 passed`, `9 passed (9)` |
| Typecheck (final) | `pnpm check` | `4362 FILES 0 ERRORS 0 WARNINGS 0 FILES_WITH_PROBLEMS` |
| Full suite (final) | `pnpm test` | `86 passed (86)` files / `1465 passed (1465)` — +2 files, +18 tests, zero regressions |
| Web build | `pnpm build` | `✓ built in 6.03s`, `@sveltejs/adapter-cloudflare ✔ done`, exit 0 |
| Native build | `pnpm build:native` | `@sveltejs/adapter-static  Wrote site to "build"  ✔ done`, exit 0 |
| Loader is sync | `grep -c 'async' '…/song/[artist]/[title]/+page.ts'` / album | `0` / `0` |
| No param re-decode | `grep -c 'decodeURIComponent(params' '…/album/[artist]/[name]/+page.ts'` | `0` |
| APK-safe img | `grep -c 'apiUrl' '…/song/[artist]/[title]/+page.svelte'` / `grep -c 'src={data.og.image}'` | `5` / `0` |
| PageOg criteria | `grep -c 'page.url.origin'` / `'og:image:width'` / `'T-gln-02'` | `1` / `0` / `2` |
| No accidental deletions | `git diff --diff-filter=D --name-only HEAD~1 HEAD` (each commit) | empty |

### Live corroboration — **resolved port `http://localhost:5173`**

Resolved with the mandated probe (`DEV=http://localhost:4321; curl -sf -o /dev/null "$DEV" || DEV=http://localhost:5173`).
`:4321` was not listening; a dev server was already serving `:5173`.

| Request | Observed |
|---|---|
| `GET /song/Nirvana/Come-As-You-Are` | `og:title "Come As You Are • Nirvana"` (count 1), `og:type music.song`, `og:url http://localhost:5173/song/Nirvana/Come-As-You-Are`, `og:image http://localhost:5173/api/og?type=song&artist=Nirvana&title=Come%20As%20You%20Are` |
| same, `<img>` in the SERVER html | `<img class="cover svelte-gbheny" src="/api/og?type=song&artist=Nirvana&title=Come%20As%20You%20Are" alt="" onerror=…>` — relative on web, i.e. `apiUrl()`-routed |
| `GET /song/A/B/C` | `404` (strictly 2 segments) |
| `GET /song/come-as-you-are-nirvana?n=…&a=…` (legacy) | `200`, and its `og:url` now reads `http://localhost:5173/...` — the PageOg origin fix, observed on the legacy surface |
| `GET /album/周杰倫/范特西` (percent-encoded) | `og:title "范特西 • 周杰倫"`, `og:type music.album`, `og:image …/api/og?type=album&artist=%E5%91%A8…&title=%E8%8C%83…` |
| `GET /album/Nirvana/Nevermind` | `200`; `grep -c 'og:type'` = **1**, value `music.album` |
| `GET /album/Nevermind?artist=Nirvana` (legacy) | `200` — coexistence holds |
| `GET /album/A/B/C` | `404` |
| `GET /album/Post-Malone/50%25%20Off` | `200` — the new loader does not double-decode (the legacy `/album/{name}` shape still 500s on this; 30-05 owns that fix) |

**Not verified here (no environment for it):**

- **Client-side resolve-and-play on the new song page.** `resolveAndPlay` is a verbatim mirror of the
  `[slug]` page and typechecks, but `playStub` fans out to the CN Meting hosts, which are unreachable
  from this sandbox (`sandbox-no-cn-upstream-network`), and there is no browser harness here. The
  playback claim is code-identity, not an observed run.
- **The APK `<img>`.** Proven only by construction (`apiUrl()` + `grep`); device UAT is 30-06's
  checkpoint.
- **Real crawler rendering** of these two heads (Facebook / WhatsApp / iMessage) — needs the deploy.

## Deviations from Plan

### Auto-fixed Issues

None. No bug, missing-critical-functionality or blocking issue was hit; all three tasks executed as
written.

### Plan-directed choices worth flagging (not deviations)

- **`og:image` is spliced over `buildOg`, not passed as `cover`.** The plan's `<interfaces>` block
  mandates this; RESEARCH's drafted Code Example does the opposite (`cover: image`), which
  `isHttpsUrl` would silently drop on an http dev origin. The plan wins, and the loader comment
  records why so a later reader does not "simplify" it back.
- **The album route redirects rather than duplicating**, and consequently
  `artist/[name]/+page.svelte:464` deliberately stays on the legacy `?artist=` shape (documented in
  the new page's header). This is the discretion CONTEXT delegates, and it knowingly declines
  RESEARCH Open Question 2 / Pitfall 10's "update the in-app nav too" recommendation — that would
  make every in-app album tap a double hop.

## Assumption Drift (advisory)

**1. `grep -c 'decodeURIComponent' <new song loader>` outputs 1, not 0**

- **Found during:** Task 2
- **Planned:** the acceptance criterion expects `0`, as the proof that the loader never re-decodes.
- **Actual:** `1`. The single hit is the header comment the same task mandates verbatim —
  *"params.artist/params.title are ALREADY decodeURIComponent'd by SvelteKit (decode_params, …)"*.
  Filtering comment lines gives `0` calls (`grep -vE '^\s*(//|\*|/\*)' … | grep -c` → `0`), and the
  album loader's narrower `grep -c 'decodeURIComponent(params'` criterion is `0` as written.
- **Why it matters:** identical to 30-01's advisory — this grep counts prose, not calls. A later plan
  reusing it (30-05 will, on the legacy loaders) should scope it to non-comment lines or match
  `decodeURIComponent(params`.

**2. The dev server was already running, on `:5173`**

- **Found during:** live corroboration
- **Planned:** criteria hardcode `:5173` while assuming the executor starts its own `pnpm dev`.
- **Actual:** the probe found an already-listening `:5173` and nothing on `:4321`; no server was
  started. Recorded so the port in the tables above is not read as a lucky assumption.

## Issues Encountered

None. `pnpm check` stayed at 0 errors / 0 warnings across all three tasks, and the untouched-caller
count is what proves PageOg's widened prop is genuinely optional (a required `type` would have failed
the whole-project typecheck at the four existing `<PageOg og={data.og} />` call sites).

## Deferred Issues

None new. The pre-existing items stay where they are: `+layout.svelte`'s hardcoded `SITE`
(out-of-scope todo), the Deezer artist-tier `picture_xl` size (30-02's file, already in
`deferred-items.md`), and the three legacy loaders' double-decode (30-05 owns it).

## Known Stubs

None. Both routes are fully wired: real OG heads, a real cover image, a real client resolve path, and
a real forward to the album implementation. The `.cover--placeholder` gradient is an intentional
error fallback, not a placeholder for unfinished work.

## Threat Flags

None beyond the plan's register, and every disposition is discharged:

- **T-24-08** — both loaders are synchronous and perform zero fetches; the only URL they emit is an
  own-origin `/api/og` string in a meta tag. `grep -c 'async'` = 0 in both.
- **T-gln-02** — `og:type` comes from the closed `OgType` union and every value stays
  `content={...}`-bound; no `{@html}` anywhere in `PageOg`.
- **T-24-09** — universal `+page.ts` only; no `+page.server.ts` exists, and `pnpm build:native`
  (adapter-static) exits 0 with both new dynamic routes present.
- **Pitfall 7** — the `<img src>` is `apiUrl()`-built; the SSR HTML shows a relative `/api/og?…`.
- **Pitfall 1** — zero `decodeURIComponent` calls on params; live `GET /album/Post-Malone/50%25%20Off`
  returns 200.
- **T-{30}-SC** — zero packages installed.

New surface introduced (two public SSR routes) is exactly the surface the `<threat_model>` enumerates,
and its only input is length-unbounded path text that never leaves the process except as
percent-encoded query values on an own-origin URL (`/api/og` itself caps input at 200 chars, 30-03).

## User Setup Required

None — no external service configuration required.

## TDD Gate Compliance

Both `tdd="true"` tasks ran a real RED → GREEN cycle, visible in `git log`:
`test(30-04) ea819c9` → `feat(30-04) 39b387e` → `test(30-04) 7621e57` → `feat(30-04) 6b9d347`. Each
RED was observed failing on module resolution of the not-yet-written `./+page` before the
implementation commit. No REFACTOR commit was needed — both loaders were in final shape.

## Next Phase Readiness

- **Ready for 30-05.** The correct loader species now exists twice in-repo, so the legacy fixes have a
  local template: delete `decodeURIComponent(params…)` at `album/[name]/+page.ts:22`,
  `artist/[name]/+page.ts:22` and `album/[name]/+page.svelte:50`, and set `og.type` to `music.album` /
  `profile` / `music.song` on the three legacy loaders (`PageOg` already reads it).
- **For 30-05's legacy loader tests:** copy `loader.test.ts`'s shape verbatim, including the
  already-decoded-params comment. The `%`-bearing assertion will fail before the decode deletion —
  that is the intended RED.
- **For 30-06:** the deploy checkpoint needs (a) real crawler cards for both new shapes, and (b) the
  APK `<img>` device check on `/song/{artist}/{title}`.
- **Open by design:** `artist/[name]/+page.svelte:464` still emits the legacy `?artist=` album link;
  that is the documented decision above, not an oversight.

---
*Phase: 30-carrier-free-share-links-type-artist-title-api-og*
*Completed: 2026-08-08*

## Self-Check: PASSED

All 7 source artifacts exist on disk; all 5 task commits (`48cf6a0`, `ea819c9`, `39b387e`,
`7621e57`, `6b9d347`) resolve in `git log`.
