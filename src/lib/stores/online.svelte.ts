// Reactive online/offline signal (Svelte 5 runes singleton, OFFL-03). Browser-guarded
// like history.svelte.ts: the $state initializer is SSR-safe and init() only attaches
// window listeners in the browser. The SSR default is `true` — entity routes now SSR
// (D-01/D-02) and any surface rendered server-side must ASSUME online rather than flash
// an offline state. Online-only surfaces (Plan 05) read `online.isOnline` to short-circuit
// to an inline offline state instead of hanging on a fetch (D-09/D-10).
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
		return () => {
			removeEventListener('online', on);
			removeEventListener('offline', off);
		};
	}
}

export const online = new Online();
