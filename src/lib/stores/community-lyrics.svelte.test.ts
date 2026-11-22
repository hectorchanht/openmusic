// quick-261122-ugcb3 — the community rung of the lyric read + the client service's status mapping.
//
// Read chain (brief §4): pin → upstream track.lrc → COMMUNITY canonical → null. These pin the order
// so a later "simplification" of readLyrics cannot silently let a community version outrank the
// user's own pin or an upstream lyric. Node-runnable: transports are stub fetchers.
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { readLyrics, pinLyrics, hasLyricPin } from './lyric-pins.svelte';
import { communityLyrics } from './community-lyrics.svelte';
import {
	projectVersions,
	submitCommunityLyrics,
	voteCommunityLyrics,
	fetchCommunityLyrics,
	lyricsSongKey
} from '$lib/services/community-lyrics';
import { makeUid, type Track } from '$lib/sources/types';

class MemStorage {
	private m = new Map<string, string>();
	getItem(k: string) {
		return this.m.has(k) ? (this.m.get(k) as string) : null;
	}
	setItem(k: string, v: string) {
		this.m.set(k, String(v));
	}
	removeItem(k: string) {
		this.m.delete(k);
	}
	clear() {
		this.m.clear();
	}
}

let n = 0;
function mk(lrc: string | null): Track {
	const songid = `c${++n}`;
	return {
		uid: makeUid('kuwo', songid),
		source: 'kuwo',
		songid,
		title: `Indie Song ${n}`,
		artist: 'Jack Choo',
		album: '',
		cover: null,
		audioUrl: null,
		lrc,
		detailsLoaded: true
	} as unknown as Track;
}

const COMMUNITY = '[00:01.00][00:03.00]community line';
const V = (id: string, lrc = COMMUNITY, pins = 1) => ({ id, lrc, cls: 'estimated', t: 1, pins });
const json = (body: unknown, status = 200) =>
	new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

beforeEach(() => {
	vi.stubGlobal('localStorage', new MemStorage());
});
afterEach(() => {
	vi.unstubAllGlobals();
});

describe('readLyrics — community is the THIRD rung', () => {
	async function withCommunity(track: Track, versions: unknown[]) {
		vi.stubGlobal('fetch', vi.fn(async () => json({ ok: true, versions })));
		await communityLyrics.ensure(track);
	}

	it('fills the no-lyrics case with the canonical (first) version', async () => {
		const tr = mk(null);
		expect(readLyrics(tr)).toBeNull();
		await withCommunity(tr, [V('a'), V('b', '[00:01.00]other')]);
		expect(readLyrics(tr)).toBe(COMMUNITY);
		// a community lyric is NOT a pin (pickers must not offer "Use automatic" for it)
		expect(hasLyricPin(tr)).toBe(false);
	});

	it('upstream track.lrc outranks community', async () => {
		const tr = mk('[00:01.00]upstream');
		await withCommunity(tr, [V('a')]);
		expect(readLyrics(tr)).toBe('[00:01.00]upstream');
	});

	it("the user's pin outranks both", async () => {
		const tr = mk(null);
		await withCommunity(tr, [V('a')]);
		pinLyrics(tr.uid, '[00:01.00]mine');
		expect(readLyrics(tr)).toBe('[00:01.00]mine');
		expect(hasLyricPin(tr)).toBe(true);
	});

	it('ensure is idempotent per uid (one GET per song per session)', async () => {
		const tr = mk(null);
		const f = vi.fn(async () => json({ ok: true, versions: [] }));
		vi.stubGlobal('fetch', f);
		await communityLyrics.ensure(tr);
		await communityLyrics.ensure(tr);
		expect(f).toHaveBeenCalledTimes(1);
	});

	it('a failed fetch degrades to no community lyric, never a throw', async () => {
		const tr = mk(null);
		vi.stubGlobal('fetch', vi.fn(async () => { throw new Error('offline'); }));
		await communityLyrics.ensure(tr);
		expect(readLyrics(tr)).toBeNull();
		expect(communityLyrics.isLoading(tr.uid)).toBe(false);
	});
});

describe('client service', () => {
	it('projectVersions drops malformed rows', () => {
		expect(projectVersions([V('a'), { id: 1 }, null, { ...V('b'), cls: 'weird' }])).toEqual([V('a')]);
		expect(projectVersions('nope')).toBeNull();
	});
	it('the song key is the comments thread key (deterministic 32 hex)', async () => {
		const k = await lyricsSongKey('Jack Choo', 'Indie Song');
		expect(k).toMatch(/^[0-9a-f]{32}$/);
		expect(await lyricsSongKey('Jack Choo', 'Indie Song')).toBe(k);
	});
	it('fetch uses exactly ?k=<k> (the edge-cache bust key)', async () => {
		const f = vi.fn(async (_p: string) => json({ ok: true, versions: [V('a')] }));
		await fetchCommunityLyrics('ab'.repeat(16), undefined, f);
		expect(f.mock.calls[0][0]).toBe(`/api/lyrics?k=${'ab'.repeat(16)}`);
	});
	const input = { k: 'ab'.repeat(16), lrc: 'x', estimated: true, title: 't', artist: 'a', duration: 1, token: 'tok' };
	it('submit maps statuses to typed errors', async () => {
		const at = (res: Response) => submitCommunityLyrics(async () => res, input);
		expect(await at(json({ ok: false, err: 'signin' }, 401))).toEqual({ ok: false, err: 'signin' });
		expect(await at(json({ ok: false, err: 'slow-down' }, 429))).toEqual({ ok: false, err: 'slow-down' });
		expect(await at(json({ ok: false, err: 'turnstile' }, 403))).toEqual({ ok: false, err: 'verify' });
		expect(await at(json({ ok: false, err: 'check', reason: 'url' }, 422))).toEqual({ ok: false, err: 'check', reason: 'url' });
		expect(await at(json({ ok: false }, 500))).toEqual({ ok: false, err: 'unavailable' });
		expect(await at(json({ ok: true, id: 'i', lrc: 'L', versions: [V('i')] }))).toEqual({
			ok: true,
			id: 'i',
			lrc: 'L',
			versions: [V('i')]
		});
	});
	it('submit never throws', async () => {
		expect(await submitCommunityLyrics(async () => { throw new Error('x'); }, input)).toEqual({ ok: false, err: 'unavailable' });
	});
	it('vote returns the fresh list or null', async () => {
		expect(await voteCommunityLyrics(async () => json({ ok: true, versions: [V('a')] }), 'k', 'a', 'pin')).toEqual([V('a')]);
		expect(await voteCommunityLyrics(async () => json({}, 404), 'k', 'a', 'pin')).toBeNull();
	});
});
