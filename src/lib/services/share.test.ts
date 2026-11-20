import { describe, it, expect, vi, afterEach } from 'vitest';
import { readFileSync } from 'node:fs';
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
	isHttpsUrl,
	shareOrigin
} from './share';
import { coverUrlFromToken } from '$lib/proxy/og-cover';
import { matchKey } from '$lib/services/dedupe';
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
	it('quick-261120-mediacard: builds the PATH form ${origin}/api/og/{type}/{artist}/{title} — keywords only', () => {
		expect(ogImageUrl('https://openmusic.lol', 'song', 'Nirvana', 'Come As You Are')).toBe(
			'https://openmusic.lol/api/og/song/Nirvana/Come-As-You-Are'
		);
		// Raw CJK segments, exactly like the share path itself (quick-260807-vl1).
		expect(ogImageUrl('https://openmusic.lol', 'album', '周杰倫', '范特西')).toBe(
			'https://openmusic.lol/api/og/album/周杰倫/范特西'
		);
	});

	it('omits the title segment entirely when there is no secondary name (artist card)', () => {
		const url = ogImageUrl('https://openmusic.lol', 'artist', 'Nirvana');
		expect(url).toBe('https://openmusic.lol/api/og/artist/Nirvana');
		expect(ogImageUrl('https://openmusic.lol', 'artist', 'Nirvana', '')).toBe(url);
	});

	it('carries NO query at all — no type=, no ci=, no u= (keyword-only ruling)', () => {
		for (const u of [
			ogImageUrl('https://openmusic.lol', 'song', 'Nirvana', 'Come As You Are'),
			ogImageUrl('https://openmusic.lol', 'album', '周杰倫', '范特西'),
			ogImageUrl('https://openmusic.lol', 'artist', 'Nirvana')
		]) {
			expect(u).not.toContain('?');
			expect(u).not.toContain('ci=');
			expect(u).not.toContain('u=');
		}
	});

	it('escapes a slash inside a name into ONE segment (the reported artist shape)', () => {
		expect(ogImageUrl('https://openmusic.lol', 'song', '茉ひる/Billy Choi', 'ロストライン')).toBe(
			'https://openmusic.lol/api/og/song/茉ひる%2FBilly-Choi/ロストライン'
		);
	});

	it('is pure — no location read, so an SSR loader can call it with any origin', () => {
		expect(ogImageUrl('', 'song', 'A', 'B')).toBe('/api/og/song/A/B');
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

describe('songShareUrl — keyword-only ruling (quick-261120-mediacard)', () => {
	it('the reported netease song shares as the BARE keyword path — no ?u=, no ?ci=', () => {
		// The 2026-11-20 WhatsApp report: this song's link used to carry ?u=netease3396263335
		// (and no ci, since netease covers never tokenized). The link is now keywords only;
		// resolution happens through the seam at arrival and at /api/og.
		const url = songShareUrl({ title: 'ロストライン', artist: '茉ひる/Billy Choi' });
		expect(url.endsWith('/song/茉ひる%2FBilly-Choi/ロストライン')).toBe(true);
		expect(url).not.toContain('?');
	});

	it('a Deezer/iTunes-covered song also emits NO carrier (the ci retirement)', () => {
		const url = songShareUrl({ title: '你瞞我瞞', artist: '陳柏宇' });
		expect(url.endsWith('/song/陳柏宇/你瞞我瞞')).toBe(true);
		expect(url).not.toContain('ci=');
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
		expect(og.description).toBe('Listen on OpenMusic');
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
	// TrackMenu.svelte is NOT in this list any more: its Share became a straight clipboard
	// copy (user call 2026-10-06, see the menu's own comment) — the gated nav.share sheet
	// survives on the album + artist pages only.
	it.each([
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
// LEGACY RECEPTION — coverUrlFromToken (quick-260809-3uo grammar, reception half only)
// =============================================================================================
// quick-261120-mediacard: the CLIENT half of this grammar (coverToken) is DELETED with the
// carrier emission it fed — share links are keyword-only now. The EDGE half stays: og:image
// URLs and share links already sent with a `ci` token must keep resolving (live compat).
// These pins keep the token → canonical-card-URL templates honest from the reception side.
describe('coverUrlFromToken — legacy reception templates (quick-261120-mediacard)', () => {
	it('rebuilds the probed canonical templates from literal tokens', async () => {
		expect(await coverUrlFromToken('d:fe1082c5ef54876802146897e76b592e')).toBe(
			'https://cdn-images.dzcdn.net/images/cover/fe1082c5ef54876802146897e76b592e/500x500-000000-80-0-0.jpg'
		);
		expect(await coverUrlFromToken('l:95f31bcdc1e942d3c24daa08dbf0e654.png')).toBe(
			'https://lastfm.freetls.fastly.net/i/u/300x300/95f31bcdc1e942d3c24daa08dbf0e654.png'
		);
		expect(await coverUrlFromToken('k:s4s27-11-1502064321')).toBe(
			'https://img4.kuwo.cn/star/albumcover/600/s4s27/11/1502064321.jpg'
		);
	});

	it('rejects junk tokens whole (unknown tag, bad shape, over cap, grey star)', async () => {
		expect(await coverUrlFromToken('x:fe1082c5ef54876802146897e76b592e')).toBeNull();
		expect(await coverUrlFromToken('d:nothex')).toBeNull();
		expect(await coverUrlFromToken('l:2a96cbd8b46e442fc41c2b86b821562f.png')).toBeNull();
		expect(await coverUrlFromToken('d:' + 'a'.repeat(200))).toBeNull();
		expect(await coverUrlFromToken('')).toBeNull();
		expect(await coverUrlFromToken(null)).toBeNull();
	});
});

// SOURCE GUARD — the TrackMenu share call site (quick-260809-3uo)
// ---------------------------------------------------------------------------------------------
// doShare() is a component handler, not an export, and there is no jsdom project (vite.config.ts
// declares a single node project), so the SOURCE is the honest thing to guard. Each assertion below
// names the exact RED mutation it pins, and each was PROVEN to fail under that mutation before this
// was committed — a structural assertion that cannot fail is worse than none.
describe('TrackMenu share call site — source guard (quick-260809-3uo, amended quick-261120-mediacard)', () => {
	const src = readFileSync(
		new URL('../components/TrackMenu.svelte', import.meta.url),
		'utf8'
	);

	it('looks the cover up with the RAW catalog names, never the display-converted ones', () => {
		// RED under: readCoverByUidOrName(track.uid, dArtist, dTitle) — the silent zh-Hant cache miss.
		// The name layer is matchKey'd on catalog metadata, so display strings would miss it for
		// exactly the users quick-260808-urx's conversion exists for.
		expect(src).toMatch(/readCoverByUidOrName\(track\.uid, track\.artist, track\.title\)/);
	});

	it('never passes the display strings into the cache lookup (the negative half)', () => {
		expect(src).not.toMatch(/readCoverByUidOrName\(track\.uid, dArtist/);
		expect(src).not.toMatch(/readCoverByUidOrName\(track\.uid, dTitle/);
	});

	it('quick-261120-mediacard: passes NO carrier argument to songShareUrl (keyword-only)', () => {
		// RED under: re-adding a 2nd argument (a cover or identity carrier) — the retired
		// emission. Anchored on the whole single-line call: the closing paren must follow the
		// names object directly.
		expect(src).toMatch(/songShareUrl\(\{ title: dTitle, artist: dArtist \}\)/);
		expect(src).not.toMatch(/songShareUrl\(\{ title: dTitle, artist: dArtist \}, /);
	});

	it('prefers the hero cover only when the menu is on the PLAYING song', () => {
		// RED under: dropping the uid identity check, which would stamp the now-playing art onto a
		// share of some OTHER row.
		// quick-260920-oj8: the FIELD changed from `resolvedCover` to `displayCover` — the identity
		// check this pins did not. See the describe below for why the field matters.
		expect(src).toMatch(/player\.current\?\.uid === track\.uid \? player\.displayCover : null/);
	});
});

// quick-260920-oj8 — the `activeCover` ladder reads the ONE now-playing cover reader.
//
// WHY HERE: this file already owns the TrackMenu source guards (same expression, same reason — a
// component-instance `$derived` in a `.svelte` file with no jsdom project to mount it in), so the
// ladder keeps ONE guard rather than a second copy in a second file.
//
// WHAT CHANGED: the playing-song rung was `player.resolvedCover`, the OLD precedence. quick-260920-nyq
// made the hero / Nowbar / OS media card paint from the shared cover cache first, leaving this ladder
// able to tick a picker tile that is NOT the art on screen. The user's call — "everywhere cover is
// shown is run through the same cover resolver, same chain, so same song have the same cover
// everywhere" — makes `player.displayCover` (pin → uid → name → resolvedCover, embedded `data:` ahead
// of the https-only cache per 37-D-02) the single reader.
//
// The BEHAVIOURAL divergence (cache holds cover A, resolvedCover holds cover B, the site must yield A)
// is asserted where it can actually run: `player.svelte.test.ts` for the getter, and
// `download-track.test.ts` for the other site closed by the same task.
describe('TrackMenu activeCover — quick-260920-oj8 one cover reader', () => {
	// Comment lines stripped: the guard forbids an identifier the comments above it legitimately NAME.
	const ladder = (() => {
		const src = readFileSync(new URL('../components/TrackMenu.svelte', import.meta.url), 'utf8');
		const start = src.indexOf('const activeCover = $derived(');
		const end = src.indexOf('\n\t);', start);
		return src
			.slice(start, end)
			.split('\n')
			.filter((l) => !/^\s*(\/\/|\*|\/\*)/.test(l))
			.join('\n');
	})();

	it('reads player.displayCover for the playing song and never player.resolvedCover', () => {
		// RED under: reverting the rung — the picker would tick a tile the hero is not showing.
		expect(ladder).toContain('player.displayCover');
		expect(ladder).not.toContain('player.resolvedCover');
	});

	it('keeps the pin first and track.cover last', () => {
		// RED under: reordering the rungs — a user's explicit pin must outrank every resolver, and the
		// stub's own art stays the last resort before the gradient. Phase 40 D-14: the leading rung is
		// readChosenCover (pin ?? crowd pick), so the picker pre-selects the crowd choice too.
		const pin = ladder.indexOf('readChosenCover(');
		const playing = ladder.indexOf('player.displayCover');
		const cached = ladder.indexOf('readCoverByUidOrName(');
		const seeded = ladder.indexOf('track.cover');
		expect(pin).toBeGreaterThan(-1);
		expect(playing).toBeGreaterThan(pin);
		expect(cached).toBeGreaterThan(playing);
		expect(seeded).toBeGreaterThan(cached);
	});
});


// quick-260919-0mw — shareOrigin(). A share link is for SOMEONE ELSE's browser, so the runtime
// origin is only usable when it is a real web origin. The APK WebView reports `https://localhost`
// and a dev server `http://localhost:4321`; both produced dead links. The WEB behaviour must not
// move — that is the first two cases and the byte-identity check at the bottom.
describe('shareOrigin — public-origin fallback (quick-260919-0mw)', () => {
	afterEach(() => {
		vi.unstubAllGlobals();
		vi.unstubAllEnvs();
	});

	const withOrigin = (origin: string) => vi.stubGlobal('location', { origin });

	it('passes a real web origin through UNCHANGED (deployed site is byte-identical to today)', () => {
		withOrigin('https://openmusic.lol');
		expect(shareOrigin()).toBe('https://openmusic.lol');
	});

	it('passes ANY real web origin through, including a preview deployment', () => {
		withOrigin('https://some-preview.pages.dev');
		expect(shareOrigin()).toBe('https://some-preview.pages.dev');
	});

	it('does NOT rewrite a legitimate host that merely CONTAINS "localhost"', () => {
		// The substring trap: `origin.includes('localhost')` would have rewritten this.
		withOrigin('https://localhost.example.com');
		expect(shareOrigin()).toBe('https://localhost.example.com');
	});

	it('rewrites the APK WebView origin https://localhost to the public origin', () => {
		withOrigin('https://localhost');
		expect(shareOrigin()).toBe('https://openmusic.lol');
	});

	it('rewrites capacitor://localhost', () => {
		withOrigin('capacitor://localhost');
		expect(shareOrigin()).toBe('https://openmusic.lol');
	});

	it('rewrites a local dev-server origin (both localhost and 127.0.0.1, any port)', () => {
		withOrigin('http://localhost:4321');
		expect(shareOrigin()).toBe('https://openmusic.lol');
		withOrigin('http://127.0.0.1:5173');
		expect(shareOrigin()).toBe('https://openmusic.lol');
	});

	it('rewrites a file: origin and the literal "null" an opaque origin yields', () => {
		withOrigin('file://');
		expect(shareOrigin()).toBe('https://openmusic.lol');
		withOrigin('null');
		expect(shareOrigin()).toBe('https://openmusic.lol');
	});

	it('prefers the build-time VITE_API_BASE over the hardcoded fallback (one owner for the domain)', () => {
		vi.stubEnv('VITE_API_BASE', 'https://staging.openmusic.lol');
		withOrigin('https://localhost');
		expect(shareOrigin()).toBe('https://staging.openmusic.lol');
	});

	it('returns "" under SSR so the link stays relative, exactly as before', () => {
		// No location stub — `typeof location === 'undefined'`, the server-import case.
		expect(shareOrigin()).toBe('');
	});
});

describe('share builders use shareOrigin (quick-260919-0mw)', () => {
	afterEach(() => vi.unstubAllGlobals());

	const track = { title: '愛得太遲', artist: '古巨基' };

	it('songShareUrl: the reported https://localhost link becomes the public one, path byte-identical', () => {
		vi.stubGlobal('location', { origin: 'https://openmusic.lol' });
		const web = songShareUrl(track);
		vi.stubGlobal('location', { origin: 'https://localhost' });
		const apk = songShareUrl(track);

		expect(web.startsWith('https://openmusic.lol/song/')).toBe(true);
		expect(apk).toBe(web); // ONLY the origin differed — path segments and raw CJK are unchanged
		// The reported broken shape, now repaired end to end (raw CJK preserved, quick-260807-vl1).
		expect(apk).toBe('https://openmusic.lol/song/古巨基/愛得太遲');
	});

	it('shareUrl / entityCardUrl / entityShareUrl are ALL fixed, not just the reported one', () => {
		vi.stubGlobal('location', { origin: 'https://localhost' });
		const t = {
			uid: 'kuwo:1',
			source: 'kuwo' as const,
			songid: '1',
			title: 'Hello',
			artist: 'Adele',
			album: '25',
			cover: null,
			audioUrl: null,
			lrc: null,
			lrcUrl: null,
			detailsLoaded: false,
			quality: null,
			qualityLabel: null,
			keyword: 'x',
			displayIndex: 1
		};
		expect(shareUrl(t).startsWith('https://openmusic.lol/?')).toBe(true);
		expect(entityCardUrl({ type: 'artist', name: 'Adele' })).toBe(
			'https://openmusic.lol/artist/Adele'
		);
		expect(entityCardUrl({ type: 'album', name: '25', artist: 'Adele' })).toBe(
			'https://openmusic.lol/album/Adele/25'
		);
		expect(entityShareUrl('song', t).startsWith('https://openmusic.lol/song/')).toBe(true);
	});
});
