// abort-signal — combine a caller's AbortSignal with a per-call timeout.
//
// This existed as THREE copies (deezer.ts, itunes-cover.ts, resolve-cache-client.ts) differing only
// in which timeout constant they closed over — and deezer.ts already EXPORTED its copy, so two of
// them were re-implementations of an available function rather than imports of it. The timeout is
// the one thing that legitimately varies, so it becomes a parameter instead of a reason to fork.
//
// The `AbortSignal.any` feature test is the load-bearing part and the reason this must not be
// re-typed by hand per module: `any` is newer than `timeout`, so a runtime can have one without the
// other. Where it is missing we fall back to the TIMEOUT alone — deliberately preferring "this call
// still has a deadline" over "this call is cancellable", since an un-deadlined fetch is the failure
// mode that strands the resolve path (the recorded api-fetch-flood class).

/**
 * An AbortSignal that fires when EITHER the caller aborts or `timeoutMs` elapses.
 * With no caller signal this is just the timeout.
 */
export function combinedSignal(timeoutMs: number, caller?: AbortSignal): AbortSignal {
	const timeout = AbortSignal.timeout(timeoutMs);
	if (!caller) return timeout;
	const anyFn = (AbortSignal as { any?: (signals: AbortSignal[]) => AbortSignal }).any;
	return typeof anyFn === 'function' ? anyFn([caller, timeout]) : timeout;
}
