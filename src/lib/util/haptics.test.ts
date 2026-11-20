import { describe, it, expect, vi, afterEach } from 'vitest';
import { tick, setHapticsEnabled } from './haptics';

// haptics.tick fires a ~15ms commit-tier vibrate where supported and no-ops safely where it is
// not (iOS Safari has no navigator.vibrate). The util must NEVER throw. These node tests stub /
// remove navigator.vibrate to assert both paths. `navigator` exists in the node test runtime
// (undici/global) but has no `vibrate`, so we assign it directly.

afterEach(() => {
	// Always remove any stub so a later test sees the real (absent) shape.
	// @ts-expect-error — vibrate is not in the node navigator type
	delete navigator.vibrate;
	vi.restoreAllMocks();
});

describe('haptics.tick — commit-tier vibrate (D-17)', () => {
	it('calls navigator.vibrate(15) when present', () => {
		const vibrate = vi.fn();
		navigator.vibrate = vibrate;
		tick();
		expect(vibrate).toHaveBeenCalledTimes(1);
		expect(vibrate).toHaveBeenCalledWith(15);
	});

	it('does NOT throw when navigator.vibrate is undefined (iOS Safari)', () => {
		// @ts-expect-error — ensure it is absent
		delete navigator.vibrate;
		expect(() => tick()).not.toThrow();
	});

	it('does NOT throw when navigator.vibrate throws (blocked/denied)', () => {
		navigator.vibrate = () => {
			throw new Error('blocked');
		};
		expect(() => tick()).not.toThrow();
	});

	// quick-261116-perf: the settings toggle seam — disabled silences the tick entirely.
	it('setHapticsEnabled(false) suppresses the vibrate; re-enabling restores it', () => {
		const vibrate = vi.fn();
		navigator.vibrate = vibrate;
		setHapticsEnabled(false);
		tick();
		expect(vibrate).not.toHaveBeenCalled();
		setHapticsEnabled(true);
		tick();
		expect(vibrate).toHaveBeenCalledTimes(1);
	});
});
