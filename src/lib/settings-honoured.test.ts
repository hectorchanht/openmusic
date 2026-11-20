// quick-261102-u4t (DECISIONS.md §14) — invariants: a setting governs every surface it names.
import { describe, it, expect, vi, afterEach } from 'vitest';

vi.mock('$app/environment', () => ({ browser: false }));
const settings = vi.hoisted(() => ({ reduceMotion: false, enabledSources: {} as Record<string, boolean> }));
vi.mock('$lib/stores/settings.svelte', () => ({ settings }));

import { reducedMotion, scrollBehavior } from '$lib/motion';

afterEach(() => {
	settings.reduceMotion = false;
});

describe('Reduce motion — one decision for transitions and JS scrolls', () => {
	it('the app flag reduces motion (OS query unavailable off-browser)', () => {
		expect(reducedMotion()).toBe(false);
		expect(scrollBehavior()).toBe('smooth');
		settings.reduceMotion = true;
		expect(reducedMotion()).toBe(true);
		expect(scrollBehavior()).toBe('auto');
	});
});
