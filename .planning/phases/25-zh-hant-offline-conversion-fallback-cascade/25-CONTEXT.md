# Phase 25: zh-Hant Offline Conversion + Translation Fallback Cascade - Context

**Gathered:** 2026-07-11
**Status:** Ready for planning
**Source:** Explore Express Path (`.planning/notes/zh-hant-offline-conversion.md`) — decisions locked during `/gsd:explore`, no separate discuss-phase.

<domain>
## Phase Boundary

Make Simplified→Traditional Chinese (zh-Hans → zh-Hant) translation **reliable and offline**,
and make the remaining API translation **resilient** via a provider cascade. Today `/api/translate`
calls one unofficial free Google endpoint that rate-limits and silently echoes the originals under
load, so zh-Hant output fails intermittently. zh-Hans→zh-Hant is a deterministic char/phrase
conversion that needs no API at all.

This phase delivers:

1. **Offline s2t primary path** — when the translation target is `zh-Hant`, convert Chinese
   content client-side with a bundled Simplified→Traditional dictionary (TongWenTang `tongwen-core`
   + `tongwen-dict`, s2t dicts only). Instant, no network, no rate limit, works offline / on
   lockscreen. Lazy-loaded so it stays out of the initial bundle.
2. **CJK-source routing** — only lines detected as Chinese take the offline path; genuinely
   non-Chinese lines (EN, JA, etc.) fall through to the API.
3. **API provider cascade** — replace the single unofficial-Google call inside `/api/translate`
   with an ordered cascade **Azure Translator → DeepL Free → unofficial-Google**, advancing to the
   next provider on failure / rate-limit / echo, reusing the existing echo/soft-fail detection.

It does NOT redesign the settings UI, add new translatable surfaces, change the `translated`/`flags`/
`complete` client contract, or touch non-`zh-Hant` targets' behavior beyond the shared cascade.

</domain>

<decisions>
## Implementation Decisions

### Offline library (D-01)
- **D-01:** Use **`tongwen-core` + `tongwen-dict`**, importing ONLY the s2t char + phrase dictionaries
  (~72 KB gzipped, measured). Pure JS/JSON — runs in browser, Cloudflare Workers, and the Capacitor
  WebView with no WASM/native binary. MIT. Phrase-level quality (disambiguates 头发→頭髮, 里→裡/裏).
- Rejected: `opencc-js` phrase dicts (~425 KB gz — too big for marginal coverage gain);
  `chinese-conv` (~30 KB but char-only → mis-converts context); native `opencc` (node-gyp breaks
  Workers + Capacitor).

### Where the offline path lives (D-02)
- **D-02:** Intercept in **`src/lib/services/translate.ts` `translateLinesEx()`** — the single choke
  point every target flows through (lyrics via `NowPlaying.svelte`, artist/title/lastfm names via
  `stores/names.svelte.ts`). When `to === 'zh-Hant'`: run offline s2t on Chinese-detected lines
  client-side; only send remaining non-Chinese lines to `/api/translate`. Keeps the existing
  positional-alignment (`out.length === lines.length`) + `flags`/`complete` contract intact.

### Client-side vs edge (D-03)
- **D-03:** Run the offline converter **client-side** (dynamic `import()` of the dict JSON on first
  zh-Hant use), NOT in the Worker. Rationale: works offline / on lockscreen (matches the app's
  PWA/background-audio priority), zero network for the common case. The 72 KB is lazy so initial
  load is unaffected.

### CJK-source detection (D-04)
- **D-04:** Route per-line by detecting Han ideographs. Offline-convert only lines that look like
  Chinese; pass others to the API cascade. **Known edge case:** Japanese kanji shares glyphs with
  Han — blindly s2t-converting JA lyrics would mis-convert. The detection heuristic must avoid
  offline-converting Japanese (e.g. presence of kana ⇒ treat as non-Chinese → API). Planner to
  pick a concrete, testable heuristic.

### API provider cascade (D-05)
- **D-05:** Inside `/api/translate/+server.ts`, replace the single `gtranslate()` provider with an
  ordered cascade: **Azure Translator (2M chars/mo) → DeepL Free (500k/mo, `api-free.deepl.com`,
  `zh-Hant` since Nov 2024) → unofficial-Google (current, keyless, last resort)**. A provider is
  "failed" on transport error, non-2xx, rate-limit, or echo (reuse existing echo-mode detection);
  on failure, advance to the next. Preserve chunking + sentinel alignment + per-line fallback.

### Secrets (D-06)
- **D-06:** Provider API keys live edge-only in Cloudflare, typed in `src/lib/proxy/proxy-types.ts`
  `Env` (same posture as `JOOX_TOKEN` / `LASTFM_*`): `AZURE_TRANSLATOR_KEY` (+ region), `DEEPL_KEY`.
  All OPTIONAL — an absent key means that provider tier is skipped, cascade falls through to the
  next. Never in the client bundle. Local dev values in `.dev.vars`.

### Claude's Discretion
- Exact module layout for the offline converter wrapper (e.g. `src/lib/services/zh-convert.ts`) and
  how the s2t dict JSON is lazy-imported/cached in memory.
- The precise CJK/kana detection heuristic and its unit tests.
- Whether the provider cascade is expressed as an ordered array of provider fns or a config list.
- Azure region header handling; DeepL free-vs-pro base-URL selection.
- Whether caching in `translate.ts` needs a cache-version bump (`CACHE_VER`) now that zh-Hant output
  becomes deterministic offline (avoid serving old API-echoed zh-Hant from localStorage).
</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### Translation client + choke point
- `src/lib/services/translate.ts` — `translateLinesEx()` (choke point for D-02), `requestOnce()`,
  `CACHE_VER`, mem + localStorage cache, `flags`/`complete` contract, transient retry.
- `src/lib/services/translate.test.ts` — existing tests (translate `['杜国华','周杰伦'] → zh-Hant`).

### Translation server / provider
- `src/routes/api/translate/+server.ts` — `gtranslate()` (provider to refactor into a cascade, D-05),
  `LANG_MAP` (`zh-Hant`→`zh-TW`, `zh-Hans`→`zh-CN`), chunking, sentinel alignment, echo-mode guard,
  per-line fallback, `reply()`.

### Callers (must stay green, no contract change)
- `src/lib/stores/names.svelte.ts` — batched name translation via `translateLinesEx(items, lang)` (~line 147).
- `src/lib/components/NowPlaying.svelte` — lyrics translation via `translateLinesEx(sendText, lang)` (~line 356);
  `effectiveTarget()` maps `'auto'` → app language.

### Settings / language model
- `src/lib/stores/settings.svelte.ts` — `LyricsLang` type (line 25, includes `'zh-Hant'`/`'zh-Hans'`);
  `lyricsLang`/`artistLang`/`titleLang`/`lastfmLang`/`bioLang` state; `effectiveTarget()` (line 503).
- `src/lib/config/defaults.ts` — `TRANSLATION_DEFAULTS` (line 57).

### Secrets + fetch infra
- `src/lib/proxy/proxy-types.ts` — `Env` interface (line 11) — add optional provider keys here (D-06).
- `src/lib/services/api-base.ts` — `apiFetch()` governor (line 233), `MAX_CONCURRENT_REQUESTS`.
  Note: server-side upstream fetches use RAW `fetch`, not `apiFetch` (see translate `+server.ts` comment).

### Deployment / config
- `CLAUDE.md` — secrets go in Cloudflare (`wrangler pages secret put`), `.dev.vars` for local;
  CORS via `src/hooks.server.ts`; edge = Cloudflare Workers (`nodejs_compat`).
</canonical_refs>

<specifics>
## Specific Ideas

- Measured bundle deltas (gzipped, s2t only): tongwen ~72 KB · opencc-js phrase ~425 KB ·
  chinese-conv ~30 KB (char-only).
- Provider free quotas: Azure 2M chars/mo (key + region header) · DeepL Free 500k/mo
  (`DeepL-Auth-Key`, `api-free.deepl.com`) · unofficial-Google keyless.
- Full research + source links in `.planning/notes/zh-hant-offline-conversion.md`.
</specifics>

<deferred>
## Deferred Ideas

- Offline conversion for OTHER directions (t2s / Traditional→Simplified) — not needed; user only
  wants zh-Hans→zh-Hant.
- Replacing the API entirely for non-Chinese content — explicitly rejected; user wants the API kept
  as a cross-language fallback (hybrid).
- MyMemory / Lingva / LibreTranslate providers — evaluated and rejected (per-IP quota drains on shared
  CF egress / same Google echo problem / not edge-native).
</deferred>

---

*Phase: 25-zh-hant-offline-conversion-fallback-cascade*
*Context gathered: 2026-07-11 via Explore Express Path*
