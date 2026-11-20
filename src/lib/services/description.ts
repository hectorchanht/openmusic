// quick-261024-about — client seam for the Now Playing "About" tab: fetch a ytmusic
// track's video description from the own-origin route and split it for rendering.
import { apiFetch } from './api-base';

export type DescriptionResult =
	| { kind: 'ok'; text: string }
	| { kind: 'empty' }
	/** detail (quick-261024-about3): HTTP status + the gate header when the edge sent
	 *  them, or the thrown error's name — the tab shows it in small print so a failure
	 *  screenshot says WHICH failure it was (gate vs network vs CORS). */
	| { kind: 'error'; detail?: string };

/** Never throws: HTTP 503 (the gate) / a network failure is 'error' (the tab offers a
 *  retry); a 200 with an empty string is 'empty' (a definitive "no description"). */
const TIMEOUT_MS = 15_000;

export async function fetchDescription(videoId: string, signal?: AbortSignal): Promise<DescriptionResult> {
	try {
		// quick-261024-load1: a hung request must not leave the tab on its loading state
		// forever (Hector hit exactly that) — compose the caller's signal with a 15s
		// timeout where the platform supports it; older WebViews simply keep the caller's.
		const own = typeof AbortSignal !== 'undefined' && typeof AbortSignal.timeout === 'function' ? AbortSignal.timeout(TIMEOUT_MS) : undefined;
		const sig = signal && own && typeof AbortSignal.any === 'function' ? AbortSignal.any([signal, own]) : (signal ?? own);
		const res = await apiFetch('/api/ytmusic/description/' + encodeURIComponent(videoId), { signal: sig });
		if (!res.ok) {
			const gate = res.headers.get('x-ytmusic-playability');
			return { kind: 'error', detail: `http ${res.status}${gate ? ' · ' + gate : ''}` };
		}
		const data = (await res.json()) as { description?: unknown } | null;
		const text = typeof data?.description === 'string' ? data.description.trim() : '';
		return text ? { kind: 'ok', text } : { kind: 'empty' };
	} catch (e) {
		const name = e instanceof Error ? e.name : '';
		return { kind: 'error', detail: name === 'TimeoutError' ? 'timeout 15s' : name || 'network' };
	}
}

export type DescSegment = { t: 'text'; s: string } | { t: 'link'; s: string; href: string };

const URL_RE = /https?:\/\/[^\s<>"'\]]+/g;
const TRAILING_PUNCT = /[.,;:!?)]+$/;

/**
 * Split description prose into text/link segments for rendering. A URL's trailing
 * sentence punctuation stays text (descriptions end links with 。 or ) often enough).
 * Pure — the component renders the segments verbatim inside a pre-wrap block.
 */
export function splitDescription(text: string): DescSegment[] {
	const out: DescSegment[] = [];
	let last = 0;
	for (const m of text.matchAll(URL_RE)) {
		const raw = m[0];
		const punct = TRAILING_PUNCT.exec(raw)?.[0] ?? '';
		const href = punct ? raw.slice(0, -punct.length) : raw;
		if (m.index > last) out.push({ t: 'text', s: text.slice(last, m.index) });
		out.push({ t: 'link', s: href, href });
		if (punct) out.push({ t: 'text', s: punct });
		last = m.index + raw.length;
	}
	if (last < text.length) out.push({ t: 'text', s: text.slice(last) });
	return out;
}
