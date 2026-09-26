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
// 34-D-06: blobStore is mocked so "setDownloads never deletes a file" is a direct assertion rather
// than an inference, and removeDownload's existing del() never reaches real IDB/Capacitor here.
const { blobDel } = vi.hoisted(() => ({ blobDel: vi.fn(async () => {}) }));
vi.mock('$lib/services/blob-store', () => ({ blobStore: { del: blobDel } }));
import { library } from './library.svelte';
import { warmScript } from '$lib/services/zh-convert';
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

// 34-D-06: a device: entry whose file was missing at last play is MARKED, not removed — the user
// sees why it will not play and can re-import (D-08: removal only ever inside an explicit import).
// setDownloads is that import's single wholesale write: add / drop / refresh in one persisted pass.
describe('34-D-06 unavailable + setDownloads', () => {
	beforeEach(() => {
		library.downloads = [];
		library.liked = [];
		library.playlists = [];
		library.favArtists = [];
		library.unavailable = new Set();
		memStore.clear();
	});

	const payload = () =>
		JSON.parse(localStorage.getItem('openmusic:library:v1') as string) as Record<string, unknown>;

	it('markUnavailable marks exactly one uid, and an empty uid is a no-op', () => {
		library.markUnavailable('device:42');
		expect(library.isUnavailable('device:42')).toBe(true);
		expect(library.isUnavailable('device:43')).toBe(false);

		library.markUnavailable('');
		expect(library.unavailable.size).toBe(1);
	});

	it('reassigns a NEW Set reference (copy-on-write, like beginDownload) so runes re-render', () => {
		const before = library.unavailable;
		library.markUnavailable('device:42');
		expect(library.unavailable).not.toBe(before);
	});

	it('is PERSISTED — unlike downloading/downloadProgress, a missing file is still missing after relaunch', () => {
		library.markUnavailable('device:42');
		expect(payload().unavailable).toEqual(['device:42']);
	});

	it('load() of an OLD payload with no `unavailable` key yields an empty Set (tolerant migration)', () => {
		memStore.set(
			'openmusic:library:v1',
			JSON.stringify({ liked: [], playlists: [], downloads: [mk({ uid: 'device:42' })] })
		);
		(library as unknown as { loaded: boolean }).loaded = false;
		library.load();
		expect(library.unavailable.size).toBe(0);
		expect(library.downloads).toHaveLength(1);
	});

	it('load() restores a persisted unavailable list', () => {
		memStore.set(
			'openmusic:library:v1',
			JSON.stringify({ liked: [], playlists: [], downloads: [], unavailable: ['device:42'] })
		);
		(library as unknown as { loaded: boolean }).loaded = false;
		library.load();
		expect(library.isUnavailable('device:42')).toBe(true);
	});

	it('clearUnavailable(uid) clears one and persists; clearUnavailable() clears ALL', () => {
		library.markUnavailable('device:42');
		library.markUnavailable('device:43');

		library.clearUnavailable('device:42');
		expect(library.isUnavailable('device:42')).toBe(false);
		expect(library.isUnavailable('device:43')).toBe(true);
		expect(payload().unavailable).toEqual(['device:43']);

		library.clearUnavailable();
		expect(library.unavailable.size).toBe(0);
		expect(payload().unavailable).toEqual([]);
	});

	it('setDownloads replaces the list wholesale, order preserved, and persists', () => {
		library.downloads = [mk({ uid: 'device:1' })];
		const next = [mk({ uid: 'device:2' }), mk({ uid: 'kuwo:7', source: 'kuwo' })];

		library.setDownloads(next);

		expect(library.downloads.map((t) => t.uid)).toEqual(['device:2', 'kuwo:7']);
		expect((payload().downloads as Track[]).map((t) => t.uid)).toEqual(['device:2', 'kuwo:7']);
	});

	it('setDownloads prunes `unavailable` to uids still present in the new list', () => {
		library.markUnavailable('device:1'); // dropped by this import → mark goes with it
		library.markUnavailable('device:2'); // still listed → stays marked

		library.setDownloads([mk({ uid: 'device:2' })]);

		expect(library.isUnavailable('device:1')).toBe(false);
		expect(library.isUnavailable('device:2')).toBe(true);
		expect(payload().unavailable).toEqual(['device:2']);
	});

	it('setDownloads NEVER deletes a file — the import drop lane has nothing to delete', () => {
		library.downloads = [mk({ uid: 'device:1' })];
		library.setDownloads([]);
		expect(blobDel).not.toHaveBeenCalled();
	});

	it('removeDownload on a device uid still removes the row (explicit user removal) and clears its mark', () => {
		library.downloads = [mk({ uid: 'device:42' })];
		library.markUnavailable('device:42');

		library.removeDownload('device:42');

		expect(library.isDownloaded('device:42')).toBe(false);
		expect(library.isUnavailable('device:42')).toBe(false);
		// The FILE is protected downstream: blobStore.del refuses device uids (Plan 34-01).
		expect(blobDel).toHaveBeenCalledWith('device:42');
	});

	it('clearAll also empties unavailable', () => {
		library.markUnavailable('device:42');
		library.clearAll();
		expect(library.unavailable.size).toBe(0);
	});
});

// quick-260915-vb9: the Library page's per-tab "Clear all" row needs a per-LIST wipe. The naive
// implementation (loop removeLiked/removeDownload) re-serialises the WHOLE library payload once per
// track — 300 downloads = 300 localStorage writes on a phone. These specs pin the contract: one
// persisted save per clear, only the targeted list emptied, and (downloads only) one blob delete per
// former uid so the offline cache does not outlive the registry.
describe('quick-260915-vb9 per-list clears', () => {
	beforeEach(() => {
		library.liked = [];
		library.downloads = [];
		library.playlists = [];
		library.favArtists = [];
		library.unavailable = new Set();
		memStore.clear();
		blobDel.mockClear();
	});

	const payload = () =>
		JSON.parse(localStorage.getItem('openmusic:library:v1') as string) as Record<string, unknown>;

	it('clearLiked empties liked only and persists', () => {
		library.liked = [mk({ uid: 'netease-1' }), mk({ uid: 'qq-9', source: 'qq' })];
		library.downloads = [mk({ uid: 'kuwo-7', source: 'kuwo' })];
		library.favArtists = ['G.E.M. 邓紫棋'];
		library.playlists = [{ id: 'pl_x', name: 'mix', tracks: [mk({ uid: 'netease-1' })] }];

		library.clearLiked();

		expect(library.liked).toEqual([]);
		expect(payload().liked).toEqual([]);
		expect(library.downloads).toHaveLength(1);
		expect(library.favArtists).toEqual(['G.E.M. 邓紫棋']);
		expect(library.playlists[0].tracks).toHaveLength(1);
	});

	it('clearDownloads empties downloads + marks, deletes every blob, and saves EXACTLY once', () => {
		library.downloads = [mk({ uid: 'kuwo:7', source: 'kuwo' }), mk({ uid: 'device:42' })];
		library.liked = [mk({ uid: 'netease-1' })];
		library.unavailable = new Set(['device:42']);
		const setItem = vi.spyOn(localStorage, 'setItem');

		library.clearDownloads();

		expect(library.downloads).toEqual([]);
		expect(library.unavailable.size).toBe(0);
		expect(payload().downloads).toEqual([]);
		expect(payload().unavailable).toEqual([]);
		// The LIKED list must survive a downloads-only clear.
		expect(library.liked).toHaveLength(1);
		// One write for the whole clear — not one per track.
		expect(setItem).toHaveBeenCalledTimes(1);
		// Per-uid delete so blobStore.del's device: refusal (Plan 34-01) still protects imports.
		expect(blobDel).toHaveBeenCalledTimes(2);
		expect(blobDel).toHaveBeenCalledWith('kuwo:7');
		expect(blobDel).toHaveBeenCalledWith('device:42');
		setItem.mockRestore();
	});

	it('clearFavArtists empties favArtists only and persists', () => {
		library.favArtists = ['a', 'b'];
		library.liked = [mk({ uid: 'netease-1' })];

		library.clearFavArtists();

		expect(library.favArtists).toEqual([]);
		expect(payload().favArtists).toEqual([]);
		expect(library.liked).toHaveLength(1);
	});

	it('clearPlaylistTracks empties ONE playlist, keeps its identity, leaves siblings alone', () => {
		library.playlists = [
			{ id: 'pl_a', name: 'mix', tracks: [mk({ uid: 'netease-1' }), mk({ uid: 'qq-9', source: 'qq' })] },
			{ id: 'pl_b', name: 'other', tracks: [mk({ uid: 'kuwo-7', source: 'kuwo' })] }
		];

		library.clearPlaylistTracks('pl_a');

		expect(library.playlists[0]).toMatchObject({ id: 'pl_a', name: 'mix', tracks: [] });
		expect(library.playlists[1].tracks).toHaveLength(1);
		expect((payload().playlists as { tracks: unknown[] }[])[0].tracks).toEqual([]);
	});

	it('clearPlaylistTracks on an unknown id is a harmless no-op', () => {
		library.playlists = [{ id: 'pl_a', name: 'mix', tracks: [mk({ uid: 'netease-1' })] }];

		expect(() => library.clearPlaylistTracks('nope')).not.toThrow();
		expect(library.playlists[0].tracks).toHaveLength(1);
	});
});

// like-state-wrong-track-menu: a uid-less name-stub (home / charts DiscoveryTrack → uid:'') must never
// enter the liked list, and an already-poisoned store must stop reporting every stub as "Liked".
describe('like-state-wrong-track-menu: uid-less tracks cannot be liked or read as liked', () => {
	beforeEach(() => {
		library.liked = [];
		memStore.clear();
	});

	it('isLiked("") is false even when a poisoned uid:"" entry is present', () => {
		library.liked = [mk({ uid: '' })];
		expect(library.isLiked('')).toBe(false);
		expect(library.isLiked('netease:1')).toBe(false);
	});

	it('toggleLike on a uid-less stub is a no-op and persists nothing', () => {
		library.toggleLike(mk({ uid: '' }));
		expect(library.liked).toHaveLength(0);
		expect(memStore.has('openmusic:library:v1')).toBe(false);
	});

	it('load() prunes uid-less entries from an already-poisoned store, keeps real ones', () => {
		memStore.set(
			'openmusic:library:v1',
			JSON.stringify({ liked: [mk({ uid: '' }), mk({ uid: 'kuwo:7' })], playlists: [], downloads: [] })
		);
		(library as unknown as { loaded: boolean }).loaded = false;
		library.load();
		expect(library.liked.map((t) => t.uid)).toEqual(['kuwo:7']);
		expect(library.isLiked('kuwo:7')).toBe(true);
	});
});

// quick-260919-1eh — library.applyMetadata: the metadata editor's list-row repaint seam.
// Same in-place discipline as adoptCover (home shelves hold snapshot references), but matched on
// uid ONLY: adoptCover's matchKey widening exists to FILL an empty cover across duplicate
// identities, whereas a name edit is a single-identity user action that must not rewrite a
// same-named row belonging to another source.
describe('library.applyMetadata (quick-260919-1eh)', () => {
	beforeEach(() => {
		library.liked = [];
		library.downloads = [];
		library.playlists = [];
		memStore.clear();
	});

	it('updates the matching entry in downloads, liked and every playlist — same object references', () => {
		library.liked = [mk({ uid: 'netease-1' }), mk({ uid: 'qq-9', source: 'qq' })];
		library.downloads = [mk({ uid: 'netease-1' })];
		library.playlists = [
			{ id: 'pl_x', name: 'mix', tracks: [mk({ uid: 'netease-1' }), mk({ uid: 'kuwo-7' })] }
		];
		// A reference captured BEFORE the call must read the new title — this is the whole point of
		// mutating the proxy instead of rebuilding it.
		const captured = library.liked[0];

		library.applyMetadata('netease-1', { title: 'Edited', artist: 'Edited Artist', album: 'Edited Album' });

		expect(captured.title).toBe('Edited');
		expect(library.liked[0].artist).toBe('Edited Artist');
		expect(library.downloads[0].title).toBe('Edited');
		expect(library.downloads[0].album).toBe('Edited Album');
		expect(library.playlists[0].tracks[0].title).toBe('Edited');
	});

	it('matches uid ONLY — a same-named row from another source is left alone', () => {
		library.liked = [mk({ uid: 'netease-1' }), mk({ uid: 'qq-9', source: 'qq' })];

		library.applyMetadata('netease-1', { title: 'Edited' });

		expect(library.liked[0].title).toBe('Edited');
		expect(library.liked[1].title).toBe('多远都要在一起'); // same song, different uid — untouched
	});

	it('an absent or empty field leaves that field untouched (D-4: blank means keep)', () => {
		library.liked = [mk({ uid: 'netease-1', album: 'Original Album' })];

		library.applyMetadata('netease-1', { title: 'Edited', artist: '  ', album: '' });

		expect(library.liked[0].title).toBe('Edited');
		expect(library.liked[0].artist).toBe('G.E.M. 邓紫棋');
		expect(library.liked[0].album).toBe('Original Album');
	});

	it('an unknown uid changes nothing and does not persist', () => {
		library.liked = [mk({ uid: 'netease-1' })];
		memStore.clear();

		library.applyMetadata('netease-999', { title: 'Nope' });

		expect(library.liked[0].title).toBe('多远都要在一起');
		expect(memStore.get('openmusic:library:v1')).toBeUndefined(); // save() never ran
	});

	it('a real change DOES persist', () => {
		library.liked = [mk({ uid: 'netease-1' })];
		memStore.clear();

		library.applyMetadata('netease-1', { title: 'Edited' });

		expect(memStore.get('openmusic:library:v1')).toContain('Edited');
	});
});

// quick-260919-vrq: the TrackMenu "Remove download" sheet lets the user KEEP the offline copy while
// still dropping the library row, so removeDownload grew a `{ deleteFile }` opt-out. Two directions,
// two specs: the default must stay byte-for-byte today's behaviour (every existing caller passes no
// options), and the opt-out must drop the row WITHOUT ever reaching blobStore.del.
describe('quick-260919-vrq removeDownload { deleteFile } opt-out', () => {
	beforeEach(() => {
		library.downloads = [];
		library.unavailable = new Set();
		memStore.clear();
		blobDel.mockClear();
	});

	const payload = () =>
		JSON.parse(localStorage.getItem('openmusic:library:v1') as string) as Record<string, unknown>;

	it('default (no options) drops the row, clears the mark, and deletes the blob', () => {
		library.downloads = [mk({ uid: 'kuwo:9', source: 'kuwo' })];
		library.markUnavailable('kuwo:9');

		library.removeDownload('kuwo:9');

		expect(library.isDownloaded('kuwo:9')).toBe(false);
		expect(library.isUnavailable('kuwo:9')).toBe(false);
		expect(blobDel).toHaveBeenCalledWith('kuwo:9');
	});

	it('deleteFile: false drops the row and the mark but NEVER touches the offline copy', () => {
		library.downloads = [mk({ uid: 'kuwo:10', source: 'kuwo' })];
		library.markUnavailable('kuwo:10');
		blobDel.mockClear();

		library.removeDownload('kuwo:10', { deleteFile: false });

		expect(library.isDownloaded('kuwo:10')).toBe(false);
		expect(library.isUnavailable('kuwo:10')).toBe(false);
		expect((payload().downloads as { uid: string }[]).some((t) => t.uid === 'kuwo:10')).toBe(false);
		expect(blobDel).not.toHaveBeenCalled();
	});
});

// quick-260926-hl9: artist URLs follow the script lock, so the same artist can arrive as 周杰伦 or
// 周杰倫 — the favourite key folds Chinese to Simplified so the heart never splits them in two.
describe('quick-260926-hl9 script-blind favArtists', () => {
	beforeEach(() => {
		library.favArtists = [];
		memStore.clear();
	});

	it('a favourite saved in one script matches, and un-favourites, in the other', async () => {
		await warmScript('zh-Hans');
		library.toggleFavArtist('周杰伦');
		expect(library.isFavArtist('周杰倫')).toBe(true);
		expect(library.isFavArtist('周杰伦')).toBe(true);
		library.toggleFavArtist('周杰倫');
		expect(library.favArtists).toEqual([]);
	});

	it('Latin names keep the trim/lowercase fold and their saved case', () => {
		library.toggleFavArtist('Daft Punk');
		expect(library.isFavArtist('  daft punk  ')).toBe(true);
		expect(library.favArtists).toEqual(['Daft Punk']);
	});
});

// quick-260926-hze: the favourite fold warms ITSELF, lock-independent. Each test gets a FRESH
// library + zh-convert pair (resetModules) so t2s starts COLD, which is the lock-OFF world the
// hl9 fold could not see into. The top-level $app/environment / blob-store mocks and the stubbed
// localStorage persist across the reset.
describe('quick-260926-hze self-warming favourite fold', () => {
	type Fresh = typeof import('./library.svelte');
	const rev = (lib: Fresh['library']) => (lib as unknown as { foldRev: number }).foldRev;

	beforeEach(() => {
		vi.resetModules();
		memStore.clear();
	});

	it('a Traditional favourite matches its Simplified form once the fold dict lands', async () => {
		memStore.set('openmusic:library:v1', JSON.stringify({ favArtists: ['周杰倫'] }));
		const { library: fresh } = await import('./library.svelte');
		const zh = await import('$lib/services/zh-convert');
		fresh.load();
		expect(fresh.isFavArtist('周杰倫')).toBe(true);
		expect(fresh.isFavArtist('周杰伦')).toBe(false); // cold precondition: the test is not vacuous
		await zh.warmScript('zh-Hans');
		await vi.waitFor(() => expect(rev(fresh)).toBe(1));
		expect(fresh.isFavArtist('周杰伦')).toBe(true);
	});

	it('a Latin-only library never warms the dict', async () => {
		memStore.set('openmusic:library:v1', JSON.stringify({ favArtists: ['Daft Punk'] }));
		const { library: fresh } = await import('./library.svelte');
		fresh.load();
		await Promise.resolve();
		await Promise.resolve();
		expect(rev(fresh)).toBe(0);
	});

	it('favouriting a Chinese name also warms the fold', async () => {
		const { library: fresh } = await import('./library.svelte');
		const zh = await import('$lib/services/zh-convert');
		fresh.load();
		fresh.toggleFavArtist('周杰倫');
		await zh.warmScript('zh-Hans');
		await vi.waitFor(() => expect(rev(fresh)).toBe(1));
	});
});
