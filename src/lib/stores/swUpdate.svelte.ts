// PWA service-worker UPDATE watcher (quick-260713-7pi). Svelte 5 runes singleton —
// mirrors the online/overlays store shape (a browser-guarded init() that attaches
// listeners and returns a teardown, called from the app shell's onMount).
//
// WHY this exists: SvelteKit auto-registers `service-worker.ts` (svelte.config.js
// `serviceWorker: { register: !native }`) but only checks for a new build on page load.
// A long-open home-screen PWA therefore keeps serving the OLD cached bundle after a
// deploy until every window is closed — the confirmed cause of "the fix is live on the
// web but my Android PWA still shows the old behavior". This watcher surfaces a Reload
// prompt the moment a new SW is waiting, and forces an update check on refocus.
//
// SAFETY: the new SW is NEVER activated automatically (service-worker.ts does not
// skipWaiting() on install). Activation happens ONLY when the user taps Reload →
// applyUpdate() posts SKIP_WAITING → the SW activates + clients.claim() → a single
// controllerchange-driven reload. This protects background audio (the app's core value)
// from a surprise mid-session reload.
import { browser } from '$app/environment';

class SwUpdate {
	/** True once a NEW service worker is installed and waiting to take over. Drives the
	 *  app-shell "new version — Reload" banner. */
	updateReady = $state<boolean>(false);

	// Internal, non-reactive (house convention: plain class fields, not $state — the UI
	// never reads these reactively).
	private reg: ServiceWorkerRegistration | null = null;
	private refreshing = false; // controllerchange reload guard (never reload twice)
	private started = false;

	/**
	 * Attach the update listeners. No-op under SSR or when the browser has no Service
	 * Worker support / no registration (e.g. the Capacitor native build, where the SW is
	 * not registered). Returns a teardown that detaches every listener.
	 */
	init(): () => void {
		if (!browser || this.started) return () => {};
		if (!('serviceWorker' in navigator)) return () => {};
		this.started = true;

		const onControllerChange = () => {
			// The waiting SW just took control (only ever after applyUpdate()). Reload once
			// so the page runs the fresh bundle + matching hashed assets.
			if (this.refreshing) return;
			this.refreshing = true;
			location.reload();
		};
		const onVisibility = () => {
			// A long-open PWA only re-checks for a new SW when we ask. On refocus, poke the
			// registration so a post-deploy update is detected promptly.
			if (document.visibilityState === 'visible') void this.reg?.update().catch(() => {});
		};

		navigator.serviceWorker.addEventListener('controllerchange', onControllerChange);
		document.addEventListener('visibilitychange', onVisibility);

		// Resolve the SvelteKit-created registration and wire update detection onto it.
		void navigator.serviceWorker.ready
			.then((reg) => {
				this.reg = reg;
				// A worker may already be waiting from a prior load (deploy happened, page
				// reopened) — surface it immediately. `controller` present = not first install.
				if (reg.waiting && navigator.serviceWorker.controller) this.updateReady = true;

				reg.addEventListener('updatefound', () => {
					const installing = reg.installing;
					if (!installing) return;
					installing.addEventListener('statechange', () => {
						// `installed` WITH an existing controller = an UPDATE (a fresh first-ever
						// install has no controller yet, and must NOT prompt).
						if (installing.state === 'installed' && navigator.serviceWorker.controller) {
							this.updateReady = true;
						}
					});
				});
			})
			.catch(() => {});

		return () => {
			navigator.serviceWorker.removeEventListener('controllerchange', onControllerChange);
			document.removeEventListener('visibilitychange', onVisibility);
			this.started = false;
		};
	}

	/**
	 * Apply the waiting update: tell the waiting SW to activate now. The SW's message
	 * handler calls skipWaiting(); its activate calls clients.claim(); the resulting
	 * controllerchange reloads the page (once) via the init() handler. User-triggered only.
	 */
	applyUpdate(): void {
		if (!browser) return;
		const worker = this.reg?.waiting ?? navigator.serviceWorker?.controller ?? null;
		worker?.postMessage({ type: 'SKIP_WAITING' });
		// Clear the flag so the banner leaves; the reload follows on controllerchange.
		this.updateReady = false;
	}
}

export const swUpdate = new SwUpdate();
