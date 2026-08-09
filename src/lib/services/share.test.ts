import { describe, it, expect, vi } from 'vitest';
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
	coverToken,
	entityCardUrl,
	entityShareUrl,
	parseEntityParam,
	buildOg,
	isHttpsUrl
} from './share';
import { coverUrlFromToken } from '$lib/proxy/og-cover';
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
function decodeSeg(seg: string): string {
	return decodePathSegment(decodeURIComponent(seg));
}
function roundTrip(raw: string): string {
	return decodeSeg(encodePathSegment(raw));
}

describe('encodePathSegment / decodePathSegment (OG-PATH-01 codec)', () => {
	it('preserves original case and collapses whitespace runs to a single hyphen', () => {
		expect(encodePathSegment('Come As You Are')).toBe('Come-As-You-Are');
		// Case is PRESERVED on purpose — the OG card title is read straight back out of the path.
		expect(encodePathSegment('DNA')).toBe('DNA');
		// A whitespace RUN collapses to ONE '-' (`\s+` → '-'), so a double space does not emit
		// 'A--B'. (RESEARCH §B.7's `A--B` cell contradicts §B.6's drafted code; the code is
		// authoritative and the round-trip result is 'A B' either way.)
		expect(encodePathSegment('A  B')).toBe('A-B');
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

	it('quick-260807-vl1: leaves CJK / emoji / Arabic RAW (a path segment is NOT ASCII-limited)', () => {
		// Live-verified against production BEFORE this change: `/song/周傑倫/止戰之殤` (raw,
		// unencoded) answers 200 with og:title `止戰之殤 • 周傑倫`. Escaping it was legal but
		// unreadable in the message a recipient actually sees.
		expect(encodePathSegment('稻香')).toBe('稻香');
		expect(encodePathSegment('周杰倫')).toBe('周杰倫');
		expect(encodePathSegment('周傑倫')).toBe('周傑倫');
		expect(encodePathSegment('🎵Song')).toBe('🎵Song');
		expect(encodePathSegment('أغنية')).toBe('أغنية');
		// …and NOT a single percent-escape anywhere in a raw-UTF-8 segment.
		expect(encodePathSegment('止戰之殤')).not.toContain('%');
	});

	it('still percent-escapes the genuinely path-unsafe set: % / \\ ? # and control chars', () => {
		expect(encodePathSegment('A/B')).toBe('A%2FB');
		expect(encodePathSegment('50% Off')).toBe('50%25-Off');
		expect(encodePathSegment('A?B')).toBe('A%3FB');
		expect(encodePathSegment('#1 Hit')).toBe('%231-Hit');
		// A raw backslash is NORMALIZED to '/' by WHATWG URL parsers in a special-scheme path,
		// so it splits the segment exactly like '/' — same failure class, same escape.
		expect(encodePathSegment('AC\\DC')).toBe('AC%5CDC');
		expect(encodePathSegment('A\u0000B')).toBe('A%00B');
		expect(encodePathSegment('A\u001FB')).toBe('A%1FB');
		expect(encodePathSegment('A\u007FB')).toBe('A%7FB');
		// ONE pass: the '%25' emitted for '%' is never re-scanned, so it cannot double-escape.
		expect(encodePathSegment('100%')).toBe('100%25');
		expect(encodePathSegment('%2F')).toBe('%252F');
	});

	it('leaves legal path sub-delims literal (& + : ; =) — they round-trip untouched', () => {
		expect(encodePathSegment('R&B')).toBe('R&B');
		expect(encodePathSegment('C+D')).toBe('C+D');
		expect(encodePathSegment('A:B;C=D')).toBe('A:B;C=D');
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

describe('songShareUrl (OG-PATH-02 — carrier-free /song/{artist}/{title})', () => {
	it('emits two path segments, ARTIST FIRST, with original case preserved (DQ-1)', () => {
		expect(songShareUrl({ title: 'Dao Xiang', artist: 'Jay Chou' }).endsWith('/song/Jay-Chou/Dao-Xiang')).toBe(true);
		expect(songShareUrl({ title: 'Come As You Are', artist: 'Nirvana' }).endsWith('/song/Nirvana/Come-As-You-Are')).toBe(true);
	});

	it('carries ZERO query params — no `?` at all (the headline OG-PATH-02 assertion)', () => {
		for (const t of [
			{ title: 'Dao Xiang', artist: 'Jay Chou' },
			{ title: '稻香', artist: '周杰倫' },
			{ title: 'Solo', artist: '' }
		]) {
			const url = songShareUrl(t);
			expect(url).not.toContain('?');
			expect(url).not.toContain('play=');
			expect(url).not.toContain('n=');
			expect(url).not.toContain('a=');
			expect(url).not.toContain('c=');
			expect(url).not.toContain('dn='); // OG-ZH-01: no display carriers anywhere
			expect(url).not.toContain('da=');
		}
	});

	it('keeps the LITERAL CJK title/artist in the path and round-trips them (no ASCII slug)', () => {
		const url = songShareUrl({ title: '稻香', artist: '周杰倫' });
		// quick-260807-vl1: RAW CJK, not the percent-escaped form the old encoder emitted.
		expect(url.endsWith('/song/周杰倫/稻香')).toBe(true);
		const [artistSeg, titleSeg] = url.split('/song/')[1].split('/');
		expect(decodeSeg(artistSeg)).toBe('周杰倫');
		expect(decodeSeg(titleSeg)).toBe('稻香');
	});

	it('quick-260807-vl1: the production repro shares as raw CJK, zero percent-escapes', () => {
		// The exact defect Phase 30's crawler checkpoint found: this link read
		// `/song/%E5%91%A8%E5%82%91%E5%80%AB/%E6%AD%A2%E6%88%B0%E4%B9%8B%E6%AE%A4`.
		const url = songShareUrl({ title: '止戰之殤', artist: '周傑倫' });
		expect(url.endsWith('/song/周傑倫/止戰之殤')).toBe(true);
		expect(url).not.toContain('%');
	});

	it('an empty artist yields the `-` guard segment (never an empty segment, which 404s)', () => {
		const url = songShareUrl({ title: 'Solo', artist: '' });
		expect(url.endsWith('/song/-/Solo')).toBe(true);
		expect(url).not.toContain('/song//');
	});

	it('the trailing segment is the encoded TITLE, never a {source}{id} key (DQ-4)', () => {
		const url = songShareUrl({ title: 'Dao Xiang', artist: 'Jay Chou' });
		expect(parseEntityParam(url.split('/').pop()!)).toBeNull();
	});
});

describe('entityCardUrl (quick-260723-ry1 — carrier-free album/artist card)', () => {
	it('album emits /album/{artist}/{name} — the artist is now segment 1, not ?artist=', () => {
		const url = entityCardUrl({ type: 'album', name: '范特西', artist: '周杰倫' });
		// quick-260807-vl1: raw CJK segments, same encoder change as the song card.
		expect(url.endsWith('/album/周杰倫/范特西')).toBe(true);
		expect(url).not.toContain('%');
		// Both halves of the authoritative tracklist key round-trip out of the path.
		const [artistSeg, nameSeg] = url.split('/album/')[1].split('/');
		expect(decodeSeg(artistSeg)).toBe('周杰倫');
		expect(decodeSeg(nameSeg)).toBe('范特西');
		expect(entityCardUrl({ type: 'album', name: 'Nevermind', artist: 'Nirvana' }).endsWith('/album/Nirvana/Nevermind')).toBe(true);
	});

	it('an album with no artist still emits two segments via the `-` guard', () => {
		expect(entityCardUrl({ type: 'album', name: 'Nevermind' }).endsWith('/album/-/Nevermind')).toBe(true);
	});

	it('artist stays ONE segment (no secondary name)', () => {
		expect(entityCardUrl({ type: 'artist', name: 'Jay' }).endsWith('/artist/Jay')).toBe(true);
		expect(entityCardUrl({ type: 'artist', name: '周杰倫' }).endsWith('/artist/周杰倫')).toBe(true);
	});

	it('carries ZERO query params on BOTH surfaces (OG-PATH-02 + OG-ZH-01)', () => {
		for (const url of [
			entityCardUrl({ type: 'album', name: '范特西', artist: '周杰伦' }),
			entityCardUrl({ type: 'album', name: 'A', artist: 'B' }),
			entityCardUrl({ type: 'artist', name: 'Jay' }),
			entityCardUrl({ type: 'artist', name: '周杰伦' })
		]) {
			expect(url).not.toContain('?');
			expect(url).not.toContain('artist=');
			expect(url).not.toContain('c=');
			expect(url).not.toContain('dn=');
			expect(url).not.toContain('da=');
		}
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

describe('nav.share carries the link in text, not url (quick-260808-vkd)', () => {
	// The Web Share API URL-PARSES and re-serializes `ShareData.url`, and the WHATWG URL serializer
	// percent-encodes every path code point above U+007E — so a `url` member silently undoes
	// encodePathSegment's raw-CJK output (quick-260807-vl1) at the very last step. `ShareData.text`
	// is passed through verbatim. This is the same structural-assertion technique as
	// names.test.ts:206-233 (quick-260808-urx): the three handlers live in .svelte components, are
	// not exported, and there is no jsdom project — so assert the call shape at the source. This is
	// the one check that fails if someone "fixes" `text` back to `url`.
	//
	// quick-260808-vzu — the `title` line is now GATED on `settings.shareIncludeTitle` (default
	// OFF). Concatenating targets (WhatsApp) render `title` and `text` as two separate lines, so an
	// unconditional title duplicated the OG card, which already shows `Song • Artist` beneath the
	// link. Test 2 below pins that: no ungated object-literal `nav.share({…})` call may come back.
	it.each([
		'src/lib/components/TrackMenu.svelte',
		'src/routes/(app)/album/[name]/+page.svelte',
		'src/routes/(app)/artist/[name]/+page.svelte'
	])('%s gates the nav.share title on the setting and keeps the link in `text`', async (file) => {
		const { readFileSync } = await import('node:fs');
		const src = readFileSync(file, 'utf8');
		// `title` exists ONLY in the true branch of a ternary gated on the setting; the false branch
		// is exactly `{ text: url }` — link only, no placeholder title (the Web Share spec's
		// at-least-one-member rule is satisfied by `text` alone).
		expect(src).toMatch(
			/nav\.share\(settings\.shareIncludeTitle\s*\?\s*\{\s*title[\s\S]*?text: url\s*\}\s*:\s*\{\s*text: url\s*\}\)/
		);
		// No direct object-literal call survives — every payload must route through the gate.
		expect(src).not.toMatch(/nav\.share\(\{/);
		// vkd's invariant, re-anchored from `nav.share({` to `nav.share(` so it still binds after
		// the ternary lands: there is NO bare `url` ShareData member. Not merely moved — REMOVED:
		// many share targets concatenate `text` and `url`, which would put the link in the message
		// twice, once readable and once percent-encoded, worse than the original bug.
		expect(src).not.toMatch(/nav\.share\([^)]*[,{]\s*url\s*[,})]/);
	});
});

// =============================================================================================
// quick-260809-3uo — coverToken: the CLIENT half of the `ci` cover-id carrier
// =============================================================================================
// The client holds the cover the user is actually looking at; /api/og re-resolves from TEXT and is
// structurally blind to it. coverToken derives a SHORT id from that URL; coverUrlFromToken (edge)
// rebuilds the canonical card URL from its own fixed template.
//
// The fixture URLs below are REAL, LIVE-PROBED 2026-08-09 (see og-endpoint.test.ts for the statuses)
// — not invented shapes.

const REAL_DZ_1000 =
	'https://cdn-images.dzcdn.net/images/cover/fe1082c5ef54876802146897e76b592e/1000x1000-000000-80-0-0.jpg';
const REAL_DZ_500 =
	'https://cdn-images.dzcdn.net/images/cover/fe1082c5ef54876802146897e76b592e/500x500-000000-80-0-0.jpg';
const REAL_DZ_ARTIST =
	'https://cdn-images.dzcdn.net/images/artist/58562952a0f20fb0948cdce22a601794/500x500-000000-80-0-0.jpg';
const REAL_LF_300 = 'https://lastfm.freetls.fastly.net/i/u/300x300/95f31bcdc1e942d3c24daa08dbf0e654.png';
const REAL_LF_ALIAS =
	'https://lastfm-img.freetls.fastly.net/i/u/770x0/95f31bcdc1e942d3c24daa08dbf0e654.png';
const REAL_LF_GREY = 'https://lastfm.freetls.fastly.net/i/u/300x300/2a96cbd8b46e442fc41c2b86b821562f.png';
const REAL_KW_600 = 'https://img4.kuwo.cn/star/albumcover/600/s4s27/11/1502064321.jpg';
const REAL_KW_150 = 'https://img1.kuwo.cn/star/albumcover/150/s4s79/80/1907599981.jpg';
const REAL_KW_HEAD = 'https://img1.kuwo.cn/star/starheads/600/s4s23/72/966643473.jpg';
// The reported song: 你瞞我瞞 / 陳柏宇 — "Quinquennium", collectionId 446760418.
const REAL_IT_1200 =
	'https://is1-ssl.mzstatic.com/image/thumb/Music221/v4/44/ab/f4/44abf48c-3f51-31b9-469a-6d99548070e1/886443102378.jpg/1200x1200bb.jpg';

describe('coverToken (quick-260809-3uo) — URL → short cover id, null for anything else', () => {
	it('tokenizes a Deezer ALBUM cover at ANY size to the same d:<32hex>', () => {
		expect(coverToken(REAL_DZ_1000)).toBe('d:fe1082c5ef54876802146897e76b592e');
		expect(coverToken(REAL_DZ_500)).toBe('d:fe1082c5ef54876802146897e76b592e');
		expect(coverToken(REAL_DZ_1000.replace('1000x1000', '56x56'))).toBe(
			'd:fe1082c5ef54876802146897e76b592e'
		);
	});

	it('rejects a Deezer ARTIST picture — out of grammar, not merely unpreferred', () => {
		expect(coverToken(REAL_DZ_ARTIST)).toBeNull();
	});

	it('tokenizes Last.fm art at any size segment and on either host alias, keeping the ext', () => {
		expect(coverToken(REAL_LF_300)).toBe('l:95f31bcdc1e942d3c24daa08dbf0e654.png');
		expect(coverToken(REAL_LF_ALIAS)).toBe('l:95f31bcdc1e942d3c24daa08dbf0e654.png');
		expect(coverToken(REAL_LF_300.replace('.png', '.jpg'))).toBe(
			'l:95f31bcdc1e942d3c24daa08dbf0e654.jpg'
		);
		// The size-less form Last.fm also serves.
		expect(coverToken('https://lastfm.freetls.fastly.net/i/u/95f31bcdc1e942d3c24daa08dbf0e654.png')).toBe(
			'l:95f31bcdc1e942d3c24daa08dbf0e654.png'
		);
	});

	it('NEVER carries the Last.fm grey-star placeholder', () => {
		expect(coverToken(REAL_LF_GREY)).toBeNull();
	});

	it('tokenizes a kuwo ALBUM cover at any size / either image host', () => {
		expect(coverToken(REAL_KW_600)).toBe('k:s4s27-11-1502064321');
		expect(coverToken(REAL_KW_150)).toBe('k:s4s79-80-1907599981');
	});

	it('rejects a kuwo starheads (artist) image — a different path family', () => {
		expect(coverToken(REAL_KW_HEAD)).toBeNull();
	});

	it('emits i:<digits> ONLY when the caller supplies the retained iTunes id', () => {
		expect(coverToken(REAL_IT_1200, '446760418')).toBe('i:446760418');
		// A cover cached BEFORE this change has no retained id → no carrier → today's tier chain.
		expect(coverToken(REAL_IT_1200)).toBeNull();
		expect(coverToken(REAL_IT_1200, '')).toBeNull();
		expect(coverToken(REAL_IT_1200, null)).toBeNull();
	});

	it('refuses a non-numeric / over-length / injected iTunes id rather than emitting junk', () => {
		for (const bad of ['44676041a', '4467604180000', '446760418/../9', '446 760', '../../x', '-1'])
			expect(coverToken(REAL_IT_1200, bad)).toBeNull();
	});

	it('ignores an iTunes id supplied alongside a NON-iTunes cover (the URL decides the tag)', () => {
		expect(coverToken(REAL_DZ_500, '446760418')).toBe('d:fe1082c5ef54876802146897e76b592e');
	});

	it('returns null for hosts on NO tier allow-list (netease / qq / joox) — the set never widens', () => {
		for (const url of [
			'https://p1.music.126.net/abcdefghijklmnopqrstuv==/109951165.jpg',
			'https://y.qq.com/music/photo_new/T002R500x500M000004Z8ZlG3Zwvbk.jpg',
			'https://p.qpic.cn/music_cover/abc/300.jpg',
			'https://api.joox.com/cover/abc.jpg'
		])
			expect(coverToken(url)).toBeNull();
	});

	it('returns null for non-https, relative, garbage and empty input, and never throws', () => {
		for (const bad of [
			REAL_DZ_500.replace('https:', 'http:'),
			'data:image/png;base64,AAAA',
			'/images/cover/fe1082c5ef54876802146897e76b592e/500x500-000000-80-0-0.jpg',
			'not a url',
			'',
			'   ',
			null,
			undefined
		])
			expect(coverToken(bad)).toBeNull();
	});

	it('rejects a look-alike host that merely CONTAINS an allow-listed one', () => {
		for (const bad of [
			'https://cdn-images.dzcdn.net.evil.example/images/cover/fe1082c5ef54876802146897e76b592e/500x500-000000-80-0-0.jpg',
			'https://evil.example/cdn-images.dzcdn.net/images/cover/fe1082c5ef54876802146897e76b592e/500x500-000000-80-0-0.jpg',
			'https://notlastfm.freetls.fastly.net.evil/i/u/300x300/95f31bcdc1e942d3c24daa08dbf0e654.png',
			'https://img4.kuwo.cn.evil.example/star/albumcover/600/s4s27/11/1502064321.jpg'
		])
			expect(coverToken(bad)).toBeNull();
	});
});

// ---------------------------------------------------------------------------------------------
// D6 — THE ANTI-DRIFT TEST. Imports BOTH directions.
// ---------------------------------------------------------------------------------------------
// coverToken (client, share.ts) and coverUrlFromToken (edge, og-cover.ts) are deliberately NOT
// imported into each other — client/edge split, and og-cover pulls in proxy code. THIS is what pins
// them: a one-sided grammar edit fails here instead of silently blanking every card.
describe('coverToken ⇄ coverUrlFromToken — both-directions round-trip (D6 / T-3uo-08)', () => {
	it('every covered tier rebuilds to the canonical CARD url, and re-tokenizes to the SAME token', async () => {
		for (const real of [REAL_DZ_1000, REAL_DZ_500, REAL_LF_300, REAL_LF_ALIAS, REAL_KW_600, REAL_KW_150]) {
			const token = coverToken(real);
			expect(token).not.toBeNull();
			const rebuilt = await coverUrlFromToken(token);
			expect(rebuilt).not.toBeNull();
			// Token-level identity: size is normalized by design, so the URL need not round-trip.
			expect(coverToken(rebuilt)).toBe(token);
		}
	});

	it('EVERY token coverToken can emit is ACCEPTED by coverUrlFromToken (no silent blanking)', async () => {
		const emitted = [
			coverToken(REAL_DZ_1000),
			coverToken(REAL_LF_300),
			coverToken(REAL_LF_300.replace('.png', '.jpg')),
			coverToken(REAL_KW_600),
			coverToken(REAL_IT_1200, '446760418')
		];
		expect(emitted.every((t) => typeof t === 'string' && t.length > 0)).toBe(true);
		for (const token of emitted) {
			// `i` is the one tag that costs a lookup — stub it, this test is about GRAMMAR agreement.
			vi.stubGlobal(
				'fetch',
				vi.fn(async () =>
					new Response(
						JSON.stringify({
							results: [
								{
									artworkUrl100:
										'https://is1-ssl.mzstatic.com/image/thumb/Music221/v4/44/ab/f4/x/886443102378.jpg/100x100bb.jpg'
								}
							]
						}),
						{ status: 200, headers: { 'content-type': 'application/json' } }
					)
				)
			);
			expect(await coverUrlFromToken(token)).not.toBeNull();
			vi.unstubAllGlobals();
		}
	});

	it('the rebuilt Deezer/kuwo/Last.fm urls are exactly the probed canonical templates', async () => {
		expect(await coverUrlFromToken(coverToken(REAL_DZ_1000))).toBe(REAL_DZ_500);
		expect(await coverUrlFromToken(coverToken(REAL_LF_ALIAS))).toBe(REAL_LF_300);
		expect(await coverUrlFromToken(coverToken(REAL_KW_600))).toBe(REAL_KW_600);
	});
});

describe('songShareUrl + ogImageUrl carry the token (quick-260809-3uo)', () => {
	it('with NO cover argument it is byte-identical to today — still ZERO query params', () => {
		const url = songShareUrl({ title: '你瞞我瞞', artist: '陳柏宇' });
		expect(url).not.toContain('?');
		expect(url.endsWith('/song/陳柏宇/你瞞我瞞')).toBe(true);
	});

	it('a cover that tokenizes to NULL adds no param at all (never an empty or junk `ci=`)', () => {
		for (const cover of [null, undefined, '', 'https://p1.music.126.net/x/1.jpg', REAL_LF_GREY])
			expect(songShareUrl({ title: 'A', artist: 'B' }, cover)).not.toContain('?');
	});

	it('a tokenizable cover appends exactly one encoded ci, leaving the raw-CJK path intact', () => {
		const url = songShareUrl({ title: '你瞞我瞞', artist: '陳柏宇' }, REAL_DZ_1000);
		expect(url).toBe(
			'/song/陳柏宇/你瞞我瞞?ci=d%3Afe1082c5ef54876802146897e76b592e'.replace(/^/, url.split('/song/')[0])
		);
		expect(url).toContain('/song/陳柏宇/你瞞我瞞?ci=');
		expect(url.match(/\?/g) ?? []).toHaveLength(1);
	});

	it('carries the iTunes id through when the caller supplies it (the reported case)', () => {
		const url = songShareUrl({ title: '你瞞我瞞', artist: '陳柏宇' }, REAL_IT_1200, '446760418');
		expect(url).toContain('?ci=i%3A446760418');
		// Without the retained id it degrades to today's carrier-free link.
		expect(songShareUrl({ title: '你瞞我瞞', artist: '陳柏宇' }, REAL_IT_1200)).not.toContain('?');
	});

	it('ogImageUrl is byte-identical without a token and appends &ci= after title with one', () => {
		expect(ogImageUrl('https://openmusic.lol', 'song', 'Nirvana', 'Come As You Are')).toBe(
			'https://openmusic.lol/api/og?type=song&artist=Nirvana&title=Come%20As%20You%20Are'
		);
		expect(ogImageUrl('https://openmusic.lol', 'song', 'Nirvana', 'Come As You Are', 'd:abc')).toBe(
			'https://openmusic.lol/api/og?type=song&artist=Nirvana&title=Come%20As%20You%20Are&ci=d%3Aabc'
		);
	});

	it('ogImageUrl drops an empty or over-cap token rather than emitting a pathological param', () => {
		const base = 'https://openmusic.lol/api/og?type=song&artist=Nirvana&title=Come%20As%20You%20Are';
		expect(ogImageUrl('https://openmusic.lol', 'song', 'Nirvana', 'Come As You Are', '')).toBe(base);
		expect(
			ogImageUrl('https://openmusic.lol', 'song', 'Nirvana', 'Come As You Are', 'd:' + 'a'.repeat(200))
		).toBe(base);
	});
});
