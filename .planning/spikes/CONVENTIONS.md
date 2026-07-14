# Spike Conventions

Patterns and stack choices established across spike sessions. New spikes follow these unless
the question requires otherwise.

## Stack
- **Node ESM harness (`harness.mjs`)** run with the repo's Node 22 — no deps, native `fetch` +
  `AbortSignal.timeout`. Measures upstream/source behavior by hitting the **live dev server
  `/api/*` on :4321** (the SvelteKit Cloudflare proxy), which encapsulates upstream base URLs +
  token injection. Confirmed `vite dev` DOES populate `platform.env` from `.dev.vars` + `wrangler.jsonc`
  vars, so JOOX/Jamendo/Last.fm all work locally.
- **Live-app instrumentation** for behavior spikes: wrap `window.fetch` via the in-app browser's
  `javascript_tool` (debug inspection), reset the counter at the action boundary, categorize by URL.
  The `javascript_tool` has **no top-level await** — use synchronous IIFEs or poll across calls.
- `curl`/`head` are NOT on this sandbox's PATH — use `node --input-type=module -e '…'` for ad-hoc HTTP.

## Structure
- `.planning/spikes/NNN-name/harness.mjs` + `results.json`. Add `report.html` for matrix-shaped results.
- Start the dev server via the sanctioned preview tool (`preview_start name=dev`, launch.json), never bare Bash.

## Patterns
- **Measure through the REAL proxy**, not by re-implementing upstream URLs — the proxy is the contract.
  Replicate only the adapter's client-side request path + response parse (ported from `src/lib/sources/*.ts`).
- **Ranged probe** (`GET Range: bytes=0-1`, follow redirects, cancel the body) to check media/cover URLs
  actually serve without downloading them; accept 200/206/2xx-3xx.
- **Never log or persist secrets.** Read `LASTFM_KEY` from `.dev.vars` inside the script when an endpoint
  isn't exposed by a route; never print it, never write it to `results.json`.
- **Pick the best-matching search row** by normalized title/artist token overlap (mirrors `match-key.ts`),
  fall back to row[0].
- **YouTube/InnerTube spikes (005–008) hit upstream DIRECTLY from Node, not through the dev proxy.** Unlike
  the CN Meting proxies (unreachable in this sandbox), `music.youtube.com` / `www.youtube.com` / Google
  OAuth ARE reachable here → real E2E without the dev server. InnerTube POST shape: `{context:{client:{
  clientName,clientVersion,hl,gl}}, ...}` + public WEB_REMIX key `AIzaSyC9XL3ZjWddXya6X74dJoCTL-WEYFDNX30`.
  Metadata endpoints (`search`/`next`/`browse`) are anonymous; the `player`/stream endpoint is bot-gated —
  unlock = `ANDROID_VR` client + a `visitorData` token grabbed from any prior search response.
- **Never complete an auth/OAuth flow in a spike** — probe endpoint reachability + gating only (device-code
  initiation yields a code but authenticates nobody; unauth browse proves the target + that data is gated).

## Tools & Libraries
- Node 22 native `fetch`, `AbortSignal.timeout`, `URLSearchParams`, `node:fs` — nothing else.
- In-app browser MCP tools (`navigate` / `computer` / `javascript_tool` / `read_network_requests`) for live audits.
