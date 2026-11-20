// JBSou fallback resolve — the client seam for the /api/jbsou/resolve edge pipe (quick-261101-jbs).
//
// Called ONLY from inside netease/qq resolve, ONLY after the adapter's own chain produced no
// playable URL (netease: the direct stream-url hop came back null in a qijieya dry spell;
// qq: a detail body with every play tier empty — the VIP/region-lock shape). The edge does
// the cookie + search + strict-match + redirect walk and answers with ONE final CDN URL;
// this helper's whole job is the health gate around that call plus the never-throw contract
// the adapters' fallback positions require: null means "no rescue — behave exactly as before".
import { apiFetch } from './api-base';
import { jbsouHealth } from './jbsou-health';
import type { Track } from '$lib/sources/types';

/** The two catalogs JBSou aggregates that this pipe can rescue. */
export type JbsouSource = 'netease' | 'qq';

export async function fetchJbsouStreamUrl(
	source: JbsouSource,
	track: Track,
	signal: AbortSignal
): Promise<string | null> {
	if (!track.title) return null;
	// Gated pipe: skip the call entirely for the window (jbsou-health) — the caller falls
	// back to its pre-JBSou behaviour, so a dead JBSou costs nothing while it is down.
	if (jbsouHealth.isGated()) return null;
	try {
		const path =
			`/api/jbsou/resolve?type=${source}` +
			`&id=${encodeURIComponent(track.songid || '')}` +
			`&title=${encodeURIComponent(track.title)}` +
			`&artist=${encodeURIComponent(track.artist || '')}`;
		const res = await apiFetch(path, { signal });
		if (!res.ok) {
			// The route's 503 = the upstream chain failed (a PIPE failure). A caller abort is
			// supersedence, not evidence — never counted (the joox-health idiom).
			if (!signal.aborted) jbsouHealth.recordFail();
			return null;
		}
		const body: unknown = await res.json().catch(() => undefined);
		if (!body || typeof body !== 'object' || !('url' in body)) {
			if (!signal.aborted) jbsouHealth.recordFail();
			return null;
		}
		const url = (body as { url?: unknown }).url;
		if (typeof url === 'string' && url.startsWith('https://')) {
			jbsouHealth.recordOk();
			return url;
		}
		if (url === null) {
			// Clean no-match: the pipe is ALIVE, the song is not in its rows (jbsou-health).
			jbsouHealth.recordOk();
			return null;
		}
		if (!signal.aborted) jbsouHealth.recordFail();
		return null;
	} catch {
		if (!signal.aborted) jbsouHealth.recordFail();
		return null;
	}
}
