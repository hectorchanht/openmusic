import { describe, it, expect } from 'vitest';
import { shouldRun } from './inflightGuard';

// inflightGuard.shouldRun is the PURE in-flight decision behind double-click-resistant async
// actions (D-16) — lifted out of the consuming components so it is node-testable without a DOM,
// mirroring track-menu-gate's shouldStartResolve. The reassign-for-reactivity + finally-delete
// discipline lives in the COMPONENT (PATTERNS §3.2); this helper only DECIDES.

describe('shouldRun — in-flight double-click guard (D-16)', () => {
	it('key not in flight → run (true)', () => {
		expect(shouldRun(new Set(), 'save')).toBe(true);
	});

	it('same key already in flight → ignore the tap (false)', () => {
		expect(shouldRun(new Set(['save']), 'save')).toBe(false);
	});

	it('a DIFFERENT key in flight → still run (per-key independence)', () => {
		expect(shouldRun(new Set(['download']), 'save')).toBe(true);
	});

	it('re-enable after finally-delete: once the key is cleared it runs again (never stuck)', () => {
		const inFlight = new Set(['save']);
		expect(shouldRun(inFlight, 'save')).toBe(false);
		// The consumer clears the key in its `finally` on resolve OR throw; once cleared the
		// action is runnable again — proving "never a stuck disabled button" is structurally so.
		inFlight.delete('save');
		expect(shouldRun(inFlight, 'save')).toBe(true);
	});
});
