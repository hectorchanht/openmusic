import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { nextScrollLock } from './songbeat-scroll-lock';

// quick-261122-npfix — Song Beat scroll LOCK (Hector 2026-11-22). Reducer rules + source pins on
// the visible toggle (no jsdom: the pins read NpGame.svelte and FAIL if the toggle disappears,
// shrinks below 44px, leaves the top corner, or its icon stops mirroring the state).

describe('nextScrollLock', () => {
	it('auto-pins on round start, from either state', () => {
		expect(nextScrollLock(false, 'roundStart')).toBe(true);
		expect(nextScrollLock(true, 'roundStart')).toBe(true);
	});
	it('the toggle is a manual override in both directions', () => {
		expect(nextScrollLock(true, 'toggle')).toBe(false);
		expect(nextScrollLock(false, 'toggle')).toBe(true);
	});
	it('a round end releases the lock (results card must scroll)', () => {
		expect(nextScrollLock(true, 'roundEnd')).toBe(false);
	});
});

const src = readFileSync('src/lib/components/NpGame.svelte', 'utf-8');
const markup = src.slice(src.indexOf('<div class="game"'));
const style = src.slice(src.indexOf('<style'));

describe('Song Beat scroll-lock toggle (source pins)', () => {
	const btn = markup.match(/<button[^>]*class="lock-toggle"[\s\S]*?<\/button>/);

	it('exists on the game surface', () => {
		expect(btn, 'lock-toggle button').not.toBeNull();
	});

	it('icon shows the CURRENT state one-to-one: locked = Lock, unlocked = LockOpen', () => {
		expect(btn![0]).toMatch(/\{#if scrollLocked\}<Lock\b[^<]*\{:else\}<LockOpen\b[^<]*\{\/if\}/);
	});

	it('exposes its state to assistive tech (aria-pressed bound to the lock)', () => {
		expect(btn![0]).toMatch(/aria-pressed=\{scrollLocked\}/);
		expect(btn![0]).toMatch(/aria-label=\{t\('songbeat\.scrollLock'\)\}/);
	});

	it('is at least 44×44 and pinned to the TOP corner of the surface', () => {
		const rule = style.match(/\.lock-toggle\s*\{([^}]*)\}/);
		expect(rule).not.toBeNull();
		const px = (p: string) => Number(rule![1].match(new RegExp(`(?:^|;|\\s)${p}:\\s*(\\d+)px`))?.[1] ?? NaN);
		expect(px('width')).toBeGreaterThanOrEqual(44);
		expect(px('height')).toBeGreaterThanOrEqual(44);
		expect(rule![1]).toMatch(/position:\s*absolute/);
		expect(rule![1]).toMatch(/top:\s*\d+px/);
		expect(rule![1]).toMatch(/inset-inline-end:\s*\d+px/);
		expect(style).toMatch(/\.game\s*\{[^}]*position:\s*relative/);
	});

	it('the toggle flips the lock, and the surface is pinned by it', () => {
		expect(btn![0]).toMatch(/onclick=\{\(\) => \(scrollLocked = nextScrollLock\(scrollLocked, 'toggle'\)\)\}/);
		expect(markup).toMatch(/<div class="game"[^>]*use:pinScroll=\{scrollLocked\}/);
	});

	it('auto-pin on round start stays: every run creation re-pins', () => {
		const starts = src.match(/scrollLocked = nextScrollLock\(scrollLocked, 'roundStart'\)/g) ?? [];
		// the chart/run effect (fresh run) + restartRun (restart / play again)
		expect(starts.length).toBeGreaterThanOrEqual(2);
	});
});
