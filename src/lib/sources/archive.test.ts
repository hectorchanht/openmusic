import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { archive, archiveDownloadUrl } from './archive';
import type { Track } from './types';
import searchFixture from './__fixtures__/archive.search.json';

const ac = new AbortController();

// The fixture mirrors the /api/archive/search row shape, built from the real
// MoonlightSonata_755 advancedsearch + metadata captures (2026-10-20 probes).

/** A fetch mock that returns one JSON body for every call. */
function mockJsonFetch(body: unknown) {
	return vi.fn(async (_input: RequestInfo | URL, _init?: RequestInit) => {
		return new Response(JSON.stringify(body), {
			status: 200,
			headers: { 'content-type': 'application/json' }
		});
	});
}

function stubTrack(overrides: Partial<Track> = {}): Track {
	return {
		uid: 'archive:MoonlightSonata_755/Beethoven-MoonlightSonata.mp3',
		source: 'archive',
		songid: 'MoonlightSonata_755/Beethoven-MoonlightSonata.mp3',
		title: 'beethoven - moonlight sonata',
		artist: 'Beethoven',
		album: 'Moonlight Sonata - Beethoven',
		cover: 'https://archive.org/services/img/MoonlightSonata_755',
		audioUrl: null,
		lrc: null,
		lrcUrl: null,
		detailsLoaded: false,
		quality: null,
		qualityLabel: null,
		keyword: 'beethoven moonlight',
		displayIndex: 1,
		duration: 370,
		...overrides
	};
}

beforeEach(() => vi.restoreAllMocks());
afterEach(() => vi.restoreAllMocks());

describe('archive.search (fixture-backed)', () => {
	it('maps edge rows into canonical Track[] keyed archive:${identifier}/${file}', async () => {
		vi.stubGlobal('fetch', mockJsonFetch(searchFixture));
		const tracks = await archive.search('beethoven moonlight', 1, ac.signal);
		expect(tracks.length).toBe(searchFixture.rows.length);

		const t = tracks[0];
		const r = searchFixture.rows[0];
		expect(t.uid).toBe(`archive:${r.identifier}/${r.file}`);
		expect(t.songid).toBe(`${r.identifier}/${r.file}`);
		expect(t.title).toBe(r.title);
		expect(t.artist).toBe('Beethoven');
		expect(t.album).toBe(r.itemTitle);
		expect(t.cover).toBe(`https://archive.org/services/img/${r.identifier}`);
		expect(t.duration).toBe(r.lengthSec);
		expect(t.audioUrl).toBeNull();
		expect(t.detailsLoaded).toBe(false);
	});

	it('throws on contract drift (rows missing)', async () => {
		vi.stubGlobal('fetch', mockJsonFetch({ response: { docs: [] } }));
		await expect(archive.search('x', 1, ac.signal)).rejects.toThrow(/contract-drift/);
	});
});

describe('archive.resolve (deterministic URL — no network)', () => {
	it('builds the archive.org download URL from the composite songid', async () => {
		const fetchSpy = vi.fn();
		vi.stubGlobal('fetch', fetchSpy);
		const out = await archive.resolve(stubTrack(), ac.signal);
		expect(out.audioUrl).toBe(
			'https://archive.org/download/MoonlightSonata_755/Beethoven-MoonlightSonata.mp3'
		);
		expect(out.detailsLoaded).toBe(true);
		expect(out.lrc).toBeNull(); // archive has no lyrics — null cleanly
		expect(fetchSpy).not.toHaveBeenCalled();
	});

	it('labels FLAC files lossless via URL inference', async () => {
		const out = await archive.resolve(
			stubTrack({ songid: 'someItem/01-Allegro.flac' }),
			ac.signal
		);
		expect(out.quality).toBe('lossless');
		expect(out.qualityLabel).toBe('LOSSLESS');
	});

	it('splits the songid on the FIRST slash only (subdirectory files survive)', async () => {
		const out = await archive.resolve(stubTrack({ songid: 'itemX/disc1/02-Track.mp3' }), ac.signal);
		expect(out.audioUrl).toBe('https://archive.org/download/itemX/disc1/02-Track.mp3');
	});

	it('throws on a malformed songid', async () => {
		await expect(archive.resolve(stubTrack({ songid: 'noslash' }), ac.signal)).rejects.toThrow(
			/malformed songid/
		);
	});
});

describe('archiveDownloadUrl', () => {
	it('percent-encodes each path segment (spaces / CJK filenames)', () => {
		expect(archiveDownloadUrl('my item', 'my song #1.mp3')).toBe(
			'https://archive.org/download/my%20item/my%20song%20%231.mp3'
		);
	});
});

describe('archive registry posture', () => {
	it('is a legal-catalog source: enabledByDefault true, autoResolveEligible false', () => {
		expect(archive.enabledByDefault).toBe(true);
		expect(archive.autoResolveEligible).toBe(false);
	});
});
