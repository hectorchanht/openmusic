// download-progress.ts — read a Response body to a Blob WHILE reporting how far along it is
// (quick-260913-omi).
//
// WHY THIS EXISTS. `downloadTrack` already fetches the audio itself and then called
// `await resp.blob()`, which reads the whole stream internally and reports nothing. A lossless
// track is tens of MB over a CN CDN, so the Download row sat on an indeterminate spinner for the
// entire transfer and the user could not tell slow from stuck. The bytes were always right there —
// reading the body through a reader gives real progress with no polling, no estimation, and no
// second request.
//
// WHY IT IS ITS OWN MODULE. Pure-ish and store-free (the caller supplies `onProgress`), so it runs
// under the single node Vitest project — the repo's "pure functions are extracted and exported for
// testability" convention, same shape as download-filename / download-save.
//
// NEVER INVENTS PROGRESS. Without a `Content-Length` there is no honest fraction to report, so the
// helper degrades to `resp.blob()` and the UI keeps its indeterminate spinner. A fake creeping bar
// would be worse than no bar: it would say "moving" about a transfer that may be stalled.

/**
 * Read `resp` to a Blob, invoking `onProgress` with a 0..1 fraction as bytes arrive.
 *
 * Falls back to `resp.blob()` — byte-identical to the previous behaviour, and `onProgress` is never
 * called — when the transfer is INDETERMINATE: no `Content-Length`, a zero/unparseable one, or a
 * body that cannot be read as a stream (SSR, a polyfilled fetch, an already-consumed response).
 *
 * `Content-Length` is a CORS-safelisted response header, so it survives the cross-origin CDN fetch
 * that audio downloads actually make.
 *
 * `onProgress` fires only when the whole PERCENT changes, so a 40MB file emits at most 100 calls
 * instead of one per chunk — that cap is what lets the caller do a copy-on-write store reassign per
 * callback without it costing anything. It is called with 1 only via the clamp below; the caller
 * should treat completion as "the promise resolved", not "progress reached 1".
 *
 * Never throws on its own account: a mid-stream read error propagates to the caller, which already
 * owns the never-throws boundary (download-track's D-17 try/catch → 'failed').
 */
export async function readBlobWithProgress(
	resp: Response,
	onProgress: (fraction: number) => void
): Promise<Blob> {
	const total = Number(resp.headers?.get?.('content-length') ?? '');
	const body = resp.body;
	// Indeterminate: no honest fraction to report → today's behaviour, untouched.
	if (!Number.isFinite(total) || total <= 0 || !body || typeof body.getReader !== 'function') {
		return resp.blob();
	}

	const reader = body.getReader();
	const chunks: BlobPart[] = [];
	let received = 0;
	let lastPercent = -1;

	for (;;) {
		const { done, value } = await reader.read();
		if (done) break;
		if (!value) continue;
		chunks.push(value as BlobPart);
		received += value.byteLength;
		// Clamp: a server that under-reports Content-Length must not produce 137%.
		const fraction = Math.min(1, received / total);
		const percent = Math.floor(fraction * 100);
		if (percent !== lastPercent) {
			lastPercent = percent;
			onProgress(fraction);
		}
	}

	// Preserve the content type so the saved file and the offline blob keep their media type.
	return new Blob(chunks, { type: resp.headers?.get?.('content-type') ?? '' });
}
