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
- `curl` IS on PATH as of 2026-09-24 (earlier sessions lacked it); `node --input-type=module -e '…'`
  still works for ad-hoc HTTP and is what the harnesses use.
- **Edge-reachability spikes (011) run a throwaway Worker via `wrangler dev --remote`** — the code executes
  on the Cloudflare network, so subrequests egress from real Workers IPs (`2a06:98c0:…`) with the
  `CF-Worker` header, without deploying anything public. Use the PERSONAL account
  (`0b9e5c70a8072908a4f186d65acd1db8`, hardcoded as `account_id` in the spike's own `wrangler.jsonc`) —
  never the Flow account; local wrangler cannot reach the openmusic prod account anyway. Start it via a
  temporary `.claude/launch.json` entry + `preview_start`, remove the entry afterwards. Always include a
  `cdn-cgi/trace` probe to record the egress IP + colo. Split probes into suites so one invocation stays
  under the free-plan 50-subrequest cap. The colo is the one nearest this machine (North America) — HKG
  cannot be observed this way; say so in the verdict.
  **Account update (014, 2026-10-04):** local wrangler is now logged into `F147259@gmail.com's Account`
  (`f1868a071996e836eae6da2b65f37929`); `0b9e5c70…` returns `Authentication error [code: 10000]` on
  `edge-preview`. The user approved the logged-in account for preview-only runs — confirm again before reuse.
- **Edge worker imports the local targets module** (014): put request+parse in one `targets.mjs`, import it
  from the harness, a local page server AND the edge `worker.js` (wrangler bundles it), so local and edge
  issue byte-identical requests. Read env via `globalThis.process?.env` so it loads in workerd.

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

- **Copyrighted text never touches disk or chat (013/014).** When the test input is copyrighted (lyrics),
  derive it at RUNTIME from a neutral source (LRCLIB `plainLyrics`) inside the harness or the page, and record
  only identity + position + length + ranks. Live-app checks pick the input in-page and return category
  codes, never row text (row titles can embed lyrics — lyric-video uploads do).
- **Live in-page runs on :4321 must be resumable (013).** Another session's worktree under
  `.claude/worktrees/` regenerating `.svelte-kit/tsconfig.json` (and writes under `.planning/`) make Vite
  force-reload the app; persist progress in `sessionStorage`, re-inject the runner after a reload, and keep
  repo writes out of the run window. Hidden-pane timers are throttled — budget ~1 query/min.
- **Paste-to-compare page for comparison spikes (013):** `server.mjs` (node:http, no deps) serving
  `report.html` + `/probe?q=` over the shared targets, plus the scored matrix from `results.json`. Start it via
  a temporary launch.json entry.

## Tools & Libraries
- Node 22 native `fetch`, `AbortSignal.timeout`, `URLSearchParams`, `node:fs` — nothing else.
- In-app browser MCP tools (`navigate` / `computer` / `javascript_tool` / `read_network_requests`) for live audits.
- `tongwen-dict/dist/{t2s,s2t}-char.min.json` loaded as plain JSON maps for Traditional⇄Simplified in Node
  (`tongwen-core`'s ESM uses directory imports and only resolves under a bundler).
