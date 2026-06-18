# Quick Research: Evaluate github.com/DarinRowe/googletrans for lyric/name translation

> **VERDICT: DO-NOT-INTEGRATE** — googletrans depends on `axios`, which cannot run on Cloudflare Workers (no `xhr`, no Node `http` adapter in the V8 edge runtime). The hard deployment gate fails outright. Separately, it wraps the *same* unofficial Google endpoint we already call and brings none of the alignment/echo/fallback hardening our incumbent has solved.

**Researched:** 2026-06-19
**Domain:** Unofficial Google Translate client libraries / Cloudflare Workers compatibility
**Confidence:** HIGH

---

## 1. What IS github.com/DarinRowe/googletrans?

| Attribute | Finding | Provenance |
|-----------|---------|------------|
| Language / runtime | **Node.js, TypeScript** ("Free and Unlimited Google translate API for node.js") | [CITED: github.com/DarinRowe/googletrans] |
| License | MIT | [VERIFIED: repo LICENSE.md] |
| Stars | ~44 | [CITED: github.com/DarinRowe/googletrans] |
| Maintenance | Active — latest release **v1.0.28 on 2026-03-27** | [VERIFIED: npm `time.modified`] |
| npm downloads | **~1,382 / week** (low) | [VERIFIED: npmjs downloads API] |
| Dependencies | `axios` (>=1.8.3), `qs` (^6.14.1) | [VERIFIED: tarball package.json] |
| Entry point | `lib/googletrans.js` (CommonJS, no `module`/`type:module` field) | [VERIFIED: npm metadata + tarball] |

It is a **Node-only** library (NOT the Python `ssut/py-googletrans` port — that's a different project). It self-discloses as unofficial: *"this is an unofficial library using the web API of Google Translate… does not guarantee that the library would work properly at all times."* 15k char limit per call.

## 2. Cloudflare Workers compatibility — THE HARD GATE → **FAILS**

Confirmed by inspecting the published tarball (`googletrans-1.0.28.tgz`):

```js
// package/lib/googletrans.js
var axios_1 = __importDefault(require("axios"));
...
return [4 /*yield*/, (0, axios_1.default)({ url: URL, params: PARAMS, ... })];
```

The library makes **every** request through **axios**. On Cloudflare Workers (a fetch-only V8 edge runtime — our API proxy per CLAUDE.md), axios has no usable adapter and throws:

> *"No suitable adapter to dispatch the request. Adapter xhr is not supported by the environment and adapter http is not available in the build."*

This is a well-documented, recurring incompatibility (openai-node #30, stytch-node #91, todoist-api-typescript #151, courier-node #66 — all had to *remove* axios to support Workers). `nodejs_compat` does not reliably fix axios's Node `http` adapter on Workers. [VERIFIED: tarball inspection + multiple GitHub issues]

**Conclusion:** It is **impossible** to drop this library into our Cloudflare Workers `/api/translate` route as-is. Integration is a non-starter on our stack. Stop here.

## 3. Does it address OUR root cause better? → **No**

Our incumbent (`src/routes/api/translate/+server.ts`) is already a hardened solution to problems googletrans does **not** even attempt:

| Capability | Incumbent | googletrans |
|------------|-----------|-------------|
| 1:1 positional line alignment (lyrics/name batches) | ✅ unique `‹i›` sentinels survive Google's blank-line reflow | ❌ single-string translate; no batch-line alignment contract |
| Echo-mode detection (oversized payload echoed untranslated) | ✅ segment-count guard + chunking (`CHUNK_SIZE=20`) | ❌ none |
| Per-line fallback so one bad line doesn't poison the batch | ✅ bounded-concurrency `perLine()` | ❌ none |
| `flags[]` genuine-vs-echo signal → poison-resistant client cache | ✅ (+ client retry/backoff, commit c34325a) | ❌ none |
| Runs on Cloudflare Workers | ✅ native `fetch` | ❌ axios |

**The one technique it has that we don't:** googletrans hits `https://translate.google.<tld>/translate_a/single` with `client=t` **plus a computed `tk` token** (a TKK-style obfuscation hash in `lib/googleToken.js` — the classic `TL()`/`RL()` routine). We call `translate.googleapis.com/translate_a/single?client=gtx` with **no token**. [VERIFIED: tarball `googletrans.js` lines 153-168 + `googleToken.js`]

That `tk`-token path is a *different unofficial endpoint flavor*, not the official paid API — it offers no contractual stability or higher guaranteed rate limit; both are unofficial scraping of the same free service. It does **not** address our actual root causes (alignment, echo-mode, fallback signalling), which are response-handling problems, not request-auth problems.

## 4. Verdict + Risk

**DO-NOT-INTEGRATE.** Two independent disqualifiers: (1) it can't run on Cloudflare Workers (axios), which alone ends it; (2) even if portable, it wraps the same unofficial endpoint while lacking every piece of alignment/echo/fallback hardening that three prior debug sessions baked into our incumbent — adopting it would be a strict regression. Our endpoint is the one to beat, and googletrans does not beat it.

**Risk of integrating anyway:** HIGH — guaranteed Worker runtime crash, plus loss of the `flags[]`/sentinel/echo-guard contract every caller (`translate.ts`, `stores/names.svelte.ts`, NowPlaying stitch) depends on. **Risk of declining:** none.

### Optional ideas worth borrowing (suggestions only — NOT this task's scope)
- **`tk`-token request path** (`googleToken.js` `TL()` hash): a tiny pure-JS function that ports cleanly to Workers `fetch`. *If* we ever see `client=gtx` rate-limited/echoing in production, computing a `tk` and using `client=t` is a cheap alternative endpoint flavor to A/B. Speculative — only pursue if telemetry shows the current endpoint degrading.
- **Multiple TLD fallback** (`translate.google.com` → `.cn` etc.): trivial endpoint rotation we could add to `gtranslate()` if one host starts failing. Low value today.

## Package Legitimacy Audit

| Package | Registry | Age | Downloads | Source Repo | slopcheck | Disposition |
|---------|----------|-----|-----------|-------------|-----------|-------------|
| googletrans | npm | v1.0.28 (2026-03-27) | ~1.4k/wk | github.com/DarinRowe/googletrans | not run (eval-only, no install planned) | **REJECTED — Workers-incompatible** |

Not a slopsquat (real repo, MIT, real history), but **rejected on the technical gate**, so no install is planned. No postinstall scripts observed in the tarball.

## Sources
- [CITED] github.com/DarinRowe/googletrans — README, file tree, license
- [VERIFIED] npm registry metadata + downloads API (v1.0.28, ~1382/wk, deps axios+qs)
- [VERIFIED] Published tarball `googletrans-1.0.28.tgz` — `lib/googletrans.js` (axios require, endpoint URL, `tk` param), `lib/googleToken.js` (TKK hash)
- [CITED] axios-on-Workers incompatibility: openai-node#30, stytch-node#91, todoist-api-typescript#151, courier-node#66, Cloudflare community forum
- Incumbent: `src/routes/api/translate/+server.ts`, `src/lib/services/translate.ts`, `translate.test.ts`
