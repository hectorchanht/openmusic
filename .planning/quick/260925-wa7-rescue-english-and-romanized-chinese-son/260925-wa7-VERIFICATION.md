---
phase: quick-260925-wa7
verified: 2026-09-25T23:52:00Z
status: passed
score: 8/8 must-haves verified
has_blocking_gaps: false
overrides_applied: 0
---

# Quick Task 260925-wa7: Rescue English / romanized Chinese-song names in resolveStub — Verification Report

**Task Goal:** Rescue English / romanized names of Chinese songs in the shared name resolver
`resolveStub` (`src/lib/services/discovery.ts`) via a verified English→Chinese name lookup
(YouTube Music edge search hl=en+zh-TW joined by videoId, then client-side iTunes HK/US
cross-store by trackId), triggered only when the first resolve misses or is weak, then
re-resolving with the Chinese names — so "Coral Sea / Jay Chou" plays 珊瑚海 / 周杰倫. Zero extra
calls on the good-match path; never make a resolve worse.

**Verified:** 2026-09-25
**Status:** passed
**Re-verification:** No — initial verification

## Goal Achievement

### Observable Truths (from PLAN frontmatter `must_haves.truths`)

| # | Truth | Status | Evidence |
|---|-------|--------|----------|
| 1 | Graduation ("Mom, Don't Do That!" ...) / Eric Chou, weak first hit → lookup → Simplified re-search → strong CN row | ✓ VERIFIED | `discovery.test.ts:269-282` pins searchAll=2, lookup=1, second query literally `'周兴哲 最后一堂课'`, returns rescued row. Read `src/lib/services/discovery.ts:107-150` (`resolveStub`/`rescueLatin`) confirms the gate/re-search/accept-filter wiring. |
| 2 | Coral Sea / Jay Chou: YTM stage rejects (no English in 珊瑚海), iTunes HK↔US stage accepts | ✓ VERIFIED | `name-rescue.test.ts:99-103` (`pairYtmRows` → null for Coral Sea) + `:170-180` (`pairItunes` → `{周杰倫,珊瑚海}`). **Independently reproduced live** against the running dev server (`:5173`, real YTM+iTunes upstreams): `resolveStub('Jay Chou','Coral Sea')` → `{title:'珊瑚海', artist:'周杰伦', source:'qq'}`. |
| 3 | Normal English hit costs exactly 1 searchAll + 0 lookups; JA/KO/ZH never enter rescue; t2s path unchanged | ✓ VERIFIED | `discovery.test.ts:229-247` (lullaboy, Bones & The Boy — search=1/lookup=0), `:344-374` (Japanese kana gate, mixed Latin/CJK gate — lookup=0), `:353-365` (existing quick-260808-urx t2s block untouched, still green, lookup=0). All ran green in my own `pnpm test` execution (3301/3301 passed). |
| 4 | Rescue never makes a resolve worse (lookup miss, unrelated re-search row, empty re-search, thrown re-search all fall back to original/weak hit) | ✓ VERIFIED | `discovery.test.ts:309-342` — 3 distinct fallback branches (unrelated row, empty result, thrown search) all assert the original weak `nct()` row is returned; `resolveStub` line 116: `(await rescueLatin(...).catch(() => null)) ?? hit`. |
| 5 | Lookup outcomes cached in `openmusic:name-rescue:v1`, shape-guarded, size-capped, try/catch, node-safe | ✓ VERIFIED | `src/lib/services/name-rescue.ts:199-250` (`loadRecord`/`readRescueCache`/`writeRescueCache`) + `name-rescue.test.ts:232-311` (round-trip, 30d/1d TTL, 500-cap eviction, malformed JSON, no-localStorage-in-node all pass). |
| 6 | `GET /api/ytmusic/search?hl=zh-TW` posts `hl=zh-TW,gl=TW`; any other value posts `en/US`; allowlist is pure+tested; raw `hl` never reaches upstream | ✓ VERIFIED | `src/lib/proxy/ytmusic-innertube.ts:53-58` (`innerTubeLocale`, exact-key `hasOwnProperty` check) + `ytmusic.test.ts:214-249`. **Live curl** against `:5173`: `?hl=zh-TW` response contains `周興哲` 78×; `?hl=en` contains `Zai Ai Ni` 24×. |
| 7 | itunes.apple.com called ONLY from the browser, through `apiFetch` (32-D-13 passthrough), bounded timeout | ✓ VERIFIED | `grep itunes.apple.com src/lib/proxy src/routes/api` returns only pre-existing, unrelated `og-cover.ts` edge references (predates this task — confirmed via `git log` these are not new). The new calls live only in `src/lib/services/name-rescue.ts` (a `$lib/services/*` module, never imported by `$lib/proxy/*` or `src/routes/api/*`), routed through `apiFetch` + `combinedSignal(6000)`. |
| 8 | `pnpm test`, `pnpm check`, `pnpm build` green after every commit | ✓ VERIFIED | Independently re-ran all three myself (not trusting SUMMARY): `pnpm test` → 152 files / 3301 tests passed; `pnpm check` → 4604 files, 0 errors/0 warnings; `pnpm build` → cloudflare adapter build succeeded. |

**Score:** 8/8 truths verified

### Required Artifacts

| Artifact | Expected | Status | Details |
|----------|----------|--------|---------|
| `src/lib/proxy/ytmusic-innertube.ts` | `innerTubeLocale` allowlist | ✓ VERIFIED | Present, exact-key allowlist, own-property guard against `constructor`/`__proto__`. |
| `src/lib/proxy/ytmusic.ts` | 4-arg `searchInnerTube` with locale | ✓ VERIFIED | `locale` param builds `{...WEB_REMIX_CONTEXT.client, hl, gl}`; no-locale path posts the identical `WEB_REMIX_CONTEXT` object reference (byte-identical old behavior, tested). |
| `src/routes/api/ytmusic/search/+server.ts` | reads `?hl=`, allowlists, passes to both filter POSTs | ✓ VERIFIED | `innerTubeLocale(url.searchParams.get('hl'))` passed to both `searchInnerTube` calls; helper correctly lives in `$lib/proxy/*`, not the `+server.ts` (SvelteKit verb-only-export constraint respected). |
| `src/lib/services/name-rescue.ts` | pure predicates, pairing, cache, orchestrator | ✓ VERIFIED | 332 lines (≥150 min). All required exports present: `isStrongMatch`, `cleanTitle`, `pairYtmRows`, `pairItunes`, `lookupChineseName`, `NAME_RESCUE_KEY`. |
| `src/lib/services/name-rescue.test.ts` | fixture tests from live probes | ✓ VERIFIED | 463 lines. Every CONTEXT fixture (Zai Ai Ni, Graduation, Coral Sea, Mojito, The Actor, MUST-REJECT pairs) present and passing. |
| `src/lib/services/discovery.ts` | `resolveStub` gate → `lookupChineseName` → re-attempt | ✓ VERIFIED | Contains `lookupChineseName`; gate logic at lines 107-150 matches the PLAN's Gate A/B design. |
| `src/lib/services/discovery.test.ts` | `quick-260925-wa7` describe block | ✓ VERIFIED | Present at line 224, 13 test cases covering every behavior bullet. |
| `src/lib/services/match-key.ts` | `export function norm` | ✓ VERIFIED | Line 24, no behavior change (pre-existing body untouched). |
| `src/lib/sources/ytmusic.ts` | `export function parseSearchEnvelope` | ✓ VERIFIED | Line 173, no behavior change. |

### Key Link Verification

| From | To | Via | Status | Details |
|------|-----|-----|--------|---------|
| `discovery.ts` | `name-rescue.ts` | `lookupChineseName(` call, gated on CJK-free + weak/miss | ✓ WIRED | Imported line 18, called line 143 inside `rescueLatin`, itself called only when `latin` gate true and hit is null/weak (line 116). |
| `name-rescue.ts` | `/api/ytmusic/search?hl=en\|zh-TW` | two parallel `apiFetch` GETs joined by videoId via `parseSearchEnvelope` | ✓ WIRED | `lookupChineseName` lines 304-306; live-verified via curl and via my own live vitest probe. |
| `name-rescue.ts` | `itunes.apple.com/search+/lookup` | `apiFetch` (32-D-13 absolute passthrough) + `combinedSignal` | ✓ WIRED | Lines 309-322; client-side only (confirmed no proxy/edge import path). |
| `+server.ts` | `ytmusic.ts searchInnerTube` | locale from `innerTubeLocale(...)` passed to both filter POSTs | ✓ WIRED | Lines 38, 56-57, exact literal match to PLAN's pattern. |
| `name-rescue.ts` | `match-key.ts` | `norm()` sole normalizer for containment + cache key | ✓ WIRED | `import { matchKey, norm } from '$lib/services/match-key';` line 13, exact match. |

### Behavioral Spot-Checks

| Behavior | Command | Result | Status |
|----------|---------|--------|--------|
| `hl=zh-TW` reaches InnerTube and returns zh-TW-localized rows | `curl :5173/api/ytmusic/search?q=Eric+Chou+Zai+Ai+Ni&hl=zh-TW \| grep -c 周興哲` | 78 | ✓ PASS |
| `hl=en` (default) still returns the English/bilingual rows | `curl :5173/api/ytmusic/search?q=Eric+Chou+Zai+Ai+Ni&hl=en \| grep -c "Zai Ai Ni"` | 24 | ✓ PASS |
| `resolveStub` end-to-end rescue (live, real upstreams, no mocks) | vitest w/ `VITE_API_BASE=http://localhost:5173`, `resolveStub('Jay Chou','Coral Sea')` | `{title:'珊瑚海', artist:'周杰伦', source:'qq'}` | ✓ PASS |
| `resolveStub` end-to-end rescue, second example | `resolveStub('Joker Xue','The Actor')` | `{title:'演员 (Live)', artist:'薛之谦/阿兰/刘宇宁/白举纲/袁成杰', source:'netease'}` | ✓ PASS |
| Targeted unit suites (name-rescue, discovery, ytmusic proxy/source, match-key) | `pnpm vitest --run <5 files>` | 115/115 passed | ✓ PASS |
| Full test suite | `pnpm test` | 152 files / 3301 tests passed | ✓ PASS |
| Type/lint gate | `pnpm check` | 4604 files, 0 errors, 0 warnings | ✓ PASS |
| Production build | `pnpm build` | Cloudflare adapter build succeeded | ✓ PASS |

All spot-checks run against the pre-existing dev server on `:5173` (not killed); no mutation of app state; ephemeral probe test file created and deleted after use, `git status` confirmed clean afterward.

### Probe Execution

Not applicable — no `scripts/*/tests/probe-*.sh` declared or implied by this quick task's PLAN/SUMMARY. Skipped.

### Deviations Assessed (from SUMMARY)

| # | Deviation | Judgment |
|---|-----------|----------|
| 1 | YTM pass-2 now requires a YouTube-mapped artist on another row of the same response (blocks uploader covers) | **Accepted — correct fix, not a gap.** Live-probe-driven: without this, a bilingual uploader cover title (`周杰倫 Jay Chou & 梁心頤 Lara 珊瑚海 Coral Sea 純鋼琴 / 張義 YImuzic`) would short-circuit stage 2 (which finds the actually-correct pairing) and could poison the 30-day cache with a wrong pair. Verified via `name-rescue.test.ts` fixtures for both the accept case (Mojito, `v9` localizing row) and the reject case (uploader cover). |
| 2 | `attempt()` takes an optional candidate filter so the re-search ranks only strong-matching rows | **Accepted — correct fix, not a gap.** A top-row-only check would have discarded a real strong CN row that lost a scoreMatch tie to a cover/variant (reproduced live: Coral Sea with QQ absent). Existing call sites (`attempt(artist,title)` with no 3rd arg, lines 109/125) are unchanged — confirmed by direct code read. Regression-guarded by `discovery.test.ts:294-307` ("the re-search ranks only strong rows"). |
| 3 | A throwing re-search returns the original weak match, not null | **Accepted — matches the truth "never make a resolve worse" more literally than the PLAN's "null-or-original" wording.** `resolveStub` line 116 codifies this: `(await rescueLatin(...).catch(() => null)) ?? hit`. Tested at `discovery.test.ts:333-342`. |
| 4 | `discovery.test.ts` stubs `lookupChineseName` to null globally via `beforeEach` | **Accepted — sound test hygiene, not a gap.** Prevents pre-existing Latin-miss tests (e.g. Adele/Hello) from making real network calls now that a Latin miss enters the rescue path; each new rescue-specific test re-programs the spy per case. Confirmed the stub is scoped to this one test file only (not global to the suite). |

### Requirements Coverage

Not applicable — this is a `/gsd-quick` task (no `.planning/REQUIREMENTS.md` entry expected or found for `quick-260925-wa7`).

### Anti-Patterns Found

None. `TBD|FIXME|XXX|TODO|HACK|PLACEHOLDER` grep across all 10 modified files: zero real matches (only comment prose that happens to contain the literal substrings, e.g. documenting "no `as any`"). No `as any` casts introduced. No empty stub implementations, no hardcoded-empty return paths feeding a render surface (this is a non-UI service/logic change).

### Human Verification Required

None. This is a backend/service-logic quick task with no UI surface change (CONTEXT explicitly scoped display-surface changes as "NOT required"). Live network behavior was independently reproduced against real upstreams (YouTube Music InnerTube + iTunes + QQ/Netease) in this verification, which is stronger evidence than a human manually tapping through the UI would provide for this specific mechanism.

### Advisory Note (non-blocking, carried from SUMMARY)

The executor's "Assumption Drift" note is accurate and does not block this task: for "Eric Chou / Zai Ai Ni" and "Eric Chou / Graduation" specifically, the `ytmusic` source's own row in the normal `searchAll` fan-out is *already* a strong bilingual match, so the rescue does not fire for those two exact queries in production (it does fire, and was independently reproduced here, for "Coral Sea" and "The Actor"). Whether `resolveStub` should down-rank `ytmusic`-sourced rows (given the documented googlevideo/web-playback 403 risk) is a pre-existing, out-of-scope architectural question — not a regression or gap introduced by this task.

## Gaps Summary

None. All 8 must-have truths verified, all 9 artifacts verified at exists/substantive/wired levels, all 5 key links wired, all 4 executor-flagged deviations judged as correct fixes backed by regression tests, full `pnpm test`/`pnpm check`/`pnpm build` gate independently re-run and green, and the core "Coral Sea → 珊瑚海/周杰伦" and "The Actor → 演员/薛之谦" rescues were independently reproduced live against real upstreams (not just trusted from SUMMARY narration).

---

_Verified: 2026-09-25T23:52:00Z_
_Verifier: Claude (gsd-verifier)_
