// inflightGuard — the PURE in-flight decision behind any double-click-resistant async action
// (D-16). Lifted out of the consuming components so it is node-testable without a DOM, mirroring
// shouldStartResolve in track-menu-gate.ts. The `new Set(...).add(key)` reassign-for-reactivity
// and the `finally`-delete that re-enables a key on BOTH resolve and throw stay in the consuming
// COMPONENTS (per PATTERNS.md §3.2) — this helper only DECIDES, it never mutates.

/**
 * Pure helper: should a fresh run be started for `key`, given the set of currently in-flight
 * action keys? `!inFlight.has(key)` — a second tap while the SAME key is already running is a
 * no-op, and per-key runs are independent. Because the consumer clears the key in its `finally`
 * (on resolve OR throw), a cleared key resolves to true again — never a stuck disabled button.
 */
export function shouldRun(inFlight: Set<string>, key: string): boolean {
	return !inFlight.has(key);
}
