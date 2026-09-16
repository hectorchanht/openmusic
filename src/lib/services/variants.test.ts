import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { fetchVariants, versionsIncludingOwn } from './variants';
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

// quick-260916-0d9 — the "Download from…" picker's row list. The picker must ALWAYS show the song's
// own source (even when the fan-out returned nothing — CN blocked, offline, no match), and must show
// ONE row per source rather than a source's ten near-identical search hits.
describe('versionsIncludingOwn — the Download-from picker row list', () => {
	it('returns just the own track when the fan-out found nothing', () => {
		const seed = mk('qq', 'q1', 'Hello', 'Adele');
		expect(versionsIncludingOwn(seed, [])).toEqual([seed]);
	});

	it('puts the own track first, collapses intra-source duplicates, and never repeats a uid', () => {
		const seed = mk('qq', 'q1', 'Hello', 'Adele');
		const out = versionsIncludingOwn(seed, [
			mk('qq', 'q1', 'Hello', 'Adele'), // the fan-out's copy of the own track — same uid
			mk('kuwo', 'k1', 'Hello', 'Adele', { album: '25' }),
			mk('kuwo', 'k2', 'Hello', 'Adele', { album: '25' }), // same source + album → collapses
			mk('netease', 'n1', 'Hello', 'Adele')
		]);

		expect(out[0]).toBe(seed); // the ORIGINAL object, so the caller's seeded probe (keyed by its uid) lands
		expect(out.map((v) => v.source)).toEqual(['qq', 'kuwo', 'netease']);
		expect(new Set(out.map((v) => v.uid)).size).toBe(out.length);
	});

	it('keeps the handed track even when a higher-quality same-source hit would outrank it', () => {
		// better() inside collapseVariants would otherwise swap in the lossless sibling and the picker
		// would download under a uid the menu never opened on.
		const seed = mk('kuwo', 'k1', 'Hello', 'Adele', { album: '25', quality: '128k' });
		const out = versionsIncludingOwn(seed, [mk('kuwo', 'k9', 'Hello', 'Adele', { album: '25', quality: 'lossless' })]);
		expect(out).toEqual([seed]);
	});
});
