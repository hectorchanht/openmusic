import { describe, it, expect } from 'vitest';
import {
	sameArtistForm,
	creditSegments,
	primaryCredit,
	fullestDisplayName,
	pickHeroCover
} from './artist-display';

// artist-display — the artist page's display-name + hero-cover rules (2026-11-02,
// Hector's sunkis report). The incident shapes are pinned verbatim: MusicBrainz knows
// sunkis as canonical "sunkis" with aliases {zh: 宋秉勤, en: Chris Sung}, while the
// sources credit him bilingually as "sunkis 宋秉勤" — the header showed only "sunkis"
// and the hero showed KnowKnow's "BRAND NEW" cover (sunkis is a secondary credit).

const SUNKIS_FORMS = ['sunkis 宋秉勤', 'sunkis', '宋秉勤', 'Chris Sung'];

describe('sameArtistForm — whole-run identity, script-exact', () => {
	it('matches a bilingual form against either of its fragments', () => {
		expect(sameArtistForm('sunkis', 'sunkis 宋秉勤')).toBe(true);
		expect(sameArtistForm('宋秉勤', 'sunkis 宋秉勤')).toBe(true);
		expect(sameArtistForm('sunkis 宋秉勤', 'sunkis 宋秉勤')).toBe(true);
	});

	it('does not match a different artist', () => {
		expect(sameArtistForm('KnowKnow', 'sunkis 宋秉勤')).toBe(false);
		expect(sameArtistForm('88rising', 'sunkis 宋秉勤')).toBe(false);
	});

	it('never folds Traditional into Simplified (姜濤 ≠ 姜涛)', () => {
		expect(sameArtistForm('姜濤', '姜涛')).toBe(false);
	});

	it('empty never matches', () => {
		expect(sameArtistForm('', 'sunkis')).toBe(false);
		expect(sameArtistForm('sunkis', '  ')).toBe(false);
	});
});

describe('creditSegments / primaryCredit', () => {
	it('splits the middle-dot joiner CN sources carry', () => {
		expect(creditSegments('KnowKnow · sunkis 宋秉勤')).toEqual(['KnowKnow', 'sunkis 宋秉勤']);
		expect(creditSegments('88rising · yung kai · sunkis 宋秉勤')).toEqual([
			'88rising',
			'yung kai',
			'sunkis 宋秉勤'
		]);
	});

	it('splits the connector set via splitArtists', () => {
		expect(creditSegments('A, B')).toEqual(['A', 'B']);
		expect(creditSegments('Earth, Wind & Fire')).toEqual(['Earth', 'Wind', 'Fire']);
	});

	it('primary credit is the first billed name', () => {
		expect(primaryCredit('KnowKnow · sunkis 宋秉勤')).toBe('KnowKnow');
		expect(primaryCredit('sunkis 宋秉勤')).toBe('sunkis 宋秉勤');
		expect(primaryCredit('sunkis 宋秉勤 feat. KnowKnow')).toBe('sunkis 宋秉勤');
		expect(primaryCredit('sunkis 宋秉勤 (feat. KnowKnow)')).toBe('sunkis 宋秉勤');
	});
});

describe('fullestDisplayName — canonical never shrinks the credited name', () => {
	it('restores the bilingual credited form over the Latin-only canonical (the sunkis bug)', () => {
		const credited = ['sunkis 宋秉勤', 'KnowKnow', '孫盛希', 'sunkis 宋秉勤', '88rising', 'yung kai'];
		expect(fullestDisplayName('sunkis', credited, SUNKIS_FORMS)).toBe('sunkis 宋秉勤');
	});

	it('restores the bilingual form over a CJK-only locale pick too', () => {
		expect(fullestDisplayName('宋秉勤', ['sunkis 宋秉勤'], SUNKIS_FORMS)).toBe('sunkis 宋秉勤');
	});

	it('keeps a disjoint locale pick (English alias does not contain the bilingual key)', () => {
		expect(fullestDisplayName('Chris Sung', ['sunkis 宋秉勤'], SUNKIS_FORMS)).toBe('Chris Sung');
	});

	it('never replaces a full base with a shorter credited fragment', () => {
		expect(fullestDisplayName('sunkis 宋秉勤', ['sunkis'], SUNKIS_FORMS)).toBe('sunkis 宋秉勤');
	});

	it('leaves an already-complete canonical untouched (陳奕迅)', () => {
		expect(fullestDisplayName('陳奕迅', ['陳奕迅', 'Eason Chan'], ['陳奕迅', 'Eason Chan'])).toBe('陳奕迅');
	});

	it('does not let an unrelated spelling displace the base (Jay Chou vs 周傑倫)', () => {
		expect(fullestDisplayName('Jay Chou', ['周傑倫'], ['Jay Chou'])).toBe('Jay Chou');
	});

	it('a longer string from a DIFFERENT artist never wins, even if it embeds the base key', () => {
		// "sunkisbeats" canonical-contains "sunkis" but is not a whole-run match for any
		// known form (runs compare whole, never as substrings), so it is gated out.
		expect(fullestDisplayName('sunkis', ['sunkisbeats'], SUNKIS_FORMS)).toBe('sunkis');
	});

	it('empty base passes through', () => {
		expect(fullestDisplayName('', ['sunkis 宋秉勤'], SUNKIS_FORMS)).toBe('');
	});
});

describe('pickHeroCover — primary credit first, any cover last', () => {
	const coverOf = (t: { cover: string | null }) => t.cover;

	it("a collaborator's cover never beats the artist's own hit (the BRAND NEW bug)", () => {
		const tracks = [
			{ artist: 'KnowKnow · sunkis 宋秉勤', title: 'BRAND NEW', cover: 'brand-new.jpg' },
			{ artist: 'sunkis 宋秉勤', title: 'trust me', cover: 'trust-me.jpg' }
		];
		expect(pickHeroCover(tracks, SUNKIS_FORMS, coverOf)).toBe('trust-me.jpg');
	});

	it('skips a primary-credit track with no cover for the next primary with one', () => {
		const tracks = [
			{ artist: 'sunkis 宋秉勤', title: 'trust me', cover: null },
			{ artist: 'sunkis 宋秉勤', title: '飛到月球', cover: 'moon.jpg' },
			{ artist: 'KnowKnow · sunkis 宋秉勤', title: 'BRAND NEW', cover: 'brand-new.jpg' }
		];
		expect(pickHeroCover(tracks, SUNKIS_FORMS, coverOf)).toBe('moon.jpg');
	});

	it('a featured credit counts as primary when he is first-billed with a feat. tail', () => {
		const tracks = [
			{ artist: 'KnowKnow · sunkis 宋秉勤', title: 'BRAND NEW', cover: 'brand-new.jpg' },
			{ artist: 'sunkis 宋秉勤 feat. KnowKnow', title: 'some collab', cover: 'collab.jpg' }
		];
		expect(pickHeroCover(tracks, SUNKIS_FORMS, coverOf)).toBe('collab.jpg');
	});

	it('falls back to the first cover of any kind when no primary-credit cover exists', () => {
		const tracks = [
			{ artist: 'KnowKnow · sunkis 宋秉勤', title: 'BRAND NEW', cover: 'brand-new.jpg' },
			{ artist: '88rising · sunkis 宋秉勤', title: 'where the sunlight glows', cover: 'sunlight.jpg' }
		];
		expect(pickHeroCover(tracks, SUNKIS_FORMS, coverOf)).toBe('brand-new.jpg');
	});

	it('matches a primary credit given in a fragment form (canonical-only page name)', () => {
		const tracks = [{ artist: 'sunkis 宋秉勤', title: 'trust me', cover: 'trust-me.jpg' }];
		expect(pickHeroCover(tracks, ['sunkis'], coverOf)).toBe('trust-me.jpg');
	});

	it('returns null when nothing has a cover', () => {
		const tracks = [{ artist: 'sunkis 宋秉勤', title: 'trust me', cover: null }];
		expect(pickHeroCover(tracks, SUNKIS_FORMS, coverOf)).toBeNull();
		expect(pickHeroCover([], SUNKIS_FORMS, coverOf)).toBeNull();
	});
});
