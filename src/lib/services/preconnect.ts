// preconnect — warm the DNS + TCP + TLS handshake to a source's audio CDN BEFORE its url arrives.
//
// MEASURED (2026-09-12), same Range request `<audio>` issues, against the real QQ CDN:
//
//     cold connection   TTFB 0.526s   (conn 0.218 + tls 0.430)
//     reused connection TTFB 0.090s   (conn 0        tls 0)
//
// ~83% of time-to-first-byte is HANDSHAKE; the server itself answers in ~90ms. On device the same
// step costs 1,791–2,904 ms, and it clusters there regardless of source or tier — so most of that
// is handshake at the phone's RTT, not transfer and not file size (a lossless and an m4a url have
// identical TTFB: `Range` is `Range`).
//
// WHY IT COSTS NOTHING: `<link rel="preconnect">` opens a SOCKET. It issues no request, downloads no
// bytes, and needs no prediction about which song the user wants — by the time we call it they have
// already tapped. It simply overlaps work we were going to do serially.
//
// WHY *DURING* THE RESOLVE: `play()` knows the track's SOURCE immediately but waits ~2.7s for the
// upstream detail call to hand back a url. That window is dead time in which the CDN host is already
// known. Preconnecting at app boot instead would be useless — browsers drop idle preconnected
// sockets within ~10s, long before a tap.
//
// SELF-LEARNING host map: every resolved audio url teaches us its origin for that source, so there
// is no hardcoded table to rot when a CDN renames a shard (qq currently answers from
// `isure6.stream.qqmusic.qq.com` — the digit is exactly the kind of thing that changes). Seeds cover
// the very first play of a session, before anything has been observed.
import { browser } from '$app/environment';
import type { SourceId } from '$lib/sources/types';

/**
 * Known audio origins, used only until a real resolve teaches us otherwise. Verified by probing the
 * live proxy; three different qq tracks all resolved to the same shard.
 *
 * Sources absent from this map simply get no preconnect until one is observed — a miss is a no-op,
 * never an error. netease is deliberately ABSENT: its audio streams through our own worker
 * (`/api/netease/url`), so that connection is already open from loading the page.
 */
const SEEDS: Partial<Record<SourceId, string>> = {
	qq: 'https://isure6.stream.qqmusic.qq.com'
};

/** source → last observed audio origin. Seeded, then corrected by observation. */
const hosts = new Map<SourceId, string>(Object.entries(SEEDS) as [SourceId, string][]);

/** Origins already preconnected this page-load — the <link> is idempotent, so never add it twice. */
const linked = new Set<string>();

/** Parse the origin out of an absolute url; null for a relative one (our own proxy — already warm). */
function originOf(url: string | null | undefined): string | null {
	if (!url || !/^https?:\/\//i.test(url)) return null;
	try {
		return new URL(url).origin;
	} catch {
		return null;
	}
}

/**
 * Teach the map which origin a source actually serves audio from. Call with a RESOLVED audioUrl.
 * A relative url (our proxy) is ignored — that connection is already established.
 */
export function noteAudioOrigin(source: SourceId, audioUrl: string | null | undefined): void {
	const origin = originOf(audioUrl);
	if (origin) hosts.set(source, origin);
}

/**
 * Open a connection to `source`'s audio CDN if we know it. Idempotent per origin, browser-only,
 * never throws — a failed preconnect must never affect playback, it is a pure optimisation.
 */
export function preconnectForSource(source: SourceId): void {
	if (!browser) return;
	const origin = hosts.get(source);
	if (!origin || linked.has(origin)) return;
	linked.add(origin); // mark FIRST so a throw below cannot cause a retry loop
	try {
		const link = document.createElement('link');
		link.rel = 'preconnect';
		link.href = origin;
		// The audio request is not credentialed, so the anonymous socket is the one <audio> reuses.
		link.crossOrigin = 'anonymous';
		document.head.appendChild(link);
	} catch {
		/* head missing / CSP — a preconnect is best-effort by definition */
	}
}

/** TEST-ONLY: reset both maps so state cannot leak across tests. */
export function __resetPreconnect(): void {
	hosts.clear();
	for (const [k, v] of Object.entries(SEEDS)) hosts.set(k as SourceId, v);
	linked.clear();
}
