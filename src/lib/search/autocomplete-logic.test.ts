import { describe, it, expect, vi, afterEach } from 'vitest';
import {
	deriveSuggestions,
	suggestionKeyword,
	debounce,
	MIN_QUERY_LEN,
	SUGGEST_DEBOUNCE_MS,
	SUGGEST_CAP,
	ARTIST_ROWS,
	ALBUM_ROWS,
	type Suggestion
} from './autocomplete-logic';
import type { DeezerHit } from '$lib/services/deezer';

// Test fixture builder — only the fields deriveSuggestions reads matter, the rest are
// filled with harmless placeholders so we exercise the real DeezerHit shape. `album` defaults
// to '' so pre-gm4 tests (which never set it) keep producing zero album suggestions.
function hit(title: string, artist: string, album = '', id = `${title}-${artist}`): DeezerHit {
	return { id, title, artist, album, cover: null, preview: null };
}

describe('deriveSuggestions', () => {
	it('returns [] for empty, whitespace, and below-min-length queries', () => {
		const hits = [hit('Blinding Lights', 'The Weeknd')];
		expect(deriveSuggestions(hits, '')).toEqual([]);
		expect(deriveSuggestions(hits, '   ')).toEqual([]);
		// a 1-char query is below MIN_QUERY_LEN (=2) → no suggestions
		expect(deriveSuggestions(hits, 'a')).toEqual([]);
		expect(MIN_QUERY_LEN).toBe(2);
	});

	it('returns [] when there are no hits', () => {
		expect(deriveSuggestions([], 'jay')).toEqual([]);
	});

	it('maps hits to song suggestions preserving Deezer relevance order', () => {
		const hits = [
			hit('Song A', 'Artist 1'),
			hit('Song B', 'Artist 2'),
			hit('Song C', 'Artist 3')
		];
		const out = deriveSuggestions(hits, 'son');
		const songs = out.filter((s) => s.kind === 'song');
		expect(songs.map((s) => s.title)).toEqual(['Song A', 'Song B', 'Song C']);
		// song suggestions carry the artist for secondary display
		expect(songs[0]).toMatchObject({ kind: 'song', title: 'Song A', artist: 'Artist 1' });
	});

	it('drops hits with an empty / whitespace-only title', () => {
		const hits = [hit('', 'Ghost Artist'), hit('   ', 'Blank'), hit('Real Song', 'Real Artist')];
		const songs = deriveSuggestions(hits, 'rea').filter((s) => s.kind === 'song');
		expect(songs.map((s) => s.title)).toEqual(['Real Song']);
	});

	it('emits distinct artist suggestions (case-insensitive dedupe, first-seen casing)', () => {
		const hits = [
			hit('Track 1', 'Jay Chou'),
			hit('Track 2', 'jay chou'), // same artist, different casing → one artist suggestion
			hit('Track 3', 'Eason Chan')
		];
		const artists = deriveSuggestions(hits, 'jay').filter((s) => s.kind === 'artist');
		// first-seen casing preserved; case-insensitive dedupe collapses jay chou → Jay Chou
		expect(artists.map((s) => s.title)).toEqual(['Jay Chou', 'Eason Chan']);
	});

	it('skips empty artist names when building artist suggestions', () => {
		const hits = [hit('Track 1', ''), hit('Track 2', '  '), hit('Track 3', 'Real Artist')];
		const artists = deriveSuggestions(hits, 'tra').filter((s) => s.kind === 'artist');
		expect(artists.map((s) => s.title)).toEqual(['Real Artist']);
	});

	it('de-dupes duplicate song hits case-insensitively (keeps first)', () => {
		const hits = [
			hit('Hello', 'Adele'),
			hit('hello', 'adele'), // duplicate song (case-insensitive title|artist)
			hit('Hello', 'Lionel Richie') // different artist → distinct song
		];
		const songs = deriveSuggestions(hits, 'hel').filter((s) => s.kind === 'song');
		// the second (lowercase Adele) is dropped; the Lionel Richie one survives
		expect(songs).toHaveLength(2);
		expect(songs.map((s) => `${s.title}|${s.artist}`)).toEqual(['Hello|Adele', 'Hello|Lionel Richie']);
	});

	it('never exceeds SUGGEST_CAP and produces unique keys', () => {
		const hits: DeezerHit[] = [];
		for (let i = 0; i < 30; i++) hits.push(hit(`Song ${i}`, `Artist ${i}`));
		const out = deriveSuggestions(hits, 'song');
		expect(out.length).toBeLessThanOrEqual(SUGGEST_CAP);
		expect(SUGGEST_CAP).toBe(8);
		const keys = out.map((s) => s.key);
		expect(new Set(keys).size).toBe(keys.length); // all keys unique
	});

	// --- album suggestions (quick-260712-gm4) ---

	it('emits distinct album suggestions carrying the album artist as the sub (gm4)', () => {
		const hits = [
			hit('Song A', 'Jay Chou', 'Jay'),
			hit('Song B', 'Jay Chou', 'Fantasy')
		];
		// kept to 2 distinct albums because ALBUM_ROWS caps the album group (quick-260919-pid);
		// the dedupe semantics under test here are unchanged.
		const albums = deriveSuggestions(hits, 'jay').filter((s) => s.kind === 'album');
		expect(albums.map((s) => s.title)).toEqual(['Jay', 'Fantasy']);
		expect(albums[0]).toMatchObject({ kind: 'album', title: 'Jay', artist: 'Jay Chou' });
	});

	it('skips empty album names and de-dupes album|artist case-insensitively (gm4)', () => {
		const hits = [
			hit('T1', 'Adele', '21'),
			hit('T2', 'adele', '21'), // same album|artist (case-insensitive) → one album row
			hit('T3', 'Nobody', ''), // empty album → skipped
			hit('T4', 'Someone', '   ') // whitespace album → skipped
		];
		const albums = deriveSuggestions(hits, 'adele').filter((s) => s.kind === 'album');
		expect(albums.map((s) => `${s.title}|${s.artist}`)).toEqual(['21|Adele']);
	});

	it('keeps a same title distinct across kinds via the key prefix (gm4)', () => {
		// A query where a song, an artist, and an album can share the string "Nirvana".
		const hits = [hit('Nirvana', 'Nirvana', 'Nirvana')];
		const out = deriveSuggestions(hits, 'nir');
		const keys = out.map((s) => s.key);
		expect(new Set(keys).size).toBe(keys.length); // no collisions
		expect(out.some((s) => s.kind === 'album')).toBe(true);
	});

	it('tolerates missing / nullish title and artist fields without throwing', () => {
		const dirty = [
			{ id: '1', title: undefined, artist: 'A', album: '', cover: null, preview: null },
			{ id: '2', title: 'OK', artist: undefined, album: '', cover: null, preview: null }
		] as unknown as DeezerHit[];
		expect(() => deriveSuggestions(dirty, 'ok')).not.toThrow();
		const out = deriveSuggestions(dirty, 'ok');
		// the song with a title survives; the title-less one is skipped
		expect(out.filter((s: Suggestion) => s.kind === 'song').map((s) => s.title)).toEqual(['OK']);
	});

	// --- bounded grouped order (quick-260919-pid) ---

	it('groups suggestions artists then albums then songs, never interleaved (quick-260919-pid)', () => {
		const hits = [hit('Song A', 'Artist 1', 'Album 1'), hit('Song B', 'Artist 2', 'Album 2')];
		const out = deriveSuggestions(hits, 'son');
		expect(out.map((s) => s.kind)).toEqual(['artist', 'artist', 'album', 'album', 'song', 'song']);
		expect(out.map((s) => s.title)).toEqual([
			'Artist 1',
			'Artist 2',
			'Album 1',
			'Album 2',
			'Song A',
			'Song B'
		]);
	});

	it('bounds the leading groups at ARTIST_ROWS / ALBUM_ROWS so songs keep slots (quick-260919-pid)', () => {
		// Why BOUNDED rather than a plain concat: measured against live Deezer, an unbounded
		// [...artists, ...albums, ...songs].slice(0, 8) rendered ZERO song rows for 5 of 6 queries
		// (8 hits routinely carry 8 distinct artists), and songs are the only playable kind.
		const hits: DeezerHit[] = [];
		for (let i = 0; i < 8; i++) hits.push(hit(`Song ${i}`, `Artist ${i}`, `Album ${i}`));
		const out = deriveSuggestions(hits, 'song');
		expect(ARTIST_ROWS).toBe(2);
		expect(ALBUM_ROWS).toBe(2);
		expect(out.length).toBe(SUGGEST_CAP);
		expect(out.map((s) => s.kind)).toEqual([
			'artist',
			'artist',
			'album',
			'album',
			'song',
			'song',
			'song',
			'song'
		]);
		// first-seen relevance order is kept WITHIN each truncated group
		expect(out.filter((s) => s.kind === 'artist').map((s) => s.title)).toEqual([
			'Artist 0',
			'Artist 1'
		]);
		expect(out.filter((s) => s.kind === 'album').map((s) => s.title)).toEqual(['Album 0', 'Album 1']);
	});

	it('backfills with songs when a leading group is short (quick-260919-pid)', () => {
		const hits: DeezerHit[] = [];
		// empty artist -> 0 artist rows; every hit shares one album -> exactly 1 album row
		for (let i = 0; i < 8; i++) hits.push(hit(`Song ${i}`, '', 'Same LP'));
		const out = deriveSuggestions(hits, 'song');
		expect(out.length).toBe(SUGGEST_CAP);
		expect(out[0].kind).toBe('album');
		expect(out.slice(1).every((s) => s.kind === 'song')).toBe(true); // songs expanded to fill
	});

	it('stays SHORT when there are no songs - the caps never backfill (quick-260919-pid)', () => {
		// ASYMMETRIC BY DESIGN: ARTIST_ROWS / ALBUM_ROWS are ceilings on those two kinds, NEVER a
		// floor to pad from. Songs expand into unused leading slots; artists/albums never expand.
		const hits: DeezerHit[] = [];
		// an empty title skips the SONG only - the hit's artist and album are still collected
		for (let i = 0; i < 5; i++) hits.push(hit('', `Artist ${i}`, `Album ${i}`));
		const out = deriveSuggestions(hits, 'art');
		expect(out.map((s) => s.kind)).toEqual(['artist', 'artist', 'album', 'album']);
		expect(out.length).toBe(4);
	});

	it('emits one row per kind for a single hit (quick-260919-pid)', () => {
		const out = deriveSuggestions([hit('Only Song', 'Solo', 'Solo LP')], 'sol');
		expect(out.map((s) => s.kind)).toEqual(['artist', 'album', 'song']);
	});
});

describe('debounce', () => {
	afterEach(() => {
		vi.useRealTimers();
		vi.clearAllTimers();
	});

	it('fires the wrapped fn ONCE after the delay', () => {
		vi.useFakeTimers();
		const fn = vi.fn();
		const d = debounce(fn, SUGGEST_DEBOUNCE_MS);
		d('a');
		expect(fn).not.toHaveBeenCalled();
		vi.advanceTimersByTime(SUGGEST_DEBOUNCE_MS - 1);
		expect(fn).not.toHaveBeenCalled();
		vi.advanceTimersByTime(1);
		expect(fn).toHaveBeenCalledTimes(1);
		expect(fn).toHaveBeenCalledWith('a');
	});

	it('a call within the window resets the timer (only the last call fires)', () => {
		vi.useFakeTimers();
		const fn = vi.fn();
		const d = debounce(fn, 300);
		d('first');
		vi.advanceTimersByTime(200);
		d('second'); // resets the timer
		vi.advanceTimersByTime(200); // 200ms after the SECOND call — not yet 300
		expect(fn).not.toHaveBeenCalled();
		vi.advanceTimersByTime(100); // now 300ms after the second call
		expect(fn).toHaveBeenCalledTimes(1);
		expect(fn).toHaveBeenCalledWith('second');
	});

	it('cancel() prevents a pending call', () => {
		vi.useFakeTimers();
		const fn = vi.fn();
		const d = debounce(fn, 300);
		d('x');
		d.cancel();
		vi.advanceTimersByTime(1000);
		expect(fn).not.toHaveBeenCalled();
	});

	it('exposes the configured default debounce window', () => {
		expect(SUGGEST_DEBOUNCE_MS).toBe(300);
	});
});

describe('suggestionKeyword', () => {
	it('joins the title and the artist with a single space', () => {
		expect(suggestionKeyword({ title: '有人', artist: '周杰倫' })).toBe('有人 周杰倫');
	});

	it('returns the title alone when the artist is an empty string', () => {
		expect(suggestionKeyword({ title: 'Song', artist: '' })).toBe('Song');
	});

	it('returns the title alone when the artist is undefined', () => {
		expect(suggestionKeyword({ title: 'Song' })).toBe('Song');
	});

	it('returns the title alone when the artist is whitespace only', () => {
		expect(suggestionKeyword({ title: 'Song', artist: '   ' })).toBe('Song');
	});

	it('trims both sides and joins with exactly one space', () => {
		expect(suggestionKeyword({ title: '  Song  ', artist: ' Artist ' })).toBe('Song Artist');
	});
});
