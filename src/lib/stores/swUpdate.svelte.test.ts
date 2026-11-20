import { describe, it, expect, vi, beforeEach } from 'vitest';

// debug home-mobile-lcp-simulated-31s: the controllerchange → location.reload() path. A first-ever
// install (no controller at init) claims the page and must NOT reload; a control transfer (a
// controller already existed, i.e. the user applied an update) reloads exactly once.
vi.mock('$app/environment', () => ({ browser: true }));

type Handler = () => void;
function fakeServiceWorker(controller: object | null) {
	const handlers = new Map<string, Set<Handler>>();
	return {
		controller,
		ready: new Promise<never>(() => {}), // never resolves — the update wiring is not under test
		addEventListener(type: string, cb: Handler) {
			if (!handlers.has(type)) handlers.set(type, new Set());
			handlers.get(type)!.add(cb);
		},
		removeEventListener(type: string, cb: Handler) {
			handlers.get(type)?.delete(cb);
		},
		fire(type: string) {
			for (const cb of handlers.get(type) ?? []) cb();
		}
	};
}

const reload = vi.fn();
beforeEach(() => {
	reload.mockClear();
	vi.stubGlobal('location', { reload });
	vi.stubGlobal('document', { addEventListener() {}, removeEventListener() {}, visibilityState: 'visible' });
	vi.resetModules();
});

describe('swUpdate controllerchange reload guard', () => {
	it('first-ever install (no prior controller) claiming the page does not reload', async () => {
		const sw = fakeServiceWorker(null);
		vi.stubGlobal('navigator', { serviceWorker: sw });
		const { swUpdate } = await import('./swUpdate.svelte');
		const teardown = swUpdate.init();
		sw.fire('controllerchange');
		expect(reload).not.toHaveBeenCalled();
		// A later REAL transfer in the same session (user tapped Reload) still reloads once.
		sw.fire('controllerchange');
		sw.fire('controllerchange');
		expect(reload).toHaveBeenCalledTimes(1);
		teardown();
	});

	it('control transfer with an existing controller reloads once', async () => {
		const sw = fakeServiceWorker({});
		vi.stubGlobal('navigator', { serviceWorker: sw });
		const { swUpdate } = await import('./swUpdate.svelte');
		const teardown = swUpdate.init();
		sw.fire('controllerchange');
		sw.fire('controllerchange');
		expect(reload).toHaveBeenCalledTimes(1);
		teardown();
	});
});
