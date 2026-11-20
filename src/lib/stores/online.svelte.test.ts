import { describe, it, expect, vi, beforeEach } from 'vitest';

// OFFL-03: the online store's init() is browser-guarded (reads `browser` from
// $app/environment). The node test project sets browser=false, so to exercise the
// listener-attach / event-flip / teardown path we flip browser ON — exactly the
// vi.mock('$app/environment', { browser: true }) pattern player.svelte.test.ts uses.
vi.mock('$app/environment', () => ({ browser: true }));

// A fake window that records addEventListener handlers and lets a test fire('online'|'offline'),
// and tracks removeEventListener so teardown is observable. Mirrors player.svelte.test.ts's
// listener-recording fake <audio>.
type Handler = () => void;
class FakeWindow {
	private handlers = new Map<string, Set<Handler>>();
	added: Array<[string, Handler]> = [];
	removed: Array<[string, Handler]> = [];
	addEventListener(type: string, cb: Handler) {
		this.added.push([type, cb]);
		if (!this.handlers.has(type)) this.handlers.set(type, new Set());
		this.handlers.get(type)!.add(cb);
	}
	removeEventListener(type: string, cb: Handler) {
		this.removed.push([type, cb]);
		this.handlers.get(type)?.delete(cb);
	}
	fire(type: string) {
		for (const cb of this.handlers.get(type) ?? []) cb();
	}
}

const navStub = { onLine: true };
let fakeWindow: FakeWindow;

beforeEach(() => {
	navStub.onLine = true;
	fakeWindow = new FakeWindow();
	vi.stubGlobal('navigator', navStub);
	vi.stubGlobal('window', fakeWindow);
	// addEventListener/removeEventListener are also resolved as bare globals by some code;
	// route them to the same fake window so either calling convention is captured.
	vi.stubGlobal('addEventListener', fakeWindow.addEventListener.bind(fakeWindow));
	vi.stubGlobal('removeEventListener', fakeWindow.removeEventListener.bind(fakeWindow));
});

describe('online store (OFFL-03)', () => {
	it('init() in a browser attaches online + offline listeners and reflects navigator.onLine', async () => {
		const { online } = await import('./online.svelte');
		const teardown = online.init();
		const types = fakeWindow.added.map(([t]) => t).sort();
		expect(types).toEqual(['offline', 'online']);
		expect(online.isOnline).toBe(true);
		teardown();
	});

	it('an offline event sets isOnline=false; a subsequent online event sets it back to true', async () => {
		const { online } = await import('./online.svelte');
		const teardown = online.init();

		fakeWindow.fire('offline');
		expect(online.isOnline).toBe(false);

		fakeWindow.fire('online');
		expect(online.isOnline).toBe(true);

		teardown();
	});

	it('the teardown fn removes both listeners (no leak) and stops further flips', async () => {
		const { online } = await import('./online.svelte');
		const teardown = online.init();
		teardown();

		const removedTypes = fakeWindow.removed.map(([t]) => t).sort();
		expect(removedTypes).toEqual(['offline', 'online']);

		// After teardown, firing offline must not flip the (now-detached) store.
		online.isOnline = true;
		fakeWindow.fire('offline');
		expect(online.isOnline).toBe(true);
	});
});

// SSR default: under !browser the construction default is `true` (entity routes now SSR
// and must assume online) and init() is a no-op returning a no-op teardown. Re-import the
// module under a browser=false mock in an isolated module registry to assert the SSR path.
describe('online store SSR default (browser=false)', () => {
	beforeEach(() => {
		vi.resetModules();
	});

	it('defaults isOnline to true and init() is a no-op when !browser', async () => {
		vi.doMock('$app/environment', () => ({ browser: false }));
		// No window/navigator in this SSR-shaped env.
		vi.stubGlobal('window', undefined);
		vi.stubGlobal('navigator', undefined);

		const { online } = await import('./online.svelte');
		expect(online.isOnline).toBe(true);

		// init() must not throw and must return a callable no-op teardown.
		const teardown = online.init();
		expect(() => teardown()).not.toThrow();
		expect(online.isOnline).toBe(true);

		vi.doUnmock('$app/environment');
	});
});
