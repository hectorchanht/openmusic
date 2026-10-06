// non-song — built-in exclusion of non-music audio (2026-10-06, Hector).
//
// WHY. The device import sweeps Music/ and Download/, and users keep voice notes, call recordings
// and messenger audio there (or in subfolders). Retagging those is pure noise — a WhatsApp voice
// note does not want title/artist/album tags — and each one costs a tag pass plus, on Android, a
// consent dialog. The user-defined skipRules already allowed this, but Hector asked for it built
// in: "the app should exclude non songs like pure sound recordings made by user or whatsapp audio".
//
// WHAT IT MATCHES. Lowercase substring match against `displayName + relativePath` (the same
// haystack the user's skipRules use, D-12). Deliberately conservative — a pattern fires only on
// words that do not occur in music filenames:
//
//   - WhatsApp: the `WhatsApp/` path, plus the `PTT-` (voice note) and `AUD-` (audio) filename
//     prefixes, which are distinctive even when the file was moved out of the WhatsApp tree.
//   - Recordings: `recording(s)`, `voice memo`, `sound recorder`, `call recording` — the names
//     recorder apps and the OS give user-made audio.
//   - Voice messages: `voice note(s)`, `voice message`, `audio message`, `voicemail`.
//
// What it does NOT do: duration-based filtering (the import's `minSeconds` already covers "too
// short", and a short song is still a song), and tag-content sniffing (an untagged song and an
// untagged voice note are indistinguishable without the filename).
//
// PURE (no runes, no i18n, no bridge) — used by device-import's classifyRow AND the retag
// eligible-list filter, and unit-tested like the other pure services.

/** Lowercase substrings. Keep them specific — a false positive silently drops a real song. */
const NON_SONG_PATTERNS = [
	'whatsapp',
	'ptt-', // WhatsApp voice note: PTT-20261006-WA0001.opus
	'aud-', // WhatsApp audio: AUD-20261006-WA0001.mp3
	'voice note',
	'voice notes',
	'voicenote',
	'voice message',
	'audio message',
	'voicemail',
	'recording',
	'recordings',
	'voice memo',
	'voicememo',
	'sound recorder',
	'call recording'
];

/**
 * True when the file looks like user-made non-music audio (voice notes, recordings, …).
 * `displayName` and `relativePath` are the MediaStore values; either may be missing/blank.
 */
export function isNonSongFile(displayName?: string | null, relativePath?: string | null): boolean {
	const hay = `${displayName ?? ''} ${relativePath ?? ''}`.toLowerCase();
	if (!hay.trim()) return false;
	return NON_SONG_PATTERNS.some((p) => hay.includes(p));
}

/**
 * 2026-10-06, Hector: "the goal is only tag songs that we have meta info of".
 *
 * The retag gate. App downloads always pass — they carry catalog metadata (title/artist/album).
 * A device (imported) file passes only when it has a REAL title to write: non-empty, and not a
 * non-song filename stem. A `PTT-20261006-WA0001` or `Recording 001` title is the ABSENCE of
 * metadata, not metadata — retagging it would stamp junk tags onto a voice note.
 *
 * This is deliberately stricter than the import's `isNonSongFile` blocklist: the import may still
 * bring in an untagged song for playback, but the retag writes tags and must have something true
 * to write.
 */
export function hasTaggableMeta(entry: { uid: string; title?: string | null }): boolean {
	if (!entry || typeof entry.uid !== 'string' || !entry.uid) return false;
	if (!entry.uid.startsWith('device:')) return true;
	const title = (entry.title ?? '').trim();
	if (!title) return false;
	return !isNonSongFile(title, '');
}
