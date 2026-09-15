import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { Track } from '$lib/sources/types';

// download-probe.ts answers ONE question for a download affordance the user just opened: "what file
// am I actually about to get?" — real container/quality + real byte size, probed at
// settings.downloadQuality (quick-260915-26g). It must:
//   - NEVER throw: every failure resolves the all-null sentinel so the affordance falls back to the
//     plain `Download` label and an actual download tap is never blocked or delayed by a probe;
//   - reuse an already-resolved, still-FRESH, tier-satisfying track (player.current or the input)
//     instead of forcing another resolve;
//   - size via RAW fetch only — HEAD → `Range: bytes=0-0` → give up with `bytes: null`;
//   - NEVER present a guessed container: only an `audio/*` Content-Type or a REAL url extension
//     counts (extFromAudioUrl's 'mp3' default is filename-only and must not reach the UI);
//   - memoise per `uid|downloadQuality` so re-opening the same menu costs no network, but NOT
//     memoise a total miss (nothing learned → retry on reopen).
// Same single node Vitest project as download-track.test.ts: no jsdom, so every runes store and
// every browser-only service on the import chain is mocked here.

// ---- hoisted mocks (referenced inside the vi.mock factories below) --------------------------------
const mocks = vi.hoisted(() => ({
	// READ-ONLY from the service (D-18 DOWNLOAD ISOLATION) — the probe only ever reads `current`.
	player: { current: null as Track | null },
	settings: { downloadQuality: 'lossless' as string },
	ensureTrackDetails: vi.fn(async (_t: Track, _s?: unknown, _q?: unknown) => _t),
	// download-probe imports the REAL `currentQualityMeets` from download-track, which drags the rest
	// of the download graph in — mocked exactly as download-track.test.ts does so it loads in node.
	library: { beginDownload: vi.fn(), endDownload: vi.fn(), addDownload: vi.fn() },
	readCoverByUidOrName: vi.fn((): string | null => null),
	names: { dnArtist: vi.fn((s: string) => s), dnTitle: vi.fn((s: string) => s) },
	put: vi.fn(async () => true),
	saveBlobToDisk: vi.fn(() => true),
	tagAudioBlob: vi.fn(async (blob: Blob) => ({ blob, result: 'tagged', format: 'm4a' })),
	resolveArtworkDataUrl: vi.fn(async (): Promise<string | null> => null),
	logAction: vi.fn()
}));

vi.mock('$lib/stores/player.svelte', () => ({ player: mocks.player }));
vi.mock('$lib/stores/settings.svelte', () => ({ settings: mocks.settings }));
vi.mock('$lib/services/catalog', () => ({ ensureTrackDetails: mocks.ensureTrackDetails }));
vi.mock('$lib/stores/library.svelte', () => ({ library: mocks.library }));
vi.mock('$lib/stores/cover-version.svelte', () => ({ readCoverByUidOrName: mocks.readCoverByUidOrName }));
vi.mock('$lib/stores/names.svelte', () => ({ names: mocks.names }));
vi.mock('$lib/services/blob-store', () => ({ blobStore: { put: mocks.put }, put: mocks.put }));
vi.mock('$lib/services/download-save', () => ({ saveBlobToDisk: mocks.saveBlobToDisk }));
vi.mock('$lib/services/audio-tags', () => ({ tagAudioBlob: mocks.tagAudioBlob }));
vi.mock('$lib/services/media-artwork', () => ({ resolveArtworkDataUrl: mocks.resolveArtworkDataUrl }));
vi.mock('$lib/stores/actionLog.svelte', () => ({ logAction: mocks.logAction }));

import {
	probeDownload,
	formatBytes,
	formatDownloadMeta,
	containerFromUrl,
	containerFromContentType,
	__resetDownloadProbe
} from './download-probe';

const mk = (over: Partial<Track> = {}): Track =>
	({
		uid: 'kuwo-1',
		source: 'kuwo',
		songid: '1',
		title: 'Song',
		artist: 'Artist',
		album: '',
		cover: null,
		audioUrl: 'https://cdn.example.com/a.flac',
		lrc: null,
		lrcUrl: null,
		detailsLoaded: true,
		resolvedAt: Date.now(),
		quality: 'lossless',
		qualityLabel: 'LOSSLESS',
		keyword: '',
		displayIndex: 1,
		...over
	}) as Track;

/** A minimal fetch Response stand-in: only the fields the size ladder reads. */
function resp(init: { ok?: boolean; status?: number; headers?: Record<string, string> }) {
	return {
		ok: init.ok ?? true,
		status: init.status ?? 200,
		headers: new Headers(init.headers ?? {}),
		body: { cancel: vi.fn(async () => {}) }
	};
}

/** Stub global fetch with a queue of per-call outcomes (a response object or a thrown Error). */
function stubFetchSeq(...outcomes: Array<ReturnType<typeof resp> | Error>) {
	let i = 0;
	const f = vi.fn(async (_url: string, _init?: RequestInit) => {
		const out = outcomes[Math.min(i, outcomes.length - 1)];
		i++;
		if (out instanceof Error) throw out;
		return out;
	});
	vi.stubGlobal('fetch', f);
	return f;
}

beforeEach(() => {
	__resetDownloadProbe();
	mocks.player.current = null;
	mocks.settings.downloadQuality = 'lossless';
	mocks.ensureTrackDetails.mockReset();
});

afterEach(() => {
	vi.unstubAllGlobals();
	vi.clearAllMocks();
});

describe('formatBytes', () => {
	it('formats KB as integers and MB/GB to one decimal (1 KB = 1024)', () => {
		expect(formatBytes(0)).toBe('0 KB');
		expect(formatBytes(1023)).toBe('1 KB');
		expect(formatBytes(8_493_465)).toBe('8.1 MB');
		expect(formatBytes(40_055_930)).toBe('38.2 MB');
		expect(formatBytes(1_288_490_189)).toBe('1.2 GB');
	});

	it('returns null for anything that is not a real size (never NaN in the UI — T-26g-01)', () => {
		expect(formatBytes(null)).toBeNull();
		expect(formatBytes(undefined)).toBeNull();
		expect(formatBytes(Number.NaN)).toBeNull();
		expect(formatBytes(-1)).toBeNull();
		expect(formatBytes(Number.POSITIVE_INFINITY)).toBeNull();
	});
});

describe('containerFromContentType', () => {
	it('maps audio/* subtypes to a container extension', () => {
		expect(containerFromContentType('audio/flac')).toBe('flac');
		expect(containerFromContentType('audio/x-flac')).toBe('flac');
		expect(containerFromContentType('audio/mpeg')).toBe('mp3');
		expect(containerFromContentType('audio/mp4')).toBe('m4a');
		expect(containerFromContentType('audio/aac')).toBe('aac');
		expect(containerFromContentType('audio/ogg')).toBe('ogg');
		expect(containerFromContentType('audio/wav')).toBe('wav');
		expect(containerFromContentType('Audio/FLAC; charset=utf-8')).toBe('flac');
	});

	it('refuses a non-audio type (qq serves audio as x-www-form-urlencoded)', () => {
		expect(containerFromContentType('application/x-www-form-urlencoded')).toBeNull();
		expect(containerFromContentType('audio/weird-subtype')).toBeNull();
		expect(containerFromContentType(null)).toBeNull();
		expect(containerFromContentType(undefined)).toBeNull();
	});
});

describe('containerFromUrl', () => {
	it('matches a REAL extension after stripping the query string', () => {
		expect(containerFromUrl('https://cdn/x/abc.FLAC?vkey=1')).toBe('flac');
		expect(containerFromUrl('https://cdn/x/abc.m4a')).toBe('m4a');
	});

	it('returns null instead of extFromAudioUrl’s ‘mp3’ default — never a guess shown as fact', () => {
		expect(containerFromUrl('https://cdn/x/abc')).toBeNull();
		expect(containerFromUrl('https://cdn/x/abc?ext=mp3')).toBeNull();
		expect(containerFromUrl(null)).toBeNull();
	});
});

describe('formatDownloadMeta', () => {
	it('prefers the lossless container over a quality label, and joins with the size', () => {
		expect(formatDownloadMeta({ container: 'flac', qualityLabel: 'LOSSLESS', bytes: 40_055_930 })).toBe(
			'FLAC · 38.2 MB'
		);
		expect(formatDownloadMeta({ container: 'mp3', qualityLabel: '320K', bytes: 8_493_465 })).toBe('320K · 8.1 MB');
	});

	it('omits whatever is missing rather than inventing it', () => {
		expect(formatDownloadMeta({ container: null, qualityLabel: '320K', bytes: null })).toBe('320K');
		expect(formatDownloadMeta({ container: 'm4a', qualityLabel: null, bytes: null })).toBe('M4A');
		expect(formatDownloadMeta({ container: null, qualityLabel: null, bytes: null })).toBeNull();
	});
});

describe('probeDownload — resolve + size ladder', () => {
	it('resolves at settings.downloadQuality on a COPY and reads HEAD content-length/type', async () => {
		const stub = mk({ audioUrl: null, detailsLoaded: false, qualityLabel: null });
		const resolved = mk({ audioUrl: 'https://cdn.example.com/a.flac', qualityLabel: 'LOSSLESS' });
		mocks.ensureTrackDetails.mockResolvedValue(resolved);
		const f = stubFetchSeq(resp({ headers: { 'content-length': '40055930', 'content-type': 'audio/flac' } }));

		const p = await probeDownload(stub);

		expect(p).toEqual({ container: 'flac', qualityLabel: 'LOSSLESS', bytes: 40_055_930, track: resolved });
		expect(mocks.ensureTrackDetails).toHaveBeenCalledTimes(1);
		const [copyArg, , qualArg] = mocks.ensureTrackDetails.mock.calls[0];
		expect(copyArg).not.toBe(stub);
		expect((copyArg as Track).detailsLoaded).toBe(false);
		expect((copyArg as Track).audioUrl).toBeNull();
		expect((copyArg as Track).lrc).toBeNull();
		expect(qualArg).toBe('lossless');
		// ONE HEAD, no second call — the length was already there.
		expect(f).toHaveBeenCalledTimes(1);
		expect(f.mock.calls[0][0]).toBe('https://cdn.example.com/a.flac');
		expect((f.mock.calls[0][1] as RequestInit).method).toBe('HEAD');
	});

	it('falls back to a Range GET when HEAD is refused, and cancels the body', async () => {
		mocks.ensureTrackDetails.mockResolvedValue(mk({ audioUrl: 'https://cdn.example.com/a.mp3', qualityLabel: '320K' }));
		const ranged = resp({
			ok: true,
			status: 206,
			headers: { 'content-range': 'bytes 0-0/8493465', 'content-type': 'audio/mpeg' }
		});
		const f = stubFetchSeq(resp({ ok: false, status: 405 }), ranged);

		const p = await probeDownload(mk({ audioUrl: null, detailsLoaded: false }));

		expect(p.bytes).toBe(8_493_465);
		expect(p.container).toBe('mp3');
		expect(f).toHaveBeenCalledTimes(2);
		expect((f.mock.calls[1][1] as RequestInit).headers).toEqual({ Range: 'bytes=0-0' });
		expect(ranged.body.cancel).toHaveBeenCalled();
	});

	it('also falls back when HEAD is OK but carries no content-length', async () => {
		mocks.ensureTrackDetails.mockResolvedValue(mk({ audioUrl: 'https://cdn.example.com/a.mp3' }));
		const f = stubFetchSeq(
			resp({ headers: { 'content-type': 'audio/mpeg' } }),
			resp({ status: 206, headers: { 'content-range': 'bytes 0-0/123456' } })
		);

		expect((await probeDownload(mk({ audioUrl: null, detailsLoaded: false }))).bytes).toBe(123_456);
		expect(f).toHaveBeenCalledTimes(2);
	});

	it('reports format alone when both size probes come back empty', async () => {
		mocks.ensureTrackDetails.mockResolvedValue(
			mk({ audioUrl: 'https://cdn.example.com/a.flac?vkey=1', qualityLabel: 'LOSSLESS' })
		);
		stubFetchSeq(new Error('HEAD blocked'), resp({ status: 200, headers: {} }));

		const p = await probeDownload(mk({ audioUrl: null, detailsLoaded: false }));

		expect(p.bytes).toBeNull();
		expect(p.container).toBe('flac');
		expect(p.qualityLabel).toBe('LOSSLESS');
		expect(formatDownloadMeta(p)).toBe('FLAC');
	});

	it('ignores a garbage content-length rather than rendering NaN (T-26g-01)', async () => {
		mocks.ensureTrackDetails.mockResolvedValue(mk({ audioUrl: 'https://cdn.example.com/a.m4a' }));
		stubFetchSeq(
			resp({ headers: { 'content-length': 'not-a-number' } }),
			resp({ status: 206, headers: { 'content-range': 'bytes */*' } })
		);

		expect((await probeDownload(mk({ audioUrl: null, detailsLoaded: false }))).bytes).toBeNull();
	});
});

describe('probeDownload — never throws', () => {
	it('returns the all-null sentinel when the resolve rejects', async () => {
		mocks.ensureTrackDetails.mockRejectedValue(new Error('upstream down'));
		const f = stubFetchSeq(resp({ headers: { 'content-length': '1' } }));

		await expect(probeDownload(mk({ audioUrl: null, detailsLoaded: false }))).resolves.toEqual({
			container: null,
			qualityLabel: null,
			bytes: null,
			track: null
		});
		expect(f).not.toHaveBeenCalled();
	});

	it('returns the sentinel when the resolve yields no audioUrl', async () => {
		mocks.ensureTrackDetails.mockResolvedValue(mk({ audioUrl: null, detailsLoaded: true }));

		await expect(probeDownload(mk({ audioUrl: null, detailsLoaded: false }))).resolves.toEqual({
			container: null,
			qualityLabel: null,
			bytes: null,
			track: null
		});
	});
});

describe('probeDownload — reuse instead of a second resolve', () => {
	it('reuses a uid-matching, fresh, tier-satisfying player.current (COPY) and still HEADs it', async () => {
		const cur = mk({ uid: 'kuwo-1', audioUrl: 'https://cdn.example.com/cur.flac' });
		mocks.player.current = cur;
		const f = stubFetchSeq(resp({ headers: { 'content-length': '999', 'content-type': 'audio/flac' } }));

		const p = await probeDownload(mk({ uid: 'kuwo-1', audioUrl: null, detailsLoaded: false }));

		expect(mocks.ensureTrackDetails).not.toHaveBeenCalled();
		expect(f.mock.calls[0][0]).toBe('https://cdn.example.com/cur.flac');
		expect(p.track).not.toBe(cur); // a COPY — D-18: the playing track is never handed out by reference
		expect(p.track?.audioUrl).toBe('https://cdn.example.com/cur.flac');
	});

	it('reuses the INPUT track when it is already fresh and meets the tier', async () => {
		const f = stubFetchSeq(resp({ headers: { 'content-length': '555', 'content-type': 'audio/flac' } }));

		const p = await probeDownload(mk({ audioUrl: 'https://cdn.example.com/in.flac' }));

		expect(mocks.ensureTrackDetails).not.toHaveBeenCalled();
		expect(f.mock.calls[0][0]).toBe('https://cdn.example.com/in.flac');
		expect(p.bytes).toBe(555);
	});

	it('re-resolves when the input is a lower tier than the wanted lossless download', async () => {
		mocks.settings.downloadQuality = 'lossless';
		mocks.ensureTrackDetails.mockResolvedValue(mk({ audioUrl: 'https://cdn.example.com/hi.flac' }));
		stubFetchSeq(resp({ headers: { 'content-length': '1' } }));

		await probeDownload(mk({ audioUrl: 'https://cdn.example.com/lo.mp3', quality: '320k' }));

		expect(mocks.ensureTrackDetails).toHaveBeenCalledTimes(1);
	});

	it('re-resolves when the input url is STALE even though it meets the tier', async () => {
		mocks.ensureTrackDetails.mockResolvedValue(mk({ audioUrl: 'https://cdn.example.com/fresh.flac' }));
		stubFetchSeq(resp({ headers: { 'content-length': '1' } }));

		await probeDownload(mk({ audioUrl: 'https://cdn.example.com/old.flac', resolvedAt: Date.now() - 60 * 60 * 1000 }));

		expect(mocks.ensureTrackDetails).toHaveBeenCalledTimes(1);
	});
});

describe('probeDownload — memo per uid|downloadQuality', () => {
	it('costs no network on a second call with the same key', async () => {
		mocks.ensureTrackDetails.mockResolvedValue(mk({ audioUrl: 'https://cdn.example.com/a.flac' }));
		const f = stubFetchSeq(resp({ headers: { 'content-length': '40055930', 'content-type': 'audio/flac' } }));

		const first = await probeDownload(mk({ audioUrl: null, detailsLoaded: false }));
		const second = await probeDownload(mk({ audioUrl: null, detailsLoaded: false }));

		expect(second).toEqual(first);
		expect(mocks.ensureTrackDetails).toHaveBeenCalledTimes(1);
		expect(f).toHaveBeenCalledTimes(1);
	});

	it('treats a different downloadQuality as a different key', async () => {
		mocks.ensureTrackDetails.mockResolvedValue(mk({ audioUrl: 'https://cdn.example.com/a.flac' }));
		stubFetchSeq(resp({ headers: { 'content-length': '1000', 'content-type': 'audio/flac' } }));

		await probeDownload(mk({ audioUrl: null, detailsLoaded: false }));
		mocks.settings.downloadQuality = '320';
		await probeDownload(mk({ audioUrl: null, detailsLoaded: false }));

		expect(mocks.ensureTrackDetails).toHaveBeenCalledTimes(2);
	});

	it('does NOT memoise a total miss — reopening retries', async () => {
		mocks.ensureTrackDetails.mockResolvedValue(mk({ audioUrl: 'https://cdn.example.com/opaque' }));
		stubFetchSeq(new Error('blocked'));

		const first = await probeDownload(mk({ audioUrl: null, detailsLoaded: false }));
		expect(first.bytes).toBeNull();
		expect(first.container).toBeNull();

		await probeDownload(mk({ audioUrl: null, detailsLoaded: false }));
		expect(mocks.ensureTrackDetails).toHaveBeenCalledTimes(2);
	});
});

describe('probeDownload — abort', () => {
	it('returns the sentinel without resolving, fetching or memoising when the caller already aborted', async () => {
		mocks.ensureTrackDetails.mockResolvedValue(mk({ audioUrl: 'https://cdn.example.com/a.flac' }));
		const f = stubFetchSeq(resp({ headers: { 'content-length': '2048', 'content-type': 'audio/flac' } }));
		const ac = new AbortController();
		ac.abort();

		const aborted = await probeDownload(mk({ audioUrl: null, detailsLoaded: false }), ac.signal);

		expect(aborted).toEqual({ container: null, qualityLabel: null, bytes: null, track: null });
		expect(mocks.ensureTrackDetails).not.toHaveBeenCalled();
		expect(f).not.toHaveBeenCalled();

		// nothing was memoised — a later open of the same menu still does the work
		const ok = await probeDownload(mk({ audioUrl: null, detailsLoaded: false }));
		expect(ok.bytes).toBe(2048);
	});
});
