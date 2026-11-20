// download-versions — every download record held for ONE song (quick-261119-dldelete).
//
// A song can sit in `library.downloads` under MORE THAN ONE uid: the same recording fetched
// from another source, or another rendition (live / acoustic) the user also saved. The identity
// here is deliberately the SONG (dedupe's `songKey` / `sameSongStrings` — the title bucket the
// library's own songIndex keys on), NOT the rendition-exact `isSameShelfSong`: managing the
// copies of a song is exactly the surface that must see them all side by side, so the user can
// delete one version or every version. Rendition-exactness stays with playback
// (`downloadUidFor`), which must never play a live cut in place of the studio file.
//
// Device imports are NOT versions: a `device:` record is the user's own file, protected by
// blobStore.del's device refusal and removed only through its own no-import lane — the same
// exclusion `downloadUidFor` already applies to its twin walk.
//
// Pure + node-testable: the caller passes the downloads list in (the library store wraps this
// as `downloadVersionsFor`), so no store import lives here.
import { songKey, sameSongStrings } from './dedupe';
import { isDeviceUid } from './device-track';
import type { Track } from '$lib/sources/types';

/**
 * All app-download records for the same song as `track`: the exact-uid record FIRST (the copy
 * the tapped control is showing), then every other record whose song identity matches, in
 * library order. Empty when the track is null or nothing is downloaded.
 */
export function downloadVersionsOf(downloads: Track[], track: Track | null | undefined): Track[] {
	if (!track) return [];
	const out: Track[] = [];
	const exact = downloads.find((d) => d.uid === track.uid);
	if (exact && !isDeviceUid(exact.uid)) out.push(exact);
	const k = songKey(track.artist, track.title);
	if (!k.slice(0, k.indexOf('|'))) return out;
	for (const d of downloads) {
		if (d.uid === track.uid || isDeviceUid(d.uid)) continue;
		if (songKey(d.artist, d.title) === k || sameSongStrings(track.artist, track.title, d.artist, d.title)) {
			out.push(d);
		}
	}
	return out;
}
