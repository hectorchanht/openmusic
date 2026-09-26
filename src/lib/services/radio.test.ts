// quick-260924-pgu — the home "Your Radio" shelf's two PURE functions: seed pick + merge.
// quick-260926-lw8 — plus the rng seams (shuffle / seededRng, window-sampled seeds, pool-cut
// shuffled merge) and ONE mocked buildRadio test for session stability + the upstream budget. The
// two network helpers are vi.mock'ed (hoisted above the './radio' import), so this stays
// node-only with no network. The pre-existing cases pass no rng and must stay byte-identical.
import { describe, it, expect, vi } from 'vitest';

vi.mock('$lib/services/similar', () => ({
	fetchSimilarTracks: vi.fn(async (artist: string) => [
		mk(`${artist}:1`, artist, 's1'),
		mk(`${artist}:2`, artist, 's2'),
		mk(`${artist}:3`, artist, 's3')
	]),
	nameStub: vi.fn(() => null)
}));
vi.mock('$lib/services/deezer', () => ({
	deezerArtistRadio: vi.fn(async () => [])
}));

import {
	pickRadioSeeds,
	mergeRadio,
	buildRadio,
	reseedRadio,
	RADIO_SEEDS,
	SEED_WINDOW,
	RADIO_POOL
} from './radio';
import { shuffle, seededRng } from './shuffle';
import { fetchSimilarTracks } from '$lib/services/similar';
import { deezerArtistRadio } from '$lib/services/deezer';
import { matchKey } from './match-key';
import type { HistoryEntry } from '$lib/history/history-logic';
import type { Track } from '$lib/sources/types';

function entry(artist: string, title: string, i: number): HistoryEntry {
	return {
		uid: `h:${i}`,
		source: 'kuwo',
		songid: String(i),
		title,
		artist,
		album: '',
		cover: null,
		quality: null,
		qualityLabel: null,
		keyword: '',
		displayIndex: 0
	};
}

function mk(uid: string, artist: string, title: string): Track {
	return {
		uid,
		source: 'kuwo',
		songid: uid,
		title,
		artist,
		album: '',
		cover: null,
		audioUrl: null,
		lrc: null,
		lrcUrl: null,
		detailsLoaded: false,
		quality: null,
		qualityLabel: null,
		keyword: '',
		displayIndex: 0
	};
}

describe('pickRadioSeeds', () => {
	it('keeps the most recent entry per distinct artist, skips blanks, caps at n', () => {
		const a1 = entry('A', 'one', 1);
		const a2 = entry('A', 'two', 2);
		const b = entry(' b ', 'three', 3);
		const blankTitle = entry('C', '', 4);
		const d = entry('D', 'five', 5);
		expect(pickRadioSeeds([a1, a2, b, blankTitle, d], 2)).toEqual([a1, b]);
	});

	it('returns [] for an empty history', () => {
		expect(pickRadioSeeds([], 4)).toEqual([]);
	});
});

describe('mergeRadio', () => {
	const x1 = mk('x1', 'X', 'x one');
	const x2 = mk('x2', 'X', 'x two');
	const y1 = mk('y1', 'Y', 'y one');
	const y2 = mk('y2', 'Y', 'y two');

	it('round-robins across seed lists and drops already-heard songs', () => {
		const heard = new Set([matchKey(y1.artist, y1.title)]);
		expect(mergeRadio([[x1, x2], [y1, y2]], heard, 3)).toEqual([x1, x2, y2]);
	});

	it('dedupes the same uid appearing in two lists', () => {
		expect(mergeRadio([[x1], [x1]], new Set(), 10)).toEqual([x1]);
	});

	it('stops at the cap', () => {
		expect(mergeRadio([[x1, x2], [y1, y2]], new Set(), 1)).toHaveLength(1);
	});

	it('returns [] for no lists', () => {
		expect(mergeRadio([], new Set(), 5)).toEqual([]);
	});
});

// ---- quick-260926-lw8: rng-injected randomness -------------------------------------------------

// 30 distinct artists, most-recent-first (index 0 = newest).
const history30 = Array.from({ length: 30 }, (_, i) => entry(`A${i}`, `song${i}`, i));

describe('seededRng', () => {
	it('replays the same sequence for the same seed, in [0,1), and differs across seeds', () => {
		const a = seededRng(7);
		const b = seededRng(7);
		const seqA = Array.from({ length: 5 }, () => a());
		const seqB = Array.from({ length: 5 }, () => b());
		expect(seqA).toEqual(seqB);
		for (const v of seqA) {
			expect(v).toBeGreaterThanOrEqual(0);
			expect(v).toBeLessThan(1);
		}
		expect(seededRng(7)()).not.toBe(seededRng(8)());
	});
});

describe('shuffle rng', () => {
	it('() => 0.999 is the identity rng (j = floor(0.999*(i+1)) = i for length < 1000)', () => {
		const input = [1, 2, 3, 4];
		expect(shuffle(input, () => 0.999)).toEqual([1, 2, 3, 4]);
	});

	it('() => 0 reorders the same members without mutating the input', () => {
		const input = [1, 2, 3, 4];
		const out = shuffle(input, () => 0);
		expect(out).not.toEqual([1, 2, 3, 4]);
		expect([...out].sort()).toEqual([1, 2, 3, 4]);
		expect(input).toEqual([1, 2, 3, 4]);
	});
});

describe('pickRadioSeeds — window sampling', () => {
	it('samples n distinct-artist seeds from the SEED_WINDOW most recent', () => {
		const picked = pickRadioSeeds(history30, 4, seededRng(1));
		expect(picked).toHaveLength(4);
		for (const p of picked) expect(history30.indexOf(p)).toBeLessThan(SEED_WINDOW);
		expect(new Set(picked.map((p) => p.artist)).size).toBe(4);
	});

	it('same rng → same seeds', () => {
		expect(pickRadioSeeds(history30, 4, seededRng(1))).toEqual(pickRadioSeeds(history30, 4, seededRng(1)));
	});

	it('different rng → different seeds', () => {
		expect(pickRadioSeeds(history30, 4, () => 0.999)).toEqual(history30.slice(0, 4));
		expect(pickRadioSeeds(history30, 4, () => 0)).not.toEqual(history30.slice(0, 4));
	});
});

describe('mergeRadio — rng pool cut', () => {
	const x1 = mk('x1', 'X', 'x one');
	const x2 = mk('x2', 'X', 'x two');
	const x3 = mk('x3', 'X', 'x three');
	const y1 = mk('y1', 'Y', 'y one');
	const y2 = mk('y2', 'Y', 'y two');

	it('never picks beyond RADIO_POOL of a seed list and does not mutate it', () => {
		const list = Array.from({ length: RADIO_POOL + 5 }, (_, i) => mk(`p${i}`, 'P', `p ${i}`));
		const snapshot = [...list];
		const out = mergeRadio([list], new Set(), 40, () => 0);
		expect(out).toHaveLength(RADIO_POOL);
		for (const t of out) expect(list.indexOf(t)).toBeLessThan(RADIO_POOL);
		expect(list).toEqual(snapshot);
	});

	it('still drops heard songs, dedupes uids and honours the cap', () => {
		const heard = new Set([matchKey(y1.artist, y1.title)]);
		const out = mergeRadio([[x1, x2], [y1, y2]], heard, 3, () => 0);
		expect(out).not.toContain(y1);
		expect(new Set(out.map((t) => t.uid)).size).toBe(out.length);
		expect(out).toHaveLength(3);
		expect(mergeRadio([[x1], [x1]], new Set(), 10, () => 0)).toEqual([x1]);
	});

	it('reorders a list within the pool', () => {
		const out = mergeRadio([[x1, x2, x3]], new Set(), 3, () => 0);
		expect([...out].sort((a, b) => a.uid.localeCompare(b.uid))).toEqual([x1, x2, x3]);
		expect(out).not.toEqual([x1, x2, x3]);
	});
});

describe('buildRadio — session seed + budget', () => {
	it('replays one draw per session and spends exactly RADIO_SEEDS Last.fm calls per build', async () => {
		const lf = vi.mocked(fetchSimilarTracks);
		const dz = vi.mocked(deezerArtistRadio);
		lf.mockClear();
		dz.mockClear();

		const first = await buildRadio(history30, 12);
		expect(lf).toHaveBeenCalledTimes(RADIO_SEEDS);
		const second = await buildRadio(history30, 12);
		expect(lf).toHaveBeenCalledTimes(RADIO_SEEDS * 2);
		expect(second).toEqual(first);
		expect(first.length).toBeGreaterThan(0);
		expect(dz).not.toHaveBeenCalled();

		// A reseed (the home Randomize button) still costs the same budget. The result is NOT
		// asserted to differ — a same-draw collision is possible in principle; the deterministic
		// rng cases above already prove "different rng → different".
		reseedRadio();
		lf.mockClear();
		await buildRadio(history30, 12);
		expect(lf).toHaveBeenCalledTimes(RADIO_SEEDS);
		expect(dz).not.toHaveBeenCalled();
	});
});
