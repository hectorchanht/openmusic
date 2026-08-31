import { describe, it, expect, vi, afterEach } from 'vitest';
import { pickByQualityPref, effectiveQuality } from './quality';

// The verbatim JOOX ladder (top-tier-first) — the realistic input.
const JOOX_ORDER = [
	'Atmos全景声',
	'无损FLAC',
	'Hi-Res无损',
	'母带无损',
	'OGG 320',
	'MP3 320',
	'AAC 192',
	'OGG 192',
	'MP3 128',
	'AAC 96',
	'AAC 48'
];

describe('pickByQualityPref (D-03)', () => {
	it("pref '128' moves the 128–192 band to the front (stable); sub-128 AAC stays in rest (WR-02)", () => {
		const out = pickByQualityPref(JOOX_ORDER, '128');
		// the 128 band (128/160/192 by bitrate number) leads
		expect(out[0]).toBe('AAC 192');
		// first element matches the 128 band — by bitrate number, NOT a bare `aac` match
		expect(/128|160|192/i.test(out[0])).toBe(true);
		// only the genuine 128–192 members come first, in their original relative order
		expect(out.slice(0, 3)).toEqual(['AAC 192', 'OGG 192', 'MP3 128']);
		// WR-02: lossless/320 AND the sub-128 'AAC 96'/'AAC 48' tiers are all pushed after
		// the band (original relative order preserved). The old `aac` branch wrongly promoted
		// 96/48kbps into the 128 band — a 128k request could then yield a 48k stream.
		expect(out.slice(3)).toEqual([
			'Atmos全景声',
			'无损FLAC',
			'Hi-Res无损',
			'母带无损',
			'OGG 320',
			'MP3 320',
			'AAC 96',
			'AAC 48'
		]);
		// no tier dropped, none duplicated
		expect(out.length).toBe(JOOX_ORDER.length);
		expect([...out].sort()).toEqual([...JOOX_ORDER].sort());
	});

	it("pref '320' moves the 320 band to the front", () => {
		const out = pickByQualityPref(JOOX_ORDER, '320');
		expect(out.slice(0, 2)).toEqual(['OGG 320', 'MP3 320']);
		expect(/320/.test(out[0])).toBe(true);
		expect(out.length).toBe(JOOX_ORDER.length);
	});

	it("pref 'lossless' returns the input order unchanged (top tier first)", () => {
		const out = pickByQualityPref(JOOX_ORDER, 'lossless');
		expect(out).toEqual(JOOX_ORDER);
	});

	it("pref 'auto' returns the input order unchanged", () => {
		const out = pickByQualityPref(JOOX_ORDER, 'auto');
		expect(out).toEqual(JOOX_ORDER);
	});

	it('never mutates the input array', () => {
		const input = [...JOOX_ORDER];
		pickByQualityPref(input, '128');
		expect(input).toEqual(JOOX_ORDER);
	});

	it("returns a fresh array even for the unchanged 'auto'/'lossless' path", () => {
		const out = pickByQualityPref(JOOX_ORDER, 'auto');
		expect(out).not.toBe(JOOX_ORDER);
	});
});

// ── effectiveQuality: the ONE 'auto' → concrete-tier seam (32-D-02 / 32-D-03) ──────────
// `navigator` is stubbed per-case: the node test project HAS a global `navigator`
// (Node 22) but no `navigator.connection`, so the un-stubbed baseline is already the
// "no signal" branch — which is what iOS Safari and desktop Chrome see in production.
describe('effectiveQuality (32-D-02/32-D-03)', () => {
	afterEach(() => {
		vi.unstubAllGlobals();
	});

	it("'auto' on wifi → 'lossless'", () => {
		vi.stubGlobal('navigator', { connection: { type: 'wifi' } });
		expect(effectiveQuality('auto')).toBe('lossless');
	});

	it("'auto' on ethernet → 'lossless'", () => {
		vi.stubGlobal('navigator', { connection: { type: 'ethernet' } });
		expect(effectiveQuality('auto')).toBe('lossless');
	});

	it("'auto' on cellular → '320' (32-D-02: never hand FLAC to a metered connection)", () => {
		vi.stubGlobal('navigator', { connection: { type: 'cellular' } });
		expect(effectiveQuality('auto')).toBe('320');
	});

	it("'auto' with a type outside the whitelist → '320' (fails closed)", () => {
		for (const type of ['unknown', 'other', 'none', 'bluetooth', 'wimax'] as const) {
			vi.stubGlobal('navigator', { connection: { type } });
			expect(effectiveQuality('auto')).toBe('320');
		}
	});

	it("'auto' with navigator.connection undefined → '320' (32-D-03: iOS Safari / desktop Chrome)", () => {
		vi.stubGlobal('navigator', {});
		expect(effectiveQuality('auto')).toBe('320');
	});

	it("'auto' with saveData:true on wifi → '320' (explicit user opt-in wins)", () => {
		vi.stubGlobal('navigator', { connection: { type: 'wifi', saveData: true } });
		expect(effectiveQuality('auto')).toBe('320');
	});

	it('a concrete pref passes through unchanged regardless of the connection', () => {
		vi.stubGlobal('navigator', { connection: { type: 'wifi' } });
		expect(effectiveQuality('lossless')).toBe('lossless');
		expect(effectiveQuality('320')).toBe('320');
		expect(effectiveQuality('128')).toBe('128');
		vi.stubGlobal('navigator', { connection: { type: 'cellular' } });
		expect(effectiveQuality('lossless')).toBe('lossless');
		expect(effectiveQuality('320')).toBe('320');
		expect(effectiveQuality('128')).toBe('128');
	});
});
