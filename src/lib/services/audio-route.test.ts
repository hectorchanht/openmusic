// quick-261014-routefix: audio-output route-loss detector tests.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { watchAudioRouteLoss } from './audio-route';

vi.mock('@capacitor/core', () => ({
	// Node test env = web platform: the native arm is skipped, the devicechange arm is tested.
	Capacitor: { isNativePlatform: () => false },
	registerPlugin: vi.fn(() => {
		throw new Error('must not be called on web');
	})
}));

/** Minimal MediaDeviceInfo stand-in (node has no constructor). */
function dev(deviceId: string, kind: MediaDeviceKind): MediaDeviceInfo {
	return { deviceId, kind, label: '', groupId: '' } as MediaDeviceInfo;
}

interface FakeMediaDevices {
	enumerateDevices: ReturnType<typeof vi.fn>;
	listeners: Map<string, Array<() => void>>;
	addEventListener: (type: string, cb: () => void) => void;
	removeEventListener: ReturnType<typeof vi.fn>;
}

function makeMediaDevices(initial: MediaDeviceInfo[]): FakeMediaDevices {
	const listeners = new Map<string, Array<() => void>>();
	const enumerateDevices = vi.fn(async () => initial);
	const addEventListener = (type: string, cb: () => void) => {
		const arr = listeners.get(type) ?? [];
		arr.push(cb);
		listeners.set(type, arr);
	};
	const removeEventListener = vi.fn((type: string, cb: () => void) => {
		const arr = listeners.get(type) ?? [];
		listeners.set(
			type,
			arr.filter((c) => c !== cb)
		);
	});
	return { enumerateDevices, listeners, addEventListener, removeEventListener };
}

/** enumerateDevices() is promise-chained twice (baseline + on-change); flush both. */
async function flushDevicePromises() {
	for (let i = 0; i < 4; i++) await new Promise((r) => setTimeout(r, 0));
}

function fireDeviceChange(fake: FakeMediaDevices) {
	for (const cb of fake.listeners.get('devicechange') ?? []) cb();
}

describe('watchAudioRouteLoss', () => {
	beforeEach(() => {
		vi.unstubAllGlobals();
	});

	afterEach(() => {
		vi.unstubAllGlobals();
	});

	it('fires onLoss when an audiooutput device disappears (strict shrink)', async () => {
		const fake = makeMediaDevices([
			dev('spk', 'audiooutput'),
			dev('bt', 'audiooutput'),
			dev('mic', 'audioinput')
		]);
		vi.stubGlobal('navigator', { mediaDevices: fake });
		const onLoss = vi.fn();
		const watch = watchAudioRouteLoss(onLoss);
		await flushDevicePromises();
		expect(onLoss).not.toHaveBeenCalled();

		// BT headset disconnected: one audiooutput gone, count dropped.
		fake.enumerateDevices.mockResolvedValue([dev('spk', 'audiooutput'), dev('mic', 'audioinput')]);
		fireDeviceChange(fake);
		await flushDevicePromises();

		expect(onLoss).toHaveBeenCalledTimes(1);
		watch.stop();
	});

	it('does NOT fire on a same-count output swap, a pure addition, or input-only churn', async () => {
		const fake = makeMediaDevices([dev('spk', 'audiooutput'), dev('bt', 'audiooutput')]);
		vi.stubGlobal('navigator', { mediaDevices: fake });
		const onLoss = vi.fn();
		const watch = watchAudioRouteLoss(onLoss);
		await flushDevicePromises();

		// Same-count rename/swap: a route switch, not a loss — must not pause.
		fake.enumerateDevices.mockResolvedValue([dev('spk', 'audiooutput'), dev('usb', 'audiooutput')]);
		fireDeviceChange(fake);
		await flushDevicePromises();
		expect(onLoss).not.toHaveBeenCalled();

		// Pure addition: BT connected — must not pause.
		fake.enumerateDevices.mockResolvedValue([
			dev('spk', 'audiooutput'),
			dev('usb', 'audiooutput'),
			dev('bt', 'audiooutput')
		]);
		fireDeviceChange(fake);
		await flushDevicePromises();
		expect(onLoss).not.toHaveBeenCalled();
		watch.stop();
	});

	it('does NOT fire when only audioinput devices change', async () => {
		const fake = makeMediaDevices([dev('spk', 'audiooutput'), dev('mic1', 'audioinput')]);
		vi.stubGlobal('navigator', { mediaDevices: fake });
		const onLoss = vi.fn();
		const watch = watchAudioRouteLoss(onLoss);
		await flushDevicePromises();

		// Camera/mic churn: audiooutput set unchanged.
		fake.enumerateDevices.mockResolvedValue([dev('spk', 'audiooutput'), dev('mic2', 'audioinput')]);
		fireDeviceChange(fake);
		await flushDevicePromises();
		expect(onLoss).not.toHaveBeenCalled();
		watch.stop();
	});

	it('stop() removes the devicechange listener and is idempotent', async () => {
		const fake = makeMediaDevices([dev('spk', 'audiooutput'), dev('bt', 'audiooutput')]);
		vi.stubGlobal('navigator', { mediaDevices: fake });
		const onLoss = vi.fn();
		const watch = watchAudioRouteLoss(onLoss);
		await flushDevicePromises();

		watch.stop();
		watch.stop(); // idempotent — must not throw or double-remove
		expect(fake.removeEventListener).toHaveBeenCalledWith(
			'devicechange',
			expect.any(Function)
		);

		// A later devicechange must not reach the stopped watcher.
		fake.enumerateDevices.mockResolvedValue([dev('spk', 'audiooutput')]);
		fireDeviceChange(fake);
		await flushDevicePromises();
		expect(onLoss).not.toHaveBeenCalled();
	});

	it('does not throw when navigator.mediaDevices is absent', async () => {
		vi.stubGlobal('navigator', {});
		const onLoss = vi.fn();
		expect(() => watchAudioRouteLoss(onLoss).stop()).not.toThrow();
		await flushDevicePromises();
		expect(onLoss).not.toHaveBeenCalled();
	});
});
