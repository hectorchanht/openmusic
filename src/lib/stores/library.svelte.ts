// Local-only library (Svelte 5 runes singleton) — liked songs, playlists, and a
// "downloads" reference list. Persisted to localStorage `openmusic:library:v1`,
// SSR-guarded. This is a demo-scoped slice of the planned Phase-3 Library.
import { browser } from '$app/environment';
import { blobStore } from '$lib/services/blob-store';
import { setCachedCover } from '$lib/services/cover-cache';
import { hasHttpsScheme } from '$lib/services/url-safety';
import { matchKey, versionedMatchKey } from '$lib/services/match-key';
import { isDeviceUid } from '$lib/services/device-track';
import { sameSongStrings, songKey } from '$lib/services/dedupe';
import { isChineseLine, t2sConvertLineSync, warmScript } from '$lib/services/zh-convert';
import type { Track } from '$lib/sources/types';

const KEY = 'openmusic:library:v1';

/**
 * quick-261008-cov1: persistence guard for inline (`data:`) covers. A downscaled embedded cover
 * may sit on a LIVE entry's `cover` (so rows paint it at rung 2), but persisting a ~10 KB data:
 * URL per entry would bloat `openmusic:library:v1` — and the settings backup, which serializes
 * localStorage verbatim — until setItem starts throwing and the WHOLE save is lost. Strip inline
 * covers at the serialization boundary only: the live $state keeps them, and after a reload the
 * shared cover cache (uid + name layers, 14-day TTL) re-supplies them at rung 3.
 */
function stripInlineCover(t: Track): Track {
	return t.cover && t.cover.startsWith('data:') ? { ...t, cover: null } : t;
}

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
	 *  — the offline-miss branch (blobStore.get returned nothing) and the corrupt-blob branch — and
	 *  (debug album-row-tick-before-file-done) by downloadTrack when an attempt ends WITHOUT a file
	 *  ('failed' / 'no-audio' / 'rate-limited'), since addDownload already listed the song (DL-BUG-01)
	 *  and the tick must never stand for a file that is not there. CLEARED by the next explicit
	 *  import (setDownloads prunes it / clearUnavailable), by a later 'saved' attempt, or by removing
	 *  the entry outright. READ by RowBadges / DownloadControl through isUnavailable()
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
	/** quick-260926-hze: bumped once when the t2s fold dict lands. Read by isFavArtist so the
	 *  landing repaints every heart and favourites list (the first render ran on a cold fold). */
	private foldRev = $state(0);
	/** quick-260926-hze: one-shot latch for warmFold. PLAIN field (house convention for loop
	 *  guards): the UI never reads it. */
	private foldWarmed = false;
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
		this.warmFold(); // quick-260926-hze: after hydration, so it sees the saved favourites
	}

	private save() {
		if (!browser) return;
		// debug album-rows-miss-liked-downloaded-on-load: a first Chinese like / download warms the fold
		// (load() covers hydration; this covers a Latin library that gains its first CJK song live).
		this.warmFold();
		try {
			localStorage.setItem(
				KEY,
				JSON.stringify({
					liked: this.liked.map(stripInlineCover),
					playlists: this.playlists.map((p) => ({ ...p, tracks: p.tracks.map(stripInlineCover) })),
					downloads: this.downloads.map(stripInlineCover),
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
	 * The player calls this after a resolve lands a cover. Sets the cover on all
	 * liked / playlist / download entries matching the track's uid OR its normalized
	 * {artist,title} identity (matchKey — same song stored under another source uid),
	 * then stows it in the cover-cache so cover-less tiles on other surfaces can read
	 * it back synchronously.
	 *
	 * quick-261008-cov1 (Hector 2026-10-08 directive: a fetched-and-shown cover shows
	 * EVERYWHERE the song appears): the shown cover OVERWRITES — an entry already carrying
	 * art is updated, not left churning a stale image while the hero shows the new one. The
	 * in-place fill itself lives in fillEntryCovers so player.adoptCover (hi-res swap /
	 * tier-chain winner) can reuse the same seam without duplicating the matching rules.
	 */
	adoptCover(src: Track) {
		const cover = src.cover;
		if (!cover) return;
		this.fillEntryCovers(src.uid, src.artist, src.title, cover);
		// media-card-shows-app-icon: the shared name-layer cache is https-only everywhere else
		// (T-0bb-01 — writeCoverBoth / resolveCoverForTrack). This was the ONE ungated writer, so an
		// http source cover poisoned the cache and re-seeded player.resolvedCover on every replay.
		// quick-261008-cov1: the Phase 40 D-11b YT Music name-layer exclusion is retired by the
		// same directive — a shown YTM thumbnail now bridges every source's copy like any cover.
		if (hasHttpsScheme(cover)) setCachedCover(src.artist, src.title, cover);
	}

	/**
	 * quick-261008-cov1: the in-place entry-cover sync extracted from adoptCover.
	 *
	 * Sets `cover` on every liked / download / playlist-track entry matching `uid` OR the
	 * normalized {artist,title} identity — MUTATING the $state proxies in place (not {...t, cover}
	 * rebuilds): home shelves (likedShelf/downloadsShelf) hold snapshot copies of these references,
	 * so an immutable rebuild would update the store but leave already-rendered tiles stale until
	 * reload. Fine-grained proxy mutation reaches every copy live.
	 *
	 * The shown cover wins over whatever the entry carried: rows read rung 2 (track.cover) ahead of
	 * the shared cache, so leaving a stale entry cover would keep painting the old art next to the
	 * hero's new one. An inline `data:` cover (downscaled embedded art) is fine here — save()
	 * strips data: URLs at the serialization boundary, so persistence never bloats.
	 */
	fillEntryCovers(uid: string, artist: string, title: string, cover: string): void {
		if (!cover) return;
		const key = matchKey(artist, title);
		const same = (t: Track) => t.uid === uid || matchKey(t.artist, t.title) === key;
		let changed = false;
		const fill = (t: Track) => {
			if (same(t) && t.cover !== cover) {
				t.cover = cover;
				changed = true;
			}
		};
		this.liked.forEach(fill);
		this.downloads.forEach(fill);
		this.playlists.forEach((p) => p.tracks.forEach(fill));
		if (changed) this.save();
	}

	/**
	 * quick-260919-1eh: adopt a user's METADATA EDIT across every list that holds this song.
	 *
	 * Mutates the `$state` proxies IN PLACE (not `{...t, title}` rebuilds) for the same reason
	 * adoptCover does: home shelves (likedShelf/downloadsShelf) hold snapshot copies of these
	 * references, so an immutable rebuild would update the store but leave already-rendered tiles
	 * stale until reload. Fine-grained proxy mutation reaches every copy live.
	 *
	 * Matched on `t.uid === uid` ONLY. adoptCover's matchKey widening exists to FILL an EMPTY cover
	 * across duplicate identities (the same song stored under another source's uid); a name edit is a
	 * single-identity user action and must not rewrite a same-named row from another source.
	 *
	 * D-4: an empty/blank field is OMISSION, not a clear — it mirrors the codec, where a falsy field
	 * leaves what is already in the file. There is no "blank this out" verb anywhere in this chain.
	 */
	applyMetadata(uid: string, patch: { title?: string; artist?: string; album?: string }) {
		if (!uid) return;
		const title = patch.title?.trim();
		const artist = patch.artist?.trim();
		const album = patch.album?.trim();
		if (!title && !artist && !album) return;
		let changed = false;
		const fill = (t: Track) => {
			if (t.uid !== uid) return;
			if (title) t.title = title;
			if (artist) t.artist = artist;
			if (album) t.album = album;
			changed = true;
		};
		this.liked.forEach(fill);
		this.downloads.forEach(fill);
		this.playlists.forEach((p) => p.tracks.forEach(fill));
		if (changed) this.save();
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
	 *  "daft punk" / "  Daft Punk  " collapse to one entry.
	 *
	 *  quick-260926-hl9: Chinese names also fold to Simplified so 周杰伦 / 周杰倫 are ONE favourite
	 *  now that artist URLs follow the script lock. t2s is warm whenever a lock is on
	 *  (warmScript('zh-Hans') builds t2s, warmScript('zh-Hant') builds both since quick-260926-bxg);
	 *  a cold t2s returns the raw key = the exact old behaviour. library stays leaf-ish and must
	 *  not import names.
	 *
	 *  quick-260926-hze: the fold now warms ITSELF, lock-independent: warmFold() runs after load()
	 *  and after a favourite toggle, and foldRev repaints once t2s lands, so a favourite saved
	 *  under the other script matches even with the lock OFF. library still must not import names. */
	private favKey(name: string): string {
		// ponytail: a user with ANY Chinese favourite downloads the ~22 KB gzip t2s dict even with
		// the lock off; a Latin-only library never does.
		const k = (name ?? '').trim().toLowerCase();
		return isChineseLine(k) ? (t2sConvertLineSync(k) ?? k) : k;
	}
	isFavArtist(name: string): boolean {
		void this.foldRev; // quick-260926-hze: reactive dependency — the fold-dict landing repaints
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
		this.warmFold(); // quick-260926-hze: a first Chinese favourite warms the fold too
	}

	/** quick-260926-hze: warm the t2s fold dict ONCE when any favourite is Chinese, then bump
	 *  foldRev. Latched → one build, one bump, no retry storm; warmScript never rejects. */
	private warmFold(): void {
		// debug album-rows-miss-liked-downloaded-on-load: a Chinese liked / downloaded entry needs the
		// fold too — stubTrack's identity match (songIndex) keys 繁 vs 简 through it, and foldRev is
		// what re-keys the index once the dict lands. Latched, so the scan runs once per cold session.
		if (
			this.foldWarmed ||
			!(
				this.favArtists.some((n) => isChineseLine(n)) ||
				this.downloads.some((t) => isChineseLine(`${t.artist} ${t.title}`)) ||
				this.liked.some((t) => isChineseLine(`${t.artist} ${t.title}`))
			)
		)
			return;
		this.foldWarmed = true;
		void warmScript('zh-Hans').then(() => {
			this.foldRev++;
		});
	}

	// ---- downloading (D-10, transient per-uid in-flight state) -----------------------------
	/** debug album-row-tick-before-file-done: brackets NEST. The album loop holds one OUTER bracket
	 *  per song (start → final outcome) while downloadTrack / downloadFromDonor bracket each attempt
	 *  inside it, so the uid must stay in `downloading` until the LAST endDownload — a plain Set
	 *  dropped it after the first inner `finally` (tick during the qq backoff). Plain field, not
	 *  `$state`: the UI reads the Set, never the counts (the internal-guard convention). */
	private downloadDepth = new Map<string, number>();
	/** Mark a uid as mid-download. Reassign a NEW Set so runes re-render (parity with
	 *  TrackMenu `inFlight`); NOT persisted (transient runtime state). Nested calls refcount. */
	beginDownload(uid: string) {
		// A uid not in the Set starts at 1 whatever the map says (a test / reset may replace the Set).
		this.downloadDepth.set(uid, this.downloading.has(uid) ? (this.downloadDepth.get(uid) ?? 1) + 1 : 1);
		this.downloading = new Set(this.downloading).add(uid);
		// quick-260913-omi: drop any residue from a previous attempt so a retry starts indeterminate
		// rather than resuming the failed run's bar at 60%.
		if (uid in this.downloadProgress) this.clearDownloadProgress(uid);
	}
	/** Clear a uid's in-flight flag once every nested bracket has ended. Copy → delete → reassign;
	 *  absent uid is a no-op. Never touches another uid's state (isolation) and never persists. */
	endDownload(uid: string) {
		// quick-260913-omi: endDownload runs in downloadTrack's `finally`, so EVERY exit path — saved,
		// no-audio, failed, throw — leaves no progress residue behind. Cleared on EVERY end, even a
		// nested one: the attempt whose bytes fed the bar is over, so the outer ring goes indeterminate.
		this.clearDownloadProgress(uid);
		const depth = (this.downloadDepth.get(uid) ?? 1) - 1;
		if (depth > 0 && this.downloading.has(uid)) {
			this.downloadDepth.set(uid, depth);
			return;
		}
		this.downloadDepth.delete(uid);
		const next = new Set(this.downloading);
		next.delete(uid);
		this.downloading = next;
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

	// ---- state that must OUTLIVE a page (debug download-state-lost-on-page-return) -------------
	// A download runs on `downloading` under the RESOLVED uid, but the album page used to key its
	// header busy flag and every row's uid on component $state — gone on remount, so after a round
	// trip the rows fell back to the nameStub uid (never in the Set), the header re-enabled, and a
	// second tap started a duplicate album job. These two live here so a page only ever MIRRORS them.
	/** Album "Download all" jobs in flight, keyed by the album page's own tracklist key. Claim-once
	 *  (see beginAlbumJob) — the header button's busy source and the duplicate-job guard. */
	albumJobs = $state<Set<string>>(new Set());
	/** {artist,title} stub → the Track it resolved to, keyed by matchKey. A stub row (album, shelf,
	 *  chart) keys its download / like state on this uid, so a remounted list lights the live ring or
	 *  tick at once instead of the stub's idle icon. Session-only cache; a miss is never stored. */
	resolvedStubs = $state<Record<string, Track>>({});
	/** Claim an album job. False when one is already running for this key (a second tap is a no-op). */
	beginAlbumJob(key: string): boolean {
		if (this.albumJobs.has(key)) return false;
		this.albumJobs = new Set(this.albumJobs).add(key);
		return true;
	}
	/** Release an album job (run in the orchestrator's `finally`). Absent key is a no-op. */
	endAlbumJob(key: string) {
		if (!this.albumJobs.has(key)) return;
		const next = new Set(this.albumJobs);
		next.delete(key);
		this.albumJobs = next;
	}
	rememberStub(artist: string, title: string, tr: Track) {
		this.resolvedStubs = { ...this.resolvedStubs, [matchKey(artist, title)]: tr };
	}
	/** debug album-rows-miss-liked-downloaded-on-load: the PERSISTED lists indexed by their songKey
	 *  title half (繁/简-folded), downloads FIRST so a song held in both lists resolves to the one uid
	 *  the tick keys on — tick and heart then agree. Rebuilt when a list changes or the t2s dict
	 *  lands (foldRev: a first render may have keyed cold). A stub that slipped into `liked` has no
	 *  real identity to offer (hasRealIdentity) and is skipped. */
	private songIndex = $derived.by(() => {
		void this.foldRev;
		const m = new Map<string, Track[]>();
		for (const t of [...this.downloads, ...this.liked]) {
			if (!t.uid || t.resolveByName === true) continue;
			const k = songKey(t.artist, t.title);
			const title = k.slice(0, k.indexOf('|'));
			if (!title) continue;
			const bucket = m.get(title);
			if (bucket) bucket.push(t);
			else m.set(title, [t]);
		}
		return m;
	});
	/** The Track a {artist,title} stub row keys its like / download state on: this session's resolve
	 *  memory first, else the persisted library entry for the same song.
	 *
	 *  debug album-rows-miss-liked-downloaded-on-load: `resolvedStubs` is session-only, so on a fresh
	 *  load every album / shelf / chart row of an already-downloaded + liked song showed the idle icon
	 *  and an empty heart until a like tap resolved it (network) and rememberStub re-keyed the row.
	 *  The library already holds that song under its real uid — match it by identity instead:
	 *  exact songKey first, then the sameSongKey artist alias (G.E.M. vs G.E.M.邓紫棋, quick-260927-2wt),
	 *  over the title-half bucket so a page of rows costs O(rows), never rows × library. No network. */
	stubTrack(artist: string, title: string): Track | null {
		const known = this.resolvedStubs[matchKey(artist, title)];
		if (known) return known;
		const k = songKey(artist, title);
		const bucket = this.songIndex.get(k.slice(0, k.indexOf('|')));
		if (!bucket) return null;
		return (
			bucket.find((t) => songKey(t.artist, t.title) === k) ??
			bucket.find((t) => sameSongStrings(artist, title, t.artist, t.title)) ??
			null
		);
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
	 * quick-261007-abq — "auto best quality": refresh a download record's quality
	 * metadata after a REPLACE (downloadTrack with `audioFrom` on an already-downloaded
	 * uid, e.g. TrackMenu "Download from…" on a downloaded song). `addDownload` is
	 * deliberately a no-op for an existing uid (identity preservation, quick-260916-0d9),
	 * so without this the record — and everything derived from it (player.current's
	 * quality tag, the Detail sheet) — keeps describing the OLD file after the bytes
	 * were swapped for a better one. Only quality fields are patched; uid / source /
	 * songid identity is never touched.
	 */
	updateDownloadQuality(uid: string, q: { quality?: string | null; qualityLabel?: string | null }) {
		const i = this.downloads.findIndex((t) => t.uid === uid);
		if (i < 0) return;
		this.downloads = this.downloads.map((t, j) => (j === i ? { ...t, ...q } : t));
		this.save();
	}
	/**
	 * quick-261007-abq3 — the download record's quality fields describe the FILE on disk
	 * (abq/abq2 keep them accurate across replaces). Returns the record's quality pair for a
	 * downloaded uid, else null. Surfaces that display a downloaded song's quality
	 * (player.current, the Detail sheet) prefer this over a track object that may carry a
	 * stale pre-replace quality (persisted restore snapshot, queue/search object, or a fresh
	 * re-resolve reporting the source's streaming tier instead of the file).
	 */
	qualityForDownload(uid: string): { quality: string | null; qualityLabel: string | null } | null {
		const rec = this.downloads.find((d) => d.uid === uid);
		if (!rec || (rec.quality == null && rec.qualityLabel == null)) return null;
		return { quality: rec.quality, qualityLabel: rec.qualityLabel };
	}
	/**
	 * quick-261008-dl1 — "the download file must be used to play all the time".
	 * Resolve the download record for a track: exact uid first, then the same song
	 * downloaded under another source's uid. Identity is versionedMatchKey (same VERSION —
	 * live/remix/acoustic stay distinct, so a live cut never plays the studio file).
	 * Returns the record's uid (the blob-store key), or null when there is no downloaded
	 * copy. Device imports are exact-uid only — their playback path is URI-based, not
	 * blob-based, so a catalog tap must not resolve to a device file here.
	 */
	downloadUidFor(track: Track): string | null {
		if (!track?.uid) return null;
		if (this.isDownloaded(track.uid)) return track.uid;
		if (isDeviceUid(track.uid)) return null;
		const key = versionedMatchKey(track.artist ?? '', track.title ?? '');
		if (!key || key === '|') return null;
		const rec = this.downloads.find(
			(d) => !isDeviceUid(d.uid) && versionedMatchKey(d.artist ?? '', d.title ?? '') === key
		);
		return rec ? rec.uid : null;
	}
	/**
	 * 34-D-06 NOTE: this method is the EXPLICIT removal path (library/+page.svelte:162 edit-mode swipe
	 * + the import's own drop lane via setDownloads). It is deliberately NOT guarded for device uids —
	 * the user may remove an imported entry on purpose; the file itself is protected by blobStore.del's
	 * device refusal (Plan 34-01), and the player's SILENT eviction site is guarded in player.svelte.ts
	 * instead.
	 *
	 * quick-260919-vrq: `deleteFile: false` is the TrackMenu "Remove download" sheet's UNTICKED path
	 * — the user chose to keep the files. The row still goes (and its unavailable mark with it), but
	 * the bytes stay: on native the app-private copy AND the public Music/OpenMusic entry, on the web
	 * the IndexedDB copy. Recording an import EXCLUSION is deliberately NOT this method's business —
	 * the caller decides that (see TrackMenu `confirmRemoveDownload`). Omitting the argument is
	 * byte-for-byte the old behaviour, so every existing call site is untouched.
	 */
	removeDownload(uid: string, opts: { deleteFile?: boolean } = {}) {
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
		if (opts.deleteFile ?? true) void blobStore.del(uid);
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
			// debug album-row-tick-before-file-done: every 'saved' download calls this; no mark = no write.
			if (!this.unavailable.has(uid)) return;
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
