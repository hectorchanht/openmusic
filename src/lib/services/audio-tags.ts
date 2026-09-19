// audio-tags.ts — PURE, node-testable audio tag codec (36-D-02/D-03).
//
// ONE module owns reading AND writing tags for the three containers the app downloads: ID3v2 (mp3),
// MP4 `ilst` atoms (m4a), Vorbis comments + PICTURE (flac). Phase 34's device import reads through
// this same module instead of growing a second parser (36-D-03) — and the read side is what makes
// the write side provable: a round-trip test parses back what we just wrote, so byte layout is
// verified in the node Vitest project with no device in the loop.
//
// PURITY CONTRACT (same discipline as download-filename.ts): this module MUST NOT import any runes
// store, anything under the lib/stores or lib/i18n aliases, or any SvelteKit `$app` module. It
// receives ALREADY-translated display strings from the caller (who ran them through
// `names.dnArtist`/`names.dnTitle`), and it reports its outcome as a plain discriminant the CALLER
// logs — `logAction` is a runes store and importing it
// here would drag the whole store graph into a module Phase 34 and the single node Vitest project
// both need to import cheaply.
//
// NO `browser` GUARD, deliberately. The obvious instinct is `if (!browser) return` from the `$app`
// environment module, but nothing here needs it: the module only ever runs from a user-initiated
// download or retag in the client, the app is `ssr=false` everywhere, and the SSR/Cloudflare-build
// protection comes entirely from the DYNAMIC import below (nothing is pulled in until a call
// happens). Dropping the `$app` dependency is also what lets the tests exercise `tagAudioBlob`
// directly under node.
//
// NEVER THROWS (36-D-06). Every exported function absorbs its failures: an unknown container, a
// malformed input, an oversized file, a wasm load failure, an out-of-memory trap. `writeAudioTags`
// and `readAudioTags` return `null`; `tagAudioBlob` returns the caller's ORIGINAL blob with a
// non-'tagged' result. A file that downloaded fine must never be lost to a tagging problem — the
// untagged-but-intact file is always the fallback.
//
// quick-260919-0mw: `match-key.ts` is the ONE static import, and it is inside the purity contract —
// a dependency-free pure string normaliser, no store, no `$app`, no alias beyond `$lib`. Reused
// rather than re-inlined so the app has one normaliser, not two (CLAUDE.md shared primitives).
import { matchKey } from '$lib/services/match-key';

/**
 * Everything we might know about a track. An absent field is simply NOT WRITTEN — never an empty
 * string and never a placeholder (36-D-10: `album` is omitted when `Track.album` is '').
 *
 * The field set is deliberately small. No year/genre (36-D-07: neither exists on `Track` and
 * enriching them means adding network calls to a path this project has repeatedly cut calls from).
 * No provenance/encoder/comment field (36-D-08: the user's file stays clean). No playtime field
 * (36-D-09: MP4, FLAC STREAMINFO and MP3 frame headers already carry the true value, every player
 * reads it there, and taglib-wasm exposes no writable one anyway).
 */
export interface AudioTagFields {
	title?: string;
	artist?: string;
	album?: string;
	/** 36-D-12: the album page's artist when downloading an album, else the track's own artist. */
	albumArtist?: string;
	/** 36-D-11: set ONLY by the album download loop. `displayIndex` must never be used here. */
	trackNumber?: string;
	/**
	 * quick-260915-062: the track's RAW LRC, TIMESTAMPS INCLUDED, exactly as resolved —
	 * `[00:12.34]歌詞` lines are passed through untouched. Locked user decision, weighed and
	 * accepted: players that parse synced lyrics (Poweramp, foobar2000, Navidrome, Plex) scroll
	 * them in time, players that do not will show the `[mm:ss.xx]` prefixes literally. Do NOT strip
	 * the stamps and do NOT try a dual plain-text + synced mapping.
	 *
	 * Omitted when the track has no lyrics (`Track.lrc` null or '') — same "omit, never placeholder"
	 * contract as 36-D-10's album, so a lyric-less download carries no empty frame at all.
	 *
	 * No size path of its own: an LRC is a few KB and TAG_MAX_BYTES already bounds the whole file.
	 */
	lyrics?: string;
}

/**
 * quick-260919-0mw — the ALBUM value to write, or `undefined` when there is no real album to name.
 *
 * THE BUG: a downloaded single arrived on the phone claiming an album that was just its own song
 * title. Evidence: `The Weeknd - The Hills (Explicit).flac` tagged ALBUM=`The Hills (Explicit)`, and
 * `Polar G - 過一招 (feat. 拉天糖).m4a` tagged ALBUM=`过一招 (feat. 拉天糖)`. This is NOT a writer bug —
 * 36-D-10 already omits an EMPTY album, and the Android MediaStore bridge only READS the column. The
 * bad value is real upstream data: CN/streaming catalogs set a single's `album` to its own track
 * name, `Track.album` is copied through verbatim by the resolvers (kuwo.ts `album: d.album ||
 * track.album`), and we faithfully wrote it. An album whose name IS the song is not information —
 * it is noise that makes every single its own one-track album in the user's library.
 *
 * VARIADIC `titles` because a comparison must see BOTH titles: the filename/tag uses the DISPLAY
 * title (script-converted by the `names` store) while the album rides the RAW catalog string — which
 * is exactly why the Polar G evidence shows a Simplified album next to a Traditional filename.
 * Matching ANY supplied title drops the album. That also removes any need for `zh-convert` here (it
 * is async and heavy); the call sites simply hand in both strings.
 *
 * Normalisation is `matchKey('', s)` — the project's ONE case/space/punctuation-insensitive
 * normaliser — rather than a second copy of the same regex chain.
 */
export function albumTag(
	album: string | null | undefined,
	...titles: (string | null | undefined)[]
): string | undefined {
	if (!album) return undefined; // 36-D-10 unchanged: an empty album was already omitted
	const a = matchKey('', album);
	for (const title of titles) {
		if (!title) continue;
		if (matchKey('', title) === a) return undefined;
	}
	return album;
}

/** The containers we tag. Chosen from the BYTES, never from a URL extension (RESEARCH Pitfall 3). */
export type AudioContainer = 'mp3' | 'm4a' | 'flac';

/**
 * What happened, for the caller to log. Only `'tagged'` carries new bytes; every other result
 * hands back the exact blob that came in, so a caller can pass it straight through to disk.
 */
export type TagOutcome =
	| { blob: Blob; result: 'tagged'; format: AudioContainer }
	| { blob: Blob; result: 'skipped-size' | 'unknown-container' | 'no-fields' | 'error' };

/**
 * Memory ceiling. Above this we save the original bytes untagged — a clean 36-D-06 fall-through.
 *
 * Measured, not guessed: a single open/set/save pass over a 50.5 MB FLAC peaked at 392 MB RSS,
 * i.e. ≈ 6× the file size (the Blob, its `arrayBuffer()` copy, the wasm heap copy, TagLib's save
 * buffers and the output buffer all coexist), and the Emscripten heap GROWS BUT NEVER SHRINKS —
 * after one big file the process stays ~370 MB for its lifetime. Time is a non-issue by comparison:
 * 29 ms for that same file. 40 MB covers every m4a and most FLACs while excluding the pathological
 * ones that would get an Android WebView killed mid-download.
 *
 * ponytail: one flat number, no per-platform tier. The 6× figure is desktop-node measured and a
 * WebView's real ceiling is device-specific — if a class of lossless downloads turns up silently
 * untagged, tune this on the emulator (RESEARCH A6) rather than adding tiers speculatively.
 */
export const TAG_MAX_BYTES = 40 * 1024 * 1024;

// Memoised lazy loaders. THREE reasons this must stay a dynamic `import()`:
//   1. Bundle — taglib-wasm is ~686 kB of .wasm + 75 kB of JS (≈257 kB gzip). A static import puts
//      all of it in the entry chunk of a mobile-first PWA that most users never download a song on.
//   2. SSR/Cloudflare — the edge build must not pull the node entry of a wasm package at all.
//   3. Cost — the wasm compiles once per session; the memo keeps a second download from re-doing it.
// A FAILED load un-memoises itself so a later call can retry (an import can fail transiently on a
// flaky network); a rejected promise cached forever would poison every subsequent download.
let modPromise: Promise<typeof import('taglib-wasm')> | null = null;
let simplePromise: Promise<typeof import('taglib-wasm/simple')> | null = null;

async function loadTagLib(): Promise<typeof import('taglib-wasm')> {
	try {
		return await (modPromise ??= import('taglib-wasm'));
	} catch (e) {
		modPromise = null;
		throw e;
	}
}

async function loadSimple(): Promise<typeof import('taglib-wasm/simple')> {
	try {
		return await (simplePromise ??= import('taglib-wasm/simple'));
	} catch (e) {
		simplePromise = null;
		throw e;
	}
}

/** taglib's detected format → our container id. Anything absent from this map we refuse to touch. */
const CONTAINER_BY_FORMAT: Record<string, AudioContainer> = {
	MP3: 'mp3',
	MP4: 'm4a',
	FLAC: 'flac'
};

/** True when at least one field carries a real value — otherwise there is nothing to write. */
function hasAnyField(fields: AudioTagFields): boolean {
	return Boolean(
		fields.title || fields.artist || fields.album || fields.albumArtist || fields.trackNumber || fields.lyrics
	);
}

/**
 * Write `fields` (+ an optional front cover) into `bytes`. Returns the tagged bytes and the
 * container that was detected, or `null` when the container is unrecognised / the input is
 * malformed / anything throws — the caller then saves the ORIGINAL bytes untouched (36-D-06).
 *
 * ONE open → set → save pass. Never two `apply*` calls on the same file: that reopens and re-saves
 * the whole buffer and doubles peak memory (RESEARCH Pitfall 7) for no benefit.
 *
 * Never throws, never mutates `bytes`.
 *
 * The returned array is explicitly `Uint8Array<ArrayBuffer>`, not the default `ArrayBufferLike`
 * flavour: a `SharedArrayBuffer`-backed view is not a `BlobPart`, so the plain spelling makes
 * `new Blob([bytes])` a type error downstream. Our copy is always plain-buffer backed.
 */
export async function writeAudioTags(
	bytes: Uint8Array,
	fields: AudioTagFields,
	art?: { data: Uint8Array; mimeType: string } | null
): Promise<{ bytes: Uint8Array<ArrayBuffer>; format: AudioContainer } | null> {
	if (bytes.byteLength === 0 || bytes.byteLength > TAG_MAX_BYTES) return null;
	try {
		const { TagLib } = await loadTagLib();
		const taglib = await TagLib.initialize();
		const file = await taglib.open(bytes);
		try {
			// THE container sniff: taglib reads the real magic/atom layout. `extFromAudioUrl` is for
			// filenames only — its 'mp3' default for an unrecognised URL would route a FLAC into an
			// ID3 writer (RESEARCH Pitfall 3).
			const container = CONTAINER_BY_FORMAT[file.getFormat()];
			if (!container) return null;
			const tag = file.tag();
			// "Omit, never placeholder" — a setter is called ONLY when we actually know the value.
			if (fields.title) tag.setTitle(fields.title);
			if (fields.artist) tag.setArtist(fields.artist);
			if (fields.album) tag.setAlbum(fields.album);
			// ALBUMARTIST / TRACKNUMBER are format-agnostic property keys; taglib maps them onto
			// TPE2 (ID3), aART/trkn (MP4) and ALBUMARTIST/TRACKNUMBER (Vorbis).
			//
			// quick-260915-062: the same goes for the LYRICS key — USLT (ID3v2), ©lyr (MP4),
			// LYRICS= (Vorbis). Verified by round-tripping the real fixtures, NOT assumed: taglib-wasm's
			// own constants table documents this key as Vorbis-only, but that table is metadata and the
			// C++ PropertyMap does the real mapping in all three containers. Still ONE pass — never a
			// second apply*/reopen for lyrics (RESEARCH Pitfall 7 doubles peak memory).
			if (fields.albumArtist) file.setProperty('ALBUMARTIST', fields.albumArtist);
			if (fields.trackNumber) file.setProperty('TRACKNUMBER', fields.trackNumber);
			if (fields.lyrics) file.setProperty('LYRICS', fields.lyrics);
			if (art) {
				file.setPictures([
					{ mimeType: art.mimeType, data: art.data, type: 'FrontCover', description: '' }
				]);
			}
			if (!file.save()) return null;
			// Copy out of the wasm heap: `dispose()` runs in the `finally` below, before the caller
			// ever touches these bytes, so handing back a live view would be a use-after-free.
			return { bytes: new Uint8Array(file.getFileBuffer()), format: container };
		} finally {
			// Frees the wasm-side handle. The Emscripten heap itself does not shrink — see
			// TAG_MAX_BYTES.
			file.dispose();
		}
	} catch {
		// 36-D-06 absorbs the whole failure class here: unrecognised container, malformed input,
		// wasm load failure, out-of-memory trap, a library bug. All of them mean "save it untagged".
		return null;
	}
}

/** First value of a taglib field, which may arrive as a string, an array of strings, or nothing. */
function firstString(v: string | string[] | number | undefined): string | undefined {
	const s = Array.isArray(v) ? v[0] : typeof v === 'number' ? String(v) : v;
	return s ? s : undefined;
}

/**
 * Read tags back out of `bytes` — the read half of 36-D-03, used by the round-trip tests and by
 * Phase 34's device import. Returns `null` if the bytes are not one of our three containers or
 * anything throws: an unreadable file still imports (Phase 34 D-16), it just imports untagged.
 *
 * A field with no value is ABSENT from the result, never an empty string — same contract as the
 * write side, so `readAudioTags(writeAudioTags(x)).album === undefined` is a meaningful assertion.
 *
 * 37-D-02: the embedded front cover comes back on `art`, read from the SAME `readTags()` call —
 * `readTags` populates `ExtendedTag.pictures` for free in that one open pass
 * (taglib-wasm `dist/src/utils/tag-mapping.js:34-35`). Deliberately NOT the two cover helpers
 * `taglib-wasm/simple` also exports: each is a second full `withAudioFile` open + wasm heap copy of a
 * file up to TAG_MAX_BYTES (40 MB, ~6× peak RSS, heap never shrinks), and the cover-art one throws the
 * MIME away — which is exactly what the `data:` URL downstream needs. One pass, one dispose. The test
 * greps this file for their names, so do not reintroduce either even in prose.
 *
 * `art` is widened onto the RETURN type only, never onto `AudioTagFields` — that interface is the
 * WRITE input and the write side already takes a picture as its own argument (`writeAudioTags(…, art)`),
 * so putting it on the fields object would create two ways to pass one cover.
 *
 * The bytes it carries are MEMORY-ONLY downstream: a `data:` URL built from them must never reach the
 * localStorage cover cache (whose writer is sized for ~100-byte https entries).
 */
export async function readAudioTags(
	bytes: Uint8Array
): Promise<(AudioTagFields & { format: AudioContainer; art?: { data: Uint8Array; mimeType: string } }) | null> {
	try {
		const { readTags, readFormat } = await loadSimple();
		const format = CONTAINER_BY_FORMAT[(await readFormat(bytes)) ?? ''];
		if (!format) return null;
		const t = await readTags(bytes);
		const out: AudioTagFields & {
			format: AudioContainer;
			art?: { data: Uint8Array; mimeType: string };
		} = { format };
		const title = firstString(t.title);
		const artist = firstString(t.artist);
		const album = firstString(t.album);
		const albumArtist = firstString(t.albumArtist);
		const trackNumber = firstString(t.trackNumber) ?? firstString(t.track);
		// quick-260915-062: NOT a `firstString` case, and not `getProperty('LYRICS')` either (that
		// returns undefined after a save). taglib-wasm surfaces lyrics on its own structured path, as
		// `ExtendedTag.lyrics: UnsyncedLyrics[]` — so read the first entry's text and leave
		// `firstString`'s signature alone.
		const lyrics = t.lyrics?.[0]?.text;
		// 37-D-02: FrontCover preferred, `pictures[0]` as the fallback (the same rule the simple API's
		// own cover helper documents). Anything odd — no array, empty data, a blank mime — leaves `art` absent
		// rather than rejecting: the never-throws contract (36-D-06) covers the picture too.
		const pic = t.pictures?.find((p) => p.type === 'FrontCover') ?? t.pictures?.[0];
		if (title) out.title = title;
		if (artist) out.artist = artist;
		if (album) out.album = album;
		if (albumArtist) out.albumArtist = albumArtist;
		if (trackNumber) out.trackNumber = trackNumber;
		if (lyrics) out.lyrics = lyrics;
		if (pic?.data?.length && pic.mimeType) out.art = { data: pic.data, mimeType: pic.mimeType };
		return out;
	} catch {
		return null;
	}
}

/**
 * `data:<mime>;base64,<payload>` → bytes + mime, or `null` for anything else. The inverse of
 * media-artwork.ts's `bytesToBase64`, and the ONLY way cover bytes enter this module — it never
 * fetches. The string it decodes has already been fetched, size-capped (MAX_ART_BYTES), type-checked
 * and timeout-bounded by `resolveArtworkDataUrl` (36-D-13).
 *
 * `atob` over `Buffer`/`FileReader`: available in both browsers and node ≥16, so the same line works
 * in the WebView and in the node test project.
 */
export function dataUrlToBytes(dataUrl: string): { data: Uint8Array; mimeType: string } | null {
	const m = /^data:([^;,]+);base64,(.+)$/.exec(dataUrl ?? '');
	if (!m) return null;
	try {
		const binary = atob(m[2]);
		if (binary.length === 0) return null;
		const data = new Uint8Array(binary.length);
		for (let i = 0; i < binary.length; i++) data[i] = binary.charCodeAt(i);
		return { data, mimeType: m[1] };
	} catch {
		return null;
	}
}

/**
 * Blob-level wrapper — what `download-track.ts` and the retag path actually call.
 *
 * NEVER REJECTS. Worst case it resolves with the input blob, byte-identical and same object
 * identity, plus a result the caller can log. The caller writes `out.blob` to disk unconditionally.
 */
export async function tagAudioBlob(
	blob: Blob,
	fields: AudioTagFields,
	artDataUrl?: string | null
): Promise<TagOutcome> {
	try {
		if (!hasAnyField(fields)) return { blob, result: 'no-fields' };
		// Checked BEFORE `arrayBuffer()` so the big copy is never made on a file we will not tag.
		if (blob.size > TAG_MAX_BYTES) return { blob, result: 'skipped-size' };
		// Load first: a wasm/import failure is an infrastructure problem ('error'), distinct from
		// bytes we simply do not recognise ('unknown-container'). Also avoids reading a 40 MB blob
		// into memory only to discover the codec is unavailable.
		await loadTagLib();
		// The input array is passed inline so it is unreachable the moment writeAudioTags returns —
		// nothing here holds the untagged copy and the tagged one alive past this statement.
		const out = await writeAudioTags(new Uint8Array(await blob.arrayBuffer()), fields, artDataUrl ? dataUrlToBytes(artDataUrl) : null);
		if (!out) return { blob, result: 'unknown-container' };
		// `{ type: blob.type }` is load-bearing: quick-260913-tmi threaded the real audio MIME in
		// because the qq CDN lies in its Content-Type, and a bare `new Blob([bytes])` would throw
		// that fix away and hand the user a mis-typed file (RESEARCH Pitfall 6).
		return { blob: new Blob([out.bytes], { type: blob.type }), result: 'tagged', format: out.format };
	} catch {
		return { blob, result: 'error' };
	}
}
