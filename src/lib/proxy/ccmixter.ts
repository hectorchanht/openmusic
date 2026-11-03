// CCMixter upstream helpers (quick-261101-ccm) — PURE parsers/validators for the
// ccMixter query API, shared by the two edge routes (search + stream).
//
// Upstream facts (live-probed 2026-11-01 from the VM, see
// ~/workspace/openmusic-musicdl-probe/REPORT.md):
//   - Search: GET ccmixter.org/api/query?f=xspf&t=search_uploads&search_type=any
//     &search=<kw>&limit=&offset= → XSPF playlist. Per track: <location> (the
//     canonical primary MP3 under ccmixter.org/content/…), <identifier> (numeric
//     upload id), <title>, <creator> (artist display name), <image> (artist
//     avatar — used as cover, the cover-heal chain upgrades it when it can).
//   - XSPF <duration> is NOT a duration: it equals the file size in BYTES
//     (verified against dataview file_rawsize). It is never surfaced as a
//     duration anywhere in this pipe.
//   - XSPF by id: GET …/api/query?f=xspf&ids=<uploadId> returns that upload's
//     single-track playlist — the stream route's way to re-derive the media URL
//     from the id alone (never caller-supplied → not an open proxy), which also
//     picks the PRIMARY rendition when an upload carries several mp3 files.
//   - Media requires `Referer: https://ccmixter.org/` (no/foreign Referer →
//     403), which is why playback goes through the stream route at all.

export interface CcmixterRow {
	id: string;
	title: string;
	artist: string;
	cover: string | null;
}

/** The one media-URL shape this pipe will ever fetch or hand out. */
export function isCcmixterMediaUrl(u: string): boolean {
	let parsed: URL;
	try {
		parsed = new URL(u);
	} catch {
		return false;
	}
	return (
		parsed.protocol === 'https:' &&
		parsed.hostname === 'ccmixter.org' &&
		parsed.pathname.startsWith('/content/') &&
		parsed.pathname.toLowerCase().endsWith('.mp3')
	);
}

const XML_ENTITIES: Record<string, string> = {
	amp: '&',
	lt: '<',
	gt: '>',
	quot: '"',
	apos: "'"
};

/** Minimal XML entity decode for XSPF text nodes (named + numeric refs). */
export function decodeXmlEntities(s: string): string {
	return s.replace(/&(#x?[0-9a-fA-F]+|[a-zA-Z]+);/g, (whole, body: string) => {
		if (body.startsWith('#')) {
			const code = body[1] === 'x' || body[1] === 'X'
				? parseInt(body.slice(2), 16)
				: parseInt(body.slice(1), 10);
			return Number.isFinite(code) && code > 0 ? String.fromCodePoint(code) : whole;
		}
		return XML_ENTITIES[body] ?? whole;
	});
}

function tagText(block: string, tag: string): string | null {
	const m = new RegExp(`<${tag}>([\\s\\S]*?)</${tag}>`).exec(block);
	if (!m) return null;
	const text = decodeXmlEntities(m[1]).trim();
	return text || null;
}

interface RawTrack {
	location: string | null;
	identifier: string | null;
	title: string | null;
	creator: string | null;
	image: string | null;
}

function parseTrackBlock(block: string): RawTrack {
	return {
		location: tagText(block, 'location'),
		identifier: tagText(block, 'identifier'),
		title: tagText(block, 'title'),
		creator: tagText(block, 'creator'),
		image: tagText(block, 'image')
	};
}

function trackBlocks(xml: string): string[] {
	return [...xml.matchAll(/<track>([\s\S]*?)<\/track>/g)].map((m) => m[1]);
}

/**
 * Parse a search XSPF body into adapter rows. A row survives only with a
 * numeric upload id, a title, and a media URL that passes isCcmixterMediaUrl
 * (a drifted/poisoned location must never reach the client or the stream
 * route). Cover = the XSPF <image> when it is an https URL (it is the artist
 * avatar — placeholder-grade art the cover-heal chain can upgrade), else null.
 */
export function parseCcmixterSearch(xml: string): CcmixterRow[] {
	const rows: CcmixterRow[] = [];
	for (const block of trackBlocks(xml)) {
		const t = parseTrackBlock(block);
		if (!t.identifier || !/^\d+$/.test(t.identifier)) continue;
		if (!t.title || !t.location || !isCcmixterMediaUrl(t.location)) continue;
		rows.push({
			id: t.identifier,
			title: t.title,
			artist: t.creator ?? '',
			cover: t.image && t.image.startsWith('https://') ? t.image : null
		});
	}
	return rows;
}

/**
 * The canonical media URL for ONE upload, from its by-id XSPF body — the
 * stream route's resolve step. Null when the body carries no usable track
 * (unknown id, drift, non-media location).
 */
export function parseCcmixterLocation(xml: string): string | null {
	for (const block of trackBlocks(xml)) {
		const t = parseTrackBlock(block);
		if (t.location && isCcmixterMediaUrl(t.location)) return t.location;
	}
	return null;
}
