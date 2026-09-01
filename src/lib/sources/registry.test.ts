import { describe, it, expect } from 'vitest';
import { SOURCES, getEnabledAdapters } from './registry';
import { makeUid, type SourceId } from './types';

// Order is load-bearing — getEnabledAdapters / fallbackOrder / resolveNameStub / interleave all
// inherit it, so the resolve floor is asserted here at the single enumeration point.
//
// Phase 26 (RESOLVE-01, POLICY.md / spikes 001+004) made the registry kuwo-FIRST.
// debug/upnext-diverse-fallback-kuwo-dead (2026-08-31) DEMOTED kuwo: its upstream
// (kw-api.cenguigui.cn) serves a TLS certificate that expired 2026-04-14, so every /api/kuwo/*
// request 526s. Holding the primary seat, it made similar.ts's single-source fallbacks return
// empty for every track. qq takes the floor (proven working), netease is #2, kuwo stays in the
// registry at #3 so restoring it is a one-literal move if the cert is renewed.
const EXPECTED_KEYS: SourceId[] = [
	'qq',
	'netease',
	'kuwo',
	'joox',
	'fivesing',
	'jamendo',
	'audius',
	'ytmusic'
];

describe('SOURCES registry (DATA-04 — single enumeration point)', () => {
	// Test 4: exactly the expected keys IN registry order; each value's .id matches its key.
	// hvu: 5sing (Kugou UGC) added opt-in, flipped to enabledByDefault:true in 1bf113c.
	// ixw: jamendo (CC indie) added opt-in, flipped to enabledByDefault:true in 1bf113c.
	// 0zn: audius (Western/indie/UGC) added with enabledByDefault:true.
	// 27-01: ytmusic (YouTube Music) appended LAST, enabledByDefault:true but autoResolveEligible:false
	// (searchable, off the resolve floor).
	it('enumerates exactly qq,netease,kuwo,joox,fivesing,jamendo,audius,ytmusic (qq-first floor; ytmusic last)', () => {
		expect(Object.keys(SOURCES)).toEqual(EXPECTED_KEYS);
	});

	it('each adapter .id matches its registry key', () => {
		for (const key of EXPECTED_KEYS) {
			expect(SOURCES[key].id).toBe(key);
		}
	});

	// Test 5: every adapter exposes search + resolve functions (stubs are conformant).
	it('every adapter exposes search() and resolve() functions', () => {
		for (const key of EXPECTED_KEYS) {
			expect(typeof SOURCES[key].search).toBe('function');
			expect(typeof SOURCES[key].resolve).toBe('function');
		}
	});

	// Note: all four adapters (netease/qq/kuwo/joox) are implemented as of Wave 2
	// (plans 01-02, 01-03). The earlier "stubs throw not-implemented" assertion was
	// removed when the stubs were filled in. Adapter shape is covered by Test 5 above;
	// per-source behavior is covered by each adapter's own *.test.ts.
});

describe('getEnabledAdapters', () => {
	it('returns only enabledByDefault adapters when no prefs given', () => {
		const enabled = getEnabledAdapters();
		const enabledIds = enabled.map((a) => a.id);
		for (const a of Object.values(SOURCES)) {
			if (a.enabledByDefault) expect(enabledIds).toContain(a.id);
			else expect(enabledIds).not.toContain(a.id);
		}
	});

	it('prefs override enabledByDefault (explicit false disables, explicit true enables)', () => {
		// Pass an explicit pref for EVERY source so none falls through to its enabledByDefault
		// (jamendo + audius + ytmusic default to true, so an incomplete prefs map would let them through).
		const onlyNetease = getEnabledAdapters({
			netease: true,
			qq: false,
			kuwo: false,
			joox: false,
			fivesing: false,
			jamendo: false,
			audius: false,
			ytmusic: false
		});
		expect(onlyNetease.map((a) => a.id)).toEqual(['netease']);
	});
});

describe('ytmusic registry placement (27-01, YT-SRC-01)', () => {
	it('is registered and its adapter .id is ytmusic', () => {
		expect(SOURCES.ytmusic).toBeDefined();
		expect(SOURCES.ytmusic.id).toBe('ytmusic');
	});

	it('is enabledByDefault (discoverable in the search fan-out)', () => {
		expect(SOURCES.ytmusic.enabledByDefault).toBe(true);
	});

	it('is flagged OFF the auto-resolve floor (autoResolveEligible === false)', () => {
		expect(SOURCES.ytmusic.autoResolveEligible).toBe(false);
	});

	it('is the LAST key of SOURCES (appended after audius; kuwo-first floor unchanged)', () => {
		const keys = Object.keys(SOURCES);
		expect(keys[keys.length - 1]).toBe('ytmusic');
		expect(keys.indexOf('ytmusic')).toBeGreaterThan(keys.indexOf('audius'));
	});

	it('appears in getEnabledAdapters({}) (enabled by default)', () => {
		expect(getEnabledAdapters().map((a) => a.id)).toContain('ytmusic');
	});

	it('mainstream sources stay auto-resolve eligible (undefined flag)', () => {
		// The kuwo→qq→netease→joox resolve floor must NOT be flagged off — only ytmusic is.
		for (const id of ['kuwo', 'qq', 'netease', 'joox'] as SourceId[]) {
			expect(SOURCES[id].autoResolveEligible).toBeUndefined();
		}
	});
});

// 27-04 (YT-RESILIENCE-01): the settings source-toggle (`{#each Object.values(SOURCES)}` +
// adapter.label + toggleSource, settings/playback/+page.svelte) and every source-label surface are
// REGISTRY-DRIVEN — ytmusic renders with ZERO per-source UI code. These assertions lock that contract
// in at the enumeration point so no bespoke ytmusic UI branch is ever needed.
describe('ytmusic registry-driven UI contract (27-04)', () => {
	it("exposes label 'YouTube Music' for the registry-driven toggle + source label", () => {
		expect(SOURCES.ytmusic.label).toBe('YouTube Music');
	});

	it('participates in the Object.values(SOURCES) toggle enumeration (no per-source branch)', () => {
		const labels = Object.values(SOURCES).map((a) => a.label);
		expect(labels).toContain('YouTube Music');
		// Every adapter carries a non-empty string label → the {#each Object.values(SOURCES)} toggle
		// renders each row uniformly; ytmusic needs no special-case markup.
		for (const a of Object.values(SOURCES)) {
			expect(typeof a.label).toBe('string');
			expect(a.label.length).toBeGreaterThan(0);
		}
	});

	it('a { ytmusic: false } enabledSources override is SourceId-keyed + well-typed (toggle persistence)', () => {
		// Documents the settings.enabledSources persistence path: keyed by SourceId, so the registry-
		// driven toggle can flip ytmusic without any per-source typing. `satisfies` proves it compiles.
		const override = { ytmusic: false } satisfies Partial<Record<SourceId, boolean>>;
		expect(override.ytmusic).toBe(false);
	});
});

describe('makeUid', () => {
	it('produces the colon form (D-10)', () => {
		expect(makeUid('netease', '123')).toBe('netease:123');
	});

	it('produces the colon form for ytmusic (songid = videoId)', () => {
		expect(makeUid('ytmusic', 'abc')).toBe('ytmusic:abc');
	});
});
