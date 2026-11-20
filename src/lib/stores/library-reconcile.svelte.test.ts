// quick-261119-reconcile — the DOWNLOAD BADGE RECONCILE pass (library.reconcileDownloads).
//
// THE GAP THIS LOCKS SHUT: `library.downloads` is a reference list and `isDownloaded` is
// index-only membership, so bytes that vanished OUTSIDE the app (public Music/OpenMusic copy
// deleted + private copy gone, storage eviction, corruption) left the ✓ standing until a
// play attempt failed. The reconcile probes every record with blobStore.has and marks the
// byte-missing ones `unavailable` (34-D-06 semantics: the record STAYS listed, the mark is
// honest, Heal repairs it) — never deleting a record, never marking on a thrown probe.
import { readFileSync } from 'node:fs';
import { beforeEach, describe, expect, it, vi } from 'vitest';
vi.mock('$app/environment', () => ({ browser: true }));
// blobStore is mocked so probe outcomes (present / absent / throwing) are scripted per uid
// and "reconcile never deletes bytes" is a direct assertion on del.
const { blobHas, blobDel } = vi.hoisted(() => ({
	blobHas: vi.fn(async (_uid: string): Promise<boolean> => true),
	blobDel: vi.fn(async (_uid: string) => {})
}));
vi.mock('$lib/services/blob-store', () => ({ blobStore: { has: blobHas, del: blobDel } }));
const { trackLikeMock } = vi.hoisted(() => ({ trackLikeMock: vi.fn() }));
vi.mock('$lib/analytics', () => ({ trackLike: trackLikeMock }));
import { library } from './library.svelte';
import { downloadState } from '$lib/components/download-state';
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

/** The exact derivation DownloadControl / RowBadges render from (download-state.ts). */
const badgeOf = (uid: string) =>
	downloadState({
		downloading: library.downloading.has(uid),
		downloaded: library.isDownloaded(uid),
		unavailable: library.isUnavailable(uid)
	});

beforeEach(() => {
	library.downloads = [];
	library.unavailable = new Set();
	library.downloading = new Set();
	memStore.clear();
	blobHas.mockReset();
	blobHas.mockImplementation(async () => true);
	blobDel.mockReset();
});

describe('library.reconcileDownloads (quick-261119-reconcile)', () => {
	it('marks a record whose bytes are gone unavailable — and keeps the record listed', async () => {
		library.downloads = [mk({ uid: 'kuwo-a' }), mk({ uid: 'kuwo-b' })];
		blobHas.mockImplementation(async (uid: string) => uid !== 'kuwo-a');
		expect(badgeOf('kuwo-a')).toBe('downloaded');

		const marked = await library.reconcileDownloads();

		expect(marked).toEqual(['kuwo-a']);
		expect(library.isUnavailable('kuwo-a')).toBe(true);
		// 34-D-06: a missing file stays listed — the record is NOT dropped.
		expect(library.isDownloaded('kuwo-a')).toBe(true);
		expect(library.downloads.map((t) => t.uid)).toEqual(['kuwo-a', 'kuwo-b']);
		// The badge follows the mark through the shared derivation both surfaces render.
		expect(badgeOf('kuwo-a')).toBe('unavailable');
		expect(badgeOf('kuwo-b')).toBe('downloaded');
		// Reconcile never deletes bytes or records.
		expect(blobDel).not.toHaveBeenCalled();
	});

	it('persists the mark (a relaunch must not resurrect the ✓)', async () => {
		library.downloads = [mk({ uid: 'kuwo-a' })];
		blobHas.mockImplementation(async () => false);

		await library.reconcileDownloads();

		const saved = JSON.parse(memStore.get('openmusic:library:v1') ?? '{}') as {
			unavailable?: string[];
		};
		expect(saved.unavailable).toEqual(['kuwo-a']);
	});

	it('a throwing probe reads as UNKNOWN, never absent — its record is untouched', async () => {
		library.downloads = [mk({ uid: 'kuwo-a' }), mk({ uid: 'kuwo-b' })];
		blobHas.mockImplementation(async (uid: string) => {
			if (uid === 'kuwo-a') throw new Error('idb gone');
			return false;
		});

		const marked = await library.reconcileDownloads();

		expect(marked).toEqual(['kuwo-b']);
		expect(library.isUnavailable('kuwo-a')).toBe(false);
		expect(badgeOf('kuwo-a')).toBe('downloaded');
		expect(library.isUnavailable('kuwo-b')).toBe(true);
	});

	it('present bytes → untouched, and reconcile never clears a pre-existing mark', async () => {
		library.downloads = [mk({ uid: 'kuwo-a' }), mk({ uid: 'kuwo-b' })];
		library.unavailable = new Set(['kuwo-a']); // marked earlier; its file has since come back
		blobHas.mockImplementation(async () => true);

		const marked = await library.reconcileDownloads();

		expect(marked).toEqual([]);
		// Clearing belongs to the heal/download paths ('saved' → clearUnavailable), not here.
		expect(library.isUnavailable('kuwo-a')).toBe(true);
		expect(library.isUnavailable('kuwo-b')).toBe(false);
	});

	it('an already-marked still-missing record is not re-reported', async () => {
		library.downloads = [mk({ uid: 'kuwo-a' })];
		library.unavailable = new Set(['kuwo-a']);
		blobHas.mockImplementation(async () => false);

		expect(await library.reconcileDownloads()).toEqual([]);
		expect(library.isUnavailable('kuwo-a')).toBe(true);
	});

	it('skips uids with a download in flight (downloadTrack owns their mark)', async () => {
		library.downloads = [mk({ uid: 'kuwo-a' }), mk({ uid: 'kuwo-b' })];
		library.downloading = new Set(['kuwo-a']);
		blobHas.mockImplementation(async () => false);

		const marked = await library.reconcileDownloads();

		expect(marked).toEqual(['kuwo-b']);
		expect(blobHas.mock.calls.map((c) => c[0])).toEqual(['kuwo-b']);
		expect(library.isUnavailable('kuwo-a')).toBe(false);
	});

	it('device: records get the same treatment — marked when the file is gone, never dropped', async () => {
		library.downloads = [mk({ uid: 'device:track-1', source: 'device' as Track['source'] })];
		blobHas.mockImplementation(async () => false);

		const marked = await library.reconcileDownloads();

		expect(marked).toEqual(['device:track-1']);
		expect(library.isUnavailable('device:track-1')).toBe(true);
		expect(library.isDownloaded('device:track-1')).toBe(true);
		expect(blobDel).not.toHaveBeenCalled();
	});

	it('claim-once: concurrent calls share ONE probe pass; a later call re-probes', async () => {
		library.downloads = [mk({ uid: 'kuwo-a' }), mk({ uid: 'kuwo-b' })];
		blobHas.mockImplementation(async () => true);

		const p1 = library.reconcileDownloads();
		const p2 = library.reconcileDownloads();
		expect(p2).toBe(p1);
		await Promise.all([p1, p2]);
		expect(blobHas).toHaveBeenCalledTimes(2); // one probe per record, not two passes

		await library.reconcileDownloads(); // claim released after settle → a fresh pass runs
		expect(blobHas).toHaveBeenCalledTimes(4);
	});

	it('heal clears the mark (the existing downloadTrack saved-path call, pinned)', async () => {
		library.downloads = [mk({ uid: 'kuwo-a' })];
		blobHas.mockImplementation(async () => false);
		await library.reconcileDownloads();
		expect(badgeOf('kuwo-a')).toBe('unavailable');

		// The Heal flow re-downloads via downloadTrack, whose 'saved' exit calls exactly this.
		library.clearUnavailable('kuwo-a');

		expect(library.isUnavailable('kuwo-a')).toBe(false);
		expect(badgeOf('kuwo-a')).toBe('downloaded');
	});

	it('no downloads → resolves empty and probes nothing', async () => {
		expect(await library.reconcileDownloads()).toEqual([]);
		expect(blobHas).not.toHaveBeenCalled();
	});
});

describe('reconcile triggers (source pins)', () => {
	const read = (p: string) => readFileSync(p, 'utf-8');

	it('the app shell fires the reconcile once at startup, after library.load()', () => {
		const src = read('src/routes/(app)/+layout.svelte');
		const loadAt = src.indexOf('library.load();');
		const fireAt = src.indexOf('void library.reconcileDownloads();');
		expect(loadAt).toBeGreaterThan(-1);
		expect(fireAt).toBeGreaterThan(loadAt);
	});

	it('the Library page re-runs the reconcile when the Downloads tab opens', () => {
		const src = read('src/routes/(app)/library/+page.svelte');
		expect(src).toContain("if (tab !== 'downloads') return;");
		expect(src).toContain('void library.reconcileDownloads()');
	});
});
