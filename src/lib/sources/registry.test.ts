import { describe, it, expect } from 'vitest';
import { SOURCES, getEnabledAdapters } from './registry';
import { makeUid, type SourceId } from './types';

// Phase 26 (RESOLVE-01, POLICY.md / spikes 001+004): the registry is now kuwo-FIRST. Order is
// load-bearing — getEnabledAdapters / fallbackOrder / resolveNameStub / interleave all inherit it,
// so the kuwo-first resolve floor is asserted here at the single enumeration point.
const EXPECTED_KEYS: SourceId[] = ['kuwo', 'qq', 'netease', 'joox', 'fivesing', 'jamendo', 'audius'];

describe('SOURCES registry (DATA-04 — single enumeration point)', () => {
	// Test 4: exactly the expected keys IN kuwo-first order; each value's .id matches its key.
	// hvu: 5sing (Kugou UGC) added opt-in, flipped to enabledByDefault:true in 1bf113c.
	// ixw: jamendo (CC indie) added opt-in, flipped to enabledByDefault:true in 1bf113c.
	// 0zn: audius (Western/indie/UGC) added with enabledByDefault:true.
	it('enumerates exactly kuwo,qq,netease,joox,fivesing,jamendo,audius (kuwo-first resolve floor)', () => {
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
		// (jamendo + audius default to true, so an incomplete prefs map would let them through).
		const onlyNetease = getEnabledAdapters({
			netease: true,
			qq: false,
			kuwo: false,
			joox: false,
			fivesing: false,
			jamendo: false,
			audius: false
		});
		expect(onlyNetease.map((a) => a.id)).toEqual(['netease']);
	});
});

describe('makeUid', () => {
	it('produces the colon form (D-10)', () => {
		expect(makeUid('netease', '123')).toBe('netease:123');
	});
});
