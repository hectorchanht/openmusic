// Local-only library (Svelte 5 runes singleton) — liked songs, playlists, and a
// "downloads" reference list. Persisted to localStorage `openmusic:library:v1`,
// SSR-guarded. This is a demo-scoped slice of the planned Phase-3 Library.
import { browser } from '$app/environment';
import { blobStore } from '$lib/services/blob-store';
import { setCachedCover } from '$lib/services/cover-cache';
import { hasHttpsScheme } from '$lib/services/url-safety';
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
	/** 34-D-06: device: entries whose file was missing at last play. PERSISTED (unlike downloading/
	 *  downloadProgress) because a missing file is still missing after a relaunch and the badge must
	 *  not lie until the user taps it again. Optional in storage for non-destructive migration. */
	unavailable?: string[];
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
	/** 34-D-06: uids whose bytes could not be read at last play. SET by the player's two device seams
	 *  — the offline-miss branch (blobStore.get returned nothing) and the corrupt-blob branch — and by
	 *  nothing else. CLEARED by the next explicit import (setDownloads prunes it / clearUnavailable),
	 *  or by removing the entry outright. READ by RowBadges / DownloadControl through isUnavailable()
	 *  (UI-SPEC Contract 8) to swap the downloaded tick for the alert glyph. Unlike `downloading` above
	 *  this IS persisted (see LibShape) — a file the OS lost is still lost after a relaunch. Reassigned
	 *  copy-on-write (the beginDownload idiom) so the runes graph re-renders. */
	unavailable = $state<Set<string>>(new Set());
	/** quick-260913-omi: 0..1 progress per IN-FLIGHT uid, for the Download row's bar. Same posture
	 *  as `downloading` above — transient, never in LibShape, never persisted — and deliberately a
	 *  SEPARATE map rather than a richer `downloading` value: an absent entry means INDETERMINATE
	 *  (no Content-Length), which is a real state the UI renders differently (spinner, not 0%), and
	 *  folding it into the busy set would force every existing `downloading.has(uid)` reader to care. */
	downloadProgress = $state<Record<string, number>>({});
	private loaded = false;

	/** Hydrate from localStorage once, in the browser. Call from a layout onMount. */
	load() {
		if (this.loaded || !browser) return;
		this.loaded = true;
		try {
			const raw = localStorage.getItem(KEY);
			if (raw) {
				const v = JSON.parse(raw) as Partial<LibShape>;
				// like-state-wrong-track-menu: self-heal a store already poisoned by a uid-less like
				// (see isLiked) — the entry can never match anything and would still render a row.
				this.liked = (v.liked ?? []).filter((t) => !!t?.uid);
				this.playlists = v.playlists ?? [];
				this.downloads = v.downloads ?? [];
				this.favArtists = Array.isArray(v.favArtists) ? v.favArtists : [];
				this.unavailable = new Set(Array.isArray(v.unavailable) ? v.unavailable : []);
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
					favArtists: this.favArtists,
					unavailable: [...this.unavailable]
				})
			);
		} catch {
			/* quota — non-fatal */
		}
	}

	/** like-state-wrong-track-menu: a uid-less Track has NO identity — home/charts open TrackMenu on a
	 *  name-stub (`uid: ''`) while the real Track resolves, and the Like row is tappable on it (D-01).
	 *  Before this guard ONE such tap persisted `{uid:''}` and every later stub read `isLiked('')` as
	 *  true ("Liked" on songs never liked). RowBadges had patched this at its own call site only;
	 *  the guard belongs here, where every caller converges. */
	isLiked(uid: string): boolean {
		return !!uid && this.liked.some((t) => t.uid === uid);
	}
	toggleLike(t: Track) {
		if (!t.uid) return; // like-state-wrong-track-menu: nothing to key on — refuse, never poison the list
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
		// media-card-shows-app-icon: the shared name-layer cache is https-only everywhere else
		// (T-0bb-01 — writeCoverBoth / resolveCoverForTrack). This was the ONE ungated writer, so an
		// http source cover poisoned the cache and re-seeded player.resolvedCover on every replay.
		if (hasHttpsScheme(cover)) setCachedCover(src.artist, src.title, cover);
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
		// quick-260913-omi: drop any residue from a previous attempt so a retry starts indeterminate
		// rather than resuming the failed run's bar at 60%.
		if (uid in this.downloadProgress) this.clearDownloadProgress(uid);
	}
	/** Clear a uid's in-flight flag. Copy → delete → reassign; absent uid is a no-op. Never
	 *  touches another uid's state (isolation) and never persists. */
	endDownload(uid: string) {
		const next = new Set(this.downloading);
		next.delete(uid);
		this.downloading = next;
		// quick-260913-omi: endDownload runs in downloadTrack's `finally`, so EVERY exit path — saved,
		// no-audio, failed, throw — leaves no progress residue behind.
		this.clearDownloadProgress(uid);
	}
	/** quick-260913-omi: record a uid's 0..1 download progress. Copy-on-write reassign (the
	 *  `downloading` idiom) — cheap because readBlobWithProgress only calls this once per whole
	 *  percent. Ignores a uid that is not in flight, so a late callback from a superseded run
	 *  cannot resurrect a bar on a finished row. */
	setDownloadProgress(uid: string, fraction: number) {
		if (!this.downloading.has(uid)) return;
		this.downloadProgress = { ...this.downloadProgress, [uid]: fraction };
	}
	private clearDownloadProgress(uid: string) {
		if (!(uid in this.downloadProgress)) return;
		const { [uid]: _dropped, ...rest } = this.downloadProgress;
		this.downloadProgress = rest;
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
	/**
	 * 34-D-06 NOTE: this method is the EXPLICIT removal path (library/+page.svelte:162 edit-mode swipe
	 * + the import's own drop lane via setDownloads). It is deliberately NOT guarded for device uids —
	 * the user may remove an imported entry on purpose; the file itself is protected by blobStore.del's
	 * device refusal (Plan 34-01), and the player's SILENT eviction site is guarded in player.svelte.ts
	 * instead.
	 */
	removeDownload(uid: string) {
		this.downloads = this.downloads.filter((t) => t.uid !== uid);
		// The row is gone, so its unavailable mark has nothing left to annotate.
		if (this.unavailable.has(uid)) {
			const next = new Set(this.unavailable);
			next.delete(uid);
			this.unavailable = next;
		}
		this.save();
		// kyf: also drop the cached blob so the offline cache stays consistent with the
		// registry (never throws — browser/SSR + IDB-missing return no-op).
		void blobStore.del(uid);
	}

	// ---- unavailable (34-D-06, persisted per-uid "its file would not read") -----------------
	isUnavailable(uid: string): boolean {
		return this.unavailable.has(uid);
	}
	markUnavailable(uid: string) {
		if (!uid) return;
		this.unavailable = new Set(this.unavailable).add(uid);
		this.save();
	}
	/** Clear ONE uid's mark, or every mark when called with no argument (the import's reset). */
	clearUnavailable(uid?: string) {
		if (uid === undefined) {
			this.unavailable = new Set();
		} else {
			const next = new Set(this.unavailable);
			next.delete(uid);
			this.unavailable = next;
		}
		this.save();
	}

	/**
	 * 34-D-07/D-08: replace the download list wholesale — the import's single persisted write for
	 * add / drop / refresh. Deliberately does NOT call blobStore.del for dropped entries: the only
	 * lane that drops here is the device import, whose files the app never owned and must never
	 * delete (Plan 34-01's refusal is the backstop). Marks for uids that are no longer listed are
	 * pruned, so a re-import that finds the file again starts clean.
	 */
	setDownloads(next: Track[]) {
		this.downloads = next;
		const present = new Set(next.map((t) => t.uid));
		this.unavailable = new Set([...this.unavailable].filter((uid) => present.has(uid)));
		this.save();
	}

	// ---- per-list clears (quick-260915-vb9) --------------------------------------------------
	// The Library page's per-tab "Clear all" row. Each is ONE save() for the whole list: the
	// obvious implementation (loop the matching removeX) re-serialises the ENTIRE library payload
	// once per row, so a 300-song Downloads tab would do 300 localStorage writes on a phone.
	// Scoped deliberately — clearAll() nukes everything, these only touch the tab the user is on.

	clearLiked() {
		this.liked = [];
		this.save();
	}

	/** quick-260915-vb9: the blob delete stays PER-UID (not a bulk wipe) so blobStore.del's
	 *  device: refusal (Plan 34-01) keeps protecting imported files exactly as removeDownload does
	 *  — the registry row goes on explicit user intent, the user's own file never does. Fire-and-
	 *  forget: del() never throws, and the persisted state is already correct without it. */
	clearDownloads() {
		const uids = this.downloads.map((t) => t.uid);
		this.downloads = [];
		// Every mark annotates a row that no longer exists.
		this.unavailable = new Set();
		this.save();
		for (const uid of uids) void blobStore.del(uid);
	}

	clearFavArtists() {
		this.favArtists = [];
		this.save();
	}

	/** quick-260915-vb9: empty ONE playlist without deleting it (same immutable-map shape as
	 *  removeFromPlaylist). An unknown id maps to an unchanged list — a no-op, never a throw. */
	clearPlaylistTracks(id: string) {
		this.playlists = this.playlists.map((p) => (p.id === id ? { ...p, tracks: [] } : p));
		this.save();
	}

	clearAll() {
		this.liked = [];
		this.playlists = [];
		this.downloads = [];
		this.favArtists = [];
		this.unavailable = new Set();
		this.save();
	}
}

export const library = new Library();
