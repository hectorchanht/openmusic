// local-tags — turn an OFFLINE-SERVED blob into the two things a now-playing surface needs that
// the queue entry does not carry: the file's own LRC and its own front cover.
//
// PURITY CONTRACT (same discipline as audio-tags.ts): no runes store, nothing under the store or
// i18n aliases, no SvelteKit environment module. The caller (player.svelte.ts) owns every reactive
// write and every log line; this module is a function of (uid, blob). Named in prose rather than
// spelled out because the check is a grep over the RAW source — the audio-tags.ts precedent, where
// a "do not import X" comment must not be able to satisfy a gate the code violates.
//
// NEVER REJECTS. An unreadable file, an unknown container, a wasm load failure and an oversized
// blob all resolve to the same empty result — the caller then runs its name-based network
// fallbacks, exactly as it does for a file that simply carries no tags.
//
// WHY A MEMO AT ALL. Reading tags costs a ~686 kB wasm module and a full copy of the file into the
// Emscripten heap, which grows but never shrinks. Playing the same song twice in a session must not
// pay that twice — and the NEGATIVE result is the load-bearing half: without memoising "this file
// has nothing", every replay of an untagged file re-decodes it AND re-fires the network fallbacks.

import { readAudioTags, TAG_MAX_BYTES } from '$lib/services/audio-tags';
import { MAX_ART_BYTES, bytesToBase64 } from '$lib/services/media-artwork';
import { parseLRC } from '$lib/services/lrc';

/**
 * What a local file was able to supply. `null` means "the file does not have this" — the caller
 * falls back to the network for exactly the null fields and for nothing else.
 */
export interface LocalEnrichment {
	/** Raw LRC, timestamps included, ONLY when `parseLRC` yields at least one line (37-D-07). */
	lrc: string | null;
	/** `data:<image mime>;base64,…`. MEMORY-ONLY — see the cache warning below. */
	art: string | null;
	/**
	 * 37-D-05: the file's own artist/title when it carries them, returned for the CALLER'S QUERY
	 * ONLY — the name-based lyric/cover fallbacks on this one play. They must NEVER be written to
	 * `player.current`, `library.downloads` or any persisted state: `syncDevice`'s refresh-in-place
	 * carries only `cover` across a re-import (device-import.ts), so a persisted recovered artist
	 * would be silently blanked by the next scan — a data-loss path. A future phase that wants to
	 * persist them must extend that carry-across FIRST; that is the whole reason this stays
	 * query-only now.
	 */
	artist?: string;
	title?: string;
	/** True ONLY on a memo hit, so the caller's action log can show a replay skipped the decode. */
	cached?: boolean;
}

/**
 * T-37-01: the MIME comes verbatim out of an APIC/`covr`/PICTURE block in an UNTRUSTED user file
 * and goes straight into a `data:` URL that the hero, the nowbar and the OS media card all render.
 * An allowlist, not a sanitiser — `data:text/html;base64,…` must never be constructible here.
 */
const IMAGE_MIME_RE = /^image\/(jpeg|png|webp|gif)$/i;

/**
 * ponytail: 6-entry FIFO — current + neighbours is all that is ever displayed; a data: URL can be
 * ~1.3 MB so the cap is a memory ceiling, not a hit-rate tune.
 *
 * 37-D-06: SESSION-SCOPED, never persisted. The bytes are already on disk in the user's own file,
 * an LRC on 500 imported rows is 1-3 MB of localStorage in a store that also holds liked +
 * playlists + history, and a `data:` URL in the cover cache silently kills ALL cover caching (its
 * writer is sized for ~100-byte https entries, has no scheme or length guard, and swallows the
 * QuotaExceededError). One decode per song actually played is bounded by user behaviour, never by
 * library size — which is exactly the locked "on first play, per song".
 */
const MEMO_MAX = 6;
const memo = new Map<string, LocalEnrichment>();

/** Test hook — mirrors `__resetCoverMissCache`. Not called from app code. */
export function __resetLocalTagsMemo(): void {
	memo.clear();
}

/**
 * quick-260919-1eh: drop ONE uid's memo entry.
 *
 * The memo is keyed by uid and a retag REWRITES the bytes stored under that key, so without this the
 * next offline play of an edited song paints the PRE-edit embedded art and LRC for the rest of the
 * session — the memo would be describing a file that no longer exists. `retag.ts` calls it on the
 * 'tagged' path only.
 *
 * Per-uid, NOT `__resetLocalTagsMemo()`: the other (up to five) entries describe files nobody
 * touched, and re-decoding them costs the ~686 kB wasm pass plus a full file copy each.
 */
export function forgetLocalEnrichment(uid: string): void {
	memo.delete(uid);
}

/**
 * Read `blob`'s embedded LRC + front cover, once per `uid` per session.
 *
 * Off the audio critical path by contract: the caller sets `audio.src` and starts playback FIRST,
 * then awaits this. It is also the GATE for the network fallbacks — running those concurrently
 * with the decode would fire calls the file's own tags make redundant.
 */
export async function localEnrichment(uid: string, blob: Blob): Promise<LocalEnrichment> {
	const hit = memo.get(uid);
	if (hit) return { ...hit, cached: true };
	const found = await read(blob);
	memo.set(uid, found);
	// Insertion-order eviction: Map iterates in insertion order, so the first key IS the oldest.
	// One entry in per call, so the map can only ever be one over the cap.
	if (memo.size > MEMO_MAX) {
		const oldest = memo.keys().next().value;
		if (oldest !== undefined) memo.delete(oldest);
	}
	return found;
}

async function read(blob: Blob): Promise<LocalEnrichment> {
	const out: LocalEnrichment = { lrc: null, art: null };
	try {
		// T-37-03: checked against `blob.size` BEFORE `arrayBuffer()`, the same order `tagAudioBlob`
		// uses. Copying a 45 MB FLAC into memory just to reject it is the failure this guards.
		if (blob.size > TAG_MAX_BYTES) return out;
		const tags = await readAudioTags(new Uint8Array(await blob.arrayBuffer()));
		if (!tags) return out; // unknown container / unreadable — go straight to the name fallbacks
		// 37-D-07: "has lyrics" must mean "renders lyrics". `parseLRC` drops every line without a
		// [mm:ss] stamp, so an unstamped plain-text lyric parses to [] and would paint an EMPTY pane
		// while suppressing the network walk that could have found a synced one.
		if (tags.lyrics && parseLRC(tags.lyrics).length > 0) out.lrc = tags.lyrics;
		// T-37-02: cap the picture. Base64 inflates it by 4/3, it crosses the Capacitor JSON bridge
		// as a string, and MEMO_MAX entries of it stay resident for the session.
		const pic = tags.art;
		if (pic && IMAGE_MIME_RE.test(pic.mimeType) && pic.data.length > 0 && pic.data.length <= MAX_ART_BYTES)
			out.art = `data:${pic.mimeType};base64,${bytesToBase64(pic.data)}`;
		if (tags.artist) out.artist = tags.artist;
		if (tags.title) out.title = tags.title;
	} catch {
		// Never-throws (36-D-06 extended to this module). Whatever was already gathered stands; the
		// caller treats every null as "the file did not supply this".
	}
	return out;
}
