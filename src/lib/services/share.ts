// Encode a track (and its up-next queue) into a base64url share token so a link can
// re-open + play the same song AND restore the queue. The token carries lightweight
// stubs; ensureTrackDetails re-resolves the (expiring) audio URL on play, so we never
// embed a stale stream URL. The visible URL also carries a human-readable `?t=<slug>`
// segment for readability — the authoritative decode reads the opaque `play` payload.
import type { Track } from '$lib/sources/types';

type Stub = Pick<Track, 'uid' | 'source' | 'songid' | 'title' | 'artist' | 'album' | 'cover'>;

/** v2 share payload: current track + a capped queue. Legacy v1 tokens are a bare Stub. */
interface SharePayloadV2 {
	v: 2;
	c: Stub;
	q: Stub[];
}

/** Cap the queue carried in a share URL so the URL stays bounded (T-gln-01 DoS bound). */
const QUEUE_CAP = 30;

// --- base64url transform (shared by encode/decode; btoa/atob exist in the Workers runtime) ---
function toBase64Url(json: string): string {
	const b64 = btoa(unescape(encodeURIComponent(json)));
	return b64.replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}
function fromBase64Url(token: string): string {
	const b64 = token.replace(/-/g, '+').replace(/_/g, '/');
	return decodeURIComponent(escape(atob(b64)));
}

function toStub(t: Track): Stub {
	return {
		uid: t.uid,
		source: t.source,
		songid: t.songid,
		title: t.title,
		artist: t.artist,
		album: t.album,
		cover: t.cover
	};
}

/** Rehydrate a persisted stub into a full (unresolved) Track — audio URL/lyrics re-fetched on play. */
function stubToTrack(v: Stub): Track {
	return {
		...v,
		audioUrl: null,
		lrc: null,
		lrcUrl: null,
		detailsLoaded: false,
		quality: null,
		qualityLabel: null,
		keyword: v.title,
		displayIndex: 1
	};
}

/** Validate a decoded value is a usable Stub (required identity fields present). */
function isStub(v: unknown): v is Stub {
	return (
		!!v &&
		typeof v === 'object' &&
		typeof (v as Stub).uid === 'string' &&
		!!(v as Stub).uid &&
		typeof (v as Stub).source === 'string' &&
		!!(v as Stub).source
	);
}

/**
 * Human-readable, URL-safe ASCII slug for `${title} ${artist}` (D-05). CJK / non-ASCII
 * codepoints are STRIPPED to ASCII (NOT preserved): the string is NFKD-normalised, combining
 * marks dropped, then every run of non-`[a-z0-9]` (which includes all CJK + punctuation +
 * whitespace) collapses to a single '-'. The slug is COSMETIC and copy-paste-clean — the
 * trailing `{source}{id}` key (see entityShareUrl/parseEntityParam) is the AUTHORITATIVE decode
 * key, so an all-CJK title legitimately yields '' here. Capped at ~60 chars. Pure — no
 * browser/DOM access. e.g. slugify('Hello World!!','A B') === 'hello-world-a-b';
 * slugify('稻香','Jay Chou') === 'jay-chou'; slugify('情非得已','') === ''.
 */
export function slugify(title: string, artist: string): string {
	const raw = `${title ?? ''} ${artist ?? ''}`.trim().toLowerCase();
	const slug = raw
		.normalize('NFKD')
		// WR-05: strip ALL combining marks left over from NFKD decomposition via the Unicode
		// mark property escape (\p{M}, requires the `u` flag) instead of a raw literal of the
		// U+0300–U+036F block. `\p{M}` covers every mark category (incl. U+1AB0–U+1AFF,
		// U+20D0–U+20FF), and avoids embedding raw combining characters in source (editor/VCS
		// fragility). Cosmetically redundant with the `[^a-z0-9]+` collapse below, but explicit.
		.replace(/\p{M}/gu, '')
		// Collapse every run of non-ASCII-alnum to a single '-'. CJK and all other non-ASCII
		// letters are NOT [a-z0-9], so they are dropped here (ASCII-only output, D-05).
		.replace(/[^a-z0-9]+/g, '-')
		.replace(/-+/g, '-')
		.replace(/^-+|-+$/g, '');
	return slug.slice(0, 60).replace(/-+$/g, '');
}

/**
 * OG-PATH-01: encode ONE raw title/artist into a URL path segment. Original CASE is
 * PRESERVED (the OG card title is read straight back out of the path, so lowercasing
 * would force a title-case reconstruction that renders `DNA` as `Dna`). Whitespace runs
 * collapse to a single '-'.
 *
 * quick-260807-vl1: raw UTF-8 is LEFT RAW — CJK, emoji, Arabic and every other non-ASCII
 * codepoint go into the path unescaped, so a shared Chinese song reads `/song/周傑倫/止戰之殤`
 * instead of `/song/%E5%91%A8%E5%82%91%E5%80%AB/…`. This was live-verified against production
 * before the change: `curl "https://openmusic.lol/song/周傑倫/止戰之殤"` (raw, unencoded) →
 * 200 with `og:title` = `止戰之殤 • 周傑倫`. A path segment is NOT ASCII-limited, and every
 * browser/messenger renders the raw form as-is. The previous `encodeURIComponent(collapsed)`
 * escaped ALL non-ASCII, which is legal but unreadable in a shared link.
 *
 * Only genuinely path-unsafe characters are percent-escaped now, in ONE pass:
 *  - `%`  — would otherwise be read as the start of an escape (this is also why a single pass
 *           is required: the replacement text is never re-scanned, so the `%25` it emits
 *           cannot be double-escaped).
 *  - `/`  — splits the segment.
 *  - `\`  — WHATWG URL parsers NORMALIZE a backslash to `/` in a special-scheme path, so a raw
 *           one splits the segment exactly like `/` does (same failure class).
 *  - `?` / `#` — terminate the path (query / fragment).
 *  - control chars U+0000–U+001F and U+007F — not transmittable in a request line.
 * `&`, `+`, `:`, `;`, `=` are legal path sub-delims and stay literal; `decodeURIComponent`
 * leaves them untouched, so the round-trip is unaffected.
 *
 * THREE guards, all load-bearing:
 *  - EMPTY: an empty segment would make the path `/song/Artist/` → the required `([^/]+?)`
 *    group cannot match → 404. Emit '-' (which decodes back to '').
 *  - WHITESPACE: every `\s+` run collapses to a single '-' (the decoder's inverse).
 *  - DOT-ONLY: the WHATWG URL parser treats `.` / `..` AND their percent-encoded forms
 *    (`%2e`, `%2E%2E`) as dot path segments and normalizes them AWAY before the request
 *    reaches us (verified: both 404). Appending one '-' makes the segment non-dot-only and
 *    the decoder's hyphen→space+trim recovers the original exactly. `.` is deliberately NOT
 *    in the escape set above, so this test still sees literal dots.
 */
export function encodePathSegment(raw: string): string {
	const collapsed = (raw ?? '').trim().replace(/\s+/g, '-');
	if (!collapsed) return '-';
	// quick-260807-vl1: SINGLE pass — see the `%` note above. Control ranges are written as
	// \u escapes rather than raw literals (editor/VCS fragility, the WR-05 discipline).
	const seg = collapsed.replace(/[%\/?#\\\u0000-\u001F\u007F]/gu, (c) => encodeURIComponent(c));
	return /^\.+$/.test(seg) ? `${seg}-` : seg;
}

/**
 * OG-PATH-01 inverse. `seg` is ALREADY decodeURIComponent'd by SvelteKit
 * (decode_params, utils/routing.js) — decoding again throws URIError on a literal '%'
 * (live-verified 500 on the legacy /album/{name} route). Do NOT decode here.
 *
 * KNOWN LOSSY EDGE (accepted, CONTEXT LOCKED): every '-' becomes a space, so a title with
 * a literal hyphen decodes with a space (`Spider-Man` → `Spider Man`). matchKey strips all
 * punctuation AND whitespace, so scoreMatch is EXACTLY insensitive to this (see RESEARCH B.8).
 */
export function decodePathSegment(seg: string): string {
	return (seg ?? '').replace(/-+/g, ' ').trim();
}

/**
 * Encode the current track + a capped queue into a base64url v2 share token.
 * The queue is capped at QUEUE_CAP stubs to bound URL length.
 */
export function encodeShare(current: Track, queue: Track[]): string {
	const payload: SharePayloadV2 = {
		v: 2,
		c: toStub(current),
		q: (queue ?? []).slice(0, QUEUE_CAP).map(toStub)
	};
	return toBase64Url(JSON.stringify(payload));
}

/**
 * Decode a share token to `{ current, queue }`. Accepts BOTH the new v2 payload
 * `{ v:2, c, q }` and a LEGACY v1 token (a bare Stub object — today's encodeTrack output,
 * detected by the absence of `v`/`q` and the presence of `uid`). Legacy → current = the
 * track, queue = [current]. Malformed / oversized / unparseable input → {current:null, queue:[]}
 * (T-gln-01). PURE — no browser/DOM/$state, so a server `load` can import it.
 */
export function decodeShare(token: string): { current: Track | null; queue: Track[] } {
	try {
		const v = JSON.parse(fromBase64Url(token)) as unknown;
		// v2 payload: { v:2, c:Stub, q:Stub[] }
		if (v && typeof v === 'object' && (v as SharePayloadV2).v === 2) {
			const p = v as SharePayloadV2;
			if (!isStub(p.c)) return { current: null, queue: [] };
			const current = stubToTrack(p.c);
			const rawQueue = Array.isArray(p.q) ? p.q : [];
			const queue = rawQueue.slice(0, QUEUE_CAP).filter(isStub).map(stubToTrack);
			return { current, queue: queue.length ? queue : [current] };
		}
		// Legacy v1: a bare Stub (no v/q field).
		if (isStub(v)) {
			const current = stubToTrack(v);
			return { current, queue: [current] };
		}
		return { current: null, queue: [] };
	} catch {
		return { current: null, queue: [] };
	}
}

/** Legacy single-track decode — kept so existing callers don't break. Returns just `current`. */
export function decodeTrack(token: string): Track | null {
	return decodeShare(token).current;
}

/** Legacy single-track encode — kept for callers that only encode one track. */
export function encodeTrack(t: Track): string {
	const b64 = btoa(unescape(encodeURIComponent(JSON.stringify(toStub(t)))));
	return b64.replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

/**
 * Build a share URL carrying the current track + (optional) up-next queue. The visible URL
 * reads `${origin}/?t=<slug>&play=<payload>` — the `t` slug is human-readable; the authoritative
 * decode reads the opaque `play` payload. `origin` is guarded for SSR.
 */
export function shareUrl(current: Track, queue?: Track[]): string {
	const base = typeof location !== 'undefined' ? location.origin : '';
	const slug = slugify(current.title, current.artist);
	const payload = encodeShare(current, queue ?? []);
	const slugSeg = slug ? `t=${encodeURIComponent(slug)}&` : '';
	return `${base}/?${slugSeg}play=${payload}`;
}

/**
 * Build the SHORT, readable SONG share URL `${origin}/song/{artist}/{title}` (DQ-1, OG-PATH-02).
 * This SUPERSEDES the old `entityShareUrl('song', t) + ?play=<token>` song link for the share
 * button: there is NO base64 `?play=` token and NO trailing `{source}{id}` key in the path.
 *
 * ZERO query carriers. The two PATH SEGMENTS are the AUTHORITATIVE human-readable key
 * (OG-PATH-01/02) — they replace the former `?n=`/`?a=` pair. ARTIST FIRST (CONTEXT lock, mirroring
 * Last.fm's `/music/{artist}/_/{track}`). A path segment is NOT ASCII-limited, so CJK needs no
 * special handling: quick-260807-vl1 it now travels RAW on the wire (`/song/周傑倫/止戰之殤`,
 * production-verified 200), instead of the percent-escaped form the old encoder emitted — so the
 * link is readable in the message the recipient actually sees. The OG card is built server-side
 * from the decoded segments (DQ-2) and the page resolves a playable track by name+artist at open
 * time via the existing aggregator (DQ-3).
 *
 * quick-260723-r4p (prose corrected, OG-EP-01): the cover no longer rides a `?c=` carrier — the
 * card image is the own-origin `/api/og` endpoint (see ogImageUrl), which re-resolves the cover
 * server-side. So `cover` has left this signature entirely; a caller has nothing to pass.
 *
 * OG-ZH-01 (RESEARCH §E.17): there is NO zhs→zht conversion at share time on any surface. The
 * LITERAL (original-script) title/artist go in the path, which also removes a pre-existing
 * resolution risk — the recipient's `searchAll` query used to be Traditional while the CN catalog
 * indexes mostly Simplified.
 *
 * The empty-input guard is `encodePathSegment`'s `'-'` (it decodes back to ''), replacing the old
 * `slugify(...) || 's'` placeholder — `'s'` would have decoded to a bogus literal OG title.
 * `origin` is SSR-guarded the same way shareUrl / entityShareUrl read it. `slugify` and the
 * queue-restore encode/decode path are UNTOUCHED — they still depend on the exports below.
 */
export function songShareUrl(t: { title: string; artist: string }): string {
	const base = typeof location !== 'undefined' ? location.origin : '';
	return `${base}/song/${encodePathSegment(t.artist)}/${encodePathSegment(t.title)}`;
}

/**
 * quick-260723-ry1: build a readable ALBUM/ARTIST share URL that mirrors the song card, now
 * carrier-free (OG-PATH-02): `${origin}/album/{artist}/{name}` and `${origin}/artist/{name}`
 * (an artist page has no secondary name, so it stays ONE segment).
 *
 * Unlike entityShareUrl (ASCII slug, drops CJK), the album/artist page's AUTHORITATIVE round-trip
 * key is the LITERAL name — it is what getAlbumTracklist/enrichAlbum/searchAll resolve against. It
 * now lives in the path segments in its ORIGINAL script (OG-PATH-01), which is why the former
 * `?artist=` functional carrier is gone: the artist IS segment 1. quick-260807-vl1: those segments
 * are RAW UTF-8 now (`/album/周傑倫/范特西`), not percent-escaped — same encoder change as the song
 * card, same readability reason.
 *
 * quick-260723-ry1 (prose corrected): the `c` cover carrier is retired in favour of the own-origin
 * `/api/og` card image (OG-EP-01, see ogImageUrl). The `dn`/`da` DISPLAY carriers are retired with
 * it — per OG-ZH-01 / RESEARCH §E.17 nothing converts zhs→zht at share time, so there is no
 * converted display name to carry. Accepted regression: a Traditional-preferring sharer's crawler
 * card shows the catalog's original script. The in-app page is unaffected — it converts per the
 * VIEWER's own setting on hydration via the `names` store, which was always the correct owner of
 * that preference (baking the sharer's language into a public URL decided the card for everyone).
 */
export function entityCardUrl(opts: { type: 'album' | 'artist'; name: string; artist?: string }): string {
	const base = typeof location !== 'undefined' ? location.origin : '';
	if (opts.type === 'artist') return `${base}/artist/${encodePathSegment(opts.name)}`;
	return `${base}/album/${encodePathSegment(opts.artist ?? '')}/${encodePathSegment(opts.name)}`;
}

/** The fixed source enum the readable share path encodes. Because source names are a closed
 *  set, `{source}{id}` is unambiguously separable from the cosmetic slug (D-04 / A7). This list
 *  MUST stay aligned with the live `SourceId` union in $lib/sources/types (24-04 reconcile:
 *  the previous `kugou|migu` anchor was stale — those sources don't exist; the real set is
 *  netease|qq|kuwo|joox|fivesing|jamendo, so fivesing/jamendo entity links now decode). */
// WR-03: anchor on the LAST `-{source}{id}` boundary. The leading `.*` is greedy, so the regex
// consumes as much of the cosmetic slug as possible before backtracking to the final valid
// `-{source}{id}` occurrence — a slug whose text contains an earlier source-name word (e.g.
// `kuwo-mix-qq42`) no longer mis-splits on the earlier token. The `^` + `.*` keeps the match
// rooted so partial mid-string matches can't sneak in.
const ENTITY_SOURCE_RE = /^.*-(netease|qq|kuwo|joox|fivesing|jamendo)([A-Za-z0-9]+)$/;
const ENTITY_SOURCE_ONLY_RE = /^(netease|qq|kuwo|joox|fivesing|jamendo)([A-Za-z0-9]+)$/;

/**
 * Build a readable per-entity share URL `${origin}/{type}/{slug}-{source}{id}` (D-04). The slug
 * is cosmetic (ASCII, may be '' for an all-CJK title — see slugify); the trailing `{source}{id}`
 * is the AUTHORITATIVE decode key. When the slug is empty the leading hyphen is dropped so the
 * path is `/{type}/{source}{id}`. `origin` is guarded for SSR (reused verbatim from shareUrl).
 * Pure apart from the optional `location` read — server-importable.
 */
export function entityShareUrl(
	type: 'song' | 'album' | 'artist',
	t: { title: string; artist: string; source: string; songid: string }
): string {
	const base = typeof location !== 'undefined' ? location.origin : '';
	const slug = slugify(t.title, t.artist);
	const id = `${t.source}${t.songid}`;
	const path = slug ? `${slug}-${id}` : id;
	return `${base}/${type}/${path}`;
}

/**
 * Decode a readable entity path param back to its authoritative `{ source, id, uid }` key (D-04).
 * The cosmetic slug is ignored; only the trailing `{source}{id}` anchored on the fixed source enum
 * is read. Handles both the slug-prefixed form (`qing-fei-de-yi-qq123`) and the empty-slug form
 * (`qq123`). Returns `null` on no-match — mirrors isStub's pure-validator discipline, NEVER throws
 * (T-24-03: this is the validation gate before the param is used downstream). Pure — SSR-safe.
 *
 * WR-02: the visible path key stays the separator-less `{source}{id}` form (authoritative decode
 * unchanged), but the canonical `Track.uid` is the COLON form `${source}:${songid}` (see makeUid in
 * $lib/sources/types). To stop every consumer from hand-joining `source + id` (which would produce
 * `netease7`, NOT the canonical `netease:7`), this returns a ready-made `uid` in the colon form so
 * the decoded identity always agrees with the rest of the codebase's uid convention.
 */
export function parseEntityParam(
	param: string
): { source: string; id: string; uid: string } | null {
	if (typeof param !== 'string' || !param) return null;
	const m = param.match(ENTITY_SOURCE_RE) ?? param.match(ENTITY_SOURCE_ONLY_RE);
	if (!m) return null;
	const source = m[1];
	const id = m[2];
	return { source, id, uid: `${source}:${id}` };
}

/**
 * The closed set of `og:type` values this app emits — one per share surface (OG-PAGE-01):
 * song → `music.song`, album → `music.album`, artist → `profile`. A closed union (never free
 * text) is what keeps the value safe to bind straight into a `<meta content>` (T-gln-02).
 */
export type OgType = 'music.song' | 'music.album' | 'profile';

/**
 * OG-EP-01: build the own-origin card-image URL `${origin}/api/og?type=&artist=&title=`.
 * `title` is the secondary name (song title / album name) and is OMITTED when empty — an
 * artist card has no secondary name.
 *
 * This is a CONSTRUCTED OWN-ORIGIN URL, not a sharer-supplied cover, so it is emitted into the
 * `og:image` meta tag DIRECTLY and is deliberately NOT put through the `isHttpsUrl` carrier gate
 * (that gate exists for the legacy `?c=` carrier, where the URL came from the sharer's client).
 * The T-24-08 posture is preserved one layer down: the crawler fetches `/api/og`, which resolves
 * the cover server-side through the per-tier host allowlist. Pure — no `location` read, so an SSR
 * loader can call it with the request's own origin.
 */
export function ogImageUrl(
	origin: string,
	type: 'song' | 'album' | 'artist',
	artist: string,
	title = ''
): string {
	const t = title ? `&title=${encodeURIComponent(title)}` : '';
	return `${origin}/api/og?type=${type}&artist=${encodeURIComponent(artist)}${t}`;
}

/**
 * Pure OG-card derivation (item 4 / GLN-4). Builds crawler-facing title/description/image from a
 * track-or-entity's display fields. Node-testable; imported by the universal `+page.ts` loads so
 * the values land in the SSR-rendered `<svelte:head>`. The image is only used when it is a usable
 * absolute https URL (T-gln-02: cover URLs constrained, else the caller falls back to /og.svg).
 */
export function buildOg(input: {
	title: string;
	artist?: string;
	album?: string;
	cover?: string | null;
	type?: OgType;
}): { title: string; description: string; image: string | null; type: OgType } {
	// quick-260723-r4p: YouTube-Music-style simplified card. Title is `Song • Artist` (bullet, drops
	// the artist when absent so album/artist entity loaders — which pass no artist and override the
	// description — are unaffected). Description is a short tagline, NOT the old marketing sentence.
	const title = input.artist ? `${input.title} • ${input.artist}` : input.title;
	const description = 'Listen on openmusic';
	const image = isHttpsUrl(input.cover) ? (input.cover as string) : null;
	// OG-PAGE-01: per-surface og:type replaces PageOg's hardcoded `music.song`. Optional with a
	// 'music.song' default so every existing caller keeps compiling while the loaders are converted.
	return { title, description, image, type: input.type ?? 'music.song' };
}

/** True only for an absolute https:// URL (the only cover shape we surface to crawlers). */
export function isHttpsUrl(url: string | null | undefined): boolean {
	return typeof url === 'string' && /^https:\/\/\S+$/.test(url);
}
