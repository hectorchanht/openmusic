// quick-261122-ugcb3 — THE CHECK (pure validator) + record maths for community lyrics.
import { describe, it, expect } from 'vitest';
import {
	checkLyricText,
	parseLyricsBody,
	parseLyricsRecord,
	addVersion,
	pinVersion,
	reportVersion,
	publicVersions,
	canonicalVersion,
	emptyLyricsRecord,
	MAX_LYRIC_CHARS,
	HIDE_REPORTS
} from './community-lyrics';
import { serializeEditorLines, estimateLines } from '$lib/services/lyrics-editor';

const timed = (n: number, step = 4) =>
	Array.from({ length: n }, (_, i) => `[00:${String(i * step).padStart(2, '0')}.00]line ${i + 1}`).join('\n');

describe('checkLyricText — layer 1 format', () => {
	it('accepts a clean timed lyric and keeps the honest class', () => {
		expect(checkLyricText(timed(5))).toMatchObject({ ok: true, cls: 'precise' });
		expect(checkLyricText(timed(5), { estimated: true })).toMatchObject({ ok: true, cls: 'estimated' });
	});
	it('an ESTIMATED editor draft passes by construction (founding principle)', () => {
		const lrc = serializeEditorLines(estimateLines(['a', 'b', 'c', 'd', 'e', 'f'], 269));
		expect(checkLyricText(lrc, { durationSec: 269, estimated: true })).toMatchObject({ ok: true, cls: 'estimated' });
	});
	it('accepts unsynced plain text as the lower class', () => {
		expect(checkLyricText('a\nb\nc\nd\ne')).toMatchObject({ ok: true, cls: 'plain' });
	});
	it('rejects fewer than 5 lines', () => {
		expect(checkLyricText(timed(4))).toEqual({ ok: false, err: 'too-few-lines' });
		expect(checkLyricText('a\nb')).toEqual({ ok: false, err: 'too-few-lines' });
	});
	it('rejects non-monotonic start stamps (file order)', () => {
		const bad = '[00:10.00]a\n[00:05.00]b\n[00:12.00]c\n[00:14.00]d\n[00:16.00]e';
		expect(checkLyricText(bad)).toEqual({ ok: false, err: 'non-monotonic' });
	});
	it('rejects a stamp past duration + 15s, accepts within the slack', () => {
		expect(checkLyricText(timed(5, 10), { durationSec: 20 })).toEqual({ ok: false, err: 'past-end' });
		expect(checkLyricText(timed(5, 10), { durationSec: 30 })).toMatchObject({ ok: true });
	});
	it('rejects over the cap — never truncates', () => {
		expect(checkLyricText('x'.repeat(MAX_LYRIC_CHARS + 1))).toEqual({ ok: false, err: 'too-long' });
	});
	it('rejects URLs and HTML, but NOT enhanced-LRC character stamps', () => {
		expect(checkLyricText(timed(5) + '\n[00:30.00]www.spam.com')).toEqual({ ok: false, err: 'url' });
		expect(checkLyricText(timed(5) + '\n[00:30.00]<b>x</b>')).toEqual({ ok: false, err: 'html' });
		const enhanced = timed(4) + '\n[00:20.00]<00:20.00>我<00:20.50>愛<00:21.00>你';
		expect(checkLyricText(enhanced)).toMatchObject({ ok: true });
	});
	it('language is never a rejection reason', () => {
		const zh = ['[00:01.00]一', '[00:02.00]二', '[00:03.00]三', '[00:04.00]四', '[00:05.00]五'].join('\n');
		const ar = ['[00:01.00]واحد', '[00:02.00]اثنان', '[00:03.00]ثلاثة', '[00:04.00]أربعة', '[00:05.00]خمسة'].join('\n');
		expect(checkLyricText(zh).ok).toBe(true);
		expect(checkLyricText(ar).ok).toBe(true);
	});
	it('canonicalises: metadata lines dropped, CRLF + blank lines folded, control chars stripped', () => {
		const r = checkLyricText('[ti:Song]\r\n\r\n' + timed(5).replace('line 1', 'line\u0007 1'), { title: 'Song' });
		expect(r).toMatchObject({ ok: true });
		if (r.ok) {
			expect(r.lrc.startsWith('[00:00.00]line 1')).toBe(true);
			expect(r.lrc).not.toContain('[ti:');
		}
	});
});

describe('checkLyricText — layer 2 identity', () => {
	it('a [ti:]/[ar:] tag naming a different song is rejected', () => {
		expect(checkLyricText('[ti:Another Tune]\n' + timed(5), { title: 'Song' })).toEqual({ ok: false, err: 'identity-mismatch' });
		expect(checkLyricText('[ar:Someone]\n' + timed(5), { artist: 'Jack Choo' })).toEqual({ ok: false, err: 'identity-mismatch' });
	});
	it('a tag agreeing loosely (case, spacing, feat. suffix) passes', () => {
		expect(checkLyricText('[ar:JACK CHOO]\n' + timed(5), { artist: 'Jack Choo' }).ok).toBe(true);
		expect(checkLyricText('[ti:Song (Live)]\n' + timed(5), { title: 'Song' }).ok).toBe(true);
	});
});

describe('parseLyricsBody', () => {
	const K = 'ab'.repeat(16);
	it('submit needs k, lrc, title/artist strings and a token', () => {
		expect(parseLyricsBody(JSON.stringify({ k: K, lrc: 'x', title: 't', artist: 'a', token: 'tok' }))).toMatchObject({
			action: 'submit',
			estimated: false,
			duration: 0
		});
		expect(parseLyricsBody(JSON.stringify({ k: K, lrc: 'x', title: 't', artist: 'a' }))).toBeNull();
		expect(parseLyricsBody(JSON.stringify({ k: 'bad', lrc: 'x', title: 't', artist: 'a', token: 't' }))).toBeNull();
	});
	it('pin/report need a uuid id', () => {
		expect(parseLyricsBody(JSON.stringify({ k: K, action: 'pin', id: 'x' }))).toBeNull();
		expect(parseLyricsBody(JSON.stringify({ k: K, action: 'pin', id: '00000000-0000-4000-8000-000000000001' }))).toMatchObject({ action: 'pin' });
	});
});

describe('record maths', () => {
	const v = (id: string, t: number, lrc = id) => ({ id, lrc, cls: 'precise' as const, t, by: 'x' });
	it('canonical = most pinned, tie → newer; hidden falls back to next visible', () => {
		let rec = addVersion(emptyLyricsRecord(), v('a', 1), 'u1').rec;
		rec = addVersion(rec, v('b', 2), 'u2').rec;
		expect(canonicalVersion(rec)?.id).toBe('b');
		rec = pinVersion(rec, 'a', 'u3')!;
		expect(canonicalVersion(rec)?.id).toBe('a');
		for (let i = 0; i < HIDE_REPORTS; i++) rec = reportVersion(rec, 'a', `r${i}`)!;
		expect(canonicalVersion(rec)?.id).toBe('b');
		expect(publicVersions(rec).map((x) => x.id)).toEqual(['b']);
	});
	it('reports are idempotent per voter', () => {
		let rec = addVersion(emptyLyricsRecord(), v('a', 1), 'u1').rec;
		rec = reportVersion(rec, 'a', 'r')!;
		rec = reportVersion(rec, 'a', 'r')!;
		expect(rec.versions[0].reporters).toEqual(['r']);
	});
	it('parseLyricsRecord is never-throw and drops bad versions', () => {
		expect(parseLyricsRecord('nope')).toEqual(emptyLyricsRecord());
		expect(parseLyricsRecord(JSON.stringify({ v: 1, versions: [{ id: 1 }] })).versions).toEqual([]);
	});
});

describe('checkLyricText — degenerate stamps earn no precision (quick-261122-tsfix)', () => {
	const allAt = (n: number, stamp: string) =>
		Array.from({ length: n }, (_, i) => `${stamp}line ${i + 1}`).join('\n');
	it('all-identical start stamps are accepted but downgraded to estimated', () => {
		expect(checkLyricText(allAt(6, '[03:42.00]'), { durationSec: 222 })).toMatchObject({ ok: true, cls: 'estimated' });
		expect(checkLyricText(allAt(51, '[03:42.00]'), { durationSec: 222 })).toMatchObject({ ok: true, cls: 'estimated' });
	});
	it('a normal spread still earns precise', () => {
		expect(checkLyricText(timed(6), { durationSec: 222 })).toMatchObject({ ok: true, cls: 'precise' });
	});
	it('an explicitly estimated submission stays estimated either way', () => {
		expect(checkLyricText(allAt(6, '[03:42.00]'), { durationSec: 222, estimated: true })).toMatchObject({ ok: true, cls: 'estimated' });
	});
});
