// Cover-chain (library.adoptCover) — a cover fetched once at play time must be shared
// with every same-song library entry (uid OR normalized {artist,title} identity match),
// without churning entries that already carry art.
// Plus: library.downloading (D-10) — the reactive per-uid in-flight download set.
import { beforeEach, describe, expect, it, vi } from 'vitest';
// DL-STATE-01: the `downloading` transient set test asserts it is NEVER persisted, which
// needs a real save() path — so flip browser ON + back it with an in-memory localStorage
// (mirrors player.svelte.test.ts). The cover-chain tests are unaffected (they never assert
// on localStorage; save()/setCachedCover just write to the stub).
vi.mock('$app/environment', () => ({ browser: true }));
import { library } from './library.svelte';
import type { Track } from '$lib/sources/types';

const memStore = new Map<string, string>();
const localStorageMock: Storage = {
	get length() {
		return memStore.size;
	},
	clear: () => memStore.clear(),
	getItem: (k: string) => (memStore.has(k) ? (memStore.get(k) as string) : null),
	key: (i: number) => Array.from(memStore.keys())[i] ?? null,
	removeItem: (k: string) => void memStore.delete(k),
	setItem: (k: string, v: string) => void memStore.set(k, String(v))
};
vi.stubGlobal('localStorage', localStorageMock);

const mk = (over: Partial<Track>): Track =>
	({
		uid: 'netease-1',
		source: 'netease',
		id: '1',
		title: '多远都要在一起',
		artist: 'G.E.M. 邓紫棋',
		album: '',
		cover: null,
		audioUrl: null,
		detailsLoaded: false,
		...over
	}) as Track;

describe('library.adoptCover (cover-chain)', () => {
	it('fills empty covers on same-uid and same-{artist,title} entries across liked/downloads/playlists', () => {
		library.liked = [
			mk({ uid: 'netease-1' }), // same uid, no cover → fill
			mk({ uid: 'qq-9', source: 'qq' }), // different uid, same song → fill
			mk({ uid: 'kuwo-7', title: '光年之外', cover: null }) // different song → untouched
		];
		library.downloads = [mk({ uid: 'joox-3', source: 'joox' })]; // same song → fill
		library.playlists = [
			{ id: 'pl_x', name: 'mix', tracks: [mk({ uid: 'netease-1' }), mk({ uid: 'kuwo-7', title: '光年之外' })] }
		];

		library.adoptCover(mk({ uid: 'netease-1', cover: 'https://img/cover.jpg' }));

		expect(library.liked[0].cover).toBe('https://img/cover.jpg');
		expect(library.liked[1].cover).toBe('https://img/cover.jpg');
		expect(library.liked[2].cover).toBeNull();
		expect(library.downloads[0].cover).toBe('https://img/cover.jpg');
		expect(library.playlists[0].tracks[0].cover).toBe('https://img/cover.jpg');
		expect(library.playlists[0].tracks[1].cover).toBeNull();
	});

	it('never overwrites an existing cover and no-ops on a coverless source track', () => {
		library.liked = [mk({ uid: 'netease-1', cover: 'https://img/original.jpg' })];
		const before = library.liked[0];

		library.adoptCover(mk({ uid: 'netease-1', cover: 'https://img/other.jpg' }));
		expect(library.liked[0].cover).toBe('https://img/original.jpg');
		expect(library.liked[0]).toBe(before); // untouched reference — no churn

		library.adoptCover(mk({ uid: 'netease-1', cover: null }));
		expect(library.liked[0].cover).toBe('https://img/original.jpg');
	});

	it('matches identity case/whitespace-insensitively via matchKey', () => {
		library.liked = [mk({ uid: 'qq-2', artist: ' g.e.m. 邓紫棋 ', title: '多远都要在一起' })];
		library.adoptCover(mk({ uid: 'netease-1', cover: 'https://img/c.jpg' }));
		expect(library.liked[0].cover).toBe('https://img/c.jpg');
	});
});

// D-10 / DL-STATE-01: a single reactive per-uid in-flight set on the library store — the
// source of truth every download affordance reads (D-18: kept OFF the player). begin/end
// reassign a NEW Set each time (same idiom as TrackMenu `inFlight`) so runes re-render, and
// one uid's transition never touches another's. It is transient — never persisted.
describe('library.downloading (per-uid in-flight set, D-10)', () => {
	beforeEach(() => {
		library.downloading = new Set();
		library.downloads = [];
		library.liked = [];
		library.playlists = [];
		memStore.clear();
	});

	it('beginDownload adds the uid and reassigns a NEW Set reference (stays reactive)', () => {
		const before = library.downloading;
		library.beginDownload('netease-1');
		expect(library.downloading.has('netease-1')).toBe(true);
		expect(library.downloading).not.toBe(before); // reassigned, not mutated in place
	});

	it('tracks multiple uids; endDownload clears only its own uid (never another)', () => {
		library.beginDownload('netease-1');
		library.beginDownload('qq-2');
		expect(library.downloading.has('netease-1')).toBe(true);
		expect(library.downloading.has('qq-2')).toBe(true);

		library.endDownload('netease-1');
		expect(library.downloading.has('netease-1')).toBe(false);
		expect(library.downloading.has('qq-2')).toBe(true); // isolation: qq-2 untouched
	});

	it('endDownload on an absent uid is a no-op and does not throw', () => {
		library.beginDownload('netease-1');
		expect(() => library.endDownload('kuwo-9')).not.toThrow();
		expect(library.downloading.has('netease-1')).toBe(true);
		expect(library.downloading.size).toBe(1);
	});

	it('is transient — never written to the persisted localStorage payload', () => {
		library.beginDownload('netease-1');
		library.addDownload(mk({ uid: 'netease-1' })); // a persisting write happens WHILE in-flight
		const raw = localStorage.getItem('openmusic:library:v1');
		expect(raw).toBeTruthy();
		const payload = JSON.parse(raw as string) as Record<string, unknown>;
		expect('downloading' in payload).toBe(false);
	});
});
