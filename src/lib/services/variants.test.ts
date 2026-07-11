import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { fetchVariants } from './variants';
import * as catalog from './catalog';
import { __clearSearchCache } from './ttl-cache';
import { makeUid, type SourceId, type Track } from '$lib/sources/types';

// Mirrors similar.test.ts / dedupe.test.ts mk() factory — a minimal valid Track fixture.
function mk(source: SourceId, songid: string, title: string, artist = 'a', extra: Partial<Track> = {}): Track {
	return {
		uid: makeUid(source, songid),
		source,
		songid,
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
		keyword: 'x',
		displayIndex: 1,
		...extra
	};
}

/** A SearchResult wrapping the given interleaved list (perSource is irrelevant here). */
function sr(interleaved: Track[]): catalog.SearchResult {
	return { perSource: [], interleaved };
}

beforeEach(() => {
	__clearSearchCache();
});
afterEach(() => {
	vi.restoreAllMocks();
	vi.unstubAllGlobals();
	__clearSearchCache();
});

describe('fetchVariants — single on-demand cross-source fan-out', () => {
	it('issues EXACTLY ONE searchAll (all-source, prefs {}) and returns the same-song cross-source group', async () => {
		const seed = mk('qq', 'q1', 'Hello', 'Adele');
		const spy = vi.spyOn(catalog, 'searchAll').mockResolvedValue(
			sr([
				mk('netease', 'n1', 'Hello', 'Adele'),
				mk('qq', 'q1', 'Hello', 'Adele'),
				mk('kuwo', 'k1', 'Hello', 'Adele'),
				mk('netease', 'n2', 'Someone Like You', 'Adele') // a DIFFERENT song — excluded from the group
			])
		);

		const out = await fetchVariants(seed);

		// The deliberate SINGLE fan-out — no per-source loop, no repeat.
		expect(spy).toHaveBeenCalledTimes(1);
		// all-enabled fan-out uses prefs {} (default enablement) — the 3rd positional arg.
		expect(spy.mock.calls[0][2]).toEqual({});
		// only the same-song variants, across sources, first-appearance order.
		expect(out).toHaveLength(3);
		expect(out.map((t) => t.source)).toEqual(['netease', 'qq', 'kuwo']);
	});

	it('returns just the one variant when a single source matches (caller decides whether to show the control)', async () => {
		const seed = mk('qq', 'q1', 'Hello', 'Adele');
		vi.spyOn(catalog, 'searchAll').mockResolvedValue(sr([mk('qq', 'q1', 'Hello', 'Adele')]));
		const out = await fetchVariants(seed);
		expect(out).toHaveLength(1);
		expect(out[0].source).toBe('qq');
	});

	it('returns [] on a blank query WITHOUT calling searchAll', async () => {
		const spy = vi.spyOn(catalog, 'searchAll');
		const out = await fetchVariants(mk('qq', 'q1', '', ''));
		expect(out).toEqual([]);
		expect(spy).not.toHaveBeenCalled();
	});

	it('never-throws — returns [] when searchAll rejects', async () => {
		vi.spyOn(catalog, 'searchAll').mockRejectedValue(new Error('network down'));
		const out = await fetchVariants(mk('qq', 'q1', 'Hello', 'Adele'));
		expect(out).toEqual([]);
	});

	it('returns [] on an empty search result', async () => {
		vi.spyOn(catalog, 'searchAll').mockResolvedValue(sr([]));
		const out = await fetchVariants(mk('qq', 'q1', 'Hello', 'Adele'));
		expect(out).toEqual([]);
	});

	it('returns [] when no group matches the track identity', async () => {
		vi.spyOn(catalog, 'searchAll').mockResolvedValue(sr([mk('netease', 'n1', 'Different Song', 'Nobody')]));
		const out = await fetchVariants(mk('qq', 'q1', 'Hello', 'Adele'));
		expect(out).toEqual([]);
	});

	it('honors the AbortSignal — returns [] when aborted during the search', async () => {
		const ctrl = new AbortController();
		vi.spyOn(catalog, 'searchAll').mockImplementation(async () => {
			ctrl.abort();
			return sr([mk('qq', 'q1', 'Hello', 'Adele')]);
		});
		const out = await fetchVariants(mk('qq', 'q1', 'Hello', 'Adele'), ctrl.signal);
		expect(out).toEqual([]);
	});
});
