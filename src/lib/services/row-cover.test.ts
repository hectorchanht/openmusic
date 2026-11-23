// row-cover.test.ts (quick-260910-qwt) — node tests for the ONE shared row-cover read order.
// Moved here from upnext-covers.test.ts when upNextTileCover was generalised to pickRowCover: the
// helper is now the read-order authority for search, library, artist, CompactRow, Up Next and
// Related, so its tests live beside it. No localStorage stub needed — the module is cache-free
// (the caller passes the cache read IN; see row-cover.ts).
import { describe, it, expect, beforeEach } from 'vitest';
import { pickRowCover, queueRowCover } from '$lib/services/row-cover';
import { markCoverUrlDead, __resetDeadCoverUrls } from '$lib/services/dead-cover-urls';

describe('queueRowCover — the hero mirror (quick-261122-npfix)', () => {
	it('the CURRENT row shows the hero url verbatim, never its own ladder', () => {
		expect(queueRowCover(true, 'https://hero.example/a.jpg', 'https://row.example/b.jpg')).toBe('https://hero.example/a.jpg');
	});
	it('the current row follows the hero to a gradient (null) rather than diverging', () => {
		expect(queueRowCover(true, null, 'https://row.example/b.jpg')).toBeNull();
		expect(queueRowCover(true, '', 'https://row.example/b.jpg')).toBeNull();
	});
	it('every other row keeps its own pickRowCover result', () => {
		expect(queueRowCover(false, 'https://hero.example/a.jpg', 'https://row.example/b.jpg')).toBe('https://row.example/b.jpg');
	});
});

// 5-arg order: (pinned, explicit, resolved, seeded, cached).
describe('pickRowCover', () => {
	beforeEach(__resetDeadCoverUrls);

	it('reads pinned -> explicit -> cached -> resolved -> seeded -> null', () => {
		expect(pickRowCover('https://pin', 'https://exp', 'https://res', 'https://seed', 'https://cache')).toBe('https://pin');
		expect(pickRowCover(null, 'https://exp', 'https://res', 'https://seed', 'https://cache')).toBe('https://exp');
		expect(pickRowCover(null, null, 'https://res', 'https://seed', 'https://cache')).toBe('https://cache');
		expect(pickRowCover(null, null, null, 'https://seed', 'https://cache')).toBe('https://cache');
		expect(pickRowCover(null, null, null, 'https://seed', null)).toBe('https://seed');
		expect(pickRowCover(null, null, null, null, null)).toBeNull();
	});

	it('treats an empty string as a miss at every rung', () => {
		expect(pickRowCover('', '', '', 'https://a', null)).toBe('https://a');
		expect(pickRowCover('', '', '', '', 'https://c')).toBe('https://c');
		expect(pickRowCover('', '', '', '', '')).toBeNull();
	});

	it('keeps the EXPLICIT album cover ahead of the cache (quick-260910-piz)', () => {
		expect(pickRowCover(null, 'https://album', undefined, 'https://seed', 'https://deezer')).toBe('https://album');
	});

	// quick-261020-latest: the shared cache (name-first = latest write) outranks the row's own
	// older one-shot result AND the implicit seeded art — the same song shows the same latest
	// cover everywhere.
	it('the cache beats a stale row-local resolved URL and a live seeded URL', () => {
		// stale resolved: another surface wrote a newer cover since this row resolved
		expect(pickRowCover(null, null, 'https://stale.example/a.jpg', 'https://seed', 'https://cache.example/b.jpg')).toBe(
			'https://cache.example/b.jpg'
		);
		// live seeded: the track's own source art loses to the latest cached art
		expect(pickRowCover(null, null, null, 'https://seed.example/live.jpg', 'https://cache.example/latest.jpg')).toBe(
			'https://cache.example/latest.jpg'
		);
	});

	// quick-260915-w4f: rung 0. The pin must beat everything — that is the rung the
	// first-solid-wins chain's wrong answer usually sits in, and the reason a pin folded only
	// into the cache read would look broken on every list surface.
	it('puts the user pin ahead of every other rung (quick-260915-w4f)', () => {
		expect(pickRowCover('https://pin', 'https://exp', 'https://res', 'https://seed', 'https://cache')).toBe('https://pin');
		// An unpinned uid (null / '' / undefined) leaves the existing order untouched.
		expect(pickRowCover(undefined, null, 'https://res', 'https://seed', null)).toBe('https://res');
		expect(pickRowCover('', null, undefined, 'https://seed', null)).toBe('https://seed');
	});

	// quick-261020-dcvr: a seeded URL proven dead by an Image() probe must not shadow the live
	// cache rung — the row fell to gradient while the nowbar showed the healed art.
	describe('dead seeded-URL skip', () => {
		it('skips a dead seeded URL so the live cache shows through', () => {
			markCoverUrlDead('https://dead.example/seed.jpg');
			expect(pickRowCover(null, null, null, 'https://dead.example/seed.jpg', 'https://cached.example/live.jpg')).toBe(
				'https://cached.example/live.jpg'
			);
		});

		it('never skips a dead-marked pin — dropping a user choice is healCover\u2019s job, not the read\u2019s', () => {
			markCoverUrlDead('https://dead.example/pin.jpg');
			expect(pickRowCover('https://dead.example/pin.jpg', null, null, 'https://s', 'https://c')).toBe(
				'https://dead.example/pin.jpg'
			);
		});

		it('never skips a dead-marked explicit host cover', () => {
			markCoverUrlDead('https://dead.example/album.jpg');
			expect(pickRowCover(null, 'https://dead.example/album.jpg', null, 'https://s', 'https://c')).toBe(
				'https://dead.example/album.jpg'
			);
		});

		// quick-261122-npfix: the dead-skip covers EVERY auto rung, not just seeded. A stalled
		// kuwo url that landed in the shared cache used to win rung 2 forever — the row painted a
		// pending/broken tile while a live seeded or resolved cover sat one rung lower.
		it('skips a dead CACHED url so the live seeded cover shows through', () => {
			markCoverUrlDead('https://img2.kuwo.cn/star/albumcover/500/x.jpg');
			expect(pickRowCover(null, null, null, 'https://live.example/seed.jpg', 'https://img2.kuwo.cn/star/albumcover/500/x.jpg')).toBe(
				'https://live.example/seed.jpg'
			);
		});

		it('skips a dead RESOLVED url so the live seeded cover shows through', () => {
			markCoverUrlDead('https://dead.example/resolved.jpg');
			expect(pickRowCover(null, null, 'https://dead.example/resolved.jpg', 'https://live.example/seed.jpg', null)).toBe(
				'https://live.example/seed.jpg'
			);
		});

		it('falls to gradient when the dead seeded URL is the only candidate', () => {
			markCoverUrlDead('https://dead.example/only.jpg');
			expect(pickRowCover(null, null, null, 'https://dead.example/only.jpg', null)).toBeNull();
		});
	});
});
