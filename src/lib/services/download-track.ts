// download-track.ts — the ONE shared, node-testable single-song download orchestration.
//
// Extracted VERBATIM (behavior-preserving) from TrackMenu.doDownload so DL-FILE-01 / DL-BUG-01 /
// DL-STATE-01 all have a SINGLE tested initiation path: the filename format can never drift, the
// `window.open` bug can never come back, and per-song begin/endDownload is bracketed once here
// instead of duplicated per call site. 29-04 (UI) and 29-05 (native) consume this.
//
// CONTRACTS (all three MUST hold — asserted in download-track.test.ts):
//
//   D-17 NEVER-THROWS: every failure path resolves a DownloadResult sentinel ('no-audio' | 'failed'),
//     never rejects. The caller localizes a toast off the result — this module NEVER navigates and
//     NEVER opens a play page. It deliberately imports NEITHER `$lib/i18n` NOR `$lib/stores/toast`:
//     the i18n `t()` reads runes `$state` and would break the single node Vitest project, and text
//     localization is the UI layer's job (stores/services emit data, the caller localizes).
//
//   D-18 DOWNLOAD ISOLATION (quick-260625-pzs-04): download work must NOT cross into playback. This
//     function reads `player.current` READ-ONLY (to reuse an already-resolved URL) and NEVER assigns
//     player.current, NEVER clears its lrc, NEVER bumps player.playGen, and NEVER touches the shared
//     <audio> element. It operates on COPIES + its own fetch(). `library.addDownload` mutates the
//     LIBRARY downloads reference list — the intended download effect, NOT player state.
//
//   DL-BUG-01 (D-09): a failed save returns 'failed' — it NEVER `window.open`s the raw stream URL
//     (the "download opened a media page" bug). The caller shows toast.downloadFailedKeptInLibrary;
//     the song already sits in library.downloads (addDownload ran) and re-streams on tap.
//
//   36-D-06 TAG-OR-INTACT: tagging happens in memory between the blob read and the two save paths;
//     ANY tag failure (unknown container, oversize, art miss, library throw) saves the ORIGINAL
//     bytes and the result is still 'saved'. Never 'failed' for a file that landed and plays.

import { Capacitor } from '@capacitor/core';
import type { SourceId, Track } from '$lib/sources/types';
import { library } from '$lib/stores/library.svelte';
import { player } from '$lib/stores/player.svelte';
import { readCoverByUidOrName } from '$lib/stores/cover-version.svelte';
import { settings, type DefaultQuality } from '$lib/stores/settings.svelte';
import { names } from '$lib/stores/names.svelte';
import { ensureTrackDetails } from '$lib/services/catalog';
import { hasFreshAudioUrl } from '$lib/services/track-ready';
import { blobStore } from '$lib/services/blob-store';
import { saveBlobToDisk } from '$lib/services/download-save';
import { readBlobWithProgress } from '$lib/services/download-progress';
import { audioMimeForUrl, buildDownloadFilename, extFromAudioUrl } from '$lib/services/download-filename';
import { albumTag, tagAudioBlob } from '$lib/services/audio-tags';
import { resolveArtworkDataUrl } from '$lib/services/media-artwork';
import { logAction } from '$lib/stores/actionLog.svelte';
import { fetchVariants, versionsIncludingOwn } from '$lib/services/variants';
import { probeDownload, type DownloadProbe } from '$lib/services/download-probe';
import { nativeFetchStreamBlob } from '$lib/services/ytmusic-native';
import { isQqRateLimited } from '$lib/sources/qq';
import { effectiveQuality } from '$lib/sources/quality';

/**
 * 'saved' = blob fetched + saved to disk; 'no-audio' = nothing to download; 'failed' = fetch/save
 * error; 'rate-limited' (quick-260930-x3q) = the resolve hit qq's 请求过于频繁 limiter, so the album
 * loop can try a donor and back off instead of writing the song off as audio-less.
 */
export type DownloadResult = 'saved' | 'no-audio' | 'failed' | 'rate-limited';

// quick-261004-o9t — the quick-260930-uia "no YT Music downloads" rule is LIFTED (user,
// 2026-10-04): the VISIONOS client switch (5acc875c) + the stream-proxy fixes (38961cce) made the full
// itag-140 file fetchable. A ytmusic song now resolves and downloads its OWN audio like any source;
// the two ytmusic specifics live in `runDownload` (native direct fetch, proxy retry) and key off the
// resolved URL, not the source — so a ytmusic `audioFrom` donor gets them too.

// quick-261004-o9t: a DIRECT googlevideo url (native resolve — IP-locked to the phone, no CORS header).
function isGooglevideoUrl(url: string): boolean {
	try {
		return new URL(url).hostname.endsWith('.googlevideo.com');
	} catch {
		return false;
	}
}
// quick-261004-o9t: our own edge byte-proxy (web resolve, or the native resolver's fallback).
const isYtmusicProxyUrl = (url: string): boolean => url.includes('/api/ytmusic/stream/');

// quick-261004-o9t: YouTube bot-gates Cloudflare egress IPs PER INVOCATION — ~25–50% of proxy requests
// answer 502 'player not OK' / 403 (prod-sampled 2026-10-04). A NEW request may land on an un-gated IP,
// so the client retries the whole request; an in-Worker retry stays on the gated invocation and cannot.
const YTMUSIC_FETCH_ATTEMPTS = 3;

/**
 * quick-261004-o9t: `fetch(url)` up to `attempts` times, no delay (the gate is per egress IP, not
 * time-based). An ok response returns at once; a non-ok one only on the LAST attempt; a rejection —
 * on the APK the proxy is cross-origin, and Cloudflare's masked 502 carries no CORS headers, so
 * fetch() REJECTS instead of answering non-ok — is rethrown only on the last attempt.
 * `attempts === 1` is exactly a single `fetch(url)`.
 */
async function fetchRetrying(url: string, attempts: number): Promise<Response> {
	for (let i = 1; ; i++) {
		try {
			const resp = await fetch(url);
			if (resp.ok || i >= attempts) return resp;
		} catch (e) {
			if (i >= attempts) throw e;
		}
	}
}

// quick-260625-pzs-04: does the currently-playing track's already-resolved quality satisfy the
// requested DOWNLOAD tier? If so we reuse its URL instead of forcing a second concurrent resolve of
// the same song (T-pzs-02: a duplicate resolve + blob fetch saturate the shared CDN and have caused
// a stale-URL audio error → lyrics wipe on the active track). Conservative: reuse only when confident
// the streamed quality already meets/exceeds the wanted tier.
//   - 'auto' / '320' / '128' → any resolved stream (320k or lossless) meets/exceeds the tier
//   - 'lossless'             → reuse ONLY when the current stream is already lossless; else re-resolve
export function currentQualityMeets(curQuality: string | null, want: DefaultQuality): boolean {
	if (want === 'auto' || want === '320' || want === '128') return true;
	// want === 'lossless'
	return (curQuality ?? '').toLowerCase() === 'lossless';
}

// quick-261001-0p9: how good a donor's file is, for the album loop's after-the-wait donor pick.
// Container evidence (from the probe's content-type / URL) beats the per-source quality TAG, whose
// vocabulary differs by source (qq 'lossless'|'hq'|'standard'|'low', netease/kuwo 'lossless'|'320k'),
// so the tag is matched by regex band, never by equality.
const LOSSLESS_CONTAINERS = new Set(['flac', 'wav']);
type DonorFile = { container: string | null; quality: string | null };

export function donorRank(p: DonorFile): 0 | 1 | 2 | 3 {
	if (p.container && LOSSLESS_CONTAINERS.has(p.container)) return 3;
	const q = p.quality ?? '';
	if (/lossless|flac|sq|hi-?res|无损/i.test(q)) return 3;
	if (/320|hq/i.test(q)) return 2;
	if (/128|160|192|standard|low/i.test(q)) return 1;
	return 0;
}

// quick-261001-0p9: is this donor the SAME quality tier AND format class as the download tier? The
// user's rule: "qq FLAC → another source's FLAC, not an mp3" — so a FLAC is not a match for a 320
// (mp3) tier either. An unknown container falls back to the band alone.
export function donorMatchesTier(p: DonorFile, want: DefaultQuality): boolean {
	const tier = effectiveQuality(want);
	const wanted = tier === 'lossless' ? 3 : tier === '320' ? 2 : 1;
	if (donorRank(p) !== wanted) return false;
	if (p.container === null) return true;
	return LOSSLESS_CONTAINERS.has(p.container) === (tier === 'lossless');
}

/** quick-260930-vjp: acquire a pipeline slot; resolves with its release fn. */
export type StageGate = () => Promise<() => void>;

type DownloadOpts = {
	persist?: boolean;
	save?: boolean;
	trackNumber?: string;
	albumArtist?: string;
	audioFrom?: Track;
	dir?: string;
	onSaved?: (uid: string, filename: string, blob: Blob) => void;
	// quick-260930-vjp: two-stage pipeline gates, passed ONLY by the album download. `resolve` brackets
	// the link lookup (ensureTrackDetails / fetchVariants / probeDownload — apiFetch, shared with
	// playback); `transfer` brackets the raw audio fetch → tag → persist/save. A resolve slot is always
	// released before a transfer slot is requested (no hold-and-wait, so the two gates cannot
	// deadlock), and the transfer slot is released in the `finally`. Omitted = no gating, unchanged.
	stages?: { resolve: StageGate; transfer: StageGate };
};

/**
 * Download ONE song: resolve→addDownload→fetch→(persist)→save. Isolation-safe, never-throws,
 * never-navigates. `opts.persist` defaults TRUE; `persist:false` skips `blobStore.put` (no offline
 * blob, no native public copy) while addDownload + saveBlobToDisk + begin/end still run — for a
 * caller that only wants a browser save.
 *
 * 40-D-04: the album path uses `persist:true, save:false, dir` instead, so the offline blob AND the
 * native public write both happen (`persist:false` was why album downloads never reached
 * `Music/OpenMusic/`). `opts.dir` (`Artist/Album`) is threaded into `blobStore.put` to file the public
 * copy into its album folder (40-D-01); `opts.onSaved(uid, filename, blob)` hands the persisted blob
 * back to the caller (the web zip) without a second read.
 *
 * 31-D-12: `opts.save` also defaults TRUE; `save:false` is the SILENT background repair mode — the
 * offline blob is re-persisted and the library record refreshed, but no `<a download>` click fires.
 * The repair is triggered by a playback error the user never asked about, so popping a file-save
 * dialog mid-song would itself be the bug.
 *
 * 36-D-11 / 36-D-12: `opts.trackNumber` and `opts.albumArtist` are supplied ONLY by the album page
 * loop, the one place in the app that knows a real album position and a real album artist. Every
 * other caller omits them and gets no track number at all, with `albumArtist` defaulting to the
 * track's own artist (the grouping default).
 *
 * quick-260916-0d9: `opts.audioFrom` is the "Download from…" picker's contract — download the DONOR
 * track's ALREADY-MEASURED audio under THIS track's identity. It skips BOTH reuse tests AND the
 * re-resolve, deliberately:
 *   - `reuseCurrent` matches on uid, and the uid here is the ORIGINAL's — so whenever this song
 *     happens to be playing it would silently substitute `player.current`'s url for the source row
 *     the user just picked;
 *   - a re-resolve at `settings.downloadQuality` could fetch a DIFFERENT (bigger) file than the size
 *     the picker row showed — the whole point of the sheet is that the bytes shown are the bytes
 *     saved (the 52 MB-FLAC-on-cellular incident).
 * Everything downstream is untouched: `r` spreads `track`, so the ORIGINAL uid/source/songid flow
 * into `library.addDownload` AND `blobStore.put` — which is what makes `library.isDownloaded(uid)`
 * and `player.play(original)`'s offline-blob branch line up with what was actually saved. A donor url
 * that went stale (sheet left open past the 15-min TTL) is NOT re-checked here: it fails at `fetch`
 * → 'failed' → the existing "kept in Library" degrade, the same as any other CDN refusal.
 */
export async function downloadTrack(track: Track, opts?: DownloadOpts): Promise<DownloadResult> {
	// DL-STATE-01: bracket the per-uid spinner. beginDownload BEFORE the first await; endDownload in
	// the `finally` so EVERY exit (saved / no-audio / failed / any throw) clears the spinner exactly once.
	// Nested inside an album's outer bracket this is a refcount step (library.downloadDepth).
	library.beginDownload(track.uid);
	let res: DownloadResult = 'failed';
	try {
		res = await runDownload(track, opts); // never throws (D-17)
		return res;
	} finally {
		// debug album-row-tick-before-file-done: the row tick is `isDownloaded && !downloading`, and
		// addDownload ran PRE-fetch (DL-BUG-01) — so an attempt that ends WITHOUT a file must leave the
		// existing "entry without a file" mark (34-D-06 `unavailable`, the alert glyph) rather than the
		// tick, and a save must lift it. Marked BEFORE endDownload so no render sees "downloaded, idle,
		// unmarked". Guarded on isDownloaded: an exit that never reached addDownload marks nothing.
		if (library.isDownloaded(track.uid)) {
			if (res === 'saved') library.clearUnavailable(track.uid);
			else library.markUnavailable(track.uid);
		}
		// DL-STATE-01: clear the per-uid spinner on every exit path.
		library.endDownload(track.uid);
	}
}

/** The body of `downloadTrack` — resolve → addDownload → fetch → tag → persist → save. */
async function runDownload(track: Track, opts?: DownloadOpts): Promise<DownloadResult> {
	let release: (() => void) | undefined;
	let rateLimited = false;
	try {
		let r: Track;
		// D-18: READ-ONLY snapshot of the playing track. We never write back to player.current.
		const cur = player.current;
		// hasFreshAudioUrl (debug slow-cold-start-first-playing): this was an inline copy of the
		// readiness guard with no age check, so a download could reuse an expired signed url off the
		// playing track and write a dead file. Shared guard now — one definition, every trust decision.
		const reuseCurrent =
			cur != null &&
			cur.uid === track.uid &&
			hasFreshAudioUrl(cur) &&
			currentQualityMeets(cur.quality, settings.downloadQuality);
		// quick-260915-26g: the same reuse test applied to the track we were HANDED. The download
		// affordance now probes (resolve at the download tier + HEAD) to label itself `FLAC · 38.2 MB`
		// and passes that probed Track straight back in on the tap. Without this branch the tap would
		// re-resolve a THIRD time and could save a DIFFERENT file than the label just promised.
		// currentQualityMeets' lossless guard still forces a re-resolve for a streaming-tier track
		// under want='lossless', and hasFreshAudioUrl re-checks the 15-min TTL here — so a stale probe
		// simply re-resolves and no existing caller's behavior changes.
		const reuseInput =
			!reuseCurrent && hasFreshAudioUrl(track) && currentQualityMeets(track.quality, settings.downloadQuality);
		if (opts?.audioFrom) {
			// quick-260916-0d9: the picker already resolved + HEAD-measured THIS source's file. Take its
			// audio verbatim onto the ORIGINAL identity — no reuse test, no re-resolve (see the doc
			// comment above for why either would betray the size the row promised). `track.lrc ||
			// d.lrc`: the song's own lyrics win; the donor's are a free fallback for a source that has
			// them when the original doesn't.
			const d = opts.audioFrom;
			r = {
				...track,
				audioUrl: d.audioUrl,
				quality: d.quality,
				qualityLabel: d.qualityLabel,
				resolvedAt: d.resolvedAt,
				detailsLoaded: true,
				lrc: track.lrc || d.lrc
			};
		} else if (reuseCurrent) {
			// Reuse the already-resolved current track's URL/details (a fresh COPY — never the live
			// player.current reference, so nothing downstream can mutate the playing track).
			r = { ...(cur as Track) };
		} else if (reuseInput) {
			r = { ...track };
		} else {
			// Re-resolve at the user's DOWNLOAD quality (separate from the streaming default). WR-07: the
			// tier is threaded through ensureTrackDetails as an explicit per-call parameter — never a
			// temporary settings swap that races concurrent playback resolves. Force a fresh resolve by
			// clearing cached details on a COPY (the caller's queue track is left untouched). `.catch`
			// degrades a resolve failure to the original stub (never-throws).
			release = await opts?.stages?.resolve();
			r = await ensureTrackDetails(
				{ ...track, detailsLoaded: false, audioUrl: null, lrc: null },
				undefined,
				settings.downloadQuality
			).catch((e: unknown) => {
				rateLimited = isQqRateLimited(e);
				return track;
			});
			release?.();
			release = undefined;
		}
		// Intended download effect: reference the song in the LIBRARY downloads list (NOT player state).
		// Runs BEFORE the fetch so a later fetch/save failure still leaves the song in the list (it
		// re-streams on tap) — this is what makes DL-BUG-01's "keep in library" guarantee hold.
		library.addDownload(r);
		if (!r.audioUrl) return rateLimited ? 'rate-limited' : 'no-audio';

		// RAW fetch (not apiFetch — fetch→apiFetch audit): a MEDIA download-to-blob of the resolved
		// audio stream. audioUrl is often an ABSOLUTE CDN URL (qq/kuwo/joox) — apiFetch would corrupt it —
		// and a full-file body must not be routed through the JSON governor's dedup/cap.
		//
		// quick-261004-o9t — the two ytmusic specifics (the quick-260930-uia "never ytmusic" rule is
		// lifted, see the module note above `isGooglevideoUrl`):
		//   - NATIVE + a direct googlevideo url: the url is IP-locked to THIS phone and googlevideo sends
		//     no access-control-allow-origin, so a WebView fetch() CORS-fails. The phone fetches it over
		//     CapacitorHttp (`nativeFetchStreamBlob`). The old base64 warning here was about 50 MB FLACs;
		//     a 3–5 MB AAC is fine (the helper's ponytail line names the ceiling). No proxy fallback: the
		//     resolver already fell back to the proxy url when it could not sign a direct one, so a dead
		//     direct fetch is 'failed' → the existing "kept in Library" degrade.
		//   - the stream proxy url: plain fetch, retried up to YTMUSIC_FETCH_ATTEMPTS (per-invocation
		//     egress-IP bot gate). Every other url is one fetch, as before.
		const ytKind = isGooglevideoUrl(r.audioUrl) ? 'direct' : isYtmusicProxyUrl(r.audioUrl) ? 'proxy' : null;
		release = await opts?.stages?.transfer();
		let rawBlob: Blob;
		if (Capacitor.isNativePlatform() && ytKind === 'direct') {
			const b = await nativeFetchStreamBlob(r.audioUrl);
			if (!b) return 'failed';
			rawBlob = b;
		} else {
			const resp = await fetchRetrying(r.audioUrl, ytKind ? YTMUSIC_FETCH_ATTEMPTS : 1);
			// 40-03 (album E2E): fetch() does not reject on an HTTP error, and the ytmusic stream proxy's
			// googlevideo 403 has an EMPTY body typed audio/mp4 — so this used to persist + save a 0-byte
			// file and report 'saved' (an album showed "Saved 10 of 10" with five empty entries). A non-2xx
			// is a failed download; an empty body is checked after the read below.
			if (!resp.ok) return 'failed';
			// quick-260913-omi: read the body through a reader instead of `resp.blob()` so the Download
			// row can show REAL progress. Same one fetch, same one pass over the bytes — progress is a
			// side effect of the read we were already doing. Without a Content-Length the helper falls
			// back to `resp.blob()` and reports nothing, so the row keeps its indeterminate spinner.
			//
			// quick-260913-tmi: the type is derived from the audio URL, NOT from the response header — the
			// qq CDN serves audio as `application/x-www-form-urlencoded`, and `resp.blob()` was stamping
			// that onto the saved file and the offline copy. Threaded in so the streaming path builds the
			// Blob with the right type from the start rather than re-wrapping tens of MB afterwards.
			rawBlob = await readBlobWithProgress(
				resp,
				(fraction) => library.setDownloadProgress(track.uid, fraction),
				{ type: audioMimeForUrl(r.audioUrl, resp.headers?.get?.('content-type')) }
			);
		}
		if (!rawBlob.size) return 'failed';

		// DL-FILE-01 (D-05/D-06/D-07): controlled, translated filename `{artist} - {song}.{ext}`. The
		// caller-free display-name translation (names.dn*, synchronous cached-or-raw) is applied here;
		// the pure download-filename helper composes + sanitizes.
		//
		// 36 Pattern 5: the SAME two display names feed the filename AND the embedded tags, so a file
		// can never be named 標題 while its tag says 标题.
		const dnArtist = names.dnArtist(r.artist);
		const dnTitle = names.dnTitle(r.title, r.artist);
		// FILENAME ONLY. `extFromAudioUrl` is NOT the container dispatch key — its 'mp3' default would
		// route a FLAC into ID3. The codec sniffs the actual bytes instead (RESEARCH Pitfall 3).
		// quick-261004-o9t: itag 140 is AAC/mp4 and neither ytmusic url carries an extension, so
		// extFromAudioUrl would default to `.mp3` (ytmusic.ts resolve() stamps the true tier the same way).
		const ext = ytKind ? 'm4a' : extFromAudioUrl(r.audioUrl);
		const filename = buildDownloadFilename(dnArtist, dnTitle, ext);

		// 36-D-13 / 36-D-14: embed the cover the app itself displays, through the existing artwork
		// resolver — no new fetch path, no new host surface. Bounded by its own 6 s / 1 MB / https-only
		// limits, and D-14 accepts that wait on a download the user explicitly asked for.
		// RAW fetch (not apiFetch — fetch→apiFetch audit): the resolver's direct CDN tier is a raw
		// image fetch (Deezer/iTunes are CORS-clean); its /api/og fallback tier already goes through
		// `apiUrl` and the governor. Nothing new to route here.
		//
		// quick-260914-to2 — WHY THE LADDER. "the cover the app itself displays" was read from `r.cover`
		// alone, which is NOT where that cover lives. A CN source's `Track.cover` is frequently null /
		// non-https / CORS-dead, so the resolver's direct tier was skipped or failed and its /api/og tier
		// answered — with the branded share card. 板斧 / Novel Flash played in-app with correct art while its
		// downloaded file carried the openmusic card. The displayed cover actually lives in the SHARED
		// reactive cover cache, or on `player.resolvedCover` when this IS the playing song. Same
		// hero / media-card asymmetry fixed at player.svelte.ts:1300; the precedence below is
		// TrackMenu.svelte's share ladder verbatim, widest authority first.
		//
		// RULE 1 — the cache lookup uses the RAW `r.artist` / `r.title`, NEVER `dnArtist` / `dnTitle`. The
		// name layer is matchKey'd on raw CATALOG metadata, so a display-language string (zh-Hant 夢伴 for
		// catalog 梦伴) misses the cache for exactly the users the display conversion exists for.
		// `resolveArtworkDataUrl` still receives the dn* strings because they feed its /api/og TEXT query,
		// a different consumer.
		//
		// RULE 2 — reading `player.current` / `player.resolvedCover` here is READ-ONLY and preserves the
		// D-18 DOWNLOAD ISOLATION contract (no assignment, no gen bump, no <audio> touch). Do not "fix"
		// it back out; the isolation test's throwing setters prove it stays a read.
		//
		// quick-260920-oj8 — closes the quick-260920-nyq deferred item. The playing-song rung was
		// `player.resolvedCover`, the OLD precedence; nyq made the hero / Nowbar / OS card paint from
		// the shared cache first, so a download could embed art the app was NOT showing. The user's call
		// is one resolver everywhere — "same song, same cover everywhere", and for a downloaded file that
		// means what you see is what gets embedded — so this reads the ONE now-playing reader
		// (`displayCover`: pin → uid → name → resolvedCover, with an embedded `data:` cover kept ahead of
		// the https-only cache per 37-D-02). Still a pure READ, so RULE 2's D-18 isolation holds.
		const displayCover =
			(player.current?.uid === r.uid ? player.displayCover : null) ??
			readCoverByUidOrName(r.uid, r.artist, r.title) ??
			r.cover ??
			null;
		const artDataUrl = await resolveArtworkDataUrl({ cover: displayCover, title: dnTitle, artist: dnArtist });

		// 36-D-05 — THE seam. All four download callers (TrackMenu, DownloadControl, the album bulk
		// loop, background repair) pass through this one line, so one insertion tags every path.
		// No try/catch of our own: `tagAudioBlob` NEVER rejects and returns the original blob on any
		// failure, which is exactly how D-17 NEVER-THROWS and 36-D-06 TAG-OR-INTACT hold by
		// construction. 36-D-10 (an empty album is OMITTED, not looked up) now lives inside
		// `albumTag`, which additionally drops an album that is just the song's own title — CN and
		// streaming catalogs set a single's `album` to its track name, and we used to write it. BOTH
		// titles go in: the tag carries `dnTitle` (script-converted) while the album rides the RAW
		// catalog string, so a one-title compare misses the Simplified-album/Traditional-title case
		// (quick-260919-0mw).
		//
		// quick-260919-2jo / D-7 — that RAW album is now run through the Chinese script lock, which
		// CLOSES the case 0mw could only detect. 0mw's two-title compare drops an album that IS the
		// song title in either script; it could do nothing about a genuine, DISTINCT album name,
		// which kept being written in whatever script the catalog happened to use while the title
		// tag next to it carried the user's locked script. `names.zhLock` (NOT `dnTitle`) because it
		// is synchronous and network-free — routing the album through the translation layer would
		// queue an /api/translate batch inside the download path, and the reported bug is a script
		// mismatch, not a missing translation. With the lock off this is byte-for-byte identity.
		//
		// quick-260915-062 — lyrics ride the same seam. `r.lrc` is ALREADY resolved by
		// `ensureTrackDetails` above (or copied off `player.current` on the reuse path), so this is a
		// zero-fetch addition: no lrcUrl resolution, no new host, nothing added to the D-18 isolation
		// surface. `|| undefined` mirrors 36-D-10 so a track with no lyrics gets no frame at all, and
		// because all four callers funnel through this one line, the album bulk loop and the
		// background repair path embed lyrics with no change of their own.
		const tagged = await tagAudioBlob(
			rawBlob,
			{
				title: dnTitle,
				artist: dnArtist,
				album: albumTag(names.zhLock(r.album), r.title, dnTitle),
				albumArtist: opts?.albumArtist ?? dnArtist,
				trackNumber: opts?.trackNumber,
				lyrics: r.lrc || undefined
			},
			artDataUrl
		);
		const blob = tagged.blob;
		// Activity log (Settings → Activity log) is where a silently-untagged download becomes
		// visible on device — `skipped-size` and `error` are otherwise indistinguishable from success.
		logAction('download.tag', {
			uid: r.uid,
			result: tagged.result,
			...(tagged.result === 'tagged' ? { format: tagged.format } : {}),
			art: artDataUrl != null,
			bytes: rawBlob.size
		});

		// Offline cache (kyf): persist the SAME blob keyed by uid so a later player.play() of this uid
		// streams from the local blob instead of the CDN. The filename is threaded to the native public
		// (MediaStore) write. Skipped when persist:false. Never throws. 40-D-01: the album dir is a 4th
		// arg ONLY when set, so every dir-less call keeps its exact 3-arg shape.
		if (opts?.persist !== false) {
			if (opts?.dir) await blobStore.put(r.uid, blob, filename, { dir: opts.dir });
			else await blobStore.put(r.uid, blob, filename);
		}
		// 40-D-04: hand the saved blob to the caller (album zip collection) before any early return.
		try {
			opts?.onSaved?.(r.uid, filename, blob);
		} catch {
			// a broken callback must not fail the download (36-D-19 posture).
		}

		// 31-D-12: silent background repair — the offline blob (and the library record) are refreshed
		// above, which is the whole point of the re-download; the disk save is skipped so no picker /
		// download-shelf appears for an action the user never initiated.
		if (opts?.save === false) return 'saved';

		// Web save via the anchor seam (DL-BUG-01/D-02/D-09): a same-origin blob: <a download> click,
		// NO save-picker prompt, NO new-tab navigation. Returns false (not a throw) on any DOM failure.
		return saveBlobToDisk(blob, filename) ? 'saved' : 'failed';
	} catch {
		// DL-BUG-01 (D-09): a fetch/blob failure returns 'failed' — it NEVER window.open's the raw
		// stream URL. The song is already in library.downloads and re-streams on tap; the caller shows
		// toast.downloadFailedKeptInLibrary.
		return 'failed';
	} finally {
		release?.();
	}
}

/** Run `work` inside one `gate` slot (no gate = run ungated), releasing on every exit. */
async function withGate<T>(gate: StageGate | undefined, work: () => Promise<T>): Promise<T> {
	const release = await gate?.();
	try {
		return await work();
	} finally {
		release?.();
	}
}

/**
 * The donor walk (shared since quick-260930-x3q): one `fetchVariants` lookup,
 * `versionsIncludingOwn` order (one row per source), `exclude`d sources dropped (quick-261004-o9t:
 * ytmusic may be a donor now), then each
 * row probed at the DOWNLOAD tier one at a time, yielding only probes that found audio. Sequential by
 * construction — one probe in flight. Never throws: any failure just ends the walk.
 */
export async function* donorProbes(
	track: Track,
	o: { signal?: AbortSignal; gate?: StageGate; exclude?: SourceId[] } = {}
): AsyncGenerator<DownloadProbe> {
	const exclude = o.exclude ?? [];
	try {
		const variants = await withGate(o.gate, () => fetchVariants(track, o.signal));
		const donors = versionsIncludingOwn(track, variants).filter((v) => !exclude.includes(v.source));
		for (const donor of donors) {
			if (o.signal?.aborted) return;
			const p = await withGate(o.gate, () => probeDownload(donor, o.signal));
			if (p.track?.audioUrl) yield p;
		}
	} catch {
		// never-throws: a failed lookup or probe ends the walk.
	}
}

/**
 * Save THIS song with another source's audio (the picker's `audioFrom` contract, quick-260916-0d9) —
 * the album loop's fallback for a rate-limited / audio-less song (quick-260930-x3q, quick-261001-0p9).
 * `exclude` drops sources already tried. Without `prefer` the first donor in walk order wins.
 * `prefer: 'tier'` (quick-261001-0p9, the
 * album's after-the-qq-wait fallback): still ONE walk — a donor matching the download tier's quality
 * AND format (`donorMatchesTier`) is tried the moment it is seen; the rest are collected and, if no
 * match saved, tried best-first by `donorRank` (stable on ties) so the album still finishes.
 * No donor → 'no-audio'; every donor failed → 'failed'. D-17 never-throws.
 */
export async function downloadFromDonor(
	track: Track,
	opts?: DownloadOpts,
	o: { exclude?: SourceId[]; prefer?: 'tier' } = {}
): Promise<DownloadResult> {
	try {
		// DL-STATE-01: the row ring spins through the donor lookup too. debug album-row-tick-before-
		// file-done: library.downloading is refcounted now, so each inner downloadTrack bracket nests
		// inside this one — the old per-attempt re-arm is gone.
		library.beginDownload(track.uid);
		try {
			let failed = false;
			const attempt = async (donor: Track): Promise<boolean> => {
				const res = await downloadTrack(track, { ...opts, audioFrom: donor });
				if (res === 'saved') return true;
				if (res === 'failed') failed = true;
				return false;
			};
			// quick-261001-0p9: non-matching donors wait here until the walk ends without a save.
			const rest: { donor: Track; rank: number }[] = [];
			// quick-260930-vjp: the donor lookup + each probe is resolve-stage work; released before
			// downloadTrack takes its transfer slot.
			for await (const p of donorProbes(track, { gate: opts?.stages?.resolve, exclude: o.exclude })) {
				if (!p.track) continue;
				const file = { container: p.container, quality: p.track.quality };
				if (o.prefer === 'tier' && !donorMatchesTier(file, settings.downloadQuality)) {
					rest.push({ donor: p.track, rank: donorRank(file) });
					continue;
				}
				if (await attempt(p.track)) return 'saved';
			}
			// Array#sort is stable, so equal ranks keep walk order.
			for (const r of rest.sort((a, b) => b.rank - a.rank)) if (await attempt(r.donor)) return 'saved';
			return failed ? 'failed' : 'no-audio';
		} finally {
			library.endDownload(track.uid);
		}
	} catch {
		// D-17 NEVER-THROWS.
		return 'failed';
	}
}
