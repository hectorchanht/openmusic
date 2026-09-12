# Phase 33: Activity-log upload for automated diagnosis - Research

**Researched:** 2026-09-12
**Domain:** Cloudflare edge storage + a token-gated `/api/*` write/read pair on SvelteKit (adapter-cloudflare Pages)
**Confidence:** HIGH for the codebase reuse map and the route/test mechanics; HIGH for the Cloudflare free-tier numbers (fetched from current docs); MEDIUM for one environment fact (which Cloudflare plan tier the `openmusic` Pages account is on — see Open Questions).

## Summary

This phase is small in code and almost entirely decided by two things the endpoint itself does not
contain: **which Cloudflare storage binding** the blob lands in, and **who is allowed to write and
read it**. Everything else already exists in this repo — the log has a pure, tested serializer
(`serializeActionLog`) and a pure, tested *validator* (`parseActionLog`), the shared JSON response
helper exists, the CORS seam is centralised, and there are ten worked examples of a `+server.ts`
endpoint with a co-located node-Vitest test that drives the exported verb handler against a
fabricated `{ url, request, platform }`. There is no new serializer, no new validator and no new
test harness to invent.

On D-07 I must be honest about what the evidence shows: **the Cloudflare free tier does not
disqualify anything for this payload size.** The captures are ~160 KB at the full 2,000-entry cap
with typical entries (measured, see Payload Sizing), and "a handful of uploads per debugging
session" is two orders of magnitude under every free allowance on R2, KV and D1 alike. Two options
*are* eliminated, but on structure rather than quota: **Durable Objects is disqualified because a
Pages project cannot define a DO class at all** (verified doc quote), and **D1 is disqualified as
over-engineering** — a schema, a migration and a 2 MB row ceiling for what is one opaque blob. That
leaves R2 vs KV, and the free-tier headroom tiebreak the phase asked for comes out a tie. The
deciding factor is therefore behavioural and it is decisive: **KV writes take up to 60 seconds or
more to become globally visible, and KV caches negative lookups** — so the exact workflow this
phase exists to enable (upload on the phone, read it from the laptop ten seconds later) can return
a 404 and *keep* returning that cached 404 for a minute. R2 is strongly consistent for both
read-after-write and list-after-write. **Recommendation: R2**, with KV named as a ~6-line fallback
if the account owner refuses R2's one-time dashboard enablement.

The two highest-value findings for the planner are landmines, not features. First, **`hooks.server.ts`
/ `corsHeaders` currently emits `Access-Control-Allow-Headers: 'Content-Type, Range'` — `Authorization`
is absent**, so a bearer-token upload will pass on the web build (same-origin, no preflight) and
**fail CORS preflight on the APK** (`https://localhost` → `https://openmusic.lol` is cross-origin).
Second, **the Workers Free plan allows 10 ms CPU per request**, and `JSON.parse` + per-entry
validation of a several-hundred-KB array is close enough to that ceiling that the size cap must be
chosen to bound CPU, not just storage.

**Primary recommendation:** Store the raw serialized log verbatim in an **R2 bucket** behind ONE
new route file `src/routes/api/diag/+server.ts` (POST = upload, GET = list, GET `?key=` = fetch
one), with **two separate tokens** — `DIAG_UPLOAD_TOKEN` (lives on the device, low blast radius)
and `DIAG_READ_TOKEN` (never leaves the maintainer's laptop) — both in `platform.env`, validated by
a pure, node-testable helper in `$lib/proxy/diag-auth.ts`, and a size/shape guard in
`$lib/proxy/diag-payload.ts` that reuses the already-tested `parseActionLog`.

---

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions

- **D-01 — v1 is SINGLE-USER.** Only the maintainer can upload. Upload is gated by a secret
  the maintainer holds; there is no public unauthenticated write path. Explicitly OUT of scope
  for this phase: multi-user consent UX, a retention policy, a user-facing delete path,
  pseudonymous per-user identity, and per-user rate limiting. Rationale: single-user unblocks
  the debugging loop immediately — the actual goal — and defers the entire privacy and abuse
  surface to a later milestone without losing anything the stated need requires.

- **D-02 — Retrieval is TOKEN-GATED list + fetch endpoints.** A list endpoint and a
  fetch-one endpoint under `/api/`, both requiring a bearer token. Copy-paste is removed:
  the log is fetched directly. No unguessable-share-URL scheme, no wrangler-CLI-only path.

- **D-03 — The upload token and any read token live ONLY in Cloudflare `platform.env`,**
  injected edge-side, never in the client bundle. Same rule as `JOOX_TOKEN` / `LASTFM_SECRET`.

- **D-04 — Upload is an EXPLICIT user action.** Never automatic, never on a timer, never on
  app start, never retried in the background. Guards against the three recorded fetch-flood
  freeze incidents (`api-fetch-flood-freeze`).

- **D-05 — Size cap and input validation are server-side,** following the
  `proxy/safe-image-url.ts` precedent (screen → parse → validate, with tests). A malformed or
  oversized body is rejected at the edge before storage. Applies even under D-01 — an
  authenticated endpoint is still a validated one.

- **D-06 — No UI-SPEC.** The client surface is a single control on the existing Settings →
  Activity log screen, reusing established Settings component and `use:tapBounce` patterns.
  Every new user-facing string MUST be added to all 16 `src/lib/i18n/*.ts` dictionaries with
  DOUBLE quotes — a missing key is a compile error.

- **D-07 — Storage backend is Claude's discretion,** to be chosen in RESEARCH.md from
  R2 / KV / D1 / Durable Objects against Cloudflare **free-tier** limits for payloads of
  ~1,500 entries / several hundred KB. Free-tier fit decides it, not elegance.

> **Correction to D-06, verified this session:** there are **15** locale dictionaries, not 16.
> `ls src/lib/i18n/*.ts` yields 16 non-index `.ts` files, but one of them is `detect.ts` (language
> detection logic, not a dictionary). The dictionaries imported into `dicts` at
> `src/lib/i18n/index.ts:12-26` are: `en, zh-Hant, zh-Hans, es, fr, de, pt, it, ru, tr, ar, hi, id,
> vi, th` = **15**. Everything else in D-06 (double quotes, identical key sets, compile-time
> enforcement) holds exactly as written. `[VERIFIED: ls + src/lib/i18n/index.ts:12-26]`

### Claude's Discretion

- **D-07 storage backend** — answered below (R2, with KV as documented fallback).

### Deferred Ideas (OUT OF SCOPE)

Multi-user consent UX, retention policy, user-facing delete path, pseudonymous per-user identity,
per-user rate limiting. Not researched, not designed, not mentioned again in this document.
</user_constraints>

---

## Project Constraints (from CLAUDE.md)

The planner must verify every task against these. They are as binding as the locked decisions.

| Directive | Source | Effect on this phase |
|---|---|---|
| **Tabs for indentation; single quotes in TS/JS** — except `src/lib/i18n/*.ts` which uses **double quotes for key AND value** | Conventions | New route + helpers use tabs/single quotes; the 15 dictionary edits use double quotes |
| **Svelte 5 runes forced project-wide**; `$state`/`$derived`/`$effect`/`$props` only, no `export let`, no `$:` | Conventions | The Settings button uses `$state` for its local flash/busy flags (the existing page already does) |
| **Runes live in `*.svelte.ts` / `*.svelte`; pure logic stays `.ts`** so it is node-Vitest-testable | Architecture | Auth check + payload validation go in `src/lib/proxy/*.ts`, never in a runes file |
| **Always use path aliases** `$lib/…`, `$app/…`; relative `../` is rare | Conventions | `import { jsonResponse } from '$lib/proxy/http'` etc. |
| **Named exports only in `$lib`; no default exports** | Conventions | — |
| **`import type` for type-only imports** | Conventions | `import type { Env } from '$lib/proxy/proxy-types'` |
| **Zero `as any` in production source** (all existing ones are in tests) | Type Safety | The `platform?.env as Env \| undefined` cast is the established, permitted form (used at 4 sites) |
| **Browser guards** — anything touching `localStorage`/`window` must gate on `browser` from `$app/environment` | SSR/Browser Guards | If the token is persisted to localStorage, the read must be guarded or confined to an event handler (SSR is off app-wide, but the convention stands) |
| **Shared Primitives table: import, never re-inline** — `proxy/http.ts` `jsonResponse` (replaced 18 copies) | Shared Primitives | The new route MUST use `jsonResponse`, not a local `new Response(JSON.stringify(...))` |
| **Secrets only in `platform.env`, injected edge-side, never in the client bundle** | Architectural Constraints | Rules out any `VITE_`-prefixed token — see Pitfall 3 |
| **CORS: all `/api/*` get allowlisted CORS via `hooks.server.ts` — never `*`** | Architectural Constraints | The new route inherits CORS automatically; do not add per-route CORS logic |
| **High comment density is the house style**; tag non-obvious choices with a decision ref (`D-01`…`D-07`) or quick-task ID; never delete existing decision-ref comments | Comments | Every new file carries a posture header in the style of `safe-image-url.ts` / `api-base.ts` |
| **Gates are `pnpm check` + `pnpm test`. No linter, no formatter.** | Build & Test | `svelte-check` is the only static gate |
| **Pushing to main AUTO-DEPLOYS to production** at openmusic.lol | Constraints + memory `openmusic-pushes-autodeploy-live` | See Pitfall 1 |

### Project Skills

`.claude/skills/spike-findings-openmusic/SKILL.md` exists. It covers kuwo-first resolution, Last.fm
`track.getSimilar` up-next, and inline-cover / API-call-reduction patterns. **Nothing in it bears on
this phase** — it is about the playback hot path, not diagnostics or storage. No pattern from it
applies here. `[VERIFIED: read .claude/skills/spike-findings-openmusic/SKILL.md]`

---

## Architectural Responsibility Map

| Capability | Primary Tier | Secondary Tier | Rationale |
|---|---|---|---|
| Serialize the log to a string | Browser / Client | — | Already done by `serializeActionLog(actionLog.entries)` at `settings/activity/+page.svelte:39`; identical string for copy and upload |
| Hold the upload token | Browser / Client (localStorage) | — | Low-value write-only credential, single-user device; see Auth Mechanism for why this is acceptable *and* why the READ token must never live here |
| Issue the upload request | Browser / Client | — | One explicit tap (D-04). Goes through `apiFetch` so the concurrency governor still bounds it |
| Authenticate upload / read | **API / Backend (edge)** | — | D-03: tokens live only in `platform.env`. A client-side check is decorative |
| Size cap + shape validation | **API / Backend (edge)** | — | D-05 explicitly. The edge rejects before any storage op |
| Persist the blob | **Database / Storage (R2)** | — | Durable across devices; PoP-local `caches.default` cannot serve this (see Anti-Patterns) |
| List / fetch a stored log | **API / Backend (edge)** | Database / Storage | D-02. `bucket.list()` is the index — no separate index record to maintain |
| Consume the fetched log | Maintainer's laptop / agent (curl) | — | Not a browser tier at all; this is why the read token never touches the client |

---

## Storage Backend — the D-07 decision

### Verified free-tier numbers

All fetched from current Cloudflare docs this session.

| | Free storage | Free write ops | Free read ops | Per-item ceiling | Structural blocker |
|---|---|---|---|---|---|
| **R2** | **10 GB-month** | **1,000,000 Class A / month** (put, list) | **10,000,000 Class B / month** (get, head) | none relevant (multi-TB objects) | One-time "enable R2" in the dashboard |
| **KV** | **1 GB / account** | **1,000 writes / day** (different keys); 1 write/sec same key | **100,000 reads / day** | **25 MiB value**, 512 B key, 1024 B metadata | none |
| **D1** | **5 GB total; 500 MB max DB (free)** | **100,000 rows written / day** | **5,000,000 rows read / day** | **2 MB max string/BLOB/row**; 100 KB max SQL statement; 50 queries per Worker invocation on free | none, but needs schema + migrations |
| **Durable Objects** | 5 GB SQLite total | 100,000 SQLite rows written / day | 5,000,000 rows read / day; 100,000 requests / day | — | **Pages cannot define a DO class** |

Sources: `[CITED: developers.cloudflare.com/kv/platform/limits/]`,
`[CITED: developers.cloudflare.com/r2/pricing/]`,
`[CITED: developers.cloudflare.com/d1/platform/limits/]` +
`[CITED: developers.cloudflare.com/d1/platform/pricing/]`,
`[CITED: developers.cloudflare.com/durable-objects/platform/pricing/]`.

Egress on R2 is free — there are no bandwidth charges for reading the logs back out.
`[CITED: developers.cloudflare.com/r2/pricing/]`

### Payload sizing — measured, not assumed

The store's ring buffer cap is **2,000 entries** (`ACTION_LOG_CAP`,
`src/lib/diagnostics/action-log-logic.ts:15`), so the payload has a hard upper bound built in.
A representative instrumented entry serializes to **81 bytes**:

```json
{"t":1789252228376,"ev":"media.progress","d":{"ms":1234,"rs":4,"ns":2,"be":12.5}}
```

2,000 × 82 B ≈ **160 KB** at the full cap. Entries carrying track names / uids run longer, so
**~160–400 KB** is the realistic range, matching CONTEXT.md's "several hundred KB".
`[VERIFIED: node -e JSON.stringify measurement + ACTION_LOG_CAP source read]`

### What the free tier actually decides — an honest answer

**Nothing.** At 160–400 KB per upload and a handful of uploads per debugging session, every
remaining candidate has three-to-four orders of magnitude of headroom. KV's 25 MiB value ceiling
does not disqualify it (the payload is ~1.6% of it). D1's 2 MB row ceiling does not disqualify it
either. The phase brief asked for free-tier limits to decide it; the evidence says they cannot, and
saying otherwise would be theatre. The eliminations below are structural.

### Eliminated: Durable Objects

Disqualified outright and not on quota. Pages Functions can *bind* to a DO namespace but cannot
*contain* one:

> "You must create a Durable Object Worker and bind it to your Pages project using the Cloudflare
> dashboard or your Pages project's Wrangler configuration file. **You cannot create and deploy a
> Durable Object within a Pages project.**"
> `[CITED: developers.cloudflare.com/pages/functions/bindings/]`

`openmusic` is a Pages project (`wrangler.jsonc` has `pages_build_output_dir`). Using DO means
standing up and deploying a **second, separate Worker** just to hold a blob. That is a whole extra
deploy target for zero benefit over R2.

### Eliminated: D1

Not blocked, just wrong-shaped. This is one opaque blob per upload; D1 buys a schema, a migration
file, a `CREATE TABLE`, SQL in the route, and a 2 MB row ceiling, in exchange for query
capabilities nothing in this phase uses. A note on the limit the brief asked about explicitly: the
**2 MB max row** is comfortable, but the **100 KB max SQL statement length** is a live hazard —
that limit applies to statement *text*, and bound parameters are transported separately, so
`.bind(blob)` should be fine. "Should be fine" is not a reason to pick a backend when two
alternatives have no such ambiguity at all.

### Eliminated: KV — and this is the real decision

KV passes every quota comfortably and needs no account setup. It loses on **consistency**, and it
loses on exactly the axis this feature exists for.

> "Changes may take up to 60 seconds or more to be visible in other global network locations as
> their cached versions of the data time out." … **"Negative lookups indicating that the key does
> not exist are also cached, so the same delay exists noticing a value is created as when a value
> is changed."**
> `[CITED: developers.cloudflare.com/kv/concepts/how-kv-works/]`

The docs also warn against relying on read-your-own-write: at the location where the write
happened it is "usually immediately visible", but "this is not guaranteed and therefore it is not
advised to rely on this behaviour."

The workflow is: capture on the phone → tap upload → within seconds, list and fetch from the
laptop/agent. Under KV that request can 404, **and the 404 itself gets cached**, so retrying
immediately keeps failing for up to a minute. An operator will read that as "the upload broke"
and go back to copy-pasting — which is the exact loop this phase is removing. This is a
quiet-wrong-behaviour failure, not a loud one, which makes it worse.

### **Chosen: R2**

> "Readers will immediately see the latest object globally" … "The list operation will list all
> objects at that point in time."
> `[CITED: developers.cloudflare.com/r2/reference/consistency/]`

Strong read-after-write **and** list-after-write, globally. That removes the entire class of
failure above. Supporting reasons:

- `bucket.list()` **is** the D-02 list endpoint. `key`, `size`, `uploaded` come back without
  reading a single object body, so there is no index record to maintain and no second write.
- Free-tier headroom is absurd for this use: 1M Class A ops/month against maybe 50 uploads/month.
- Egress is free, so pulling logs back costs nothing.
- Storing the raw string verbatim means no re-serialization on the edge — which matters for the
  10 ms CPU ceiling (Pitfall 4).

**The one cost:** R2 requires a one-time subscription/enablement in the dashboard before a bucket
can be created. Verified empirically, not just from docs — `wrangler r2 bucket list` against the
personal account returns:

```
✘ [ERROR] A request to the Cloudflare API (/accounts/0b9e5c70…/r2/buckets) failed.
  Please enable R2 through the Cloudflare Dashboard. [code: 10042]
```

and the docs confirm: "You need a Cloudflare account with an R2 subscription … Complete the
checkout flow to add an R2 subscription to your account", while noting "R2 is free to get started
with included free monthly usage."
`[VERIFIED: wrangler r2 bucket list]` + `[CITED: developers.cloudflare.com/r2/get-started/]`

**This cost is close to zero in practice** because provisioning requires a human step regardless of
backend — see Environment Availability. No executor can create a binding on the `openmusic` account
from this machine.

### Fallback if the account owner declines R2 enablement

Swap to KV. The diff is roughly six lines, entirely inside the route:

| R2 | KV |
|---|---|
| `env.DIAG.put(key, text)` | `env.DIAG.put(key, text)` |
| `env.DIAG.get(key)` → `R2ObjectBody \| null`, `.text()` | `env.DIAG.get(key)` → `string \| null` |
| `env.DIAG.list({ prefix })` → `.objects[{key,size,uploaded}]` | `env.DIAG.list({ prefix })` → `.keys[{name, metadata}]` |
| `r2_buckets` in wrangler.jsonc | `kv_namespaces` in wrangler.jsonc |
| `R2Bucket` in `Env` | `KVNamespace` in `Env` |

**Do NOT build a storage-adapter interface to abstract over this.** One implementation ships; the
fallback is a find-and-replace, not a plugin point. (CLAUDE.md's own anti-pattern list is full of
abstractions that earned their keep only after a second caller existed.)

### Binding config — exact

`wrangler.jsonc`, added alongside the existing `vars` block:

```jsonc
{
	"$schema": "./node_modules/wrangler/config-schema.json",
	"name": "openmusic",
	"compatibility_date": "2026-06-05",
	"compatibility_flags": ["nodejs_compat"],
	"pages_build_output_dir": ".svelte-kit/cloudflare",
	"vars": {
		"JAMENDO_CLIENT_ID": "1df0a42f"
	},
	// Phase 33 / D-07: diagnostics log store. Bucket holds ONLY maintainer-uploaded
	// activity logs; both the write and read paths are token-gated (D-01/D-02/D-03).
	"r2_buckets": [
		{
			"binding": "DIAG",
			"bucket_name": "openmusic-diag"
		}
	]
}
```

`[CITED: developers.cloudflare.com/pages/functions/wrangler-configuration/]`

**Caveat the planner must not skip:** `vars`, `kv_namespaces` and `r2_buckets` are all
*non-inheritable* keys. The docs state that "if any one non-inheritable key is overridden for any
environment … all non-inheritable keys must also be specified in the environment configuration and
overridden." This file currently defines **no** `[env.*]` blocks, so the top-level config is the
only config and adding `r2_buckets` there is safe. If anyone later adds an `env.preview` block they
must re-declare **both** `vars` and `r2_buckets` inside it or `JAMENDO_CLIENT_ID` silently
disappears from previews. Worth a comment in the file. `[CITED: pages/functions/wrangler-configuration/]`

### Typing the binding — TWO files, and one of them has already drifted

`@cloudflare/workers-types` (v`4.20260605.1`) is already a devDependency and is already wired into
`tsconfig.json` via `"types": ["@cloudflare/workers-types"]`, so `R2Bucket` / `KVNamespace` are
globally available with no new import. `[VERIFIED: tsconfig.json + package.json]`

**1. `src/lib/proxy/proxy-types.ts` — the one that functionally matters.** Every route does
`const env = platform?.env as Env | undefined` (`lastfm/info/+server.ts:240`,
`lastfm/discovery/+server.ts:165`, `lastfm/similar-tracks/+server.ts:141`,
`translate/+server.ts:293`), so this interface *is* the contract. Add:

```ts
	/** Phase 33 / D-07: R2 bucket holding maintainer-uploaded activity logs. OPTIONAL —
	 *  absent binding (vite dev, unit tests) is a SUPPORTED state: the route 503s rather
	 *  than throwing, same posture as an absent LASTFM_KEY. */
	DIAG?: R2Bucket;
	/** Phase 33 / D-01/D-03: bearer token required to WRITE a log. Held on the maintainer's
	 *  device. Absent ⇒ uploads are disabled entirely (fail closed, never fail open). */
	DIAG_UPLOAD_TOKEN?: string;
	/** Phase 33 / D-02/D-03: bearer token required to LIST/FETCH. NEVER shipped to any device —
	 *  used only from curl on the maintainer's machine. Absent ⇒ reads disabled. */
	DIAG_READ_TOKEN?: string;
```

**2. `src/app.d.ts` `App.Platform.env` — documentation that has already drifted.** It declares only
`JOOX_TOKEN`, `LASTFM_KEY`, `LASTFM_SECRET`. It is **missing** `JAMENDO_CLIENT_ID`,
`AZURE_TRANSLATOR_KEY`, `AZURE_TRANSLATOR_REGION` and `DEEPL_KEY`, all of which exist in `Env` and
are used in production. The `as Env` cast at every call site is why nothing broke. Add the three new
members here too for consistency — but the planner should know that this file is **not** what makes
the code compile, and should not be surprised when the drift is visible. `[VERIFIED: read src/app.d.ts vs proxy-types.ts]`

---

## Auth Mechanism (D-01 / D-03)

### The design that makes the client-side secret cheap: TWO tokens

The instinctive worry with "paste a token into the app" is that a secret ends up sitting in
localStorage in plaintext. Splitting the credential removes most of that worry:

| Token | Lives | Grants | Blast radius if leaked |
|---|---|---|---|
| `DIAG_UPLOAD_TOKEN` | Cloudflare `platform.env` **and** the maintainer's device | Write a blob | Someone can upload junk logs. Bounded by the size cap; rotate with `wrangler pages secret put`. **No read access.** |
| `DIAG_READ_TOKEN` | Cloudflare `platform.env` **only** — never on any device, never in the app, used from curl | List + fetch logs | Real — this is the one that reads listening history. It is therefore never exposed to a browser, a WebView, or localStorage. |

The valuable capability (reading a full listening history) is protected by a credential that never
touches a client. The credential that does touch a client is write-only. That asymmetry is the
whole point and should be stated in the route's posture comment.

### Where the upload token comes from — three options, ranked

**Recommended — `prompt()` on first use, persisted to localStorage.** Zero new input UI, zero new
components, and it is already idiomatic here: `settings/data/+page.svelte:36` uses a bare
`confirm()` for the destructive library wipe. The upload handler reads
`localStorage.getItem('openmusic:diag:v1')`; if absent, `prompt(t('settings.activityUploadPrompt'))`,
store, continue. Persist-once, reuse forever, on both web and APK. Cost: ~8 lines and one extra
i18n key.

- *Caveat to verify on device:* `prompt()` in the Capacitor Android WebView. `confirm()` is already
  in production here and works, and Capacitor 8 handles `onJsPrompt`, but `prompt()` specifically
  has not been exercised in this app. `[ASSUMED]` — if it no-ops on the APK, fall back to option 2.

**Acceptable — a text input on the Activity-log screen.** More conventional, needs a `bind:value`
input (there is precedent in `settings/home/+page.svelte` and `settings/appearance/+page.svelte`),
plus a label/placeholder key. Costs ~2 more i18n strings and a styled input. Take this if `prompt()`
fails on device.

**FORBIDDEN — a build-time value.** Any `VITE_`-prefixed env var is **inlined into the client
bundle by Vite at build time**. `VITE_UPLOAD_TOKEN` would put the secret in the shipped JS of a
publicly-downloadable PWA and APK, violating D-03 and CLAUDE.md's "never in the client bundle"
constraint directly. The existing `VITE_API_BASE` is a *public URL*, which is precisely why it is
allowed to use that mechanism. Say this in the plan so no executor "simplifies" toward it.

### Constant-time comparison — the concrete answer

Cloudflare's runtime does provide `crypto.subtle.timingSafeEqual(a, b)` taking `ArrayBuffer |
TypedArray`, documented as "a non-standard extension to the Web Crypto API".
`[CITED: developers.cloudflare.com/workers/runtime-apis/web-crypto/]`

**Do not use it here.** It is Cloudflare-only; Node 22 exposes `crypto.timingSafeEqual` from
`node:crypto` but *not* `crypto.subtle.timingSafeEqual`. This project runs a **single node Vitest
project with no workerd environment**, so any helper calling it would either throw in tests or need
a branch whose production path is never the tested path — which defeats the purpose of testing a
security control.

Instead, put a ~10-line pure comparison in `src/lib/proxy/diag-auth.ts`, node-testable and
byte-identical on workerd:

```ts
// Phase 33 / D-01. Constant-time-ish bearer check. Deliberately NOT crypto.subtle.timingSafeEqual:
// that is a Cloudflare-only extension absent from the node Vitest runtime, so using it would make
// this security control's production path untestable under the project's single test project
// (the exact failure mode that left 4 of 5 readiness guards stale-blind — see CLAUDE.md).
//
// Comparison runs over SHA-256 digests, not the raw strings, so neither the token's LENGTH nor a
// shared prefix leaks through timing. Returns false for an absent/blank expected value: an
// unconfigured secret must FAIL CLOSED, never accept everything.
export async function bearerMatches(header: string | null, expected: string | undefined): Promise<boolean> {
	if (!expected) return false;                       // unconfigured ⇒ closed
	if (!header?.startsWith('Bearer ')) return false;
	const got = header.slice(7);
	if (!got) return false;
	const [a, b] = await Promise.all([sha256(got), sha256(expected)]);
	let diff = 0;
	for (let i = 0; i < a.length; i++) diff |= a[i] ^ b[i];   // fixed 32 iterations, no early exit
	return diff === 0;
}

async function sha256(s: string): Promise<Uint8Array> {
	return new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(s)));
}
```

`crypto.subtle.digest('SHA-256', …)` and `TextEncoder` exist in **both** workerd and Node 22
globals, so this runs identically in production and under Vitest. Digest-then-compare also means
the two inputs are always 32 bytes, so the length-mismatch early-exit that a naive compare needs —
and which leaks token length — never arises.

Threat-model honesty: a remote timing attack against a string compare across the public internet,
with network jitter measured in milliseconds against differences measured in nanoseconds, is
effectively infeasible. This is cheap insurance and a reviewable security posture, not a response
to a live threat. `[ASSUMED — reasoning, not a cited benchmark]`

### The native Capacitor build

`src/lib/services/api-base.ts:37-45` — on the native build `VITE_API_BASE=https://openmusic.lol` is
baked in, so the APK's `/api/diag` request resolves to the **deployed** proxy. One endpoint serves
both web and APK; no second deployment, no second token. The APK's WebView origin is
`https://localhost` (`svelte.config.js` / Capacitor `androidScheme: 'https'`), which
`ALLOWED_ORIGIN_PATTERNS` at `src/lib/proxy/http.ts:19` already allowlists.

**But the APK request is cross-origin, and that triggers a CORS preflight that will currently
fail.** See Pitfall 2 — this is the single most likely way this phase ships "working" and is broken
on the device.

### Secret provisioning

`wrangler pages secret put DIAG_UPLOAD_TOKEN` / `wrangler pages secret put DIAG_READ_TOKEN` — the
same mechanism already documented in `.dev.vars` for `JOOX_TOKEN`, `LASTFM_KEY`, `LASTFM_SECRET`,
and named in `wrangler.jsonc`'s own comment ("For PRIVATE secrets … use `wrangler pages secret put
…` instead"). Local dev values go in `.dev.vars` (gitignored). Generate the tokens with
`openssl rand -hex 32`. `[VERIFIED: read .dev.vars + wrangler.jsonc]`

---

## Existing Code to Reuse — cited, do NOT rebuild

### The log itself

**`src/lib/diagnostics/action-log-logic.ts`** — pure, no runes, already node-tested
(`action-log-logic.test.ts`, 4.6 KB alongside it):

| Export | Line | Use in this phase |
|---|---|---|
| `ACTION_LOG_KEY = 'openmusic:action-log:v1'` | :12 | localStorage key (client) |
| `ACTION_LOG_CAP = 2000` | :15 | **The server-side entry-count cap.** Import it; do not hard-code a second number |
| `interface ActionLogEntry { t; ev; d?; n?; tl? }` | :20-26 | The payload's element type |
| **`parseActionLog(raw: string \| null): ActionLogEntry[]`** | :33-47 | **THIS IS THE D-05 VALIDATOR.** `JSON.parse` in try/catch, `Array.isArray` guard, and a per-entry filter requiring `typeof t === 'number' && typeof ev === 'string'`. Returns `[]` on any failure. Already tested. Reuse verbatim — do not write a second validator |
| **`serializeActionLog(entries): string`** | :84-86 | **THIS IS THE EXPORT PATH.** A bare `JSON.stringify(entries)` |

`appendEntry` (:69-81) coalesces consecutive identical events into `{n, tl}` rather than appending,
which is why an entry can carry a repeat count. The upload must preserve `n`/`tl` — reusing
`parseActionLog` does that automatically, since it filters on `t`/`ev` and passes the rest through.

**`src/lib/stores/actionLog.svelte.ts`** — the runes singleton (103 lines). `entries =
$state<ActionLogEntry[]>([])` (:23), oldest-first, capped at 2000, persisted on a ~1 s throttle,
never throws on the hot path. **Do not add an `upload()` method to this store.** Its documented
contract is "MUST be cheap and MUST NEVER throw — a logging failure can NEVER alter playback", and
it must not acquire a network dependency. The upload belongs in the Settings page's event handler.

**The serialized payload is exactly what "Copy log" already produces.** At
`src/routes/(app)/settings/activity/+page.svelte:38-46`:

```ts
async function copyLog() {
	const text = serializeActionLog(actionLog.entries);
	try {
		await navigator.clipboard.writeText(text);
		flash(t('settings.activityCopied'));
	} catch { /* clipboard unavailable — non-fatal */ }
}
```

The upload handler is the same first line and a different second line. One serializer, one wire
format, oldest-first array of `ActionLogEntry`.

### Server-side primitives

| What | File:line | Notes |
|---|---|---|
| `jsonResponse(body, origin, { ttl?, status?, cacheControl? })` | `src/lib/proxy/http.ts:112-125` | **Shared Primitive — 18 copies were deduped into it.** Use it for every response. Omitting both `ttl` and `cacheControl` omits `Cache-Control` entirely, which is correct here (never cache a diagnostics response) |
| `corsHeaders(origin)` | `src/lib/proxy/http.ts:32-42` | Called *by* `jsonResponse`; the new route should not call it directly |
| `safeImageUrl` — the D-05 precedent | `src/lib/proxy/safe-image-url.ts:34-51` | Pattern: **character screen BEFORE parse** (`if (/[)\s"'\\(]/.test(raw)) return null`) → `new URL()` in try/catch → allowlist check → return the **normalised** value, not the raw input. Its header comment (lines 1-19) explains why each check is load-bearing — copy that documentation style |
| `safe-image-url.test.ts` | 60+ lines | The test style D-05 implies: one `describe` per guard dimension, explicit "rejects a lookalike that merely ENDS WITH the allowed domain" cases, and comments naming *why* each assertion exists |
| `edgeCache()` / `ownOriginCacheKey()` | `src/lib/proxy/edge-cache.ts:34-47` | **Not usable for this phase** — see Anti-Patterns |
| `Env` interface | `src/lib/proxy/proxy-types.ts:10-51` | Where the binding + two secrets get typed |
| `App.Platform.env` | `src/app.d.ts:9-36` | Second (drifted) declaration site |

### The CORS seam — what the new routes inherit

`src/hooks.server.ts` is the single seam. For any path starting `/api/`:
1. `OPTIONS` → `204` with `corsHeaders(origin)`, **without** calling `resolve()` (comment: on
   workerd the preflight must not fall through to route logic).
2. Any other method → `resolve(event)`, then every `corsHeaders(origin)` entry is `set()` onto the
   response.

**The new route therefore needs no per-route CORS code at all.** It inherits the allowlist, the
`Vary: Origin`, and the preflight handling.

**The origin allowlist does NOT need touching.** `ALLOWED_ORIGIN_PATTERNS`
(`src/lib/proxy/http.ts:12-21`) already covers `https://openmusic.lol`, its preview subdomains,
`*.openmusic.pages.dev`, `http://localhost(:port)`, `http://127.0.0.1(:port)`, `https://localhost`
(the Capacitor Android WebView origin) and `capacitor://localhost`. Every client this phase has is
already allowlisted.

**The allowed *headers* list DOES need touching** if the token travels in an `Authorization` header
— `Access-Control-Allow-Headers` is `'Content-Type, Range'` (`http.ts:34`). See Pitfall 2.

### Existing `/api/**` route layout to match

39 files under `src/routes/api/`. Conventions the new route should follow, all verified:

- `GET` / `POST` / `OPTIONS` exported as `const … : RequestHandler` with `import type { RequestHandler } from './$types'`.
- Body read is `try { body = await request.json() } catch { return <sentinel> }` — never unguarded
  (`translate/+server.ts:295-300`, `resolve/+server.ts:138-143`).
- `const env = platform?.env as Env | undefined;` with the comment "platform?.env is the verified
  Cloudflare-adapter path for bindings/secrets" (4 occurrences).
- A long posture-comment header explaining the security model and each decision ref.
- Dynamic segments use `[param]` dirs (`api/audius/stream/[id]/`, `api/ytmusic/stream/[videoId]/`).
- Only **two** POST routes exist today (`resolve`, `translate`) — both are worth reading as models.

Recommended layout — **one file**:

```
src/routes/api/diag/+server.ts        POST = upload; GET = list; GET ?key=… = fetch one
src/lib/proxy/diag-auth.ts            bearerMatches()                   (pure, tested)
src/lib/proxy/diag-auth.test.ts
src/lib/proxy/diag-payload.ts         screenLogPayload(), diagKey()     (pure, tested)
src/lib/proxy/diag-payload.test.ts
src/routes/api/diag/diag-endpoint.test.ts
```

D-02 asks for "a list endpoint and a fetch-one endpoint". A `?key=` query param on the GET
satisfies that as two behaviours in one file, and sidesteps URL-encoding the `/` inside an object
key — which a `[key]` path segment would force. If the planner prefers explicit routes, the
`api/diag/[key]/+server.ts` form matches the `stream/[id]` precedent; note the encoding cost.

### The Settings surface (D-06)

`src/routes/(app)/settings/activity/+page.svelte` (98 lines) already has everything:

- imports `actionLog`, `serializeActionLog`, `tapBounce`, `t` (:5-8)
- `let msg = $state('')` + `flash(m)` for transient feedback (:10, :14-17)
- an `.actions` row with two `<button class="item" … use:tapBounce>` controls (:60-63)
- `.item` / `.item.danger` styles already defined (:87-89)

**The change is one more `<button class="item">` in that `.actions` row plus one handler.** Import a
lucide icon per-import (`import { Upload } from '@lucide/svelte'`) matching the existing
`ChevronLeft, Copy, Trash2` line. No new component, no new styles, no new page.

The entry in the settings index (`settings/+page.svelte:22`) already routes to `/settings/activity`
— untouched.

---

## SvelteKit-on-Cloudflare route mechanics

### HARD CONSTRAINT: `+server.ts` may export ONLY HTTP-verb handlers

A top-level `export function helper()` in a `+server.ts` **500s at request time** with an "Invalid
export" error. Unit tests do **not** catch it, because a test imports the module directly and never
goes through SvelteKit's route-module validation.

This has already bitten this project once, in production: commit `29c1c7d` / quick-270715 —
`/api/ytmusic/stream` exported non-verb functions, 500'd live, and the fix was moving the helpers to
`$lib/proxy/ytmusic.ts`. It was caught by E2E, not by the 2023-test suite.
`[VERIFIED: memory svelte-server-endpoint-only-verb-exports + .planning/STATE.md:51]`

**Consequence for the plan:** every helper (`bearerMatches`, `screenLogPayload`, `diagKey`, size
constants) **must** live in `src/lib/proxy/*.ts`. `+server.ts` exports `POST`, `GET`, and
optionally `OPTIONS`, and nothing else. This is also what makes them node-testable, so the
constraint and the testing strategy point the same direction.

### Reading the body with a size cap

There is no built-in cap; it is a two-step check because `Content-Length` is client-supplied and can
lie:

```ts
// 1. Cheap header rejection — zero CPU, zero body read.
const declared = Number(request.headers.get('content-length') ?? '0');
if (declared > MAX_UPLOAD_BYTES) return jsonResponse({ ok: false, err: 'too-large' }, origin, { status: 413 });

// 2. Read once as TEXT (I/O, not CPU) and re-check — the header can lie or be absent.
const text = await request.text();
if (text.length > MAX_UPLOAD_BYTES) return jsonResponse({ ok: false, err: 'too-large' }, origin, { status: 413 });
```

Note `text.length` counts UTF-16 code units, not bytes; for CJK track names that *under*-counts
bytes by up to 3×. Either accept the slack (the cap is a safety bound, not an accounting figure) or
use `new TextEncoder().encode(text).byteLength` — which costs CPU on a several-hundred-KB string and
is not worth it. Recommend `text.length` with a comment stating the approximation. Cloudflare's own
platform ceiling is **100 MB request body on Free/Pro**, far above anything relevant here.
`[CITED: developers.cloudflare.com/workers/platform/limits/]`

**Suggested `MAX_UPLOAD_BYTES = 512 * 1024`** (512 KiB). Rationale: 3.2× the measured 160 KB full-cap
payload, ample for name-heavy logs, and it bounds the `JSON.parse` cost under the 10 ms CPU ceiling
(Pitfall 4). Do not set it to a "generous" 5 MB — that trades a clean 413 for an opaque CPU-limit
500.

### Reaching bindings and secrets

`platform?.env` under `adapter-cloudflare`, cast to `Env`. `platform` is `undefined` under
`vite dev` and in unit tests, which is a **supported** state everywhere in this codebase (see the
`/api/og` test comment: "platform stays undefined by DEFAULT, and that is still a real assertion").
The new route must handle it — no binding ⇒ a clean `503`, never a thrown `TypeError`:

```ts
const env = platform?.env as Env | undefined;
const bucket = env?.DIAG;
if (!bucket) return jsonResponse({ ok: false, err: 'unconfigured' }, origin, { status: 503 });
```

`platform?.ctx?.waitUntil` also exists (`src/app.d.ts:28-34`) but **should not be used here** —
D-04's spirit is that the user gets a real success/failure answer from an explicit action, not a
fire-and-forget write that silently fails.

### Key naming

`crypto.randomUUID()` exists in both workerd and Node 22. R2 `list()` returns keys in lexicographic
UTF-8 order, so a sortable timestamp prefix gives chronological listing for free:

```ts
// 2026-09-12T14-03-22-123Z-a1b2c3d4.json  → lexicographic order == chronological order
export function diagKey(now: number, rand: string): string {
	return `log/${new Date(now).toISOString().replace(/[:.]/g, '-')}-${rand.slice(0, 8)}.json`;
}
```

Pure, deterministic given its inputs, and therefore directly testable — which is the reason `now`
and `rand` are parameters instead of being read inside.

---

## i18n cost (D-06)

**15 dictionaries, not 16.** `src/lib/i18n/index.ts:12-26` imports exactly: `en, zh-Hant, zh-Hans,
es, fr, de, pt, it, ru, tr, ar, hi, id, vi, th`. The 16th `.ts` file is `detect.ts` (detection
logic). `i18n.test.ts:51-56` iterates `Object.keys(dicts)` and asserts every locale's key set is
**identical to `en`** — so a key added only to `en` fails the suite in 14 locales at once. Its
comment still says "all 15 locales" from Phase 19; the assertion itself is count-agnostic.
`[VERIFIED: src/lib/i18n/index.ts:12-26 + i18n.test.ts:51-56]`

Existing sibling keys for style (`src/lib/i18n/en.ts:141-148`):

```ts
	// --- activity log (quick-260630-sgw) ---
	"settings.activityHeading": "Activity log",
	"settings.activityEmpty": "No activity recorded yet.",
	"settings.activityClear": "Clear log",
	"settings.activityCopy": "Copy log",
	"settings.activityCopied": "Activity log copied.",
```

### Plausible new strings

| Key | `en` value | Needed? |
|---|---|---|
| `settings.activityUpload` | `"Upload log"` | **Yes** — the button label |
| `settings.activityUploadPrompt` | `"Paste the diagnostics upload token"` | **Yes** if the `prompt()` option is taken |
| `settings.activityUploaded` | `"Log uploaded."` | **Yes** — success flash |
| `settings.activityUploadFailed` | `"Upload failed."` | **Yes** — failure flash |
| `settings.activityUploadEmpty` | `"Nothing to upload."` | Optional — guard for an empty buffer |

**Sizing for the planner: 4 strings minimum, 5 with the empty-buffer guard. × 15 locales = 60–75
dictionary lines, all in DOUBLE quotes.** This is the single largest mechanical chunk of the phase
and deserves its own task. Two rules the executor will get wrong if not told:

1. `src/lib/i18n/*.ts` uses **double quotes for key AND value**; the rest of the repo uses single
   quotes. No formatter enforces this — it is a manual convention recorded in CLAUDE.md and in
   memory (`i18n-files-use-double-quotes`, which notes `en`/`zh-Hans`/`zh-Hant` had drifted before).
2. Placing an interpolated value (e.g. the returned key) in `activityUploaded` means translating
   `"Log uploaded ({key})."` in 15 languages with the token intact. **Recommend keeping the flash
   text token-free** and showing the returned key via the existing `msg` line or a `console.log` —
   fewer moving parts, no interpolation to get wrong in Arabic or Thai.

---

## Don't Hand-Roll

| Problem | Don't build | Use instead | Why |
|---|---|---|---|
| Serialize the log for upload | A new `toUploadPayload()` | `serializeActionLog(actionLog.entries)` (`action-log-logic.ts:84`) | Two serializers drift; "Copy log" and "Upload log" must produce byte-identical payloads |
| Validate the uploaded array server-side | A fresh per-entry type guard | `parseActionLog(text)` (`action-log-logic.ts:33-47`) | Already does `JSON.parse` in try/catch + `Array.isArray` + per-entry `t`/`ev` typeof filter, and is already tested. This IS the D-05 "parse → validate" step |
| Entry-count ceiling | A new `MAX_ENTRIES = 2000` | `ACTION_LOG_CAP` (`action-log-logic.ts:15`) | Two numbers that must agree will eventually disagree |
| JSON responses from the route | `new Response(JSON.stringify(...), { headers })` | `jsonResponse` (`http.ts:112`) | Shared Primitive; 18 copies were already deduped into it. Re-inlining is a documented anti-pattern here |
| Per-route CORS | `corsHeaders(...)` calls inside the route | Nothing — `hooks.server.ts` does it | Single seam by design; a route-level copy is the thing the hook was introduced to eliminate |
| An index of uploaded logs | A `manifest.json` object updated on every upload | `bucket.list({ prefix: 'log/' })` | Read-modify-write on a manifest is a lost-update race for zero benefit; `list()` returns `key`/`size`/`uploaded` already |
| A unique, sortable id | A counter, or `Date.now()` alone | `crypto.randomUUID()` + an ISO timestamp prefix | Two uploads in the same millisecond collide on `Date.now()` alone |
| Constant-time compare | `a === b`, or `crypto.subtle.timingSafeEqual` | 10-line digest-then-XOR in `$lib/proxy/diag-auth.ts` | `===` leaks a prefix; `timingSafeEqual` is Cloudflare-only and makes the production path untestable under this project's single node Vitest project |
| A storage abstraction over R2/KV | `interface DiagStore` + two impls | Direct `env.DIAG.put/get/list` calls | One implementation ships. CLAUDE.md's own rule: no interface with one implementation |
| Compressing the payload | gzip in the browser before POST | Nothing | A browser `fetch` cannot set `Content-Encoding` meaningfully, and 160–400 KB needs no compression |

**Key insight:** almost everything this phase needs was built in June for the Activity-log viewer and
in the 2026-09-12 dedup sweep. The genuinely new code is one route file, two ~40-line pure helpers,
and one button. If a plan task is writing more than that, it is rebuilding something.

---

## Architecture Patterns

### System flow

```text
[Settings → Activity log screen]                     (D-06: ONE new button)
   user taps "Upload log"  ── explicit action only (D-04) ─────────────┐
                                                                       │
   token = localStorage['openmusic:diag:v1'] ?? prompt(…)              │
   text  = serializeActionLog(actionLog.entries)   ← same string as "Copy log"
                                                                       ▼
   apiFetch('/api/diag', { method:'POST', body:text,
                           headers:{ Authorization:`Bearer ${token}` } })
       │  apiFetch (api-base.ts) — POST is NOT deduped (body present) but
       │  IS governed: MAX_CONCURRENT_REQUESTS=8, 25s timeout, circuit breaker
       │
       │  web  : VITE_API_BASE='' → '/api/diag'                (same-origin, NO preflight)
       │  APK  : VITE_API_BASE='https://openmusic.lol'         (CROSS-origin → PREFLIGHT — Pitfall 2)
       ▼
[hooks.server.ts]  /api/* seam
   OPTIONS → 204 + corsHeaders(origin)   ← preflight answered here, NOT in the route
   other   → resolve(event), then merge corsHeaders onto the response
       ▼
[src/routes/api/diag/+server.ts]  POST                 ← verb exports ONLY
   1. origin  = request.headers.get('origin')
   2. env     = platform?.env as Env | undefined
   3. AUTH    bearerMatches(header, env?.DIAG_UPLOAD_TOKEN)  → 401   [$lib/proxy/diag-auth.ts]
   4. BINDING env?.DIAG absent                                → 503
   5. SCREEN  content-length > MAX                            → 413   ┐
   6. READ    await request.text(); text.length > MAX         → 413   │ D-05
   7. PARSE   parseActionLog(text) → []  but text non-trivial → 400   │ safe-image-url
   8. VALIDATE entries.length > ACTION_LOG_CAP                → 400   ┘ ordering
   9. STORE   env.DIAG.put(diagKey(Date.now(), randomUUID()), text)
              ↑ RAW text verbatim — no re-serialize (10ms CPU ceiling, Pitfall 4)
  10. jsonResponse({ ok:true, key, entries:n }, origin)       ← no Cache-Control
       ▼
[R2 bucket "openmusic-diag"]   binding DIAG   key log/<iso>-<rand>.json
   strong read-after-write + list-after-write, globally
       ▲
       │  GET /api/diag           Authorization: Bearer $DIAG_READ_TOKEN
       │      → bucket.list({prefix:'log/'}) → [{key,size,uploaded}]
       │  GET /api/diag?key=…     Authorization: Bearer $DIAG_READ_TOKEN
       │      → bucket.get(key) → .text() → the raw log
       │
[maintainer's laptop / agent: curl]   ← the READ token NEVER leaves here
```

### Pattern 1: screen → parse → validate (the D-05 shape, from `safe-image-url.ts`)

**What:** run the cheapest rejection first and only pay parse cost on input that survived it.
**When:** any untrusted server-side input in this codebase.
**Source:** `src/lib/proxy/safe-image-url.ts:34-51`

```ts
export function safeImageUrl(raw: string | null | undefined, allowed: ImageHostAllowlist): string | null {
	if (!raw) return null;
	if (/[)\s"'\\(]/.test(raw)) return null;   // CHARACTER SCREEN — before parse, deliberately
	try {
		const u = new URL(raw);                // PARSE — in try/catch; unparseable is attack or junk
		if (u.protocol !== 'https:') return null;
		const host = u.hostname.toLowerCase();
		const ok = (allowed.exact?.includes(host) ?? false) || allowed.suffix.some((h) => host.endsWith(h));
		return ok ? u.href : null;             // VALIDATE, and return the NORMALISED value
	} catch {
		return null;
	}
}
```

Applied here (`$lib/proxy/diag-payload.ts`), the analogue is: length screen (cheapest) → `parseActionLog`
(the parse, already in a try/catch) → entry-count check (the validate). Same never-throw, return-a-sentinel
contract: the function returns `null` or a discriminated result, and the *route* turns that into a
status code.

### Pattern 2: never-throw with a sentinel, fail CLOSED

CLAUDE.md's error strategy is "isolate-and-degrade … no error stops the app". For a security control
degrade means **deny**, not allow:

- absent `DIAG_UPLOAD_TOKEN` / `DIAG_READ_TOKEN` ⇒ `bearerMatches` returns `false` ⇒ 401. An
  unconfigured secret must never mean "no check".
- absent `DIAG` binding ⇒ 503, never a thrown `TypeError` on `undefined.put`.
- malformed body ⇒ 400 with a short code, never an unhandled rejection.

Contrast with the optional-key routes (`/api/similar` returns `{artists:[]}` with no `LASTFM_KEY`) —
those fail *open* into a degraded read of public data, which is correct there and wrong here. Worth a
comment so nobody "aligns" this route with that posture.

### Pattern 3: client governed through `apiFetch`, never raw `fetch`

`src/lib/services/api-base.ts:249-258` — a `POST` with a body skips dedupe (correct, it is
side-effecting) but **still goes through `governedFetch`**: the 8-way concurrency cap, the 25 s
timeout, and the circuit breaker. Using `apiFetch` costs nothing and keeps the upload inside every
structural protection the three freeze incidents bought. Use `apiFetch`, not `fetch`.

### Anti-Patterns to avoid

- **Using `caches.default` / `edgeCache()` as the store.** It is PoP-local by construction — the
  repo already documents this at `edge-cache.ts:17-22` ("the bust is PoP-LOCAL … never a global
  purge"), and STATE.md:41 records a whole debugging detour caused by misreading edge-cache
  semantics. A log written at the phone's PoP would be invisible from the laptop's PoP, and is
  evictable at any time. It is the wrong tool and it will *look* like it works during local testing.
- **Adding `upload()` to `actionLog.svelte.ts`.** Breaks its "cheap, never throws, no network"
  contract and puts a fetch dependency in a store the player calls on hot paths.
- **A background retry on upload failure.** D-04, and `api-fetch-flood-freeze` — three recorded
  incidents. A failure shows a flash and stops. The user taps again.
- **Storing a re-serialized array** (`JSON.stringify(parseActionLog(text))`). Doubles the CPU for
  zero benefit and silently drops any field `parseActionLog`'s filter does not understand. Store the
  raw validated text.
- **`export const MAX_UPLOAD_BYTES` inside `+server.ts`.** Invalid export → 500 at request time.
- **Widening `Access-Control-Allow-Origin` to `*`** to "fix" the APK. Never. The origin is already
  allowlisted; the missing piece is the *header* name (Pitfall 2).

---

## Common Pitfalls

### Pitfall 1: pushing to main deploys to production, mid-phase

**What goes wrong:** `git push origin main` ships whatever is on main to openmusic.lol via
Cloudflare Pages' native Git integration. A half-finished phase goes live.
**Why:** the deploy is Git-triggered, not CLI-triggered; `pnpm run deploy` is the secondary path.
**How to avoid:** **nothing is pushed without explicitly asking the user.** This has already caused
real harm — memory `openmusic-pushes-autodeploy-live` records a mid-phase push that "shipped half a
decision and put cellular users on 52MB FLACs".
**Warning signs:** any task whose action includes `git push`.
**Extra wrinkle:** this feature is *unverifiable* until deployed (the R2 binding does not exist
under `vite dev`). So the phase structurally needs a deploy — which makes it a deliberate,
user-approved step, not an incidental one.
**Secondary:** `pnpm deploy` is shadowed by a pnpm builtin and silently does not run the script —
use **`pnpm run deploy`** (memory `pnpm-deploy-name-collision`; CLAUDE.md documents this wrong).

### Pitfall 2: `Authorization` is not in `Access-Control-Allow-Headers` — the APK upload fails preflight

**What goes wrong:** upload works perfectly in the browser and fails on the APK with an opaque CORS
error. It looks like a server bug; it is a one-word omission.
**Why:** `src/lib/proxy/http.ts:34` sets `'Access-Control-Allow-Headers': 'Content-Type, Range'`. On
web, `VITE_API_BASE=''` makes the request same-origin, so no preflight runs and the missing header
is never noticed. On the APK, `VITE_API_BASE='https://openmusic.lol'` makes it cross-origin from
`https://localhost`; an `Authorization` header is not a CORS-safelisted request header, so the
browser preflights, `hooks.server.ts` answers 204 with an Allow-Headers list that omits
`Authorization`, and the real request is never sent.
**How to avoid:** add `Authorization` to that string:
`'Access-Control-Allow-Headers': 'Content-Type, Range, Authorization'`.
This is safe — Allow-Headers only permits the *browser* to send the header to an **already
allowlisted** origin; it grants nothing to a non-allowlisted one. `http.test.ts` does not currently
assert on Allow-Headers, so nothing breaks — but a new assertion should be added, because this is a
shared security seam and an untested change to one is exactly the failure class CLAUDE.md's Shared
Primitives section was written about.
**Warning signs:** works in `pnpm dev` and on openmusic.lol, fails only in the APK.
**Alternative if the planner prefers not to touch the shared seam:** put the upload token in the
JSON body instead of a header (a `Content-Type: application/json` POST preflights, but
`Content-Type` is already allowed), and keep `Authorization` for the list/fetch endpoints — which
are called from curl, where there is no Origin header and therefore no CORS at all. This works, but
the one-word header addition is the smaller and more honest diff.
`[VERIFIED: read src/lib/proxy/http.ts:32-42, hooks.server.ts, api-base.ts:37-45, http.test.ts]`

### Pitfall 3: a `VITE_`-prefixed token is shipped in the public bundle

**What goes wrong:** `VITE_DIAG_TOKEN` feels like the natural sibling of `VITE_API_BASE`. Vite
inlines every `VITE_*` var into the client bundle at build time, so the secret ships inside a
publicly downloadable PWA and APK.
**Why:** `VITE_API_BASE` is a public URL, so the existing precedent is misleading.
**How to avoid:** D-03 is absolute — tokens only in `platform.env` via `wrangler pages secret put`.
Say so explicitly in the plan; this is the kind of "reasonable-looking" shortcut an executor takes.
**Warning signs:** any `import.meta.env.VITE_…` referring to a credential.

### Pitfall 4: the Workers Free plan gives 10 ms CPU per request

**What goes wrong:** a generous size cap (say 5 MB) lets a payload through whose `JSON.parse` +
2,000-entry validation filter exceeds the CPU budget. The request dies with a runtime CPU-limit
error, not a clean 413, and it only happens on *large* logs — i.e. the interesting ones.
**Why:** Workers Free is documented at "10 ms" CPU per HTTP request, versus 30 s default on paid.
`[CITED: developers.cloudflare.com/workers/platform/limits/]`
**How to avoid:** (a) cap at **512 KiB**, sized from the measured 160 KB full-cap payload; (b) store
the **raw** text — never `JSON.stringify` the parsed array back out; (c) reject on `Content-Length`
before reading the body at all; (d) do zero per-entry work beyond what `parseActionLog` already
does.
**Warning signs:** intermittent 5xx on large uploads while small ones succeed.
**Caveat:** whether the `openmusic` account is on Workers Free or Paid could not be verified (see
Environment Availability). Designing for Free is the safe direction and costs nothing if it is Paid.

### Pitfall 5: KV's cached negative lookup (if the KV fallback is taken)

**What goes wrong:** upload succeeds (200 + a key), the immediate `GET` 404s, and retrying keeps
404ing for up to a minute — because KV caches the negative lookup too.
**Why:** KV is eventually consistent; up to 60 s or more for global visibility.
**How to avoid:** choose R2. If KV is forced, document the wait prominently in the success flash and
in the route's posture comment.
**Warning signs:** "the upload silently didn't work" reports that resolve themselves a minute later.

### Pitfall 6: a helper exported from `+server.ts`

Covered in full under Route Mechanics. Restated here because it is the one landmine that **passes
every local gate and only fails in production**. Commit `29c1c7d` is the precedent.

### Pitfall 7: the i18n key added only to `en`

**What goes wrong:** `pnpm test` fails with 14 key-set-parity failures, or `pnpm check` fails on the
`TranslationKey` union.
**Why:** `en` defines the `TranslationKey` type and `i18n.test.ts:51-56` asserts identical key sets.
**How to avoid:** treat "add key to all 15 dictionaries, double-quoted" as a single atomic task.
**Warning signs:** partial locale edits across multiple commits.

### Pitfall 8: grep returning false-empty

Project memory `grep-false-empty-trust-read-sed` records grep returning empty for real matches in a
prior session. When auditing "did I add the key everywhere?", cross-check with `sed`/Read before
concluding a locale is done.

---

## Code Examples

### Uploading from the Settings page (D-04, D-06)

```svelte
<!-- src/routes/(app)/settings/activity/+page.svelte — ADD to the existing script -->
<script lang="ts">
	// … existing imports; add Upload to the existing @lucide/svelte line
	import { apiFetch } from '$lib/services/api-base';

	const DIAG_TOKEN_KEY = 'openmusic:diag:v1';
	let uploading = $state(false);

	/** D-04: EXPLICIT user action only. No timer, no app-start hook, no background retry —
	 *  a failure flashes and STOPS (api-fetch-flood-freeze: three recorded incidents). */
	async function uploadLog() {
		if (uploading) return;                       // re-entrancy guard, not a retry
		const text = serializeActionLog(actionLog.entries);   // SAME payload as copyLog()
		if (!text || text === '[]') return flash(t('settings.activityUploadEmpty'));

		let token = '';
		try { token = localStorage.getItem(DIAG_TOKEN_KEY) ?? ''; } catch { /* non-fatal */ }
		if (!token) {
			token = prompt(t('settings.activityUploadPrompt')) ?? '';
			if (!token) return;
			try { localStorage.setItem(DIAG_TOKEN_KEY, token); } catch { /* non-fatal */ }
		}

		uploading = true;
		try {
			// apiFetch, not fetch: a bodied POST skips dedupe but KEEPS the concurrency cap,
			// the 25s timeout and the circuit breaker (api-base.ts:249-258).
			const res = await apiFetch('/api/diag', {
				method: 'POST',
				headers: { Authorization: `Bearer ${token}`, 'content-type': 'application/json' },
				body: text
			});
			flash(res.ok ? t('settings.activityUploaded') : t('settings.activityUploadFailed'));
		} catch {
			flash(t('settings.activityUploadFailed'));   // never throws into the render tree
		} finally {
			uploading = false;
		}
	}
</script>

<!-- one more control in the EXISTING .actions row (:60-63) -->
<button class="item" onclick={uploadLog} disabled={uploading} use:tapBounce>
	<Upload size={18} /> {t('settings.activityUpload')}
</button>
```

### Shape of the upload handler (D-05 ordering)

```ts
// src/routes/api/diag/+server.ts — VERB EXPORTS ONLY. Helpers live in $lib/proxy/*.
import type { RequestHandler } from './$types';
import type { Env } from '$lib/proxy/proxy-types';
import { jsonResponse } from '$lib/proxy/http';            // Shared Primitive — 18 copies deduped
import { bearerMatches } from '$lib/proxy/diag-auth';
import { screenLogPayload, diagKey, MAX_UPLOAD_BYTES } from '$lib/proxy/diag-payload';

export const POST: RequestHandler = async ({ request, platform }) => {
	const origin = request.headers.get('origin');
	// platform?.env is the verified Cloudflare-adapter path for bindings/secrets.
	const env = platform?.env as Env | undefined;

	// D-01/D-03: fail CLOSED. An absent secret means "reject", never "skip the check".
	if (!(await bearerMatches(request.headers.get('authorization'), env?.DIAG_UPLOAD_TOKEN)))
		return jsonResponse({ ok: false, err: 'unauthorized' }, origin, { status: 401 });

	const bucket = env?.DIAG;
	if (!bucket) return jsonResponse({ ok: false, err: 'unconfigured' }, origin, { status: 503 });

	// D-05 step 1 — SCREEN on the declared length: zero CPU, no body read (Pitfall 4).
	if (Number(request.headers.get('content-length') ?? '0') > MAX_UPLOAD_BYTES)
		return jsonResponse({ ok: false, err: 'too-large' }, origin, { status: 413 });

	const text = await request.text();   // I/O, not CPU
	// D-05 steps 2+3 — re-check the real length (the header can lie), then PARSE + VALIDATE via
	// the already-tested parseActionLog. Returns the entry count, or null on reject.
	const entries = screenLogPayload(text);
	if (entries == null)
		return jsonResponse({ ok: false, err: 'invalid' }, origin, { status: 400 });

	// Store the RAW validated text — never a re-serialized array (CPU, and it would silently drop
	// any ActionLogEntry field parseActionLog's filter does not name).
	const key = diagKey(Date.now(), crypto.randomUUID());
	await bucket.put(key, text, { httpMetadata: { contentType: 'application/json' } });

	// jsonResponse with no ttl/cacheControl ⇒ no Cache-Control header at all. Correct here.
	return jsonResponse({ ok: true, key, entries }, origin);
};
```

### The pure validator (reuses `parseActionLog`)

```ts
// src/lib/proxy/diag-payload.ts — PURE, node-testable. D-05, modelled on safe-image-url.ts.
import { parseActionLog, ACTION_LOG_CAP } from '$lib/diagnostics/action-log-logic';

/** 512 KiB. Sized from a MEASURED full-cap payload (2000 entries × ~82 B ≈ 160 KB) with 3×
 *  headroom for name-heavy logs, and kept low enough that JSON.parse stays inside the Workers
 *  FREE 10ms CPU budget. Do NOT raise this to be "generous" — an oversized body then trades a
 *  clean 413 for an opaque CPU-limit 5xx (Pitfall 4). */
export const MAX_UPLOAD_BYTES = 512 * 1024;

/**
 * Screen → parse → validate, in that order (the safe-image-url.ts contract). Returns the entry
 * COUNT on accept and `null` on any rejection — a never-throw sentinel, exactly like
 * safeImageUrl's `string | null`. The route turns null into a status code; this stays pure.
 *
 * `text.length` counts UTF-16 code units, which UNDER-counts bytes for CJK track names by up to
 * 3×. Accepted deliberately: this is a safety bound, not an accounting figure, and
 * TextEncoder().encode() on a several-hundred-KB string costs real CPU we do not have.
 */
export function screenLogPayload(text: string): number | null {
	if (!text || text.length > MAX_UPLOAD_BYTES) return null;
	const entries = parseActionLog(text);        // PARSE + per-entry validate, already tested
	if (entries.length === 0) return null;       // empty, non-array, or every entry malformed
	if (entries.length > ACTION_LOG_CAP) return null;   // more than the client can even hold
	return entries.length;
}

/** Sortable key: lexicographic R2 list order == chronological order. `now`/`rand` are PARAMETERS
 *  so this is deterministic and directly testable (the reason it is not reading the clock). */
export function diagKey(now: number, rand: string): string {
	return `log/${new Date(now).toISOString().replace(/[:.]/g, '-')}-${rand.slice(0, 8)}.json`;
}
```

### Endpoint test harness (the established pattern)

Adapted from `src/routes/api/og/og-endpoint.test.ts:764-782`, the harness every endpoint test here
reuses:

```ts
// src/routes/api/diag/diag-endpoint.test.ts
import { describe, it, expect, vi } from 'vitest';
import { POST, GET } from './+server';

const ORIGIN = 'https://openmusic.lol';

/** In-memory R2 stand-in — same shape as og/resolve's stubCache(). */
function stubBucket() {
	const store = new Map<string, string>();
	return {
		put: vi.fn(async (k: string, v: string) => { store.set(k, v); }),
		get: vi.fn(async (k: string) => (store.has(k) ? { text: async () => store.get(k)! } : null)),
		list: vi.fn(async () => ({
			objects: [...store.keys()].map((key) => ({ key, size: store.get(key)!.length, uploaded: new Date() }))
		})),
		store
	};
}

function fakeEvent(body: string, headers: Record<string, string> = {}, env?: Record<string, unknown>) {
	const url = new URL('https://openmusic.lol/api/diag');
	return {
		url,
		// platform stays undefined by DEFAULT — an absent binding is a real, asserted state.
		platform: env ? { env } : undefined,
		request: new Request(url, { method: 'POST', body, headers: { origin: ORIGIN, ...headers } })
	};
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const callPOST = (e: ReturnType<typeof fakeEvent>) => POST(e as any);
```

Note the `as any` cast: the repo permits `as any` **in tests only** (CLAUDE.md: "all `as any` are in
tests"), and every existing endpoint test uses exactly this shim.

---

## State of the Art

| Old approach | Current approach | When changed | Impact here |
|---|---|---|---|
| Durable Objects were paid-plan only | DO available on Workers Free, **SQLite backend only** | 2025 | Does not rescue DO — the Pages "cannot define a DO class" restriction is independent of pricing |
| `platform.context` | `platform.ctx` | adapter-cloudflare 7.x | `src/app.d.ts:33` already notes `context` is `@deprecated`. Not used in this phase |
| `wrangler.toml` | `wrangler.jsonc` with `$schema` | wrangler 3.9x+ | Repo is already on the JSONC form |
| Per-route `corsHeaders` calls | Single `hooks.server.ts` seam | Phase 999.1 | New routes add no CORS code |
| 18 local `jsonResult`/`jsonPassthrough` copies | `jsonResponse` in `proxy/http.ts` | 2026-09-12 dedup sweep | Use it |
| 4 copies of the image-host guard | `proxy/safe-image-url.ts` | 2026-09-12 dedup sweep | The named D-05 precedent |

**Deprecated / not applicable:** R2's older "eventual consistency for list" caveats — current docs
state list-after-write is strongly consistent. KV's "60 second" figure is unchanged and current.

---

## Environment Availability

| Dependency | Required by | Available | Version | Fallback |
|---|---|---|---|---|
| Node | tooling | ✓ | ≥22 (`.nvmrc`, `engines`) | — |
| pnpm | build/test | ✓ | 8.15.5 (pinned) | — |
| wrangler | secrets + bucket creation | ✓ | 4.98.0 (devDep) | — |
| `@cloudflare/workers-types` | typing `R2Bucket` in `Env` | ✓ | 4.20260605.1, already in `tsconfig.json` `types` | — |
| Vitest | tests | ✓ | ^4.1.3, single node project | — |
| **Cloudflare account access for `openmusic`** | creating the R2 bucket, setting secrets | **✗** | — | **none — human step** |
| **R2 enabled on that account** | the chosen backend | **UNKNOWN** | — | KV (~6-line swap) |

### The blocking environment finding

`wrangler whoami` shows a valid OAuth login as `frank.chan@flowtheroom.com` with two accessible
accounts — `Flow Account (280bedba…)` and `Frank.chan@flowtheroom.com's Account (0b9e5c70…)`.
**Neither is the account hosting `openmusic`.** Wrangler resolves the Pages project against account
`f1868a071996e836eae6da2b65f37929` and gets `Authentication error [code: 10000]`:

```
GET https://api.cloudflare.com/client/v4/accounts/f1868a071996e836eae6da2b65f37929/pages/projects/openmusic/deployments
✘ [ERROR] … Authentication error [code: 10000]
```

That account id also appears in the 2026-09-01 wrangler log, so it is the real, long-standing home
of the project — the current OAuth token simply cannot reach it.
`[VERIFIED: wrangler whoami; wrangler pages project list; ~/Library/Preferences/.wrangler/logs/wrangler-2026-09-01_04-40-07_471.log:45]`

**Consequence for the plan:** no executor can create a bucket/namespace or set a secret on the
`openmusic` account from this machine, **for any backend choice**. The phase needs a
`checkpoint:human-verify` task covering:

1. `wrangler login` re-authenticated against account `f1868a07…` (or the equivalent dashboard work).
2. Enable R2 on that account (one-time checkout; free to start).
3. `wrangler r2 bucket create openmusic-diag`.
4. `wrangler pages secret put DIAG_UPLOAD_TOKEN` and `… DIAG_READ_TOKEN`
   (`openssl rand -hex 32` each).
5. Paste the R2 bucket name into `wrangler.jsonc` (the binding name `DIAG` is ours to choose; the
   bucket name must match what was created).

This is the single largest scheduling risk in the phase and it is **not** a code task.

### Also worth knowing

- On the reachable personal account, `wrangler kv namespace list` returns `[]` — KV works with no
  enablement step. `wrangler r2 bucket list` returns `[code: 10042] Please enable R2 through the
  Cloudflare Dashboard`. On the Flow work account, R2 *is* already enabled (three buckets exist), so
  the enablement flow is known-good for this user — just not yet done on the openmusic account.
  `[VERIFIED: wrangler kv namespace list / r2 bucket list per account]`
- The R2 binding is **absent under `vite dev`** — `platform` is `undefined` locally, exactly as it
  is in unit tests. The route's 503-on-missing-binding branch is therefore the *normal* local-dev
  behaviour, not an error state. `wrangler pages dev .svelte-kit/cloudflare` (`pnpm preview`) with
  a local R2 simulation is the closest local approximation.

---

## Validation Architecture

### Test framework

| Property | Value |
|---|---|
| Framework | Vitest `^4.1.3` |
| Config | `vite.config.ts` — a **single** project named `server`, `environment: 'node'`, **no jsdom** |
| Include | `src/**/*.{test,spec}.{js,ts}` (co-located; `.svelte.test.ts` also runs here) |
| Notable | `expect: { requireAssertions: true }` — **a test with no assertion FAILS**. Every test must assert something |
| Quick + full run | `pnpm test` (`vitest --run`) |
| Type gate | `pnpm check` (`svelte-kit sync && svelte-check`) |
| **Verified baseline** | **110 test files, 2023 tests passing, 8.97 s** `[VERIFIED: ran pnpm test this session]` |

### Behaviour → validation map

| Behaviour | Type | Command | Exists? |
|---|---|---|---|
| `screenLogPayload` rejects oversize / empty / non-array / all-malformed; accepts a real log | unit | `pnpm test -- diag-payload` | ❌ new `src/lib/proxy/diag-payload.test.ts` |
| `diagKey` is sortable and collision-resistant | unit | `pnpm test -- diag-payload` | ❌ same file |
| `bearerMatches` — rejects missing header, wrong scheme, wrong token, **and an undefined expected value (fail closed)**; accepts the right one | unit | `pnpm test -- diag-auth` | ❌ new `src/lib/proxy/diag-auth.test.ts` |
| `corsHeaders` includes `Authorization` in Allow-Headers | unit | `pnpm test -- http` | ⚠️ extend existing `src/lib/proxy/http.test.ts` |
| POST 401 with no/bad token; 503 with no binding; 413 oversize; 400 malformed; 200 + key on success; **nothing written to the bucket on any reject path** | endpoint | `pnpm test -- diag-endpoint` | ❌ new, harness copied from `og-endpoint.test.ts:764-782` |
| GET list returns keys; GET `?key=` returns the body; both 401 without the read token | endpoint | same file | ❌ new |
| **Upload token never appears in any response body** | endpoint | same file (assert on serialized response) | ❌ new — parity with `translate/server.test.ts`'s "no provider key leaks into the body (T-25c-01)" |
| 15 locales carry every new key | unit | `pnpm test -- i18n` | ✅ `i18n.test.ts:51-56` already enforces it, automatically |
| Types compile (`R2Bucket` in `Env`, new `TranslationKey`s) | typecheck | `pnpm check` | ✅ existing gate |

### What unit tests structurally CANNOT prove

Be explicit about this, because the harness's realism has bitten this project before —
`resolve-endpoint.test.ts:8-11` already documents that `edgeCache()` returns null under Vitest "by
design, so REAL Cache API semantics are not provable here".

| Not provable in Vitest | Why | Where it gets proven |
|---|---|---|
| The `+server.ts` exports only legal route members | Tests import the module directly and bypass SvelteKit route-module validation. **This 500'd production once (`29c1c7d`)** | A real request against a deploy |
| R2 binding actually resolves via `platform.env` | `platform` is `undefined` under Vitest and `vite dev` | Deployed preview, or `pnpm preview` (wrangler pages dev) |
| R2 read-after-write / list-after-write consistency | In-memory Map is trivially consistent | Deployed edge, by observation |
| Secrets reach `platform.env` from `wrangler pages secret put` | Not a local mechanism | Deployed edge |
| The Workers Free 10 ms CPU budget holds for a full 512 KiB payload | No CPU metering in node | Deployed edge, upload a real full-cap log |
| **APK CORS preflight with `Authorization`** | No browser, no WebView, no cross-origin in the node project | **Device only** — Pitfall 2 |
| `prompt()` works in the Capacitor Android WebView | No DOM | **Device only** |

### Three validation tiers

**Tier 1 — local, every commit.** `pnpm check` + `pnpm test`. Gate: **2023 baseline tests still
green** plus the new ones. This covers all pure logic — which, by design, is where the auth check
and the D-05 validator live.

**Tier 2 — deployed edge, requires a user-approved push (Pitfall 1).** Against the real deploy:
```bash
curl -sS -X POST https://openmusic.lol/api/diag \
  -H "Authorization: Bearer $DIAG_UPLOAD_TOKEN" -H 'content-type: application/json' \
  --data-binary @sample-log.json -i          # expect 200 + {"ok":true,"key":"log/…"}

curl -sS https://openmusic.lol/api/diag -H "Authorization: Bearer $DIAG_READ_TOKEN"
curl -sS "https://openmusic.lol/api/diag?key=log/…" -H "Authorization: Bearer $DIAG_READ_TOKEN"

curl -sS -X POST https://openmusic.lol/api/diag -d '[]' -i          # expect 401 (no token)
curl -sS -X POST https://openmusic.lol/api/diag \
  -H "Authorization: Bearer wrong" -d '[]' -i                       # expect 401
head -c 600000 /dev/urandom | base64 | curl -sS -X POST https://openmusic.lol/api/diag \
  -H "Authorization: Bearer $DIAG_UPLOAD_TOKEN" --data-binary @- -i # expect 413, NOT a 5xx
```
The first curl is also the only thing that proves the route module has no illegal export. A 500 with
"Invalid export" here is Pitfall 6, not a logic bug.

**Tier 3 — device, human only.** Build with `pnpm apk` (note the known `JAVA_HOME` gotcha at
STATE.md:45: set `JAVA_HOME=/opt/homebrew/opt/openjdk@21/libexec/openjdk.jdk/Contents/Home`),
install, then on the phone: Settings → Activity log → Upload log.
- Does `prompt()` appear? (If not, switch to the text-input option.)
- Does the upload succeed, or fail with a CORS error? (A CORS failure here is Pitfall 2.)
- Then fetch the same log from the laptop within ~10 s and confirm it is there — this is the
  R2-consistency claim being checked against the real workflow, and it is the phase's actual
  success criterion.

### Wave 0 gaps

- [ ] `src/lib/proxy/diag-auth.test.ts` — including the **fail-closed on undefined secret** case
- [ ] `src/lib/proxy/diag-payload.test.ts` — size / shape / entry-count boundaries + `diagKey`
- [ ] `src/routes/api/diag/diag-endpoint.test.ts` — harness copied from `og-endpoint.test.ts:764-782`
- [ ] Extend `src/lib/proxy/http.test.ts` with the `Authorization` Allow-Headers assertion
- [ ] No framework install needed; no new fixture infrastructure needed

---

## Security Domain

### Applicable ASVS categories

| Category | Applies | Standard control here |
|---|---|---|
| V2 Authentication | **yes** | Bearer token from `platform.env`, `bearerMatches` digest-compare, **fail closed** when unset |
| V3 Session Management | no | Stateless bearer; no sessions |
| V4 Access Control | **yes** | Two tokens, split by capability — write-only on the device, read-only on the maintainer's laptop. Deny by default |
| V5 Input Validation | **yes** | D-05: `Content-Length` screen → length re-check → `parseActionLog` → entry-count cap, modelled on `safe-image-url.ts` |
| V6 Cryptography | **partial** | `crypto.subtle.digest('SHA-256')` only; no key material handled. Token generation delegated to `openssl rand -hex 32` |
| V7 Error Handling & Logging | **yes** | Short error codes (`unauthorized`/`too-large`/`invalid`/`unconfigured`), never an upstream message or stack. No secret in any response body |
| V13 API | **yes** | CORS inherited from the single `hooks.server.ts` seam; origin allowlist, never `*` |

### Threat patterns for this stack

| Pattern | STRIDE | Mitigation |
|---|---|---|
| Unauthenticated write → storage-quota abuse | DoS | Bearer gate before any body read; 512 KiB cap; R2 free tier is 10 GB and 1M Class A ops/month |
| Token leak via response echo | Information disclosure | Assert in tests that no response body contains the token — direct parity with `translate/server.test.ts`'s T-25c-01 test |
| Token in the client bundle | Information disclosure | D-03: no `VITE_` prefix, ever (Pitfall 3) |
| Read token exfiltrated from a device | Information disclosure | The read token **never goes on a device**. That is the entire point of the two-token split |
| Upload token exfiltrated from localStorage (XSS) | Information disclosure | Accepted for v1 under D-01 (maintainer's own device); blast radius is junk uploads, **not** log reads. Rotate via `wrangler pages secret put` |
| Timing oracle on the token compare | Information disclosure | Digest-then-XOR, no early exit, fixed 32-byte comparison |
| CORS widened to `*` to "fix" the APK | Elevation of privilege | Explicitly forbidden. The origin is already allowlisted; fix the header *name* (Pitfall 2) |
| Log content itself is personal data | Information disclosure | D-01 scopes v1 to the maintainer's own device, so no third party's data is collected. Multi-user privacy work is explicitly deferred |
| Path traversal via the `?key=` param | Tampering | Screen the key against `/^log\/[A-Za-z0-9._-]+\.json$/` before `bucket.get`. R2 keys are flat strings so this is defence-in-depth, but it costs one regex |

---

## Assumptions Log

| # | Claim | Section | Risk if wrong |
|---|---|---|---|
| A1 | `prompt()` works in the Capacitor 8 Android WebView | Auth Mechanism | Token cannot be entered on the APK. Mitigation is pre-planned (text input option), so the fallback is a ~15-line change, not a redesign |
| A2 | The `openmusic` Cloudflare account is on the **Workers Free** plan (10 ms CPU) | Pitfall 4 | If it is Paid the 512 KiB cap is merely conservative — no harm. Assuming Free is the safe direction |
| A3 | R2 can be enabled on account `f1868a07…` without a paid commitment | Storage / Environment | If enablement is refused, fall back to KV (~6-line swap) and accept the 60 s propagation |
| A4 | A ~300 KB `JSON.parse` + 2000-entry filter fits inside 10 ms CPU on workerd | Pitfall 4 | Large uploads 5xx instead of returning cleanly. Detectable in Tier 2 with a full-cap payload; mitigation is lowering the cap |
| A5 | Timing attacks on the bearer compare are infeasible over the public internet | Auth Mechanism | Low — the constant-time compare is implemented regardless |
| A6 | `crypto.subtle.digest('SHA-256')` behaves identically on workerd and Node 22 | Auth Mechanism | Tests pass locally but the helper misbehaves on the edge. Both are standard Web Crypto, so this is low risk; Tier 2 curl proves it |
| A7 | R2 `list()` returns keys in lexicographic UTF-8 order | Key naming | The list is unordered and the maintainer sorts client-side — cosmetic |

---

## Open Questions

1. **Which Cloudflare plan is the `openmusic` account on?**
   - Known: the project lives on account `f1868a071996e836eae6da2b65f37929`; the current wrangler
     OAuth token cannot reach it.
   - Unclear: Workers Free vs Paid, which sets the CPU ceiling at 10 ms or 30 s.
   - Recommendation: design for Free (512 KiB cap). Costs nothing if it turns out to be Paid.

2. **Will the account owner enable R2?**
   - Known: enablement is a one-time free dashboard checkout; the user has already done it on their
     Flow work account, so the flow is familiar.
   - Unclear: whether they want an R2 subscription attached to this account.
   - Recommendation: put it in the human-checkpoint task with the KV fallback spelled out, so a
     "no" costs a ~6-line edit and not a replan.

3. **One route file with `GET ?key=`, or `api/diag/[key]/+server.ts`?**
   - Known: D-02 requires list + fetch-one; both forms satisfy it; the repo has precedent for both.
   - Recommendation: single file with `?key=`. Fewer files, and it avoids URL-encoding the `/` in
     `log/…` keys. Note the `[key]` alternative in the plan for the reviewer.

4. **Add `Authorization` to the shared `Access-Control-Allow-Headers`, or carry the upload token in
   the request body?**
   - Known: the header change is one word in `http.ts:34` and is safe (Allow-Headers grants nothing
     to a non-allowlisted origin); the body-token version avoids touching a shared security seam
     entirely.
   - Recommendation: the header addition, with a new `http.test.ts` assertion. It is the smaller and
     more legible diff, and any future authenticated `/api/*` route needs it anyway.

5. **`text.length` (UTF-16 units) or true byte length for the cap?**
   - Known: `text.length` under-counts CJK bytes up to 3×; `TextEncoder().encode()` costs real CPU
     on a several-hundred-KB string, and CPU is the scarce resource (Pitfall 4).
   - Recommendation: `text.length`, with a comment stating the approximation. The cap is a safety
     bound, not an accounting figure.

---

## Sources

### Primary (HIGH confidence)

**Codebase, read directly this session:**
- `src/lib/diagnostics/action-log-logic.ts` (86 lines) + `action-log-logic.test.ts`
- `src/lib/stores/actionLog.svelte.ts` (103 lines)
- `src/routes/(app)/settings/activity/+page.svelte` (98 lines)
- `src/routes/(app)/settings/data/+page.svelte` — `confirm()` / `flash()` precedent
- `src/lib/proxy/http.ts` (`jsonResponse`:112, `corsHeaders`:32, `ALLOWED_ORIGIN_PATTERNS`:12) + `http.test.ts`
- `src/lib/proxy/safe-image-url.ts` + `safe-image-url.test.ts`
- `src/lib/proxy/proxy-types.ts`, `src/lib/proxy/edge-cache.ts`, `src/app.d.ts`
- `src/hooks.server.ts`
- `src/lib/services/api-base.ts` (`apiUrl`:37, `apiFetch`:249, governor + circuit breaker)
- `src/routes/api/translate/+server.ts` + `server.test.ts`; `src/routes/api/resolve/+server.ts` + test;
  `src/routes/api/og/og-endpoint.test.ts` (harness at :764-782)
- `src/lib/i18n/index.ts`, `en.ts`, `i18n.test.ts`
- `wrangler.jsonc`, `svelte.config.js`, `vite.config.ts`, `tsconfig.json`, `package.json`, `.dev.vars`
- `.claude/skills/spike-findings-openmusic/SKILL.md`

**Commands run:**
- `pnpm test` → 110 files / **2023 tests** passing, 8.97 s
- `node -e` payload sizing → 81 B/entry, ~160 KB at the 2000 cap
- `npx wrangler whoami` → two accounts, neither hosting `openmusic`
- `npx wrangler kv namespace list` / `r2 bucket list` per account → KV OK; R2 `[code: 10042]` on personal
- `npx wrangler pages project list` → `[code: 10000]` against account `f1868a07…`

**Cloudflare documentation:**
- developers.cloudflare.com/kv/platform/limits/ — KV free tier, 25 MiB value ceiling
- developers.cloudflare.com/kv/concepts/how-kv-works/ — 60 s propagation, cached negative lookups
- developers.cloudflare.com/r2/pricing/ — 10 GB-mo, 1M Class A, 10M Class B, free egress
- developers.cloudflare.com/r2/reference/consistency/ — strong read-after-write + list-after-write
- developers.cloudflare.com/r2/get-started/ — R2 subscription prerequisite
- developers.cloudflare.com/d1/platform/limits/ + /pricing/ — 2 MB row, 100 KB statement, free-tier rows
- developers.cloudflare.com/durable-objects/platform/pricing/ — free tier, SQLite-only
- developers.cloudflare.com/pages/functions/bindings/ — **"You cannot create and deploy a Durable Object within a Pages project"**
- developers.cloudflare.com/pages/functions/wrangler-configuration/ — binding syntax, non-inheritable keys
- developers.cloudflare.com/workers/platform/limits/ — 100 MB body (Free/Pro), **10 ms CPU on Free**
- developers.cloudflare.com/workers/runtime-apis/web-crypto/ — `crypto.subtle.timingSafeEqual` is a CF extension

**Project memory (prior verified sessions):**
- `svelte-server-endpoint-only-verb-exports` — the "Invalid export" 500 (commit `29c1c7d`)
- `openmusic-pushes-autodeploy-live` — push to main auto-deploys production
- `api-fetch-flood-freeze` — the three freeze incidents behind D-04
- `pnpm-deploy-name-collision` — use `pnpm run deploy`
- `i18n-files-use-double-quotes` — the manual, unenforced convention
- `grep-false-empty-trust-read-sed` — cross-check audits with `sed`/Read

### Secondary (MEDIUM confidence)

- `.planning/STATE.md:45` — `JAVA_HOME` gotcha for `pnpm apk`
- `.planning/STATE.md:51` — Phase 27 E2E caught the illegal-export 500

### Tertiary (LOW confidence — flagged for validation)

- `prompt()` behaviour in the Capacitor 8 Android WebView (A1) — device check only
- Actual CPU cost of a 300 KB `JSON.parse` + 2000-entry filter on workerd (A4) — Tier 2 check

---

## Metadata

**Confidence breakdown:**

| Area | Level | Reason |
|---|---|---|
| Codebase reuse map | **HIGH** | Every file read directly; line numbers verified |
| Storage backend (D-07) | **HIGH** | All four free tiers fetched from current docs; DO's Pages restriction is a direct quote; R2/KV consistency quoted verbatim |
| Route + test mechanics | **HIGH** | Ten existing endpoint tests follow one harness; the illegal-export landmine is a recorded production incident |
| i18n cost | **HIGH** | Dictionary count verified against `index.ts` imports, correcting CONTEXT.md's 16 → **15** |
| Auth mechanism | **MEDIUM-HIGH** | Two-token design and the digest-compare are sound and testable; `prompt()` on the APK is unverified |
| Environment / provisioning | **HIGH (as a finding)** | Empirically verified that the openmusic account is unreachable from this machine — which is precisely why it must be a human checkpoint |
| CPU-budget risk | **MEDIUM** | The 10 ms Free limit is cited; the actual parse cost for this payload is reasoned, not measured on workerd |

**Research date:** 2026-09-12
**Valid until:** 2026-10-12 (30 days). Cloudflare free-tier numbers move a few times a year; re-check
the R2 and KV limits pages if planning slips past that. Codebase findings are valid until the files
change.
