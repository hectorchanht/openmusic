// Reactive online/offline signal (Svelte 5 runes singleton, OFFL-03). Browser-guarded
// like history.svelte.ts: the $state initializer is SSR-safe and init() only attaches
// window listeners in the browser. The SSR default is `true` — entity routes now SSR
// (D-01/D-02) and any surface rendered server-side must ASSUME online rather than flash
// an offline state. Online-only surfaces (Plan 05) read `online.isOnline` to short-circuit
// to an inline offline state instead of hanging on a fetch (D-09/D-10).
//
// quick-261116-perf: on native (Capacitor APK) the store ALSO takes @capacitor/network
// as the source of truth — Android WebView `online`/`offline` events are unreliable
// (they lag or never fire on radio handoffs), which made cached-only/offline playback
// switching sluggish in the APK. The plugin is loaded via DYNAMIC import behind an
// isNativePlatform() check, so the web build and the Vitest node project never execute
// native code paths at module scope; the window listeners stay attached everywhere as
// the web path AND the native fallback (if the plugin import ever fails, behaviour is
// exactly the pre-plugin store). Public API is unchanged: `online.isOnline` + `init()`
// returning a teardown that removes BOTH the window listeners and the plugin listener.
import { browser } from '$app/environment';

class Online {
	/** Mirrors navigator.onLine in the browser; defaults true under SSR (assume online). */
	isOnline = $state(browser ? navigator.onLine : true);

	/**
	 * Attach `online`/`offline` listeners and sync the current value. Call from a component
	 * lifecycle (onMount). Returns a teardown that removes the listeners. No-op under SSR.
	 */
	init(): () => void {
		if (!browser) return () => {};
		const on = () => (this.isOnline = true);
		const off = () => (this.isOnline = false);
		addEventListener('online', on);
		addEventListener('offline', off);
		this.isOnline = navigator.onLine;

		// Native source of truth (quick-261116-perf, see header). Fire-and-forget: the
		// async plugin load must never block or break the synchronous web path above.
		let disposed = false;
		let removeNative: (() => void) | null = null;
		void (async () => {
			try {
				const { Capacitor } = await import('@capacitor/core');
				if (disposed || !Capacitor.isNativePlatform()) return;
				const { Network } = await import('@capacitor/network');
				const status = await Network.getStatus();
				if (disposed) return;
				this.isOnline = status.connected;
				const handle = await Network.addListener('networkStatusChange', (s) => {
					this.isOnline = s.connected;
				});
				if (disposed) {
					void handle.remove();
					return;
				}
				removeNative = () => void handle.remove();
			} catch {
				/* plugin unavailable — the window listeners above remain the signal */
			}
		})();

		return () => {
			disposed = true;
			removeEventListener('online', on);
			removeEventListener('offline', off);
			removeNative?.();
		};
	}
}

export const online = new Online();
