// quick-261023-syncmerge — tests for the merge-not-replace sync logic.
import { describe, expect, it } from 'vitest';
import {
	TOMBSTONE_CAP,
	addTombstones,
	clearTombstones,
	foldArtistName,
	mergeDeletedSets,
	mergeEnvelopes,
	mergeHistoryEntries,
	mergeLibraryBlobs,
	mergeNameTrRecords,
	mergeSearchHistoryEntries,
	previewHasDiff,
	previewMerge,
	readDeleted,
	tombFav,
	tombHistory,
	tombPlaylist,
	tombQuery,
	tombTrack,
	unionFavArtists,
	unionPlaylists,
	unionTracks
} from './merge-logic';
import { HISTORY_CAP, HISTORY_KEY } from '$lib/history/history-logic';
import { LIBRARY_KEY, SETTINGS_KEY } from '$lib/backup/backup-logic';
import { SEARCH_HISTORY_KEY } from '$lib/search/search-history-logic';

const tr = (uid: string, title = uid) => ({ uid, title, artist: 'a' });

describe('foldArtistName', () => {
	it('trims + lowercases (mirrors the store favKey cold behaviour)', () => {
		expect(foldArtistName('  Daft Punk ')).toBe('daft punk');
	});
});

describe('addTombstones / clearTombstones', () => {
	it('unions without duplicates and never mutates', () => {
		const base = ['u:x'];
		const out = addTombstones(base, ['u:x', 'u:y']);
		expect(out).toEqual(['u:x', 'u:y']);
		expect(base).toEqual(['u:x']);
	});
	it('FIFO-prunes to TOMBSTONE_CAP', () => {
		const base = Array.from({ length: TOMBSTONE_CAP }, (_, i) => `u:old${i}`);
		const out = addTombstones(base, ['u:new']);
		expect(out.length).toBe(TOMBSTONE_CAP);
		expect(out).not.toContain('u:old0');
		expect(out[out.length - 1]).toBe('u:new');
	});
	it('clearTombstones drops exactly the named keys', () => {
		expect(clearTombstones(['u:x', 'u:y'], ['u:x'])).toEqual(['u:y']);
		expect(clearTombstones(['u:x'], [])).toEqual(['u:x']);
	});
	it('ignores non-string / empty keys', () => {
		expect(addTombstones([], ['', null as unknown as string])).toEqual([]);
	});
});

describe('unionTracks', () => {
	it('local order first, remote-only appended, deduped by uid', () => {
		const out = unionTracks([tr('a'), tr('b')], [tr('b'), tr('c')]);
		expect(out.map((t) => t.uid)).toEqual(['a', 'b', 'c']);
	});
	it('drops uid-less entries', () => {
		expect(unionTracks([{ title: 'x' }], [tr('a')]).map((t) => t.uid)).toEqual(['a']);
	});
	it('tolerates non-arrays', () => {
		expect(unionTracks(null, [tr('a')]).map((t) => t.uid)).toEqual(['a']);
		expect(unionTracks([tr('a')], 'nope')).toEqual([expect.objectContaining({ uid: 'a' })]);
	});
});

describe('unionPlaylists', () => {
	it('merges by id: local name wins, tracks unioned', () => {
		const out = unionPlaylists(
			[{ id: 'p1', name: 'Mine', tracks: [tr('a')] }],
			[{ id: 'p1', name: 'Theirs', tracks: [tr('b')] }]
		);
		expect(out[0].name).toBe('Mine');
		expect((out[0].tracks as { uid: string }[]).map((t) => t.uid)).toEqual(['a', 'b']);
	});
	it('appends remote-only playlists', () => {
		const out = unionPlaylists([{ id: 'p1', tracks: [] }], [{ id: 'p2', tracks: [] }]);
		expect(out.map((p) => p.id)).toEqual(['p1', 'p2']);
	});
});

describe('unionFavArtists', () => {
	it('dedupes case-insensitively, local order first', () => {
		expect(unionFavArtists(['Daft Punk'], ['daft punk', '周杰倫'])).toEqual(['Daft Punk', '周杰倫']);
	});
});

describe('mergeLibraryBlobs', () => {
	const local = {
		liked: [tr('a')],
		playlists: [{ id: 'p1', name: 'Mine', tracks: [tr('b')] }],
		favArtists: ['Daft Punk'],
		downloads: [tr('dl1')],
		unavailable: ['u:gone'],
		deleted: [] as string[]
	};
	const remote = {
		liked: [tr('c')],
		playlists: [{ id: 'p2', name: 'Theirs', tracks: [tr('d')] }],
		favArtists: ['周杰倫'],
		deleted: [] as string[]
	};

	it('unions liked / playlists / artists', () => {
		const out = mergeLibraryBlobs(local, remote);
		expect((out.liked as { uid: string }[]).map((t) => t.uid)).toEqual(['a', 'c']);
		expect((out.playlists as { id: string }[]).map((p) => p.id)).toEqual(['p1', 'p2']);
		expect(out.favArtists).toEqual(['Daft Punk', '周杰倫']);
	});

	it('preserves local downloads + unavailable verbatim (never synced)', () => {
		const out = mergeLibraryBlobs(local, { ...remote, downloads: [tr('evil')], unavailable: ['x'] });
		expect((out.downloads as { uid: string }[]).map((t) => t.uid)).toEqual(['dl1']);
		expect(out.unavailable).toEqual(['u:gone']);
	});

	it('u: tombstones suppress from liked AND playlist tracks (delete-wins)', () => {
		const withTomb = { ...local, deleted: [tombTrack('c')] };
		const out = mergeLibraryBlobs(withTomb, remote);
		expect((out.liked as { uid: string }[]).map((t) => t.uid)).toEqual(['a']);
		const tomb2 = { ...local, deleted: [tombTrack('d')] };
		const out2 = mergeLibraryBlobs(tomb2, remote);
		const p2 = (out2.playlists as { id: string; tracks: { uid: string }[] }[]).find((p) => p.id === 'p2');
		expect(p2!.tracks).toEqual([]);
	});

	it('p: tombstone drops the whole playlist (but not liked copies of its tracks)', () => {
		const withTomb = {
			...local,
			liked: [tr('d')],
			playlists: [] as unknown[],
			deleted: [tombPlaylist('p2')]
		};
		const out = mergeLibraryBlobs(withTomb, remote);
		expect(out.playlists).toEqual([]);
		// the liked copy survives; the remote fixture's own liked 'c' unions in as usual
		expect((out.liked as { uid: string }[]).map((t) => t.uid)).toEqual(['d', 'c']);
	});

	it('f: tombstone suppresses the artist case-insensitively', () => {
		const withTomb = { ...local, deleted: [tombFav(foldArtistName('周杰倫'))] };
		const out = mergeLibraryBlobs(withTomb, remote);
		expect(out.favArtists).toEqual(['Daft Punk']);
	});

	it('unions tombstones from both sides', () => {
		const out = mergeLibraryBlobs(
			{ ...local, deleted: ['u:a'] },
			{ ...remote, deleted: ['u:b'] }
		);
		expect(out.deleted).toEqual(['u:a', 'u:b']);
	});

	it('a fresh local adopts the remote wholesale', () => {
		const out = mergeLibraryBlobs(null, remote);
		expect((out.liked as { uid: string }[]).map((t) => t.uid)).toEqual(['c']);
		expect(out.downloads).toEqual([]);
	});
});

describe('mergeHistoryEntries', () => {
	const e = (uid: string) => ({ uid, title: uid });
	it('unions by uid, local order first, remote-only appended', () => {
		const out = mergeHistoryEntries([e('a'), e('b')], [e('b'), e('c')], []);
		expect(out.map((x) => x.uid)).toEqual(['a', 'b', 'c']);
	});
	it('caps at 50', () => {
		const many = Array.from({ length: 60 }, (_, i) => e(`u${i}`));
		expect(mergeHistoryEntries(many, [], []).length).toBe(50);
	});
	it('h: tombstones suppress (clear-history propagates)', () => {
		const out = mergeHistoryEntries([e('a')], [e('b')], [tombHistory('b')]);
		expect(out.map((x) => x.uid)).toEqual(['a']);
	});
});

describe('mergeSearchHistoryEntries', () => {
	const q = (query: string, ts: number) => ({ query, ts });
	it('fresher ts wins per query (case-insensitive), most-recent-first', () => {
		const out = mergeSearchHistoryEntries([q('Hello', 5)], [q('hello', 9), q('bye', 1)], []);
		expect(out.map((x) => x.query)).toEqual(['hello', 'bye']);
		expect(out[0].ts).toBe(9);
	});
	it('caps at 12', () => {
		const many = Array.from({ length: 20 }, (_, i) => q(`q${i}`, i));
		expect(mergeSearchHistoryEntries(many, [], []).length).toBe(12);
	});
	it('q: tombstones suppress case-insensitively', () => {
		const out = mergeSearchHistoryEntries([q('Hello', 5)], [], [tombQuery('hello')]);
		expect(out).toEqual([]);
	});
});

describe('mergeNameTrRecords', () => {
	it('unions by key; local wins conflicts', () => {
		expect(mergeNameTrRecords({ a: 'L', b: 'L2' }, { a: 'R', c: 'R3' })).toEqual({
			a: 'L',
			b: 'L2',
			c: 'R3'
		});
	});
});

describe('mergeEnvelopes', () => {
	const env = (keys: Record<string, unknown>) => ({
		app: 'openmusic-backup' as const,
		format: 1,
		exportedAt: '',
		keys
	});
	const localLib = JSON.stringify({
		liked: [tr('a')],
		playlists: [],
		favArtists: [],
		downloads: [tr('dl1')],
		unavailable: [],
		deleted: [] as string[]
	});

	it('merges present families, keeps settings LWW (remote wins)', () => {
		const merged = mergeEnvelopes(
			env({ [LIBRARY_KEY]: {}, [SETTINGS_KEY]: { theme: 'dark' } }),
			env({
				[LIBRARY_KEY]: { liked: [tr('b')], playlists: [], favArtists: [], deleted: [] },
				[SETTINGS_KEY]: { theme: 'light' }
			}),
			localLib
		);
		expect(((merged.keys[LIBRARY_KEY] as { liked: { uid: string }[] }).liked).map((t) => t.uid)).toEqual([
			'a',
			'b'
		]);
		expect(merged.keys[SETTINGS_KEY]).toEqual({ theme: 'light' });
		// downloads survived the round trip even though the slimmed local envelope key lacked them
		expect(((merged.keys[LIBRARY_KEY] as { downloads: unknown[] }).downloads).length).toBe(1);
	});

	it('a family ABSENT from the remote envelope is omitted (delete-wins)', () => {
		const merged = mergeEnvelopes(
			env({ [LIBRARY_KEY]: {}, [HISTORY_KEY]: [{ uid: 'a' }] }),
			env({ [LIBRARY_KEY]: { liked: [], playlists: [], favArtists: [], deleted: [] } }),
			localLib
		);
		expect(merged.keys[HISTORY_KEY]).toBeUndefined();
		expect(merged.keys[LIBRARY_KEY]).toBeDefined();
	});

	it('history tombstones ride the library deleted set', () => {
		const libWithTomb = JSON.stringify({
			liked: [],
			playlists: [],
			favArtists: [],
			downloads: [],
			unavailable: [],
			deleted: [tombHistory('gone')]
		});
		const merged = mergeEnvelopes(
			env({ [HISTORY_KEY]: [{ uid: 'gone' }] }),
			env({ [HISTORY_KEY]: [{ uid: 'gone' }, { uid: 'kept' }] }),
			libWithTomb
		);
		expect(((merged.keys[HISTORY_KEY] as { uid: string }[]).map((e) => e.uid))).toEqual(['kept']);
	});

	it('search history merges with ts ordering', () => {
		const merged = mergeEnvelopes(
			env({ [SEARCH_HISTORY_KEY]: [{ query: 'a', ts: 1 }] }),
			env({ [SEARCH_HISTORY_KEY]: [{ query: 'b', ts: 2 }] }),
			localLib
		);
		expect(((merged.keys[SEARCH_HISTORY_KEY] as { query: string }[]).map((e) => e.query))).toEqual([
			'b',
			'a'
		]);
	});
});

describe('previewMerge / previewHasDiff (quick-261023-syncmerge review)', () => {
	const env = (keys: Record<string, unknown>) => ({
		app: 'openmusic-backup' as const,
		format: 1,
		exportedAt: '',
		keys
	});
	const lib = (liked: unknown[], extra: Record<string, unknown> = {}) => ({
		liked,
		playlists: [],
		favArtists: [],
		deleted: [],
		...extra
	});

	it('classifies incoming / outgoing / willDelete for liked tracks', () => {
		const p = previewMerge(
			env({ [LIBRARY_KEY]: lib([tr('keep'), tr('mine'), tr('doomed')], { deleted: [] }) }),
			env({
				[LIBRARY_KEY]: lib([tr('keep'), tr('cloud')], {
					deleted: [tombTrack('doomed')]
				})
			})
		);
		expect(p.library.tracks.incoming).toEqual([{ title: 'cloud', artist: 'a' }]);
		expect(p.library.tracks.outgoing.map((t) => t.title).sort()).toEqual(['doomed', 'mine']);
		expect(p.library.tracks.willDelete).toEqual([{ title: 'doomed', artist: 'a' }]);
		expect(previewHasDiff(p)).toBe(true);
	});

	it('excludes locally-tombstoned items from incoming (the merge would suppress them)', () => {
		const p = previewMerge(
			env({ [LIBRARY_KEY]: lib([], { deleted: [tombTrack('ghost')] }) }),
			env({ [LIBRARY_KEY]: lib([tr('ghost')]) })
		);
		expect(p.library.tracks.incoming).toEqual([]);
		expect(previewHasDiff(p)).toBe(false);
	});

	it('classifies playlists with track counts', () => {
		const p = previewMerge(
			env({
				[LIBRARY_KEY]: lib([], {
					playlists: [{ id: 'p1', name: 'Mine', tracks: [tr('a'), tr('b')] }]
				})
			}),
			env({
				[LIBRARY_KEY]: lib([], {
					playlists: [{ id: 'p2', name: 'Cloud', tracks: [tr('c')] }]
				})
			})
		);
		expect(p.library.playlists.incoming).toEqual([{ name: 'Cloud', trackCount: 1 }]);
		expect(p.library.playlists.outgoing).toEqual([{ name: 'Mine', trackCount: 2 }]);
	});

	it('reports history as counts and searches itemized', () => {
		const p = previewMerge(
			env({
				[HISTORY_KEY]: [{ uid: 'h1' }],
				[SEARCH_HISTORY_KEY]: [{ query: 'mine', ts: 1 }]
			}),
			env({
				[HISTORY_KEY]: [{ uid: 'h1' }, { uid: 'h2' }],
				[SEARCH_HISTORY_KEY]: [{ query: 'cloud', ts: 2 }]
			})
		);
		expect(p.history).toEqual({ incoming: 1, outgoing: 0, willDelete: 0 });
		expect(p.searches.incoming).toEqual([{ query: 'cloud' }]);
		expect(p.searches.outgoing).toEqual([{ query: 'mine' }]);
	});

	it('flags settings differences (merge keeps the cloud copy)', () => {
		const same = previewMerge(
			env({ [SETTINGS_KEY]: { theme: 'dark' } }),
			env({ [SETTINGS_KEY]: { theme: 'dark' } })
		);
		expect(same.settings.differs).toBe(false);
		expect(previewHasDiff(same)).toBe(false);
		const diff = previewMerge(
			env({ [SETTINGS_KEY]: { theme: 'dark' } }),
			env({ [SETTINGS_KEY]: { theme: 'light' } })
		);
		expect(diff.settings.differs).toBe(true);
		expect(previewHasDiff(diff)).toBe(true);
	});

	it('empty-vs-empty has no diff (no review)', () => {
		expect(previewHasDiff(previewMerge(env({}), env({})))).toBe(false);
	});

	it('name-tr reports per-language counts', () => {
		const p = previewMerge(
			env({ 'openmusic:name-tr:v2:zh-Hant': { a: '甲' } }),
			env({ 'openmusic:name-tr:v2:zh-Hant': { a: '甲', b: '乙' } })
		);
		expect(p.nameTr).toEqual([{ key: 'openmusic:name-tr:v2:zh-Hant', incoming: 1, outgoing: 0 }]);
		expect(previewHasDiff(p)).toBe(true);
	});
});

describe('readDeleted / mergeDeletedSets', () => {
	it('reads defensively', () => {
		expect(readDeleted(null)).toEqual([]);
		expect(readDeleted({ deleted: 'nope' })).toEqual([]);
		expect(readDeleted({ deleted: ['u:a', 5] })).toEqual([]);
		expect(readDeleted({ deleted: ['u:a'] })).toEqual(['u:a']);
	});
	it('mergeDeletedSets unions both sides', () => {
		expect(mergeDeletedSets({ deleted: ['u:a'] }, { deleted: ['u:b'] })).toEqual(['u:a', 'u:b']);
	});
});
