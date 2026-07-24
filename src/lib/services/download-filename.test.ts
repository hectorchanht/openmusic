import { describe, it, expect } from 'vitest';

// DL-FILE-01 (D-05/D-06/D-08): the pure filename builder + extension helper that every save site
// (TrackMenu, album, native blob-store, migration) shares. These are node-only pure functions —
// no store, no DOM — so this test file drives them directly under the single Vitest node project.
// The rows below mirror 29-VALIDATION DL-FILE-01: translated/raw/sanitize/each-ext/default-mp3 and
// query-strip/case-insensitive/unknown→mp3.
import { extFromAudioUrl, buildDownloadFilename } from './download-filename';

describe('download-filename — extFromAudioUrl (D-06)', () => {
	it('query-strips then lowercases the matched extension', () => {
		// query string after '?' must not defeat the $-anchored extension match, and the result is
		// normalized to lowercase (a `.FLAC` upstream URL still yields the lowercase container name).
		expect(extFromAudioUrl('https://cdn/x.FLAC?token=1')).toBe('flac');
	});

	it('resolves each supported container extension', () => {
		expect(extFromAudioUrl('https://cdn/x.mp3')).toBe('mp3');
		expect(extFromAudioUrl('https://cdn/x.flac')).toBe('flac');
		expect(extFromAudioUrl('https://cdn/x.m4a')).toBe('m4a');
		expect(extFromAudioUrl('https://cdn/x.aac')).toBe('aac');
		expect(extFromAudioUrl('https://cdn/x.ogg')).toBe('ogg');
		expect(extFromAudioUrl('https://cdn/x.wav')).toBe('wav');
	});

	it('defaults to mp3 for null', () => {
		expect(extFromAudioUrl(null)).toBe('mp3');
	});

	it('defaults to mp3 for an unmatched URL', () => {
		expect(extFromAudioUrl('https://cdn/nomatch')).toBe('mp3');
	});
});

describe('download-filename — buildDownloadFilename (D-05/D-08)', () => {
	it('composes `{artist} - {title}.{ext}` preserving translated CJK names unchanged', () => {
		// artist/title are ALREADY run through names.dn* by the caller (D-05/D-07) — CJK is a safe
		// filesystem character set and must pass through the sanitize step untouched.
		expect(buildDownloadFilename('G.E.M. 鄧紫棋', '光年之外', 'mp3')).toBe(
			'G.E.M. 鄧紫棋 - 光年之外.mp3'
		);
	});

	it('sanitizes every reserved/path char (/\\?%*:|"<>) to underscore', () => {
		const out = buildDownloadFilename('AC/DC', 'T:N:T', 'mp3');
		// No path separator, drive-colon, or quote may survive — these enable `../` traversal and
		// MediaStore RELATIVE_PATH escape (T-29-01-01).
		expect(out).not.toContain('/');
		expect(out).not.toContain('\\');
		expect(out).not.toContain(':');
		expect(out).not.toContain('"');
		expect(out).toBe('AC_DC - T_N_T.mp3');
	});

	it('replaces the full reserved class in one pass', () => {
		const out = buildDownloadFilename('a?b%c*d|e<f>g', 'h"i', 'mp3');
		expect(out).toBe('a_b_c_d_e_f_g - h_i.mp3');
	});
});
