import { describe, it, expect } from 'vitest';
import { RESOLVE_URL_TTL_S } from '$lib/proxy/resolve-cache';
import type { Track } from '$lib/sources/types';
import { hasFreshAudioUrl, isTrackReady } from './track-ready';

// track-ready is the SINGLE definition of the readiness guard (debug slow-cold-start-first-playing).
// It replaced five inline copies of `detailsLoaded && audioUrl && …` spread across catalog, the
// player store, prewarm, download-track and the track-menu gate — four of which silently lacked the
// freshness check. These tests pin the contract every one of those call sites now delegates to.

const TTL_MS = RESOLVE_URL_TTL_S * 1000;

function mk(over: Partial<Track> = {}): Track {
	return {
		uid: 'qq:1',
		source: 'qq',
		songid: '1',
		title: 'Song',
		artist: 'Artist',
		album: '',
		cover: null,
		audioUrl: 'https://cdn.example.com/a.flac',
		lrc: null,
		lrcUrl: null,
		detailsLoaded: true,
		resolvedAt: Date.now(),
		quality: null,
		qualityLabel: null,
		keyword: 'x',
		displayIndex: 1,
		...over
	};
}

describe('hasFreshAudioUrl — "can this go to <audio> right now?"', () => {
	it('true for a resolved track stamped just now', () => {
		expect(hasFreshAudioUrl(mk())).toBe(true);
	});

	it('false once the url ages past the trust window', () => {
		expect(hasFreshAudioUrl(mk({ resolvedAt: Date.now() - (TTL_MS + 1) }))).toBe(false);
	});

	it('true right up to the edge of the window', () => {
		expect(hasFreshAudioUrl(mk({ resolvedAt: Date.now() - (TTL_MS - 5_000) }))).toBe(true);
	});

	// The whole point of defaulting to stale: `resolvedAt` is stamped ONLY by ensureTrackDetails, so
	// an unstamped url was never age-validated. Re-resolving costs ~100ms; a dead url costs ~8.4s.
	it('false when never stamped — unstamped is STALE by construction', () => {
		expect(hasFreshAudioUrl(mk({ resolvedAt: undefined }))).toBe(false);
	});

	it('false without an audioUrl, and false when details never loaded', () => {
		expect(hasFreshAudioUrl(mk({ audioUrl: null }))).toBe(false);
		expect(hasFreshAudioUrl(mk({ detailsLoaded: false }))).toBe(false);
	});

	// A fresh url is enough for the PRE-WARM paths — they do not wait on lyrics.
	it('true for a fresh url whose lyrics are still unresolved', () => {
		expect(hasFreshAudioUrl(mk({ lrc: null, lrcUrl: 'https://cdn/x.lrc' }))).toBe(true);
	});
});

describe('isTrackReady — "is there nothing left to resolve?"', () => {
	it('true when the url is fresh and there is no lrcUrl to chase', () => {
		expect(isTrackReady(mk({ lrc: null, lrcUrl: null }))).toBe(true);
	});

	it('true when the url is fresh and the lyrics already landed', () => {
		expect(isTrackReady(mk({ lrc: '[00:01]hi', lrcUrl: 'https://cdn/x.lrc' }))).toBe(true);
	});

	// THE distinction between the two predicates: netease resolves lrc from a separate lrcUrl, so an
	// unresolved lrcUrl means work remains even though the audio url is perfectly good.
	it('false for an UNRESOLVED lrcUrl — the one case the two predicates disagree on', () => {
		const t = mk({ lrc: null, lrcUrl: 'https://cdn/x.lrc' });
		expect(hasFreshAudioUrl(t)).toBe(true);
		expect(isTrackReady(t)).toBe(false);
	});

	it('inherits every freshness rule (stale and unstamped are both not ready)', () => {
		expect(isTrackReady(mk({ resolvedAt: Date.now() - (TTL_MS + 1) }))).toBe(false);
		expect(isTrackReady(mk({ resolvedAt: undefined }))).toBe(false);
	});
});
