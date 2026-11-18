// quick-261118-free: pure helpers behind the /free showcase page + the Home "Free forever" band.
//
// Kept store-free (no runes) so the node-only Vitest project can drive them — the page and the
// home band are thin callers.

/** The Dawn Studio gateway — the one address that always lists OpenMusic's CURRENT home. The /free
 *  page tells people to bookmark THIS, not the app's own domain (domains can be lost; the gateway
 *  is the survival link). */
export const DAWN_GATEWAY_URL = 'https://dawnstudio.app';

/** The public source repository (same literal as Settings → About's REPO). */
export const OPENMUSIC_REPO_URL = 'https://github.com/hectorchanht/openmusic';

/**
 * WhatsApp share link with prefilled text. `wa.me/?text=` is WhatsApp's documented universal
 * share URL: it opens the app on phones (choose a chat / group) and WhatsApp Web on desktop.
 * WhatsApp ONLY on purpose — the audience is friends in group chats, so /free carries no
 * public-social buttons (Hector, 2026-11-18 brief).
 */
export function whatsappShareUrl(text: string): string {
	return 'https://wa.me/?text=' + encodeURIComponent(text);
}

/**
 * The id of the FIRST home section that will actually paint a shelf — the Home "Free forever"
 * band is placed right after it (Hector via Muse: after the first content shelf, never above it,
 * never at the very top). `order` is the RESOLVED section order; a section counts only when it is
 * not hidden, has content (`count > 0`) and is inside the progressive-mount budget (`budget > 0`).
 * Returns null when nothing renders yet (cold load / error) — no band then, so it can never sit
 * above the first shelf.
 */
export function firstShelfId<T extends string>(
	order: readonly T[],
	hidden: readonly string[],
	count: (id: T) => number,
	budget: Partial<Record<T, number>>
): T | null {
	for (const id of order) {
		if (hidden.includes(id)) continue;
		if ((budget[id] ?? 0) > 0 && count(id) > 0) return id;
	}
	return null;
}
