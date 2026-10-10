import { describe, it, expect, vi, afterEach } from 'vitest';
import { GET } from './+server';

// quick-261009-ewf pins the recording-artists matching rule: the top recording must
// BOTH score >= 85 AND carry an artist-credit phrase that IS the queried artist string
// (canonicalKey equality) — a same-titled recording by a different act must never
// donate its credits. mbFetch is mocked; edgeCache() is null under node so the
// uncached logic path is exercised directly. NO live network.

vi.mock('$lib/proxy/musicbrainz-shared', async (importOriginal) => {
	const orig = await importOriginal<typeof import('$lib/proxy/musicbrainz-shared')>();
	return { ...orig, mbFetch: vi.fn() };
});

import { mbFetch } from '$lib/proxy/musicbrainz-shared';

const mockMbFetch = vi.mocked(mbFetch);

afterEach(() => {
	// mockReset (not restoreAllMocks): clears both the call history AND the
	// mockResolvedValue from the previous case, so each test starts clean.
	mockMbFetch.mockReset();
});

/** Minimal RequestEvent subset the GET handler reads. */
function event(title: string, artist: string): any {
	return {
		url: new URL(
			`http://localhost/api/musicbrainz/recording-artists?title=${encodeURIComponent(title)}&artist=${encodeURIComponent(artist)}`
		),
		request: { headers: { get: () => null } }
	};
}

const EWF_CREDIT = [
	{
		name: 'Earth, Wind & Fire',
		joinphrase: '',
		artist: { id: '535afeda-2538-435d-9dd1-5e10be586774' }
	}
];

describe('GET /api/musicbrainz/recording-artists', () => {
	it('returns the credits of a confident, phrase-matching hit', async () => {
		mockMbFetch.mockResolvedValue({
			recordings: [{ id: 'r1', score: 100, 'artist-credit': EWF_CREDIT }]
		});
		const res = await GET(event('September', 'Earth, Wind & Fire'));
		expect(await res.json()).toEqual({
			artists: [
				{
					name: 'Earth, Wind & Fire',
					mbid: '535afeda-2538-435d-9dd1-5e10be586774',
					joinphrase: ''
				}
			]
		});
		// The query searches the RECORDING by title AND artist.
		const upstream = String(mockMbFetch.mock.calls[0][0]);
		expect(upstream).toContain('/recording/?query=');
		expect(decodeURIComponent(upstream)).toContain('recording:"September"');
		expect(decodeURIComponent(upstream)).toContain('artist:"Earth, Wind & Fire"');
	});

	it('skips a low-score hit and takes the next confident one', async () => {
		mockMbFetch.mockResolvedValue({
			recordings: [
				{ id: 'r1', score: 40, 'artist-credit': EWF_CREDIT },
				{ id: 'r2', score: 95, 'artist-credit': EWF_CREDIT }
			]
		});
		const res = await GET(event('September', 'Earth, Wind & Fire'));
		const body = (await res.json()) as { artists: { name: string }[] };
		expect(body.artists).toHaveLength(1);
		expect(body.artists[0].name).toBe('Earth, Wind & Fire');
	});

	it('rejects a high-score hit whose credits are a DIFFERENT act', async () => {
		mockMbFetch.mockResolvedValue({
			recordings: [
				{
					id: 'r1',
					score: 100,
					'artist-credit': [{ name: 'Someone Else', joinphrase: '', artist: { id: 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee' } }]
				}
			]
		});
		const res = await GET(event('September', 'Earth, Wind & Fire'));
		expect(await res.json()).toEqual({ artists: [] });
	});

	it('returns every credit of a multi-artist recording', async () => {
		mockMbFetch.mockResolvedValue({
			recordings: [
				{
					id: 'r1',
					score: 100,
					'artist-credit': [
						{ name: 'A', joinphrase: ' & ', artist: { id: 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee' } },
						{ name: 'B', joinphrase: '', artist: { id: 'bbbbbbbb-cccc-dddd-eeee-ffffffffffff' } }
					]
				}
			]
		});
		const res = await GET(event('Duet Song', 'A & B'));
		expect(await res.json()).toEqual({
			artists: [
				{ name: 'A', mbid: 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee', joinphrase: ' & ' },
				{ name: 'B', mbid: 'bbbbbbbb-cccc-dddd-eeee-ffffffffffff', joinphrase: '' }
			]
		});
	});

	it('returns empty when MusicBrainz answers nothing (never-throw)', async () => {
		mockMbFetch.mockResolvedValue(null);
		const res = await GET(event('September', 'Earth, Wind & Fire'));
		expect(await res.json()).toEqual({ artists: [] });
	});

	it('returns empty without calling upstream when title or artist is missing', async () => {
		const res = await GET(event('', 'Earth, Wind & Fire'));
		expect(await res.json()).toEqual({ artists: [] });
		expect(mockMbFetch).not.toHaveBeenCalled();
	});
});
