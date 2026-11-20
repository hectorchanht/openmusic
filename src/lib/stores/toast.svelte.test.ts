import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// The toast timer is browser-only (SSR guard) — flip `browser` ON so the timeout actually arms
// in node, then drive it with fake timers (same idiom as player.svelte.test.ts).
vi.mock('$app/environment', () => ({ browser: true }));

import { toast } from './toast.svelte';

describe('toast store (quick-260910-omt: optional action + per-call duration)', () => {
	beforeEach(() => {
		vi.useFakeTimers();
		toast.dismiss();
	});
	afterEach(() => {
		vi.useRealTimers();
	});

	it('show(msg) keeps the locked 2000ms default and sets no action', () => {
		toast.show('a');
		expect(toast.msg).toBe('a');
		expect(toast.action).toBeNull();
		vi.advanceTimersByTime(2000);
		expect(toast.msg).toBe('');
	});

	it('an action toast stays up for 5000ms so Undo is hittable', () => {
		const run = vi.fn();
		toast.show('a', { action: { label: 'Undo', run } });
		expect(toast.action?.label).toBe('Undo');
		vi.advanceTimersByTime(2000);
		expect(toast.msg).toBe('a'); // still visible past the plain default
		vi.advanceTimersByTime(3000);
		expect(toast.msg).toBe('');
		expect(toast.action).toBeNull();
		expect(run).not.toHaveBeenCalled(); // expiry NEVER fires the action
	});

	it('an explicit duration wins over both defaults', () => {
		toast.show('a', { duration: 300 });
		vi.advanceTimersByTime(300);
		expect(toast.msg).toBe('');
	});

	it('act() runs the callback exactly once and clears the toast immediately', () => {
		const run = vi.fn();
		toast.show('a', { action: { label: 'Undo', run } });
		toast.act();
		expect(run).toHaveBeenCalledTimes(1);
		expect(toast.msg).toBe('');
		expect(toast.action).toBeNull();
		toast.act(); // second tap finds no action
		vi.advanceTimersByTime(5000);
		expect(run).toHaveBeenCalledTimes(1);
	});

	it('act() with no action is a no-op', () => {
		toast.show('a');
		expect(() => toast.act()).not.toThrow();
		expect(toast.msg).toBe('a');
	});

	it('a superseding plain toast DISCARDS the pending action — a stale undo can never fire', () => {
		const r1 = vi.fn();
		toast.show('a', { action: { label: 'Undo', run: r1 } });
		toast.show('b');
		expect(toast.action).toBeNull();
		toast.act();
		vi.advanceTimersByTime(5000);
		expect(r1).not.toHaveBeenCalled();
	});

	it('a superseding action toast replaces the pending one — act() runs only the newest', () => {
		const r1 = vi.fn();
		const r2 = vi.fn();
		toast.show('a', { action: { label: 'Undo', run: r1 } });
		toast.show('b', { action: { label: 'Undo', run: r2 } });
		toast.act();
		expect(r1).not.toHaveBeenCalled();
		expect(r2).toHaveBeenCalledTimes(1);
	});
});
