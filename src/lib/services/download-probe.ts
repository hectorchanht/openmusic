// download-probe.ts — "what file am I actually about to download?" (quick-260915-26g).
//
// WHY THIS EXISTS. `settings.downloadQuality` is a REQUEST, not a promise: kuwo answers "lossless"
// with a 320K mp3, qq's ladder hands back whatever tier it happens to have. So a label composed from
// the setting would be a guess presented as fact. The user chose ~2-3s of skeleton over an instant
// lie: this module resolves the song AT the download tier and asks the CDN how big the file is, so
// the affordance can say `FLAC · 38.2 MB` and mean it.
//
// CONTRACTS (asserted in download-probe.test.ts):
//
//   NEVER-THROWS: every failure path resolves the all-null sentinel. A probe is decoration on an
//     affordance — it must never block, delay or fail an actual download tap. The caller renders
//     today's plain `Download` label when the result is empty.
//
//   OPT-IN ONLY: nothing here throttles itself, because nothing here fans out. The single defence
//     against the `api-fetch-flood-freeze` class is that the ONLY callers are surfaces the user just
//     opened — `DownloadControl`'s `probe` prop defaults FALSE and no list row sets it (T-26g-02).
//     Do not call this from a row render, a list `$effect`, or any loop.
//
//   D-18 DOWNLOAD ISOLATION: `player.current` is read READ-ONLY (to reuse an already-resolved url)
//     and handed out only as a COPY. Never assigned, never gen-bumped, never near the <audio>.
//
//   NEVER GUESS A CONTAINER: `extFromAudioUrl`'s 'mp3' default is FILENAME-only, and the qq CDN
//     serves audio as `application/x-www-form-urlencoded`. Only an `audio/*` Content-Type or a REAL
//     url extension counts; anything else omits the format rather than inventing one.

import type { Track } from '$lib/sources/types';
import { ensureTrackDetails } from '$lib/services/catalog';
import { hasFreshAudioUrl } from '$lib/services/track-ready';
import { combinedSignal } from '$lib/services/abort-signal';
import { AUDIO_EXTENSIONS } from '$lib/services/download-filename';
import { currentQualityMeets } from '$lib/services/download-track';
import { settings } from '$lib/stores/settings.svelte';
import { player } from '$lib/stores/player.svelte';

/** What the download affordance can truthfully say. `track` is the resolved Track the numbers
 *  describe — handing it to `downloadTrack` is what makes the label and the file agree. */
export type DownloadProbe = {
	container: string | null;
	qualityLabel: string | null;
	bytes: number | null;
	track: Track | null;
};

/** Same 8s ceiling the caller would otherwise wait on forever. Every fetch here is deadlined —
 *  an un-deadlined fetch is the failure mode that strands the resolve path (api-base.ts:31-51). */
const PROBE_TIMEOUT_MS = 8000;

/** Cap on the memo, clear-on-overflow like prewarm.ts's `MAX_TRACKED_UIDS`: forgetting a key costs
 *  one redundant probe, which is cheaper than an LRU nobody will maintain. */
const MAX_MEMO = 200;

/** Keyed `${uid}|${downloadQuality}` — the tier is part of the answer, so it is part of the key.
 *  PLAIN Map (house idiom: an internal cache the UI never reads reactively is never a rune). */
const memo = new Map<string, DownloadProbe>();

/** The all-null sentinel. Built fresh per call so no caller can mutate a shared object. */
const none = (): DownloadProbe => ({ container: null, qualityLabel: null, bytes: null, track: null });

/**
 * Human byte size. 1 KB = 1024; under 1 MB reads as integer KB (a decimal there is noise), MB/GB
 * carry one decimal. Anything that is not a real size — null, NaN, Infinity, negative — returns
 * null so a hostile or broken `Content-Length` can never render as "NaN MB" (T-26g-01).
 */
export function formatBytes(bytes: number | null | undefined): string | null {
	if (typeof bytes !== 'number' || !Number.isFinite(bytes) || bytes < 0) return null;
	const KB = 1024;
	const MB = KB * 1024;
	const GB = MB * 1024;
	if (bytes < MB) return `${Math.round(bytes / KB)} KB`;
	if (bytes < GB) return `${(bytes / MB).toFixed(1)} MB`;
	return `${(bytes / GB).toFixed(1)} GB`;
}

/** Inverse of download-filename's AUDIO_MIME, plus the `x-` variants CDNs actually emit. */
const EXT_BY_MIME: Record<string, string> = {
	'audio/mpeg': 'mp3',
	'audio/mp3': 'mp3',
	'audio/flac': 'flac',
	'audio/x-flac': 'flac',
	'audio/mp4': 'm4a',
	'audio/m4a': 'm4a',
	'audio/x-m4a': 'm4a',
	'audio/aac': 'aac',
	'audio/ogg': 'ogg',
	'audio/wav': 'wav',
	'audio/x-wav': 'wav'
};

/**
 * Container from a response `Content-Type` — ONLY when it already looks like audio. The qq CDN
 * labels audio `application/x-www-form-urlencoded` (download-filename.ts), so a non-`audio/` type
 * carries no information and must produce null rather than a fabricated format.
 */
export function containerFromContentType(ct: string | null | undefined): string | null {
	const mime = (ct ?? '').split(';')[0].trim().toLowerCase();
	if (!mime.startsWith('audio/')) return null;
	return EXT_BY_MIME[mime] ?? null;
}

const AUDIO_EXT = new RegExp(`\\.(${AUDIO_EXTENSIONS.join('|')})$`, 'i');

/**
 * Container from a resolved audio URL — the same `?query`-strip + `$`-anchored match
 * `extFromAudioUrl` uses, but returning NULL on no match instead of its 'mp3' default. That default
 * exists so a filename is always buildable; displaying it would state a guess as fact.
 */
export function containerFromUrl(url: string | null): string | null {
	return url?.split('?')[0].match(AUDIO_EXT)?.[1]?.toLowerCase() ?? null;
}

/** Containers that ARE the quality claim — no bitrate label can add to "this is a FLAC". */
const LOSSLESS_EXT = new Set(['flac', 'wav']);

/**
 * The one label string, shared by every download surface: `FLAC · 38.2 MB`, `320K · 8.1 MB`, or
 * whichever half survived. Null when nothing is known — the caller then renders today's plain
 * `Download`. Composed from source-emitted tokens + unit symbols, so it needs no i18n key.
 */
export function formatDownloadMeta(p: Pick<DownloadProbe, 'container' | 'qualityLabel' | 'bytes'>): string | null {
	const token =
		p.container && LOSSLESS_EXT.has(p.container)
			? p.container.toUpperCase()
			: (p.qualityLabel ?? p.container?.toUpperCase() ?? null);
	const parts = [token, formatBytes(p.bytes)].filter(Boolean);
	return parts.length ? parts.join(' · ') : null;
}

/** A header value is a size only when it parses to a finite positive number (T-26g-01). */
function positiveInt(raw: string | null | undefined): number | null {
	if (raw == null || raw.trim() === '') return null;
	const n = Number(raw);
	return Number.isFinite(n) && n > 0 ? n : null;
}

/**
 * Size + authoritative content-type for an absolute CDN url.
 *
 * RAW fetch, NEVER apiFetch (fetch→apiFetch audit, same rule as download-track.ts:119): this is an
 * absolute third-party media URL — the JSON governor would corrupt it. Ladder: HEAD (cheapest) →
 * `Range: bytes=0-0` (a safelisted request header, so no preflight; the `Content-Range` it answers
 * with is NOT CORS-safelisted, so some CDNs hide it) → give up with null. Every failure is caught:
 * an unknown size is a smaller label, never an error.
 */
async function measure(url: string, signal?: AbortSignal): Promise<{ bytes: number | null; ct: string | null }> {
	let bytes: number | null = null;
	let ct: string | null = null;
	try {
		const r = await fetch(url, {
			method: 'HEAD',
			referrerPolicy: 'no-referrer',
			signal: combinedSignal(PROBE_TIMEOUT_MS, signal)
		});
		if (r.ok) {
			ct = r.headers?.get?.('content-type') ?? null;
			bytes = positiveInt(r.headers?.get?.('content-length'));
		}
	} catch {
		// HEAD refused / blocked / timed out — fall through to the Range probe.
	}
	if (bytes != null) return { bytes, ct };
	try {
		const r = await fetch(url, {
			headers: { Range: 'bytes=0-0' },
			referrerPolicy: 'no-referrer',
			signal: combinedSignal(PROBE_TIMEOUT_MS, signal)
		});
		ct = ct ?? r.headers?.get?.('content-type') ?? null;
		bytes = positiveInt(r.headers?.get?.('content-range')?.match(/\/(\d+)$/)?.[1]);
		// One byte was requested, but cancel the body anyway — a CDN that ignores Range would
		// otherwise stream the whole file behind a label.
		void r.body?.cancel();
	} catch {
		// Both probes blind: the label degrades to format-only.
	}
	return { bytes, ct };
}

/**
 * Probe what a download of `track` would actually produce, at the user's CURRENT download tier.
 * Never rejects. Memoised per `uid|downloadQuality`; a total miss is deliberately NOT memoised so
 * re-opening retries a transient CDN refusal.
 */
export async function probeDownload(track: Track, signal?: AbortSignal): Promise<DownloadProbe> {
	const want = settings.downloadQuality;
	const key = `${track.uid}|${want}`;
	const hit = memo.get(key);
	if (hit) return hit;
	if (signal?.aborted) return none();

	// Reuse before resolve — same pzs-04 reasoning as downloadTrack: a duplicate resolve of a song
	// already resolved at (or above) this tier buys nothing and adds CDN load. COPIES only.
	let r: Track | null = null;
	const cur = player.current; // D-18: READ-ONLY
	if (cur && cur.uid === track.uid && hasFreshAudioUrl(cur) && currentQualityMeets(cur.quality, want)) {
		r = { ...cur };
	} else if (hasFreshAudioUrl(track) && currentQualityMeets(track.quality, want)) {
		r = { ...track };
	} else {
		try {
			// Force a fresh resolve on a COPY at the DOWNLOAD tier (WR-07: threaded per-call, never a
			// temporary settings swap that would race concurrent playback resolves).
			r = await ensureTrackDetails(
				{ ...track, detailsLoaded: false, audioUrl: null, lrc: null },
				combinedSignal(PROBE_TIMEOUT_MS, signal),
				want
			);
		} catch {
			return none();
		}
	}
	if (!r?.audioUrl) return none();

	const { bytes, ct } = await measure(r.audioUrl, signal);
	const result: DownloadProbe = {
		container: containerFromContentType(ct) ?? containerFromUrl(r.audioUrl),
		qualityLabel: r.qualityLabel ?? null,
		bytes,
		track: r
	};

	// The sheet closed while we were measuring: drop the answer on the floor rather than let a stale
	// label land on the next song, and leave the memo untouched.
	if (signal?.aborted) return none();
	if (result.bytes != null || result.container != null) {
		if (memo.size >= MAX_MEMO) memo.clear();
		memo.set(key, result);
	}
	return result;
}

/** TEST-ONLY: drop the memo between cases (mirrors prewarm.ts's `__resetPrewarm`). */
export function __resetDownloadProbe(): void {
	memo.clear();
}
