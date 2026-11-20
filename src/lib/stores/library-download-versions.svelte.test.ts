// quick-261119-dldelete: the remove-download confirm's store-side contract —
// downloadVersionsFor lists every copy of a song, and deleting through the confirm's path
// (removeDownload with its DEFAULT options) removes record + blob bytes together, always.
// There is no user-facing index-only removal any more: a kept copy behind a "not downloaded"
// badge is the lie Hector rejected, so these tests pin that the default is the only story
// the sheet can tell.
import { beforeEach, describe, expect, it, vi } from 'vitest';
vi.mock('$app/environment', () => ({ browser: true }));
const { blobDel } = vi.hoisted(() => ({ blobDel: vi.fn(async () => {}) }));
vi.mock('$lib/services/blob-store', () => ({ blobStore: { del: blobDel } }));
const { trackLikeMock } = vi.hoisted(() => ({ trackLikeMock: vi.fn() }));
vi.mock('$lib/analytics', () => ({ trackLike: trackLikeMock }));
import { library } from './library.svelte';
import type { Track } from '$lib/sources/types';

const memStore = new Map<string, string>();
vi.stubGlobal('localStorage', {
	get length() {
		return memStore.size;
	},
	clear: () => memStore.clear(),
	getItem: (k: string) => (memStore.has(k) ? (memStore.get(k) as string) : null),
	key: (i: number) => Array.from(memStore.keys())[i] ?? null,
	removeItem: (k: string) => void memStore.delete(k),
	setItem: (k: string, v: string) => void memStore.set(k, String(v))
} as Storage);

const mk = (over: Partial<Track>): Track =>
	({
		uid: 'kuwo:1',
		source: 'kuwo',
		songid: '1',
		title: '晴天',
		artist: '周杰倫',
		album: '',
		cover: null,
		audioUrl: null,
		lrc: null,
		lrcUrl: null,
		detailsLoaded: true,
		quality: null,
		qualityLabel: null,
		...over
	}) as Track;

const studio = mk({});
const qqTwin = mk({ uid: 'qq:9', source: 'qq', songid: '9', qualityLabel: '320K' });
const other = mk({ uid: 'kuwo:2', songid: '2', title: '稻香' });

describe('library.downloadVersionsFor + confirm delete (quick-261119-dldelete)', () => {
	beforeEach(() => {
		library.downloads = [studio, qqTwin, other];
		library.unavailable = new Set();
		memStore.clear();
		blobDel.mockClear();
	});

	it('lists both versions of the song, exact uid first, and not the other song', () => {
		expect(library.downloadVersionsFor(qqTwin).map((v) => v.uid)).toEqual(['qq:9', 'kuwo:1']);
		expect(library.downloadVersionsFor(other).map((v) => v.uid)).toEqual(['kuwo:2']);
	});

	it('deleting one version removes its record AND its blob, and leaves the other version intact', () => {
		library.removeDownload('qq:9');
		expect(blobDel).toHaveBeenCalledWith('qq:9');
		expect(library.isDownloaded('qq:9')).toBe(false);
		expect(library.downloadVersionsFor(studio).map((v) => v.uid)).toEqual(['kuwo:1']);
	});

	it('delete-all (the sheet loops removeDownload over every version) leaves nothing behind — no record, no bytes', () => {
		for (const v of library.downloadVersionsFor(studio)) library.removeDownload(v.uid);
		expect(library.downloadVersionsFor(studio)).toEqual([]);
		expect(blobDel).toHaveBeenCalledWith('kuwo:1');
		expect(blobDel).toHaveBeenCalledWith('qq:9');
		expect(library.isDownloaded('kuwo:2')).toBe(true); // the other song is untouched
	});
});
