// Local-only library (Svelte 5 runes singleton) — liked songs, playlists, and a
// "downloads" reference list. Persisted to localStorage `openmusic:library:v1`,
// SSR-guarded. This is a demo-scoped slice of the planned Phase-3 Library.
import { browser } from '$app/environment';
import { blobStore } from '$lib/services/blob-store';
import { setCachedCover } from '$lib/services/cover-cache';
import { matchKey } from '$lib/services/match-key';
import type { Track } from '$lib/sources/types';

const KEY = 'openmusic:library:v1';

export interface Playlist {
	id: string;
	name: string;
	tracks: Track[];
}

interface LibShape {
	liked: Track[];
	playlists: Playlist[];
	downloads: Track[];
	/** kmn: favourite artists (names). Optional in storage for non-destructive migration. */
	favArtists?: string[];
}

class Library {
	liked = $state<Track[]>([]);
	playlists = $state<Playlist[]>([]);
	downloads = $state<Track[]>([]);
	/** kmn: favourite artists by canonical name (case-preserving). Used by the home
	 *  fav-artists shelf and the artist-page favourite button. */
	favArtists = $state<string[]>([]);
	/** D-10 (DL-STATE-01): uids with a download IN FLIGHT — the single reactive source of
	 *  truth every download affordance (CompactRow / library / album / TrackMenu) reads for
	 *  its per-song spinner. Deliberately kept OFF the player (D-18 DOWNLOAD ISOLATION) and
	 *  TRANSIENT — never in the persisted payload / LibShape (a corrupt store can't wedge a
	 *  stuck spinner). begin/endDownload reassign a NEW Set (like TrackMenu `inFlight`) so the
	 *  runes graph re-renders; one uid's transition never touches another's. */
	downloading = $state<Set<string>>(new Set());
	private loaded = false;

	/** Hydrate from localStorage once, in the browser. Call from a layout onMount. */
	load() {
		if (this.loaded || !browser) return;
		this.loaded = true;
		try {
			const raw = localStorage.getItem(KEY);
			if (raw) {
				const v = JSON.parse(raw) as Partial<LibShape>;
				this.liked = v.liked ?? [];
				this.playlists = v.playlists ?? [];
				this.downloads = v.downloads ?? [];
				this.favArtists = Array.isArray(v.favArtists) ? v.favArtists : [];
			}
		} catch {
			/* corrupt/unavailable — start empty */
		}
	}

	private save() {
		if (!browser) return;
		try {
			localStorage.setItem(
				KEY,
				JSON.stringify({
					liked: this.liked,
					playlists: this.playlists,
					downloads: this.downloads,
					favArtists: this.favArtists
				})
			);
		} catch {
			/* quota — non-fatal */
		}
	}

	isLiked(uid: string): boolean {
		return this.liked.some((t) => t.uid === uid);
	}
	toggleLike(t: Track) {
		this.liked = this.isLiked(t.uid) ? this.liked.filter((x) => x.uid !== t.uid) : [t, ...this.liked];
		this.save();
	}

	/**
	 * Cover-chain: share a freshly-fetched cover with every same-song entry.
	 * The player calls this after a resolve lands a cover. Fills the cover on all
	 * liked / playlist / download entries matching the track's uid OR its normalized
	 * {artist,title} identity (matchKey — same song stored under another source uid),
	 * then stows it in the cover-cache so cover-less tiles on other surfaces can read
	 * it back synchronously. Only EMPTY covers are filled — an entry already showing
	 * art is never churned (no way to tell a "better" URL from a different one).
	 */
	adoptCover(src: Track) {
		const cover = src.cover;
		if (!cover) return;
		const key = matchKey(src.artist, src.title);
		const same = (t: Track) => t.uid === src.uid || matchKey(t.artist, t.title) === key;
		// Mutate the $state proxies IN PLACE (not {...t, cover} rebuilds): home shelves
		// (likedShelf/downloadsShelf) hold snapshot copies of these references, so an
		// immutable rebuild would update the store but leave already-rendered tiles
		// stale until reload. Fine-grained proxy mutation reaches every copy live.
		let changed = false;
		const fill = (t: Track) => {
			if (!t.cover && same(t)) {
				t.cover = cover;
				changed = true;
			}
		};
		this.liked.forEach(fill);
		this.downloads.forEach(fill);
		this.playlists.forEach((p) => p.tracks.forEach(fill));
		if (changed) this.save();
		setCachedCover(src.artist, src.title, cover);
	}

	createPlaylist(name: string): Playlist {
		const id = `pl_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}`;
		const pl: Playlist = { id, name: name.trim() || 'Untitled', tracks: [] };
		this.playlists = [...this.playlists, pl];
		this.save();
		return pl;
	}
	addToPlaylist(id: string, t: Track) {
		this.playlists = this.playlists.map((p) =>
			p.id === id && !p.tracks.some((x) => x.uid === t.uid) ? { ...p, tracks: [...p.tracks, t] } : p
		);
		this.save();
	}
	removeFromPlaylist(id: string, uid: string) {
		this.playlists = this.playlists.map((p) =>
			p.id === id ? { ...p, tracks: p.tracks.filter((x) => x.uid !== uid) } : p
		);
		this.save();
	}
	deletePlaylist(id: string) {
		this.playlists = this.playlists.filter((p) => p.id !== id);
		this.save();
	}

	// ---- favArtists (kmn) -----------------------------------------------------------------
	/** Case-preserving compare key. Match on a trimmed-lowercase fold so "Daft Punk" /
	 *  "daft punk" / "  Daft Punk  " collapse to one entry. */
	private favKey(name: string): string {
		return (name ?? '').trim().toLowerCase();
	}
	isFavArtist(name: string): boolean {
		const k = this.favKey(name);
		if (!k) return false;
		return this.favArtists.some((n) => this.favKey(n) === k);
	}
	toggleFavArtist(name: string) {
		const clean = (name ?? '').trim();
		if (!clean) return;
		const k = this.favKey(clean);
		this.favArtists = this.isFavArtist(clean)
			? this.favArtists.filter((n) => this.favKey(n) !== k)
			: [clean, ...this.favArtists];
		this.save();
	}

	// ---- downloading (D-10, transient per-uid in-flight state) -----------------------------
	/** Mark a uid as mid-download. Reassign a NEW Set so runes re-render (parity with
	 *  TrackMenu `inFlight`); NOT persisted (transient runtime state). */
	beginDownload(uid: string) {
		this.downloading = new Set(this.downloading).add(uid);
	}
	/** Clear a uid's in-flight flag. Copy → delete → reassign; absent uid is a no-op. Never
	 *  touches another uid's state (isolation) and never persists. */
	endDownload(uid: string) {
		const next = new Set(this.downloading);
		next.delete(uid);
		this.downloading = next;
	}

	isDownloaded(uid: string): boolean {
		return this.downloads.some((t) => t.uid === uid);
	}
	addDownload(t: Track) {
		if (!this.isDownloaded(t.uid)) {
			this.downloads = [t, ...this.downloads];
			this.save();
		}
	}
	removeDownload(uid: string) {
		this.downloads = this.downloads.filter((t) => t.uid !== uid);
		this.save();
		// kyf: also drop the cached blob so the offline cache stays consistent with the
		// registry (never throws — browser/SSR + IDB-missing return no-op).
		void blobStore.del(uid);
	}

	clearAll() {
		this.liked = [];
		this.playlists = [];
		this.downloads = [];
		this.favArtists = [];
		this.save();
	}
}

export const library = new Library();
