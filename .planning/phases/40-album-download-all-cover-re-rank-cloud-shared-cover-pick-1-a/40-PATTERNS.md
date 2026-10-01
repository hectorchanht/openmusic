# Phase 40: Album download-all + cover re-rank + cloud-shared cover pick - Pattern Map

**Mapped:** 2026-09-30
**Files analyzed:** 27 new or modified (plus 15 locale files)
**Analogs found:** 26 / 27. Only the ZIP writer has no in-repo analog; its prototype is in RESEARCH Pattern 4.

> **CONTEXT amendments win over RESEARCH.** Where the two disagree, this map follows CONTEXT:
> - **D-08 chain** is **iTunes → QQ → Deezer → other CN → YTM**. RESEARCH says QQ first; that is superseded.
> - **D-10 picker order** stays: own, QQ, iTunes, Deezer, other CN, YTM. QQ is placed before iTunes here.
> - **D-11a:** DELETE the HQ upgrade (`resolveHqCover` + `upgradeCoverAsync` + the `else if` branch in `postPlayCover`). RESEARCH's "Pattern 6 gate it" is superseded. There is a deletion map below.
> - **D-11b:** YTM covers go into the uid layer ONLY, never the name layer. RESEARCH listed this as an optional Open Question 3; it is now required.
> - **D-18a:** add a per-IP vote throttle on POST, cloned from the comments route.
> - **D-14a:** the crowd pick outranks `attachedCoverFor` in the play seed.
> - **D-03:** the zip FILENAME names the album (`<Artist> - <Album>.zip`, sanitized).

## File Classification

| New/Modified File | Role | Data Flow | Closest Analog | Match Quality |
|---|---|---|---|---|
| `src/lib/proxy/cover-pick.ts` (NEW) | utility (pure edge helpers) | request-response / transform | `src/lib/proxy/lyric-offset.ts` | exact |
| `src/routes/api/cover-pick/+server.ts` (NEW) | route (GET+POST) | request-response + R2 CRUD | `src/routes/api/lyric-offset/+server.ts` (+ throttle from `src/routes/api/comments/+server.ts` L212-223) | exact |
| `src/routes/api/cover-pick/cover-pick-endpoint.test.ts` (NEW) | test | — | `src/routes/api/lyric-offset/lyric-offset-endpoint.test.ts` | exact |
| `src/lib/proxy/cover-pick.test.ts` (NEW) | test | — | `src/lib/proxy/lyric-offset.test.ts` (sibling) | exact |
| `src/lib/services/cover-pick-shared.ts` (NEW) | service (client, never-throw) | request-response | `src/lib/services/lyric-offset-shared.ts` | exact |
| `src/lib/services/cover-pick-shared.test.ts` (NEW) | test | — | lyric-offset-shared test (sibling) | exact |
| `src/lib/proxy/safe-image-url.ts` (MOD) | utility (security allowlist) | transform | itself (`YOUTUBE_IMAGE_HOSTS` L82-85) | exact |
| `src/lib/services/zip-store.ts` (NEW) | utility (pure) | transform / file-I/O | none in repo, use RESEARCH Pattern 4 | no analog |
| `src/lib/services/zip-store.test.ts` (NEW) | test | — | `download-filename.test.ts` style (pure) | role-match |
| `src/lib/services/download-album.ts` (NEW) | service (orchestration) | batch | `src/lib/services/retag.ts` `retagDownloads` L231-253 + `download-track.ts` | exact |
| `src/lib/services/download-album.test.ts` (NEW) | test | — | `src/lib/services/download-track.test.ts` L20-80 (hoisted mocks) | exact |
| `src/lib/services/download-filename.ts` (MOD) | utility (pure) | transform | itself (`sanitizeFilename` L77-79) | exact |
| `src/lib/services/download-track.ts` (MOD: `dir`, `onSaved` opts) | service | file-I/O | itself L93-96, L291-293 | exact |
| `src/lib/services/blob-store.ts` (MOD: sticky dir index, `put` opts, `moveToDir`) | service | file-I/O | itself: name index L116-175, `linkPublicUri` L860-871, `nativePut` L441-488 | exact |
| `src/lib/services/media-store.ts` (MOD) | config (plugin typing) | — | itself L35, L77 | exact |
| `android/.../MediaStoreSaverPlugin.kt` (MOD: `subPath`, `moveInMusic`) | native plugin | file-I/O | itself: `saveToMusic` L132-171, `performSave` L173-239, `deleteFromMusic` L242-270 | exact |
| `src/routes/(app)/album/[name]/+page.svelte` (MOD) | component (route page) | request-response | itself L445-487, L694 | exact |
| `src/lib/services/cover-backfill.ts` (MOD: QQ tier, reorder, delete HQ) | service | request-response (tier chain) | itself: `ytmusicSongCover` L199-206, `resolveTrackChain` L221-268, `collectCoverCandidates` L576-648 | exact |
| `src/lib/services/cover-cache.ts` (MOD: `crowd:` family) | utility (pure localStorage) | CRUD | itself: uid layer L105-116 + L302-313, pin store L405-471 | exact |
| `src/lib/stores/cover-version.svelte.ts` (MOD) | store (reactive wrapper) | event-driven | itself: `readPinnedCover` L111-114, `pinCover`/`unpinCover` L121-135, `writeCoverBoth` L154-158 | exact |
| `src/lib/stores/player.svelte.ts` (MOD) | store | event-driven (gen-guarded async) | itself: `resolveCoverAsync` L4114-4138, `adoptCover` L4240-4270, `healCover` L4332-4375 | exact |
| `src/lib/stores/library.svelte.ts` (MOD: D-11b gate in `adoptCover`) | store | CRUD | itself L131-155 | exact |
| `src/lib/components/TrackMenu.svelte` (MOD) | component | request-response | itself `pickCover` L346-358, `activeCover` L166-180 | exact |
| Row surfaces: `SongRow.svelte:201`, `CompactRow.svelte:82`, `NpUpNext.svelte:223`, `NpRelated.svelte:168`, `NowPlaying.svelte:392`, `(app)/+page.svelte:1041/1159/1534`, `settings/downloads/+page.svelte:177` (MOD) | component | reactive read | `src/lib/services/row-cover.ts` `pickRowCover` L40-47 | exact |
| `src/lib/i18n/*.ts` (15 files, MOD) | config (dictionaries) | — | `en.ts` L191 `"settings.retagProgress"` / L138 `"settings.migrateDownloadsResult"` | exact |
| Tests to extend: `cover-backfill.test.ts`, `player.svelte.test.ts`, `cover-cache.test.ts`, `cover-version.svelte.test.ts`, `blob-store.test.ts`, `download-track.test.ts`, `download-filename.test.ts`, `safe-image-url.test.ts` | test | — | themselves | exact |

---

## Pattern Assignments

### `src/lib/proxy/cover-pick.ts` (pure edge helpers)

**Analog:** `src/lib/proxy/lyric-offset.ts` (115 lines). Clone the whole shape, and replace the median/quorum with a count tally.

**Header posture** (L1-5): "pure helpers, no I/O, no HTTP status knowledge, never-throw screens that return a sentinel. The route turns sentinels into 4xx."

**Constants + types** (L14-24):
```ts
export const MAX_VOTE_BODY_BYTES = 256;   // cover-pick: 1024 (url up to 512 chars + two 32-hex keys)
export const MAX_VOTES = 50;
export const SHARED_OFFSET_TTL = 300;     // → COVER_PICK_TTL = 300
export type OffsetVote = { o: number; t: number };          // → PickVote = { u: string; t: number }
export type OffsetRecord = { v: 1; votes: Record<string, OffsetVote> };
```

**Key screen + the ONLY R2 key builder** (L27-38). It keeps the route away from `log/`, `comments/` and `lyric-offset/`:
```ts
export function isOffsetKey(k: string | null): k is string {
	return !!k && /^[0-9a-f]{32}$/.test(k);
}
export function offsetObjectKey(k: string): string {
	return `lyric-offset/${k}.json`;   // → pickObjectKey(kind: 'u' | 'n', k) => `cover-pick/${kind}/${k}.json`
}
```

**parseRecord** (L51-66). Copy it. The per-entry guard becomes `typeof e.u === 'string' && safeImageUrl(e.u, COVER_PICK_IMAGE_HOSTS)` in place of `inRange(e.o)`.

**parseVoteBody** (L72-83). Same never-throw JSON.parse + `isPlainObject` screen. It returns `{ u: string|null; n: string|null; url: string } | null`. At least one key must be present. `url` = `safeImageUrl(raw.url, COVER_PICK_IMAGE_HOSTS)`; store the returned normalized `href`.

**applyVote** (L86-92). Copy it verbatim: a re-vote replaces, and the record is capped to the 50 newest:
```ts
export function applyVote(rec: OffsetRecord, voter: string, offset: number, now: number): OffsetRecord {
	const votes = { ...rec.votes, [voter]: { o: offset, t: now } };
	const entries = Object.entries(votes);
	if (entries.length <= MAX_VOTES) return { v: 1, votes };
	entries.sort((a, b) => b[1].t - a[1].t);
	return { v: 1, votes: Object.fromEntries(entries.slice(0, MAX_VOTES)) };
}
```

**consensus.** REPLACE the median with RESEARCH §Code Examples "Cover-pick consensus": most votes wins, a tie goes to the most recent, no quorum (D-17).

**voterId** (L112-115). Per-key salt. Copy it verbatim:
```ts
export async function voterId(ip: string, k: string): Promise<string> {
	const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(`${ip}|${k}`));
	return Array.from(new Uint8Array(buf).slice(0, 8), (b) => b.toString(16).padStart(2, '0')).join('');
}
```

**D-18a throttle helpers.** Copy them from `src/lib/proxy/comments.ts`:
- `throttleObjectKey` L52-54 → `cover-pick-throttle/${voter}.json` (a distinct prefix).
- `parseThrottle` L194-207, `checkThrottle` L210-215 (define your own `*_MIN_GAP_MS` / `*_DAILY_MAX`).
- The GLOBAL-salt `voterId(ip)` L227-229 → name it e.g. `throttleVoterId(ip)` = SHA-256(`${ip}|cover-pick`), so it cannot collide with the per-key `voterId`.
```ts
export function checkThrottle(th: Throttle | null, now: number): { ok: true; next: Throttle } | { ok: false } {
	const day = new Date(now).toISOString().slice(0, 10);
	if (th && now - th.last < POST_MIN_GAP_MS) return { ok: false };
	if (th && th.day === day && th.n >= POST_DAILY_MAX) return { ok: false };
	return { ok: true, next: { last: now, day, n: th && th.day === day ? th.n + 1 : 1 } };
}
```
Ladder note: you could import `parseThrottle`/`checkThrottle` from `comments.ts` directly, but their constants are comment-specific. Either export a parameterized variant or copy the ~15 lines with your own constants. Do not change the comment limits.

---

### `src/routes/api/cover-pick/+server.ts` (GET + POST only)

**Analog:** `src/routes/api/lyric-offset/+server.ts` (143 lines). Clone it top to bottom.

**Header contract** (L11-12). Keep this wording: "THIS FILE MAY EXPORT ONLY HTTP-VERB HANDLERS — `GET` and `POST`" (memory: svelte-server-endpoint-only-verb-exports).

**Imports** (L14-29):
```ts
import type { RequestHandler } from './$types';
import type { Env } from '$lib/proxy/proxy-types';
import { jsonResponse, isAllowedOrigin } from '$lib/proxy/http';
import { edgeCache, ownOriginCacheKey } from '$lib/proxy/edge-cache';
import { /* isPickKey, pickObjectKey, parseVoteBody, parseRecord, emptyRecord, applyVote, consensus, voterId, ... */ } from '$lib/proxy/cover-pick';
const MAX_PUT_ATTEMPTS = 3;
```

**GET** (L33-67): key screen first, then 503 when the binding is absent, then edge-cache match, then R2 read, then a cacheable body, then `no-cache` to the browser:
```ts
if (!isOffsetKey(k)) return jsonResponse({ ok: false, err: 'invalid-key' }, origin, { status: 400 });
const bucket = (platform?.env as Env | undefined)?.DIAG;
if (!bucket) return jsonResponse({ ok: false, err: 'unconfigured' }, origin, { status: 503 });
const cache = edgeCache();
const cacheReq = ownOriginCacheKey(url);
if (cache) { const hit = await cache.match(cacheReq); if (hit) return jsonResponse(await hit.json(), origin, { cacheControl: 'no-cache' }); }
...
await cache.put(cacheReq, new Response(JSON.stringify(body), { headers: { 'content-type': 'application/json', 'Cache-Control': `public, max-age=${SHARED_OFFSET_TTL}` } }));
return jsonResponse(body, origin, { cacheControl: 'no-cache' });
```
Cover-pick changes:
- Read `u` and `n`. Each is optional, but both absent → 400, and any present one must pass `isPickKey`.
- Read both objects and return `{ ok: true, u: consensus(recU), n: consensus(recN) }`.

**POST preamble** (L78-116). Keep the order exactly: 503 → origin gate (403) → `application/json` (415) → content-length cap (413) → real-length cap (413) → parse (400) → `getClientAddress` in try/catch (400 `no-address`).

**D-18a throttle insert.** Put it AFTER the IP, BEFORE the vote RMW. Copy `src/routes/api/comments/+server.ts` L212-223:
```ts
const thKey = throttleObjectKey(voter);
const thObj = await bucket.get(thKey);
const gate = checkThrottle(thObj ? parseThrottle(await thObj.text()) : null, now);
if (!gate.ok) return jsonResponse({ ok: false, err: 'slow-down' }, origin, { status: 429 });
const thPut = await bucket.put(thKey, JSON.stringify(gate.next), {
	httpMetadata: { contentType: 'application/json' },
	onlyIf: thObj ? { etagMatches: thObj.etag } : { etagDoesNotMatch: '*' }
});
if (!thPut) return jsonResponse({ ok: false, err: 'slow-down' }, origin, { status: 429 });
```

**Conditional-put RMW + exact cache bust** (L124-142). Run it once per present key (`u`, `n`):
```ts
for (let attempt = 0; attempt < MAX_PUT_ATTEMPTS; attempt++) {
	const obj = await bucket.get(key);
	const rec = obj ? parseRecord(await obj.text()) : emptyRecord();
	const next = applyVote(rec, voter, vote.offset, Date.now());
	const put = await bucket.put(key, JSON.stringify(next), { httpMetadata: { contentType: 'application/json' }, onlyIf: obj ? { etagMatches: obj.etag } : { etagDoesNotMatch: '*' } });
	if (put) { const getUrl = new URL(url); getUrl.search = 'k=' + vote.k; await edgeCache()?.delete(ownOriginCacheKey(getUrl)); return jsonResponse({ ok: true, ...consensus(next) }, origin); }
}
return jsonResponse({ ok: false, err: 'conflict' }, origin, { status: 409 });
```
Bust the rebuilt `?u=..&n=..` GET URL. Its param order and the presence of each param must match what the client sends byte for byte (one shared builder, see the client section).

**ponytail comment** (L69-73). Rewrite it for cover-pick: the throttle exists now, the residual is IP rotation plus UGC hosts, and a local pin always wins.

---

### `src/routes/api/cover-pick/cover-pick-endpoint.test.ts`

**Analog:** `lyric-offset-endpoint.test.ts`. Copy these verbatim:
- `fakeBucket()` L19-37 (etag + conditional put), `conflictBucket()` L40-44
- `fakeEvent(method, opts)` L56-74 (`''` header drops Origin, `ip` injectable)
- `callGET`/`callPOST` L77-80
- `stubCaches()` L83ff

Header note (L7-8): the unit test cannot prove SvelteKit loads the module. Keep the manual `curl` row from RESEARCH Validation. For throttle cases, copy `comments-endpoint.test.ts` L342-410 (throttle put first, then a 429 on a lost race).

---

### `src/lib/services/cover-pick-shared.ts` (client, never-throw)

**Analog:** `src/lib/services/lyric-offset-shared.ts` (57 lines).

**Key hashing** (L16-24). Copy the `crypto.subtle` null-guard (LAN http dev), then add domain prefixes:
```ts
export async function lyricOffsetKey(uid: string, lrc: string): Promise<string | null> {
	if (!uid || !lrc || typeof crypto === 'undefined' || !crypto.subtle) return null;
	try {
		const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(`${uid}\n${lrc}`));
		return Array.from(new Uint8Array(buf).slice(0, 16), (b) => b.toString(16).padStart(2, '0')).join('');
	} catch { return null; }
}
```
In `coverPickKeys(uid, artist, title)`:
- `u` = hash of `'u\n' + uid`, skipped for an empty uid or a `device:` uid (`isDeviceUid` from `$lib/services/device-track`).
- `n` = hash of `'n\n' + matchKey(artist, title)` (`$lib/services/match-key` L38), skipped when the key is `'|'`.

**Fetch** (L32-41). Use `apiFetch` (`$lib/services/api-base` L262), with try/catch → null:
```ts
const res = await apiFetch(`/api/lyric-offset?k=${k}`, { signal });
if (!res.ok) return null;
const body = (await res.json()) as { offset?: unknown } | null;
```
Re-check every returned URL with `safeImageUrl(url, COVER_PICK_IMAGE_HOSTS)` before returning it (defense in depth). Build the query string with ONE helper that the server's bust mirrors.

**Submit** (L47-57). The `content-type: application/json` header is REQUIRED (Cloudflare 403s a JSON POST without it). Every failure is swallowed.

---

### `src/lib/proxy/safe-image-url.ts` (MOD, security control)

**Analog:** itself. Add constants in the existing shape (L53-85). Never re-inline the check. Use the RESEARCH §Code Examples "Allowlist addition" block verbatim:
- `CN_IMAGE_HOSTS` = `{ exact: ['y.gtimg.cn', 'api.qijieya.cn'], suffix: ['.kuwo.cn', '.music.126.net'] }`
- `COVER_PICK_IMAGE_HOSTS` composed from Deezer + Last.fm + Apple + KKBOX + YouTube + CN.

The leading dot on every suffix is load-bearing (L15-16). Extend `safe-image-url.test.ts` with these rejects: `img4.kuwo.cn.evil.example`, `http:`, quotes.

---

### `src/lib/services/zip-store.ts` (NEW, pure, no in-repo analog)

Use RESEARCH Pattern 4 (prototyped; CRC `cbf43926`, `unzip -t` clean). House-style rules from neighbouring pure modules:
- A module header comment with the decision ref (`Phase 40 D-03`), the APPNOTE section refs, and a `ponytail:` note on the Zip64 ceiling (return null above `0xFFFFFFFF` bytes or `0xFFFF` entries).
- Named exports only (`crc32`, `buildZip`, `type ZipEntry`). No store imports, so it stays node-testable (same purity contract as `download-filename.ts` L8-11).

---

### `src/lib/services/download-filename.ts` (MOD)

**Analog:** itself. Add `sanitizePathSegment`, `albumDir`, `albumFolder` that WRAP the one sanitizer (L66-79). Never create a second char class:
```ts
export function sanitizeFilename(name: string): string {
	return String(name ?? '').replace(/[/\\?%*:|"<>]/g, '_');
}
```
- Fix the wrong byte-length claim in the `MAX_FILENAME_BASE` comment (L81-86): 120 CJK chars is 360 bytes (RESEARCH Pitfall 8). Use a 180-byte UTF-8 cap via `new TextEncoder().encode(s).length`.
- The zip FILENAME (D-03) is `${albumFolder(artist, album)}.zip`, the same helper as the zip root folder.

---

### `src/lib/services/download-album.ts` (NEW orchestration)

**Analog A, the loop shape:** `src/lib/services/retag.ts` `retagDownloads` L231-253. Sequential, report after each item, and a broken progress callback must not abort the batch:
```ts
for (const entry of list) {
	const result = await retagOne(entry);
	if (result === 'tagged') report.tagged++;
	...
	done++;
	try { onProgress?.(done, report.total); } catch { /* a broken progress callback must not abort the batch (36-D-19). */ }
}
```

**Analog B, the contracts header + imports:** `src/lib/services/download-track.ts` L1-44. Copy the D-17 NEVER-THROWS / no `$lib/i18n` / no toast import posture (L10-14). Import from the same alias set:
```ts
import type { Track } from '$lib/sources/types';
import { library } from '$lib/stores/library.svelte';
import { blobStore } from '$lib/services/blob-store';
import { saveBlobToDisk } from '$lib/services/download-save';
import { downloadTrack } from '$lib/services/download-track';
import { sameSongKey } from '$lib/services/dedupe';          // dedupe.ts L215
import { Capacitor } from '@capacitor/core';
```

**Body to move out of the page:** album `+page.svelte` L459-487. Keep its 36-D-11 track-number comment (L467-472) verbatim. Change these:
- `persist: true, save: false` (D-04; RESEARCH Pattern 1).
- Drop the 250 ms stagger (L480-481). The single zip save replaces the per-song anchors.
- Look up held downloads with `library.downloads.find(d => d.uid === tr.uid || sameSongKey(d, tr))` (Pitfall 3), and use THAT entry's uid for `blobStore.get`/`moveToDir`.

---

### `src/lib/services/download-album.test.ts`

**Analog:** `download-track.test.ts` L20-80. Copy the `vi.hoisted` mocks block plus the `vi.mock(...)` lines. Mock `$lib/services/download-track`, `blob-store` (`put`, `get`, `has`, `moveToDir`), `download-save`, `library.svelte` (`downloads`), `@capacitor/core` (`isNativePlatform`). Leave `zip-store` real, or spy on `buildZip`.

---

### `src/lib/services/download-track.ts` (MOD)

**Opts signature** (L93-96). Add `dir?: string; onSaved?: (uid: string, filename: string, blob: Blob) => void`:
```ts
opts?: { persist?: boolean; save?: boolean; trackNumber?: string; albumArtist?: string; audioFrom?: Track }
```
**Persist seam** (L288-293). Thread `dir`. Spread it conditionally so the existing call-shape assertions stay green:
```ts
if (opts?.persist !== false) {
	await blobStore.put(r.uid, blob, filename);   // → put(r.uid, blob, filename, opts?.dir ? { dir: opts.dir } : undefined)
}
```
Fire `onSaved` before the `save === false` early return (L298), wrapped in try/catch. Update the doc comment at L62-66, which describes `persist:false` as "the album bulk path"; that is no longer true.

---

### `src/lib/services/blob-store.ts` (MOD)

**Sticky dir index.** Clone the name index L116-175: per-uid localStorage key, try/catch, never throws, with a WHY block comment.
```ts
function nameIndexKey(uid: string): string { return `openmusic-blob-name:${uid}`; }   // → `openmusic-blob-dir:${uid}`
export function getStoredName(uid: string): string | null {
	if (!uid) return null;
	try { return typeof localStorage !== 'undefined' ? localStorage.getItem(nameIndexKey(uid)) : null; } catch { return null; }
}
```
Re-sanitize on READ (T-3j1-01 precedent). The stored dir goes to Kotlin `RELATIVE_PATH`.

**put signature** (L727-729). Add `opts?: { dir?: string }` and pass it to `nativePut`.

**nativePut** (L476-479). Add the conditional `subPath` to the one `saveToMusic` call:
```ts
const { uri } = await MediaStoreSaver.saveToMusic({ fileName: filename ?? nativeFileName(uid), sourcePath });
if (uri) setStoredUri(uid, uri);
```
→ `const dir = opts?.dir ?? getStoredDir(uid)`, then `...(dir ? { subPath: dir } : {})`, then `setStoredDir` when `opts?.dir` is set. This is Pitfall 1: rewrite paths (`retag`, `pickCover` tag sync, lyric embed, background repair) call `put` with no dir, so the sticky read is what keeps album songs in their folder.

**del** (L839-844). Add `clearStoredDir(uid)` next to `clearStoredName(uid)`, ABOVE the native fork.

**moveToDir.** Model it on `linkPublicUri` L860-871: refuse `isDeviceUid` first, never throw. Add it to the namespace export at L874:
```ts
export const blobStore = { put, get, has, stat, del, linkPublicUri, getStoredName, overwriteDeviceFile };
```

---

### `src/lib/services/media-store.ts` (MOD)

Widen L35 to `saveToMusic(opts: { fileName: string; sourcePath: string; subPath?: string })`. Add `moveInMusic(opts: { uri: string; subPath: string }): Promise<{ uri: string }>` next to `deleteFromMusic` (L77), with a JSDoc in the same voice: what it does, the API 29+ vs ≤28 URI semantics, and what a reject means ("saved, not moved").

---

### `android/app/src/main/java/com/openmusic/app/MediaStoreSaverPlugin.kt` (MOD)

- **Path constant** L76: `private val relativePath = "${Environment.DIRECTORY_MUSIC}/OpenMusic/"` becomes `relPath(sub)` (RESEARCH Pattern 2 `safeSubPath` + `relPath`).
- **saveToMusic** L132-155: read `call.getString("subPath")`, validate with `safeSubPath` (reject on throw), and pass it to `performSave`.
- **publicMusicPermsCallback** L157-171: MUST also re-read `subPath` (Pitfall 2):
```kotlin
val fileName = call.getString("fileName")
val sourcePath = call.getString("sourcePath")
// + val subPath = call.getString("subPath")
performSave(call, fileName, sourcePath)
```
- **performSave** L185-193 (API 29+): `put(MediaStore.Audio.Media.RELATIVE_PATH, relativePath)` becomes `relPath(sub)`. Legacy L215-217: `val targetDir = File(musicDir, "OpenMusic")` becomes `File(musicDir, "OpenMusic" + (sub?.let { "/$it" } ?: ""))`.
- **moveInMusic (NEW).** Model the uri parse + scheme branch on `deleteFromMusic` L242-270. Unlike delete, it REJECTS on failure (`call.reject("io:move")`), so the TS side can count "saved, not moved". The `content` branch does `resolver.update(uri, ContentValues(RELATIVE_PATH=relPath(sub)), null, null)` and resolves with the same uri. The `file` branch uses `renameTo` + `MediaScannerConnection.scanFile` on the old and new paths, resolves `Uri.fromFile(newFile)`, and goes behind the same `publicMusic` permission gate as L148-154.

---

### `src/routes/(app)/album/[name]/+page.svelte` (MOD)

**Handler shape** (L459-487). Keep the `busyAction` guard, the `preparingDownload` toast, `resolveAllCached()` and the `finally { busyAction = null }`. Replace the loop with a call to `downloadAlbum(...)`:
```ts
async function downloadAlbum() {
	if (!tracks.length || busyAction === 'download') return;
	busyAction = 'download';
	globalToast.show(t('toast.preparingDownload'));
	try {
		const resolved = await resolveAllCached();
		...
	} finally {
		busyAction = null;
	}
}
```
- Pass the dn-translated meta: `names.dnArtist(albumArtist)` / `names.dnTitle(name)`, the same pair as L548-549 (`albumArtist` is the `$derived` at L58 and may be `''`).
- Progress: `(n, total) => globalToast.show(t('toast.albumProgress', { n, total }))`.
- Final toast: `t('toast.albumSaved', { saved, total })`.
- Rewrite the LIMITATION comment block L445-458. It describes the old persist:false behaviour; keep the history with a `Phase 40 D-04` ref.
- **D-07:** un-comment L694. `Download` is already imported at L10.

---

### `src/lib/services/cover-backfill.ts` (MOD)

**QQ tier template:** `ytmusicSongCover` L199-206:
```ts
async function ytmusicSongCover(artist: string, title: string, signal?: AbortSignal): Promise<string | null> {
	const r = await searchAll(`${artist} ${title}`, 1, onlySource('ytmusic'), signal);
	return dedupeBest(r.interleaved, settings.preferredSource)[0]?.cover ?? null;
}
```
QQ search rows carry `cover: null` (`qq.ts:291`). `qqSongCover` must call `SOURCES.qq.resolve({ ...row }, signal)` and read `.cover`. The copy matters: `qq.ts` L349-357 MUTATES the track in place. Import `SOURCES` next to `onlySource` from `$lib/sources/registry` (L95; `SOURCES` is at registry.ts L44).

**Chain** `resolveTrackChain` L221-268. Reorder per the AMENDED D-08: **iTunes → QQ → Deezer → other CN → YTM**. Each tier keeps the same block shape:
```ts
if (!cover) {
	cover = await tier(() => deezerSongCover(artist, title, signal));
	if (signal?.aborted) return null;
}
```
The other-CN tier at L243-251 changes prefs from `{}` to `{ qq: false, ytmusic: false }`.

**Picker** `collectCoverCandidates` L576-648:
- Add a parallel `qq` tier to the `Promise.all` at L598.
- CN tier L619-623 uses `{ qq: false, ytmusic: false }`.
- Assemble at L629-635 in D-10 order `own, qq, itunes, deezer, cn, ytm`. QQ stays before iTunes in the picker (CONTEXT D-10 note).
- Consider `PER_TIER_CAP` (L562) = 3, and update its comment (it says "3 multi-hit network tiers").

**D-11a deletion.** Delete `resolveHqCover` (doc L299-326, fn L327-346). Its callers are listed in the deletion map below.

**Header** L11-53. Rewrite the TRACK tier list for the amended order. Keep the nyq paragraphs as history and add a `Phase 40 D-08` paragraph. It must cover the QQ cost (search + detail, ~1.7 s, 2 edge requests, only on an iTunes miss) and the fact that the HQ upgrade was removed (D-11a). Also update the "RATE-LIMIT / COST" paragraph at L45-53 and the `resolveCoverForTrack` doc at L270-283, which names the old order.

**Do NOT touch** `resolveShareCover` (L392ff), `coverToken`, or `og-cover.ts` (D-12). Extend the existing zero-searchAll test to also assert zero `SOURCES.qq.resolve` calls.

**Test harness:** `cover-backfill.test.ts` L78-93. `mockSearch` routes by prefs (`prefs?.ytmusic`). Add a qq branch (`prefs?.qq === true && !prefs?.ytmusic`) plus a `qqCalls()` filter. Change `cnCalls` to exclude qq-only calls. Spy on `SOURCES.qq.resolve` with `vi.spyOn`.

---

### `src/lib/services/cover-cache.ts` (MOD: `crowd:` family)

**Analog:** the uid layer key + accessors (L105-116, L302-313):
```ts
export function uidCoverCacheKey(uid: string): string { return 'uid:' + uid; }
export function getCachedCoverByUid(uid: string): string | null { return readKey(uidCoverCacheKey(uid)); }
export function setCachedCoverByUid(uid: string, url: string): void { writeKey(uidCoverCacheKey(uid), url); }
```
Add `crowd:uid:<uid>` and `crowd:name:<matchKey>` keys with get/set/remove via `readKey`/`writeKey`/`removeKey` (L239, L250, L368). They inherit the TTL, LRU and `clearCoverCache`. Apply the EMPTY-UID guard exactly as `getPinnedCover` does (L436-440). Gate set on `hasHttpsScheme`, like `setPinnedCover` L448-449.

---

### `src/lib/stores/cover-version.svelte.ts` (MOD)

**readChosenCover.** Model it on `readPinnedCover` L111-114 (take the `coverVersion()` dependency, return a pure read):
```ts
export function readPinnedCover(uid: string): string | null {
	coverVersion(); // reactive dependency — recompute when a pin (or any cover) lands
	return getPinnedCover(uid);
}
```
→ `readChosenCover(uid, artist, title)` = pin ?? crowdUid ?? crowdName.
- `readCoverByUidOrName` L99 becomes `readChosenCover(...) ?? (uid ? uidLayer : null) ?? nameLayer`.
- `writeCrowdCover` / `removeCrowdCover`: model them on `pinCover`/`unpinCover` L121-135 (write + `bumpCoverVersion()`, no cache-layer write).

**D-11b gate (YTM name-layer leak).** `writeCoverBoth` L154-158 is the single writer:
```ts
export function writeCoverBoth(uid: string, artist: string, title: string, url: string): void {
	setCachedCoverByUid(uid, url);
	setCachedCover(artist, title, url);
	bumpCoverVersion();
}
```
See Shared Patterns, "YTM uid-only (D-11b)", for the predicate and the full writer list.

---

### `src/lib/stores/player.svelte.ts` (MOD)

**crowdCoverAsync (NEW).** Copy `resolveCoverAsync` L4114-4138: capture `myGen`, try/catch around the await, `if (myGen !== this.playGen) return;`, then commit and re-fire a FRESH MediaMetadata:
```ts
private async resolveCoverAsync(resolved: Track, myGen: number) {
	let url: string | null = null;
	try { url = await resolveCoverForTrack(resolved); } catch { url = null; }
	if (myGen !== this.playGen) return; // a newer play() superseded — discard the stale art (T-21-06)
	if (!url) return;
	...
```
- Commit through `writeCrowdCover(...)` and then `this.adoptCover(uid, winner)`. That updates the hero and the media card (memory: hero-mediacard-cover-resolvedcover-asymmetry).
- Once-per-session gate: copy the `requested` Map idiom from `src/lib/stores/lyric-offset.svelte.ts` L121-133 (a plain non-reactive field, per the CLAUDE.md counters convention).

**postPlayCover** L4009-4049. DELETE the `else if (...) void this.upgradeCoverAsync(...)` branch (L4031-4048, D-11a), then add `void this.crowdCoverAsync(resolved, myGen)`. Update the method doc at L4002-4008 ("at most one Deezer HQ upgrade").

**Play seed** L3631-3637 (D-14 + D-14a). Insert crowd after the pin and BEFORE `attachedCoverFor`:
```ts
this.resolvedCover =
	getPinnedCover(track.uid) ??
	this.attachedCoverFor(track) ??
	track.cover ??
	getCachedCoverByUid(track.uid) ??
	getCachedCover(track.artist, track.title) ??
	null;
```
**Site A** L3645: `if (hasHttpsScheme(this.resolvedCover) && !getPinnedCover(track.uid))`. Add `&& !crowd` (a chosen cover must not leak into the auto layers). Site B L3877-3878 and `adoptCover` L4258 also get the D-11b gate.

**adoptCover** L4250-4258. Generalize `pinned` to `chosen = pin ?? crowd`:
```ts
const pinned = getPinnedCover(uid);
if (pinned && url !== pinned) return;
...
if (!pinned) writeCoverBoth(uid, cur.artist, cur.title, url);
```
**healCover** L4358: `if (getPinnedCover(uid) === url) unpinCover(uid);`. Add the crowd twin, which evicts locally only (D-19, Pitfall 11).

**D-11a deletion in this file:**
- import L45 `resolveHqCover`
- the doc block L4141-4158 (orphaned above `attachedCoverFor`; KEEP `attachedCoverFor` L4159-4166)
- `upgradeCoverAsync` L4168-4192
- the `adoptedCoverUid` comment at L4235 that mentions it
- comments at L409, L507

**Test** `player.svelte.test.ts` L82-91: remove `resolveHqCover: vi.fn(...)` from the cover-backfill mock, plus L153/L172 (`mockHqCover`) and every test that asserts on it. Add mocks for `cover-pick-shared`.

---

### `src/lib/stores/library.svelte.ts` `adoptCover` (MOD, D-11b)

L154 writes the name layer: `if (hasHttpsScheme(cover)) setCachedCover(src.artist, src.title, cover);`. Gate it with the YTM predicate (`src.source === 'ytmusic'`, or a host check). Pitfall 10 lists this as one of the four writers.

---

### `src/lib/components/TrackMenu.svelte` (MOD)

**pickCover** L346-358. Add a fire-and-forget vote after `player.adoptCover`:
```ts
function pickCover(url: string) {
	if (!track?.uid) return;
	pinCover(track.uid, url);
	player.adoptCover(track.uid, url);
	toast.show(t('toast.coverPinned'));
	writeTagsForGesture({ cover: url });
	closeCoverPicker();
	close();
}
```
→ `void coverPickKeys(track.uid, track.artist, track.title).then((k) => k && submitCoverPick(k, url));`. Use RAW artist/title, not dn* (the RULE 1 comment at L164-165). It is never awaited and never toasts on failure.

**activeCover** L166-180. Swap the leading `readPinnedCover(track.uid)` for `readChosenCover(track.uid, track.artist, track.title)`. KEEP `readPinnedCover` wherever the UI asks "is this pinned?".

---

### Row surfaces (MOD, about 10 one-line swaps)

**Analog:** `src/lib/services/row-cover.ts` `pickRowCover` L40-47. Rung 0 is passed IN so the call site takes the reactive dependency:
```ts
pickRowCover(readPinnedCover(track.uid), resolvedCover ?? undefined, cover === undefined ? track.cover : cover, readCoverByUidOrName(track.uid, track.artist, track.title))
```
Swap `readPinnedCover(x.uid)` → `readChosenCover(x.uid, x.artist, x.title)` at:
- `SongRow.svelte:201`, `CompactRow.svelte:82`, `NpUpNext.svelte:223`, `NpRelated.svelte:168`, `NowPlaying.svelte:392`
- `(app)/+page.svelte:1041/1159/1534`, `settings/downloads/+page.svelte:177`

Update the row-cover.ts header rung 0 (L11-16) to say pin → crowd.

---

### `src/lib/i18n/*.ts` (15 files)

**Analog:** `en.ts` L191 `"settings.retagProgress": "Tagging {done} of {total}…",` and L138 `"settings.migrateDownloadsResult": "Moved {moved} of {total}",`. Use `{name}` placeholders and DOUBLE quotes for keys AND values. Add the same keys to all 15 locales; `i18n.test.ts` guards parity. Caller syntax: `t('settings.retagProgress', { done, total })` (`settings/downloads/+page.svelte:432`).

---

## Shared Patterns

### Never-throw service + sentinel
**Source:** `src/lib/services/lyric-offset-shared.ts` L32-57. Also `download-track.ts` L303-311 (`catch { return 'failed' } finally { library.endDownload(...) }`).
**Apply to:** `cover-pick-shared.ts`, `download-album.ts`, `blobStore.moveToDir`, `qqSongCover` (wrapped in `tier()`, cover-backfill L180-187).

### Generation guard after every await
**Source:** `player.svelte.ts` `resolveCoverAsync` L4114-4121 (`if (myGen !== this.playGen) return;`). Also `TrackMenu.openCoverPicker` L322-337 (`const gen = ++coverGen; ... if (gen !== coverGen || ac.signal.aborted) return;`).
**Apply to:** `crowdCoverAsync`.

### Edge route: verb-only exports, fail-closed 503, origin + JSON gates, conditional-put RMW, exact cache bust
**Source:** `src/routes/api/lyric-offset/+server.ts` L33-143.
**Apply to:** `/api/cover-pick/+server.ts`. All helpers go in `$lib/proxy/cover-pick.ts`.

### Per-IP throttle (D-18a)
**Source:** `src/lib/proxy/comments.ts` L34, L52-54, L194-229, and `src/routes/api/comments/+server.ts` L212-223 (throttle FIRST, a lost race → 429, no retry).
**Apply to:** the cover-pick POST.

### Single security allowlist
**Source:** `src/lib/proxy/safe-image-url.ts` `safeImageUrl` L34-51.
**Apply to:** server POST parse, `parseRecord` re-validate, the client re-check on GET, and (optionally) the D-11b YTM host predicate via `YOUTUBE_IMAGE_HOSTS`.

### YTM uid-only (D-11b)
**Writers of the shared NAME layer** (each must skip the name layer for a YTM cover):
- `player.svelte.ts` Site A L3645, Site B L3878, `adoptCover` L4258 (all through `writeCoverBoth`)
- `library.svelte.ts` L154 (`setCachedCover` directly)
- `cover-backfill.ts` `resolveCoverForTrack` L294-296 (when the chain's winning tier is YTM)

**Lazy option:** one predicate `isYtmCover(url) = safeImageUrl(url, YOUTUBE_IMAGE_HOSTS) !== null` (host-based, so it also catches a non-ytmusic track that adopted a YTM URL), applied inside `writeCoverBoth` and at the two direct `setCachedCover` sites. Do NOT gate `setCachedCover` globally. Uid-less backfill stubs only have the name layer, so a global gate would re-fan the chain on every visit (RESEARCH Pitfall 10). For `resolveCoverForTrack`, the uid write stays, and the name write is skipped only when `track.uid` is truthy.

### Sticky per-uid localStorage index
**Source:** `blob-store.ts` L116-175 (`openmusic-blob-name:`), L81-114 (`openmusic-blob-uri:`).
**Apply to:** `openmusic-blob-dir:`. The backup export already excludes `openmusic-blob-*` (`backup-logic.ts:59`).

### One sanitizer
**Source:** `download-filename.ts` `sanitizeFilename` L77-79.
**Apply to:** `sanitizePathSegment` (wrap it, never copy the char class). Kotlin re-validates with `safeSubPath`.

### Raw fetch vs apiFetch
`/api/cover-pick` goes through `apiFetch`. Audio/blob bytes and ZIP assembly use raw `fetch`/Blob (`download-track.ts` L161-170 comment).

---

## D-11a Deletion Map (HQ upgrade removal)

| File | Lines | Action |
|---|---|---|
| `src/lib/services/cover-backfill.ts` | L299-346 | delete `resolveHqCover` + its doc |
| `src/lib/services/cover-backfill.ts` | header L11-53, `resolveCoverForTrack` doc L270-283 | reword mentions of the HQ upgrade |
| `src/lib/services/cover-backfill.test.ts` | L6 import, `describe('resolveHqCover …')` L552-~665, INLINE-COVER test L670-~700 | delete |
| `src/lib/stores/player.svelte.ts` | L45 import; postPlayCover `else if` L4031-4048; doc L4141-4158; `upgradeCoverAsync` L4168-4192 | delete (keep `attachedCoverFor` L4159-4166) |
| `src/lib/stores/player.svelte.ts` | comments L409, L507, L4002-4008, L4235 | reword |
| `src/lib/stores/player.svelte.test.ts` | L84-89 mock entry, L153, L172 `mockHqCover` + asserting tests | delete |
| `src/lib/sources/qq.ts` L352, `src/lib/services/url-safety.ts` L42, `src/lib/services/cover-cache.ts` L417 | comment-only mentions | reword or leave (comment refs) |

Run `grep -rn "resolveHqCover\|upgradeCoverAsync" src` → 0 hits as the done-check.

## No Analog Found

| File | Role | Data Flow | Reason |
|---|---|---|---|
| `src/lib/services/zip-store.ts` | utility | transform | No archive or CRC code exists in the repo. Use RESEARCH Pattern 4 (prototyped and verified) |

## Conventions

Derived via `gsd-tools verify conventions --derive --scope src/lib`:

| Axis | Dominant | Share | Entropy | Status |
|---|---|---|---|---|
| file-name casing | (none: other 166 / kebab 93 / camel 75) | 49.7% | 0.946 | contested hotspot |
| identifier casing | camel | 96% | 0.174 | named contract |
| export style | esm | 100% | 0 | named contract |
| import style | esm | 100% | 0 | named contract |

**Contested hotspots (author's choice).** File-name casing is contested by design, not drift. CLAUDE.md fixes it per ROLE: pure services are `kebab-case.ts` (`zip-store.ts`, `download-album.ts`, `cover-pick-shared.ts`), runes stores are `name.svelte.ts`, components are `PascalCase.svelte`, actions are `camelCase.ts`, and routes are `+server.ts`. Match the role, not the repo-wide majority. The prototype intentional split elsewhere in GSD is the CJS↔SDK dual resolver (`bin/lib/**` CJS `module.exports`/`require` vs `sdk/src/**` ESM): each half is internally consistent per directory and contested only repo-wide. This repo is ESM-only, so here the role-based file naming is the only contested axis. Also: tabs; single quotes except in i18n (double); `import type`; `$lib` aliases; no `as any` in production.

## Metadata

**Analog search scope:** `src/lib/{proxy,services,stores,components,sources,i18n}`, `src/routes/api/{lyric-offset,comments}`, `src/routes/(app)/album`, `android/.../MediaStoreSaverPlugin.kt`
**Files scanned:** ~30
**Pattern extraction date:** 2026-09-30
