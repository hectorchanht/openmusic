// lastfm-image — pick the best usable artwork URL out of a Last.fm `image[]` array.
//
// Deduped from byte-identical copies in /api/lastfm/info and /api/lastfm/discovery, which also each
// carried their own GREY_STAR_HASH and SIZE_RANK constants.
//
// NOT deduped into here: /api/lastfm/similar-tracks has a `pickImage` that LOOKS like a third copy
// but is genuinely different — it returns `undefined` rather than `null`, iterates a size-preference
// order instead of ranking, and, importantly, validates with only an https-prefix + placeholder test
// INSTEAD OF `safeImageUrl`. So that route emits Last.fm image URLs without the host allowlist its
// two siblings enforce. Folding it in here would have silently changed what that endpoint accepts,
// which is not a refactor's call to make; it is flagged for a deliberate decision instead.
import { safeImageUrl, LASTFM_IMAGE_HOSTS } from './safe-image-url';

/** Last.fm's grey-star placeholder. Served as a real image, so it has to be excluded by hash. */
export const GREY_STAR_HASH = '2a96cbd8b46e442fc41c2b86b821562f';

/** Last.fm's size labels, worst → best. Unknown/absent labels rank 0 and lose to any labelled size. */
const SIZE_RANK: Record<string, number> = {
	small: 1,
	medium: 2,
	large: 3,
	extralarge: 4,
	mega: 5
};

export interface LfmImage {
	'#text'?: string;
	size?: string;
}

/**
 * The largest allow-listed, non-placeholder image URL, or `null`.
 *
 * `rank >= best.rank` (not `>`) is deliberate and preserved from the originals: on a tie the LATER
 * entry wins, because Last.fm orders its array small → large and the last of an equal pair is the
 * one it considers canonical.
 */
export function pickLastfmImage(images?: LfmImage[]): string | null {
	if (!Array.isArray(images)) return null;
	let best: { url: string; rank: number } | null = null;
	for (const img of images) {
		const raw = img?.['#text']?.trim();
		if (!raw) continue;
		if (raw.includes(GREY_STAR_HASH)) continue; // ENRICH-02: never the placeholder
		const url = safeImageUrl(raw, LASTFM_IMAGE_HOSTS); // CR-01: reject CSS-injection / off-domain
		if (!url) continue;
		const rank = SIZE_RANK[(img.size ?? '').toLowerCase()] ?? 0;
		if (!best || rank >= best.rank) best = { url, rank };
	}
	return best ? best.url : null;
}
