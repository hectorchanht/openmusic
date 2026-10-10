import { describe, it, expect, vi, afterEach } from 'vitest';
import { resolveArtistNames, __clearArtistNamesMemo } from './artist-names';

// quick-261009-ewf pins the "find out the artist name(s) in smart ways" layers:
//   1. no connectors → splitArtists result, NO fetch at all (fast path)
//   2. full string is a legal artist/group (MusicBrainz identity name-equality)
//      → the whole string stays ONE name
//   3. otherwise the RECORDING's own artist credits decide (title + artist search):
//      mangled variants resolve to the canonical credit, real multi-artist
//      recordings keep every credit, mislabeled metadata gets corrected
//   4. miss / different-name hit / non-ok / fetch-throws → splitArtists fallback
//   - the lookups are memoized per raw string + title (no second fetch on replay)
// All node-runnable via vi.stubGlobal('fetch', ...) — NO live network.

afterEach(() => {
	vi.restoreAllMocks();
	vi.unstubAllGlobals();
	__clearArtistNamesMemo();
});

/** A minimal `Response`-like ok JSON stub. */
function jsonResponse(body: unknown, ok = true): Response {
	return { ok, status: ok ? 200 : 500, json: async () => body } as unknown as Response;
}

const EMPTY_IDENTITY = { mbid: null, name: null, country: null, names: {} };
const EMPTY_RECORDING = { artists: [] };

const EWF_IDENTITY = {
	mbid: '535afeda-2538-435d-9dd1-5e10be586774',
	name: 'Earth, Wind & Fire',
	country: 'US',
	names: {}
};

const EWF_RECORDING = {
	artists: [{ name: 'Earth, Wind & Fire', mbid: '535afeda-2538-435d-9dd1-5e10be586774', joinphrase: '' }]
};

/**
 * Route-aware fetch stub: identity endpoint and recording-artists endpoint answer
 * independently, so each layer's behavior is pinned in isolation.
 */
function stubFetch(identity: unknown = EMPTY_IDENTITY, recording: unknown = EMPTY_RECORDING) {
	const fetchMock = vi.fn(async (url: string) =>
		jsonResponse(url.includes('/recording-artists') ? recording : identity)
	);
	vi.stubGlobal('fetch', fetchMock);
	return fetchMock;
}

describe('resolveArtistNames', () => {
	it('does NOT fetch when the string has no connectors (fast path)', async () => {
		const fetchMock = stubFetch(EWF_IDENTITY, EWF_RECORDING);
		expect(await resolveArtistNames('Solo Artist', 'Some Title')).toEqual(['Solo Artist']);
		expect(fetchMock).not.toHaveBeenCalled();
	});

	it('keeps the full string whole when MusicBrainz knows it as one artist', async () => {
		const fetchMock = stubFetch(EWF_IDENTITY, EWF_RECORDING);
		expect(await resolveArtistNames('Earth, Wind & Fire', 'September')).toEqual([
			'Earth, Wind & Fire'
		]);
		// The identity lookup queries the FULL string, not the split parts.
		const identityUrl = String(fetchMock.mock.calls[0][0]);
		expect(identityUrl).toContain('/api/musicbrainz/artist?');
		expect(identityUrl).toContain(encodeURIComponent('Earth, Wind & Fire'));
	});

	it('tolerates punctuation/spacing drift between metadata and MusicBrainz', async () => {
		stubFetch(EWF_IDENTITY);
		expect(await resolveArtistNames('Earth,Wind&Fire', 'September')).toEqual(['Earth,Wind&Fire']);
	});

	it('identity tolerates the word "and" vs "&" (keeps the raw spelling whole)', async () => {
		// "Earth Wind and Fire" is not the canonical spelling, but canonicalKey sees
		// through it — the string is kept whole AS WRITTEN (metadata is never rewritten).
		stubFetch(EWF_IDENTITY, EWF_RECORDING);
		expect(await resolveArtistNames('Earth Wind and Fire', 'September')).toEqual([
			'Earth Wind and Fire'
		]);
	});

	it('uses the recording credits when the full string is NOT a known artist', async () => {
		// Mislabeled metadata: the source lists a composer in the artist field, but the
		// recording's own credits say it is a solo performance.
		stubFetch(EMPTY_IDENTITY, {
			artists: [{ name: 'Solo Star', mbid: 'id-solo', joinphrase: '' }]
		});
		expect(await resolveArtistNames('Solo Star, Composer X', 'Lone Song')).toEqual(['Solo Star']);
	});

	it('keeps every credit of a real multi-artist recording', async () => {
		stubFetch(EMPTY_IDENTITY, {
			artists: [
				{ name: 'A', mbid: 'id-a', joinphrase: ' & ' },
				{ name: 'B', mbid: 'id-b', joinphrase: '' }
			]
		});
		expect(await resolveArtistNames('A & B', 'Duet Song')).toEqual(['A', 'B']);
	});

	it('does NOT call the recording endpoint when there is no title', async () => {
		const fetchMock = stubFetch(EMPTY_IDENTITY, EWF_RECORDING);
		expect(await resolveArtistNames('A & B')).toEqual(['A', 'B']);
		expect(fetchMock.mock.calls.every(([u]) => !String(u).includes('/recording-artists'))).toBe(
			true
		);
	});

	it('splits when MusicBrainz returns a DIFFERENT artist than the full string', async () => {
		stubFetch(
			{ mbid: 'some-id', name: 'Earth', country: 'US', names: {} },
			EMPTY_RECORDING
		);
		expect(await resolveArtistNames('Earth, Wind & Fire', 'September')).toEqual([
			'Earth',
			'Wind',
			'Fire'
		]);
	});

	it('splits on a MusicBrainz miss (empty identity + empty recording)', async () => {
		stubFetch();
		expect(await resolveArtistNames('A & B', 'Unknown Song')).toEqual(['A', 'B']);
	});

	it('splits on a non-ok response (never-throw)', async () => {
		vi.stubGlobal('fetch', vi.fn(async () => jsonResponse(null, false)));
		expect(await resolveArtistNames('A & B', 'Unknown Song')).toEqual(['A', 'B']);
	});

	it('splits when fetch throws (never-throw)', async () => {
		vi.stubGlobal(
			'fetch',
			vi.fn(async () => {
				throw new Error('network down');
			})
		);
		expect(await resolveArtistNames('A & B', 'Unknown Song')).toEqual(['A', 'B']);
	});

	it('memoizes per raw string + title: a replay does not fetch again', async () => {
		const fetchMock = stubFetch(EWF_IDENTITY, EWF_RECORDING);
		expect(await resolveArtistNames('Earth, Wind & Fire', 'September')).toEqual([
			'Earth, Wind & Fire'
		]);
		expect(await resolveArtistNames('Earth, Wind & Fire', 'September')).toEqual([
			'Earth, Wind & Fire'
		]);
		expect(fetchMock).toHaveBeenCalledTimes(1);
	});

	it('keeps AC/DC whole when MusicBrainz knows the band (slash heuristic superseded)', async () => {
		stubFetch({ mbid: 'band-id', name: 'AC/DC', country: 'AU', names: {} });
		expect(await resolveArtistNames('AC/DC', 'Back in Black')).toEqual(['AC/DC']);
	});
});
