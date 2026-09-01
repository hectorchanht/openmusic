import { describe, it, expect } from 'vitest';
import { pickLocaleName } from './musicbrainz';
import { isMbid, coverArtUrl, normalizeLocale } from '$lib/proxy/musicbrainz-shared';

// quick-260831-re9 / spike 010. Fixtures are the REAL /api/musicbrainz/artist payloads measured
// 2026-09-01 — this is the data that lets 周傑倫 / Jay Chou / 周杰倫 be ONE artist page whose name
// follows the artist-language setting, instead of three separate pages.
const EASON = {
	canonical: '陳奕迅',
	names: { 'zh-Hans': '陈奕迅', zh: '陳奕迅', 'zh-Hant': '陳奕迅', en: 'Eason Chan' }
};
const JAY = {
	canonical: '周杰倫',
	names: {
		ja: 'ジェイ・チョウ',
		ko: '주걸륜',
		en: 'Jay Chou',
		'zh-Latn': 'Zhōu Jié Lún',
		'zh-Hans': '周杰伦',
		'zh-Hant': '周杰倫'
	}
};

describe('pickLocaleName — one artist, name per artist-language setting', () => {
	it('returns the exact locale match', () => {
		expect(pickLocaleName(EASON.names, EASON.canonical, 'en')).toBe('Eason Chan');
		expect(pickLocaleName(EASON.names, EASON.canonical, 'zh-Hant')).toBe('陳奕迅');
		expect(pickLocaleName(EASON.names, EASON.canonical, 'zh-Hans')).toBe('陈奕迅');
	});

	it('resolves every 周杰倫 variant to the requested script', () => {
		expect(pickLocaleName(JAY.names, JAY.canonical, 'zh-Hant')).toBe('周杰倫');
		expect(pickLocaleName(JAY.names, JAY.canonical, 'zh-Hans')).toBe('周杰伦');
		expect(pickLocaleName(JAY.names, JAY.canonical, 'en')).toBe('Jay Chou');
		expect(pickLocaleName(JAY.names, JAY.canonical, 'ja')).toBe('ジェイ・チョウ');
	});

	it("falls back to the same base language when the exact script is absent", () => {
		// only a bare `zh` alias exists — a zh-Hant request should still find it
		expect(pickLocaleName({ zh: '陳奕迅' }, null, 'zh-Hant')).toBe('陳奕迅');
	});

	it("treats 'auto' and 'off' as NOT locales — they fall through to canonical", () => {
		// These are app-level sentinels ("follow the app" / "don't translate"), not language tags,
		// so they must not accidentally match an alias key.
		expect(pickLocaleName(EASON.names, EASON.canonical, 'auto')).toBe('陳奕迅');
		expect(pickLocaleName(EASON.names, EASON.canonical, 'off')).toBe('陳奕迅');
	});

	it('falls back to canonical for an unknown locale, then to the search name', () => {
		expect(pickLocaleName(EASON.names, EASON.canonical, 'fr')).toBe('陳奕迅');
		expect(pickLocaleName({}, null, 'fr', 'Some Artist')).toBe('Some Artist');
	});

	it('never returns empty when anything usable exists', () => {
		expect(pickLocaleName({}, '', '', 'Route Name')).toBe('Route Name');
		expect(pickLocaleName({}, '  ', 'en', 'Route Name')).toBe('Route Name');
	});
});

describe('isMbid — the guard before any id reaches an upstream URL', () => {
	it('accepts a real MusicBrainz UUID', () => {
		expect(isMbid('86119d30-d930-4e65-a97a-e31e22388166')).toBe(true);
		expect(isMbid('A223958D-5C56-4B2C-A30A-87E357BC121B')).toBe(true); // case-insensitive
	});

	it('rejects traversal, injection and malformed input', () => {
		expect(isMbid('../../etc/passwd')).toBe(false);
		expect(isMbid('86119d30-d930-4e65-a97a-e31e22388166/../x')).toBe(false);
		expect(isMbid('not-a-uuid')).toBe(false);
		expect(isMbid('')).toBe(false);
		expect(isMbid(null)).toBe(false);
		expect(isMbid(undefined)).toBe(false);
	});
});

describe('coverArtUrl', () => {
	it('builds the Cover Art Archive front-cover URL without a network call', () => {
		expect(coverArtUrl('8770e36c-464b-47ea-9a62-862025d27bf8')).toBe(
			'https://coverartarchive.org/release-group/8770e36c-464b-47ea-9a62-862025d27bf8/front-500'
		);
	});

	it('honours the size variant', () => {
		expect(coverArtUrl('8770e36c-464b-47ea-9a62-862025d27bf8', 250)).toContain('front-250');
	});

	it('returns null for a malformed id so it can never reach the DOM as a URL', () => {
		expect(coverArtUrl('../evil')).toBeNull();
	});
});

describe('normalizeLocale — MusicBrainz tags → app tags', () => {
	it('hyphenates and title-cases the script subtag', () => {
		expect(normalizeLocale('zh_Hant')).toBe('zh-Hant');
		expect(normalizeLocale('zh_Hans')).toBe('zh-Hans');
	});

	it('drops a region suffix so zh_Hans_CN and zh_Hans agree', () => {
		expect(normalizeLocale('zh_Hans_CN')).toBe('zh-Hans');
		expect(normalizeLocale('zh_Hant_TW')).toBe('zh-Hant');
	});

	it('passes a bare language through', () => {
		expect(normalizeLocale('en')).toBe('en');
		expect(normalizeLocale('zh')).toBe('zh');
	});

	it('tolerates already-hyphenated input and junk', () => {
		expect(normalizeLocale('zh-Hant')).toBe('zh-Hant');
		expect(normalizeLocale(null)).toBeNull();
		expect(normalizeLocale('')).toBeNull();
	});
});
