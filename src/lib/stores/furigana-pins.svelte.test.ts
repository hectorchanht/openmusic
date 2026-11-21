import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { applyFuriganaPins, pinReading, furiganaPinVersion } from './furigana-pins.svelte';
import type { FuriganaSpan } from '$lib/services/furigana';

// quick-261120-furi — Addendum 6 at the reactive seam: the user's pinned
// reading WINS over the engine's chosen, on the song it was pinned in, and
// the version bump is what repaints the pane. Node-runnable (the bump takes
// its synchronous fallback where rAF is absent).

class MemStorage {
	private m = new Map<string, string>();
	getItem(k: string): string | null {
		return this.m.has(k) ? (this.m.get(k) as string) : null;
	}
	setItem(k: string, v: string): void {
		this.m.set(k, String(v));
	}
	removeItem(k: string): void {
		this.m.delete(k);
	}
	clear(): void {
		this.m.clear();
	}
}

const LINE = '明日はきっと晴れる';
const span = (over: Partial<FuriganaSpan> = {}): FuriganaSpan => ({
	surface: '明日',
	variants: ['あした', 'あす', 'みょうにち'],
	chosen: 'あした',
	...over
});

describe('furigana-pins (reactive) — the pin wins', () => {
	const originalLocalStorage = (globalThis as { localStorage?: Storage }).localStorage;

	beforeEach(() => {
		Object.defineProperty(globalThis, 'localStorage', {
			value: new MemStorage(),
			configurable: true,
			writable: true
		});
	});
	afterEach(() => {
		Object.defineProperty(globalThis, 'localStorage', {
			value: originalLocalStorage,
			configurable: true,
			writable: true
		});
	});

	it('no pin → spans pass through by identity', () => {
		const spans = [span()];
		const out = applyFuriganaPins('uid1', LINE, spans);
		expect(out[0]).toBe(spans[0]);
	});

	it('a pinned reading overrides chosen and is marked pinned', () => {
		pinReading('uid1', LINE, '明日', 'あす');
		const out = applyFuriganaPins('uid1', LINE, [span()]);
		expect(out[0].chosen).toBe('あす');
		expect(out[0].pinned).toBe(true);
	});

	it('a pin from another song does not leak', () => {
		pinReading('uid2', LINE, '明日', 'あす');
		const out = applyFuriganaPins('uid1', LINE, [span()]);
		expect(out[0].chosen).toBe('あした');
		expect(out[0].pinned).toBeUndefined();
	});

	it('a pin outside the current variants is honoured and prepended for the chooser', () => {
		pinReading('uid1', LINE, '明日', 'あす'); // あす IS in variants — use a drift case instead:
		pinReading('uid1', LINE, '明日', 'カスタム');
		const out = applyFuriganaPins('uid1', LINE, [span()]);
		expect(out[0].chosen).toBe('カスタム');
		expect(out[0].variants[0]).toBe('カスタム');
	});

	it('pinning bumps the version so readers repaint', () => {
		const before = furiganaPinVersion();
		pinReading('uid1', LINE, '明日', 'あす');
		expect(furiganaPinVersion()).toBeGreaterThan(before);
	});
});
