---
phase: 25-zh-hant-offline-conversion-fallback-cascade
plan: 02
subsystem: api-proxy
tags: [translation, i18n, cascade, azure, deepl, google, cloudflare-edge, secrets, vitest]

# Dependency graph
requires:
  - phase: (existing)
    provides: src/routes/api/translate/+server.ts (gtranslate single-provider, chunk/sentinel/echo-mode/per-line machinery, { translated, flags } contract)
  - phase: (existing)
    provides: src/lib/proxy/proxy-types.ts Env (JOOX_TOKEN / LASTFM_* edge-only secret posture)
provides:
  - src/routes/api/translate/+server.ts — ordered Azure Translator → DeepL Free → keyless Google provider cascade (advance on transport error / non-2xx / rate-limit / echo), env threaded from platform.env
  - src/lib/proxy/proxy-types.ts — optional edge-only AZURE_TRANSLATOR_KEY / AZURE_TRANSLATOR_REGION / DEEPL_KEY typings
  - src/routes/api/translate/server.test.ts — cascade-advance / skip-absent-tier / contract-preservation / no-key-leak suite (7 tests)
affects: [translation-choke-point, lyrics-translation, name-translation, zh-hant-target, edge-secrets]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Ordered provider cascade over a shared GResult { text, segments } contract: try [azure, deepl, google] sequentially, return the FIRST genuine translation, advance on null / (multi-segment && segments<=1 echo) / text===input"
    - "Absent optional edge secret = SUPPORTED skip state — the provider returns null before any fetch and the cascade falls through (parity with /api/similar LASTFM_KEY)"
    - "Uniform echo signal across providers: Azure/DeepL derive `segments` from the surviving sentinel-part count so the existing batched echo-mode guard applies unchanged"
    - "Per-provider APP-code mapping (Azure zh-Hant, DeepL ZH-HANT, Google zh-TW); the raw APP code 'zh-Hant' flows down the cascade and each provider maps it itself"

key-files:
  created:
    - src/routes/api/translate/server.test.ts
  modified:
    - src/routes/api/translate/+server.ts
    - src/lib/proxy/proxy-types.ts
    - .dev.vars (gitignored — commented placeholders only)

key-decisions:
  - "D-05: replace the single gtranslate() with an ordered cascade Azure → DeepL → Google; advance on transport error / non-2xx / rate-limit / echo, reusing the existing echo-mode (segments<=1) detection"
  - "D-06: provider keys are OPTIONAL + edge-only in Env (parity with JOOX_TOKEN / LASTFM_*); absent key skips that tier, cascade ends at keyless Google; never in the response body or client bundle"
  - "Echo heuristic (segments<=1) only applies to a joined batch (sentinel present) — a single short line legitimately translates to ONE segment and must not be rejected"
  - "DeepL target map omits ar/hi/vi/th (unsupported) so those targets advance straight to Google; the top-level 'supported' gate is the LANG_MAP union (Google-supported)"
  - "Preserve GResult { text, segments } shape so translateChunk / perLine / sentinel split / reply() stay structurally unchanged and the { translated, flags } positional contract is untouched"

requirements-completed: [D-05, D-06]

# Metrics
duration: 9min
completed: 2026-07-11
---

# Phase 25 Plan 02: /api/translate Azure → DeepL → Google Provider Cascade Summary

**Replaces the single rate-limit-prone unofficial-Google call inside `/api/translate` with an ordered Azure Translator → DeepL Free → keyless-Google cascade that advances on transport error / non-2xx / rate-limit / echo and degrades gracefully when a provider key is absent (skipped tier) — provider keys stay OPTIONAL and edge-only (parity with JOOX_TOKEN / LASTFM_*), and the chunk/sentinel/echo-mode/per-line machinery plus the `{ translated, flags }` positional contract are preserved byte-for-byte for every caller.**

## Performance

- **Duration:** ~9 min
- **Started:** 2026-07-11T08:56:31Z
- **Completed:** 2026-07-11T09:05Z
- **Tasks:** 3 of 3 (all autonomous, no checkpoints)
- **Files:** 1 created (server.test.ts) + 2 modified (+server.ts, proxy-types.ts) + `.dev.vars` (gitignored placeholders)

## Accomplishments

- **Task 1 (Env typings + seam, D-06):** Added three OPTIONAL edge-only fields to `Env` — `AZURE_TRANSLATOR_KEY?`, `AZURE_TRANSLATOR_REGION?`, `DEEPL_KEY?` — each documented with the same threat-parity note as `LASTFM_KEY`/`JOOX_TOKEN` (injected into upstream headers only, never echoed to the client; absent = tier skipped, a SUPPORTED state). Widened the `POST` handler to `async ({ request, platform })` and read `const env = platform?.env as Env | undefined` (parity with `/api/similar`). Added commented placeholders for all three keys to `.dev.vars` (gitignored — no real values committed).
- **Task 2 (cascade, D-05):** Generalized the single `gtranslate` into three `Provider` functions over the UNCHANGED `GResult { text, segments }` shape:
  - `azureTranslate` — POST `api.cognitive.microsofttranslator.com/translate?api-version=3.0&to=<azTo>` with `Ocp-Apim-Subscription-Key` (+ `Ocp-Apim-Subscription-Region` when set); AZURE_MAP maps `zh-Hant`→`zh-Hant`; returns null (skip) when no key or unsupported target; `segments` = sentinel-part count of the reply.
  - `deeplTranslate` — POST `api-free.deepl.com/v2/translate` with `Authorization: DeepL-Auth-Key <key>`, DEEPL_MAP `zh-Hant`→`ZH-HANT` (ar/hi/vi/th omitted → advance); returns null when no key / unsupported.
  - `googleTranslate` — the ORIGINAL `gtranslate` body verbatim (keyless, `LANG_MAP` `zh-Hant`→`zh-TW`), always attempted last.
  - `cascade(text, appTo, env)` tries `[azure, deepl, google]` sequentially and returns the FIRST genuine result; advances on null / (multi-segment && `segments<=1` echo) / `text===input`; returns null when all fail so per-line fallback still runs. `translateChunk` / `perLine` / the sentinel split / `reply()` are structurally unchanged; `env` + the APP code are threaded through.
- **Task 3 (tests):** `src/routes/api/translate/server.test.ts` — 7 node tests driving the exported `POST` with a fabricated `{ request, platform }` and a URL-routed `fetch` stub simulating each provider's documented shape. Covers: Azure success short-circuits before DeepL/Google; Azure non-2xx AND Azure echo both advance to DeepL; no Azure/DeepL key ⇒ ONLY Google fetched (skip-absent-tier); all-echo ⇒ originals + all-false flags with `out.length === lines.length`; the response body never contains a provider key string; unknown target rejected before any upstream fetch.

## Task Commits

1. **Task 1: type optional provider keys in Env, thread platform** — `092521d` (feat)
2. **Task 2: Azure → DeepL → Google cascade** — `70baee0` (feat)
3. **Task 3: server-side cascade tests** — `4884675` (test)

## Files Created/Modified

- `src/routes/api/translate/+server.ts` (modified) — provider cascade replacing the single Google call; `platform.env` seam; APP-code threading; preserved chunk/sentinel/echo/per-line + `{ translated, flags }` contract.
- `src/lib/proxy/proxy-types.ts` (modified) — optional edge-only `AZURE_TRANSLATOR_KEY` / `AZURE_TRANSLATOR_REGION` / `DEEPL_KEY` with threat-parity docs.
- `src/routes/api/translate/server.test.ts` (created) — 7-test cascade suite (advance / skip / contract / no-leak / unknown-target).
- `.dev.vars` (modified, gitignored) — commented placeholders for the three keys (no real values; prod via `wrangler pages secret put`).

## Decisions Made

- **Uniform echo signal:** Azure/DeepL translate the whole sentinel-joined text as one string, so `segments` is derived from `reply.split(SENTINEL_RE).length` — the surviving sentinel count. This lets the existing batched echo-mode guard (`res.segments > 1`) and the cascade's `segments<=1` heuristic apply identically to all three providers without special-casing.
- **Echo heuristic scoped to batches:** the cascade only applies `segments<=1`-is-echo when the input carries a sentinel (`/‹\d+›/`), because a single short line legitimately returns ONE segment; the `text===input` check catches single-line echo.
- **DeepL language gaps handled as skips:** ar/hi/vi/th are absent from `DEEPL_MAP` so `deeplTranslate` returns null for them and the cascade advances to Google — no error, just a fall-through.
- **APP code flows down, providers map:** the top-level validation now gates on `body.to in LANG_MAP` (the provider union = Google-supported) but keeps the raw `'zh-Hant'` code; each provider maps it itself, so no lossy pre-mapping.

## Deviations from Plan

None — plan executed exactly as written. Tasks 1–3 implemented as specified; all acceptance criteria met without auto-fixes or architectural changes.

## Issues Encountered / Out-of-Scope (Deferred)

- **Pre-existing unrelated test failure (already tracked):** `src/lib/stores/searchHistory.svelte.test.ts:37` fails its SSR-guard assertion `expect(typeof globalThis.localStorage).toBe('undefined')` because the toolchain is **Node v25.9.0**, which exposes a native `globalThis.localStorage` (stable Web Storage API). The file is byte-identical to base commit `51d638b`, fails in ISOLATION with none of this plan's code loaded, and lives in an unrelated store. Already documented in `deferred-items.md` (from Plan 01); NOT fixed here (scope boundary). Full suite otherwise: **1104 passed / 1 pre-existing failure**; the 7 new cascade tests are green.

## Verification

- `pnpm check` → 0 errors, 0 warnings (4312 files, incl. the new test).
- `pnpm test -- src/routes/api/translate/server.test.ts` → 7/7 green.
- `pnpm test` (full) → 1104 passed, 1 pre-existing/unrelated Node-25 localStorage failure (searchHistory).
- `grep -n "platform" +server.ts` → handler reads `platform?.env` (line 293).
- `grep -n "api-free.deepl.com|cognitive.microsofttranslator.com" +server.ts` → both new upstreams wired (lines 141, 173).
- `reply()` call sites (lines 299–327) only ever receive `translated`/`flags` arrays — no key string reaches the response body (T-25c-01/T-25c-05).

## Next Phase Readiness

- Plan 03 can wire the client offline s2t path (`isChineseLine` + `s2tConvertLines` from Plan 01) into `translateLinesEx()` (D-02): Chinese lines convert offline, and the REMAINING non-Chinese lines now hit a resilient multi-provider cascade instead of a single flaky Google endpoint.
- No blockers. To ACTIVATE the Azure/DeepL tiers in prod, set `AZURE_TRANSLATOR_KEY` (+ `AZURE_TRANSLATOR_REGION`) and/or `DEEPL_KEY` via `wrangler pages secret put`; until then the cascade transparently runs keyless-Google only (unchanged behavior).

## Threat Flags

None — no NEW trust-boundary surface introduced beyond the plan's `<threat_model>`. The two new upstream fetches (Azure, DeepL) carry secrets in headers edge-side only (T-25c-01 mitigated: tested no-leak), input coercion/validation is preserved (T-25c-02), the cascade is SEQUENTIAL per chunk with the existing CHUNK_SIZE / PERLINE_CONCURRENCY / AbortSignal.timeout caps (T-25c-03), and quota exhaustion degrades to Google (T-25c-04, accepted).

## Self-Check: PASSED

- `src/routes/api/translate/+server.ts` — FOUND (cascade + azure/deepl/google providers + platform?.env)
- `src/lib/proxy/proxy-types.ts` — FOUND (AZURE_TRANSLATOR_KEY / AZURE_TRANSLATOR_REGION / DEEPL_KEY)
- `src/routes/api/translate/server.test.ts` — FOUND (7 tests, incl. no-key-leak + skip-absent-tier)
- `.planning/phases/25-zh-hant-offline-conversion-fallback-cascade/25-02-SUMMARY.md` — FOUND
- Commits `092521d` (feat, T1) + `70baee0` (feat, T2) + `4884675` (test, T3) — present in git log
- `pnpm check` 0 errors; `pnpm test -- server.test.ts` 7/7 green

---
*Phase: 25-zh-hant-offline-conversion-fallback-cascade*
*Completed: 2026-07-11*
