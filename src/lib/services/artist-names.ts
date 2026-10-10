// artist-names — resolve the Now Playing artist line into per-artist names.
//
// quick-261009-ewf: "Earth, Wind & Fire" was rendering as THREE tappable artists
// (Earth · Wind · Fire) because splitArtists() treats `,` and `&` as connectors.
// But that full string is ONE legal group name — the split must NOT fire when the
// whole string is a real artist. So this layer finds out the artist name(s) in
// smart ways BEFORE splitting, cheapest first:
//
//   1. FAST PATH — no connectors in the string (splitArtists yields <= 1 name):
//      nothing would be split anyway; return as-is with no network at all.
//   2. IDENTITY — search the FULL string on MusicBrainz (/api/musicbrainz/artist).
//      When the returned identity's canonical name equals the full string, the whole
//      string stays ONE name. (This also supersedes the old "AC/DC -> [AC, DC] is
//      intentional" slash heuristic for real band names — splitArtists() itself is
//      unchanged and its tests still pin the slash behavior.)
//   3. RECORDING — ask MusicBrainz who performed THIS recording
//      (/api/musicbrainz/recording-artists?title=…&artist=…): the recording's
//      artist-credit array is ground truth. Fixes mangled variants the identity
//      check cannot see ("Earth Wind and Fire" still resolves to the band's single
//      credit), attributes real multi-artist recordings (duets, feat. credits), and
//      corrects mislabeled metadata (a solo track whose source lists a composer in
//      the artist field comes back as one credit).
//   4. FALLBACK — splitArtists(raw): exactly today's behavior.
//
// Contract:
//   - Pure module: no runes, no `$state`, no `$app/*`, no DOM — node-Vitest-testable.
//   - Never throws: any lookup failure (network, non-ok, malformed JSON, timeout)
//     degrades to the next layer, ending at splitArtists(raw).
//   - Results are memoized per raw string + title (bounded cap) so replaying the
//     same track does not re-hit the edge routes.

import { splitArtists } from '$lib/util/artist-split';
import { apiUrl } from '$lib/services/api-base';
import { canonicalKey } from '$lib/proxy/musicbrainz-shared';

/** Client-facing shape of /api/musicbrainz/artist (mirrors its MbArtistIdentity). */
interface MbArtistIdentity {
	mbid: string | null;
	name: string | null;
	country: string | null;
	names: Record<string, string>;
}

/** Client-facing shape of /api/musicbrainz/recording-artists. */
interface MbRecordingArtists {
	artists: { name: string; mbid: string | null; joinphrase: string }[];
}

// quick-261009-ewf: the identity check is a NAME-EQUALITY check, not a score check.
// The edge route already enforces MIN_SCORE=90 server-side, so any returned mbid is
// a confident hit — what remains is to confirm the hit IS the full string we asked
// about, not a different artist that merely scored well on the tokens.
function isFullNameMatch(identity: MbArtistIdentity | null, raw: string): boolean {
	if (!identity || !identity.mbid || !identity.name) return false;
	return canonicalKey(identity.name) === canonicalKey(raw);
}

// Bounded memo: a long-lived SPA session replays tracks, so the same raw strings
// recur; cap the map so it cannot grow without bound (oldest entry evicted first,
// which Map iteration order gives us for free on insertion).
const MEMO_CAP = 1000;
const memo = new Map<string, string[]>();

function memoKey(raw: string, title: string): string {
	return `${raw}\n${title}`;
}

function memoize(key: string, names: string[]): string[] {
	if (memo.size >= MEMO_CAP) {
		const oldest = memo.keys().next();
		if (!oldest.done) memo.delete(oldest.value);
	}
	memo.set(key, names);
	return names;
}

/** Clear the memo. Exported for tests only — production code never calls this. */
export function __clearArtistNamesMemo(): void {
	memo.clear();
}

/** Layer 2: is the FULL string a legal artist/group name? */
async function identityWhole(raw: string): Promise<string[] | null> {
	try {
		const res = await fetch(apiUrl(`/api/musicbrainz/artist?name=${encodeURIComponent(raw.trim())}`));
		if (res.ok && isFullNameMatch((await res.json()) as MbArtistIdentity, raw)) {
			return [raw.trim()];
		}
	} catch {
		// Never-throw contract: fall through to the next layer.
	}
	return null;
}

/** Layer 3: who performed this recording? Returns the credit names, or null. */
async function recordingCredits(raw: string, title: string): Promise<string[] | null> {
	try {
		const res = await fetch(
			apiUrl(
				`/api/musicbrainz/recording-artists?title=${encodeURIComponent(title.trim())}` +
					`&artist=${encodeURIComponent(raw.trim())}`
			)
		);
		if (res.ok) {
			const names = ((await res.json()) as MbRecordingArtists).artists
				.map((a) => (a.name ?? '').trim())
				.filter(Boolean);
			if (names.length) return names;
		}
	} catch {
		// Never-throw contract: fall through to the split fallback.
	}
	return null;
}

/**
 * Resolve a track's raw artist string into the names Now Playing renders as
 * individual tappable links. Layers 2-3 consult MusicBrainz (edge-cached 24h);
 * anything they cannot answer confidently falls back to splitArtists().
 */
export async function resolveArtistNames(raw: string, title = ''): Promise<string[]> {
	const key = raw ?? '';
	const t = title ?? '';
	const mkey = memoKey(key, t);
	const hit = memo.get(mkey);
	if (hit) return hit;

	const fallback = splitArtists(key);
	// Layer 1 (fast path): no connector would split this string anyway, so a lookup
	// could only ever return the same single name. Skip the network entirely.
	if (fallback.length <= 1) return memoize(mkey, fallback);

	// Layer 2: the full string is a legal artist/group name → keep it whole.
	const whole = await identityWhole(key);
	if (whole) return memoize(mkey, whole);

	// Layer 3: the recording's own artist credits (needs a title to search by).
	if (t.trim()) {
		const credits = await recordingCredits(key, t);
		if (credits) return memoize(mkey, credits);
	}

	// Layer 4: today's behavior, unchanged.
	return memoize(mkey, fallback);
}
