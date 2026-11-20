// quick-260926-hze — lock the Chinese script of a same-app entity href (/artist, /album, /song).
//
// The model: the URL shows the locked script and is the resolution key; every resolver is
// script-tolerant (searchAll, Last.fm artist, Deezer, MusicBrainz / Deezer ids are script-blind,
// and getAlbumTracklist rescues the one script-sensitive key, the Last.fm album TITLE). So an
// in-app builder can emit the locked form directly and a reload of it still resolves.
//
// PURE and import-free: the lock is INJECTED (names.lockUrl passes zhLock), so node tests drive
// it with a fake and this module never reaches a runes store.
//
// Only the `artist` query param is locked: it is the one name-bearing param on these routes
// (/album/{title}?artist=…). Everything else (dzid, mbid, tab, the /song n/a share carriers) is an
// id or a control value and passes through as written.
//
// Surgery is by hand (indexOf/slice), NOT the URL parser: URL re-encodes raw CJK and normalises
// dot segments, while an unchanged segment must survive byte-for-byte (raw-CJK share paths, the
// '-'-as-space share grammar, the literal 'albums' segment).

const ENTITY = /^\/(artist|album|song)\//;

/**
 * `href` with every name segment after the route word, plus the `artist` query param, run
 * through `lock`. Returns `href` ITSELF when nothing changed, so an identity lock ('off') is a
 * strict no-op. Anything that is not an anchored same-app entity path ('//host/…', absolute
 * URLs, /library, /search) is returned untouched (T-hze-01). One try/catch covers a malformed
 * %-sequence and a throwing lock: a bad URL can never throw into afterNavigate or a click
 * handler (T-hze-02).
 */
export function lockEntityHref(href: string, lock: (s: string) => string): string {
	if (!ENTITY.test(href)) return href;
	try {
		let changed = false;
		const hashAt = href.indexOf('#');
		const hash = hashAt === -1 ? '' : href.slice(hashAt);
		const beforeHash = hashAt === -1 ? href : href.slice(0, hashAt);
		const queryAt = beforeHash.indexOf('?');
		const path = queryAt === -1 ? beforeHash : beforeHash.slice(0, queryAt);
		let query = queryAt === -1 ? '' : beforeHash.slice(queryAt + 1);

		// ['', 'artist', '<name>', …] — index >= 2 are the name-bearing segments.
		const segs = path.split('/').map((seg, i) => {
			if (i < 2) return seg;
			const text = decodeURIComponent(seg);
			const locked = lock(text);
			if (locked === text) return seg; // keep the ORIGINAL raw text
			changed = true;
			return encodeURIComponent(locked);
		});

		if (queryAt !== -1) {
			const params = new URLSearchParams(query);
			const artist = params.get('artist');
			if (artist !== null) {
				const locked = lock(artist);
				if (locked !== artist) {
					params.set('artist', locked); // set() keeps the param's position
					query = params.toString();
					changed = true;
				}
			}
		}

		if (!changed) return href;
		return segs.join('/') + (queryAt === -1 ? '' : '?' + query) + hash;
	} catch {
		return href;
	}
}
