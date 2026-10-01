---
phase: 40-album-download-all-cover-re-rank-cloud-shared-cover-pick-1-a
reviewed: 2026-10-01T03:21:27Z
depth: standard
files_reviewed: 44
files_reviewed_list:
  - android/app/src/main/java/com/openmusic/app/MediaStoreSaverPlugin.kt
  - src/lib/components/CompactRow.svelte
  - src/lib/components/NowPlaying.svelte
  - src/lib/components/NpRelated.svelte
  - src/lib/components/NpUpNext.svelte
  - src/lib/components/SongRow.svelte
  - src/lib/components/TrackMenu.svelte
  - src/lib/proxy/cover-pick.test.ts
  - src/lib/proxy/cover-pick.ts
  - src/lib/proxy/safe-image-url.test.ts
  - src/lib/proxy/safe-image-url.ts
  - src/lib/services/blob-store.test.ts
  - src/lib/services/blob-store.ts
  - src/lib/services/cover-backfill.test.ts
  - src/lib/services/cover-backfill.ts
  - src/lib/services/cover-cache.test.ts
  - src/lib/services/cover-cache.ts
  - src/lib/services/cover-pick-shared.test.ts
  - src/lib/services/cover-pick-shared.ts
  - src/lib/services/download-album.test.ts
  - src/lib/services/download-album.ts
  - src/lib/services/download-filename.test.ts
  - src/lib/services/download-filename.ts
  - src/lib/services/download-track.test.ts
  - src/lib/services/download-track.ts
  - src/lib/services/match-key.ts
  - src/lib/services/media-store.ts
  - src/lib/services/row-cover.ts
  - src/lib/services/share.test.ts
  - src/lib/services/url-safety.test.ts
  - src/lib/services/url-safety.ts
  - src/lib/services/zip-store.test.ts
  - src/lib/services/zip-store.ts
  - src/lib/stores/cover-version.svelte.test.ts
  - src/lib/stores/cover-version.svelte.ts
  - src/lib/stores/library.svelte.test.ts
  - src/lib/stores/library.svelte.ts
  - src/lib/stores/player.svelte.test.ts
  - src/lib/stores/player.svelte.ts
  - src/routes/(app)/+page.svelte
  - src/routes/(app)/album/[name]/+page.svelte
  - src/routes/(app)/settings/downloads/+page.svelte
  - src/routes/api/cover-pick/+server.ts
  - src/routes/api/cover-pick/cover-pick-endpoint.test.ts
findings:
  critical: 1
  warning: 6
  info: 7
  convention: 1
  total: 14
status: issues_found
---

# Phase 40: Code Review Report

**Reviewed:** 2026-10-01T03:21:27Z
**Depth:** standard
**Files Reviewed:** 44
**Status:** issues_found

## Summary

I reviewed the Phase 40 diff (`dc475337^..HEAD`) for the three deliverables: album download-all (zip writer, MediaStore sub-path and move), the cover chain re-rank, and the crowd-shared cover pick (`/api/cover-pick`).

Several parts hold up:
- **R2 key isolation.** Every object key is built from a 32-hex or 16-hex hash under `cover-pick/` or `cover-pick-throttle/`, and the route never lists. It cannot reach `log/`.
- **CORS and origin gates.** The POST refuses an absent or foreign Origin and requires `application/json`.
- **Off-path edge-cache key.** The `__edge` cache key is correct.
- **Path safety.** ZIP entry names cannot escape the root folder: `sanitizeFilename` strips `/` and `\`, and `sanitizePathSegment` strips `.`/`..`. The native `subPath` is validated on both sides (`cleanDir` and `safeSubPath`).
- **Request volume.** Rows only read the local `crowd:` cache. There is one GET per played uid per session, so no per-row network call was added.

The main problem is the vote screen. It reuses response-validation allowlists as an input allowlist for anonymous votes. With no quorum, one POST can point a song's cover, for every listener, at a host the attacker controls. Other findings:
- A generation-guard misuse that permanently drops a crowd pick after a quick skip.
- Two D-11b / D-14 leaks: the backfill name-layer write, and crowd art reaching device files and their tags.
- An unguarded file-rename branch in the Kotlin move.

## Critical Issues

### CR-01: Vote allowlist admits attacker-controlled hosts, so one anonymous vote serves an attacker URL to every listener

**File:** `src/lib/proxy/safe-image-url.ts:103-119` (used by `src/lib/proxy/cover-pick.ts:101,130` and `src/lib/services/cover-pick-shared.ts:51`)

**Issue:** `COVER_PICK_IMAGE_HOSTS` is the union of every per-source *response* allowlist. Those lists were written to validate URLs that come back from a trusted upstream API, such as a Last.fm JSON body. They were never meant to screen raw, anonymous user input. Now they do:
- `suffix: '.fastly.net'`, from `LASTFM_IMAGE_HOSTS`, accepts **any Fastly customer's service domain**, for example `https://attacker.global.ssl.fastly.net/x.jpg`. Anyone with a Fastly account controls such a host.
- `suffix: '.googleusercontent.com'` accepts user-uploaded content (Drive, Blogger, Sites). The ponytail comment acknowledges this one.
- `exact: 'api.qijieya.cn'` is a third-party redirector.

`consensus()` publishes after a single vote (no quorum). The pick then outranks the inline cover for all users (D-14). Every client then sets `<img src>` / CSS `url()` to the attacker's URL:
- The attacker's origin receives the IP and User-Agent of every listener of that song, in effect a tracking beacon.
- The attacker can serve arbitrary imagery.
- The attacker can rotate the content behind a URL that already passed the screen.

The `n` key is `sha256("n\n" + versionedMatchKey(artist, title))`, a public algorithm. An attacker can therefore target the most popular songs by name without ever playing them. `share.ts` uses the same `.fastly.net` suffix safely, because it only extracts an id and rebuilds the URL on a fixed host. The vote path stores the raw URL.

**Fix:** Give the vote screen its own, explicit list of exact hosts. Do not compose it from the response lists. Also require a quorum (see WR-01).
```ts
// safe-image-url.ts — votes are untrusted INPUT: exact CDN hosts only, no customer-wide suffixes.
export const COVER_PICK_IMAGE_HOSTS: ImageHostAllowlist = {
	exact: [
		'lastfm.freetls.fastly.net', // the only Fastly host Last.fm art uses
		'cdn-images.dzcdn.net', 'e-cdns-images.dzcdn.net',
		'y.gtimg.cn', 'i.ytimg.com', 'yt3.ggpht.com', 'i.kfs.io'
	],
	// first-party CDN shards only; NO .fastly.net, NO .googleusercontent.com, NO third-party redirector
	suffix: ['.mzstatic.com', '.music.126.net', '.kuwo.cn']
};
```
If YTM `lh3`/`yt3.googleusercontent.com` art must stay votable, accept it only when the voted URL equals a candidate the server can check against. Otherwise drop it from votes.

## Warnings

### WR-01: No quorum, enumerable keys and a per-IP throttle make mass cover poisoning cheap

**File:** `src/lib/proxy/cover-pick.ts:13-15,143-159`; `src/routes/api/cover-pick/+server.ts:107-111,151-161`

**Issue:** The ponytail note says "a local pin always beats the crowd … the blast radius is a wrong default one pick fixes." That only protects listeners who have already pinned that song. Every other listener, and every new install, sees the crowd pick ahead of the inline cover (D-14).
- Name keys can be computed offline (CR-01).
- The throttle is per IP. IPv6 clients have a /64 or more to rotate through, so 60 votes/day/IP is not a bound.
- One vote wins a key nobody else has voted on.

The model was copied from lyric-offset, but lyric-offset gates publication on `AGREE_MIN = 3`. This route has no gate at all.

**Fix:** Before `consensus` returns a URL, require a minimum number of distinct voters, for example `>= 2-3` agreeing votes. Key the throttle on the IPv6 /64 prefix, not the full address:
```ts
export const PICK_AGREE_MIN = 2;
// in consensus(): if (!best || top.n < PICK_AGREE_MIN) return null;
// in throttleVoterId(): hash ip.includes(':') ? ip.split(':').slice(0, 4).join(':') : ip
```

### WR-02: A superseded or failed crowd lookup is marked "requested" and never retried this session

**File:** `src/lib/stores/player.svelte.ts:4070-4087` (test lock-in: `src/lib/stores/player.svelte.test.ts:8425`)

**Issue:** `crowdRequested.add(uid)` runs before the fetch. If the user skips to the next song before the GET returns (common while browsing), the `myGen !== this.playGen` bail-out throws away the result without caching it. Replaying that song later in the session returns early on `crowdRequested.has(uid)`. A null result has the same effect: 503, the circuit breaker open, or a timeout. In both cases the song never gets its crowd pick until the app restarts.

The generation guard is also unnecessary for the cache write. `writeCrowdCover` is keyed by uid and name, so writing it is safe whatever the current track is. `adoptCover` already rejects a uid that is no longer `current`. The test at L8425 asserts `mockWriteCrowd` is not called on supersede, which locks the bug in.

**Fix:**
```ts
const pick = await fetchCoverPick(keys).catch(() => null);
if (!pick) { this.crowdRequested.delete(uid); return; } // transient failure → allow a later retry
writeCrowdCover(uid, artist, title, pick);               // identity-keyed: safe regardless of gen
if (myGen !== this.playGen) return;                      // only the ADOPTION is gen-gated
const winner = getCrowdCover(uid, artist, title);
if (winner) this.adoptCover(uid, winner);
```
Update the L8425 test to expect the cache write and no adoption.

### WR-03: `backfillCovers` still writes YTM winners to the shared name layer (D-11b bypass)

**File:** `src/lib/services/cover-backfill.ts:458` (callers `src/lib/components/NpUpNext.svelte:90`, `src/lib/components/NpRelated.svelte:123`, `src/routes/(app)/+page.svelte:393`)

**Issue:** D-11b says "YT Music thumbnails are cached by uid ONLY — never written to the name layer." The doc comment on `isYtmCoverUrl` (`url-safety.ts`) calls it "the one predicate every name-layer writer consults." `backfillCovers.resolveOne` does not consult it. A Tier-5 YTM winner goes straight to `setCachedCover(artist, title, cover)`.

The Up Next and Related backfills are fed from real uid-bearing tracks, stripped down to `{artist,title}`. Their YTM thumbnails therefore land on the name layer, and any other coverless copy of the song (kuwo with a null `pic`, a netease stub) reads them through `readCoverByUidOrName`. This is the exact leak D-11b closes in `writeCoverBoth`, `library.adoptCover` and `resolveCoverForTrack`.

**Fix:** Carry the uid when the caller has one, and apply the same rule as `resolveCoverForTrack`:
```ts
export interface CoverNeed { artist: string | null; title: string | null; uid?: string }
// resolveOne:
if (item.uid) setCachedCoverByUid(item.uid, cover);
if (!item.uid || !isYtmCoverUrl(cover)) setCachedCover(item.artist, item.title, cover);
```
Pass `uid` from `upNextCoverNeeds`. Uid-less home stubs keep the name-layer write (Pitfall 10).

### WR-04: Device tracks consume crowd name picks, overriding their own embedded art, and the retag sweep writes crowd art into the user's own files

**File:** `src/lib/stores/cover-version.svelte.ts:121-124`; `src/lib/stores/player.svelte.ts:657,793,3652`; `src/routes/(app)/settings/downloads/+page.svelte:178`

**Issue:** `crowdCoverAsync` and `coverPickKeys` deliberately exclude `device:` uids ("no cross-user identity"). The read side does not. `getCrowdCover(uid, artist, title)` falls through to the `crowd:name:` key for a device uid, and those keys are populated whenever any streaming copy of the same song was played. As a result:
- The play/restore seeds rank the crowd pick ahead of `track.cover`, which is the file's own embedded `data:` art (37-D-02: "embedded first").
- `displayCover` then paints the crowd URL.
- The opt-in retag sweep passes `readChosenCover(d.uid, …)` as the cover for device rows. Since quick-260919-ejm, `retagOne` rewrites the **user's own files** in place, so an anonymous internet vote (see CR-01) gets embedded permanently into files the app does not own.

**Fix:** Add one guard at the shared read so every caller inherits it:
```ts
export function getCrowdCover(uid: string, artist: string, title: string): string | null {
	if (isDeviceUid(uid)) return null; // a local file's own art outranks any crowd pick
	return getCrowdCoverByUid(uid) ?? getCrowdCoverByName(artist, title);
}
```

### WR-05: Kotlin `performMove` file branch renames any path it is given and silently overwrites the target

**File:** `android/app/src/main/java/com/openmusic/app/MediaStoreSaverPlugin.kt:383-404`

**Issue:** The `file` branch builds `oldFile` from whatever `uri.path` the JS bridge supplies. It never checks that the path is under `Music/OpenMusic/`. With `WRITE_EXTERNAL_STORAGE` granted (API ≤28), that is any file on shared storage. `subPath` is re-validated "defense-in-depth" (`safeSubPath`), but the source path, which matters more, is not.

`File.renameTo` on Android is `rename(2)`, which **replaces** an existing `newFile` without warning. If another download already sits at `OpenMusic/<Artist>/<Album>/<same name>`, that file is destroyed, and its uid's stored URI now points at a different song.

**Fix:**
```kotlin
val root = File(musicDir, "OpenMusic").canonicalFile
val src = oldFile.canonicalFile
if (!src.path.startsWith(root.path + File.separator)) { call.reject("io:move"); return }
val newFile = File(targetDir, src.name)
if (newFile.exists()) { call.reject("io:move"); return } // "saved, not moved" — never clobber
```

### WR-06: The QQ cover tier is ungated and costs up to three governed requests per iTunes miss

**File:** `src/lib/services/cover-backfill.ts:232-243` (`qqSongCover`), `:271-275`

**Issue:** The comments say the tier costs "a search + ONE detail (~1.7s, 2 edge requests)." `SOURCES.qq.resolve` → `fetchQqDetail` actually tries the direct tang hop and then the `/api/qq/detail` fallback, so a miss is up to 3 governed requests. Each one can hold an `apiFetch` slot for the 25 s timeout.

Before this phase, QQ was only reached after an iTunes **and** Deezer miss. Now it fires on every iTunes miss, which is the common case for the CJK catalog. With the backfill pool at `CAP=6` against `MAX_CONCURRENT_REQUESTS=8`, a tang outage lets cover backfill hold most governor slots for tens of seconds. That starves the playback resolve: the documented api-fetch-flood freeze class. The ponytail note defers the health gate, but `createHealthGate` already exists for exactly this.

**Fix:** Gate the tier, and bound it with a short timeout of its own:
```ts
const qqGate = createHealthGate('qq');
async function qqSongCover(artist, title, signal) {
	if (!qqGate.allow()) return null;
	const s = combinedSignal(4_000, signal);
	// … search + resolve with `s`; qqGate.fail() on a null/throw, qqGate.ok() on a hit
}
```
Also fix the "ONE detail" comments.

## Info

### IN-01: A partial POST success skips the edge-cache bust

**File:** `src/routes/api/cover-pick/+server.ts:166-176`
**Issue:** When the `u` vote commits but the `n` vote loses all 3 attempts, the handler returns 409 before reaching the `edgeCache().delete`. The `u` change is then hidden at that PoP for up to 300 s, and the throttle slot is already spent, so the client cannot retry.
**Fix:** Run the bust whenever any record was written, for example by tracking `wrote = true` and busting before the 409 return.

### IN-02: Local crowd entries are never cleared when the server says there is no pick

**File:** `src/lib/stores/cover-version.svelte.ts:132-148`; `src/lib/stores/player.svelte.ts:4084-4086`
**Issue:** `writeCrowdCover` ignores nulls. After a `{u:null, n:null}` reply, for example because a record was dropped by the read-time allowlist re-screen, `crowdCoverAsync` still reads back the stale local `crowd:` entry and adopts it until the cache TTL expires.
**Fix:** When the server returns null for a key, evict that key locally (`removeCrowdCoverByUid` / `removeCrowdCoverByName`).

### IN-03: `albumFolder` can exceed the 255-byte name limit

**File:** `src/lib/services/download-filename.ts:126-130`
**Issue:** Each segment is capped at 180 bytes, but `Artist - Album` joins two of them, up to 363 bytes. That string is both the zip root folder and the zip filename stem, so long CJK names fail to extract with "File name too long" on Linux, macOS and Android.
**Fix:** Pass the joined string through the same byte truncation (export the truncation step and apply it to `${a} - ${b}`).

### IN-04: A failed zip reports "Saved 0 of N" although every song was persisted

**File:** `src/lib/services/download-album.ts:163-166`
**Issue:** With `persist: true`, every song already sits in library Downloads and IndexedDB, so the final toast contradicts the library.
**Fix:** Return a distinct `zipFailed` flag and show a dedicated message, for example "Saved offline, couldn't build the zip."

### IN-05: The vote key and the lookup key can be built from different artist strings

**File:** `src/lib/components/TrackMenu.svelte:356` vs `src/lib/stores/player.svelte.ts:4071-4073`
**Issue:** The picker votes with the menu track's `artist`, which may be a search stub. The player looks up with `resolved.artist`, and qq `resolve` overwrites that with `d.singer_name`. `versionedMatchKey` also does not fold 繁/简 (unlike `matchKey`). The `n` hashes can therefore differ for the same song, which splits votes and misses lookups.
**Fix:** Derive both keys from the same post-resolve metadata, or fold script in `versionedMatchKey`.

### IN-06: Correcting a pick within 10 s is silently dropped server-side; CGNAT users share one identity

**File:** `src/lib/proxy/cover-pick.ts:33-34,184-189`; `src/lib/components/TrackMenu.svelte:356`
**Issue:**
- If the user picks cover A and then corrects to B within `PICK_MIN_GAP_MS`, B gets a silent 429, and the server keeps the wrong pick A.
- Users behind one carrier NAT share the throttle, and they also share a single voter id per song, so their votes replace each other.

**Fix:** Debounce the vote on the client, sending only the last pick after about 10 s. Accept the CGNAT case as a documented limitation.

### IN-07: Share cards cannot carry QQ or crowd covers

**File:** `src/lib/services/share.ts:331-361` (consumer `src/lib/components/TrackMenu.svelte:219`)
**Issue:** `coverToken` has no tag for `y.gtimg.cn`, which is now tier 2 and appears often, or for most crowd-pick hosts. The share card therefore falls back to the iTunes/Deezer prewarm, which is a different image from the one the user sees. D-12 "share cards keep working" holds only through that fallback.
**Fix:** Add a `q:` carrier tag for `y.gtimg.cn` album paths, or document the fallback as accepted under D-12.

## Convention

### CV-01: Swallowed catch blocks (tool: architectural-split)

**Files:**
- `src/lib/services/blob-store.ts` (18 sites)
- `src/lib/services/cover-cache.ts` (5)
- `src/lib/services/cover-pick-shared.ts:69`
- `src/lib/services/download-album.ts:90,158,167`
- `src/lib/services/download-track.ts:319`
- `src/lib/stores/library.svelte.ts:84,103`
- `src/lib/stores/player.svelte.ts` (22)

**Deviation:** The catch blocks swallow the error with no rethrow.
**Convention:** The generic rule pack flags swallowed catches.
**Fix:** None recommended. CLAUDE.md explicitly mandates never-throw services, silent-catch with graceful degradation, and try/catch around localStorage. Each Phase 40 site carries the house-style comment explaining why it swallows. This finding is advisory only and contradicts the project's documented convention.

---

_Reviewed: 2026-10-01T03:21:27Z_
_Reviewer: Claude (gsd-code-reviewer)_
_Depth: standard_
