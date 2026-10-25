// quick-261024-vid1 — which ytmusic tracks are KNOWN to have (or not have) a watchable MV.
//
// Rows tag every ytmusic track "MV" optimistically (nearly all YTM uploads are videos; a
// resolve per row is out of the question). The first time the Now Playing video layer gets
// a definitive answer for a videoId it is remembered here: a success keeps the tag, a 404
// ("no avc format") drops the tag everywhere, permanently, so the tag never lies twice.
// Persisted in localStorage; keyed by videoId (== a ytmusic track's songid).
const KEY = 'om-video-known-v1';

function load(): Record<string, boolean> {
	try {
		const raw = localStorage.getItem(KEY);
		const parsed = raw ? (JSON.parse(raw) as unknown) : {};
		return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? (parsed as Record<string, boolean>) : {};
	} catch {
		return {};
	}
}

let known = $state<Record<string, boolean>>(load());

export const videoAvailability = {
	/** Show the MV row tag? Unknown counts as yes (optimistic); a recorded 404 is a no. */
	showsTag(videoId: string | undefined | null): boolean {
		return !!videoId && known[videoId] !== false;
	},
	/** Record the video layer's verdict for a videoId (true = has picture, false = none). */
	mark(videoId: string, hasVideo: boolean): void {
		if (!videoId || known[videoId] === hasVideo) return;
		known = { ...known, [videoId]: hasVideo };
		try {
			localStorage.setItem(KEY, JSON.stringify(known));
		} catch {
			// storage full/blocked — the in-memory map still serves this session
		}
	}
};
