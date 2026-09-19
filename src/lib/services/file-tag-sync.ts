// file-tag-sync.ts — the ONE serializer in front of every single-file tag rewrite (quick-260919-3j1).
//
// WHY IT EXISTS. One tag pass opens the audio file, copies it into the Emscripten heap and peaks at
// roughly 6x the file size (see `audio-tags.ts`'s TAG_MAX_BYTES comment). There are now FOUR
// triggers that can each start one:
//   1. the metadata editor's Save          (an explicit gesture)
//   2. a cover pin in the track menu       (an explicit gesture)
//   3. a lyric pin in the track menu       (an explicit gesture)
//   4. the player's automatic lyric embed  (the only automatic one, capped per uid per session)
// Any two of them can fire close together — pin a cover, then tap an LRC, while a song that just
// got its lyrics over the network is embedding them. Two concurrent passes over a 27 MB FLAC on a
// phone is an OOM, not a slowdown.
//
// `retag.ts` already settled this shape for the batch loop ("SEQUENTIAL, not a parallel fan-out:
// each entry means a wasm tag pass over a whole audio file"). This is the same rule extended to the
// one-off callers, which the batch loop's own `for` cannot cover.
//
// QUEUE, NEVER REJECT. A second call waits; it is not refused. A dropped write is a lost user edit,
// and three of the four triggers are a finger on the screen.
//
// NO CAP, NO TIMEOUT, NO MEMO HERE. The attempt cap for the ONE automatic caller belongs to that
// caller (the player's per-session Set), because an explicit user gesture must never be refused by
// a budget it cannot see.
//
// PURITY CONTRACT, same as `retag.ts`: no runes store, no i18n, no rune — this stays in the node
// test project. It is a promise chain and one call.

import { retagOne, type RetagEntry, type RetagItemResult } from './retag';

/** The tail of the serial chain. Module-scope: app-wide serialization is the entire point. */
let chain: Promise<unknown> = Promise.resolve();

/**
 * Rewrite ONE file's tags, never concurrently with another. Resolves with that call's own
 * `retagOne` result, in call order.
 *
 * Never rejects. `retagOne` is contractually never-throws, but the chain must not ASSUME that: one
 * rejection that escaped would poison the tail for the rest of the session, so a rejection maps to
 * `'error'` — the same discriminant `retagOne` uses for an internal failure, and, like every
 * non-`'tagged'` result, it means the file on disk was not touched.
 */
export function syncFileTags(entry: RetagEntry): Promise<RetagItemResult> {
	const run = chain.then(
		() => retagOne(entry).catch((): RetagItemResult => 'error'),
		() => retagOne(entry).catch((): RetagItemResult => 'error')
	);
	// The tail swallows its own result so a failure can never surface as an unhandled rejection on
	// the NEXT caller's link.
	chain = run.then(
		() => undefined,
		() => undefined
	);
	return run;
}
