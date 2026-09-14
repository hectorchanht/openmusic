import { describe, it, expect } from 'vitest';

// 34-D-12 / D-13 / D-16 — the filename-parsing half of device import. Everything under test is a
// PURE function (no store, no runes, no DOM), so this file drives it directly under the single
// Vitest node project, exactly like download-filename.test.ts does for the inverse direction.
import {
	DEFAULT_IMPORT_RULES,
	IMPORT_EXTENSIONS,
	IMPORT_RULES_KEY,
	PRESET_LABELS,
	PRESET_ORDER,
	extOf,
	parseFilename,
	parseImportRules,
	stemOf,
	type ImportRules
} from './device-filename';

/** Defaults with a few fields overridden — keeps each case's intent to the fields it changes. */
const rules = (over: Partial<ImportRules> = {}): ImportRules => ({
	...DEFAULT_IMPORT_RULES,
	...over
});

describe('defaults / parseImportRules', () => {
	it('ships the D-13/D-14 zero-configuration defaults', () => {
		expect(DEFAULT_IMPORT_RULES).toEqual({
			presets: ['artist-title'],
			stripTrackNo: true,
			stripBrackets: false,
			customPattern: '',
			minSeconds: 30,
			extensions: ['mp3', 'flac', 'm4a', 'aac', 'ogg', 'wav'],
			skipRules: []
		});
	});

	it('exposes the versioned storage key and the declared preset order/labels', () => {
		expect(IMPORT_RULES_KEY).toBe('openmusic:import-rules:v1');
		expect(PRESET_ORDER).toEqual(['artist-title', 'title-artist', 'track-title']);
		// LITERAL chip labels (UI-SPEC contract 5) — the UI renders these verbatim.
		expect(PRESET_LABELS['artist-title']).toBe('{artist} - {title}');
		expect(PRESET_LABELS['title-artist']).toBe('{title} - {artist}');
		expect(PRESET_LABELS['track-title']).toBe('{track}. {title}');
	});

	it('includes opus in the selectable extension set but not in the defaults', () => {
		expect(IMPORT_EXTENSIONS).toEqual(['mp3', 'flac', 'm4a', 'aac', 'ogg', 'wav', 'opus']);
		expect(DEFAULT_IMPORT_RULES.extensions).not.toContain('opus');
	});

	it('never throws on null or non-JSON input', () => {
		expect(parseImportRules(null)).toEqual(DEFAULT_IMPORT_RULES);
		expect(parseImportRules('not json')).toEqual(DEFAULT_IMPORT_RULES);
	});

	it('drops unknown presets/extensions and falls back per field on garbage', () => {
		const out = parseImportRules(
			'{"minSeconds":"x","presets":["bogus","title-artist"],"extensions":["MP3","exe"]}'
		);
		expect(out.presets).toEqual(['title-artist']);
		expect(out.extensions).toEqual(['mp3']);
		expect(out.minSeconds).toBe(30); // invalid → default, not 0
		expect(out.stripTrackNo).toBe(true);
		expect(out.customPattern).toBe('');
		expect(out.skipRules).toEqual([]);
	});

	it('clamps minSeconds into 0..120', () => {
		expect(parseImportRules('{"minSeconds":500}').minSeconds).toBe(120);
		expect(parseImportRules('{"minSeconds":-5}').minSeconds).toBe(0);
	});

	it('treats an empty presets or extensions array as a valid user choice', () => {
		const out = parseImportRules('{"presets":[],"extensions":[]}');
		expect(out.presets).toEqual([]);
		expect(out.extensions).toEqual([]);
	});

	it('trims, de-dupes and drops empty skip rules', () => {
		expect(parseImportRules('{"skipRules":[" ringtone ","ringtone","",7]}').skipRules).toEqual([
			'ringtone'
		]);
	});

	it('returns a fresh object each call so a caller cannot mutate the defaults', () => {
		const a = parseImportRules(null);
		a.presets.push('track-title');
		expect(DEFAULT_IMPORT_RULES.presets).toEqual(['artist-title']);
		expect(parseImportRules(null).presets).toEqual(['artist-title']);
	});
});

describe('stem / ext', () => {
	it('stemOf drops the path and the last extension only', () => {
		expect(stemOf('Adele - Hello.mp3')).toBe('Adele - Hello');
		expect(stemOf('a.b.flac')).toBe('a.b');
		expect(stemOf('Music/Pop/Adele - Hello.mp3')).toBe('Adele - Hello');
	});

	it('extOf lowercases and returns empty for an extension-less name', () => {
		expect(extOf('x.FLAC')).toBe('flac');
		expect(extOf('noext')).toBe('');
	});
});

describe('parseFilename presets', () => {
	it('parses the D-13 default `{artist} - {title}` with zero configuration', () => {
		expect(parseFilename('Adele - Hello.mp3', DEFAULT_IMPORT_RULES, null)).toEqual({
			artist: 'Adele',
			title: 'Hello'
		});
	});

	it('parses `{title} - {artist}` when that preset is selected', () => {
		const out = parseFilename('Hello - Adele.mp3', rules({ presets: ['title-artist'] }), null);
		expect(out.title).toBe('Hello');
		expect(out.artist).toBe('Adele');
	});

	it('parses `{track}. {title}` into a numeric track with no artist', () => {
		const out = parseFilename(
			'07. Hello.mp3',
			rules({ presets: ['track-title'], stripTrackNo: false }),
			null
		);
		expect(out).toEqual({ title: 'Hello', artist: '', track: 7 });
	});

	it('tries presets in DECLARED order, first match wins (not PRESET_ORDER)', () => {
		const titleFirst = parseFilename(
			'A - B.mp3',
			rules({ presets: ['title-artist', 'artist-title'] }),
			null
		);
		expect(titleFirst.title).toBe('A');
		expect(titleFirst.artist).toBe('B');

		const artistFirst = parseFilename(
			'A - B.mp3',
			rules({ presets: ['artist-title', 'title-artist'] }),
			null
		);
		expect(artistFirst.artist).toBe('A');
		expect(artistFirst.title).toBe('B');
	});

	it('treats only SPACE-HYPHEN-SPACE as a separator, so `Jay-Z` survives', () => {
		const out = parseFilename('Jay-Z - 99 Problems.mp3', DEFAULT_IMPORT_RULES, null);
		expect(out.artist).toBe('Jay-Z');
		expect(out.title).toBe('99 Problems');
	});

	it('lets a matching custom pattern win over the presets', () => {
		const out = parseFilename(
			'Hello__Adele.mp3',
			DEFAULT_IMPORT_RULES,
			/^(?<title>.+?)__(?<artist>.+)$/
		);
		expect(out.title).toBe('Hello');
		expect(out.artist).toBe('Adele');
	});

	it('falls through to the presets when the custom pattern does not match', () => {
		const out = parseFilename(
			'Adele - Hello.mp3',
			DEFAULT_IMPORT_RULES,
			/^(?<title>.+?)__(?<artist>.+)$/
		);
		expect(out.artist).toBe('Adele');
		expect(out.title).toBe('Hello');
	});
});

describe('strip toggles', () => {
	it('strips a `01. ` track number BEFORE the presets run', () => {
		const out = parseFilename('01. Adele - Hello.mp3', DEFAULT_IMPORT_RULES, null);
		expect(out.artist).toBe('Adele');
		expect(out.title).toBe('Hello');
	});

	it('strips a `01 - ` track number too', () => {
		const out = parseFilename('01 - Adele - Hello.mp3', DEFAULT_IMPORT_RULES, null);
		expect(out.artist).toBe('Adele');
		expect(out.title).toBe('Hello');
	});

	it('does NOT eat a leading number without a . or - separator', () => {
		expect(parseFilename('24K Magic.mp3', DEFAULT_IMPORT_RULES, null).title).toBe('24K Magic');
		expect(parseFilename('2 Become 1.mp3', DEFAULT_IMPORT_RULES, null).title).toBe('2 Become 1');
	});

	it('strips latin brackets when stripBrackets is on', () => {
		const out = parseFilename(
			'Adele - Hello (Live) [Official MV].mp3',
			rules({ stripBrackets: true }),
			null
		);
		expect(out.title).toBe('Hello');
		expect(out.artist).toBe('Adele');
	});

	it('preserves bracketed display text when stripBrackets is off', () => {
		const out = parseFilename('Adele - Hello (Live) [Official MV].mp3', DEFAULT_IMPORT_RULES, null);
		expect(out.title).toBe('Hello (Live) [Official MV]');
	});

	it('strips CJK brackets with the match-key.ts:26 regex', () => {
		const out = parseFilename('周杰倫 - 晴天【KTV】.mp3', rules({ stripBrackets: true }), null);
		expect(out.title).toBe('晴天');
		expect(out.artist).toBe('周杰倫');
	});
});

describe('D-16 fallback', () => {
	it('yields the stem as the title when no preset is enabled', () => {
		expect(parseFilename('whatever_song.mp3', rules({ presets: [] }), null)).toEqual({
			title: 'whatever_song',
			artist: ''
		});
	});

	it('yields the stem as the title when the default preset finds no separator', () => {
		const out = parseFilename('Hello.mp3', DEFAULT_IMPORT_RULES, null);
		expect(out.title).toBe('Hello');
		expect(out.artist).toBe('');
	});

	it('never returns an empty title', () => {
		expect(parseFilename('.mp3', DEFAULT_IMPORT_RULES, null).title).not.toBe('');
		expect(parseFilename('  -  .mp3', DEFAULT_IMPORT_RULES, null).title).not.toBe('');
	});
});
