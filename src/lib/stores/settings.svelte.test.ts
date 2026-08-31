import { describe, it, expect, beforeEach } from 'vitest';
import { settings, FONT_SCALE_MIN, FONT_SCALE_MAX } from './settings.svelte';
import { UPNEXT_DEFAULTS } from '$lib/config/defaults';
import type { QueueContext, UpnextMode } from '$lib/config/defaults';
import { darken } from '$lib/services/color';
import { migrateDensity } from '$lib/services/home-layout';

/** clampInt is a module-private helper; re-state its exact contract here so the FONT_SCALE
 *  cases assert the load()-path clamp behaviour without exporting internals. Mirrors
 *  settings.svelte.ts lines 60-64 verbatim. */
const clampInt = (n: unknown, min: number, max: number, def: number): number => {
	if (typeof n !== 'number' || !Number.isFinite(n)) return def;
	const f = Math.round(n);
	return f < min ? min : f > max ? max : f;
};

// Headless runes (node project) — mirrors player.svelte.test.ts style. Under the node
// project `browser` is false, so settings.load() is a no-op and the $state initializers
// hold. We assert the 32-D-02 default WITHOUT mutating it first.
describe('settings (32-D-02 defaultQuality default)', () => {
	// DECISION CHANGE, not a bug fix: 32-D-02 supersedes D-03. The pinned default moved
	// '128' → 'auto' because D-03's "128–160k band" premise was measured wrong (32-D-04:
	// the '128' rung is 98 kbps). 'auto' is resolved to a concrete tier by
	// `sources/quality.ts` effectiveQuality at every adapter call site.
	it("defaults defaultQuality to 'auto' (32-D-02, was '128' under D-03)", () => {
		expect(settings.defaultQuality).toBe('auto');
	});

	it('exposes a preferredSource getter that is undefined when defaultSource is auto', () => {
		// defaultSource defaults to 'auto' → no preference
		expect(settings.preferredSource).toBeUndefined();
	});
});

// Phase 17 (QUEUE-03) — per-context up-next sourcing resolver + reset wiring.
// load() is browser-guarded (no-op under the node project), so the malformed/absent
// parse cases are exercised against the same defensive logic via resetPlayback() +
// direct field assignment (the shapes the load() guard produces).
describe('settings.effectiveUpnextMode (Phase 17 QUEUE-03)', () => {
	beforeEach(() => {
		// Restore Phase-17 fields to defaults before each case (shared singleton).
		settings.upnextMode = UPNEXT_DEFAULTS.mode;
		settings.upnextPerContext = {};
	});

	it("effectiveUpnextMode(null) returns the global default 'generated'", () => {
		expect(settings.effectiveUpnextMode(null)).toBe('generated');
	});

	it("effectiveUpnextMode('search') with no override returns 'generated'", () => {
		expect(settings.effectiveUpnextMode('search')).toBe('generated');
	});

	it("effectiveUpnextMode('liked') returns 'same-list' after a per-context override", () => {
		settings.upnextPerContext = { ...settings.upnextPerContext, liked: 'same-list' };
		expect(settings.effectiveUpnextMode('liked')).toBe('same-list');
	});

	it('a context with no perContext key falls back to the global upnextMode', () => {
		settings.upnextMode = 'same-list';
		settings.upnextPerContext = { liked: 'generated' };
		// 'album' has no override → falls back to the (mutated) global mode
		expect(settings.effectiveUpnextMode('album')).toBe('same-list');
		// 'liked' override still wins
		expect(settings.effectiveUpnextMode('liked')).toBe('generated');
	});

	it("effectiveUpnextMode('remix') returns 'generated' even under a global 'same-list' (Phase 19 D-06)", () => {
		// The user has globally chosen 'same-list' — an ordinary context would honour it…
		settings.upnextMode = 'same-list';
		expect(settings.effectiveUpnextMode(null)).toBe('same-list');
		// …but an explicit Remix force-generates regardless (the early-return).
		expect(settings.effectiveUpnextMode('remix')).toBe('generated');
		// Even a (hypothetical) per-context 'same-list' override cannot defeat it.
		settings.upnextPerContext = { ...settings.upnextPerContext, remix: 'same-list' };
		expect(settings.effectiveUpnextMode('remix')).toBe('generated');
	});

	it("resetPlayback() restores upnextPerContext to the default perContext (album → 'same-list', ALBUM ONLY) and upnextMode to generated", () => {
		settings.upnextMode = 'same-list';
		settings.upnextPerContext = { liked: 'same-list', search: 'same-list' };
		settings.resetPlayback();
		// resetPlayback spreads DEFAULTS.upnext.perContext. quick-260831-jtw: `artist` was dropped
		// from that default, so a reset no longer pins artist taps to the visible list.
		expect(settings.upnextPerContext).toEqual({ album: 'same-list' });
		expect(settings.upnextMode).toBe('generated');
	});

	it('a malformed (array/non-object) perContext shape defensively resolves to {} → global', () => {
		// Mirror the load() guard outcome: a malformed value becomes {}.
		const malformed = [] as unknown;
		settings.upnextPerContext =
			malformed && typeof malformed === 'object' && !Array.isArray(malformed)
				? (malformed as Record<string, never>)
				: {};
		expect(settings.upnextPerContext).toEqual({});
		expect(settings.effectiveUpnextMode('liked')).toBe('generated');
	});

	it('an absent perContext leaves it {} (no migration needed) → global default', () => {
		// Absent on a fresh load → the $state initializer keeps {}.
		expect(settings.upnextPerContext).toEqual({});
		expect(settings.effectiveUpnextMode('downloads')).toBe('generated');
	});
});

// quick-260831-jtw — "similar songs in Up-Next consistently". UPNEXT_DEFAULTS.perContext is now
// the ACTUAL seed for upnextPerContext (init + load merge), not just what resetPlayback() spreads,
// so a fresh install and a post-reset install agree. Album is the ONLY same-list context.
describe('settings.upnextPerContext seeded default (quick-260831-jtw)', () => {
	beforeEach(() => {
		settings.upnextMode = UPNEXT_DEFAULTS.mode;
		settings.upnextPerContext = { ...UPNEXT_DEFAULTS.perContext };
	});

	it('the default perContext pins album ONLY — artist is not in it', () => {
		expect(UPNEXT_DEFAULTS.perContext).toEqual({ album: 'same-list' });
	});

	it("album keeps its own order ('same-list') under the seeded default", () => {
		expect(settings.effectiveUpnextMode('album')).toBe('same-list');
	});

	it.each(['artist', 'search', 'liked', 'downloads', 'playlist', 'home-discovery', 'history'] as const)(
		"'%s' generates similar songs under the seeded default",
		(ctx) => {
			expect(settings.effectiveUpnextMode(ctx)).toBe('generated');
		}
	);

	// load() is browser-guarded (no-op under the node project), so mirror its merge shape here —
	// the same technique the Phase-17 cases above use for the defensive parse.
	const mergeLikeLoad = (persisted: unknown) => ({
		...UPNEXT_DEFAULTS.perContext,
		...(persisted && typeof persisted === 'object' && !Array.isArray(persisted)
			? (persisted as Partial<Record<Exclude<QueueContext, null>, UpnextMode>>)
			: {})
	});

	it('an absent persisted map still yields the album default (merge, not replace)', () => {
		settings.upnextPerContext = mergeLikeLoad(undefined);
		expect(settings.upnextPerContext).toEqual({ album: 'same-list' });
		expect(settings.effectiveUpnextMode('album')).toBe('same-list');
	});

	it('a malformed (array) persisted map still yields the album default', () => {
		settings.upnextPerContext = mergeLikeLoad([]);
		expect(settings.upnextPerContext).toEqual({ album: 'same-list' });
	});

	it('a persisted key WINS over the default — no migration (T2 decision)', () => {
		// A user who deliberately pinned artist to 'same-list' in Settings keeps that choice…
		settings.upnextPerContext = mergeLikeLoad({ artist: 'same-list' });
		expect(settings.effectiveUpnextMode('artist')).toBe('same-list');
		// …and the album default is still merged in alongside it.
		expect(settings.effectiveUpnextMode('album')).toBe('same-list');
	});

	it('a persisted album override can defeat the default (the toggle still works both ways)', () => {
		settings.upnextPerContext = mergeLikeLoad({ album: 'generated' });
		expect(settings.effectiveUpnextMode('album')).toBe('generated');
	});
});

// homeSectionDensity (HOME-02 / D-07) — per-section density OVERRIDE map plumbed through the
// WR-10 3-touch-point pattern (field init / load guard / save+reset). It mirrors the
// enabledSources + upnextPerContext "object-not-array" load guard (threat T-23-06): a persisted
// Array or non-object must coerce to {} so the home render never reads a malformed override map.
describe('settings.homeSectionDensity (HOME-02 / D-07)', () => {
	it('a fresh load (no stored value) keeps the empty override map {}', () => {
		// Under the node project load() is a no-op → the $state initializer holds.
		expect(settings.homeSectionDensity).toEqual({});
	});

	it('a valid stored map loads (migrated) — well-formed object value', () => {
		// Mirror the load() guard + per-entry migration outcome for a well-formed object value.
		const stored = { tags: 'pile' } as unknown;
		const migrate = (raw: unknown): Record<string, string> => {
			if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return {};
			const out: Record<string, string> = {};
			for (const [k, val] of Object.entries(raw as Record<string, unknown>)) {
				const m = migrateDensity(val);
				if (m) out[k] = m;
			}
			return out;
		};
		settings.homeSectionDensity = migrate(stored) as never;
		expect(settings.homeSectionDensity).toEqual({ tags: 'pile' });
	});

	it('a malformed (array/non-object) stored value coerces to {} (object-not-array guard, T-23-06)', () => {
		for (const malformed of [[] as unknown, 'compact' as unknown, 42 as unknown, null as unknown]) {
			settings.homeSectionDensity =
				malformed && typeof malformed === 'object' && !Array.isArray(malformed)
					? (malformed as Record<string, never>)
					: {};
			expect(settings.homeSectionDensity).toEqual({});
		}
	});

	// quick-260618-goe — non-destructive migration of the persisted density values. load() is a
	// no-op under the node project, so we drive the PURE migrateDensity helper directly, mirroring
	// the load-guard logic (the same helper the store calls).
	it('migrates a stored homeDensity legacy value: compact → list, comfortable → pile', () => {
		expect(migrateDensity('compact')).toBe('list');
		expect(migrateDensity('comfortable')).toBe('pile');
	});

	it('migrates a stored homeSectionDensity map per-entry (legacy → renamed), dropping garbage', () => {
		const stored = { tags: 'comfortable', countries: 'compact', bogus: 'nope' } as unknown;
		const out: Record<string, string> = {};
		if (stored && typeof stored === 'object' && !Array.isArray(stored)) {
			for (const [k, val] of Object.entries(stored as Record<string, unknown>)) {
				const m = migrateDensity(val);
				if (m) out[k] = m;
			}
		}
		expect(out).toEqual({ tags: 'pile', countries: 'list' });
	});

	it('resetHome() restores homeSectionDensity to {}', () => {
		settings.homeSectionDensity = { tags: 'pile', countries: 'list' };
		settings.resetHome();
		expect(settings.homeSectionDensity).toEqual({});
	});
});

// Phase 17 (UX-03 / D-11) — FONT_SCALE clamp widened to 50..200. Persisted 70-160 values
// (the old bounds) must still load unchanged; out-of-range values clamp to the new bounds.
describe('FONT_SCALE bounds (Phase 17 UX-03 / D-11)', () => {
	it('exposes the widened bounds: MIN === 50, MAX === 200', () => {
		expect(FONT_SCALE_MIN).toBe(50);
		expect(FONT_SCALE_MAX).toBe(200);
	});

	it('a previously-valid persisted value (160) still loads unchanged within the new bounds', () => {
		expect(clampInt(160, FONT_SCALE_MIN, FONT_SCALE_MAX, 100)).toBe(160);
		// A value the OLD bounds would have rejected is now valid too.
		expect(clampInt(75, FONT_SCALE_MIN, FONT_SCALE_MAX, 100)).toBe(75);
		expect(clampInt(190, FONT_SCALE_MIN, FONT_SCALE_MAX, 100)).toBe(190);
	});

	it('out-of-range persisted values clamp to the new bounds (250→200, 30→50)', () => {
		expect(clampInt(250, FONT_SCALE_MIN, FONT_SCALE_MAX, 100)).toBe(200);
		expect(clampInt(30, FONT_SCALE_MIN, FONT_SCALE_MAX, 100)).toBe(50);
	});

	it('a NaN/non-number persisted value falls back to the default (100)', () => {
		expect(clampInt(NaN, FONT_SCALE_MIN, FONT_SCALE_MAX, 100)).toBe(100);
		expect(clampInt('x', FONT_SCALE_MIN, FONT_SCALE_MAX, 100)).toBe(100);
	});
});

// Phase 17 (UX-07 / Pattern 5) — applyTheme derives --color-primary-hover from the accent
// via darken(accent, 0.12). Under the node project `browser` is false, so applyTheme() is a
// no-op (no documentElement); per the plan we assert the DERIVATION applyTheme uses — the
// exact value it would push to the CSS var — rather than the DOM side effect.
describe('accent-hover derivation (Phase 17 UX-07)', () => {
	it('darken(accent, 0.12) is the hover value applyTheme sets, and it is darker than the accent', () => {
		const accent = '#7c5cff';
		const hover = darken(accent, 0.12);
		expect(hover).toMatch(/^#[0-9a-f]{6}$/);
		expect(hover).not.toBe(accent);
		// Sanity: ~12% darken matches today's #7c5cff → #6a48f0 relationship (each channel down).
		const ch = (h: string): [number, number, number] => {
			const n = parseInt(h.replace('#', ''), 16);
			return [n >> 16, (n >> 8) & 0xff, n & 0xff];
		};
		const [r, g, b] = ch(hover);
		const [r0, g0, b0] = ch(accent);
		expect(r).toBeLessThan(r0);
		expect(g).toBeLessThan(g0);
		expect(b).toBeLessThan(b0);
	});

	it('applyTheme() is a safe no-op under the node project (browser false, no throw)', () => {
		settings.accent = '#1db954';
		expect(() => settings.applyTheme()).not.toThrow();
	});
});
