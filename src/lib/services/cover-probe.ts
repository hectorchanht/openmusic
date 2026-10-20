// cover-probe — the single shared Image() cover-URL probe.
//
// quick-261020-batch3: collapses the twin probe bodies — lazyCover.probeImage (which had NO
// timeout, so a stalled-but-not-erroring URL held the module-level inFlight key indefinitely,
// blocking duplicate rows for the same song) and player.probeCover (whose comment admitted it
// was a "twin… so the heal does NOT cross the action boundary"). Both now call this. The
// action-boundary concern is gone: this is a pure service module (no runes, no store, no action
// imports), so the player store and the lazyCover action can both import it, and it stays
// node-testable via the `typeof Image === 'undefined'` guard.
//
// Resolves true if the URL loads, false on error OR after `timeoutMs` (default 8s, matching the
// player's HEAL_PROBE_TIMEOUT_MS). Never rejects.
export function probeCoverImage(url: string, timeoutMs = 8000): Promise<boolean> {
	if (typeof Image === 'undefined') return Promise.resolve(false);
	return new Promise<boolean>((resolve) => {
		let done = false;
		const finish = (v: boolean) => {
			if (done) return;
			done = true;
			clearTimeout(timer);
			resolve(v);
		};
		const timer = setTimeout(() => finish(false), timeoutMs);
		try {
			const img = new Image();
			img.decoding = 'async';
			img.referrerPolicy = 'no-referrer';
			img.onload = () => finish(true);
			img.onerror = () => finish(false);
			img.src = url;
		} catch {
			finish(false);
		}
	});
}
