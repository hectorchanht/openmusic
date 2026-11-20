import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// browser-gated: the module no-ops under SSR. Flip it on so the DOM path is what we test.
vi.mock('$app/environment', () => ({ browser: true }));

import { preconnectForSource, noteAudioOrigin, __resetPreconnect } from './preconnect';

// Minimal <head> stand-in — the single Vitest project is node, with no jsdom (see CLAUDE.md).
let appended: Array<Record<string, unknown>>;

beforeEach(() => {
	__resetPreconnect();
	appended = [];
	vi.stubGlobal('document', {
		createElement: () => ({}) as Record<string, unknown>,
		head: { appendChild: (el: Record<string, unknown>) => appended.push(el) }
	});
});

afterEach(() => vi.unstubAllGlobals());

describe('preconnectForSource', () => {
	it('emits a rel=preconnect link for a seeded source', () => {
		preconnectForSource('qq');

		expect(appended).toHaveLength(1);
		expect(appended[0].rel).toBe('preconnect');
		expect(appended[0].href).toBe('https://isure6.stream.qqmusic.qq.com');
		// The audio request is uncredentialed, so the anonymous socket is the one <audio> reuses.
		expect(appended[0].crossOrigin).toBe('anonymous');
	});

	it('is idempotent per origin — a second call adds no second link', () => {
		preconnectForSource('qq');
		preconnectForSource('qq');
		expect(appended).toHaveLength(1);
	});

	// netease streams through our OWN worker (/api/netease/url), so that connection is already open
	// from loading the page. An unknown source must be a silent no-op, never an error.
	it('is a no-op for a source with no known origin', () => {
		preconnectForSource('netease');
		expect(appended).toHaveLength(0);
	});
});

describe('noteAudioOrigin — self-learning host map', () => {
	// The seeded qq shard is `isure6`; that digit is exactly the kind of thing a CDN renames, so an
	// observed url must win over the seed rather than requiring a code change.
	it('a resolved url overrides the seed for that source', () => {
		noteAudioOrigin('qq', 'https://isure9.stream.qqmusic.qq.com/F000.flac?vkey=abc');

		preconnectForSource('qq');

		expect(appended[0].href).toBe('https://isure9.stream.qqmusic.qq.com');
	});

	it('teaches an origin for a source that had none', () => {
		noteAudioOrigin('joox', 'https://cdn.joox.example/song.m4a');

		preconnectForSource('joox');

		expect(appended[0].href).toBe('https://cdn.joox.example');
	});

	// A relative url means our own proxy is serving the bytes — that connection is already
	// established, so it must not displace a real CDN origin.
	it('ignores a relative (own-proxy) url', () => {
		noteAudioOrigin('qq', '/api/netease/url?id=1');

		preconnectForSource('qq');

		expect(appended[0].href).toBe('https://isure6.stream.qqmusic.qq.com'); // seed intact
	});

	it('ignores null / garbage without throwing', () => {
		expect(() => noteAudioOrigin('qq', null)).not.toThrow();
		expect(() => noteAudioOrigin('qq', 'not a url')).not.toThrow();

		preconnectForSource('qq');
		expect(appended[0].href).toBe('https://isure6.stream.qqmusic.qq.com');
	});
});
