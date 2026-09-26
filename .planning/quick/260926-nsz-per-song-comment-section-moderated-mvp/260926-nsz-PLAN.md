---
phase: quick-260926-nsz
plan: 01
type: execute
wave: 1
depends_on: []
files_modified:
  - src/lib/proxy/comments.ts
  - src/lib/proxy/comments.test.ts
  - src/routes/api/comments/+server.ts
  - src/routes/api/comments/comments-endpoint.test.ts
  - src/lib/services/comments.ts
  - src/lib/services/comments.test.ts
  - src/lib/services/dedupe.ts
  - src/lib/components/NpComments.svelte
  - src/lib/components/NowPlaying.svelte
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
requirements: [QUICK-260926-nsz]
tags: [comments, ugc, r2, edge, moderation, nowplaying, i18n]

must_haves:
  truths:
    - "A listener can open a Comments tab in Now Playing, type a display name (persisted) and a comment (<=280 code points), tap Post, and see it at the top of the list for that song"
    - "The same song from qq / kuwo / netease / joox, and its Simplified vs Traditional spellings, share ONE comment thread (key = SHA-256 of dedupe's script-folded song key)"
    - "Anyone can report a comment (two-tap confirm); at 3 distinct reporters it disappears from the public list; the reporter stops seeing it immediately"
    - "One IP can post at most once per 30 s and 30 times per UTC day (429 slow-down); the UI shows a slow-down / invalid / unavailable line instead of failing silently"
    - "The maintainer can list hidden items with report counts (GET &all=1 + Bearer DIAG_READ_TOKEN) and delete any comment (DELETE + Bearer); both fail CLOSED without the token and never touch R2 before the token check"
    - "No response ever contains reporter hashes or anything IP-derived; comment text renders as plain text (never {@html}); a foreign-origin or non-JSON POST is refused before any I/O"
    - "Under no DIAG binding every verb answers 503 and the pane shows the unavailable state; on a non-secure origin (no crypto.subtle) the pane shows the unavailable state"
  artifacts:
    - path: "src/lib/proxy/comments.ts"
      provides: "Pure never-throw helpers: key screens, name/text cleaning, body parse, thread record ops, public/maintainer projections, throttle, voterId"
      exports: ["isThreadKey", "threadObjectKey", "throttleObjectKey", "cleanName", "cleanText", "parseCommentBody", "parseThread", "emptyThread", "addComment", "addReport", "removeComment", "publicItems", "maintainerItems", "parseThrottle", "checkThrottle", "voterId", "MAX_COMMENT_BODY_BYTES", "MAX_ITEMS", "HIDE_REPORTS", "NAME_MAX", "TEXT_MAX", "POST_MIN_GAP_MS", "POST_DAILY_MAX", "COMMENTS_TTL"]
    - path: "src/routes/api/comments/+server.ts"
      provides: "GET (public + maintainer all=1), POST (post | report), DELETE (maintainer) — verb exports ONLY"
      exports: ["GET", "POST", "DELETE"]
    - path: "src/lib/services/comments.ts"
      provides: "Never-throw client service via apiFetch + thread key + relative time"
      exports: ["commentThreadKey", "fetchComments", "postComment", "reportComment", "relativeTime"]
    - path: "src/lib/services/dedupe.ts"
      provides: "songKey(artist, title) — the script-folded normalizer key() already used, now exported for raw strings"
      exports: ["songKey"]
    - path: "src/lib/components/NpComments.svelte"
      provides: "Comments pane: composer + newest-first list + two-tap report + error line"
      min_lines: 80
  key_links:
    - from: "src/lib/components/NowPlaying.svelte"
      to: "src/lib/components/NpComments.svelte"
      via: "commentsPane snippet rendered for tab === 'comments' (narrow) and in the third wide column"
      pattern: "NpComments"
    - from: "src/lib/components/NpComments.svelte"
      to: "src/lib/services/comments.ts"
      via: "commentThreadKey -> fetchComments on track change; postComment / reportComment on user action"
      pattern: "commentThreadKey|fetchComments|postComment|reportComment"
    - from: "src/lib/services/comments.ts"
      to: "src/lib/services/dedupe.ts"
      via: "songKey(artist, title) after warmScript('zh-Hans')"
      pattern: "songKey\\("
    - from: "src/lib/services/comments.ts"
      to: "src/lib/services/api-base.ts"
      via: "apiFetch (governor: dedupe, cap, timeout, breaker)"
      pattern: "apiFetch\\("
    - from: "src/routes/api/comments/+server.ts"
      to: "platform.env.DIAG"
      via: "bucket.get / bucket.put with onlyIf under comments/ and comments-throttle/ only"
      pattern: "threadObjectKey\\(|throttleObjectKey\\("
    - from: "src/routes/api/comments/+server.ts"
      to: "src/lib/proxy/diag-auth.ts"
      via: "bearerMatches(authorization, env.DIAG_READ_TOKEN) before any R2 access on all=1 and DELETE"
      pattern: "bearerMatches\\("
---

<objective>
Per-song comment section, moderated MVP (quick-260926-nsz). Anyone can post a comment on a song under any display name; anyone can report; 3 distinct reports hide a comment; the maintainer can inspect hidden items and delete with the existing `DIAG_READ_TOKEN`. Storage is the existing DIAG R2 bucket under a new `comments/` prefix (plus `comments-throttle/` for the per-IP throttle), same route shape, gates and read-modify-write pattern as `/api/lyric-offset` (quick-260926-mzn). The thread key is the SONG, not a source copy: SHA-256 of dedupe's script-folded `songKey(artist, title)`, so qq/kuwo/netease copies and Simplified/Traditional spellings share one thread.

The user chose "Moderated MVP now" after being told the risks (spam, moderation, legal, impersonation). Turnstile / Cloudflare rate-limit rules are DEFERRED until the Cloudflare account is reachable (wrangler auth needs a human re-login); the IP throttle + report-to-hide + maintainer delete are the MVP's whole moderation surface, and the `ponytail:` comment on POST names the upgrade path.

Purpose: a song page that feels alive — listeners can leave a line for each other on the song itself, across every source copy of it.
Output: pure helpers + `/api/comments` (GET/POST/DELETE) with fake-R2 tests; never-throw client service with tests; `songKey` export from dedupe; `NpComments.svelte`; a 4th Now Playing tab (narrow) and a Related | Comments toggle in the third wide column; 14 new i18n keys in all 15 locales.
</objective>

<execution_context>
@/Users/laichan/.claude/plugins/cache/gsd-plugin/gsd/4.5.3/workflows/execute-plan.md
@/Users/laichan/.claude/plugins/cache/gsd-plugin/gsd/4.5.3/templates/summary.md
</execution_context>

<context>
@/Users/laichan/code/tung/openmusic/CLAUDE.md
@/Users/laichan/code/tung/openmusic/.planning/STATE.md
@/Users/laichan/code/tung/openmusic/.planning/quick/260926-mzn-shared-lyric-offsets-with-median-consens/260926-mzn-SUMMARY.md

THE TEMPLATE (copy its shape, gates and test harness — do not re-derive):
@/Users/laichan/code/tung/openmusic/src/routes/api/lyric-offset/+server.ts
@/Users/laichan/code/tung/openmusic/src/routes/api/lyric-offset/lyric-offset-endpoint.test.ts
@/Users/laichan/code/tung/openmusic/src/lib/proxy/lyric-offset.ts
@/Users/laichan/code/tung/openmusic/src/lib/services/lyric-offset-shared.ts
@/Users/laichan/code/tung/openmusic/src/lib/services/lyric-offset-shared.test.ts

Reused primitives:
@/Users/laichan/code/tung/openmusic/src/lib/proxy/diag-auth.ts
@/Users/laichan/code/tung/openmusic/src/lib/proxy/http.ts
@/Users/laichan/code/tung/openmusic/src/lib/proxy/edge-cache.ts
@/Users/laichan/code/tung/openmusic/src/lib/services/api-base.ts
@/Users/laichan/code/tung/openmusic/src/lib/services/dedupe.ts
@/Users/laichan/code/tung/openmusic/src/lib/services/zh-convert.ts

UI integration points:
@/Users/laichan/code/tung/openmusic/src/lib/components/NowPlaying.svelte
@/Users/laichan/code/tung/openmusic/src/lib/components/NpRelated.svelte
@/Users/laichan/code/tung/openmusic/src/lib/i18n/en.ts
@/Users/laichan/code/tung/openmusic/src/lib/i18n/i18n.test.ts

<interfaces>
<!-- Extracted from the codebase. Use directly — no exploration needed. -->

From src/lib/proxy/http.ts:
```typescript
export function isAllowedOrigin(origin: string | null): origin is string;
export function jsonResponse(body: unknown, origin: string | null, opts?: { ttl?: number; status?: number; cacheControl?: string }): Response;
// corsHeaders Allow-Methods is 'GET, POST, OPTIONS' — DO NOT add DELETE (maintainer DELETE is curl-only, no browser needs it)
```

From src/lib/proxy/edge-cache.ts:
```typescript
export interface EdgeCache { match(request: Request): Promise<Response | undefined>; put(request: Request, response: Response): Promise<void>; delete(request: Request): Promise<boolean>; }
export function edgeCache(): EdgeCache | null;           // null under vite dev / tests unless `caches` is stubbed
export function ownOriginCacheKey(url: URL | string): Request;
```

From src/lib/proxy/diag-auth.ts:
```typescript
export async function bearerMatches(header: string | null, expected: string | undefined): Promise<boolean>; // false when expected is unset (fail closed)
```

From src/lib/proxy/proxy-types.ts (Env):
```typescript
DIAG?: R2Bucket; DIAG_UPLOAD_TOKEN?: string; DIAG_READ_TOKEN?: string;
```

From src/lib/proxy/lyric-offset.ts (the idioms to mirror, NOT to import):
```typescript
export function isOffsetKey(k: string | null): k is string;   // /^[0-9a-f]{32}$/
export function offsetObjectKey(k: string): string;            // the ONLY R2 key builder
export async function voterId(ip: string, k: string): Promise<string>; // SHA-256 -> first 16 hex
// route: bucket.put(key, json, { httpMetadata: { contentType: 'application/json' }, onlyIf: obj ? { etagMatches: obj.etag } : { etagDoesNotMatch: '*' } }) — null return = precondition failed
```

From src/lib/services/api-base.ts:
```typescript
export function apiFetch(path: string, init?: RequestInit): Promise<Response>; // GET dedupe + MAX_CONCURRENT 8 + 25s timeout + breaker
export function __resetGovernor(): void;                                        // TEST-ONLY, call in beforeEach
```

From src/lib/services/dedupe.ts (line 138 — PRIVATE today, refactor in Task 2):
```typescript
function key(t: Track): string;   // foldScript (t2s per char, cold dict -> unfolded) + lowercase + bracket/suffix strip + own-artist prefix strip + stripTranslation; returns `${title}|${artist}`
```

From src/lib/services/zh-convert.ts:
```typescript
export async function warmScript(target: 'zh-Hant' | 'zh-Hans'): Promise<void>; // never rejects; 'zh-Hans' awaits the t2s dict build (dynamic import — resolves natively under Vitest, see dedupe.test.ts:225)
export function t2sConvertLineSync(text: string): string | null;              // null = dict not warm (or empty text)
```

From src/lib/sources/types.ts (Track): `uid: string; title: string; artist: string;`

From src/lib/i18n/index.ts:
```typescript
export function t(key: TranslationKey, params?: Record<string, string | number>): string; // TranslationKey = keyof typeof en
```

From src/lib/components/NowPlaying.svelte (anchors):
```
L63   type Tab = 'queue' | 'lyrics' | 'related';   L64 let tab = $state<Tab>('lyrics');
L90   let wide = $state(...)  — the >=1280px flag driving {#if wide}
L677  gripDown: const btn = closest('.subnav button[data-tab]')  → a TAP on any [data-tab] button calls selectTab(gripStartTab) in gripUp (L705) and arms the click suppressor, so onclick does NOT double-fire
L797  function selectTab(next: Tab) { ...; tab = next; if (sheetState === 'closed') sheetState = 'half'; }
L1115 {#if wide} <div class="subnav heads" aria-hidden="true" onpointer…> 3 inert <button>s {:else} <nav class="subnav"> 3 data-tab buttons {/if}
L1133 {#snippet upNextPane()} / lyricsPane() / relatedPane()
L1157 {#if wide} <div class="cols"> 3 × <div class="panel">{@render …}</div> {:else} <div class="panel"> tab switch {/if}
L1413 .subnav / .subnav button / .subnav button.active ; L1446 .cols grid 1fr 1.4fr 1fr ; L1458 .subnav.heads (same grid) ; L1467 .subnav.heads span — DEAD rule (the known svelte-check warning; markup uses <button>)
```

From src/lib/components/NpRelated.svelte (the pane idiom): `let relatedFor = '';` PLAIN field (not $state) as the supersede guard; `$effect` reads `player.current`, writes `related`/`relatedLoading` (never reads them) → no self-invalidation. `.empty`, `.list` styles and `--color-text-muted` / `--color-surface` / `--color-bg` / `--color-primary` / `--color-text` vars.
</interfaces>
</context>

<tasks>

<task type="auto" tdd="true">
  <name>Task 1: Server — pure comment helpers + /api/comments GET/POST/DELETE, tested against a fake R2 bucket</name>
  <files>src/lib/proxy/comments.ts, src/lib/proxy/comments.test.ts, src/routes/api/comments/+server.ts, src/routes/api/comments/comments-endpoint.test.ts</files>
  <behavior>
    Pure module (src/lib/proxy/comments.test.ts):
    - isThreadKey: 32 lowercase hex -> true; null / '' / 31 / 33 chars / uppercase / '../x' / 'log/x' -> false. threadObjectKey(k) === `comments/${k}.json`; throttleObjectKey('ab'.repeat(8)) === `comments-throttle/${'ab'.repeat(8)}.json`; isDiagKey (from $lib/proxy/diag-payload) is false for both (prefixes provably disjoint from `log/` and from `lyric-offset/`)
    - cleanName: 'Frank' -> 'Frank'; '  Frank  Chan ' -> 'Frank Chan' (whitespace collapsed + trimmed); 'e' + U+0301 (decomposed) -> 'é' (NFC); 'aU+202Eb' / 'aU+2066b' / 'aU+200Bb' / 'aU+0007b' / 'aU+FEFFb' -> 'ab' (bidi overrides + isolates, zero-width, C0/C1, BOM stripped); '' / '   ' / 'U+200B' -> null; 24 CJK chars -> kept; 25 CJK chars -> null; 24 emoji (each multi-unit) -> kept (code points, not UTF-16 units); non-string (42, null, undefined, {}) -> null
    - cleanText: 'hi' -> 'hi'; 'a\r\nb\rc' -> 'a\nb\nc'; 'a\n\n\n\nb' -> 'a\n\nb' (>2 newlines collapsed to 2); 'aU+0000bU+0085c' -> 'abc' (C0 except \n and C1 stripped); 'aU+202Eb' -> 'ab' (bidi controls stripped in text too — see action); ' x ' -> 'x'; '' / '\n\n' -> null; 280 code points -> kept; 281 -> null (REJECT, never truncate); a 280-emoji string -> kept; non-string -> null
    - parseCommentBody: '{"k":K,"name":"A","text":"hi"}' -> {action:'post', k, name:'A', text:'hi'}; same with "action":"post" -> same; '{"k":K,"action":"report","id":UUID}' -> {action:'report', k, id}; not JSON / array / missing k / bad k / action 'delete' / post with empty name / post with 281-char text / report with id 'x' or id missing or id with a `/` -> null; extra fields ignored
    - parseThread: null / '' / 'not json' / '[]' / '{"v":2}' -> {v:1, items:[]}; an items array with one valid item and one item whose reporters is not an array, whose t is a string, or whose id is not a string -> only the valid item survives; round-trips a valid record
    - addComment: prepends; returns a NEW record (input untouched); after 101 comments exactly MAX_ITEMS (100) remain and the one with the smallest t is gone; items are ordered newest-first by t
    - addReport: unknown id -> null; first report appends the voter; the SAME voter again -> reporters length unchanged (idempotent); 3 distinct voters -> reporters.length 3
    - removeComment: unknown id -> null; known id -> new record without it, others intact
    - publicItems: excludes any item with reporters.length >= HIDE_REPORTS (3); includes one with 2; output objects have EXACTLY the keys id, name, text, t (no `reporters`); ordered newest-first
    - maintainerItems: includes hidden items; each has {id, name, text, t, reports: number, hidden: boolean}; the JSON never contains a reporter hash string
    - checkThrottle: null state -> ok, next {last: now, day: <UTC yyyy-mm-dd of now>, n: 1}; last = now - 29_999 -> not ok; last = now - 30_000 -> ok with n incremented on the same day; same day n = 30 -> not ok even after 30 s; previous day n = 30 -> ok, next.n === 1 (day rollover resets); parseThrottle rejects non-object / non-number last / non-string day and returns null
    - voterId('1.2.3.4'): /^[0-9a-f]{16}$/; deterministic; differs for another ip; equals the first 16 hex of SHA-256('1.2.3.4|comments') via node:crypto; does not contain '1.2.3.4'
    Route (src/routes/api/comments/comments-endpoint.test.ts):
    - GET: bad/missing k -> 400 invalid-key, bucket untouched; no binding / no platform -> 503 unconfigured (never throws); no object -> 200 {ok:true, items:[]} with Cache-Control 'public, max-age=60' and bucket.get called ONCE with exactly `comments/<k>.json`; a seeded thread with 2 visible + 1 hidden (3 reporters) -> items has the 2 visible, newest first, and the response text contains neither 'reporters' nor any reporter hash; cache hit (stubbed `caches`) -> 200 from cache, bucket.get NOT called; cache miss -> cache.put once with the own-origin URL `https://openmusic.lol/api/comments?k=<k>`; `&all=1` WITHOUT a token, with a wrong token, or with env lacking DIAG_READ_TOKEN -> 401 unauthorized and bucket.get NOT called and cache.match NOT called; `&all=1` + correct Bearer -> 200 with hidden items included, each with `reports` and `hidden`, NO Cache-Control header, cache.match and cache.put NOT called
    - POST rejects (bucket get+put NOT called): no binding -> 503; Origin 'https://evil.example' -> 403 forbidden-origin; content-type 'text/plain' or absent -> 415 unsupported-type; content-length '3000' -> 413 too-large before the body is read; a 2100-char body with no content-length -> 413; 'not json' / bad k / empty name / 281-char text / report with a bad id -> 400 invalid; getClientAddress null or throwing -> 400 no-address; an absent Origin (non-browser client) is still accepted
    - POST post (happy): first post -> 200 {ok:true, items:[{id, name, text, t}]} with NO Cache-Control; item.id matches the UUID regex; bucket.put called TWICE in order: throttle key `comments-throttle/<voter>.json` with `onlyIf: { etagDoesNotMatch: '*' }`, then `comments/<k>.json` with `onlyIf: { etagDoesNotMatch: '*' }`; neither stored text contains '1.2.3.4'; stored thread item has `reporters: []`; with `caches` stubbed, cache.delete called once with url `https://openmusic.lol/api/comments?k=<k>`; a second post from the SAME ip immediately -> 429 slow-down and the thread put NOT called again (put count stays 2); a second post from the same ip with Date.now mocked +30_000 -> 200 and the thread now has 2 items newest-first; a throttle object seeded with n: 30 for today's UTC day -> 429 even 60 s later; a throttle put that returns null (concurrent same-ip race) -> 429 slow-down and the thread untouched; a thread put that always returns null (throttle put succeeds) -> 409 conflict after exactly 3 thread put attempts (document: the throttle slot was consumed)
    - POST report: report on an unknown id -> 404 not-found; report from ip A -> 200 {ok:true, items} and the stored item has 1 reporter; the same ip again -> still 1; ips A, B, C -> after the third the public items no longer include it and the maintainer GET shows hidden:true, reports:3; reports do NOT touch the throttle key (no `comments-throttle/` put); a report still busts the cache
    - DELETE: no Authorization / wrong token / env without DIAG_READ_TOKEN -> 401 and bucket NOT touched (get or put), even with a valid k and id; correct token + bad k -> 400 invalid-key; correct token + no binding -> 503; unknown id -> 404; known id -> 200 {ok:true}, the thread no longer contains it, put used `onlyIf: { etagMatches }`, cache.delete called once with the ?k= URL
  </behavior>
  <action>
    **Pure module `src/lib/proxy/comments.ts`** (quick-260926-nsz). No I/O, no HTTP status knowledge — the `lyric-offset.ts` posture. Export:
    - constants `MAX_COMMENT_BODY_BYTES = 2048`, `MAX_ITEMS = 100`, `HIDE_REPORTS = 3`, `NAME_MAX = 24`, `TEXT_MAX = 280`, `POST_MIN_GAP_MS = 30_000`, `POST_DAILY_MAX = 30`, `COMMENTS_TTL = 60`.
    - types `Comment = { id: string; name: string; text: string; t: number; reporters: string[] }`, `ThreadRecord = { v: 1; items: Comment[] }`, `PublicComment = { id: string; name: string; text: string; t: number }`, `Throttle = { last: number; day: string; n: number }`.
    - `isThreadKey(k: string | null): k is string` — exactly `/^[0-9a-f]{32}$/`. `threadObjectKey(k)` -> `comments/${k}.json`; `throttleObjectKey(voter)` -> `comments-throttle/${voter}.json`. Comment: the ONLY two R2 key builders for this feature; callers pass values that already passed `isThreadKey` / came out of `voterId`, so the route can never reach `log/` (private listening logs) or `lyric-offset/`, and never lists.
    - `cleanName(raw: unknown): string | null` — non-string -> null; `normalize('NFC')`; strip with ONE regex: C0 + DEL + C1 (`U+0000..U+001F`, `U+007F..U+009F`), zero-width + bidi marks (`U+200B..U+200F`), line/para separators (`U+2028`, `U+2029`), bidi embeddings/overrides (`U+202A..U+202E`), word-joiner block (`U+2060..U+2064`), bidi isolates (`U+2066..U+2069`), BOM (`U+FEFF`); then collapse `\s+` to one space and trim; count code points with `[...s].length`; outside 1..NAME_MAX -> null. Comment WHY bidi/zero-width go: a name is an identity label, and "adminU+202E" style spoofing or an invisible-suffix impersonation of another name is the whole T-nsz-06 threat.
    - `cleanText(raw: unknown): string | null` — non-string -> null; NFC; `\r\n` and `\r` -> `\n`; strip C0 EXCEPT `\n` (`U+0000..U+0009`, `U+000B..U+001F`), DEL + C1 (`U+007F..U+009F`), and the same bidi override/isolate set as the name (`U+202A..U+202E`, `U+2066..U+2069`) — zero-width and NBSP-like chars are LEFT in text (they are legitimate in some scripts; the orchestrator spec only mandated bidi/zero-width for the name, bidi is added to text because it is one more char class in the same regex and it closes the display-spoofing trick — document this); collapse `\n{3,}` -> `\n\n`; trim; code points outside 1..TEXT_MAX -> null. REJECT, never truncate (a truncated comment silently changes what the user said).
    - `parseCommentBody(text: string): { action: 'post'; k: string; name: string; text: string } | { action: 'report'; k: string; id: string } | null` — never-throw JSON parse; plain object; `k` must pass `isThreadKey`; `action` absent or `'post'` -> `cleanName(raw.name)` and `cleanText(raw.text)` both non-null else null; `'report'` -> `id` must match the UUID regex `/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/` (lowercase, as `crypto.randomUUID()` emits); any other action -> null.
    - `emptyThread()`, `parseThread(text: string | null): ThreadRecord` — never-throw; anything not `{v:1, items:[...]}` -> empty; each item kept only if `id`/`name`/`text` are strings, `t` a finite number and `reporters` an array of strings (drop entry-by-entry).
    - `addComment(rec, c: Omit<Comment, 'reporters'>): ThreadRecord` — new record: `[{ ...c, reporters: [] }, ...rec.items]` sorted by `t` desc, sliced to `MAX_ITEMS` (the pure module adds `reporters: []` itself, so the route never spells the field). `addReport(rec, id, voter): ThreadRecord | null` — null if no item has `id`; if the voter is already in `reporters` return a record with identical content (idempotent); else append. `removeComment(rec, id): ThreadRecord | null` — null if unknown, else the record without it.
    - `publicItems(rec): PublicComment[]` — items with `reporters.length < HIDE_REPORTS`, sorted newest-first, projected to `{id, name, text, t}` ONLY. `maintainerItems(rec)` — all items, newest-first, projected to `{id, name, text, t, reports: reporters.length, hidden: reporters.length >= HIDE_REPORTS}` — never the hashes themselves.
    - `parseThrottle(text: string | null): Throttle | null` (never-throw; requires finite `last`, string `day`, finite `n`). `checkThrottle(th: Throttle | null, now: number): { ok: true; next: Throttle } | { ok: false }` — `day = new Date(now).toISOString().slice(0, 10)`; if `th` and `now - th.last < POST_MIN_GAP_MS` -> not ok; if `th` and `th.day === day` and `th.n >= POST_DAILY_MAX` -> not ok; else `next = { last: now, day, n: th && th.day === day ? th.n + 1 : 1 }`.
    - `voterId(ip: string): Promise<string>` — first 16 hex of `crypto.subtle.digest('SHA-256', TextEncoder(`${ip}|comments`))`. GLOBAL salt (not per-thread, unlike lyric-offset) BY DESIGN: the throttle is per IP across every song, so one address cannot spray every thread. Comment the residual: SHA-256 over the IPv4 space is brute-forceable offline, so a leaked BUCKET would de-anonymize reporters; the bucket is private and no hash ever leaves the edge; upgrade path = HMAC with a secret pepper once the account is reachable (T-nsz-09).

    **Route `src/routes/api/comments/+server.ts`** — export ONLY `GET`, `POST`, `DELETE` (top-level helper exports 500 at request time — the diag/lyric-offset header rule). Imports: `jsonResponse`, `isAllowedOrigin` from `$lib/proxy/http`; `edgeCache`, `ownOriginCacheKey` from `$lib/proxy/edge-cache`; `bearerMatches` from `$lib/proxy/diag-auth`; `Env` type; the pure module. Do NOT touch `corsHeaders` Allow-Methods (DELETE is curl-only; a browser never needs it). A local `bustGet(url, k)` helper (NOT exported) rebuilds `?k=<k>` and calls `edgeCache()?.delete(ownOriginCacheKey(getUrl))`.
    - `GET({ url, request, platform })`: `k` fails `isThreadKey` -> 400 `invalid-key` (before anything). `env = platform?.env as Env | undefined`. If `url.searchParams.get('all') === '1'`: `bearerMatches(request.headers.get('authorization'), env?.DIAG_READ_TOKEN)` false -> 401 `unauthorized` (BEFORE the binding lookup, cache or R2 — the diag GET order); bucket absent -> 503 `unconfigured`; read `threadObjectKey(k)`, `parseThread`, return `jsonResponse({ ok: true, items: maintainerItems(rec) }, origin)` with NO ttl and NO cache read/write (a maintainer view must be fresh and must never be cached where a public GET could hit it). Public branch: bucket absent -> 503; `cache = edgeCache()`, `cacheReq = ownOriginCacheKey(url)`; hit -> `jsonResponse(await hit.json(), origin, { ttl: COMMENTS_TTL })` (re-apply CORS for THIS origin); miss -> R2 get, `body = { ok: true, items: publicItems(rec) }`, `cache.put` the CORS-free copy with `Cache-Control: public, max-age=60`, return with `ttl: COMMENTS_TTL`. A missing object is a cacheable `{ok:true, items:[]}`.
    - `POST(event)`: EXACTLY the lyric-offset gate order: binding absent -> 503; Origin present and not `isAllowedOrigin` -> 403 `forbidden-origin`; content-type not starting `application/json` -> 415 `unsupported-type`; declared content-length > `MAX_COMMENT_BODY_BYTES` -> 413 `too-large`; `text = await request.text()`, real length > cap -> 413; `parseCommentBody` null -> 400 `invalid`; `getClientAddress()` in try/catch, falsy -> 400 `no-address`; `voter = await voterId(ip)`. Keep the mzn drive-by comment block (Origin + JSON-only closes the no-preflight cross-site POST).
      - `action === 'post'`: THROTTLE FIRST. `thKey = throttleObjectKey(voter)`; `thObj = await bucket.get(thKey)`; `th = thObj ? parseThrottle(await thObj.text()) : null`; `gate = checkThrottle(th, now)`; `!gate.ok` -> 429 `slow-down`; ONE conditional put of `gate.next` (`etagMatches` / `etagDoesNotMatch: '*'` exactly as the thread put); a null put -> 429 `slow-down` (two posts from the same address racing IS "too fast" — no retry loop). Then the thread read-modify-write, up to 3 attempts: get, `parseThread`, `next = addComment(rec, { id: crypto.randomUUID(), name, text, t: now })`, conditional put; success -> `bustGet`, return `jsonResponse({ ok: true, items: publicItems(next) }, origin)` (no ttl); 3 failures -> 409 `conflict`. Comment: on a 409 the throttle slot has already been consumed — accepted, the client tells the user to slow down and the next attempt 30 s later works; sequencing the throttle AFTER the thread write would let a racing pair double-post.
      - `action === 'report'`: thread RMW up to 3 attempts with `addReport(rec, id, voter)`; null -> 404 `not-found` (no put); success -> `bustGet`, `jsonResponse({ ok: true, items: publicItems(next) }, origin)`; 3 failures -> 409. Reports never touch the throttle key (one report per voter per comment is already enforced by the dedupe in `addReport`).
    - `DELETE({ url, request, platform })`: `bearerMatches(authorization, env?.DIAG_READ_TOKEN)` false -> 401 (FIRST, before k validation, binding or R2 — nothing about the request is inspected until the token passes); `k` / `id` from the query, `isThreadKey(k)` false -> 400 `invalid-key`, id failing the UUID regex -> 400 `invalid`; binding absent -> 503; thread RMW up to 3 attempts with `removeComment`; null -> 404; success -> `bustGet`, `jsonResponse({ ok: true }, origin)`; 3 failures -> 409. Header comment: the read token doubles as the moderation token on purpose — it is already the "maintainer's laptop only" credential (never on a device), and a second secret cannot be provisioned until wrangler auth is fixed.
    - `ponytail:` comment on POST naming the residual risks and upgrade path: IP rotation defeats the throttle; no profanity / word filter; illegal or defamatory content stays up until 3 reports or a maintainer delete; a coordinated 3-IP report hides any comment (accepted: hiding is reversible by delete-and-repost and the maintainer view still shows it). Upgrade path: Turnstile on POST + a Cloudflare rate-limiting rule + a word list, none of which need code changes here beyond a header check.

    **Tests.** Copy `fakeBucket()` / `conflictBucket()` / `stubCaches()` / `fakeEvent()` from `lyric-offset-endpoint.test.ts` verbatim (extend `fakeEvent` to accept `'DELETE'`). For the "thread put always loses but throttle put succeeds" case, `mockImplementation` on put to return null only when `key.startsWith('comments/')`. Use `vi.spyOn(Date, 'now')` (or `vi.setSystemTime`) for the 30 s / day-rollover cases. `env(bucket, token?)` -> `{ DIAG: bucket, DIAG_READ_TOKEN: token }`. Assert every reject path calls neither `get` nor `put`, that no public response text contains 'reporters' or any voter hash, and that DELETE with a bad token never calls `get`.
  </action>
  <verify>
    <automated>cd /Users/laichan/code/tung/openmusic && pnpm vitest --run src/lib/proxy/comments.test.ts src/routes/api/comments/comments-endpoint.test.ts && grep -v '^\s*//' src/routes/api/comments/+server.ts | grep -E '^export' | grep -vc -E '^export const (GET|POST|DELETE): RequestHandler' | grep -qx 0 && grep -c 'threadObjectKey(' src/routes/api/comments/+server.ts | grep -qvx 0 && grep -c 'throttleObjectKey(' src/routes/api/comments/+server.ts | grep -qvx 0 && grep -c 'bucket.list' src/routes/api/comments/+server.ts | grep -qx 0 && grep -v '^\s*//' src/routes/api/comments/+server.ts | grep -c 'reporters' | grep -qx 0 && grep -v '^\s*//' src/routes/api/comments/+server.ts | grep -c 'bearerMatches(' | grep -qx 2 && grep -c 'Allow-Methods' src/lib/proxy/http.ts | grep -qx 1 && grep -c "'GET, POST, OPTIONS'" src/lib/proxy/http.ts | grep -qx 1</automated>
  </verify>
  <done>Both test files green; `+server.ts` exports exactly `GET`, `POST`, `DELETE`; every R2 key goes through `threadObjectKey` / `throttleObjectKey`; the route never lists and never names `reporters` outside comments (projections come from the pure module); `bearerMatches` guards exactly the `all=1` GET and DELETE; Allow-Methods unchanged; throttle (30 s / 30 per UTC day / race -> 429), hide-at-3, idempotent report, maintainer view, fail-closed token, cache bust and 409-after-3 are all pinned by tests; the raw IP never appears in a stored object or a response.</done>
</task>

<task type="auto" tdd="true">
  <name>Task 2: Client — songKey export from dedupe + never-throw comments service (thread key, fetch/post/report, relative time)</name>
  <files>src/lib/services/dedupe.ts, src/lib/services/comments.ts, src/lib/services/comments.test.ts</files>
  <behavior>
    dedupe (existing src/lib/services/dedupe.test.ts must stay green unchanged — it pins key() behaviour):
    - `songKey('周杰倫', '顏色')` === `songKey('周杰伦', '颜色')` after `await warmScript('zh-Hans')` (assert in comments.test.ts); `sameSongKey` / `dedupeBest` / `groupVariants` behaviour byte-identical (the whole existing dedupe suite)
    Service (src/lib/services/comments.test.ts; `__resetGovernor()` in beforeEach, `vi.unstubAllGlobals()` in afterEach; stub `fetch` with vi.stubGlobal as lyric-offset-shared.test.ts does):
    - commentThreadKey: `await warmScript('zh-Hans')` once at the top of the describe (the dedupe.test.ts:225 idiom); ('Gareth.T', '顏色') === ('Gareth.T', '颜色') === ('gareth.t', '颜色 (Live)') (Traditional/Simplified, case, bracket suffix all fold to ONE thread); ('Gareth.T', '玻璃') !== ('Gareth.T', '顏色'); the value matches /^[0-9a-f]{32}$/ and equals node:crypto sha256(songKey(artist, title)).hex.slice(0, 32); ('A', '') and ('A', '   ') -> null; with `crypto.subtle` stubbed to undefined -> null (no throw)
    - fetchComments(k): fetch called with a URL ending exactly '/api/comments?k=<k>' and method GET; 200 {ok:true, items:[{id,name,text,t}]} -> that array; 200 with a malformed item (t a string) -> that item dropped, others kept; 200 {ok:false} -> null; 503 -> null; fetch rejecting -> null; an already-aborted caller signal -> null
    - postComment(k, name, text): fetch called ONCE, method POST, header content-type application/json, body JSON.parse -> {k, name, text} (no action field needed); 200 {ok:true, items:[…]} -> {ok:true, items}; 429 -> {ok:false, err:'slow-down'}; 400 / 413 / 415 / 403 -> {ok:false, err:'invalid'}; 409 / 503 / rejecting fetch / 200 with a non-array items -> {ok:false, err:'unavailable'}; never throws
    - reportComment(k, id): body JSON.parse -> {k, id, action:'report'}; 200 -> true; 404 / 503 / rejecting -> false
    - relativeTime(t, now, lang): now - 5_000 -> 'now'-ish (the Intl output for 0 minutes with numeric:'auto' in 'en' is 'this minute' — assert it is a non-empty string and does NOT contain a digit); now - 3 * 60_000 -> contains '3' (minutes); now - 2 * 3_600_000 -> contains '2' (hours); now - 3 * 86_400_000 -> contains '3' (days); now - 40 * 86_400_000 -> contains '1' (months); a bogus lang 'xx-INVALID-!!' -> still returns a non-empty string (falls back to 'en', never throws); lang 'zh-Hant' -> a non-empty string
  </behavior>
  <action>
    **`src/lib/services/dedupe.ts`** — a pure extraction, zero behaviour change (quick-260926-nsz): add `export function songKey(artist: string, title: string): string` containing the CURRENT body of `key(t)` with `t.artist` / `t.title` replaced by the parameters, and reduce `key(t)` to `return songKey(t.artist, t.title);`. Keep every existing comment on `key()` (they are decision records); add one line above `songKey` saying it is exported so the comment thread key (`services/comments.ts`) hashes the SAME script-folded identity dedupe already uses, instead of a second normalizer that would drift. Do NOT change `matchKey` / `norm` in match-key.ts (artist-first, no script fold — a different, deliberately separate contract).

    **`src/lib/services/comments.ts`** (pure .ts, never-throw, sentinel returns — the `lyric-offset-shared.ts` posture). Imports: `apiFetch` from `$lib/services/api-base`; `songKey` from `$lib/services/dedupe`; `warmScript`, `t2sConvertLineSync` from `$lib/services/zh-convert`. Export:
    - types `CommentItem = { id: string; name: string; text: string; t: number }`, `CommentErr = 'slow-down' | 'invalid' | 'unavailable'`.
    - `commentThreadKey(artist: string, title: string): Promise<string | null>` — `if (!title?.trim() || typeof crypto === 'undefined' || !crypto.subtle) return null` (non-secure origin -> comments unavailable, same reason as `lyricOffsetKey`). If `/\p{Script=Han}/u` matches `artist + title`: `await warmScript('zh-Hans')` and then `if (t2sConvertLineSync(title) === null) return null` — COMMENT WHY: `songKey` folds Traditional->Simplified only when the t2s dict is warm and otherwise returns the unfolded spelling, which is fine for dedupe (keys are compared within one call, never persisted) but fatal here (the key IS persisted as the thread namespace: a cold-dict key would open a second thread for the same song). Deterministic-or-nothing. Then `s = songKey(artist, title)`; if `s` is empty or its title half (before the `|`) is empty -> null; SHA-256 of `s` -> hex -> first 32 chars; any throw -> null.
    - `fetchComments(k, signal?): Promise<CommentItem[] | null>` — `apiFetch(`/api/comments?k=${k}`, { signal })` (EXACTLY this query string: the server busts its edge cache by rebuilding it); `!res.ok` -> null; body `.ok !== true` or `items` not an array -> null; keep only items with string `id`/`name`/`text` and finite number `t` (a defensive projection, so a shape drift can never put `undefined` into the render tree); any throw -> null.
    - `postComment(k, name, text): Promise<{ ok: true; items: CommentItem[] } | { ok: false; err: CommentErr }>` — `apiFetch('/api/comments', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ k, name, text }) })` (content-type REQUIRED — the 33-07 Cloudflare lesson); status 429 -> `slow-down`; 400 / 403 / 413 / 415 -> `invalid`; `res.ok` with a valid items array -> `{ ok: true, items }` (same projection as fetch); everything else (409, 5xx, throw, bad shape) -> `unavailable`.
    - `reportComment(k, id): Promise<boolean>` — same POST with `{ k, id, action: 'report' }`; `res.ok` -> true; else / throw -> false.
    - `relativeTime(t: number, now: number, lang: string): string` — pick the largest unit among minute / hour / day / month (30 d) / year (365 d) whose magnitude is >= 1 (minutes when under an hour, including 0), `new Intl.RelativeTimeFormat(lang, { numeric: 'auto' }).format(-n, unit)`; wrap construction in try/catch and retry with `'en'` on a RangeError (an unknown tag), final fallback the empty-string-free `'en'` result. Comment: native Intl, no date library, no ticking timer — the pane re-renders when items change, which is enough for "3 minutes ago".
  </action>
  <verify>
    <automated>cd /Users/laichan/code/tung/openmusic && pnpm vitest --run src/lib/services/comments.test.ts src/lib/services/dedupe.test.ts && grep -c 'export function songKey(' src/lib/services/dedupe.ts | grep -qx 1 && grep -c 'return songKey(t.artist, t.title)' src/lib/services/dedupe.ts | grep -qx 1 && grep -cE '(^|[^A-Za-z])fetch\(' src/lib/services/comments.ts | grep -qx 0 && grep -c 'apiFetch(' src/lib/services/comments.ts | grep -qx 3 && grep -c 'warmScript(' src/lib/services/comments.ts | grep -qx 1</automated>
  </verify>
  <done>dedupe suite unchanged and green; `songKey` exported and `key()` delegates to it; comments service tests green; the service has zero raw `fetch(` (all three calls go through `apiFetch`); the thread key is deterministic across Traditional/Simplified copies only because the dict is awaited first, and is null (unavailable) when it cannot be.</done>
</task>

<task type="auto">
  <name>Task 3: UI — NpComments pane, 4th Now Playing tab (narrow) + Related | Comments toggle (wide), i18n in all 15 locales</name>
  <files>src/lib/components/NpComments.svelte, src/lib/components/NowPlaying.svelte, src/lib/i18n/en.ts, src/lib/i18n/ar.ts, src/lib/i18n/de.ts, src/lib/i18n/es.ts, src/lib/i18n/fr.ts, src/lib/i18n/hi.ts, src/lib/i18n/id.ts, src/lib/i18n/it.ts, src/lib/i18n/pt.ts, src/lib/i18n/ru.ts, src/lib/i18n/th.ts, src/lib/i18n/tr.ts, src/lib/i18n/vi.ts, src/lib/i18n/zh-Hans.ts, src/lib/i18n/zh-Hant.ts</files>
  <action>
    **i18n — 13 keys, DOUBLE quotes, in `en.ts` next to `nowplaying.related`, and translated in ALL 14 other locales** (`i18n.test.ts` guards key parity, blank values and quote style):
    `nowplaying.comments` "Comments" · `comments.namePlaceholder` "Your name" · `comments.defaultName` "Listener" · `comments.textPlaceholder` "Say something about this song…" · `comments.post` "Post" · `comments.remaining` "{n} left" · `comments.publicNote` "Comments are public — be kind." · `comments.empty` "No comments yet. Be the first." · `comments.loading` "Loading comments…" · `comments.unavailable` "Comments are unavailable right now." · `comments.slowDown` "Slow down — try again in a moment." · `comments.invalid` "That comment can't be posted." · `comments.report` "Report" · `comments.reportConfirm` "Confirm report" (14 keys; keep `{n}` verbatim in every translation).

    **`src/lib/components/NpComments.svelte`** (runes, no props; the NpRelated shape). Imports: `browser` from `$app/environment`; `player` from `$lib/stores/player.svelte`; `settings` from `$lib/stores/settings.svelte`; `t` from `$lib/i18n`; `tapBounce` from `$lib/actions/tapBounce`; `commentThreadKey`, `fetchComments`, `postComment`, `reportComment`, `relativeTime` and the types from `$lib/services/comments`.
    - State: `items = $state<CommentItem[]>([])`, `loading = $state(false)`, `unavailable = $state(false)`, `threadKey = $state<string | null>(null)`, `name = $state(readName())`, `text = $state('')`, `posting = $state(false)`, `err = $state<CommentErr | null>(null)`, `armed = $state<string | null>(null)` (the id whose Report button is on its confirm step), `reported = $state<string[]>([])`. PLAIN field `let commentsFor = ''` — the supersede guard, deliberately NOT `$state` (the player.svelte.ts generation-guard convention).
    - `readName()` / `writeName(n)`: localStorage key `openmusic:comment-name:v1`, `browser`-guarded and try/catch (private mode throws); an empty stored name reads as `''` so the placeholder shows.
    - Fetch `$effect`: reads `player.current`; `if (!cur || commentsFor === cur.uid) return;` then `commentsFor = cur.uid`, reset `items`/`err`/`armed`/`threadKey`/`unavailable`, `loading = true`, and run an async IIFE: `k = await commentThreadKey(cur.artist, cur.title)`; `if (commentsFor !== cur.uid) return` (a newer song owns the pane — the reply for the previous song is dropped); `!k` -> `unavailable = true; loading = false; return`; `threadKey = k`; `got = await fetchComments(k)`; guard again; `got === null ? unavailable = true : items = got`; `loading = false`. The effect never READS the state it writes (only `player.current` and the plain guard), so it cannot self-invalidate (restore-effect-self-invalidation-loop). No IntersectionObserver: the pane is only mounted when its tab/column is selected, and the cost is ONE edge-cached GET per track change through the apiFetch governor.
    - `submit()`: `if (!threadKey || posting) return`; `body = text.trim()`, empty -> return; `n = name.trim() || t('comments.defaultName')`; `writeName(name.trim())`; `posting = true; err = null`; `uid = commentsFor`; `r = await postComment(threadKey, n, body)`; `if (commentsFor !== uid) return` (song changed mid-post: drop); `r.ok ? (items = r.items, text = '') : err = r.err`; `posting = false`.
    - `report(id)`: `if (armed !== id) { armed = id; return; }` (first tap arms — the button label flips to `comments.reportConfirm`); second tap: `armed = null; reported = [...reported, id]; if (threadKey) void reportComment(threadKey, id)` (fire-and-forget; a failed report just means one fewer voice). `visible = $derived(items.filter((i) => !reported.includes(i.id)))` — the reporter stops seeing it at once, whatever the server decides.
    - Markup: `<div class="cm-pane">` · composer at the top: `<input maxlength="24" bind:value={name} placeholder={t('comments.namePlaceholder')} autocomplete="nickname">`, `<textarea maxlength="280" bind:value={text} placeholder={t('comments.textPlaceholder')} rows="3">`, a row with `<span class="muted">{t('comments.remaining', { n: 280 - [...text].length })}</span>` and `<button class="post" disabled={!text.trim() || posting || !threadKey} onclick={submit} use:tapBounce>{t('comments.post')}</button>`; `{#if err}<p class="err">{t(err === 'slow-down' ? 'comments.slowDown' : err === 'invalid' ? 'comments.invalid' : 'comments.unavailable')}</p>{/if}`; `<p class="muted note">{t('comments.publicNote')}</p>`. Then `{#if unavailable}<p class="empty">{t('comments.unavailable')}</p>{:else if loading}<p class="empty">{t('comments.loading')}</p>{:else if !visible.length}<p class="empty">{t('comments.empty')}</p>{:else}<ul class="list">{#each visible as c (c.id)}<li class="cm"><div class="head"><span class="name">{c.name}</span><span class="muted time">{relativeTime(c.t, Date.now(), settings.appLang)}</span><button class="report" class:armed={armed === c.id} onclick={() => report(c.id)}>{t(armed === c.id ? 'comments.reportConfirm' : 'comments.report')}</button></div><p class="text">{c.text}</p></li>{/each}</ul>{/if}`. `{c.name}` / `{c.text}` are PLAIN interpolations — NEVER `{@html}` (T-nsz-01); `.text { white-space: pre-wrap; overflow-wrap: anywhere; }` renders the newlines and prevents a 280-char no-space string from blowing the column. Disable the composer (`disabled`) while `unavailable`.
    - Styles: reuse the NpRelated tokens — `.cm-pane { min-height: 96px; padding: 0 2px; }`, inputs/textarea `background: var(--color-surface); color: var(--color-text); border: none; border-radius: 8px; padding: 8px 10px; width: 100%; font: inherit;`, `.post { background: var(--color-primary); color: #fff; border: none; border-radius: 999px; padding: 6px 14px; }` + `:disabled { opacity: .5 }`, `.muted { color: var(--color-text-muted); font-size: .75rem; }`, `.err { color: #f66; font-size: .8125rem; }`, `.list { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 10px; }`, `.name { font-weight: 600; font-size: .875rem; }`, `.report { background: none; border: none; color: var(--color-text-muted); font-size: .75rem; margin-left: auto; min-height: 32px; }` + `.report.armed { color: #f66; }`, `.empty` as NpRelated. Keep it under ~60 lines of CSS.

    **`src/lib/components/NowPlaying.svelte`** (quick-260926-nsz):
    - L52-54: `import NpComments from '$lib/components/NpComments.svelte';`. L63: `type Tab = 'queue' | 'lyrics' | 'related' | 'comments';`.
    - `selectTab` (L797): change the half-open line to `if (sheetState === 'closed' && !wide) sheetState = 'half';` with a comment: at >=1280px `closed` is the resting state with every column fully on screen (see `upNextPaneOpen`), so a tap on the new wide heading toggle must switch the column, not move the sheet.
    - Narrow subnav (L1123-1128): add a 4th button `data-tab="comments" class:active={tab === 'comments'} onclick={() => selectTab('comments')} use:tapBounce` with `{t('nowplaying.comments')}`. Narrow panel (L1171-1175): `{:else if tab === 'related'}{@render relatedPane()}{:else}{@render commentsPane()}`.
    - Add `{#snippet commentsPane()}<NpComments />{/snippet}` beside the other three.
    - Wide heads (L1115-1121): the row loses `aria-hidden="true"` (it now holds real controls); the Up Next and Lyrics headings each get `aria-hidden="true" tabindex="-1"` (still inert, still the drag surface); the third cell becomes `<span class="pair"><button data-tab="related" class:active={tab !== 'comments'} onclick={() => selectTab('related')} use:tapBounce>{t('nowplaying.related')}</button><button data-tab="comments" class:active={tab === 'comments'} onclick={() => selectTab('comments')} use:tapBounce>{t('nowplaying.comments')}</button></span>`. The existing grip machinery already handles these: `gripDown` finds `.subnav button[data-tab]`, a TAP calls `selectTab` in `gripUp` and arms the click suppressor, so `onclick` does not double-fire (it stays for keyboard activation). Comment that.
    - Wide third column (L1168): `<div class="panel">{#if tab === 'comments'}{@render commentsPane()}{:else}{@render relatedPane()}{/if}</div>` — `tab` was unused at >=1280px, so it becomes the third column's selector for free: no second state, and a phone-to-desktop resize carries the choice across. Toggling unmounts NpRelated (one searchAll on toggle-back, same as switching tabs on a phone — accepted).
    - CSS: replace the dead `.subnav.heads span` rule (the known unused-selector warning) with `.subnav.heads .pair { display: flex; justify-content: center; gap: 2px; }`; the pair's buttons inherit `.subnav button` / `.active`.
  </action>
  <verify>
    <automated>cd /Users/laichan/code/tung/openmusic && pnpm test 2>&1 | tail -5 && pnpm check 2>&1 | tail -3 && for f in src/lib/i18n/{en,ar,de,es,fr,hi,id,it,pt,ru,th,tr,vi,zh-Hans,zh-Hant}.ts; do grep -c '"nowplaying.comments"' "$f" | grep -qx 1 || { echo "MISSING $f"; exit 1; }; grep -c '"comments.reportConfirm"' "$f" | grep -qx 1 || { echo "MISSING $f"; exit 1; }; done && grep -c '@html' src/lib/components/NpComments.svelte | grep -qx 0 && grep -c 'data-tab="comments"' src/lib/components/NowPlaying.svelte | grep -qx 2 && grep -c '<NpComments' src/lib/components/NowPlaying.svelte | grep -qx 1 && grep -c "'comments'" src/lib/components/NowPlaying.svelte | grep -qvx 0 && grep -c 'openmusic:comment-name:v1' src/lib/components/NpComments.svelte | grep -qx 1 && grep -c '.subnav.heads span' src/lib/components/NowPlaying.svelte | grep -qx 0 && echo GREPS-OK</automated>
    <human-check>Orchestrator E2E on the dev server (4321 or 5173 — probe) or `wrangler pages dev` with a spoofed `cf-connecting-ip`: (1) play a qq song, open Now Playing → Comments, post as "Frank" → appears at top with "this minute"; (2) play the kuwo / joox copy of the same song (or its Traditional-spelling copy) → the same comment is there; (3) post again within 30 s → the slow-down line; (4) `curl -H "Authorization: Bearer $DIAG_READ_TOKEN" "http://localhost:4321/api/comments?k=<k>&all=1"` lists it with reports:0; report it from 3 spoofed IPs → public GET drops it, `all=1` shows hidden:true; (5) `curl -X DELETE -H "Authorization: Bearer $DIAG_READ_TOKEN" "…/api/comments?k=<k>&id=<id>"` → 200 and gone; without the header → 401; (6) at >=1280px the third heading reads Related | Comments and toggles the column without moving the sheet; on a phone width the 4th tab appears.</human-check>
  </verify>
  <done>`pnpm test` and `pnpm check` green (0 errors; the `.subnav.heads span` warning is gone); all 15 locales carry the 14 keys; NpComments renders names/text as plain interpolation only; the comments tab exists on narrow (4th button) and as the third-column toggle on wide; the display name persists under `openmusic:comment-name:v1`; a track change drops any in-flight reply for the previous song.</done>
</task>

</tasks>

<threat_model>
## Trust Boundaries

| Boundary | Description |
|----------|-------------|
| browser → POST /api/comments | Public, unauthenticated free-text write from ANY visitor (the new surface) |
| browser → GET /api/comments | Public read of UGC; edge-cached |
| maintainer curl → GET ?all=1 / DELETE | Bearer `DIAG_READ_TOKEN` (laptop-only credential) |
| edge → R2 `DIAG` bucket | Shared with PRIVATE `log/` listening logs and `lyric-offset/` |
| R2 UGC → NpComments render | Untrusted stored strings enter the DOM |

## STRIDE Threat Register

| Threat ID | Category | Component | Disposition | Mitigation Plan |
|-----------|----------|-----------|-------------|-----------------|
| T-nsz-01 | Tampering (XSS) | NpComments render of `name` / `text` | mitigate | Plain `{c.text}` / `{c.name}` interpolation only, `@html` forbidden (grep gate); C0/C1 + bidi controls stripped server-side in `cleanName` / `cleanText`; `pre-wrap` + `overflow-wrap: anywhere` so layout cannot be broken |
| T-nsz-02 | Tampering | R2 key namespace | mitigate | `isThreadKey` 32-hex screen before any I/O; `threadObjectKey` / `throttleObjectKey` are the only key builders (`comments/`, `comments-throttle/` prefixes, provably disjoint from `log/` and `lyric-offset/`); never `bucket.list` (grep gates) |
| T-nsz-03 | Spoofing (CSRF / drive-by post) | POST from a foreign page | mitigate | Origin allow-list (403) + `application/json` only (415) exactly as lyric-offset; hooks.server.ts preflight denies foreign origins |
| T-nsz-04 | Denial of service (spam flood) | POST /api/comments, R2 class-A ops | mitigate (partial) | Per-IP throttle: 30 s gap + 30/UTC-day via conditional-put throttle object → 429; body cap 2 KB screened before parse; 100 items per thread; `ponytail:` names Turnstile + CF rate-limit rule as the upgrade |
| T-nsz-05 | Denial of service (sybil) | Throttle bypass by IP rotation | accept | Cannot be closed without Turnstile / account-level rules (account unreachable); report-to-hide + maintainer delete bound the damage; documented in the POST comment |
| T-nsz-06 | Spoofing (impersonation) | Display name free-form | accept (reduced) | Bidi/zero-width/control stripping + whitespace collapse + 24 code-point cap stop invisible-suffix and RTL-override tricks; identical visible names remain possible by design (user accepted the risk) |
| T-nsz-07 | Information disclosure | Reporter hashes / IP-derived values | mitigate | `publicItems` / `maintainerItems` projections; route never names `reporters` (grep gate); tests assert no hash / raw IP in any response; raw IP never stored |
| T-nsz-08 | Elevation of privilege | `all=1` GET and DELETE | mitigate | `bearerMatches` fails CLOSED (unset token = locked), checked BEFORE binding, cache or R2; maintainer view never cached; DELETE not added to Allow-Methods (curl-only) |
| T-nsz-09 | Information disclosure | `voterId` = SHA-256(ip|comments) in a private bucket | accept | Brute-forceable over IPv4 only with bucket access, which is maintainer-only; upgrade = HMAC with a secret pepper once wrangler auth works |
| T-nsz-10 | Tampering (coordinated hiding) | 3 reports hide any comment | accept | Reversible (maintainer view keeps it, delete-and-repost); the MVP trades false hides for zero unmoderated exposure |
| T-nsz-11 | Repudiation / legal | Illegal or defamatory content | accept (MVP) | Public note "Comments are public"; report + maintainer delete are the takedown path; no profanity filter (deferred, named in the `ponytail:` comment) |
| T-nsz-12 | Tampering (lost write) | Concurrent posts on one thread | mitigate | Conditional puts (`etagMatches` / `etagDoesNotMatch: '*'`), 3 attempts → 409; a consumed throttle slot on 409 is documented and accepted |
| T-nsz-SC | Tampering | npm/pip/cargo installs | n/a | No new dependencies (native `crypto.subtle`, `Intl.RelativeTimeFormat`, existing `tongwen` dynamic import) |
</threat_model>

<verification>
- Task 1: `pnpm vitest --run src/lib/proxy/comments.test.ts src/routes/api/comments/comments-endpoint.test.ts` green + the export / key-builder / no-list / no-`reporters` / `bearerMatches` count / Allow-Methods grep gates.
- Task 2: `pnpm vitest --run src/lib/services/comments.test.ts src/lib/services/dedupe.test.ts` green + `songKey` export / delegation / zero raw `fetch(` gates.
- Task 3: `pnpm test` (all files) and `pnpm check` (0 errors) + locale key presence in all 15 files + no `@html` + tab wiring greps.
- Live probe (executor, curl on the dev server — proves SvelteKit loads the route module, which unit tests cannot): `GET /api/comments?k=<32hex>` → 200 `{"ok":true,"items":[]}`; `?k=bad` → 400; a JSON POST with `Origin: http://localhost:4321` → 200 with the item; the same POST again → 429; `DELETE` without a bearer → 401. Under vite dev the DIAG binding is local miniflare R2 (see the mzn SUMMARY drift note), so use a fresh key and expect real writes into `.wrangler/state`.
- Multi-IP hide-at-3 and the wide toggle are the orchestrator's E2E (`<human-check>` in Task 3).
</verification>

<success_criteria>
- A comment posted on the qq copy of a song is visible on the kuwo / netease / joox copies and on the Traditional-spelling copy (one thread per `songKey` hash).
- Posting twice within 30 s or 31 times in a UTC day answers 429 and the pane shows the slow-down line; a 281-code-point text or an empty name answers 400 and the pane shows the invalid line; no DIAG binding answers 503 and the pane shows the unavailable line.
- Three distinct reporters hide a comment from the public GET; the maintainer `all=1` view still lists it with `reports: 3, hidden: true`; DELETE with the read token removes it; both maintainer paths 401 without the token and never touch R2 first.
- No response body ever contains `reporters`, a voter hash or a raw IP; comment text renders as text.
- `pnpm test` and `pnpm check` are green; every locale has the 14 new keys; the narrow subnav has 4 tabs and the wide third heading toggles Related | Comments without moving the sheet.
</success_criteria>

<output>
Create `.planning/quick/260926-nsz-per-song-comment-section-moderated-mvp/260926-nsz-SUMMARY.md` when done (record the live-probe results, the local-miniflare key you used, and any deviation from the gate order).
</output>
