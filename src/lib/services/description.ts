// quick-261024-about — client seam for the Now Playing "About" tab: fetch a ytmusic
// track's video description from the own-origin route and split it for rendering.
import { apiFetch } from './api-base';

export type DescriptionResult =
	| { kind: 'ok'; text: string }
	| { kind: 'empty' }
	| { kind: 'error' };

/** Never throws: HTTP 503 (the gate) / a network failure is 'error' (the tab offers a
 *  retry); a 200 with an empty string is 'empty' (a definitive "no description"). */
export async function fetchDescription(videoId: string, signal?: AbortSignal): Promise<DescriptionResult> {
	try {
		const res = await apiFetch('/api/ytmusic/description/' + encodeURIComponent(videoId), { signal });
		if (!res.ok) return { kind: 'error' };
		const data = (await res.json()) as { description?: unknown } | null;
		const text = typeof data?.description === 'string' ? data.description.trim() : '';
		return text ? { kind: 'ok', text } : { kind: 'empty' };
	} catch {
		return { kind: 'error' };
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
