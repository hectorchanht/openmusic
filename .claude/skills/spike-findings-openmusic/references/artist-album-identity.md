# Artist Identity + CJK Albums (MusicBrainz)

Proven by spike 010 (live MusicBrainz ws/2 + Cover Art Archive probes, 陳奕迅 / 周杰倫 in every script,
measured against the Deezer profiles users actually saw). **BUILT in quick-260831-re9.**

## Requirements
- **[010] MusicBrainz is the canonical ARTIST IDENTITY layer for CJK.** A name in any script
  (Traditional / Simplified / romanized) resolves to ONE mbid at score 100, so 周傑倫 · Jay Chou ·
  周杰倫 collapse to a single artist page with no heuristic merge. Display name = canonical `name`
  + locale-tagged aliases, switched on the existing artist-locale setting.
- **[010] Deezer is NOT replaced.** It keeps artwork, non-CJK artists, and the fallback slot; MB
  supplies CJK albums/tracklists in the original script. MB is curated, so it can miss very new
  releases Deezer has.

## How to Build It
Real code: `src/lib/proxy/musicbrainz-shared.ts` (UA, `mbFetch`, `isMbid`, `coverArtUrl`, `normalizeLocale`),
`src/routes/api/musicbrainz/{artist,albums,tracks}/+server.ts`, `src/lib/services/musicbrainz.ts`
(client, `pickLocaleName`), `src/lib/services/discography-source.ts` (source order), used by
`src/routes/(app)/artist/[name]/+page.svelte`, `.../artist/[name]/albums/`, `.../album/[name]/` (`?mbid=`).

1. **Four calls, all keyless, all with a real UA:**
   ```bash
   UA='openmusic/1.0 ( https://openmusic.lol )'
   # name (any script) → canonical mbid (+ aliases when present)
   /ws/2/artist/?query=<name>&fmt=json&limit=1&inc=aliases
   # artist → albums, original-script titles (page it: limit max 100)
   /ws/2/release-group?artist=<mbid>&type=album&fmt=json&limit=100
   # release-group → ordered tracklist (first release)
   /ws/2/release?release-group=<rgid>&inc=recordings&fmt=json&limit=1
   # cover — BUILT as a string, never fetched server-side (307 → archive.org)
   https://coverartarchive.org/release-group/<rgid>/front-500
   ```
2. **Gate by script, not globally.** `isCjkName()` (reuses `detectLang` → zh-Hant/zh-Hans/ja/ko):
   CJK → MusicBrainz → Deezer → Last.fm; everything else → Deezer → Last.fm (unchanged). First non-empty wins.
3. **Identity.** Take the top hit only if `isMbid(id)` and `score >= 90` (`MIN_SCORE`); below that it is
   usually a different artist → return the empty identity and let Deezer carry on.
4. **Locale names.** Fold aliases into `names: Record<tag, name>` via `normalizeLocale`
   (`zh_Hant` → `zh-Hant`, `zh_Hans_CN` → `zh-Hans`; region subtags dropped). Primary alias wins per
   locale. `pickLocaleName(names, canonical, settings.artistLang)` falls back to canonical, never blank.
   e.g. en → Eason Chan · zh-Hant → 陳奕迅 · zh-Hans → 陈奕迅.
5. **Albums.** Fetch up to 2 pages × 100 (陳奕迅 has 102 release-groups — one page truncates, which is the
   exact bug). Map types onto the app vocabulary; secondary `Compilation` beats primary `Album`, `Live`
   stays `album`. Widen `YYYY` / `YYYY-MM` dates to full ISO so one comparator sorts both sources.
   Covers come from `coverArtUrl(rgid)` — ONE upstream call per artist regardless of album count.
   Render covers as a layered background so a CAA 404 reveals the gradient.
6. **`mbFetch`** — never throws: 503 → sleep `1100 * (i+1)` ms and retry (3 attempts, linear on purpose —
   the limiter is a fixed 1 s window); a 200 carrying `{error}` = miss; timeout 8 s. Returns null → caller falls back.
7. **Cache.** Edge-cache every route 24 h on success; client `cached()` 24 h with the deezer.ts WR-03
   posture (reject inside so a transient failure is never pinned). **Never negative-cache a 503.**
8. **Validate every mbid with `isMbid` before it touches an upstream path or the DOM.**

## What to Avoid
- **No heuristic name-merge** for the "3 artist pages" problem — MB's alias linking does it
  authoritatively, and a heuristic risks pulling tribute acts ("Coldplay Metal Tribute") into a real artist.
- **Dead-end upstreams for albums:** Meting (netease) `type=album` → `{"error":"unknown type"}`; qq proxy
  allows only `search|detail` with no album field; kuwo kw-api's TLS cert expired 2026-04-14 (526s).
- **Don't route Western artists through MB** — Deezer is good and wired there; spend MB's 1 req/s on CJK.
- **Don't treat an "empty 200" as a genuine miss** — in the spike it was a swallowed 503. Check status.
- **Don't send a generic/absent User-Agent** — MB blocks it outright. It must name the app + a contact URL.
- **Don't assume one script per album.** 最偉大的作品's release-group title is Traditional while its
  release + tracks are Simplified. Fold at display time (`tongwen-core` is already wired via
  `services/zh-convert.ts`), switched on artist-locale.
- **Don't compare raw album counts as "exhaustive".** 周杰倫: Deezer 46 (inflated by singles/repackages,
  English titles) vs MB 35 real albums. 陳奕迅: Deezer 5 vs MB 72.

## Constraints
- **~1 req/s rate limit** → genuine 503 + `{"error":"The MusicBrainz web server is currently busy…"}`
  (3 rapid calls = 503/200/503). Detectable and retryable, unlike the `/api/translate` soft-fail.
  An artist page costs 2–3 MB calls; the 24 h edge cache makes that a non-issue.
- **Curated catalogue:** very new/obscure releases can be missing where Deezer has them. The build is
  first-non-empty-wins, NOT a union — unioning MB + Deezer keyed on the mbid is the known upgrade path.
- Tracklist = first release of the group (ponytail simplification); regional/deluxe editions can differ.
- Latency ~0.6 s/call, no IP lock, reachable from the edge. **TLS `notAfter` Oct 10 2026 — watch it**
  (kuwo precedent: silent 526 for 4.5 months after its cert expired).
- MB stores no artwork; Cover Art Archive is keyless (8/8 on a Jay Chou sample) but can miss.

## Origin
Synthesized from spikes: 010
Source files available in: sources/010-cn-album-upstream/
