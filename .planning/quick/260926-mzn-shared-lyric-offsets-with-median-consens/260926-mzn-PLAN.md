---
phase: quick-260926-mzn
plan: 01
type: execute
wave: 1
depends_on: []
files_modified:
  - src/lib/proxy/lyric-offset.ts
  - src/lib/proxy/lyric-offset.test.ts
  - src/routes/api/lyric-offset/+server.ts
  - src/routes/api/lyric-offset/lyric-offset-endpoint.test.ts
  - src/lib/services/lyric-offset-shared.ts
  - src/lib/services/lyric-offset-shared.test.ts
  - src/lib/stores/lyric-offset.svelte.ts
  - src/lib/stores/lyric-offset.svelte.test.ts
  - src/lib/components/NpLyrics.svelte
  - src/lib/components/Nowbar.svelte
  - src/lib/i18n/en.ts
  - src/lib/i18n/ar.ts
  - src/lib/i18n/de.ts
  - src/lib/i18n/es.ts
  - src/lib/i18n/fr.ts
  - src/lib/i18n/hi.ts
  - src/lib/i18n/id.ts
  - src/lib/i18n/it.ts
  - src/lib/i18n/pt.ts
  - src/lib/i18n/ru.ts
  - src/lib/i18n/th.ts
  - src/lib/i18n/tr.ts
  - src/lib/i18n/vi.ts
  - src/lib/i18n/zh-Hans.ts
  - src/lib/i18n/zh-Hant.ts
autonomous: true
requirements: [QUICK-260926-mzn]
tags: [lyrics, lrc, offset, r2, edge, consensus, i18n]

must_haves:
  truths:
    - "A user with NO local offset for a song whose lyrics have >=3 agreeing votes sees the consensus offset applied in the lyrics pane and the Nowbar line, with a 'Synced by listeners' label"
    - "A user's own local offset (including an explicit 0) always beats the shared consensus"
    - "Holding a line or nudging submits ONE vote ~4s after the last change; reset never votes and cancels a pending vote"
    - "GET /api/lyric-offset?k=<32hex> answers {ok,offset,n} (offset null unless >=3 votes agree within +-1.0s of the median), cacheable 300s; a bad key is 400 and never reaches R2"
    - "POST /api/lyric-offset stores one vote per (salted-IP voter, key), capped at 50 most recent, via conditional R2 put; the raw IP is never stored or returned; keys outside lyric-offset/ are unreachable"
    - "Under vite dev (no DIAG binding) both verbs answer 503 and the client silently shows no shared offset"
  artifacts:
    - path: "src/lib/proxy/lyric-offset.ts"
      provides: "Pure key/record/vote/consensus helpers + voterId"
      exports: ["isOffsetKey", "offsetObjectKey", "parseVoteBody", "parseRecord", "applyVote", "consensus", "voterId", "MAX_VOTE_BODY_BYTES", "MAX_VOTES", "AGREE_MIN", "AGREE_WINDOW_SEC", "SHARED_OFFSET_TTL"]
    - path: "src/routes/api/lyric-offset/+server.ts"
      provides: "GET + POST verb handlers ONLY"
      exports: ["GET", "POST"]
    - path: "src/lib/services/lyric-offset-shared.ts"
      provides: "Never-throw client service: fingerprint key, fetch consensus, submit vote"
      exports: ["lyricOffsetKey", "fetchSharedOffset", "submitOffsetVote"]
    - path: "src/lib/stores/lyric-offset.svelte.ts"
      provides: "Local (explicit 0 stored) + in-memory shared layer, effective read, ensure/vote/reset"
      exports: ["getEffectiveLyricOffset", "isSharedLyricOffset", "ensureSharedLyricOffset", "scheduleLyricOffsetVote", "resetLyricOffset", "clearLyricOffset", "hasLocalLyricOffset"]
  key_links:
    - from: "src/lib/components/NpLyrics.svelte"
      to: "src/lib/stores/lyric-offset.svelte.ts"
      via: "getEffectiveLyricOffset in the lyricOffset $derived"
      pattern: "getEffectiveLyricOffset\\(player\\.current\\?\\.uid\\)"
    - from: "src/lib/components/Nowbar.svelte"
      to: "src/lib/stores/lyric-offset.svelte.ts"
      via: "getEffectiveLyricOffset in the lyricOffset $derived"
      pattern: "getEffectiveLyricOffset\\(player\\.current\\?\\.uid\\)"
    - from: "src/lib/stores/lyric-offset.svelte.ts"
      to: "src/lib/services/lyric-offset-shared.ts"
      via: "ensureSharedLyricOffset -> lyricOffsetKey + fetchSharedOffset; vote timer -> submitOffsetVote"
      pattern: "fetchSharedOffset|submitOffsetVote"
    - from: "src/lib/services/lyric-offset-shared.ts"
      to: "src/lib/services/api-base.ts"
      via: "apiFetch (governor: dedupe, cap, timeout, breaker)"
      pattern: "apiFetch\\("
    - from: "src/routes/api/lyric-offset/+server.ts"
      to: "platform.env.DIAG"
      via: "bucket.get / bucket.put with onlyIf under the lyric-offset/ prefix only"
      pattern: "offsetObjectKey\\("
---

<objective>
Shared lyric time offsets with median consensus. When a user explicitly realigns a song's lyrics (hold-a-line or +-0.5s nudge, shipped in quick-260926-mis), their final offset is submitted as a VOTE to a shared edge store (the existing `DIAG` R2 bucket, new `lyric-offset/` prefix, no infra change). A user with NO local offset for that song receives the consensus automatically: the median of all votes, trusted only when >=3 votes agree within +-1.0s of it. The key is a fingerprint of `uid + raw LRC text`, so a different lyrics pick never inherits a stale alignment. Local offset always wins; an explicit local 0 is the opt-out.

Purpose: one listener fixes a live-intro alignment once; everyone else gets it for free, without anyone being able to force a bad alignment on a user who already fixed their own.

Output: pure server helpers + tests, `/api/lyric-offset` GET/POST + fake-R2 route tests, never-throw client service + tests, the store's shared layer (unset vs explicit 0) + tests, NpLyrics/Nowbar reading the EFFECTIVE offset with a "Synced by listeners" label, one new i18n key in all 15 locales.
</objective>

<execution_context>
@/Users/laichan/.claude/plugins/cache/gsd-plugin/gsd/4.5.3/workflows/execute-plan.md
@/Users/laichan/.claude/plugins/cache/gsd-plugin/gsd/4.5.3/templates/summary.md
</execution_context>

<context>
@.planning/STATE.md
@.planning/quick/260926-mis-per-song-lyrics-time-realign-offset-for-/260926-mis-SUMMARY.md
@./CLAUDE.md

Read once, extract everything, do not re-read:
@src/lib/stores/lyric-offset.svelte.ts
@src/lib/stores/lyric-offset.svelte.test.ts
@src/lib/components/NpLyrics.svelte
@src/lib/services/lrc.ts
@src/lib/stores/lyric-pins.svelte.ts
@src/routes/api/diag/+server.ts
@src/routes/api/diag/diag-endpoint.test.ts
@src/lib/proxy/diag-payload.ts
@src/lib/proxy/diag-auth.ts
@src/lib/proxy/http.ts
@src/lib/proxy/edge-cache.ts
@src/lib/services/api-base.ts

Grep-only (do not read whole files): `src/lib/components/Nowbar.svelte` lines 35-38 (imports, double-quoted), 83-85 (`lyricLines`/`lyricOffset` deriveds), 116-125 (`lyricsRow` gate + `activeLineAt` call). `src/routes/api/lastfm/info/+server.ts` lines 255-300 (edge-cache match/put idiom). `src/routes/api/proxy.test.ts` lines 147-163 (`makeFakeCache` stub shape) and 173-177 (`vi.unstubAllGlobals` in afterEach).

<interfaces>
<!-- Existing contracts the executor builds against. Verified from source. -->

From src/lib/services/lrc.ts:
  export const LYRIC_OFFSET_MAX = 600;
  export function normalizeLyricOffset(n: number): number;   // non-finite -> 0, clamp +-600, round 0.1, -0 -> 0
  export function formatLyricOffset(sec: number): string;    // "+0.0s" / "−2.3s"
  export function activeLineAt(lines, now, offsetSec = 0): { idx: number; time: number };
  export function lineSeekFraction(time, duration, offsetSec = 0): number | null;

From src/lib/stores/lyric-offset.svelte.ts (CURRENT — Task 2 changes it):
  export function lyricOffsetVersion(): number;              // reactive dep on writes
  export function getLyricOffset(uid): number;               // local, 0 when unset
  export function setLyricOffset(uid, sec): void;            // CURRENTLY deletes at 0 (Task 2: stores 0)
  localStorage key 'openmusic:lyric-offset:v1' = Record<uid, number>; private readRec()

From src/lib/stores/lyric-pins.svelte.ts:
  export function readLyrics(track: Track | null | undefined): string | null;  // the RAW LRC source string; reactive dep on lyricVersion()

From src/lib/proxy/http.ts:
  export function jsonResponse(body: unknown, origin: string | null, opts?: { ttl?: number; status?: number; cacheControl?: string }): Response;
  // ttl -> 'Cache-Control: public, max-age=<ttl>'; no ttl -> no Cache-Control header

From src/lib/proxy/edge-cache.ts:
  export interface EdgeCache { match(req): Promise<Response | undefined>; put(req, res): Promise<void>; delete(req): Promise<boolean> }  // delete = PoP-LOCAL bust
  export function edgeCache(): EdgeCache | null;             // null under vite dev (no Cache API)
  export function ownOriginCacheKey(url: URL | string): Request;

From src/lib/proxy/proxy-types.ts:
  export interface Env { ...; DIAG?: R2Bucket; ... }         // R2Bucket is a GLOBAL type (@cloudflare/workers-types in tsconfig `types`)

From src/lib/proxy/diag-payload.ts:
  export function isDiagKey(key: string | null): key is string;   // /^log\/[A-Za-z0-9._-]+\.json$/

From src/lib/services/api-base.ts:
  export function apiFetch(path: string, init?: RequestInit): Promise<Response>;  // GET dedupe + cap 8 + 25s timeout + circuit breaker (5xx/429 count as failures)
  export function __resetGovernor(): void;                   // TEST-ONLY

From @cloudflare/workers-types (globals):
  R2Bucket.get(key): Promise<R2ObjectBody | null>            // R2ObjectBody has .text(), .etag (unquoted), .httpEtag (quoted)
  R2Bucket.put(key, value, { httpMetadata?, onlyIf?: R2Conditional | Headers }): Promise<R2Object | null>  // null = precondition FAILED, nothing stored
  interface R2Conditional { etagMatches?: string; etagDoesNotMatch?: string; ... }

SvelteKit RequestEvent:
  event.getClientAddress(): string   // adapter-cloudflare returns request.headers.get('cf-connecting-ip') (may be null at runtime despite the type); some adapters THROW when unavailable — wrap in try/catch
</interfaces>
</context>

<tasks>

<task type="auto" tdd="true">
  <name>Task 1: Server — pure consensus helpers + /api/lyric-offset route, both tested against a fake R2 bucket</name>
  <files>src/lib/proxy/lyric-offset.ts, src/lib/proxy/lyric-offset.test.ts, src/routes/api/lyric-offset/+server.ts, src/routes/api/lyric-offset/lyric-offset-endpoint.test.ts</files>
  <behavior>
    Pure module (src/lib/proxy/lyric-offset.test.ts):
    - isOffsetKey: 32 lowercase hex -> true; null / '' / 31 chars / 33 chars / uppercase hex / '../x' / a `log/...` string -> false
    - offsetObjectKey('ab'.repeat(16)) === 'lyric-offset/' + 'ab'.repeat(16) + '.json'; isDiagKey(offsetObjectKey(k)) === false (import isDiagKey from $lib/proxy/diag-payload; the two prefixes are provably disjoint)
    - parseVoteBody: '{"k":"<32hex>","offset":2.34}' -> {k, offset: 2.3}; offset -0 -> 0; non-JSON / array / missing k / bad k / offset string / NaN / Infinity / 600.1 / -600.1 -> null; offset exactly 600 and -600 accepted; extra fields ignored
    - parseRecord: null / '' / 'not json' / '[]' / '{"v":2,"votes":{}}' -> {v:1, votes:{}}; a votes map containing a non-object, a non-number o, a non-number t, or an out-of-range o is DROPPED entry-by-entry (never throws); a valid record round-trips
    - applyVote: returns a NEW object (input untouched); same voter re-vote REPLACES (count unchanged, o and t updated); 51st distinct voter -> exactly MAX_VOTES (50) kept and the one with the SMALLEST t is the one dropped
    - consensus: {} -> {offset:null, n:0}; 2 agreeing votes -> {null, 2}; 3 votes all 1.5 -> {1.5, 3}; [1, 1.2, 1.1] -> median 1.1 -> {1.1, 3}; [1, 1.1, 30] -> median 1.1, only 2 within +-1.0 -> {null, 3}; [1, 1.2, 1.1, 30, -20] -> median 1.1, agree 3 -> {1.1, 5}; even count [1, 2, 2, 3] -> median 2 -> agree 4 -> {2, 4}; [0.96, 0.96, 0.96, 0.96] -> rounds to {1, 4} via normalizeLyricOffset; boundary: a vote exactly 1.0 from the median COUNTS as agreeing
    - voterId('1.2.3.4', k): matches /^[0-9a-f]{16}$/; deterministic; differs for a different k with the same ip; differs for a different ip; does not contain '1.2.3.4'
    Route (src/routes/api/lyric-offset/lyric-offset-endpoint.test.ts):
    - GET: missing k / 'ZZ..' / 31 hex / '../x' -> 400 {ok:false, err:'invalid-key'} and bucket.get NOT called; valid k but no DIAG binding -> 503 {ok:false, err:'unconfigured'}; no platform at all -> 503 (NOT a throw); valid k + binding + no object -> 200 {ok:true, offset:null, n:0} with Cache-Control 'public, max-age=300' and bucket.get called with EXACTLY 'lyric-offset/<k>.json'; seeded object with 3 agreeing votes -> {ok:true, offset:<median>, n:3}; the response text never contains the substring 'votes' nor any voter id; with a stubbed `caches` whose match returns a stored Response -> 200 served from cache and bucket.get NOT called; on a miss with `caches` stubbed -> cache.put called once with the GET's own-origin URL
    - POST: no binding -> 503 and put NOT called; content-length header '600' -> 413 {ok:false, err:'too-large'} BEFORE the body is read (put not called); a 300-char body with no content-length header -> 413; 'not json' / '{"k":"bad","offset":1}' / '{"k":"<k>","offset":"1"}' / '{"k":"<k>","offset":1e9}' -> 400 {ok:false, err:'invalid'} and put NOT called; getClientAddress returning null (and one THROWING) -> 400 {ok:false, err:'no-address'} and put NOT called; first valid vote -> 200 {ok:true, offset:null, n:1}, put called ONCE with key 'lyric-offset/<k>.json', a JSON string body, `httpMetadata: {contentType:'application/json'}` and `onlyIf: { etagDoesNotMatch: '*' }`; the stored record text does NOT contain the raw IP; same IP votes again -> n stays 1, offset replaced, put called with `onlyIf: { etagMatches: <etag returned by the fake get> }`; three distinct IPs voting 2.0 -> third reply {ok:true, offset:2, n:3}; response has NO Cache-Control header; a bucket whose put ALWAYS returns null -> 409 {ok:false, err:'conflict'} after exactly 3 put attempts; with `caches` stubbed, a successful POST calls cache.delete exactly once with a Request whose url === 'https://openmusic.lol/api/lyric-offset?k=<k>'
  </behavior>
  <action>
    **Pure module `src/lib/proxy/lyric-offset.ts`** (quick-260926-mzn). No I/O, no HTTP status knowledge (same posture as `diag-payload.ts`). Import `normalizeLyricOffset` and `LYRIC_OFFSET_MAX` from `$lib/services/lrc` (pure .ts, already shared client/edge). Export:
    - constants `MAX_VOTE_BODY_BYTES = 256`, `MAX_VOTES = 50`, `AGREE_MIN = 3`, `AGREE_WINDOW_SEC = 1.0`, `SHARED_OFFSET_TTL = 300`.
    - types `OffsetVote = { o: number; t: number }`, `OffsetRecord = { v: 1; votes: Record<string, OffsetVote> }`.
    - `isOffsetKey(k: string | null): k is string` — exactly `/^[0-9a-f]{32}$/`.
    - `offsetObjectKey(k: string): string` — returns `lyric-offset/${k}.json`. Comment: the ONLY place an R2 key is built for this feature; callers pass a value that has already passed `isOffsetKey`, so this endpoint can never touch `log/` (private listening logs, read-token gated) or list anything.
    - `emptyRecord()`, `parseRecord(text)` — never-throw; anything not `{v:1, votes:{object}}` becomes empty; each entry kept only if `o` is a finite number with `|o| <= LYRIC_OFFSET_MAX` and `t` a finite number.
    - `parseVoteBody(text)` — never-throw; JSON object with `k` passing `isOffsetKey` and `offset` a finite number with `|offset| <= LYRIC_OFFSET_MAX` (REJECT out-of-range rather than clamp: a 1e9 vote is not our client); returns `{ k, offset: normalizeLyricOffset(offset) }` or `null`.
    - `applyVote(rec, voter, offset, now)` — pure, returns a new record with `votes[voter] = { o: offset, t: now }`; if more than `MAX_VOTES` entries remain, keep the `MAX_VOTES` with the largest `t` (sort entries by t desc, slice).
    - `consensus(rec)` — `n` = vote count; median of all `o` (sorted; even count = mean of the two middle values); `agree` = count of votes with `|o - median| <= AGREE_WINDOW_SEC`; `offset = agree >= AGREE_MIN ? normalizeLyricOffset(median) : null`. Returns `{ offset, n }` only — never the votes.
    - `voterId(ip, k)` — `crypto.subtle.digest('SHA-256', TextEncoder(`${ip}|${k}`))` -> hex -> first 16 chars (same digest idiom as `diag-auth.ts`; `crypto.subtle` + `TextEncoder` are globals on workerd AND Node 22 so the tested path IS the edge path). Comment: per-key salt so one voter's ids are not linkable across songs; the raw IP is never stored or returned.

    **Route `src/routes/api/lyric-offset/+server.ts`** — export ONLY `GET` and `POST` (a top-level helper export 500s at request time, see the diag route header). Imports: `jsonResponse` from `$lib/proxy/http`, `edgeCache`/`ownOriginCacheKey` from `$lib/proxy/edge-cache`, `Env` type, and the pure module.
    - `GET({ url, request, platform })`: origin = request origin header; `k = url.searchParams.get('k')`; `!isOffsetKey(k)` -> 400 `{ok:false, err:'invalid-key'}` (cheapest check first, before any binding/I/O). `bucket = (platform?.env as Env | undefined)?.DIAG`; absent -> 503 `{ok:false, err:'unconfigured'}`. Edge cache per the lastfm/info idiom: `cache = edgeCache()`, `cacheReq = ownOriginCacheKey(url)`; on `cache.match` hit return `jsonResponse(await hit.json(), origin, { ttl: SHARED_OFFSET_TTL })` (re-apply CORS for THIS origin, WR-01). Miss: `obj = await bucket.get(offsetObjectKey(k))`; `rec = obj ? parseRecord(await obj.text()) : emptyRecord()`; `body = { ok: true, ...consensus(rec) }`; if cache, `cache.put(cacheReq, new Response(JSON.stringify(body), { headers: { 'content-type': 'application/json', 'Cache-Control': `public, max-age=${SHARED_OFFSET_TTL}` } }))` (CORS-free copy); return `jsonResponse(body, origin, { ttl: SHARED_OFFSET_TTL })`. A missing object is a cacheable `{ok:true, offset:null, n:0}` by design (the common case; it is what makes the fan-in cheap).
    - `POST(event)`: binding absent -> 503 first (nothing else to do without it). Size screen EXACTLY as diag steps 3-4: `Number(content-length ?? '0') > MAX_VOTE_BODY_BYTES` -> 413 `{ok:false, err:'too-large'}` before reading; then `text = await request.text()`, `text.length > MAX_VOTE_BODY_BYTES` -> 413. `vote = parseVoteBody(text)`; null -> 400 `{ok:false, err:'invalid'}`. Client address: `let ip: string | null = null; try { ip = event.getClientAddress(); } catch { ip = null; }`; falsy -> 400 `{ok:false, err:'no-address'}` (a vote with no attributable voter is refused, not accepted anonymously). `voter = await voterId(ip, vote.k)`; `key = offsetObjectKey(vote.k)`. Read-modify-write loop, up to 3 attempts: `obj = await bucket.get(key)`; `rec = obj ? parseRecord(await obj.text()) : emptyRecord()`; `next = applyVote(rec, voter, vote.offset, Date.now())`; `put = await bucket.put(key, JSON.stringify(next), { httpMetadata: { contentType: 'application/json' }, onlyIf: obj ? { etagMatches: obj.etag } : { etagDoesNotMatch: '*' } })`; if `put` is non-null: bust the PoP-local cache entry for this key's GET (`const getUrl = new URL(url); getUrl.search = 'k=' + vote.k; await cache?.delete(ownOriginCacheKey(getUrl))` — must equal the GET's own cache key, so the client MUST request exactly `?k=<k>` with no other params) and return `jsonResponse({ ok: true, ...consensus(next) }, origin)` with NO ttl (a write reply is never cacheable). After 3 failed preconditions -> 409 `{ok:false, err:'conflict'}`. Comment on the create branch: the R2 docs document `etagMatches`/`etagDoesNotMatch` but not a `*` wildcard; if the runtime ignores it the worst case is last-writer-wins on the very FIRST vote for a key (one lost vote), the update path is protected by the documented `etagMatches`.
    - Add the required `ponytail:` comment on POST: IP rotation (sybil) and write floods (R2 class-A op budget) are NOT rate-limited here; the median + >=3-agree + 50-cap raise the bar but do not close it; upgrade path = a Cloudflare rate-limiting rule or Turnstile on POST. No new bindings or secrets (wrangler auth for this account needs a human re-login, out of scope by design).

    **Tests.** Copy the diag test harness: `fakeEvent(method, { body, headers, env, search, ip })` where `getClientAddress` is `() => opts.ip ?? '1.2.3.4'` (allow passing `null`, and a variant that throws). Fake bucket with ETAG + CONDITIONAL-PUT semantics: `store: Map<string, { text: string; etag: string }>`; `get(key)` -> `null` or `{ etag, text: async () => text }`; `put(key, value, opts)` is a `vi.fn` that: if `opts.onlyIf.etagDoesNotMatch === '*'` and the key exists -> return `null`; if `opts.onlyIf.etagMatches` is set and differs from the stored etag (or key missing) -> return `null`; else store with a fresh etag (`'e' + counter`) and return `{ etag }`. Plus a `conflictBucket()` whose put always returns null. Stub `caches` with the `makeFakeCache` shape from proxy.test.ts extended with a `delete: vi.fn(async (req) => store.delete(req.url))`; `vi.unstubAllGlobals()` in `afterEach`. Assert every reject path calls neither `put` nor `get`, and that no response body ever contains 'votes' or a voter id.
  </action>
  <verify>
    <automated>cd /Users/laichan/code/tung/openmusic && pnpm vitest --run src/lib/proxy/lyric-offset.test.ts src/routes/api/lyric-offset/lyric-offset-endpoint.test.ts && grep -v '^\s*//' src/routes/api/lyric-offset/+server.ts | grep -E '^export' | grep -vc -E '^export const (GET|POST): RequestHandler' | grep -qx 0 && grep -c 'offsetObjectKey(' src/routes/api/lyric-offset/+server.ts | grep -qvx 0 && grep -c 'bucket.list' src/routes/api/lyric-offset/+server.ts | grep -qx 0</automated>
  </verify>
  <done>Both test files green; `+server.ts` has exactly two exports (`GET`, `POST`), never calls `bucket.list`, and builds every R2 key through `offsetObjectKey`; consensus/median/agree rules and the 50-vote cap are pinned by tests; the raw IP never appears in a stored record or a response.</done>
</task>

<task type="auto" tdd="true">
  <name>Task 2: Client — never-throw shared service + the store's shared layer (unset vs explicit 0, effective precedence, ensure/vote/reset)</name>
  <files>src/lib/services/lyric-offset-shared.ts, src/lib/services/lyric-offset-shared.test.ts, src/lib/stores/lyric-offset.svelte.ts, src/lib/stores/lyric-offset.svelte.test.ts</files>
  <behavior>
    Service (src/lib/services/lyric-offset-shared.test.ts; stub `fetch` with vi.stubGlobal, call `__resetGovernor()` in beforeEach, `vi.unstubAllGlobals()` in afterEach):
    - lyricOffsetKey('netease:1', '[00:01.00]a'): matches /^[0-9a-f]{32}$/; equals the first 32 hex of node:crypto createHash('sha256').update('netease:1\n[00:01.00]a').digest('hex'); differs when the lrc differs by one char; differs for another uid; with `crypto.subtle` temporarily stubbed to undefined -> resolves null (no throw)
    - fetchSharedOffset(k): fetch called with a URL ending '/api/lyric-offset?k=<k>' and method GET; 200 {ok:true, offset:1.5, n:3} -> 1.5; 200 {offset:null} -> null; 200 {offset:'x'} -> null; 200 {offset: 1e9} -> 600 (normalized on read, T-mis-01 parity); 503 -> null; fetch rejecting -> null; caller signal already aborted -> null
    - submitOffsetVote(k, 2.34): fetch called ONCE with method POST, header content-type application/json, body JSON.parse -> {k, offset: 2.3}; 409 / 503 / rejecting fetch -> resolves void, never throws
    Store (src/lib/stores/lyric-offset.svelte.test.ts; keep the MemStorage harness; add `__resetSharedLyricOffsets()` + `__resetGovernor()` in beforeEach):
    - UPDATE the existing '0 (and NaN) deletes the key' test: setLyricOffset(uid, 0) now STORES {uid: 0}; NaN stores 0; clearLyricOffset(uid) deletes; hasLocalLyricOffset false when unset, true after set 0
    - getEffectiveLyricOffset / isSharedLyricOffset: unset + no shared -> 0 / false; after ensure resolves 1.5 -> 1.5 / true; local 2 + shared 1.5 -> 2 / false; explicit local 0 + shared 1.5 -> 0 / false (the opt-out)
    - ensureSharedLyricOffset(uid, lrc) with fetch stubbed to {ok:true, offset:1.5, n:3}: writes NOTHING synchronously (isShared false immediately after the call), 1.5 after the promise settles; a second call with the same (uid, lrc) issues NO second fetch; a call with a different lrc for the same uid issues a new fetch; when the uid has a LOCAL offset no fetch is issued; SUPERSEDE: first fetch is a deferred promise, lrc changes and second ensure fires, then the FIRST resolves with 9 and the second with 1.5 -> effective is 1.5 (the stale reply for the old lyrics was dropped); a null offset reply leaves isShared false; empty uid / null lrc -> no fetch
    - scheduleLyricOffsetVote(uid, lrc) with `vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })`: after setLyricOffset(uid, 2) + schedule, advancing 3999ms -> no POST; advancing to 4000 (use `await vi.advanceTimersByTimeAsync` then flush microtasks) -> exactly ONE POST whose body is {k: <32hex>, offset: 2}; three schedules within the window (offsets 1, 1.5, 2) -> ONE POST with offset 2; resetLyricOffset(uid) inside the window -> NO POST ever fires; schedule then clearLyricOffset before firing -> no POST (local unset at fire time)
    - resetLyricOffset(uid): with local 2 and shared 1.5 -> local entry deleted, effective 1.5, isShared true; with only shared 1.5 -> stores explicit 0, effective 0, isShared false; with nothing -> no write, no bump
  </behavior>
  <action>
    **Service `src/lib/services/lyric-offset-shared.ts`** (pure .ts, never-throw, sentinel returns — the deezer.ts posture). Imports `apiFetch` from `$lib/services/api-base` and `normalizeLyricOffset` from `$lib/services/lrc`.
    - `lyricOffsetKey(uid, lrc): Promise<string | null>` — `if (!uid || !lrc || typeof crypto === 'undefined' || !crypto.subtle) return null;` then SHA-256 of `${uid}\n${lrc}` (the EXACT `readLyrics()` string, pre script-lock / pre parse, so a different lyrics pick or a re-tagged file gets its own consensus) -> hex -> first 32 chars; any throw -> null. Comment WHY the null: `crypto.subtle` is undefined on a non-secure origin (a phone hitting the dev server over LAN `http://`), and "no shared offset" is the correct degradation there.
    - `fetchSharedOffset(k, signal?): Promise<number | null>` — `apiFetch(`/api/lyric-offset?k=${k}`, { signal })` (exactly this query string and nothing else: the server busts the edge cache by rebuilding this URL); `!res.ok` -> null; parse json; `typeof offset === 'number' ? normalizeLyricOffset(offset) : null`; any throw -> null. Note in a comment that under vite dev the 503 counts toward the apiFetch circuit breaker, which is fine at one call per track.
    - `submitOffsetVote(k, offset): Promise<void>` — `apiFetch('/api/lyric-offset', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ k, offset: normalizeLyricOffset(offset) }) })`; the `content-type` header is REQUIRED (Cloudflare 403s a JSON POST without it upstream of the app, see the 33-07 curl lesson in STATE.md); swallow everything.

    **Store `src/lib/stores/lyric-offset.svelte.ts`** — extend, keep every existing export. Import the three service functions.
    - `setLyricOffset`: now stores the normalized value INCLUDING 0 (drop the `if (n === 0) delete` branch; update the header comment: "explicit 0 is stored — it is the opt-out from a shared consensus, so unset and 0 must be distinguishable"). Add `clearLyricOffset(uid)` (delete entry, write, bump) and `hasLocalLyricOffset(uid): boolean` (`typeof readRec()[uid] === 'number'`, takes the version dep).
    - Shared layer, in-memory per session, NOT persisted: `const _shared = $state<Record<string, number>>({})`; plain (non-reactive) `const requested = new Map<string, string>()` (uid -> the lrc it was requested for) and `let voteTimer: ReturnType<typeof setTimeout> | null = null`; `export const VOTE_DEBOUNCE_MS = 4000`.
    - `getEffectiveLyricOffset(uid)`: `lyricOffsetVersion()`; `!uid` -> 0; local number -> `normalizeLyricOffset(local)`; else `_shared[uid]` if a number; else 0. `isSharedLyricOffset(uid)`: local unset AND `typeof _shared[uid] === 'number'`. Both are cheap enough for a $derived that re-runs only on track change / offset write (never per timeupdate — callers keep the $derived).
    - `ensureSharedLyricOffset(uid, lrc)`: synchronous part writes NO $state (this is what keeps a calling $effect from self-invalidating — restore-effect loop history in CLAUDE.md): `if (!uid || !lrc) return; if (typeof readRec()[uid] === 'number') return; if (requested.get(uid) === lrc) return; requested.set(uid, lrc);` then a fire-and-forget async: `k = await lyricOffsetKey(uid, lrc)`; `!k` -> return; `off = await fetchSharedOffset(k)`; SUPERSEDE GUARD after the awaits: `if (requested.get(uid) !== lrc) return;` (a later lyrics change for the same uid owns the slot); then `off == null ? delete _shared[uid] : (_shared[uid] = off)`. `ponytail:` one attempt per (uid, lyrics) per session, no retry — a miss/503 just means no shared offset until the next session.
    - `scheduleLyricOffsetVote(uid, lrc)`: `if (!uid || !lrc) return;` clear any pending timer; `voteTimer = setTimeout(async () => { voteTimer = null; const v = readRec()[uid]; if (typeof v !== 'number') return; const k = await lyricOffsetKey(uid, lrc); if (k) await submitOffsetVote(k, v); }, VOTE_DEBOUNCE_MS)`. Reads the local offset AT FIRE TIME so the vote is the final value after a burst of nudges. `ponytail:` single pending vote; a nudge on a second song within 4s drops the first song's vote — per-uid timers if it ever matters.
    - `resetLyricOffset(uid)` — THE readout-tap semantics, decided here and documented in a comment: cancel the pending vote timer (reset never votes, and must not let a stale nudge vote fire); if a local entry exists -> `clearLyricOffset(uid)` (back to the default: the shared consensus if one is showing, else 0); else if `_shared[uid]` is a number -> `setLyricOffset(uid, 0)` (explicit local 0 = opt out of a bad consensus; stored, so it survives reload); else no-op. Two taps from "local 2 with shared 1.5" reach 0 — first back to the listeners' value, second to force 0 — and the readout's label tells the user which state they are in.
    - `__resetSharedLyricOffsets()` TEST-ONLY (mirrors `__resetGovernor`): clear `_shared` keys, `requested`, and the timer.
    - Keep `getLyricOffset` unchanged (local-only read; still exported, still tested).

    **Tests**: update the existing store test per the behavior list (the '0 deletes' test flips meaning — rewrite it, do not delete it); add the shared-layer tests. For async settling after fake-timer advance use `await vi.advanceTimersByTimeAsync(ms)` followed by `await new Promise((r) => setImmediate(r))` (setImmediate stays real with the `toFake` list above). For the supersede test build the deferred with a captured `resolve` and stub `fetch` as a `vi.fn` returning the pending promise on the first call and a resolved Response on the second.
  </action>
  <verify>
    <automated>cd /Users/laichan/code/tung/openmusic && pnpm vitest --run src/lib/services/lyric-offset-shared.test.ts src/lib/stores/lyric-offset.svelte.test.ts src/lib/services/lrc.test.ts && grep -c 'apiFetch(' src/lib/services/lyric-offset-shared.ts | grep -qvx 0 && grep -v '^\s*//' src/lib/services/lyric-offset-shared.ts | grep -c 'fetch(' | grep -qvx 0 && grep -v '^\s*//' src/lib/stores/lyric-offset.svelte.ts | grep -c "if (n === 0) delete" | grep -qx 0</automated>
  </verify>
  <done>Service + store tests green; `setLyricOffset(uid, 0)` persists `{uid: 0}`; effective precedence local > shared > 0 with explicit 0 beating shared; ensure is dedupe-by-(uid,lrc), writes no $state synchronously, drops a superseded reply; the vote fires once ~4s after the last change with the final local offset and never after a reset.</done>
</task>

<task type="auto">
  <name>Task 3: Wire NpLyrics + Nowbar to the effective offset, "Synced by listeners" readout label, i18n key in all 15 locales, full green</name>
  <files>src/lib/components/NpLyrics.svelte, src/lib/components/Nowbar.svelte, src/lib/i18n/en.ts, src/lib/i18n/ar.ts, src/lib/i18n/de.ts, src/lib/i18n/es.ts, src/lib/i18n/fr.ts, src/lib/i18n/hi.ts, src/lib/i18n/id.ts, src/lib/i18n/it.ts, src/lib/i18n/pt.ts, src/lib/i18n/ru.ts, src/lib/i18n/th.ts, src/lib/i18n/tr.ts, src/lib/i18n/vi.ts, src/lib/i18n/zh-Hans.ts, src/lib/i18n/zh-Hant.ts</files>
  <action>
    **i18n** — add ONE key, `"lyrics.offsetShared"`, immediately after `"lyrics.offsetReset"` in EVERY one of the 15 locale files, DOUBLE quotes for key and value (manual convention, `i18n.test.ts` guards key-set parity). `en` = "Synced by listeners"; translate naturally for the other 14 (e.g. zh-Hans "由听众同步", zh-Hant "由聽眾同步", de "Von Hörern synchronisiert", fr "Synchronisé par les auditeurs", es "Sincronizado por oyentes"); short, it sits in a 0.6875rem row.

    **NpLyrics.svelte** (quick-260926-mzn comments on every touched line, keep the existing quick-260926-mis ones):
    - Import from `$lib/stores/lyric-offset.svelte`: `getEffectiveLyricOffset`, `isSharedLyricOffset`, `ensureSharedLyricOffset`, `scheduleLyricOffsetVote`, `resetLyricOffset`, `lyricOffsetVersion`, keep `setLyricOffset`; drop `getLyricOffset` if no longer referenced.
    - `const lyricOffset = $derived(getEffectiveLyricOffset(player.current?.uid));` and `const offsetShared = $derived(isSharedLyricOffset(player.current?.uid));`. Everything downstream (`activeLineAt`, `lineSeekFraction`, `nudgeOffset`'s `lyricOffset + delta`) is unchanged and now nudges FROM the shared value, which is the natural "adjust the listeners' alignment" flow.
    - Fetch trigger, a NEW small `$effect` placed right after the deriveds: read `lyricOffsetVersion()` (so clearing a local offset re-runs it and the shared value is fetched), `const uid = player.current?.uid; const src = readLyrics(player.current); if (uid && src) ensureSharedLyricOffset(uid, src);`. Comment: this effect reads player.current / lyricVersion / lyricOffsetVersion and `ensureSharedLyricOffset` writes NO $state synchronously (only `_shared`, after its awaits, which this effect never reads) — so it is NOT the self-invalidating class that froze the app (restore-effect loop). Do NOT touch `anchorActiveLine` or its `$effect`.
    - `syncToLine` and `nudgeOffset`: after `setLyricOffset(...)`, call `scheduleLyricOffsetVote(uid, readLyrics(player.current) ?? '')` (the store no-ops on an empty lrc). `resetOffset` becomes `resetLyricOffset(uid)` (semantics documented in the store).
    - Template: inside `.sync`, after the `+0.5s` button and before `.hint`, add `{#if offsetShared}<span class="shared">{t('lyrics.offsetShared')}</span>{/if}`. Style `.sync .shared { font-size: 0.625rem; opacity: 0.7; }` (matches `.hint`'s scale, inline in the row so the readout and its provenance sit together). The readout's existing `lyrics.offsetReset` aria-label stays; the span is visible text so AT reads it too.

    **Nowbar.svelte** (this file uses DOUBLE-quoted imports — match it): swap `getLyricOffset` for `getEffectiveLyricOffset` + `ensureSharedLyricOffset` + `lyricOffsetVersion` in the import at line 38; `const lyricOffset = $derived(getEffectiveLyricOffset(player.current?.uid));` at line 85; add the same ensure `$effect` as NpLyrics but gated first by `if (!lyricsRow) return;` (the existing `settings.nowbarLyrics && variant === "docked"` derived) — no fetch for a row that is not rendered; the pane fetches for itself when it mounts, and the store dedupes when both are up. The `activeLineAt(lyricLines, player.currentTime, lyricOffset)` call is unchanged.

    **Full verify**: `pnpm test` and `pnpm check` must be green (the 1 pre-existing unused-selector warning in NowPlaying.svelte is not ours). No dev-server E2E of the route is possible here (`vite dev` has no DIAG binding -> 503, client shows nothing shared, which IS the supported state); the orchestrator runs `wrangler pages dev` with local R2 for the E2E.
  </action>
  <verify>
    <automated>cd /Users/laichan/code/tung/openmusic && for f in src/lib/i18n/{en,ar,de,es,fr,hi,id,it,pt,ru,th,tr,vi,zh-Hans,zh-Hant}.ts; do grep -c '"lyrics.offsetShared": "' "$f" | grep -qx 1 || { echo "MISSING $f"; exit 1; }; done && grep -c 'getEffectiveLyricOffset(player.current?.uid)' src/lib/components/NpLyrics.svelte | grep -qx 1 && grep -c 'getEffectiveLyricOffset(player.current?.uid)' src/lib/components/Nowbar.svelte | grep -qx 1 && grep -c 'ensureSharedLyricOffset(' src/lib/components/NpLyrics.svelte | grep -qx 1 && grep -c 'ensureSharedLyricOffset(' src/lib/components/Nowbar.svelte | grep -qx 1 && grep -c 'scheduleLyricOffsetVote(' src/lib/components/NpLyrics.svelte | grep -qx 2 && grep -c 'resetLyricOffset(' src/lib/components/NpLyrics.svelte | grep -qx 1 && grep -v '^\s*//' src/lib/components/NpLyrics.svelte src/lib/components/Nowbar.svelte | grep -c 'getLyricOffset(' | grep -qx 0 && pnpm test && pnpm check 2>&1 | tail -3 | grep -q '0 errors'</automated>
    <human-check>With the deployed route (or `wrangler pages dev` + local R2): play a song with lyrics on device A, hold a line to realign (offset X), wait 5s. On devices B, C (different IPs) do the same with offsets within 1s of X. On a fourth device with no local offset, open the song: the readout shows ~X with "Synced by listeners"; tap the readout once -> shows +0.0s (opt-out, label gone); reload -> still +0.0s. Nudge from the shared value -> nudges from X, label disappears (local now wins).</human-check>
  </verify>
  <done>All 15 locales carry `lyrics.offsetShared`; NpLyrics and Nowbar read the EFFECTIVE offset through the same store function; the pane shows the provenance label only when the shared layer is what is applied; `pnpm test` and `pnpm check` are green.</done>
</task>

</tasks>

<threat_model>
## Trust Boundaries

| Boundary | Description |
|----------|-------------|
| client -> POST /api/lyric-offset | Public, UNAUTHENTICATED write; body and `cf-connecting-ip` are attacker-controlled / rotatable |
| client -> GET /api/lyric-offset | Public read; `k` is untrusted; response is edge-cached and shared across origins |
| route -> R2 `DIAG` bucket | Same bucket holds PRIVATE listening logs under `log/` (read-token gated) |
| shared consensus -> user's lyrics | Untrusted crowd data reaching a rendering path |

## STRIDE Threat Register

| Threat ID | Category | Component | Disposition | Mitigation Plan |
|-----------|----------|-----------|-------------|-----------------|
| T-mzn-01 | Tampering | POST body | mitigate | content-length screen + real-length screen at 256 B before parse; `parseVoteBody` strict shape, finite, |o| <= 600, rejected not clamped; never-throw |
| T-mzn-02 | Tampering / Info disclosure | R2 key construction | mitigate | `k` must match `/^[0-9a-f]{32}$/`; the ONLY key builder is `offsetObjectKey` (`lyric-offset/<k>.json`); route never calls `bucket.list`; test asserts `isDiagKey(offsetObjectKey(k)) === false` so the `log/` and `lyric-offset/` namespaces are provably disjoint |
| T-mzn-03 | Information disclosure | voter identity | mitigate | voter id = first 16 hex of SHA-256(`ip|k`) (per-key salt, unlinkable across songs); raw IP never stored, never in a reply; replies expose only `{ok, offset, n}`, never `votes` (asserted on every status) |
| T-mzn-04 | Spoofing (sybil) | POST voter id | accept | IP rotation can forge >=3 agreeing votes. Median + >=3-agree window + 50-most-recent cap raise the cost; local offset always wins and explicit 0 opts out, so the blast radius is "a wrong default a user can correct with one tap". `ponytail:` comment names the upgrade path (Cloudflare rate-limit rule / Turnstile on POST) |
| T-mzn-05 | Denial of service | POST write flood / R2 class-A ops | accept | No new binding or rate limiter (wrangler auth for this account needs a human re-login, out of scope). Bounded per request (256 B, <=3 puts); `ponytail:` comment documents the rule/Turnstile upgrade |
| T-mzn-06 | Tampering (lost update) | read-modify-write on the record | mitigate | R2 conditional put (`etagMatches` on update, `etagDoesNotMatch: '*'` on create), <=3 retries then 409; fake-bucket tests pin the semantics |
| T-mzn-07 | Tampering | bad consensus reaching the user | mitigate | Effective = local ?? shared ?? 0; explicit local 0 is stored and beats shared; `fetchSharedOffset` normalizes on read (clamp +-600); label shows provenance |
| T-mzn-08 | Denial of service (client) | self-invalidating $effect / fetch loop | mitigate | `ensureSharedLyricOffset` writes no $state synchronously; dedupe by (uid, lrc) with a supersede guard after the awaits; one attempt per session; all calls through `apiFetch` (dedupe, cap 8, timeout, breaker) |
| T-mzn-09 | Information disclosure | edge cache across origins | mitigate | Cached body is CORS-free; CORS re-applied per request on a hit (WR-01); POST replies carry no Cache-Control; POST busts the GET key PoP-locally (documented as repair-on-encounter, not a global purge) |
| T-mzn-10 | Repudiation | anonymous vote with no address | mitigate | `getClientAddress()` null/throw -> 400 `no-address`; no vote is ever recorded without an attributable (hashed) voter |
| T-mzn-SC | Tampering | npm installs | n/a | No packages installed; zero new runtime deps (platform `crypto.subtle`, `fetch`, R2, Cache API only) |
</threat_model>

<verification>
- `pnpm vitest --run src/lib/proxy/lyric-offset.test.ts src/routes/api/lyric-offset/lyric-offset-endpoint.test.ts src/lib/services/lyric-offset-shared.test.ts src/lib/stores/lyric-offset.svelte.test.ts` green
- `pnpm test` green (full suite), `pnpm check` 0 errors
- Route file exports only `GET` and `POST`; every R2 key goes through `offsetObjectKey`; no `bucket.list`
- All 15 locales have exactly one `"lyrics.offsetShared"` (i18n parity test green)
- NpLyrics + Nowbar have zero non-comment `getLyricOffset(` calls; both use `getEffectiveLyricOffset(player.current?.uid)`
- Orchestrator E2E (outside this plan): `wrangler pages dev` with local R2 — 3 POSTs from 3 spoofed `cf-connecting-ip` values agreeing within 1s make GET answer the median; a 4th disagreeing vote keeps it; bad `k` is 400 without touching R2
</verification>

<success_criteria>
- A listener with no local offset gets the >=3-agree median for a song's exact lyrics text, labelled "Synced by listeners", in both the pane and the Nowbar line
- Local offset (including explicit 0) always wins; reset semantics: local -> back to shared/0, shared-showing -> explicit 0 opt-out; reset never votes
- Explicit realigns vote once, debounced 4s, with the final value; failures are silent
- `/api/lyric-offset` is fail-closed on binding absence (503), key-validated before I/O, size-screened before parse, conditional-put safe, IP-hash-only, `log/`-unreachable
- No new deps, bindings, or secrets; `pnpm test` + `pnpm check` green
</success_criteria>

<output>
Create `.planning/quick/260926-mzn-shared-lyric-offsets-with-median-consens/260926-mzn-SUMMARY.md` when done
</output>
