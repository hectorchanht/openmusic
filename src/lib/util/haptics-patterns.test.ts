import { describe, it, expect, vi, afterEach } from 'vitest';
import { kick, snare, pluck, shaker, guidePulse } from './haptics';

// quick-261021-tap: the Tap-Along pattern functions (brief §6 pin). haptics.test.ts (D-17
// tick) is untouched — this file pins ONLY the new family: exact arrays at default scale,
// intensity scaling, the ~120ms clamp, and the iOS no-op path. Same stub style as the
// existing haptics tests.

afterEach(() => {
	// @ts-expect-error — vibrate is not in the node navigator type
	delete navigator.vibrate;
	vi.restoreAllMocks();
});

function stub(): ReturnType<typeof vi.fn> {
	const vibrate = vi.fn();
	navigator.vibrate = vibrate;
	return vibrate;
}

describe('quick-261021-tap haptics patterns', () => {
	it('kick fires a single 40ms thump (a number, like tick)', () => {
		const v = stub();
		kick();
		expect(v).toHaveBeenCalledTimes(1);
		expect(v).toHaveBeenCalledWith(40);
	});

	it('snare / pluck / shaker fire their exact pattern arrays', () => {
		const v = stub();
		snare();
		expect(v).toHaveBeenLastCalledWith([14, 28, 20]);
		pluck();
		expect(v).toHaveBeenLastCalledWith([22, 18, 12]);
		shaker();
		expect(v).toHaveBeenLastCalledWith([8, 14, 8, 14, 10]);
		expect(v).toHaveBeenCalledTimes(3);
	});

	it('guidePulse is the unscaled 7ms heartbeat', () => {
		const v = stub();
		guidePulse();
		expect(v).toHaveBeenCalledWith(7);
	});

	it('intensity scale and velocity scale the durations', () => {
		const v = stub();
		kick(0.6);
		expect(v).toHaveBeenLastCalledWith(24);
		kick(1.3);
		expect(v).toHaveBeenLastCalledWith(52);
		snare(1, 0.5);
		expect(v).toHaveBeenLastCalledWith([7, 14, 10]);
	});

	it('a scaled pattern never exceeds the ~120ms total cap', () => {
		const v = stub();
		shaker(3); // absurd scale — the clamp, not the caller, owns the ceiling
		const arg = v.mock.calls[0][0] as number[];
		expect(arg.reduce((a, b) => a + b, 0)).toBeLessThanOrEqual(120);
	});

	it('does NOT throw when navigator.vibrate is undefined (iOS Safari)', () => {
		// @ts-expect-error — ensure it is absent
		delete navigator.vibrate;
		expect(() => {
			kick();
			snare();
			pluck();
			shaker();
			guidePulse();
		}).not.toThrow();
	});

	it('does NOT throw when navigator.vibrate throws (blocked/denied)', () => {
		navigator.vibrate = () => {
			throw new Error('blocked');
		};
		expect(() => kick()).not.toThrow();
	});
});
