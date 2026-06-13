import { describe, it, expect } from 'vitest';
import {
	slugify,
	encodeShare,
	decodeShare,
	decodeTrack,
	encodeTrack,
	shareUrl,
	buildOg,
	isHttpsUrl
} from './share';
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

describe('buildOg / isHttpsUrl (item 4 helper)', () => {
	it('builds an artist-qualified title + listen description', () => {
		const og = buildOg({ title: 'Dao Xiang', artist: 'Jay Chou', cover: 'https://cdn/c.jpg' });
		expect(og.title).toBe('Dao Xiang — Jay Chou');
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

	it('isHttpsUrl accepts https only', () => {
		expect(isHttpsUrl('https://x.com/a.jpg')).toBe(true);
		expect(isHttpsUrl('http://x.com/a.jpg')).toBe(false);
		expect(isHttpsUrl(null)).toBe(false);
		expect(isHttpsUrl(undefined)).toBe(false);
	});
});
