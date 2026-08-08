import { describe, it, expect } from 'vitest';
import {
	slugify,
	encodePathSegment,
	decodePathSegment,
	ogImageUrl,
	encodeShare,
	decodeShare,
	decodeTrack,
	encodeTrack,
	shareUrl,
	songShareUrl,
	entityCardUrl,
	entityShareUrl,
	parseEntityParam,
	buildOg,
	isHttpsUrl
} from './share';
import { matchKey } from '$lib/services/match-key';
import { makeUid, type SourceId, type Track } from '$lib/sources/types';

function mk(source: SourceId, songid: string, title: string, artist: string): Track {
	return {
		uid: makeUid(source, songid),
		source,
		songid,
		title,
		artist,
		album: `${title} (album)`,
		cover: 'https://cdn.example.com/c.jpg',
		audioUrl: 'https://cdn.example.com/a.mp3',
		lrc: null,
		lrcUrl: null,
		detailsLoaded: true,
		quality: null,
		qualityLabel: null,
		keyword: title,
		displayIndex: 1
	};
}

describe('slugify', () => {
	it('lowercases ASCII, collapses punctuation/space to single hyphens, trims', () => {
		expect(slugify('Hello World!!', 'A B')).toBe('hello-world-a-b');
	});

	it('collapses repeats and trims leading/trailing hyphens', () => {
		expect(slugify('  --Dao  Xiang--  ', '__Jay__')).toBe('dao-xiang-jay');
	});

	it('slugifies CJK titles to ASCII (strips non-ASCII), never preserving CJK codepoints', () => {
		// D-05: CJK is stripped to ASCII; the slug is cosmetic, the trailing {source}{id} is authoritative.
		const slug = slugify('稻香', 'Jay Chou');
		expect(slug).toMatch(/^[a-z0-9-]*$/); // ASCII-only — no CJK codepoints survive
		expect(slug).not.toContain('稻');
		expect(slug).not.toContain('香');
		// The ASCII artist segment still slugifies.
		expect(slug).toBe('jay-chou');
		// All-CJK title with no ASCII artist → empty slug (id is authoritative downstream).
		expect(slugify('情非得已', '')).toBe('');
	});

	it('caps length at ~60 chars', () => {
		const long = 'a'.repeat(200);
		expect(slugify(long, '').length).toBeLessThanOrEqual(60);
	});

	it('handles empty inputs without throwing', () => {
		expect(slugify('', '')).toBe('');
	});
});

// SvelteKit decodeURIComponent's every route param before a loader sees it (decode_params,
// utils/routing.js) — so the REAL round-trip a share link takes is
// encodePathSegment → (SvelteKit's single decode) → decodePathSegment. This helper mirrors that
// exactly; asserting encode→decode directly would silently skip the percent-decode step and pass
// for the wrong reason (RESEARCH §B.6 / Pitfall 1).
function roundTrip(raw: string): string {
	return decodePathSegment(decodeURIComponent(encodePathSegment(raw)));
}

describe('encodePathSegment / decodePathSegment (OG-PATH-01 codec)', () => {
	it('preserves original case and collapses whitespace runs to a single hyphen', () => {
		expect(encodePathSegment('Come As You Are')).toBe('Come-As-You-Are');
		// Case is PRESERVED on purpose — the OG card title is read straight back out of the path.
		expect(encodePathSegment('DNA')).toBe('DNA');
		expect(encodePathSegment('A  B')).toBe('A--B');
		expect(encodePathSegment('  padded  ')).toBe('padded');
	});

	it('EMPTY guard: an empty/whitespace input becomes the `-` segment (an empty segment 404s)', () => {
		expect(encodePathSegment('')).toBe('-');
		expect(encodePathSegment('   ')).toBe('-');
		// The guard's whole point: `-` decodes back to '' so a loader's "no name" fallback still fires.
		expect(decodePathSegment('-')).toBe('');
	});

	it('DOT-ONLY guard: a dot-only segment gets a trailing `-` (WHATWG normalizes `.`/`..` away)', () => {
		expect(encodePathSegment('.')).toBe('.-');
		expect(encodePathSegment('..')).toBe('..-');
		expect(encodePathSegment('...')).toBe('...-');
		// Lossless — the decoder's hyphen→space + trim recovers the original exactly.
		expect(roundTrip('.')).toBe('.');
		expect(roundTrip('..')).toBe('..');
		expect(roundTrip('...')).toBe('...');
	});

	it('percent-encodes CJK / emoji / `/` / `%` (a path segment is NOT ASCII-limited)', () => {
		expect(encodePathSegment('稻香')).toBe(encodeURIComponent('稻香'));
		expect(encodePathSegment('周杰倫')).toBe('%E5%91%A8%E6%9D%B0%E5%80%AB');
		expect(encodePathSegment('A/B')).toBe('A%2FB');
		expect(encodePathSegment('50% Off')).toBe('50%25-Off');
		expect(encodePathSegment('🎵Song')).toBe('%F0%9F%8E%B5Song');
	});

	it('decodePathSegment NEVER decodes percent-escapes — a literal `%` must survive (Pitfall 1)', () => {
		// SvelteKit already decoded; a second decodeURIComponent throws URIError on a bare '%'.
		expect(decodePathSegment('50% Off')).toBe('50% Off');
		expect(() => decodePathSegment('100%')).not.toThrow();
		expect(decodePathSegment('100%')).toBe('100%');
		expect(decodePathSegment('A-B')).toBe('A B');
		expect(decodePathSegment('A--B')).toBe('A B'); // hyphen RUNS collapse to one space
		expect(decodePathSegment('-Hello-')).toBe('Hello'); // leading/trailing trimmed
	});

	it('round-trips every §B.7 stress case exactly', () => {
		for (const raw of [
			'Nirvana',
			'Come As You Are',
			'周杰倫',
			'稻香',
			'A/B',
			'50% Off',
			'🎵Song',
			'أغنية',
			'#1 Hit',
			'A?B',
			'C+D',
			"Don't Stop (Live)"
		]) {
			expect(roundTrip(raw)).toBe(raw);
		}
	});

	it('documents the ACCEPTED lossy edges (literal hyphen, double space, edge hyphens)', () => {
		expect(roundTrip('Spider-Man')).toBe('Spider Man'); // CONTEXT-locked loss
		expect(roundTrip('A  B')).toBe('A B');
		expect(roundTrip('-Hello-')).toBe('Hello');
		expect(roundTrip('')).toBe('');
	});

	it('§B.8: matchKey is EXACTLY invariant under the hyphen→space loss', () => {
		// The invariance the whole path scheme rests on — matchKey's norm() strips all punctuation
		// AND whitespace, so `Spider-Man` and `Spider Man` produce byte-identical keys.
		expect(matchKey('Post Malone', roundTrip('Spider-Man'))).toBe(
			matchKey('Post Malone', 'Spider-Man')
		);
		expect(matchKey(roundTrip('Jay-Z'), roundTrip('Empire State of Mind'))).toBe(
			matchKey('Jay-Z', 'Empire State of Mind')
		);
		expect(matchKey('周杰倫', roundTrip('稻香'))).toBe(matchKey('周杰倫', '稻香'));
	});
});

describe('ogImageUrl (OG-EP-01 own-origin card image)', () => {
	it('builds ${origin}/api/og?type=&artist=&title= with encoded values', () => {
		expect(ogImageUrl('https://openmusic.lol', 'song', 'Nirvana', 'Come As You Are')).toBe(
			'https://openmusic.lol/api/og?type=song&artist=Nirvana&title=Come%20As%20You%20Are'
		);
		expect(ogImageUrl('https://openmusic.lol', 'album', '周杰倫', '范特西')).toBe(
			`https://openmusic.lol/api/og?type=album&artist=${encodeURIComponent('周杰倫')}&title=${encodeURIComponent('范特西')}`
		);
	});

	it('omits &title= entirely when there is no secondary name (artist card)', () => {
		const url = ogImageUrl('https://openmusic.lol', 'artist', 'Nirvana');
		expect(url).toBe('https://openmusic.lol/api/og?type=artist&artist=Nirvana');
		expect(url).not.toContain('title=');
		expect(ogImageUrl('https://openmusic.lol', 'artist', 'Nirvana', '')).not.toContain('title=');
	});

	it('is pure — no location read, so an SSR loader can call it with any origin', () => {
		expect(ogImageUrl('', 'song', 'A', 'B')).toBe('/api/og?type=song&artist=A&title=B');
	});
});

describe('encodeShare / decodeShare — v2 round-trip', () => {
	it('round-trips the current track AND the queue (uids + titles preserved)', () => {
		const current = mk('netease', '1', 'Dao Xiang', 'Jay Chou');
		const queue = [current, mk('qq', '2', 'Qing Tian', 'Jay Chou'), mk('kuwo', '3', 'Ni Hao', 'X')];
		const token = encodeShare(current, queue);
		const out = decodeShare(token);

		expect(out.current?.uid).toBe(current.uid);
		expect(out.queue.map((t) => t.uid)).toEqual(queue.map((t) => t.uid));
		expect(out.queue.map((t) => t.title)).toEqual(queue.map((t) => t.title));
	});

	it('decoded tracks are unresolved stubs (audioUrl/detailsLoaded reset for re-resolve)', () => {
		const current = mk('netease', '1', 'Dao Xiang', 'Jay Chou');
		const out = decodeShare(encodeShare(current, [current]));
		expect(out.current?.audioUrl).toBeNull();
		expect(out.current?.detailsLoaded).toBe(false);
	});

	it('caps the carried queue at 30 stubs', () => {
		const current = mk('netease', '0', 'Cur', 'A');
		const queue = Array.from({ length: 50 }, (_, i) => mk('qq', String(i), `T${i}`, 'A'));
		const out = decodeShare(encodeShare(current, queue));
		expect(out.queue.length).toBe(30);
	});

	it('an empty queue round-trips to a 1-item queue holding the current track', () => {
		const current = mk('netease', '1', 'Solo', 'A');
		const out = decodeShare(encodeShare(current, []));
		expect(out.queue.map((t) => t.uid)).toEqual([current.uid]);
	});

	it('a 1-item queue round-trips to a 1-item queue', () => {
		const current = mk('netease', '1', 'Solo', 'A');
		const out = decodeShare(encodeShare(current, [current]));
		expect(out.queue.map((t) => t.uid)).toEqual([current.uid]);
	});
});

describe('decodeShare — legacy v1 + malformed', () => {
	it('decodes a legacy single-track token (encodeTrack output) to {current, queue:[current]}', () => {
		const track = mk('netease', '99', 'Legacy', 'Old');
		const legacyToken = encodeTrack(track); // bare Stub, no v/q field
		const out = decodeShare(legacyToken);
		expect(out.current?.uid).toBe(track.uid);
		expect(out.queue.map((t) => t.uid)).toEqual([track.uid]);
	});

	it('decodeTrack (legacy export) returns just the current track', () => {
		const track = mk('qq', '5', 'X', 'Y');
		expect(decodeTrack(encodeShare(track, [track]))?.uid).toBe(track.uid);
		expect(decodeTrack(encodeTrack(track))?.uid).toBe(track.uid);
	});

	it('returns {current:null, queue:[]} on malformed/garbage input (T-gln-01)', () => {
		expect(decodeShare('not-a-token')).toEqual({ current: null, queue: [] });
		expect(decodeShare('')).toEqual({ current: null, queue: [] });
	});

	it('returns {current:null, queue:[]} when required identity fields are missing', () => {
		// A base64url JSON object lacking uid/source.
		const bad = btoa(JSON.stringify({ title: 'x' })).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
		expect(decodeShare(bad)).toEqual({ current: null, queue: [] });
	});
});

describe('shareUrl', () => {
	it('emits a /?t=<slug>&play=<payload> URL whose payload decodes back to the same track + queue', () => {
		const current = mk('netease', '1', 'Dao Xiang', 'Jay Chou');
		const queue = [current, mk('qq', '2', 'Qing Tian', 'Jay Chou')];
		const url = shareUrl(current, queue);
		expect(url).toContain('t=');
		expect(url).toContain('play=');
		const payload = url.split('play=')[1];
		const out = decodeShare(payload);
		expect(out.current?.uid).toBe(current.uid);
		expect(out.queue.map((t) => t.uid)).toEqual(queue.map((t) => t.uid));
	});

	it('works with no queue argument (queue defaults to [])', () => {
		const current = mk('netease', '1', 'Solo', 'A');
		const url = shareUrl(current);
		const out = decodeShare(url.split('play=')[1]);
		expect(out.current?.uid).toBe(current.uid);
		expect(out.queue.map((t) => t.uid)).toEqual([current.uid]);
	});
});

describe('songShareUrl', () => {
	it('emits a short /song/{slug}?n={title}&a={artist} URL (DQ-1)', () => {
		const url = songShareUrl({ title: 'Dao Xiang', artist: 'Jay Chou' });
		expect(url.endsWith('/song/dao-xiang-jay-chou?n=Dao%20Xiang&a=Jay%20Chou')).toBe(true);
	});

	it('uses the `s` placeholder segment when slugify returns empty (all-CJK title)', () => {
		const url = songShareUrl({ title: '情非得已', artist: '' });
		// slug is empty → `s` placeholder satisfies the required [slug] route param.
		expect(url).toContain('/song/s?');
		expect(url).not.toContain('/song/?');
	});

	it('carries NO ?play= token and NO {source}{id} suffix in the path (DQ-1/DQ-4)', () => {
		const url = songShareUrl({ title: 'Dao Xiang', artist: 'Jay Chou' });
		expect(url).not.toContain('play=');
		// The path segment is purely the cosmetic slug — no trailing {source}{id} key.
		const path = url.split('?')[0];
		expect(parseEntityParam(path.split('/').pop()!)).toBeNull();
	});

	it('n/a are encodeURIComponent of the RAW title/artist — a CJK title round-trips (OG carrier)', () => {
		const url = songShareUrl({ title: '稻香', artist: '周杰倫' });
		const q = new URLSearchParams(url.split('?')[1]);
		expect(decodeURIComponent(q.get('n')!)).toBe('稻香');
		expect(decodeURIComponent(q.get('a')!)).toBe('周杰倫');
	});

	it('encodes an empty artist as a=', () => {
		const url = songShareUrl({ title: 'Solo', artist: '' });
		const q = new URLSearchParams(url.split('?')[1]);
		expect(q.get('a')).toBe('');
		expect(q.get('n')).toBe('Solo');
	});

	it('carries an https cover as &c= (quick-260723-r4p, OG image carrier)', () => {
		const url = songShareUrl({ title: 'Dao Xiang', artist: 'Jay Chou', cover: 'https://cdn/x.jpg' });
		const q = new URLSearchParams(url.split('?')[1]);
		expect(q.get('c')).toBe('https://cdn/x.jpg');
	});

	it('omits `c` for a non-https / null / missing cover (falls to /og.svg downstream)', () => {
		expect(songShareUrl({ title: 'A', artist: 'B', cover: 'http://cdn/x.jpg' })).not.toContain('c=');
		expect(songShareUrl({ title: 'A', artist: 'B', cover: null })).not.toContain('&c=');
		expect(songShareUrl({ title: 'A', artist: 'B' })).not.toContain('&c=');
	});
});

describe('entityCardUrl (quick-260723-ry1 — album/artist card, resolution-safe)', () => {
	it('keeps the LITERAL CJK name in the path (round-trip key), not an ASCII slug', () => {
		const url = entityCardUrl({ type: 'album', name: '范特西', artist: '周杰倫' });
		const path = url.split('?')[0];
		expect(path.endsWith(`/album/${encodeURIComponent('范特西')}`)).toBe(true);
		// decodes back to the original literal name (authoritative resolution key preserved)
		expect(decodeURIComponent(path.split('/album/')[1])).toBe('范特西');
	});

	it('album carries ?artist= as the functional tracklist key', () => {
		const q = new URLSearchParams(entityCardUrl({ type: 'album', name: 'A', artist: 'B' }).split('?')[1]);
		expect(q.get('artist')).toBe('B');
	});

	it('artist type carries no ?artist= (no secondary name)', () => {
		const url = entityCardUrl({ type: 'artist', name: 'Jay' });
		expect(url.endsWith('/artist/Jay')).toBe(true);
		expect(url).not.toContain('artist=');
	});

	it('carries an https cover as c, omits non-https / null', () => {
		expect(new URLSearchParams(entityCardUrl({ type: 'artist', name: 'A', cover: 'https://cdn/x.jpg' }).split('?')[1]).get('c')).toBe('https://cdn/x.jpg');
		expect(entityCardUrl({ type: 'artist', name: 'A', cover: 'http://cdn/x.jpg' })).not.toContain('c=');
		expect(entityCardUrl({ type: 'artist', name: 'A', cover: null })).not.toContain('c=');
	});

	it('carries dn/da display overrides ONLY when they differ from the literal keys', () => {
		const q = new URLSearchParams(
			entityCardUrl({ type: 'album', name: '范特西', artist: '周杰伦', displayName: '范特西', displayArtist: '周杰倫' }).split('?')[1]
		);
		// displayName equals name → no dn; displayArtist differs → da present (converted artist)
		expect(q.get('dn')).toBeNull();
		expect(q.get('da')).toBe('周杰倫');
	});

	it('da is album-only (an artist card never carries da)', () => {
		const url = entityCardUrl({ type: 'artist', name: '周杰伦', displayName: '周杰倫', displayArtist: 'x' });
		const q = new URLSearchParams(url.split('?')[1]);
		expect(q.get('dn')).toBe('周杰倫'); // converted artist name rides dn (the artist card's title)
		expect(q.get('da')).toBeNull();
	});

	it('emits a bare literal path with no query when nothing extra applies', () => {
		expect(entityCardUrl({ type: 'artist', name: 'Jay' }).endsWith('/artist/Jay')).toBe(true);
		expect(entityCardUrl({ type: 'artist', name: 'Jay' })).not.toContain('?');
	});
});

describe('entityShareUrl / parseEntityParam', () => {
	it('builds /{type}/{slug}-{source}{id} with the authoritative {source}{id} key (D-04)', () => {
		const url = entityShareUrl('song', {
			title: 'Qing Fei De Yi',
			artist: 'A',
			source: 'qq',
			songid: '123'
		});
		expect(url.endsWith('/song/qing-fei-de-yi-a-qq123')).toBe(true);
	});

	it('uses the entity type in the path segment (album)', () => {
		const url = entityShareUrl('album', {
			title: 'Hello',
			artist: '',
			source: 'netease',
			songid: '7'
		});
		expect(url.endsWith('/album/hello-netease7')).toBe(true);
	});

	it('drops the leading hyphen when the slug is empty (all-CJK title)', () => {
		const url = entityShareUrl('song', {
			title: '情非得已',
			artist: '',
			source: 'qq',
			songid: '123'
		});
		expect(url.endsWith('/song/qq123')).toBe(true);
		expect(url.endsWith('/song/-qq123')).toBe(false);
	});

	it('parses a slug-prefixed param back to {source, id, uid}', () => {
		expect(parseEntityParam('qing-fei-de-yi-qq123')).toEqual({
			source: 'qq',
			id: '123',
			uid: 'qq:123'
		});
	});

	it('parses an empty-slug param ({source}{id} only) back to {source, id, uid}', () => {
		expect(parseEntityParam('qq123')).toEqual({ source: 'qq', id: '123', uid: 'qq:123' });
		expect(parseEntityParam('netease7')).toEqual({
			source: 'netease',
			id: '7',
			uid: 'netease:7'
		});
	});

	it('WR-02: the returned uid is the canonical colon form matching makeUid', () => {
		const t = mk('qq', '123', 'X', 'Y');
		const parsed = parseEntityParam(entityShareUrl('song', t).split('/').pop()!);
		expect(parsed?.uid).toBe(t.uid); // makeUid('qq','123') === 'qq:123'
		expect(parsed?.uid).toBe(`${parsed?.source}:${parsed?.id}`);
	});

	it('WR-03: does not mis-split a slug whose text contains an earlier source-name word', () => {
		// The cosmetic slug contains `kuwo` as a word, but the authoritative key is the LAST
		// `-{source}{id}` boundary (`-qq42`). A greedy/leftmost match would have split on `kuwo`.
		expect(parseEntityParam('kuwo-mix-qq42')).toEqual({ source: 'qq', id: '42', uid: 'qq:42' });
		// Two source-name words in the slug — still anchors on the trailing one.
		expect(parseEntityParam('netease-fan-club-qq42')).toEqual({
			source: 'qq',
			id: '42',
			uid: 'qq:42'
		});
	});

	it('returns null on no source-enum match, never throws (T-24-03)', () => {
		expect(parseEntityParam('no-source-here')).toBeNull();
		expect(parseEntityParam('')).toBeNull();
		expect(parseEntityParam('spotify123')).toBeNull();
	});

	it('decodes the full live SourceId set, incl. fivesing/jamendo (24-04 enum reconcile)', () => {
		expect(parseEntityParam('fivesing12345')).toEqual({
			source: 'fivesing',
			id: '12345',
			uid: 'fivesing:12345'
		});
		expect(parseEntityParam('jamendo987')).toEqual({
			source: 'jamendo',
			id: '987',
			uid: 'jamendo:987'
		});
		expect(parseEntityParam('some-song-fivesingAB99')).toEqual({
			source: 'fivesing',
			id: 'AB99',
			uid: 'fivesing:AB99'
		});
	});

	it('rejects the stale kugou/migu enum that does not exist in SourceId (24-04)', () => {
		expect(parseEntityParam('kugou123')).toBeNull();
		expect(parseEntityParam('migu456')).toBeNull();
	});

	it('round-trips the authoritative {source}{id} key through build → parse', () => {
		for (const t of [
			{ title: 'Dao Xiang', artist: 'Jay Chou', source: 'netease', songid: '1' },
			{ title: '情非得已', artist: '', source: 'qq', songid: '123' },
			{ title: 'Mixed 标题', artist: 'X', source: 'kuwo', songid: 'AB99' }
		] as const) {
			const param = entityShareUrl('song', t).split('/').pop()!;
			expect(parseEntityParam(param)).toEqual({
				source: t.source,
				id: t.songid,
				uid: `${t.source}:${t.songid}`
			});
		}
	});
});

describe('buildOg / isHttpsUrl (item 4 helper)', () => {
	it('builds a bullet-separated Song • Artist title + short listen tagline (quick-260723-r4p)', () => {
		const og = buildOg({ title: 'Dao Xiang', artist: 'Jay Chou', cover: 'https://cdn/c.jpg' });
		expect(og.title).toBe('Dao Xiang • Jay Chou');
		expect(og.description).toBe('Listen on openmusic');
		expect(og.description).toMatch(/openmusic/i);
		expect(og.description).toMatch(/listen/i);
		expect(og.image).toBe('https://cdn/c.jpg');
	});

	it('omits a non-https cover (falls to null so the caller uses the static fallback)', () => {
		expect(buildOg({ title: 'X', cover: 'http://insecure/c.jpg' }).image).toBeNull();
		expect(buildOg({ title: 'X', cover: null }).image).toBeNull();
		expect(buildOg({ title: 'X', cover: 'data:image/png;base64,AAAA' }).image).toBeNull();
	});

	it('title without an artist is just the title', () => {
		expect(buildOg({ title: 'Just Title' }).title).toBe('Just Title');
	});

	it('OG-PAGE-01: type defaults to music.song and is overridable per surface', () => {
		expect(buildOg({ title: 'X' }).type).toBe('music.song');
		expect(buildOg({ title: 'X', type: 'music.album' }).type).toBe('music.album');
		expect(buildOg({ title: 'X', type: 'profile' }).type).toBe('profile');
	});

	it('isHttpsUrl accepts https only', () => {
		expect(isHttpsUrl('https://x.com/a.jpg')).toBe(true);
		expect(isHttpsUrl('http://x.com/a.jpg')).toBe(false);
		expect(isHttpsUrl(null)).toBe(false);
		expect(isHttpsUrl(undefined)).toBe(false);
	});
});
