---
phase: 30-carrier-free-share-links-type-artist-title-api-og
plan: 01
subsystem: api
tags: [sveltekit, share-links, open-graph, url-encoding, path-segments, vitest]

# Dependency graph
requires:
  - phase: 24-readable-share-links
    provides: songShareUrl / entityCardUrl / buildOg / isHttpsUrl and the per-route SSR opt-in
provides:
  - encodePathSegment / decodePathSegment — the OG-PATH-01 path-segment codec (EMPTY + DOT-ONLY guards)
  - ogImageUrl — own-origin /api/og card-image URL builder (pure, SSR-importable)
  - OgType union + buildOg gaining an optional per-surface `type` (defaults to music.song)
  - carrier-free songShareUrl (/song/{artist}/{title}) and entityCardUrl (/album/{artist}/{name}, /artist/{name})
  - share-time zhs->zht conversion removed from all three share surfaces (OG-ZH-01)
affects: [30-02, 30-03, 30-04, 30-05, 30-06]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Path segments (not query params) carry the authoritative title+artist identity"
    - "Encode/decode pair lives beside slugify in share.ts — one pure SSR-importable module, no new file"
    - "Test round-trips are asserted THROUGH SvelteKit's single decode (decodeSeg helper), never encode->decode directly"

key-files:
  created: []
  modified:
    - src/lib/services/share.ts
    - src/lib/services/share.test.ts
    - src/lib/components/TrackMenu.svelte
    - src/routes/(app)/album/[name]/+page.svelte
    - src/routes/(app)/artist/[name]/+page.svelte

key-decisions:
  - "Path segment codec placed in share.ts after slugify (PATTERNS §7) — not a new module"
  - "ogImageUrl is deliberately exempt from the isHttpsUrl carrier gate: it is an own-origin constructed URL, and T-24-08 is enforced server-side by /api/og's host allowlist"
  - "buildOg's `type` is optional with a 'music.song' default so no loader breaks mid-refactor"
  - "RESEARCH §B.7's `A  B` -> `A--B` cell contradicts §B.6's drafted encoder (`\\s+` -> one '-'); the code is authoritative, round-trip is 'A B' either way"

patterns-established:
  - "Carrier-free share URL: zero `?` on every share surface; identity rides path segments, cover rides /api/og"
  - "decodePathSegment NEVER calls decodeURIComponent (SvelteKit already decoded; a second decode 500s on a literal '%')"

requirements-completed: [OG-PATH-02, OG-ZH-01]

# Metrics
duration: 7min
completed: 2026-08-07
---

# Phase 30 Plan 01: Carrier-Free Share URL Emission Summary

**Share links became `/song/{artist}/{title}` with zero query carriers — a path-segment codec (case-preserving, CJK/emoji-safe, EMPTY + DOT-ONLY guarded) replaced `?n=&a=&c=`, `dn`/`da` and share-time zhs→zht conversion were deleted outright, and `buildOg` grew a per-surface `og:type`.**

## Performance

- **Duration:** 7 min
- **Started:** 2026-08-08T03:10:05Z
- **Completed:** 2026-08-08T03:17:20Z
- **Tasks:** 2 (Task 1 TDD: RED + GREEN)
- **Files modified:** 5

## Accomplishments

- `encodePathSegment` / `decodePathSegment` shipped verbatim from RESEARCH §B.6 including both load-bearing guards — an empty segment (404s without the `-` guard) and a dot-only segment (WHATWG normalizes `.`/`..` away, live-verified 404).
- Every §B.7 stress row round-trips exactly (CJK, emoji, RTL, `/`, `%`, `#`, `?`, `+`, dot-only, empty), asserted through SvelteKit's single decode rather than a naive encode→decode.
- §B.8 `matchKey` invariance pinned: `matchKey('Post Malone', roundTrip('Spider-Man')) === matchKey('Post Malone', 'Spider-Man')` — the exact-insensitivity the whole hyphen↔space scheme rests on.
- `ogImageUrl(origin, type, artist, title?)` — pure own-origin `/api/og` builder for the loaders in later plans; JSDoc records why it bypasses the `isHttpsUrl` carrier gate.
- `OgType` union + optional `buildOg.type` defaulting to `'music.song'` (OG-PAGE-01 groundwork, zero caller breakage).
- All three share surfaces emit carrier-free URLs; `n`, `a`, `c`, `artist`, `dn`, `da` are gone, and `s2tConvertLines` / `isChineseLine` / `effectiveTarget` / `readCoverByUidOrName` imports were removed where they became unused.

## Task Commits

1. **Task 1 (TDD RED): failing codec / ogImageUrl / og:type specs** — `5132cdd` (test)
2. **Task 1 (TDD GREEN): codec + ogImageUrl + OgType + buildOg type** — `1f5c343` (feat)
3. **Task 2: carrier-free builders + three call sites + §F.20 test rewrite** — `419ead7` (feat)

No REFACTOR commit — the drafted functions were already in final shape.

## Files Created/Modified

- `src/lib/services/share.ts` — codec after `slugify`; `OgType` + `ogImageUrl` before `buildOg`; `buildOg` returns `type`; `songShareUrl` / `entityCardUrl` rewritten carrier-free with corrected (never deleted) `DQ-1`/`DQ-2`/`quick-260723-r4p`/`quick-260723-ry1` decision refs.
- `src/lib/services/share.test.ts` — new `encodePathSegment/decodePathSegment`, `ogImageUrl` and `og:type` blocks; `songShareUrl`/`entityCardUrl` blocks rewritten per §F.20; `slugify`, `entityShareUrl`/`parseEntityParam`, `encodeShare`/`decodeShare`, `shareUrl`, `buildOg`/`isHttpsUrl` blocks untouched.
- `src/lib/components/TrackMenu.svelte` — `doShare` calls `songShareUrl({ title, artist })`; both s2t blocks and the `readCoverByUidOrName` read deleted; `nav.share` title now built from the raw track fields.
- `src/routes/(app)/album/[name]/+page.svelte` — `shareAlbum` calls `entityCardUrl({ type: 'album', name, artist: albumArtist })`; `busyAction` guard + share/clipboard branch verbatim.
- `src/routes/(app)/artist/[name]/+page.svelte` — `shareArtist` calls `entityCardUrl({ type: 'artist', name })`; `settings` import kept (still used by `preferredSource`), `effectiveTarget` dropped.

## Decisions Made

- **`ogImageUrl` bypasses `isHttpsUrl` by design.** The gate exists for a sharer-supplied cover URL; this is a URL we construct on our own origin. The SSRF posture (T-24-08) is enforced one layer down by `/api/og`'s per-tier host allowlist. Recorded in the JSDoc so a later reader does not "fix" it.
- **OG-ZH-01 implemented as removal + assertion, not investigation.** `not.toContain('dn=')` / `not.toContain('da=')` now guard it in tests, and no `zh-convert` import remains in any share path.
- **The `'-'` empty guard replaces `slugify(...) || 's'`.** `'-'` decodes to `''` so a loader's "no name → fall back" branch still fires; `'s'` would have become a bogus literal OG title.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] RESEARCH §B.7's `A  B` → `A--B` expectation contradicts §B.6's drafted encoder**

- **Found during:** Task 1 (TDD GREEN — the only failing assertion after implementing)
- **Issue:** The plan's `<action>` says to ship §B.6's encoder verbatim, and that encoder collapses a whitespace *run* to ONE hyphen (`/\s+/g → '-'`). §B.7's stress table row for a double space claims the encoded form is `A--B`, which only a per-character mapping would produce. My RED test transcribed the table, so it failed against the correct code.
- **Fix:** Kept the drafted encoder unchanged (it is the authority per the plan) and corrected the test expectation to `A-B`, with an inline comment naming the doc inconsistency. The decoded result is `A B` either way, so no behavior question was at stake.
- **Files modified:** `src/lib/services/share.test.ts`
- **Verification:** `pnpm vitest --run src/lib/services/share.test.ts` → 52 passed; `decodePathSegment('A--B') === 'A B'` retained separately so a hand-typed double-hyphen URL is still covered.
- **Committed in:** `1f5c343` (Task 1 GREEN commit)

---

**Total deviations:** 1 auto-fixed (1 bug — a research-doc/code inconsistency, resolved in favour of the code).
**Impact on plan:** None on scope or behavior. No production code changed as a result.

## Assumption Drift (advisory)

**1. Acceptance-criterion grep for `decodeURIComponent` counts comments, not calls**

- **Found during:** Task 1
- **Planned:** `grep -c 'decodeURIComponent' src/lib/services/share.ts` must not increase vs HEAD (proving `decodePathSegment` does not decode).
- **Actual:** The count went 2 → 3. The third line is `decodePathSegment`'s own JSDoc sentence *"`seg` is ALREADY decodeURIComponent'd by SvelteKit"* — required verbatim by the same task. The only real call in the file remains `fromBase64Url` at `share.ts:27`; `decodePathSegment`'s body is a single `.replace(/-+/g, ' ').trim()`.
- **Why it matters:** the criterion's intent is satisfied, its literal form is not satisfiable while also shipping the mandated JSDoc. A later plan reusing this grep should scope it to non-comment lines.

## Issues Encountered

None beyond the deviation above. `pnpm check` stayed at 0 errors / 0 warnings throughout, which is what proved all three call sites were updated (the signature narrowing would have failed the whole-project typecheck otherwise).

## Verification Performed (observed output, not inferred)

| Gate | Command | Observed |
|---|---|---|
| Plan test file | `pnpm vitest --run src/lib/services/share.test.ts` | `Test Files 1 passed (1) / Tests 52 passed (52)` |
| Typecheck | `pnpm check` | `COMPLETED 4346 FILES 0 ERRORS 0 WARNINGS 0 FILES_WITH_PROBLEMS` |
| Full suite | `pnpm test` | `Test Files 82 passed (82) / Tests 1380 passed (1380)` (baseline 82 / 1373) |
| No s2t in share paths | `grep -n 's2tConvertLines\|isChineseLine\|effectiveTarget' <3 call sites>` | no matches |
| Decision refs preserved | `grep -c 'quick-260723-r4p' / 'quick-260723-ry1' share.ts` | 2 and 2 |
| Out-of-scope bodies untouched | `git diff -U0 src/lib/services/share.ts` | all hunks inside `songShareUrl` / `entityCardUrl` only |

**Not verified here (out of this plan's scope):** no `curl` / browser check was run — the emitted two-segment URLs 404 until plan 30-04 creates the routes, which is the expected wave state.

## Known Stubs

None. Every function added is fully implemented; `ogImageUrl` has no consumer yet by design (plans 30-04/30-05 wire it into the loaders).

## Threat Flags

None. The change strictly tightens T-24-08 (a sharer-supplied https URL carrier is deleted, replaced by path text), and T-30-01's tampering surface is the codec, whose guards and `encodeURIComponent` behavior are now pinned by tests. No new endpoint, auth path, file access, or schema surface was introduced.

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness

- **Ready for wave 2.** `encodePathSegment` / `decodePathSegment` / `ogImageUrl` / `OgType` are exported and green — the new route loaders (30-04) and the legacy-loader fixes (30-05) can import them directly.
- **Expected transient state:** emitted share URLs 404 until 30-04 lands the `/song/[artist]/[title]` and `/album/[artist]/[name]` routes. This is by plan design, not a regression.
- **For 30-05:** the `artist/[name]/+page.svelte:464` in-app album `goto()` still emits the legacy one-segment `?artist=` shape. It keeps working (legacy route is LOCKED to stay), but RESEARCH §F.19 recommends updating it so in-app nav exercises the new loader.
- **For 30-04:** `PageOg.svelte` still hardcodes `og:type = music.song`; `buildOg` now supplies the value, so PageOg only needs to read it.

---
*Phase: 30-carrier-free-share-links-type-artist-title-api-og*
*Completed: 2026-08-07*

## Self-Check: PASSED

All 5 modified files exist on disk; all 3 task commits (`5132cdd`, `1f5c343`, `419ead7`) resolve in `git log`.
