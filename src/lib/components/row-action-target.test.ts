import { describe, it, expect } from 'vitest';
import { hasRealIdentity, rowActionTarget } from './row-action-target';
import { nameStub } from '$lib/services/similar';
import type { Track } from '$lib/sources/types';

// The decision behind SongRow's inline Like / Download on a STUB row (quick-260919-l9e). The three
// row shapes that reach SongRow are asserted against the real stub factories where one exists —
// `nameStub` is the album/Up-Next producer, so the synthetic-uid case is tested against the actual
// thing rather than a hand-written approximation of it.

function real(overrides: Partial<Track> = {}): Track {
	return {
		uid: 'kuwo:12345',
		source: 'kuwo',
		songid: '12345',
		title: 'Song',
		artist: 'Artist',
		album: '',
		cover: null,
		audioUrl: 'https://cdn.example.com/a.mp3',
		lrc: null,
		lrcUrl: null,
		detailsLoaded: true,
		quality: null,
		qualityLabel: null,
		keyword: 'x',
		displayIndex: 1,
		...overrides
	};
}

/** The charts/top · charts/tags · charts/countries row: a DiscoveryTrack lifted to a uid-less Track. */
function discoveryStub(): Track {
	return real({ uid: '', source: 'netease', songid: '', audioUrl: null, detailsLoaded: false });
}

describe('hasRealIdentity — may this uid be persisted?', () => {
	it('a resolved track has identity', () => {
		expect(hasRealIdentity(real())).toBe(true);
	});

	it("a discovery stub (uid: '') has none", () => {
		expect(hasRealIdentity(discoveryStub())).toBe(false);
	});

	it('an ALBUM name-stub is refused even though its uid is TRUTHY (the synthetic-uid hazard)', () => {
		const stub = nameStub('Artist', 'Song');
		expect(stub).not.toBeNull();
		// The whole point: a `!track.uid` guard would wave this through into the liked list.
		expect(stub!.uid).toBeTruthy();
		expect(stub!.uid).toContain('similar-');
		expect(hasRealIdentity(stub)).toBe(false);
	});

	it('null / undefined have none', () => {
		expect(hasRealIdentity(null)).toBe(false);
		expect(hasRealIdentity(undefined)).toBe(false);
	});
});

describe('rowActionTarget — act / resolve / refuse', () => {
	it('a real row acts on itself, with or without a resolver', () => {
		const tr = real();
		expect(rowActionTarget(tr, null, false)).toEqual({ kind: 'act', track: tr });
		expect(rowActionTarget(tr, null, true)).toEqual({ kind: 'act', track: tr });
	});

	it('a discovery stub with a resolver resolves first', () => {
		expect(rowActionTarget(discoveryStub(), null, true)).toEqual({ kind: 'resolve' });
	});

	it('an album name-stub with a resolver resolves first — it never acts on the synthetic uid', () => {
		expect(rowActionTarget(nameStub('Artist', 'Song')!, null, true)).toEqual({ kind: 'resolve' });
	});

	it('a stub with NO resolver refuses (the caller must toast, not silently no-op)', () => {
		expect(rowActionTarget(discoveryStub(), null, false)).toEqual({ kind: 'refuse' });
		expect(rowActionTarget(nameStub('Artist', 'Song')!, null, false)).toEqual({ kind: 'refuse' });
	});

	it('an already-resolved stub acts on the RESOLVED track — one resolve serves both buttons', () => {
		const resolvedTrack = real();
		expect(rowActionTarget(discoveryStub(), resolvedTrack, true)).toEqual({
			kind: 'act',
			track: resolvedTrack
		});
		expect(rowActionTarget(nameStub('Artist', 'Song')!, resolvedTrack, true)).toEqual({
			kind: 'act',
			track: resolvedTrack
		});
	});

	it('a cached resolve that is itself a name-stub is NOT trusted (falls back to resolving)', () => {
		expect(rowActionTarget(discoveryStub(), nameStub('A', 'B'), true)).toEqual({ kind: 'resolve' });
	});
});
