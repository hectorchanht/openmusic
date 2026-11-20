// analytics client tests — the wire contract under the totals-only data
// doctrine (quick-261118-datadoctrine): every ping carries ONLY the song's
// content fields (song_id, title, artist, source — plus action for likes).
// No anon_id is generated or stored, no platform/locale/version rides along,
// no credentials are attached, and download quality/bytes never leave the
// device. fetch and localStorage are stubbed in-memory; nothing here touches
// the network.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { trackDownload, trackLike, trackPlayStart } from './analytics';

const TRACK = { uid: 'qq:123', title: 'T', artist: 'A', source: 'qq' } as const;

let fetchMock: ReturnType<typeof vi.fn>;
let store: Map<string, string>;

beforeEach(() => {
	fetchMock = vi.fn(async () => ({ ok: true }));
	vi.stubGlobal('fetch', fetchMock);
	store = new Map();
	vi.stubGlobal('localStorage', {
		getItem: (k: string) => store.get(k) ?? null,
		setItem: (k: string, v: string) => void store.set(k, v),
		removeItem: (k: string) => void store.delete(k)
	});
});

afterEach(() => {
	vi.unstubAllGlobals();
});

function lastCall() {
	expect(fetchMock).toHaveBeenCalledTimes(1);
	const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
	return { url, init, body: JSON.parse(init.body as string) as Record<string, unknown> };
}

describe('analytics client — totals-only wire contract', () => {
	it('trackPlayStart posts exactly the four content fields to /api/analytics/play', () => {
		trackPlayStart(TRACK);
		const { url, init, body } = lastCall();
		expect(url).toBe('/api/analytics/play');
		expect(init.method).toBe('POST');
		expect(init.keepalive).toBe(true);
		expect(body).toEqual({ song_id: 'qq:123', title: 'T', artist: 'A', source: 'qq' });
	});

	it('trackLike adds only the action — and sends no credentials', () => {
		trackLike(TRACK, 'unlike');
		const { url, init, body } = lastCall();
		expect(url).toBe('/api/analytics/like');
		expect(body).toEqual({ song_id: 'qq:123', title: 'T', artist: 'A', source: 'qq', action: 'unlike' });
		expect(init.credentials).toBeUndefined();
	});

	it('trackDownload does not transmit quality or bytes', () => {
		trackDownload(TRACK, { quality: '320kbps', bytes: 10485760 });
		const { url, body } = lastCall();
		expect(url).toBe('/api/analytics/download');
		expect(body).toEqual({ song_id: 'qq:123', title: 'T', artist: 'A', source: 'qq' });
	});

	it('no ping creates or touches the retired anon-id storage key', () => {
		trackPlayStart(TRACK);
		trackLike(TRACK, 'like');
		trackDownload(TRACK);
		expect(store.has('openmusic_anon_id')).toBe(false);
		expect(store.size).toBe(0);
	});

	it('a rejected fetch is swallowed — analytics never throws into the app', async () => {
		fetchMock.mockRejectedValue(new Error('offline'));
		expect(() => trackPlayStart(TRACK)).not.toThrow();
		await Promise.resolve();
	});
});
