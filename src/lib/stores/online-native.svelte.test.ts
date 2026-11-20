import { describe, it, expect, vi, beforeEach } from 'vitest';

// quick-261116-perf: the native branch of the online store. On Capacitor the
// @capacitor/network plugin is the source of truth (Android WebView online/offline
// events are unreliable); the window listeners stay as fallback. Both plugins are
// mocked so the node project exercises the branch without native code. The web-path
// behaviour is covered by online.svelte.test.ts and must stay untouched.
vi.mock('$app/environment', () => ({ browser: true }));

const netState = {
	connected: true,
	listener: null as null | ((s: { connected: boolean }) => void),
	removed: 0
};

vi.mock('@capacitor/core', () => ({
	Capacitor: { isNativePlatform: () => true }
}));

vi.mock('@capacitor/network', () => ({
	Network: {
		getStatus: async () => ({ connected: netState.connected, connectionType: 'wifi' }),
		addListener: async (_event: string, cb: (s: { connected: boolean }) => void) => {
			netState.listener = cb;
			return {
				remove: async () => {
					netState.removed++;
				}
			};
		}
	}
}));

beforeEach(() => {
	netState.connected = true;
	netState.listener = null;
	netState.removed = 0;
	vi.stubGlobal('navigator', { onLine: true });
	vi.stubGlobal('addEventListener', () => {});
	vi.stubGlobal('removeEventListener', () => {});
});

const flush = () => new Promise((r) => setTimeout(r, 0));

describe('online store — native @capacitor/network branch (quick-261116-perf)', () => {
	it('seeds isOnline from Network.getStatus() and follows networkStatusChange', async () => {
		netState.connected = false; // navigator.onLine says true; the plugin must win
		const { online } = await import('./online.svelte');
		const teardown = online.init();
		await flush();
		await flush();
		expect(online.isOnline).toBe(false);
		expect(netState.listener).not.toBeNull();
		netState.listener?.({ connected: true });
		expect(online.isOnline).toBe(true);
		teardown();
		await flush();
		expect(netState.removed).toBe(1);
	});
});
