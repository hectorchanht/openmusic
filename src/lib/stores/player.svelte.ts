// App-scoped playback store (Svelte 5 runes singleton). Basic playback for the
// demo — the full audio engine (real queue model) is Phase 2/6/7; the W3C Media
// Session slice was pulled forward here so the OS/browser media UI (Chrome media
// hub, macOS Now Playing, lock screens) shows the current track + working
// transport. Audio is browser-direct (a single <audio> whose .src is the resolved
// CDN URL); metadata was already proxied via the data layer. referrerpolicy=
// no-referrer reproduces the legacy <meta no-referrer> so referer-gated CDNs don't
// 403. All Media Session access goes through the single `ms` accessor, which
// enforces the SSR guard + feature detection (MS-05) — every call early-returns
// when unsupported. The throw-prone artwork/position/state logic lives in the pure,
// node-tested media-session.ts; this store is a thin caller of those helpers.
import { browser } from '$app/environment';
import { SvelteSet } from 'svelte/reactivity';
import { Capacitor } from '@capacitor/core';
import { ensureTrackDetails } from '$lib/services/catalog';
import { tryFallback } from '$lib/services/fallback';
import { buildDiversePicks } from '$lib/services/picks';
import { buildSimilarQueue } from '$lib/services/similar';
import { buildOfflineQueue } from '$lib/services/downloads-queue';
import { dedupeBest, sameSongKey } from '$lib/services/dedupe';
import {
	buildArtwork,
	makeMetadata,
	safePositionState,
	playbackStateFor
} from '$lib/services/media-session';
import {
	createNativeMediaSession,
	type PlayerMediaSession
} from '$lib/services/native-media-session';
import { getCachedCoverByUid, getCachedCover } from '$lib/services/cover-cache';
import { resolveCoverForTrack } from '$lib/services/cover-backfill';
// quick-260615-hep: feed every displayed now-playing cover into the shared cache (both layers) +
// bump the global reactive signal so other surfaces (homepage tiles) reuse the art and repaint live.
import { writeCoverBoth, bumpCoverVersion } from '$lib/stores/cover-version.svelte';

/** SOLID = a non-empty https URL (the only thing safe to cache/render; mirrors cover-backfill isSolidCover, T-0bb-01). */
const httpsOnly = (u?: string | null): u is string => typeof u === 'string' && u.startsWith('https:');
import { resolveStub } from '$lib/services/discovery';
import { blobStore } from '$lib/services/blob-store';
import { settings } from '$lib/stores/settings.svelte';
import { sleepTimer } from '$lib/stores/sleepTimer.svelte';
import { isExpired, fadeVolumeAt, canFadeVolume, decideEndedAction } from '$lib/services/sleep-timer';
import type { QueueContext } from '$lib/config/defaults';
import { history } from '$lib/stores/history.svelte';
import { library } from '$lib/stores/library.svelte';
import { names } from '$lib/stores/names.svelte';
import type { SourceId, Track } from '$lib/sources/types';
// Type-only import (WR-03): lets `notice.msg` / `error` be a real TranslationKey so a host can
// `t(n.msg)` and the token is guaranteed to exist in every dictionary. No runtime UI dependency —
// the store still emits raw, host-rendered data (D-03); this just type-checks the token keys.
import type { TranslationKey } from '$lib/i18n';

/**
 * The minimal display shape the now-bar renders the INSTANT a discovery stub is tapped,
 * before resolveStub finishes (~5-10s). It is NOT a Track (no uid/source/audioUrl) — just
 * enough to lock the tapped song's identity into the now-bar with a loading indicator.
 */
export interface PendingTrack {
	artist: string;
	title: string;
	cover: string | null;
}

/** U+241F SYMBOL FOR UNIT SEPARATOR — a separator that cannot appear in a real title/artist. */
const PENDING_KEY_SEP = '␟';

/**
 * Store→UI notice channel (PLAY-08 / D-02, D-04, D-05). The never-stop chain ORIGINATES inside
 * the player store (runFallback total-failure, the stall watchdog, the offline gate) but stores
 * never import UI — so it surfaces resilience messages on a reactive `player.notice` field that a
 * layout-level toast host (16-03) reads one-way, mirroring the existing `player.error → Nowbar`
 * read. The store carries RAW, i18n-free data (D-03: 16-03 owns the wording):
 *
 *  - `kind: 'skip'`    → an auto-skip after a track failed all sources. `count` is how many songs
 *                        were skipped in the current burst (D-02 batching: N consecutive skips
 *                        within ~1.5s collapse into one "{count} songs skipped" message). `title`
 *                        is the last-skipped track's title (the host may show it). Auto-dismissing,
 *                        no action.
 *  - `kind: 'stopped'` → a STICKY notice with no auto-dismiss. Either the loop-guard tripped
 *                        (~5 consecutive failures, `reason: 'loop-guard'`, carries a Retry `action`
 *                        that skips ahead + re-arms per D-05) OR the player went offline with no
 *                        downloads to fall back to (`reason: 'offline'`, no action — playback
 *                        resumes when connectivity + a user gesture return).
 *
 * 16-03 maps (kind, reason, count, title) → a localized string via `t()`; the store stays
 * i18n-free (it emits raw structured data, not localized text). `msg` carries a REAL
 * TranslationKey (WR-03) so a host preferring a direct lookup can `t(notice.msg)` and the token is
 * guaranteed to resolve in every dictionary (`toast.skipped`/`toast.skippedMany` for skips,
 * `toast.playbackStopped` for the loop-guard, `toast.offlineNoDownloads` for the offline pause).
 */
export interface PlayerNotice {
	kind: 'skip' | 'stopped';
	/** A REAL TranslationKey the UI may render directly via t() (WR-03) — the structured fields
	 *  below remain the preferred mapping input for hosts that want richer wording. Previously a
	 *  free `string` carrying phantom `player.notice.*` tokens that existed in no dictionary. */
	msg: TranslationKey;
	/** Why a 'stopped' notice fired — distinguishes the loop-guard from the offline pause. */
	reason?: 'loop-guard' | 'offline';
	/** 'skip' only: number of consecutive skips collapsed into this one message (D-02). */
	count?: number;
	/** 'skip' only: the title of the most recently skipped track. */
	title?: string;
	/** 'stopped'/loop-guard only: Retry — skips ahead to the next track, resets the counter,
	 *  re-arms the never-stop chain (D-05). Absent on the offline-pause notice. */
	action?: () => void;
}

/** mm:ss, NaN/Infinity-safe (avoids the "NaN:NaN" bug before metadata loads). */
export function fmtTime(s: number): string {
	if (!Number.isFinite(s) || s < 0) return '0:00';
	const m = Math.floor(s / 60);
	const sec = Math.floor(s % 60);
	return `${m}:${sec.toString().padStart(2, '0')}`;
}

class Player {
	current = $state<Track | null>(null);
	playing = $state(false);
	loading = $state(false);
	error = $state<string | null>(null);

	/**
	 * Resilience notice channel (PLAY-08 / D-02, D-04, D-05). One-way reactive read by the
	 * layout toast host (16-03). See PlayerNotice for the shape + token contract. null = nothing
	 * to show. The store sets this from runFallback (skip / loop-guard) and handleOffline (offline
	 * pause); a real `playing` event clears any 'stopped' notice (the success reset).
	 */
	notice = $state<PlayerNotice | null>(null);

	/**
	 * Consecutive-failure counter (PLAY-08 / D-04, Pitfall 1). Incremented on every auto-skip that
	 * did NOT reach a real `playing` event; reset to 0 by the `playing` listener (D-06 success reset)
	 * and by recoverFromStop. PLAIN field (not $state) — an internal loop-guard budget, never read
	 * reactively by the UI (the UI reads `notice` instead). Offline does NOT burn it (D-08).
	 */
	private consecutiveFailures = 0;
	/** Loop-guard cap: after this many consecutive failures with zero successful plays, STOP and
	 *  surface a sticky Retry notice instead of auto-advancing again (D-04). */
	private static FAILURE_CAP = 5;
	/** RELAX-PREFETCH: how long the current track must have ACTUALLY been playing before the
	 *  single-song lookahead prefetch arms. Prefetch is no longer fired on play() entry — it is
	 *  hung off the timeupdate listener and fires once the current src crosses this elapsed-playback
	 *  threshold. This keeps proxy resolves low-rate so endless playback never reads as a bot burst:
	 *  a user who skips before ~5s of playback never triggers a prefetch (the next track resolves
	 *  on-demand inside the next play()). */
	private static PREFETCH_PLAYBACK_DELAY_MS = 5000;
	/** PLAY-RESILIENCE: how many queue entries the forward-resolve-and-probe walk in prefetchNext may
	 *  advance through in a single invocation. The walk starts at the immediate-next and steps past
	 *  any candidate that rejects, resolves without an audioUrl, or fails the silent probe, until it
	 *  lands a probe-verified playable track. Bounded so endless playback never fires an unbounded
	 *  resolve burst that reads as bot traffic. */
	private static PREFETCH_MAX_CANDIDATES = 4;
	/** PLAY-RESILIENCE: cap on the silent ~1s muted test-play probe. A candidate URL that has not
	 *  signalled canplay within this window is treated as "not playable right now" (skipped this
	 *  walk, but NOT marked permanently dead — a timeout can be a transient buffer stall). A hard
	 *  `error` event marks it dead immediately regardless of the timer. */
	private static PROBE_TIMEOUT_MS = 1500;
	/** One-shot guard for the delayed prefetch trigger: set false the instant a NEW src is loaded
	 *  (in play()), flipped true the first time the timeupdate gate fires prefetchNext for that src,
	 *  so the prefetch arms AT MOST ONCE per loaded src. Plain field — internal, never reactive. */
	private prefetchArmedForSrc = false;
	/**
	 * Audio-element error burst counter (CR-03). The dominant region-lock failure mode is "detail
	 * fetch resolves a URL fine, the <audio> byte fetch 403s" — i.e. the `error` event fires while
	 * tryFallback keeps 'succeeding' (it resolves SOME url every time), so handleTotalFailure (and
	 * therefore consecutiveFailures) never runs and the A↔B ping-pong is unbounded. This counts
	 * raw audio `error` events since the last real `playing` and trips the loop-guard once it hits
	 * FAILURE_CAP even when tryFallback keeps finding resolvable-but-unplayable sources. Reset to 0
	 * by the `playing` listener (D-06 success reset) and by recoverFromStop. Plain field — internal.
	 */
	private errorBurst = 0;
	/** Skip-burst batch counter (D-02): how many skips have collapsed into the current notice. Reset
	 *  by the debounce window below. Plain field — not reactive. */
	private skipBurst = 0;
	/** Debounce timer for the skip-burst collapse window. While it is live, further skips
	 *  increment skipBurst into ONE notice rather than stacking N notices (D-02); when it elapses
	 *  the burst counter resets AND the skip notice is cleared (WR-04). */
	private skipBurstTimer: ReturnType<typeof setTimeout> | null = null;
	/** Skip-burst collapse window in ms (D-02 / CONTEXT D-49). Aligned with the layout host's
	 *  SKIP_DISMISS_MS (WR-04) so the store clears the 'skip' notice at the same moment the host
	 *  auto-dismisses it — the channel reaches "nothing to show" exactly when the toast leaves,
	 *  so a later language switch / remount can't resurrect a stale skip toast. */
	private static SKIP_BURST_WINDOW_MS = 2500;

	/**
	 * Optimistic now-bar overlay (FIX-A). Set SYNCHRONOUSLY the instant a discovery stub
	 * is tapped so the now-bar can render the tapped {artist,title,cover} with a loading
	 * indicator before resolveStub settles. Cleared once `current` is set (success) or on a
	 * miss. A NON-null pendingTrack with a null `current` means "resolving — show loading".
	 */
	pendingTrack = $state<PendingTrack | null>(null);
	/** Key (`${artist}␟${title}` lowercased/trimmed) of the in-flight stub resolve — dedupe guard. */
	private pendingKey = '';
	/** Monotonic generation: a newer playStub bumps it so a stale resolve's result is discarded. */
	private pendingGen = 0;

	/**
	 * The ONE cover field every now-playing surface reads (COVER-01 / D-09). Set SYNCHRONOUSLY on
	 * play() entry from `track.cover ?? uid-cache ?? name-cache ?? null` so the OS + UI get the
	 * best-known art immediately. On a sync miss the Plan-02 single-item resolve helper runs and,
	 * generation-guarded, sets this + re-fires a FRESH MediaMetadata so the lock screen repaints
	 * (Pitfall 4). NowPlaying, Nowbar, and buildArtwork(MediaSession) all read this — one field,
	 * three surfaces. Null = total miss; surfaces fall back to their seeded gradient and MediaSession
	 * keeps /favicon.svg via buildArtwork (D-12). It IS `$state` so the two component surfaces
	 * reactively repaint when the async land assigns it. */
	resolvedCover = $state<string | null>(null);

	/** Full-screen now-playing overlay open? */
	expanded = $state(false);
	/** Lightweight "Up-Next" — the result set the current track came from (Phase 7 = real queue). */
	queue = $state<Track[]>([]);
	/** Which surface started the current queue (Phase 17, QUEUE-03). Set by every play-entry
	 *  call site via setQueue/playStub; read in the fresh-play path to resolve the effective
	 *  sourcing mode (same-list vs generated). User-visible state, so it IS `$state` — but it is
	 *  intentionally NOT persisted (reload → null → resolves to the global 'generated' default,
	 *  the safe behavior). Mirrors the manualUids side-state discipline: one player field, never
	 *  a per-Track field. */
	queueContext = $state<QueueContext>(null);

	/** Shuffle on: toggling true randomizes queue tail (current pinned). Off = no auto-shuffle on
	 * next play, but the already-shuffled queue stays as is (gte: user-specified, no unshuffle). */
	shuffle = $state(false);
	/** 2-state repeat (PLAY-10 / D-10): 'off' = today; 'one' = loop the current track on ended.
	 * Cycle: off → one → off. Repeat-all was removed in favor of auto-generated up-next
	 * (ensureAhead/regenerate) — that grow-and-advance IS the semantic successor of repeat-all,
	 * so next() no longer wraps the queue. */
	repeatMode = $state<'off' | 'one'>('off');

	/** Monotonic play generation (gte): bumped at the top of every play() so the cross-source
	 * fallback can detect a newer play() and abort its in-flight retries. Plain field — no $state
	 * reactivity (it's an internal supersedence guard, like pendingGen). */
	private playGen = 0;

	/** Monotonic queue generation (WR-06): bumped by every explicit setQueue() so an in-flight
	 * regenerate() (network-bound, seconds) can detect that the caller has since installed an
	 * EXPLICIT queue (e.g. playAlbum: playStub's [first] → regenerate races resolveAllCached →
	 * setQueue(all album tracks)) and discard its stale result instead of replacing the user's
	 * chosen list with generated picks. Plain field — internal supersedence guard. */
	private queueGen = 0;

	/**
	 * Per-episode "already-attempted sources" set (CR-03). A fallback EPISODE is one logical song's
	 * failover run, keyed by its normalized title+artist (`fallbackEpisodeKey`). Within an episode
	 * each source is tried at most once: runFallback hands this set to tryFallback, which excludes
	 * every member from fallbackOrder and adds each source it touches. Once the order empties,
	 * tryFallback returns null and runFallback routes to handleTotalFailure — the counter engages
	 * and the unbounded A↔B ping-pong (where a resolve-but-unplayable source kept being re-offered)
	 * is closed. The set + key reset when a NEW logical song starts failing over. Plain fields. */
	private fallbackAttempted = new Set<SourceId>();
	private fallbackEpisodeKey: string | null = null;
	/** In-flight guard for runFallback, keyed to playGen (WR-01): only ONE failover may run per
	 *  generation, so a stall-watchdog fire and a late `error` event can't run two concurrent
	 *  fallbacks (double swap onto audio.src / double counter increment). -1 = idle. */
	private fallbackGen = -1;

	/** kyf: when audio.src is set to a `blob:` Object URL (from the offline cache), track the
	 * URL here so we can revoke it when a new track starts. Revoking the previous URL on every
	 * play prevents Object-URL leaks across long sessions. */
	private cachedBlobUrl: string | null = null;

	/** Persistent state key — localStorage shape `openmusic:player:v1`. */
	private static STATE_KEY = 'openmusic:player:v1';
	/** Throttle timer for currentTime persistence (timeupdate fires ~4×/sec). */
	private persistTimer: ReturnType<typeof setTimeout> | null = null;
	/** Seek-position that should be applied as soon as audio.duration becomes finite (i.e. on
	 *  the next `loadedmetadata`). Set by restore() with the saved currentTime, and also
	 *  written by seekFraction() when the user seeks while metadata is still loading. Cleared
	 *  once applied, or when a successful in-range seek lands. */
	private pendingSeek: number | null = null;
	/** Same idea as pendingSeek but holds a FRACTION [0,1] when the user seeks before metadata
	 *  loads (we don't know the absolute seconds yet). Wins over pendingSeek if both are set
	 *  (user intent supersedes restored progress). */
	private pendingSeekFrac: number | null = null;

	/** Strip volatile fields (audioUrl / lrc / lrcUrl / detailsLoaded) before persisting a
	 *  Track to localStorage — they expire and must be re-resolved on the next load. Mirrors
	 *  the legacy serializeTrack whitelist + the history-entry shape. */
	private serializeTrack(t: Track): Partial<Track> {
		return {
			uid: t.uid,
			source: t.source,
			songid: t.songid,
			title: t.title,
			artist: t.artist,
			album: t.album,
			cover: t.cover,
			quality: t.quality,
			qualityLabel: t.qualityLabel,
			keyword: t.keyword,
			displayIndex: t.displayIndex
		};
	}

	/** Write the persistable slice of player state to localStorage. Called immediately on
	 *  imperative state changes (play/setQueue/toggleShuffle/cycleRepeat) and throttled to
	 *  ~2s on the audio `timeupdate` firehose. SSR-safe + try/catch-guarded. */
	private persist() {
		if (!browser) return;
		if (!this.current) {
			try { localStorage.removeItem(Player.STATE_KEY); } catch { /* ignore */ }
			return;
		}
		try {
			localStorage.setItem(
				Player.STATE_KEY,
				JSON.stringify({
					v: 1,
					current: this.serializeTrack(this.current),
					queue: this.queue.map((t) => this.serializeTrack(t)),
					currentTime: this.currentTime,
					shuffle: this.shuffle,
					repeatMode: this.repeatMode
				})
			);
		} catch {
			/* quota — non-fatal */
		}
	}
	/** Coalesce currentTime writes so the timeupdate firehose doesn't spam localStorage. */
	private persistThrottled() {
		if (this.persistTimer) return;
		this.persistTimer = setTimeout(() => {
			this.persistTimer = null;
			this.persist();
		}, 2000);
	}

	/**
	 * GLN-6: flush the EXACT current playback position to localStorage IMMEDIATELY, bypassing the 2s
	 * persistThrottled() window. Called from the visibilitychange(hidden)/pagehide/freeze lifecycle
	 * listeners so an Android process eviction / tab freeze never persists a stale (pre-roll)
	 * currentTime — the likely root cause of "restores to 0". Syncs currentTime from the live element
	 * FIRST (the throttled write may be up to ~2s behind), cancels any pending throttled write so it
	 * can't later clobber, then writes synchronously. Idempotent + never-throws (persist is guarded). */
	private flushPersist() {
		if (this.audio) this.currentTime = this.audio.currentTime || 0;
		if (this.persistTimer) {
			clearTimeout(this.persistTimer);
			this.persistTimer = null;
		}
		this.persist();
	}

	/** Restore the last played track + queue + progress + shuffle/repeat from localStorage.
	 *  Called once from the layout on mount. Doesn't autoplay — restored audio is paused
	 *  with audio.currentTime seeded; the user must tap play (browser autoplay policy).
	 *  Audio URLs aren't persisted (they expire), so the resolved track is re-fetched via
	 *  ensureTrackDetails — same path play() takes. */
	async restore() {
		if (!browser) return;
		let payload: {
			v?: number;
			current?: Partial<Track> | null;
			queue?: Partial<Track>[];
			currentTime?: number;
			shuffle?: boolean;
			repeatMode?: 'off' | 'one';
		} | null = null;
		try {
			const raw = localStorage.getItem(Player.STATE_KEY);
			if (!raw) return;
			payload = JSON.parse(raw);
		} catch {
			return;
		}
		if (!payload?.current?.uid) return;
		const reshape = (p: Partial<Track>): Track => ({
			uid: p.uid ?? '',
			source: p.source ?? ('netease' as Track['source']),
			songid: p.songid ?? '',
			title: p.title ?? '',
			artist: p.artist ?? '',
			album: p.album ?? '',
			cover: p.cover ?? null,
			audioUrl: null,
			lrc: null,
			lrcUrl: null,
			detailsLoaded: false,
			quality: p.quality ?? null,
			qualityLabel: p.qualityLabel ?? null,
			keyword: p.keyword ?? '',
			displayIndex: p.displayIndex ?? 1
		});
		const target = reshape(payload.current as Partial<Track>);
		const seek = Math.max(0, Number(payload.currentTime) || 0);
		this.queue = (payload.queue ?? []).map(reshape);
		this.shuffle = !!payload.shuffle;
		// D-11: 2-state migration — only an explicit 'one' is kept; any persisted repeat-all (from
		// a prior tri-state session), missing, or tampered value collapses to the safe 'off' default.
		this.repeatMode = payload.repeatMode === 'one' ? 'one' : 'off';
		this.current = target;
		this.loading = true;
		try {
			// Offline-first restore: if the track is in library.downloads AND its blob is in
			// IDB, skip the network ensureTrackDetails entirely. Lets the user resume a
			// downloaded track with no network at all (the resolve would otherwise throw +
			// the user would see the player stuck).
			let resolved: Track = target;
			let offlineBlob: Blob | null = null;
			if (library.isDownloaded(target.uid)) {
				offlineBlob = await blobStore.get(target.uid).catch(() => null);
			}
			if (!offlineBlob) {
				resolved = await ensureTrackDetails(target);
				this.current = resolved;
				const i = this.indexOf(target);
				if (i >= 0) this.queue[i] = resolved;
			} else {
				this.current = { ...target, detailsLoaded: true };
				// Restored a downloaded track from its blob (no network resolve) — backfill lyrics
				// off the critical path so the now-playing lyrics view isn't empty (the persisted
				// shape strips lrc/lrcUrl).
				this.fillLyricsOffline(this.current);
			}
			if (!this.audio) return;
			if (this.cachedBlobUrl) {
				URL.revokeObjectURL(this.cachedBlobUrl);
				this.cachedBlobUrl = null;
			}
			let src: string;
			if (offlineBlob) {
				this.cachedBlobUrl = URL.createObjectURL(offlineBlob);
				src = this.cachedBlobUrl;
			} else if (resolved.audioUrl) {
				src = resolved.audioUrl;
			} else {
				return;
			}
			const audio = this.audio;
			// Mark the saved seek-time as PENDING so the single loadedmetadata listener (added
			// in attach()) applies it once metadata loads. seekFraction() owns the same pending
			// slot — if the user manually seeks before metadata lands, their target wins.
			this.pendingSeek = seek > 0 ? seek : null;
			audio.src = src;
			// If duration is already finite (cached load, identical src reset), apply
			// immediately and clear so the listener doesn't double-fire.
			if (Number.isFinite(audio.duration) && audio.duration > 0 && this.pendingSeek != null) {
				audio.currentTime = Math.min(this.pendingSeek, audio.duration);
				this.pendingSeek = null;
			}
		} catch {
			/* re-resolve failed — track stays in `current`, user can tap play to retry */
		} finally {
			this.loading = false;
		}
	}

	/** Re-resolve audio URL for the CURRENT track (fresh upstream call) and re-attach to the
	 *  audio element while preserving the user's intended seek position via pendingSeek.
	 *  Used by the audio.error path when a seek triggers a stale-URL failure — we keep the
	 *  same track, just refresh the URL. Generation-guarded by the pre-call playGen snapshot
	 *  so a newer play() supersedes a stale retry. Never throws. */
	private async reresolveCurrent() {
		const current = this.current;
		if (!current || !this.audio) return;
		const audio = this.audio;
		const desiredSeek = this.currentTime > 0 ? this.currentTime : null;
		const myGen = this.playGen;
		// Force a re-resolve by clearing detailsLoaded + audioUrl on a SHALLOW COPY (don't
		// mutate the queue entry). PRESERVE lrc/lrcUrl: this is a stale-URL audio refresh of the
		// SAME song, and lyrics are a stable per-song attribute — nulling them made the now-playing
		// lyrics view (derived from player.current.lrc) wipe whenever a URL refresh fired (e.g. the
		// download fetch saturating the shared CDN), and the best-effort re-fetch could fail.
		const stub: Track = { ...current, detailsLoaded: false, audioUrl: null };
		try {
			const resolved = await ensureTrackDetails(stub);
			if (myGen !== this.playGen) return; // newer play() superseded
			if (!resolved.audioUrl) return;
			this.current = resolved;
			const i = this.indexOf(stub);
			if (i >= 0) this.queue[i] = resolved;
			if (this.cachedBlobUrl) {
				URL.revokeObjectURL(this.cachedBlobUrl);
				this.cachedBlobUrl = null;
			}
			let src: string = resolved.audioUrl;
			if (library.isDownloaded(resolved.uid)) {
				const blob = await blobStore.get(resolved.uid).catch(() => null);
				if (myGen !== this.playGen) return; // WR-02: a newer play() landed mid-IDB-read
				if (blob) {
					this.cachedBlobUrl = URL.createObjectURL(blob);
					src = this.cachedBlobUrl;
				}
			}
			this.pendingSeek = desiredSeek;
			// NOT an initial-load arming point (D-14): reresolveCurrent is a seek-recovery re-attach
			// of the SAME track after a stale-URL error, not a fresh play. Arming the stall watchdog
			// here would double-count a seek recovery as a load failure, so we deliberately do not.
			audio.src = src;
			// Attempt synchronous seek if duration already loaded; else loadedmetadata listener
			// will pick up pendingSeek when it lands.
			if (Number.isFinite(audio.duration) && audio.duration > 0 && desiredSeek != null) {
				audio.currentTime = Math.min(desiredSeek, audio.duration);
				this.pendingSeek = null;
			}
			void audio.play().catch(() => {
				/* autoplay restriction — user can tap play (seek-recovery, not a load stall) */
			});
		} catch {
			/* re-resolve failed — leave audio in current state */
		}
	}

	/** Best-effort lyric backfill for the OFFLINE-BLOB paths. A downloaded track plays from its
	 *  IndexedDB blob with NO network resolve, and the persisted/queued track shape strips the
	 *  volatile `lrc`/`lrcUrl` — so `current` lands without lyrics and the now-playing lyrics view
	 *  (derived from player.current.lrc) shows empty. This re-resolves lyrics OFF the playback
	 *  critical path (never awaited, never blocks audio): on success it patches `lrc`/`lrcUrl` onto
	 *  the SAME current track, guarded by uid + playGen so a track change mid-fetch discards the
	 *  result. Skips entirely when lyrics are already present or the track never had an lrcUrl. */
	private fillLyricsOffline(track: Track) {
		if (track.lrc) return; // already have lyrics — nothing to do
		const uid = track.uid;
		const myGen = this.playGen;
		void ensureTrackDetails({ ...track, detailsLoaded: false })
			.then((resolved) => {
				if (myGen !== this.playGen) return; // track changed mid-fetch — discard
				if (this.current?.uid !== uid) return; // current moved on — discard
				if (!resolved.lrc) return; // resolve produced no lyrics — leave as-is
				this.current = { ...this.current, lrc: resolved.lrc, lrcUrl: resolved.lrcUrl };
			})
			.catch(() => {
				/* lyric backfill is best-effort — audio already plays from the blob */
			});
	}

	/** Timestamp (Date.now()) of the most recent seekFraction() call. The audio.error handler
	 *  ignores errors that fire within SEEK_ERROR_WINDOW_MS of a seek — seeking past the
	 *  buffered range on some CDNs raises an error the browser recovers from, but our
	 *  cross-source fallback was treating that as a playback failure + calling play() again,
	 *  which reset currentTime to 0 (visible to user as "seek restarted the song"). */
	private lastSeekAt = 0;
	private static SEEK_ERROR_WINDOW_MS = 1500;

	/**
	 * Initial-load stall watchdog (PLAY-07 / D-13, D-14). A freshly started track whose src was
	 * just set but that produces NO `playing`/`timeupdate` within STALL_TIMEOUT_MS is treated as a
	 * failure and routed into runFallback (D-13). This is the detector for the iOS "play() rejected
	 * after an async src swap, no audio, no error event" case (Pitfall 3) — the rejection itself is
	 * swallowed by .catch, so the watchdog is what actually notices the silent stop.
	 *
	 * D-14 mid-track distinction: `hasPlayedSinceSrc` is set false the instant a NEW src is
	 * assigned for initial load and flipped true on the first `playing`/`timeupdate`. The watchdog
	 * only fails over when it is still false — a buffer-dry stall AFTER playback started (timeupdate
	 * already fired) is buffering, not a load failure, and must NOT fail over.
	 */
	private static STALL_TIMEOUT_MS = 15000;
	private stallTimer: ReturnType<typeof setTimeout> | null = null;
	/** True once the current src has produced audio (a `playing`/`timeupdate`); false from the
	 *  moment a new initial-load src is set. Distinguishes initial-load stall (D-13) from a
	 *  mid-track buffer-dry (D-14). Plain field — internal watchdog state, not reactive. */
	private hasPlayedSinceSrc = false;

	/** HTMLMediaElement.HAVE_CURRENT_DATA (readyState >= 2) — bytes for the current position are
	 *  present. Used to distinguish "loaded but paused (autoplay-policy rejected)" from a genuine
	 *  no-bytes load stall (the autoplay-retry / watchdog-gating fix). Inlined as a private static so
	 *  the store does not depend on the live element's enum at module scope. */
	private static HAVE_CURRENT_DATA = 2;
	/**
	 * Autoplay-rejection retry guard (next-song-current-but-paused fix). On a NON-fresh advance
	 * (auto-advance / next / failover) the user-activation from the long-ago tap is gone after the async
	 * ensureTrackDetails resolve, so on mobile `audio.play()` REJECTS — the rejection is swallowed, no
	 * `playing` fires, and the next (playable) track sits CURRENT-BUT-PAUSED. This records, per loaded
	 * src, that play() did not start so a single event-driven re-`play()` may be attempted ONCE when
	 * bytes are present (readyState >= HAVE_CURRENT_DATA → it's an autoplay-policy pause, not a load
	 * stall). Generation-guarded by playGen and one-shot (cleared after the retry / on a new src / on a
	 * real `playing`). Plain field — internal, never reactive.
	 */
	private autoplayRetryArmed = false;

	/** Sleep-timer fade-out interval (TIMER-01, D-01). On platforms that honour volume writes
	 *  expiry ramps the volume down over ~10s then pauses; cleared on finish/abort. Plain field —
	 *  internal fade lifecycle, never reactive. Mirrors the stallTimer clearInterval idiom. */
	private fadeTimer: ReturnType<typeof setInterval> | null = null;
	/** Volume snapshot taken at the start of a fade so finishExpiry/abortFade can restore it (D-02). */
	private preFadeVolume = 1;
	/** Coarse secondary minutes-deadline backstop (RESEARCH Assumption A1): catches the iOS
	 *  screen-wake case where `timeupdate` stalled while locked. The `timeupdate` listener stays
	 *  the authority; this is a belt-and-suspenders net armed via onSleepTimerSet(). */
	private wakeTimer: ReturnType<typeof setTimeout> | null = null;

	currentTime = $state(0);
	/** 0 until loadedmetadata; never NaN. */
	duration = $state(0);

	private audio: HTMLAudioElement | null = null;
	private growing = false;
	private growPromise: Promise<void> | null = null;
	/**
	 * uid of the track whose details are currently being pre-resolved by prefetchNext().
	 * A plain field (NOT $state) — it must not trigger reactivity; it is a pure in-flight
	 * dedupe guard so a second prefetchNext() for the same next track is a no-op.
	 */
	private prefetchingUid: string | null = null;
	/** Aborts the in-flight prefetch when a newer one supersedes it (stale-resolve guard). */
	private prefetchController: AbortController | null = null;
	private preloadedAudio: HTMLAudioElement | null = null;
	private preloadedAudioUid: string | null = null;
	private preloadedAudioUrl: string | null = null;
	private preloadedCover: HTMLImageElement | null = null;
	private preloadedCoverUid: string | null = null;
	private preloadedCoverUrl: string | null = null;
	/**
	 * Uids the user pinned as "manual" (Play Next / Add to Queue / reordered). These
	 * survive a fresh-play regeneration; auto-grown + similar-generated tracks do not.
	 * Plain Set (not $state) so Track objects stay clean — no origin field on Track.
	 */
	private manualUids = new Set<string>();
	/**
	 * Uids the user swiped out of Up-Next this session (Phase 17, QUEUE-05 / D-10). An internal
	 * exclusion budget mirroring manualUids: a plain Set (NOT $state — never reactive, keeps Track
	 * objects clean) that regenerate's buildSimilarQueue exclude set + ensureAhead's buildDiversePicks
	 * `have` set both union in, so a swiped-away song does not regenerate back. Session-scoped: reset
	 * on a fresh user play and NEVER persisted (a reload starts a clean session).
	 */
	private removedUids = new Set<string>();
	/**
	 * quick-260615-i9u (Feature B): cap on how many played entries are kept BEFORE the new current on
	 * a fresh user play. The history prefix is sliced to the LAST HISTORY_CAP entries so endless
	 * clicking never grows the queue unbounded (T-i9u-02). Private static for tunability.
	 */
	private static HISTORY_CAP = 50;
	/**
	 * quick-260615-i9u (Feature B): one-shot carrier of the captured pre-wipe history prefix
	 * (everything up to AND including the prior current, capped to HISTORY_CAP). setQueue/setListQueue
	 * capture it BEFORE they replace this.queue; the very next fresh play() consumes it ONCE via
	 * weaveFreshHistory and nulls it. A non-fresh play() also nulls it so a capture left by a
	 * setQueue/setListQueue that is NOT followed by a fresh play never leaks into a LATER fresh play.
	 * NOT $state — an internal carrier, never read reactively.
	 */
	private pendingHistory: Track[] | null = null;
	/**
	 * quick-260618-fiz (Fix 4): one-shot carrier of the user's EXPLICIT queue entries (uid ∈
	 * manualUids — added via playNext/addToQueue/reorder) captured from the prior queue BEFORE
	 * setQueue/setListQueue wipes it. The next fresh play() re-weaves them right AFTER the seed
	 * (preserveManual) so explicit picks survive a context switch while the prior AUTO/context tail
	 * is dropped. manualUids stays the single provenance source — this is just the carrier of the
	 * Track OBJECTS (the Set holds only uids). Consumed once per fresh play and nulled; a non-fresh
	 * play also nulls it so a capture left by a setQueue NOT followed by a fresh play can't leak.
	 * NOT $state — an internal carrier, never read reactively (mirrors pendingHistory).
	 */
	private pendingManual: Track[] | null = null;
	/**
	 * PLAY-RESILIENCE: uids confirmed UNPLAYABLE this session by the prefetchNext probe walk — a track
	 * that resolved without an audioUrl, or whose audio URL fired a hard `error` during the silent
	 * probe. nextPlayableIndex() routes past these, so next()/track-end advance never lands on a
	 * known-dead up-next entry before it becomes current. Plain Set (NOT $state) mirroring the
	 * removedUids discipline; session-scoped, never persisted, cleared on recoverFromStop/clearQueue.
	 * A probe TIMEOUT does NOT add here (transient buffer stalls must not permanently sideline a
	 * track) — only definitive no-url / error signals do. quick-260615-i9u: this IS now a reactive
	 * SvelteSet (drop-in for Set — same add/delete/has/clear/size surface) so the Up-Next list
	 * repaints the instant a uid is marked/unmarked, rendering a dimmed ✗ "skipped" marker. The
	 * field stays PRIVATE; the component reads it only through the reactive isUnplayable() accessor
	 * and mutates it only via retryUnplayable() (no arbitrary external mutation).
	 */
	private unplayableUids = new SvelteSet<string>();

	/**
	 * PLAY-RESILIENCE strike counter (over-aggressive-skip fix). The prefetchNext probe walk no longer
	 * marks a uid PERMANENTLY dead on the FIRST definitive failure (no-url resolve OR a hard probe
	 * `error`) — because both the per-source URL probe and the offscreen probePlayable element are
	 * SEPARATE fetches from the real <audio> byte fetch, a single transient timeout / edge 403 on a
	 * signed URL / CORS blip was being misclassified as permanent death. Instead each definitive
	 * failure records a strike here; only at STRIKE_CAP confirmed definitive failures is the uid
	 * promoted into the reactive `unplayableUids` set (and the ✗ row drawn). A FIRST definitive failure
	 * behaves like a probe TIMEOUT does — skip this advance walk, do NOT mark dead, retry on demand.
	 *
	 * Plain Map (NOT $state / SvelteSet) — it is internal loop-guard budget, never read reactively in
	 * markup (only `unplayableUids` needs reactivity for the dimmed ✗ row), mirroring the
	 * manualUids/removedUids side-state discipline. Cleared in lockstep with `unplayableUids`
	 * (clearQueue / recoverFromStop / per-uid on retryUnplayable) plus dropped for the current track on
	 * a real `playing` event so a recovered track resets cleanly. Session-scoped, never persisted.
	 */
	private unplayableStrikes = new Map<string, number>();
	/** Confirmed-definitive-failure strikes required before a uid is promoted into unplayableUids
	 *  (the over-aggressive-skip fix). Private static for tunability. */
	private static STRIKE_CAP = 2;

	/**
	 * Record one CONFIRMED definitive failure (no-url resolve OR hard probe error) for a uid and report
	 * whether it has now reached STRIKE_CAP — i.e. should be treated as dead this walk. Below the cap a
	 * single failure is transient-equivalent (skipped this round, retryable on demand). At the cap it is
	 * promoted into the reactive `unplayableUids` set (idempotent) so next()/the walk route past it and
	 * the ✗ row draws. Returns true once the uid is dead (so the caller can mirror the no-mark/skip vs
	 * mark-and-route-past branch).
	 */
	private strikeUnplayable(uid: string): boolean {
		const n = (this.unplayableStrikes.get(uid) ?? 0) + 1;
		this.unplayableStrikes.set(uid, n);
		if (n >= Player.STRIKE_CAP) {
			this.unplayableUids.add(uid); // promote — reactive ✗ row + nextPlayableIndex routes past it
			return true;
		}
		return false;
	}

	/** Drop a uid's accumulated strikes (a recovery point: a real `playing`, an explicit retry, or a
	 *  full session reset). Mirrors the unplayableUids clear discipline so a recovered track starts
	 *  clean and a transient blip never accumulates toward a false permanent skip. */
	private clearStrike(uid: string): void {
		this.unplayableStrikes.delete(uid);
	}

	/**
	 * Lazily-built native Media Session adapter (D-04/D-05). Created once on first native
	 * `ms` access so the `@jofr/capacitor-media-session` import has no effect on the web
	 * bundle's runtime path. Null on web (the accessor returns navigator.mediaSession there).
	 */
	private nativeMs: PlayerMediaSession | null = null;

	/**
	 * Single guard for the Media Session surface (MS-05, T-kyf-03, D-05). EVERY Media Session
	 * call goes through this accessor and early-returns when null, so nothing crashes under SSR
	 * or on unsupported browsers.
	 *
	 * - **Native (Capacitor/Android WebView)**: the System WebView has NO `navigator.mediaSession`,
	 *   so the web wiring is a silent no-op there (no notification, no lock-screen controls, and the
	 *   OS kills backgrounded audio). Return the native adapter, which bridges the exact subset of
	 *   the Web MediaSession surface the player uses onto the jofr plugin (which starts the
	 *   `mediaPlayback` foreground service and renders the system media UI). The player still does
	 *   the two things the plugin requires — explicit `playbackState = 'playing'` on every metadata
	 *   write + all transport action handlers registered in attach() — so they take effect natively.
	 * - **Web**: return `navigator.mediaSession` exactly as before (feature-detected; web unchanged).
	 */
	private get ms(): PlayerMediaSession | null {
		if (Capacitor.isNativePlatform()) {
			this.nativeMs ??= createNativeMediaSession();
			return this.nativeMs;
		}
		return typeof navigator !== 'undefined' && 'mediaSession' in navigator
			? navigator.mediaSession
			: null;
	}

	/** Push the current finite, in-range position to the OS media UI (guarded, MS-04). */
	private syncPosition(el: HTMLAudioElement) {
		const ms = this.ms;
		if (!ms) return;
		const st = safePositionState(el.duration, el.currentTime);
		if (st) ms.setPositionState(st);
	}

	/** Keep the OS media UI play/pause/none state synced with real playback (MS-02). */
	private syncPlaybackState() {
		const ms = this.ms;
		if (ms) ms.playbackState = playbackStateFor(!!this.current, this.playing);
	}

	/** Clear OS media metadata + set state 'none' when playback stops / track cleared (MS-05/MS-02). */
	private clearMedia() {
		const ms = this.ms;
		if (!ms) return;
		ms.metadata = null;
		ms.playbackState = 'none';
		ms.setPositionState(); // clears any stale position
	}

	/**
	 * Arm the initial-load stall watchdog (D-13). Snapshot playGen so a newer play() supersedes
	 * this timer (the gen-check inside the callback discards a stale arm). When STALL_TIMEOUT_MS
	 * elapses with no audio (hasPlayedSinceSrc still false) for the still-current track, route into
	 * runFallback — runFallback owns its OWN gen-guard + AbortController, so the watchdog just fires
	 * the failover and lets it decide supersedence. Always clears any prior timer first.
	 */
	private armStall() {
		const gen = this.playGen;
		this.disarmStall();
		this.stallTimer = setTimeout(() => {
			this.stallTimer = null;
			if (this.playGen !== gen) return; // a newer play() superseded this arm
			if (this.hasPlayedSinceSrc) return; // audio actually started — not a load stall (D-14)
			if (!this.current) return;
			// Next-song-current-but-paused fix: distinguish an autoplay-policy pause from a genuine
			// no-bytes load stall. If the element has buffered to HAVE_CURRENT_DATA but is paused, the
			// track is perfectly playable — it was just rejected by autoplay policy. A cross-source swap
			// is the WRONG remedy (it re-resolves another source and re-rejects). Try the single
			// autoplay re-play instead and do NOT runFallback. Only a TRUE no-bytes stall
			// (readyState < HAVE_CURRENT_DATA) routes into the cross-source failover.
			const el = this.audio;
			if (el && el.paused && el.readyState >= Player.HAVE_CURRENT_DATA) {
				this.maybeRetryAutoplay(gen);
				return;
			}
			void this.runFallback(this.current);
		}, Player.STALL_TIMEOUT_MS);
	}

	/**
	 * Single event-driven retry of `audio.play()` for the autoplay-policy pause (next-song-current-
	 * but-paused fix). Called from the deferred (canplay / readyState-ready) path AFTER a non-fresh
	 * advance recorded that play() did not start (autoplayRetryArmed). Re-invokes play() ONLY when the
	 * element is still paused with bytes present (readyState >= HAVE_CURRENT_DATA) — i.e. it is an
	 * autoplay-policy pause, NOT a load stall and NOT a genuine user pause (a real user pause clears
	 * the arm via the `pause` listener). Generation-guarded by the playGen snapshot so a newer play()
	 * supersedes it, and one-shot (disarms itself) so it never fights a deliberate pause. Deliberately
	 * NOT driven from the `pause` listener (per specialist) — only from the canplay/watchdog seam.
	 */
	private maybeRetryAutoplay(gen: number) {
		if (!this.autoplayRetryArmed) return;
		if (this.playGen !== gen) return; // a newer play() superseded this arm
		const el = this.audio;
		if (!el) return;
		// Only retry an autoplay-policy pause: paused, bytes present, a src still set. A no-bytes
		// stall (readyState < HAVE_CURRENT_DATA) is left to the stall watchdog; an already-playing
		// element needs no retry.
		if (!el.paused) {
			this.autoplayRetryArmed = false; // it started on its own — nothing to retry
			return;
		}
		if (el.readyState < Player.HAVE_CURRENT_DATA) return; // not loaded yet — wait for canplay
		if (!el.src) return;
		this.autoplayRetryArmed = false; // one-shot — never fight a subsequent deliberate pause
		void el.play().catch(() => {
			/* still rejected (no activation) — leave paused; user/Media-Session play resumes it */
		});
	}

	/** Disarm the stall watchdog (a real playing/timeupdate, an error, or end-of-track). */
	private disarmStall() {
		if (this.stallTimer) {
			clearTimeout(this.stallTimer);
			this.stallTimer = null;
		}
	}

	/**
	 * The sleep-timer minutes expiry (TIMER-01). The ONE sanctioned way playback stops by itself
	 * — an INTENTIONAL pause, not a failure. Phase-18 blocker (STATE.md): this path MUST be
	 * invisible to the Phase-16 never-stop machinery — it never calls next(), never bumps playGen
	 * (the sole legitimate bump stays in play()), never touches consecutiveFailures/errorBurst, and
	 * never routes into runFallback/tripLoopGuard. It only pauses + restores volume + cancels the
	 * timer, and the paused lock-screen state comes for free via the existing `pause` listener (D-09).
	 *
	 * D-01: on platforms that honour volume writes, ramp the volume down over ~10s then pause; on
	 * iOS (read-only volume) pause instantly. D-04: if the user already paused manually, clear the
	 * timer silently (no second pause, no fade).
	 */
	expireSleepTimer() {
		// CR-01: re-entry guard. A fade in flight means the stop has already begun — the
		// ~4×/sec `timeupdate` firehose (and the wake-timer backstop) keep re-checking the
		// past deadline while `sleepTimer.mode` stays 'minutes' for the whole fade. Without
		// this guard each re-entry re-snapshots `preFadeVolume` (restoring a degraded value),
		// restarts the interval, and re-runs canFadeVolume's volume=0 write-probe (audible
		// stutter). Bailing while `fadeTimer` is set makes the method idempotent (also WR-04).
		if (this.fadeTimer) return;
		if (!this.audio) {
			sleepTimer.cancel();
			return;
		}
		// D-04: already paused → silent clear, no fade, no duplicate pause.
		if (this.audio.paused) {
			sleepTimer.cancel();
			return;
		}
		const audio = this.audio;
		if (canFadeVolume(audio)) {
			// D-01: ~10s linear fade, then pause (the indicator stays until finishExpiry cancels it).
			this.preFadeVolume = audio.volume;
			const start = Date.now();
			const FADE_MS = 10_000;
			this.disarmFadeTimer(); // never stack two fades
			this.fadeTimer = setInterval(() => {
				const elapsed = Date.now() - start;
				audio.volume = fadeVolumeAt(elapsed, FADE_MS, this.preFadeVolume); // pure, clamped [0,1]
				if (elapsed >= FADE_MS) this.finishExpiry();
			}, 200);
		} else {
			// iOS / unsupported volume writes → instant pause (D-01 feature-detected).
			this.finishExpiry();
		}
	}

	/** Complete the expiry: stop the fade, pause (→ `pause` listener → lock screen paused, D-09),
	 *  restore the pre-fade volume for the next play (D-02), and cancel the timer (silent, D-09). */
	private finishExpiry() {
		this.disarmFadeTimer();
		this.disarmWakeTimer();
		this.audio?.pause();
		if (this.audio) this.audio.volume = this.preFadeVolume; // D-02: restore for next play
		sleepTimer.cancel();
	}

	/** D-05: any playback gesture during a fade aborts the stop — clear the fade, restore the
	 *  pre-fade volume, and cancel the timer (the user is awake). No-op when no fade is in flight. */
	private abortFade() {
		if (this.fadeTimer) {
			this.disarmFadeTimer();
			if (this.audio) this.audio.volume = this.preFadeVolume; // restore
			sleepTimer.cancel(); // user is awake — clear the timer too
		}
	}

	/** Clear the fade interval (mirrors disarmStall's clearTimeout idiom). */
	private disarmFadeTimer() {
		if (this.fadeTimer) {
			clearInterval(this.fadeTimer);
			this.fadeTimer = null;
		}
	}

	/** Clear the coarse secondary deadline backstop. */
	private disarmWakeTimer() {
		if (this.wakeTimer) {
			clearTimeout(this.wakeTimer);
			this.wakeTimer = null;
		}
	}

	/**
	 * Arm the coarse secondary minutes-deadline backstop (RESEARCH Assumption A1). Called by the
	 * timer UI AFTER `sleepTimer.set('minutes', …)` (leaf-store direction: the store never imports
	 * the player; the player reads the store, the UI bridges them). The `timeupdate` listener stays
	 * the authority — this single `setTimeout` is a free catch-the-wake net for the iOS locked-screen
	 * case where `timeupdate` stalled while the page was hidden. It re-checks isExpired() and obeys
	 * the SAME suppress-next/no-failure-machinery rules (it calls the same expireSleepTimer()). A
	 * non-minutes set (end-of-track) just disarms any prior wake timer.
	 */
	onSleepTimerSet() {
		this.disarmWakeTimer();
		if (sleepTimer.mode === 'minutes' && sleepTimer.deadline != null) {
			const delay = Math.max(0, sleepTimer.deadline - Date.now());
			this.wakeTimer = setTimeout(() => {
				this.wakeTimer = null;
				if (sleepTimer.mode === 'minutes' && isExpired(Date.now(), sleepTimer.deadline)) {
					this.expireSleepTimer();
				}
			}, delay);
		}
	}

	/** Bind the single long-lived <audio> element (called once from the layout). */
	attach(el: HTMLAudioElement) {
		this.audio = el;
		el.setAttribute('referrerpolicy', 'no-referrer');

		// GLN-6: page-lifecycle persistence. attach() runs client-side from the root layout, but guard
		// document/window so a stray SSR/test call never throws. On hide/freeze/navigation-away, flush
		// the EXACT current position immediately (bypassing the 2s throttle) so an Android process
		// eviction / tab freeze can never persist a stale currentTime → "restores to 0". On a bfcache
		// restore (pageshow persisted) the audio element is live but the UI state may be stale, so
		// re-sync currentTime/playing from the element — without autoplaying (browser policy).
		if (typeof document !== 'undefined') {
			document.addEventListener('visibilitychange', () => {
				if (document.hidden) this.flushPersist();
			});
			// Page Lifecycle API (Chrome/Android); browsers without it simply never fire it.
			document.addEventListener('freeze', () => this.flushPersist());
		}
		if (typeof window !== 'undefined') {
			// Covers bfcache eviction / navigation away on mobile Safari + Chrome.
			window.addEventListener('pagehide', () => this.flushPersist());
			window.addEventListener('pageshow', (e: PageTransitionEvent) => {
				if (!e.persisted || !this.audio) return; // only a bfcache restore needs the re-sync
				this.currentTime = this.audio.currentTime || 0;
				this.playing = !this.audio.paused;
			});
		}
		el.addEventListener('play', () => {
			// `play` fires the instant `paused` flips false (inside audio.play(), at
			// readyState HAVE_NOTHING — before a single byte loads). It is a UI-STATE signal
			// only ("the user/transport intends to play"), NOT proof that audio started. The
			// D-06 success reset and the D-13/D-14 watchdog disarm must NOT hang off this event
			// (CR-01): doing so reset the failure counter on every auto-skip before the dead
			// URL's `error` even arrived, so the loop-guard cap was unreachable. Those moved to
			// the `playing` listener below.
			this.playing = true;
			this.syncPlaybackState();
		});
		el.addEventListener('playing', () => {
			// `playing` is the event that means audio is ACTUALLY producing output (CR-01).
			// D-13/D-14: mark the src as having played + disarm the initial-load stall watchdog.
			this.hasPlayedSinceSrc = true;
			this.disarmStall();
			// Next-song-current-but-paused fix: real audio started — the autoplay-retry arm is moot.
			this.autoplayRetryArmed = false;
			// D-06 success reset: a real `playing` event is the natural counter reset — the track
			// is actually producing audio, so the never-stop chain has recovered. Clear the
			// consecutive-failure budget + the audio-error burst, and drop any sticky 'stopped'
			// (loop-guard / offline) notice so the UI stops showing "playback stopped" the instant
			// playback resumes.
			this.consecutiveFailures = 0;
			this.errorBurst = 0;
			// Over-aggressive-skip fix: this track actually produced audio — drop any accumulated
			// unplayable strikes for it so an earlier transient prefetch/probe failure can't push it
			// toward a false permanent skip later in the session.
			if (this.current) this.clearStrike(this.current.uid);
			// CR-03: real playback succeeded — end the fallback episode so the next failure for ANY
			// song (incl. this one later) starts with a fresh attempted set.
			this.fallbackEpisodeKey = null;
			this.fallbackAttempted = new Set<SourceId>();
			if (this.notice?.kind === 'stopped') this.notice = null;
		});
		el.addEventListener('pause', () => {
			this.playing = false;
			this.syncPlaybackState();
			// WR-05: a pause during the initial-load window means the user opted OUT of this load —
			// disarm the stall watchdog so it can't, 15s later, runFallback → play(swap) and start
			// audio against an explicit pause. Mirrors the `ended` disarm. (Masked before CR-01 by
			// the early `play`-event disarm; reachable now that disarm only happens on real audio.)
			this.disarmStall();
			// Next-song-current-but-paused fix: an observed `pause` (user OR the swallowed autoplay
			// rejection itself) clears the autoplay-retry arm so we NEVER re-play() from inside the
			// pause listener (per specialist — that would fight a genuine user pause). The retry is
			// driven solely from the canplay/immediate seam set up in play(), gen-guarded.
			this.autoplayRetryArmed = false;
		});
		el.addEventListener('canplay', () => {
			// Next-song-current-but-paused fix: the canplay event is the readyState-ready signal — if a
			// non-fresh advance armed an autoplay retry but bytes were not yet present when play() ran,
			// re-attempt the single play() now that the element has buffered. maybeRetryAutoplay is
			// gen-guarded + one-shot + only acts on a paused, bytes-present element, so this is a no-op
			// in every other case (fresh play, already playing, user pause, no arm).
			this.maybeRetryAutoplay(this.playGen);
		});
		el.addEventListener('timeupdate', () => {
			// Sleep-timer minutes backstop (TIMER-01, Pattern 1): `timeupdate` fires ~4×/sec while
			// audio plays — exempt from intensive bg-tab throttling — so checking the ABSOLUTE
			// deadline here is the throttle-proof expiry authority. expireSleepTimer() pauses in
			// place; the existing body (currentTime/syncPosition/persist) is suppressed for this tick.
			if (sleepTimer.mode === 'minutes' && isExpired(Date.now(), sleepTimer.deadline)) {
				this.expireSleepTimer();
				return;
			}
			this.currentTime = el.currentTime || 0;
			// RELAX-PREFETCH: one-shot, per-src delayed prefetch trigger. Prefetch is NOT fired on
			// play() entry (burst trigger) — it arms here once the CURRENT src has actually been
			// playing for ~PREFETCH_PLAYBACK_DELAY_MS. prefetchArmedForSrc is reset to false the
			// instant a new src loads (in play()), so this fires at most once per loaded src. A user
			// who skips before the threshold never triggers a resolve. Best-effort, never blocks.
			if (
				!this.prefetchArmedForSrc &&
				this.currentTime >= Player.PREFETCH_PLAYBACK_DELAY_MS / 1000
			) {
				this.prefetchArmedForSrc = true;
				void this.prefetchNext();
			}
			this.syncPosition(el);
			// D-13/D-14: the first timeupdate since src-set is the "we are actually playing" signal —
			// flip the flag + disarm the stall watchdog. This is what makes a mid-track buffer-dry
			// (timeupdate already fired) NOT fail over, while an initial-load that never produced a
			// timeupdate still does.
			this.hasPlayedSinceSrc = true;
			this.disarmStall();
			// Coalesce currentTime writes to localStorage so a refresh resumes near where the
			// user left off (within ~2s). Throttled to avoid the 4×/sec timeupdate firehose.
			this.persistThrottled();
		});
		const syncDur = () => {
			this.duration = Number.isFinite(el.duration) ? el.duration : 0;
			// Apply any pending seek the moment duration becomes known. Order: a user-issued
			// pendingSeekFrac (clicked progress before metadata loaded) wins over a restored
			// pendingSeek (saved currentTime from the last session). Both cleared after apply.
			if (Number.isFinite(el.duration) && el.duration > 0) {
				if (this.pendingSeekFrac != null) {
					el.currentTime = this.pendingSeekFrac * el.duration;
					this.pendingSeekFrac = null;
					this.pendingSeek = null;
				} else if (this.pendingSeek != null) {
					el.currentTime = Math.min(this.pendingSeek, el.duration);
					this.pendingSeek = null;
				}
			}
			this.syncPosition(el);
		};
		el.addEventListener('loadedmetadata', syncDur);
		el.addEventListener('durationchange', syncDur);
		el.addEventListener('ended', () => {
			this.playing = false;
			this.syncPlaybackState();
			this.disarmStall(); // track finished — no initial-load stall to watch for
			// Sleep end-of-track (TIMER-01, D-03): when an end-of-track timer is armed, the natural
			// track boundary is the stop point — and it BEATS repeat-one. decideEndedAction makes the
			// precedence explicit + unit-tested: 'sleep-stop' returns BEFORE the repeat-one rewind and
			// BEFORE next(), so neither runs. The `ended` event already paused the element; cancel the
			// timer (indicator disappears, D-09) and clear the OS media UI. NEVER calls next()/playGen.
			const endedAction = decideEndedAction(sleepTimer.mode, this.repeatMode);
			if (endedAction === 'sleep-stop') {
				sleepTimer.cancel();
				this.clearMedia();
				return;
			}
			// Repeat-one (D-10): loop the current track without advancing. The `ended` event
			// already paused the element; rewind + play(). 'off' is the straight advance into
			// next() (which grows auto up-next at the end of the queue — no repeat-all wrap).
			if (this.repeatMode === 'one' && this.audio) {
				// WR-02: a minutes fade keeps the audio PLAYING (it only pauses at finishExpiry). If
				// the track ends naturally mid-fade, `fadeTimer` is still set — the timer has expired.
				// Replaying here would loop a fading track (and the fade would keep lowering the new
				// loop's volume). Finish the expiry instead (disarm fade, restore volume, pause, cancel
				// timer) and do NOT loop. The 'advance' branch is already safe — next() calls abortFade.
				if (this.fadeTimer) {
					this.finishExpiry();
					return;
				}
				this.audio.currentTime = 0;
				// Not an initial-load arming point (D-14): repeat-one rewinds an already-playing
				// src, so a rejection here is a paused-loop, not a load failure — the watchdog
				// stays disarmed and we rely on the user to tap play.
				void this.audio.play().catch(() => {
					/* autoplay may require gesture — controls still work */
				});
				return;
			}
			this.next();
		});
		el.addEventListener('error', () => {
			this.disarmStall(); // an error event is the failure signal — the watchdog is redundant now
			// lw9-followup: if the error fires WITHIN the seek window, the user just clicked the
			// progress bar — but the audio element may not be able to honor the seek because the
			// audio.src is a stale CDN URL (typical after a page-reload restore: the resolved URL
			// from minutes ago can still stream-from-0 but rejects range requests on a new edge
			// node / expired signature). Don't fall back across sources — RE-RESOLVE the same
			// track to get a fresh URL, then re-apply the user's seek via pendingSeek so the
			// audio resumes at the position they clicked. A genuine non-seek failure (no recent
			// seek) still routes through the cross-source path below.
			const sinceSeek = Date.now() - this.lastSeekAt;
			if (sinceSeek < Player.SEEK_ERROR_WINDOW_MS) {
				void this.reresolveCurrent();
				return;
			}
			// Cross-source fallback (gte / SRC-FB-01): rather than surface the error immediately,
			// try the same {artist,title} on the remaining enabled sources. Only after every
			// source is exhausted does the existing error surface. Generation-guarded so a
			// newer play() supersedes a stale retry.
			this.playing = false;
			const failed = this.current;
			if (!failed) {
				this.error = 'toast.playbackStopped';
				this.clearMedia();
				return;
			}
			// CR-03 absolute cap: the dominant region-lock mode is "URL resolves, the <audio> 403s"
			// — the `error` event fires while tryFallback keeps 'succeeding' (it resolves SOME url
			// every cycle), so handleTotalFailure (and consecutiveFailures) never runs and the A↔B
			// ping-pong is unbounded. Count raw audio errors since the last real `playing`; once
			// they hit the cap, route into the existing loop-guard / skip policy directly so the
			// never-stop chain engages even when no source ever yields total failure. Reset to 0 on
			// a real `playing` event (D-06). This complements the per-episode `attempted` set in
			// runFallback (which already collapses the 2-source loop); the burst cap is the
			// generic backstop for 3+ resolve-but-unplayable sources.
			this.errorBurst++;
			// if (this.errorBurst >= Player.FAILURE_CAP) {
			// 	// FAILURE_CAP raw audio errors on the current song without ever reaching `playing` —
			// 	// the resolve-but-unplayable ping-pong. Break a failing repeat-one loop first (D-12),
			// 	// then trip the loop-guard STOP directly so the never-stop chain engages even though
			// 	// tryFallback kept 'succeeding' and handleTotalFailure never ran.
			// 	this.errorBurst = 0;
			// 	if (this.repeatMode === 'one') {
			// 		this.repeatMode = 'off';
			// 		this.persist();
			// 	}
			// 	this.tripLoopGuard();
			// 	return;
			// }
			void this.runFallback(failed);
		});

		// Register OS media transport + seek handlers ONCE (MS-03). They reuse the
		// existing player methods / audio element — no new playback or queue logic.
		// `details.seekOffset` / `details.seekTime` come from the user agent and are
		// treated as untrusted: only acted on when finite, and clamped into range
		// (T-kyf-01) — the same discipline the pure safePositionState enforces.
		const ms = this.ms;
		if (!ms) return;
		ms.setActionHandler('play', () => this.audio?.play().catch(() => {}));
		ms.setActionHandler('pause', () => this.audio?.pause());
		ms.setActionHandler('previoustrack', () => this.prev());
		ms.setActionHandler('nexttrack', () => this.next());
		ms.setActionHandler('seekbackward', (details) => {
			const offset = Number.isFinite(details.seekOffset) ? (details.seekOffset as number) : 10;
			this.lastSeekAt = Date.now();
			el.currentTime = Math.max(0, el.currentTime - offset);
		});
		ms.setActionHandler('seekforward', (details) => {
			const offset = Number.isFinite(details.seekOffset) ? (details.seekOffset as number) : 10;
			const cap = Number.isFinite(el.duration) ? el.duration : el.currentTime + offset;
			this.lastSeekAt = Date.now();
			el.currentTime = Math.min(cap, el.currentTime + offset);
		});
		ms.setActionHandler('seekto', (details) => {
			if (typeof details.seekTime !== 'number' || !Number.isFinite(details.seekTime)) return;
			if (Number.isFinite(el.duration) && el.duration > 0) {
				this.seekFraction(details.seekTime / el.duration); // clamps [0,1] internally
			} else {
				el.currentTime = Math.max(0, details.seekTime);
			}
		});
	}

	/**
	 * quick-260615-i9u (Feature B): snapshot the history prefix from the CURRENT queue BEFORE it is
	 * wiped — everything up to AND INCLUDING the prior current — capped to the last HISTORY_CAP
	 * entries. Returns [] when there is no current (cold start → fresh play degrades to today's
	 * [seed, ...tail] shape, no regression). Must run before this.queue is reassigned.
	 */
	private captureHistory(): Track[] {
		const cur = this.current;
		if (!cur) return [];
		let idx = this.queue.findIndex((t) => t.uid === cur.uid);
		if (idx < 0) idx = this.queue.findIndex((t) => sameSongKey(t, cur));
		let h = idx >= 0 ? this.queue.slice(0, idx + 1) : [cur];
		if (h.length > Player.HISTORY_CAP) h = h.slice(h.length - Player.HISTORY_CAP);
		return h;
	}

	/**
	 * quick-260618-fiz (Fix 4): snapshot the user's EXPLICIT queue entries (uid ∈ manualUids) from
	 * the CURRENT queue BEFORE it is wiped by setQueue/setListQueue. These are songs the user pinned
	 * via playNext/addToQueue/reorder and MUST survive a fresh-play context switch (unlike auto/
	 * context picks, which are dropped). The current track is excluded — the seed/history path owns
	 * it. Returns [] when nothing is pinned. Must run before this.queue is reassigned.
	 */
	private captureManual(): Track[] {
		const curUid = this.current?.uid;
		return this.queue.filter((t) => this.manualUids.has(t.uid) && t.uid !== curUid);
	}

	/** Set the active list (home grid / search results) as the Up-Next source. The optional
	 *  `context` records which surface started the queue (Phase 17, QUEUE-03) so the fresh-play
	 *  path can resolve the effective sourcing mode. Defaults to null (unknown → global default). */
	setQueue(tracks: Track[], context: QueueContext = null) {
		// quick-260615-i9u (Feature B): capture the pre-wipe history prefix so the next fresh play()
		// can re-weave it in front of the seed. `??=` so a setListQueue→setQueue delegate doesn't
		// clobber a capture already taken this tick (whichever runs first wins).
		this.pendingHistory ??= this.captureHistory();
		// quick-260618-fiz (Fix 4): capture explicit manual entries BEFORE the wipe so the next fresh
		// play re-weaves them after the seed while this auto/context tail is dropped. `??=` mirrors
		// pendingHistory — whichever of a setListQueue→setQueue delegate pair runs first wins.
		this.pendingManual ??= this.captureManual();
		this.queueGen++; // WR-06: an explicit queue supersedes any in-flight regenerate result
		this.queue = dedupeBest(tracks, settings.preferredSource);
		this.queueContext = context;
		this.persist();
	}

	private queueWithAnchor(tracks: Track[], anchor: Track): Track[] {
		const deduped = dedupeBest(tracks, settings.preferredSource);
		let idx = deduped.findIndex((t) => t.uid === anchor.uid);
		if (idx < 0) idx = deduped.findIndex((t) => sameSongKey(t, anchor));
		if (idx >= 0) {
			deduped[idx] = anchor;
			return deduped;
		}
		return [anchor, ...deduped.filter((t) => t.uid !== anchor.uid)];
	}

	/**
	 * Install an explicit ordered LIST as the up-next queue while GUARANTEEING the currently
	 * playing track is a member of it (album-and-next-song-bug fix). The single-tap album path and
	 * any other "play one item, then back-fill the rest of its list" flow needs the current track to
	 * live INSIDE the queue at its real position, otherwise indexOf(current) is -1 and next()/prev()/
	 * ensureAhead/prefetchNext all go dead AND the "same-list" up-next can never be the list remainder
	 * (it falls through to generation). This re-anchors current into the deduped list WITHOUT
	 * restarting playback (unlike play(), which resets currentTime + re-sets audio.src):
	 *
	 *  - Dedupe the list (cross-source collapse, same as setQueue).
	 *  - Locate current in it by uid first, then by sameSongKey (a different-source variant of the
	 *    same song collapses under dedupe, so the uid may differ — match the SONG, not the id).
	 *  - If found, REPLACE that slot with the exact `current` object so indexOf(current) is valid and
	 *    audio keeps playing the already-loaded track.
	 *  - If NOT found (the song isn't in its own list — rare), splice current at the front so it
	 *    stays a member and the rest of the list becomes the up-next remainder.
	 *
	 * No-op delegate to setQueue() when there is no current track (nothing to anchor).
	 */
	setListQueue(tracks: Track[], context: QueueContext = null) {
		// quick-260615-i9u (Feature B): capture the pre-wipe history prefix BEFORE anything (incl. the
		// no-current delegate to setQueue, which also captures with `??=`). `??=` so the delegate path
		// doesn't double-capture/clobber — whichever runs first wins.
		this.pendingHistory ??= this.captureHistory();
		// quick-260618-fiz (Fix 4): capture explicit manual entries BEFORE the wipe (same as setQueue).
		this.pendingManual ??= this.captureManual();
		const current = this.current;
		if (!current) {
			this.setQueue(tracks, context);
			return;
		}
		this.queueGen++; // WR-06: an explicit queue supersedes any in-flight regenerate result
		this.queue = this.queueWithAnchor(tracks, current);
		this.queueContext = context;
		this.persist();
	}

	/** Insert a track right after the current one (de-duped). Plays it if nothing is playing. */
	playNext(t: Track) {
		this.manualUids.add(t.uid); // explicit manual add — preserved across regen
		const q = this.queue.filter((x) => x.uid !== t.uid);
		const i = q.findIndex((x) => x.uid === this.current?.uid);
		q.splice(i >= 0 ? i + 1 : 0, 0, t);
		this.queue = q;
		if (!this.current) this.play(t);
		else this.persist();
	}

	/** Append a track to the end of the queue (de-duped). Plays it if nothing is playing. */
	addToQueue(t: Track) {
		this.manualUids.add(t.uid); // explicit manual add — preserved across regen
		if (!this.queue.some((x) => x.uid === t.uid)) this.queue = [...this.queue, t];
		if (!this.current) this.play(t);
		else this.persist();
	}

	/**
	 * Remove one track from Up-Next (Phase 17, QUEUE-05 / D-10 — swipe-to-remove). The uid is
	 * session-excluded from auto-generation (removedUids) so it does not regenerate back in, and
	 * dropped from manualUids so a previously-pinned track can still be swiped away. Re-reads
	 * `this.queue` at write-time and filters it (Pitfall 1 — never a closed-over snapshot).
	 */
	removeFromQueue(uid: string) {
		// CR-01: never-stop — the CURRENT track survives (mirrors clearQueue's invariant).
		// Removing it would orphan indexOf(current) → next()/ensureAhead/prefetchNext all go
		// permanently dead AND persist() would write the broken state across reloads.
		if (uid === this.current?.uid) return;
		this.removedUids.add(uid); // D-10: session-excluded from regen/grow
		this.manualUids.delete(uid);
		this.queue = this.queue.filter((t) => t.uid !== uid);
		this.persist();
	}

	/**
	 * Clear the whole queue (Phase 17, QUEUE-05 / D-08). Keeps ONLY the currently-playing track
	 * (never-stop: current survives) and resets manual pins. D-09: deliberately does NOT regenerate
	 * or ensureAhead here — the queue stays at [current] and the exhaust engine refills only when
	 * the current track nears its end. Re-reads `this.current`/`this.queue` at write-time (Pitfall 1).
	 */
	clearQueue() {
		this.queue = this.current ? [this.current] : [];
		this.manualUids.clear();
		this.pendingManual = null; // quick-260618-fiz (Fix 4): drop any uncommitted manual carry too
		this.unplayableUids.clear(); // PLAY-RESILIENCE: a user queue reset clears the dead-track set too
		this.unplayableStrikes.clear(); // …and the sub-cap strike budget in lockstep (over-aggressive-skip fix)
		this.persist();
	}

	/**
	 * Append more diverse picks when the queue is within 2 of the end, so playback
	 * never runs short. Guarded against re-entry (growing flag) and dry sources.
	 */
	private ensureAhead(): Promise<void> {
		if (this.growPromise) return this.growPromise;
		const current = this.current;
		if (!current) return Promise.resolve();
		let i = this.indexOf(current);
		if (i < 0 && this.queue.length) {
			this.queue = this.queueWithAnchor(this.queue, current);
			this.persist();
			i = this.indexOf(current);
		}
		if (i < 0 || this.queue.length - i > 2) return Promise.resolve();
		this.growing = true;
		// album-and-next-song-bug fix: snapshot the queue generation (mirrors regenerate's WR-06).
		// A fresh single-tap album play fires ensureAhead against the optimistic one-track queue;
		// while buildDiversePicks is in flight the album page installs the FULL album list via
		// setListQueue (which bumps queueGen). Without this guard the stale grow would append
		// GENERATED picks onto the explicit album queue, re-introducing the "up-next still generated"
		// bug. Discard the grow if an explicit queue landed meanwhile.
		const myQueueGen = this.queueGen;
		this.growPromise = (async () => {
			try {
				// Union removedUids (Phase 17, D-10/QUEUE-02): swiped-away songs stay excluded from the
				// auto-grow picks, not just from the current queue snapshot.
				const have = new Set([...this.queue.map((t) => t.uid), ...this.removedUids]);
				// quick-260618-fiz Fix 3: the continuation is seeded from the CURRENT track (the song
				// playing as the queue empties), per Fix 3 — buildSimilarQueue (artist.getSimilar →
				// same-artist fallback) is the existing related mechanism; buildDiversePicks is now only
				// the last-resort fallback. This replaces the old random buildDiversePicks-from-nothing
				// continuation so an exhausted queue extends from what you were just listening to rather
				// than from the liked/favorites list or unrelated random picks.
				let more = await buildSimilarQueue(current, have);
				// Never-stop invariant (STATE.md Phase 16): if Last.fm is dry AND the same-artist search
				// yields nothing, fall back to diverse random picks so an obscure-artist queue still grows.
				if (!more.length) more = await buildDiversePicks(8, have);
				if (myQueueGen !== this.queueGen) return; // an explicit setQueue/setListQueue superseded
				if (more.length) this.queue = this.queueWithAnchor([...this.queue, ...more], current);
			} catch {
				/* sources dry — leave the queue as-is */
			} finally {
				this.growing = false;
				this.growPromise = null;
			}
		})();
		return this.growPromise;
	}

	private indexOf(track: Track | null): number {
		if (!track) return -1;
		return this.queue.findIndex((t) => t.uid === track.uid);
	}

	/**
	 * Pre-resolve the track next() WOULD pick next, so a later next()/track-end starts
	 * instantly (the user-felt latency on advance is the per-source proxy round-trip inside
	 * ensureTrackDetails, NOT byte buffering). Because ensureTrackDetails is idempotent (its
	 * readiness guard short-circuits a detailsLoaded track) and play() syncs the resolved
	 * track back into queue[i], pre-resolving the next entry means the later play() hits a
	 * no-op resolve = instant start.
	 *
	 * Best-effort, fired as `void this.prefetchNext()` from the timeupdate playback-elapsed gate
	 * (NOT on play() entry) — mirrors ensureAhead()/regenerate(): never blocks the current play(),
	 * never throws. After details resolve, it also warms the next audio URL through a muted offscreen
	 * Audio element and preloads the cover image, so the later main-audio src swap and cover repaint
	 * can reuse browser cache when supported.
	 *
	 * PLAY-RESILIENCE: this is a bounded FORWARD-RESOLVE-AND-PROBE walk (restored from the pre-76b3e6f
	 * design + a silent probe). Starting at queue[indexOf(current)+1], it advances through up to
	 * PREFETCH_MAX_CANDIDATES entries, skipping any candidate that rejects, resolves WITHOUT an
	 * audioUrl, or fails the silent ~1s muted test-play probe, until one PROBES playable. A candidate
	 * that is definitively dead (no url / probe `error`) is recorded in unplayableUids so next()
	 * routes past it instead of stalling on it; a transient reject / probe timeout is merely skipped
	 * this round (retried on demand). This is what guarantees "the next song can always be played":
	 * the entry next() will pick (nextPlayableIndex) is pre-resolved + probe-verified here, and known
	 * -dead entries ahead of current are skipped. Still bounded so endless playback never fires an
	 * unbounded resolve burst that reads as bot traffic.
	 *
	 * Guards:
	 *  - silent no-op at end of queue / no current;
	 *  - already-complete candidate short-circuit (warm assets, skip resolve — still probed);
	 *  - in-flight dedupe keyed to the immediate-next uid (no duplicate concurrent walk);
	 *  - single shared prefetchController — a superseding prefetch aborts the in-flight resolve;
	 *  - seedUid stale-guard re-checked after EVERY await — a `current` change mid-walk discards the
	 *    work and never clobbers the queue;
	 *  - write-back locates the slot FRESHLY by uid (never a closed-over index) and only writes a
	 *    slot still AHEAD of the recomputed current.
	 * It never throws, never bumps playGen, never calls next()/runFallback — a pure pre-resolve
	 * optimization that composes with the never-stop chain.
	 */
	private async prefetchNext() {
		const i = this.indexOf(this.current);
		if (i < 0) return; // no current track in the queue — nothing to prefetch from
		const firstIndex = i + 1;
		if (firstIndex >= this.queue.length) return; // at end of queue — silent no-op (growth is ensureAhead's job)

		// Always warm the cover of the immediate-next (preserve today's cover-warm behavior).
		this.preloadNextCover(this.queue[firstIndex]);

		// In-flight dedupe: already walking from this exact immediate-next — no second walk.
		const claimedUid = this.queue[firstIndex].uid;
		if (this.prefetchingUid === claimedUid) return;

		// Supersede any prior in-flight prefetch (different target) before claiming this one. The
		// walk is keyed to the immediate-next uid for dedupe + finally cleanup.
		this.prefetchController?.abort();
		this.prefetchingUid = claimedUid;
		this.prefetchController = new AbortController();
		const sig = this.prefetchController.signal;
		const seedUid = this.current?.uid; // stale-guard: current must not change away

		try {
			for (let step = 0; step < Player.PREFETCH_MAX_CANDIDATES; step++) {
				const candIdx = firstIndex + step;
				if (candIdx >= this.queue.length) break; // ran off the end — growth is ensureAhead's job
				const cand = this.queue[candIdx];
				if (this.unplayableUids.has(cand.uid)) continue; // already known-dead — walk past it

				// Resolve (or short-circuit an already-complete candidate) to obtain an audioUrl.
				let resolved: Track;
				if (cand.detailsLoaded && cand.audioUrl && (cand.lrc || !cand.lrcUrl)) {
					resolved = cand;
				} else {
					try {
						resolved = await ensureTrackDetails(cand, sig);
					} catch {
						// Transient reject (proxy/rate-limit) — do NOT mark dead; skip this candidate
						// this round and walk on (next play() resolves it on demand if reached).
						if (sig.aborted || this.current?.uid !== seedUid) return;
						continue;
					}
					if (sig.aborted || this.current?.uid !== seedUid) return; // current changed — discard
				}

				if (!resolved.audioUrl) {
					// Definitive failure (resolved but no url) — but a SINGLE one is treated as transient
					// (the resolve is a separate fetch from the real <audio> fetch; signed-URL/edge blips
					// recover on a fresh resolve at click-time). Strike it; only promote to dead at the cap.
					this.strikeUnplayable(cand.uid);
					continue;
				}

				// Silent probe — the ~1s muted test-play that proactively detects un-playability.
				const probe = await this.probePlayable(resolved.audioUrl);
				if (sig.aborted || this.current?.uid !== seedUid) return; // current changed — discard
				if (!probe.ok) {
					// A hard probe `error` is definitive — but the probe element is a SEPARATE fetch from
					// the live <audio> byte fetch, so a single error can be a transient signed-URL refresh /
					// codec quirk / network blip. Strike it (promoted to dead only at the cap); a probe
					// TIMEOUT stays unmarked entirely. Either way the walk advances this round.
					if (probe.errored) this.strikeUnplayable(cand.uid);
					continue; // timeout (no mark) or sub-cap error: walk to the next candidate
				}

				// LANDED a probe-verified playable track. Locate the slot FRESHLY by uid (never a
				// closed-over index, Pitfall 1) and write back only if still AHEAD of the recomputed
				// current — same in-place sync play() does, so the later play() no-ops.
				const writeIdx = this.queue.findIndex((t) => t.uid === cand.uid);
				if (writeIdx >= 0 && writeIdx > this.indexOf(this.current)) {
					this.queue[writeIdx] = resolved;
					this.prewarmNextAssets(resolved);
				}
				return; // done — landed the next playable
			}
		} catch {
			/* best-effort — abort or unexpected failure leaves the queue as-is */
		} finally {
			// Clear the in-flight guard only if it still points at the claimed uid (a superseding
			// prefetch may have already claimed a newer uid).
			if (this.prefetchingUid === claimedUid) {
				this.prefetchingUid = null;
				this.prefetchController = null;
			}
		}
	}

	/**
	 * PLAY-RESILIENCE silent probe: verify a resolved audio URL is actually playable BEFORE the track
	 * becomes current, by loading it into a muted offscreen Audio element and racing a canplay signal
	 * against a hard `error` and a PROBE_TIMEOUT_MS deadline. This catches the dominant "URL resolves
	 * fine but the byte fetch 403s / wrong codec" failure mode proactively instead of reactively
	 * (after the live element errors mid-transition). Returns {ok} = true on canplay/loadeddata,
	 * {ok:false, errored:true} on a hard error event (caller marks the track dead), {ok:false,
	 * errored:false} on timeout (transient — caller skips this round but does NOT mark dead).
	 * Degrades to {ok:true} in any environment without a real event-capable Audio (can't probe →
	 * assume playable; the reactive never-stop chain still backstops). Best-effort, never throws.
	 */
	private probePlayable(url: string): Promise<{ ok: boolean; errored: boolean }> {
		// Degrade gracefully where there is no event-capable Audio (SSR, or unit-test stubs whose
		// prototype has no addEventListener): can't observe playability → assume playable rather than
		// false-fail every prefetch, and construct NOTHING so we don't perturb asset-warming counts.
		if (typeof Audio === 'undefined' || typeof Audio.prototype?.addEventListener !== 'function') {
			return Promise.resolve({ ok: true, errored: false });
		}
		return new Promise((resolve) => {
			let a: HTMLAudioElement;
			try {
				a = new Audio();
			} catch {
				resolve({ ok: true, errored: false });
				return;
			}
			let done = false;
			const onOk = () => settle({ ok: true, errored: false });
			const onErr = () => settle({ ok: false, errored: true });
			const timer = setTimeout(() => settle({ ok: false, errored: false }), Player.PROBE_TIMEOUT_MS);
			function settle(result: { ok: boolean; errored: boolean }) {
				if (done) return;
				done = true;
				clearTimeout(timer);
				a.removeEventListener('canplay', onOk);
				a.removeEventListener('loadeddata', onOk);
				a.removeEventListener('error', onErr);
				try {
					a.pause();
					a.removeAttribute('src');
					a.load(); // release the byte fetch
				} catch {
					/* best-effort teardown */
				}
				resolve(result);
			}
			try {
				a.muted = true;
				a.preload = 'auto';
				a.setAttribute('referrerpolicy', 'no-referrer');
				a.addEventListener('canplay', onOk);
				a.addEventListener('loadeddata', onOk);
				a.addEventListener('error', onErr);
				a.src = url;
				a.load();
				// play() nudges buffering on some engines; canplay/loadeddata is the real signal and
				// the timeout backstops. A rejected play() (autoplay/codec) is ignored here.
				void a.play?.()?.catch?.(() => {});
			} catch {
				settle({ ok: true, errored: false }); // can't even start a probe → don't penalize
			}
		});
	}

	private prewarmNextAssets(track: Track) {
		this.preloadNextCover(track);
		this.preloadNextAudio(track);
	}

	private preloadNextAudio(track: Track) {
		const url = track.audioUrl;
		if (!url || typeof Audio === 'undefined') return;
		if (this.preloadedAudioUid === track.uid && this.preloadedAudioUrl === url) return;
		try {
			const audio = this.preloadedAudio ?? new Audio();
			this.preloadedAudio = audio;
			audio.preload = 'auto';
			audio.muted = true;
			audio.setAttribute('referrerpolicy', 'no-referrer');
			audio.src = url;
			audio.load();
			this.preloadedAudioUid = track.uid;
			this.preloadedAudioUrl = url;
		} catch {
			/* best-effort cache warm only */
		}
	}

	private preloadNextCover(track: Track) {
		const url = track.cover;
		if (!url || typeof Image === 'undefined') return;
		if (this.preloadedCoverUid === track.uid && this.preloadedCoverUrl === url) return;
		try {
			const img = new Image();
			img.decoding = 'async';
			img.referrerPolicy = 'no-referrer';
			img.src = url;
			this.preloadedCover = img;
			this.preloadedCoverUid = track.uid;
			this.preloadedCoverUrl = url;
		} catch {
			/* best-effort image cache warm only */
		}
	}

	/**
	 * Keep Up-Next topped up on play() entry. RELAX-PREFETCH: primeNext NO LONGER fires
	 * prefetchNext — prefetch is driven solely by the timeupdate playback-elapsed gate (~5s into
	 * actual playback), so a track that is set but skipped before then never triggers a resolve.
	 * The four play() call sites (offline-blob / fresh+generated / fresh+same-list / auto-advance)
	 * stay unchanged: they still ensureAhead() so next() always has somewhere to advance to.
	 */
	private async primeNext() {
		await this.ensureAhead();
	}

	/**
	 * Optimistic resolve-on-tap (FIX-A). A discovery tile is a Last.fm {artist,title} stub,
	 * NOT a Track — resolveStub re-searches it through searchAll+dedupeBest (~5-10s). This
	 * makes that feel instant + native:
	 *
	 *  - SYNCHRONOUSLY (before awaiting) it locks the tapped {artist,title,cover} into
	 *    `pendingTrack` and sets `loading`, so the now-bar renders immediately.
	 *  - DEDUPE: a second tap with the SAME pending key while one is in flight is a NO-OP
	 *    (no second resolveStub) — repeated double-taps don't stack resolves.
	 *  - SUPERSEDE: a tap with a DIFFERENT key bumps `pendingGen`; when an older resolve
	 *    settles its gen !== current → its result is discarded (never played, pendingTrack
	 *    is left pointing at the NEWER song).
	 *  - On success for the current gen → setQueue([track]) + play(track) (play() owns
	 *    loading/current from there) and pendingTrack is cleared.
	 *  - On a miss (null) for the current gen → pendingTrack + loading clear and null is
	 *    returned so the CALLER owns its own unplayable toast.
	 *
	 * Returns the resolved Track on success, or null on a miss OR a supersede. Never throws
	 * (resolveStub is best-effort; this wraps it defensively too).
	 */
	async playStub(
		artist: string,
		title: string,
		cover?: string | null,
		context: QueueContext = null
	): Promise<Track | null> {
		const key = `${artist}${PENDING_KEY_SEP}${title}`.toLowerCase().trim();

		// Dedupe: same song tapped again while its resolve is still in flight → no-op.
		// "In flight" = a pendingTrack still showing (it is cleared on success/miss/supersede).
		if (key === this.pendingKey && this.pendingTrack !== null) return null;

		const gen = ++this.pendingGen;
		this.pendingKey = key;
		this.pendingTrack = { artist, title, cover: cover ?? null };
		this.loading = true;
		this.error = null;

		let tr: Track | null = null;
		try {
			tr = await resolveStub(artist, title);
		} catch {
			tr = null; // resolveStub never throws, but stay defensive — never reject.
		}

		// Superseded by a newer tap while we were resolving → discard silently. Do NOT touch
		// pendingTrack/loading; the newer playStub call owns them now.
		if (gen !== this.pendingGen) return null;

		if (tr) {
			// Hand off to the real player. Clear the optimistic overlay; play() sets `current`
			// (and owns loading from here) so there is no flicker of a stale pending bar.
			this.pendingTrack = null;
			this.setQueue([tr], context);
			void this.play(tr, { fresh: true });
			return tr;
		}

		// Genuine miss for the current generation — clear the overlay; caller toasts.
		this.pendingTrack = null;
		this.pendingKey = '';
		this.loading = false;
		return null;
	}

	/**
	 * Play a track. `opts.fresh` marks a FRESH user-initiated play (the user tapped a
	 * song in a list to start something new) — that regenerates the AUTO portion of
	 * Up-Next from songs similar to the new track, preserving the current track + all
	 * manual entries. `next()`, `prev()`, and auto-advance (ended) call the NON-fresh
	 * path, so they never regenerate.
	 */
	async play(track: Track, opts?: { fresh?: boolean; fromFallback?: boolean }) {
		// A direct play() (queue/auto-advance/share link) supersedes any optimistic overlay,
		// so a stale pending bar never lingers once a real track takes over.
		this.pendingTrack = null;
		this.pendingKey = '';
		this.error = null;
		this.loading = true;
		this.current = track;
		this.currentTime = 0;
		this.duration = 0;
		// COVER-01 / D-09: set the ONE cover field SYNCHRONOUSLY from the best-known source so the
		// nowbar/now-playing surfaces AND the first MediaMetadata write below paint real art with no
		// flicker. Read order is uid-cache BEFORE name-cache (D-13 two-layer) and BEFORE null; a total
		// miss leaves null and the async tier chain (further down) takes over. Repointing this on
		// every entry also clears any stale cover from the prior track.
		this.resolvedCover =
			track.cover ?? getCachedCoverByUid(track.uid) ?? getCachedCover(track.artist, track.title) ?? null;
		// quick-260615-hep Site A: write the displayed cover (incl. the track.cover path) into BOTH cache
		// layers + bump so other surfaces reuse it and repaint live. https-only (T-0bb-01); writeCoverBoth
		// no-ops on empty/non-https — harmless even before the myGen guards' discard points (real art only).
		if (httpsOnly(this.resolvedCover))
			writeCoverBoth(track.uid, track.artist, track.title, this.resolvedCover);
		// Bump the play-generation so any older in-flight fallback bails (gte). Skipped on a
		// fallback continuation — the fallback IS the continuation of the user's original intent
		// and must not invalidate itself.
		if (!opts?.fromFallback) this.playGen++;
		// CR-02: snapshot the generation right after the (conditional) bump and re-check it after
		// EVERY await below before writing current / audio.src / Media Session. A fallback
		// continuation inherits the value it was started under (it deliberately does not bump),
		// so it bails the instant a newer user play() supersedes it. Without this, a slow resolve
		// for an earlier tap could settle late and clobber the track the user actually chose.
		const myGen = this.playGen;
		// One-way edge: record the play BEFORE resolution so it lands even if audio
		// resolution later errors. history imports nothing back (no circular dep).
		// Fallback continuations DO NOT re-record — history reflects user intent, not the
		// resolved source we ended up playing.
		if (!opts?.fromFallback) history.record(track);
		// D-05: auto-expand fires ONLY on explicit fresh user plays — never on auto-advance,
		// failover skip, or queue progression (those call play() without opts.fresh). Fixes the
		// track-change auto-expand bug where the nowbar jumped open on every advance.
		if (opts?.fresh && settings.autoExpandOnPlay) this.expanded = true;
		try {
			// Offline-first: if the track is in library.downloads AND we have its blob cached,
			// skip the network resolve entirely and play straight from the local blob. The
			// blob *is* the audio — no need to fetch a fresh URL just to ignore it again on
			// the route-to-blob branch below. Lets the player work with NO network when a
			// song was downloaded earlier.
			if (library.isDownloaded(track.uid)) {
				const offlineBlob = await blobStore.get(track.uid).catch(() => null);
				if (myGen !== this.playGen) return; // CR-02: superseded mid-IDB-read — discard
				if (offlineBlob && this.audio) {
					if (this.cachedBlobUrl) {
						URL.revokeObjectURL(this.cachedBlobUrl);
					}
					this.cachedBlobUrl = URL.createObjectURL(offlineBlob);
					this.current = { ...track, detailsLoaded: true };
					this.persist();
					// Offline-blob play skips the network resolve — backfill lyrics off the critical
					// path so a downloaded track (whose queue/list entry may carry no lrc) still shows
					// its lyrics in the now-playing view.
					this.fillLyricsOffline(this.current);
					const ms = this.ms;
					if (ms) {
						ms.metadata = makeMetadata({
							title: names.dnTitle(track.title),
							artist: names.dnArtist(track.artist),
							album: track.album,
							artwork: buildArtwork(this.resolvedCover)
						});
						ms.playbackState = 'playing';
					}
					// Initial-load arming point (D-13): a NEW src for this track. Reset the played
					// flag + arm the stall watchdog so a silent no-audio start routes into failover.
					this.hasPlayedSinceSrc = false;
					// RELAX-PREFETCH: a NEW src — re-arm the one-shot delayed prefetch gate so the
					// timeupdate listener fires prefetchNext ~5s into THIS track's playback.
					this.prefetchArmedForSrc = false;
					// Next-song-current-but-paused fix: a NEW src clears any prior autoplay-retry arm.
					this.autoplayRetryArmed = false;
					this.audio.src = this.cachedBlobUrl;
					this.armStall();
					// D-06: a rejected play() is intentionally surfaced to the stall/failure path,
					// not swallowed — if play() rejects (iOS gesture loss) and no `play` event
					// follows, the armed watchdog above routes into runFallback. .catch only prevents
					// an unhandled rejection.
					let rejected = false;
					await this.audio.play().catch(() => {
						rejected = true; // capture the autoplay rejection — see arm below
					});
					// Next-song-current-but-paused fix (offline-blob path): same autoplay-rejection retry
					// as the network path — a non-fresh advance into a downloaded next track can still be
					// autoplay-blocked on mobile. Arm the single gen-guarded re-play when bytes are present.
					if (rejected && !opts?.fresh && this.audio.paused) {
						this.autoplayRetryArmed = true;
						this.maybeRetryAutoplay(myGen);
					}
					this.loading = false;
					// PLAY-09 / D-15: keep up-next topped up + pre-resolve the next track even on the
					// offline-blob path so the ended→next auto-advance into a downloaded queue still
					// prefetches (a no-op resolve for an already-downloaded next track; a real resolve
					// when the next entry is a network track). Best-effort, non-blocking.
					void this.primeNext();
					return;
				}
			}
			const resolved = await ensureTrackDetails(track);
			if (myGen !== this.playGen) return; // CR-02: superseded mid-resolve — discard
			this.current = resolved;
			// keep the queue entry in sync with the resolved track
			const i = this.indexOf(track);
			if (i >= 0) this.queue[i] = resolved;
			// Persist the new current+queue immediately so a reload mid-resolve still has the
			// right track to restore (the throttled timeupdate write covers progress alone).
			this.persist();
			// Cover-chain: a resolve that landed a cover shares it with every same-song
			// library entry + the cover-cache, so home/library tiles stop rendering
			// gradients for songs whose art the player has already fetched.
			if (resolved.cover) {
				library.adoptCover(resolved);
				// COVER-01: ensureTrackDetails resolved a cover the sync set missed (the search stub
				// had none) — adopt it into the single field so the network-path MediaMetadata write
				// below and both UI surfaces show real art without waiting on the async tier chain.
				if (!this.resolvedCover) this.resolvedCover = resolved.cover;
				// quick-260615-hep Site B: ensureTrackDetails fetched a real cover — write BOTH layers + bump
				// so home/library tiles for this song reuse it and repaint live. https-only (T-0bb-01).
				if (httpsOnly(resolved.cover))
					writeCoverBoth(resolved.uid, resolved.artist, resolved.title, resolved.cover);
			}
			if (!resolved.audioUrl) {
				// Cross-source fallback (gte): try other enabled sources before surfacing the
				// error. On success, runFallback() calls play() again with fromFallback:true.
				if (!opts?.fromFallback) {
					this.loading = false;
					void this.runFallback(resolved);
					return;
				}
				this.error = 'toast.playbackStopped'; // WR-07: i18n key, rendered via t()
				this.clearMedia(); // nothing playable — clear the OS media UI (MS-05)
				return;
			}
			// Populate the OS/browser media UI from the RESOLVED track so album/cover
			// are present (MS-01). Titles/artists go through the per-part name resolvers
			// for the active display language (returns the original under SSR/off). Guarded via `ms`.
			const ms = this.ms;
			if (ms) {
				ms.metadata = makeMetadata({
					title: names.dnTitle(resolved.title),
					artist: names.dnArtist(resolved.artist),
					album: resolved.album,
					artwork: buildArtwork(this.resolvedCover)
				});
				ms.playbackState = 'playing';
			}
			if (this.audio) {
				// kyf: prefer the offline blob when the track is in library.downloads AND the
				// blob is still in the IDB cache. A miss / SSR / IDB-unavailable falls through to
				// the CDN URL (never throws). Always revoke the prior Object URL first.
				if (this.cachedBlobUrl) {
					URL.revokeObjectURL(this.cachedBlobUrl);
					this.cachedBlobUrl = null;
				}
				let src: string = resolved.audioUrl;
				if (library.isDownloaded(resolved.uid)) {
					const blob = await blobStore.get(resolved.uid).catch(() => null);
					if (myGen !== this.playGen) return; // CR-02: superseded mid-IDB-read — discard
					if (blob) {
						this.cachedBlobUrl = URL.createObjectURL(blob);
						src = this.cachedBlobUrl;
					}
				}
				// Initial-load arming point (D-13): a NEW src for this track. Reset the played flag +
				// arm the stall watchdog so a silent no-audio start (no `playing`/`timeupdate`
				// within ~15s) routes into failover.
				this.hasPlayedSinceSrc = false;
				// RELAX-PREFETCH: a NEW src — re-arm the one-shot delayed prefetch gate so the
				// timeupdate listener fires prefetchNext ~5s into THIS track's playback.
				this.prefetchArmedForSrc = false;
				// Next-song-current-but-paused fix: a NEW src clears any prior autoplay-retry arm.
				this.autoplayRetryArmed = false;
				this.audio.src = src;
				this.armStall();
				// D-06: a rejected play() is intentionally surfaced to the stall/failure path, not
				// swallowed — if play() rejects (iOS gesture loss after the async resolve) and no
				// `play` event follows, the armed watchdog above routes into runFallback. The .catch
				// only prevents an unhandled rejection; it is NOT a silent no-op.
				let rejected = false;
				await this.audio.play().catch(() => {
					rejected = true; // capture the autoplay rejection — see arm below
				});
				// Next-song-current-but-paused fix: on a NON-fresh advance (auto-advance/next/failover —
				// no fresh user gesture survives the async resolve), a rejected play() with bytes present
				// is an autoplay-policy pause, not a load stall. Arm a single event-driven re-play
				// (canplay seam / readyState gate, gen-guarded) so the next playable track does not sit
				// paused. A FRESH play already has user activation, so it is never armed here.
				if (rejected && !opts?.fresh && this.audio.paused) {
					this.autoplayRetryArmed = true;
					this.maybeRetryAutoplay(myGen); // bytes may already be present — try immediately
				}
			}
			// COVER-01 / D-09: the playing track still has NO art (sync read missed AND the resolve
			// did not carry a cover). Fire the Plan-02 single-item tier chain off the audio critical
			// path — best-effort, never-throw, generation-guarded — so the nowbar/now-playing/lock
			// screen pick up a real cover when one exists, and keep the gradient/favicon when it does
			// not (D-12). Non-blocking: playback never waits on it (T-21-07 accept).
			if (!this.resolvedCover) void this.resolveCoverAsync(resolved, myGen);
			// Fresh play -> per-context sourcing branch (Phase 17, D-03/D-04). 'generated'
			// (global default) regenerates the auto portion from genre-similar songs; 'same-list'
			// keeps the snapshot the caller passed via setQueue (search results / liked list /
			// etc.) and only tops it up on exhaust via ensureAhead (the snapshot still grows when
			// it runs out — D-03). A non-fresh play (auto-advance/failover) never regenerates.
			if (opts?.fresh) {
				// D-10: a fresh user play starts a NEW listening session — clear the swipe-removed
				// exclusion budget BEFORE regenerate so previously-removed songs are eligible again.
				this.removedUids.clear();
				// quick-260615-i9u (Feature B): install the captured history baseline FIRST so the
				// clicked song sits right after the prior current and earlier tracks stay revisitable
				// via prev(). weaveFreshHistory bumps queueGen so any stale in-flight regen/grow
				// discards (WR-06). THEN build the tail per the effective up-next mode.
				this.weaveFreshHistory(resolved);
				if (settings.effectiveUpnextMode(this.queueContext) === 'generated') {
					// generated: regenerate (now history-aware) replaces only the tail after the seed.
					void this.regenerate(resolved).then(() => this.primeNext());
				} else {
					// same-list: setListQueue already installed [seed, ...list-remainder]; weave only
					// PREPENDED history, so the remainder survives as the tail. On exhaust ensureAhead
					// grows it (D-03).
					void this.primeNext();
				}
			} else {
				// quick-260615-i9u (Feature B): a non-fresh advance (next/prev/auto-advance/failover/
				// retry) never weaves — history already lives in the queue array. Null any capture left
				// by a setQueue/setListQueue that is NOT followed by a fresh play so it can't leak into
				// a LATER fresh play.
				this.pendingHistory = null;
				this.pendingManual = null; // quick-260618-fiz (Fix 4): same one-shot discipline
				void this.primeNext();
			}
		} catch (e) {
			this.error = e instanceof Error ? e.message : String(e);
		} finally {
			this.loading = false;
		}
	}

	/**
	 * Best-effort async cover land for the playing track (COVER-01 / D-09). Runs the Plan-02
	 * single-item resolve helper (Deezer → iTunes → CN tier chain; never throws; writes both cache
	 * layers on a SOLID https hit) for a track that arrived with NO art. On a SOLID result, and ONLY
	 * if a newer play() has not superseded this one (generation guard, Pitfall 4 + CR-02):
	 *   - set `this.resolvedCover` so both UI surfaces repaint reactively, and
	 *   - re-fire MediaSession by assigning a BRAND-NEW MediaMetadata object (never mutate artwork in
	 *     place, A2/Pitfall 4) so the OS lock screen repaints — keeping playbackState correct.
	 * On a miss (or a supersede) nothing is written: the gradient + /favicon.svg stand (D-12). This
	 * runs off the audio critical path; playback never waits on it (T-21-07 accept).
	 */
	private async resolveCoverAsync(resolved: Track, myGen: number) {
		let url: string | null = null;
		try {
			url = await resolveCoverForTrack(resolved);
		} catch {
			url = null; // resolveCoverForTrack never throws, but stay defensive — never reject.
		}
		if (myGen !== this.playGen) return; // a newer play() superseded — discard the stale art (T-21-06)
		if (!url) return; // total miss — keep the seeded gradient + favicon (D-12)
		this.resolvedCover = url;
		// quick-260615-hep Site C: resolveCoverForTrack already wrote BOTH cache layers internally — do NOT
		// double-write; only bump the global reactive signal so a late async cover land repaints other tiles.
		bumpCoverVersion();
		const ms = this.ms;
		if (ms) {
			// A FRESH MediaMetadata so the OS repaints the lock-screen art (never an in-place mutate).
			ms.metadata = makeMetadata({
				title: names.dnTitle(resolved.title),
				artist: names.dnArtist(resolved.artist),
				album: resolved.album,
				artwork: buildArtwork(this.resolvedCover)
			});
			ms.playbackState = playbackStateFor(!!this.current, this.playing);
		}
	}

	/**
	 * quick-260615-i9u (Feature B): install the captured history prefix in FRONT of the just-installed
	 * seed+tail baseline, so a fresh user click preserves prior playback instead of wiping it. New
	 * queue shape becomes [...history(capped, prior current last), clickedSong (new current), ...tail].
	 * Called from play()'s fresh-branch AFTER setQueue/setListQueue already put the seed snapshot in
	 * this.queue. Bumps queueGen BEFORE the generated-branch regenerate snapshots its guard (WR-06), so
	 * any PRIOR play's in-flight regenerate/ensureAhead grow discards while THIS play's own tail build
	 * passes its guard. Consumes pendingHistory once (nulls it).
	 */
	private weaveFreshHistory(seed: Track): void {
		let prefix = this.pendingHistory ?? [];
		// De-dupe the seed out of the prefix so a RE-CLICK of an already-played song MOVES it to the
		// new-current position rather than duplicating it in history.
		prefix = prefix.filter((t) => t.uid !== seed.uid && !sameSongKey(t, seed));
		// Anchor the seed into the current post-snapshot queue (seed+tail), then prepend the prefix.
		// Because prefix has the seed removed and the baseline starts at the seed, the seed lands
		// immediately AFTER the prefix (i.e. right after the prior current) — the insert-after-current
		// position. queueWithAnchor's dedupe preserves first-occurrence order + force-keeps the seed.
		const baseline = this.queueWithAnchor(this.queue, seed);
		this.queueGen++; // WR-06: explicit re-install supersedes any stale in-flight regen/grow
		this.queue = this.queueWithAnchor([...prefix, ...baseline], seed);
		this.pendingHistory = null; // consumed
		// quick-260618-fiz (Fix 4): re-insert the user's explicit manual entries (captured before the
		// queue wipe) right AFTER the seed, so a fresh-play context switch preserves play-next/
		// add-to-queue picks while the prior AUTO/context tail (the rest of `baseline`) is replaced by
		// the per-mode tail build below. Runs in BOTH up-next modes (generated re-runs regenerate's
		// own manual filter over this woven queue; same-list keeps these after the seed ahead of the
		// list remainder). Re-reads this.queue at write time (Pitfall 1 — never a closed-over snapshot).
		this.weaveManualAfterSeed(seed);
	}

	/**
	 * quick-260618-fiz (Fix 4): splice the captured explicit-manual entries (pendingManual) into the
	 * current queue immediately after `seed`, deduped against what is already present and against the
	 * woven history head (everything up to+including the seed). manualUids stays the provenance
	 * source; pendingManual just carries the Track objects across the queue wipe. Consumes
	 * pendingManual. Bumps queueGen so any in-flight regen/grow that snapshotted an earlier gen
	 * discards (WR-06).
	 */
	private weaveManualAfterSeed(seed: Track): void {
		const carried = this.pendingManual ?? [];
		this.pendingManual = null; // consumed
		if (!carried.length) return;
		const i = this.indexOf(seed);
		const head = i >= 0 ? this.queue.slice(0, i + 1) : [seed];
		const tail = i >= 0 ? this.queue.slice(i + 1) : this.queue.filter((t) => t.uid !== seed.uid);
		const headUids = new Set(head.map((t) => t.uid));
		// Keep only carried entries still flagged manual, not in the head, and not already in the tail.
		const tailUids = new Set(tail.map((t) => t.uid));
		const manual = carried.filter(
			(t) => this.manualUids.has(t.uid) && !headUids.has(t.uid) && !tailUids.has(t.uid)
		);
		if (!manual.length) return;
		this.queueGen++; // WR-06: explicit re-install supersedes any stale in-flight regen/grow
		this.queue = this.queueWithAnchor([...head, ...manual, ...tail], seed);
	}

	/**
	 * Rebuild the AUTO portion of Up-Next from songs similar to `seed`, preserving the
	 * seed (current) + manual entries in their existing order. Best-effort: on any
	 * failure the queue is left as-is. Only invoked on a fresh user-initiated play.
	 *
	 * quick-260615-i9u (Feature B): history-aware. Keeps EVERYTHING in this.queue up to AND INCLUDING
	 * the seed (the woven history prefix + prior current + seed) and replaces only the tail AFTER the
	 * seed with freshly generated similar picks. The head uids feed the buildSimilarQueue exclude set
	 * so generated picks never duplicate history.
	 */
	private async regenerate(seed: Track) {
		// WR-06: snapshot the queue generation. If an explicit setQueue() lands while
		// buildSimilarQueue is in flight (e.g. playAlbum installing the full album list),
		// that explicit queue wins — this regenerate's result is stale and must be discarded.
		const myQueueGen = this.queueGen;
		try {
			// quick-260615-i9u: the HEAD is everything up to+including the seed (woven history + seed);
			// only the tail after the seed is regenerated.
			const i = this.indexOf(seed);
			const head = i >= 0 ? this.queue.slice(0, i + 1) : [seed];
			const headUids = new Set(head.map((t) => t.uid));
			const manualEntries = this.queue.filter(
				(t) => this.manualUids.has(t.uid) && !headUids.has(t.uid)
			);
			// Union removedUids (Phase 17, D-10) + the history head uids (quick-260615-i9u) so the
			// regenerated auto portion never reintroduces a swiped-away song NOR duplicates history.
			const exclude = new Set<string>([
				...headUids,
				...manualEntries.map((t) => t.uid),
				...this.removedUids
			]);
			const auto = await buildSimilarQueue(seed, exclude);
			if (myQueueGen !== this.queueGen) return; // WR-06: superseded by an explicit setQueue()
			this.queue = this.queueWithAnchor([...head, ...manualEntries, ...auto], seed);
		} catch {
			/* leave queue as-is */
		}
	}

	toggle() {
		this.abortFade(); // D-05: a play/pause gesture during a fade aborts the sleep stop
		if (!this.audio) return;
		if (this.audio.paused) this.audio.play().catch(() => {});
		else this.audio.pause();
	}

	/**
	 * PLAY-RESILIENCE: first queue index strictly after `from` whose track is NOT confirmed-unplayable
	 * (prefetchNext's probe walk records dead uids in unplayableUids). Returns -1 if every entry ahead
	 * is known-dead or there is nothing ahead. This is what next()/track-end advance use so playback
	 * routes PAST a known-dead up-next entry instead of stalling on it.
	 */
	private nextPlayableIndex(from: number): number {
		for (let k = from + 1; k < this.queue.length; k++) {
			if (!this.unplayableUids.has(this.queue[k].uid)) return k;
		}
		return -1;
	}

	/**
	 * quick-260615-i9u (Feature A): reactive read of the probe-confirmed-dead set. The Up-Next list
	 * calls this per-row inside its template — because unplayableUids is a SvelteSet, the read is
	 * tracked, so the row repaints (dims + shows ✗) the instant prefetchNext marks the uid dead and
	 * un-dims when retry/recover clears it. PUBLIC, read-only accessor (the set itself stays private).
	 */
	isUnplayable(uid: string): boolean {
		return this.unplayableUids.has(uid);
	}

	/**
	 * quick-260615-i9u (Feature A): tap-to-retry a ✗ skipped Up-Next row. Clears the uid from the
	 * dead set (un-dims the row reactively) and replays THAT EXACT track via the NON-fresh path
	 * (no fresh regenerate — a retry of the same song, history/queue untouched). A transient failure
	 * can recover this way; a definitively-dead track simply re-skips via the resilience chain
	 * (prefetchNext re-marks it / next() routes past it) — acceptable per CONTEXT A (T-i9u-01: the
	 * re-skip is bounded by the existing PREFETCH/FAILURE caps, not a new unbounded loop).
	 */
	retryUnplayable(track: Track): void {
		this.unplayableUids.delete(track.uid);
		this.clearStrike(track.uid); // over-aggressive-skip fix: a manual retry resets the strike budget too
		void this.play(track, { fresh: false });
	}

	next() {
		this.abortFade(); // D-05: a skip gesture during a fade aborts the sleep stop
		const i = this.indexOf(this.current);
		const j = this.nextPlayableIndex(i);
		if (j >= 0) {
			this.play(this.queue[j]);
			return;
		}
		// No playable track ahead in the current queue (end-of-queue, or the whole tail is known-dead).
		// D-10/D-12: no repeat-all wrap — auto-generated up-next is the continuation. Grow via
		// ensureAhead, then advance to the first PLAYABLE freshly-added track. Never silently no-op on
		// a dead/exhausted tail (that was the stall): with sources truly dry ensureAhead adds nothing
		// and there is genuinely nothing to play, so the reactive never-stop chain owns the stop.
		void this.ensureAhead().then(() => {
			const k = this.indexOf(this.current);
			const n = this.nextPlayableIndex(k);
			if (n >= 0) this.play(this.queue[n]);
		});
	}

	prev() {
		this.abortFade(); // D-05: a prev gesture during a fade aborts the sleep stop
		// restart if >3s in, else previous track
		if (this.audio && this.audio.currentTime > 3) {
			this.audio.currentTime = 0;
			return;
		}
		// quick-260615-i9u (Feature B): history now lives in the queue array (a fresh click weaves the
		// prior current + earlier tracks BEFORE the new current), so indexOf(current) > 0 after a click
		// and this back-walk replays the prior current / earlier tracks. The play() is NON-fresh, so
		// prev() never re-weaves/regenerates — it just steps backward through the preserved history.
		const i = this.indexOf(this.current);
		if (i > 0) this.play(this.queue[i - 1]);
		else if (this.audio) this.audio.currentTime = 0;
	}

	/**
	 * Toggle shuffle (gte). Turning ON: Fisher-Yates the queue slice AFTER indexOf(current)+1.
	 * Current track + everything before it (history) stay pinned. Turning OFF: leave the queue
	 * as-is (user-specified — we do NOT restore the original order). Idempotent on empty/single
	 * queues. Bumps reactivity via a fresh array reference.
	 */
	toggleShuffle() {
		const next = !this.shuffle;
		this.shuffle = next;
		if (!next) { this.persist(); return; }
		// quick-260615-i9u (Feature B): reads indexOf(current) LIVE, so with history now preserved in
		// the queue the shuffle still pins the current track + ALL history before it and only the auto
		// tail shuffles — correct after the model change. repeat-one never advances, so it is unaffected.
		const i = this.indexOf(this.current);
		const start = (i >= 0 ? i : -1) + 1; // shuffle everything strictly after current
		if (start >= this.queue.length - 1) { this.persist(); return; }
		const arr = [...this.queue];
		// Fisher-Yates over [start, arr.length). Use ((Date.now() ^ idx) % range) is not a real
		// CSPRNG — but Math.random() is fine for queue-shuffle UX.
		for (let k = arr.length - 1; k > start; k--) {
			const j = start + Math.floor(Math.random() * (k - start + 1));
			[arr[k], arr[j]] = [arr[j], arr[k]];
		}
		this.queue = arr;
		this.persist();
	}

	/** Toggle the repeat mode (PLAY-10 / D-10): off → one → off (no repeat-all). */
	cycleRepeat() {
		this.repeatMode = this.repeatMode === 'off' ? 'one' : 'off';
		this.persist();
	}

	/**
	 * Cross-source fallback driver (gte / SRC-FB-01). Capture the generation at the moment
	 * we start the fallback; abort + bail if a newer play() bumps it (e.g. user tapped the
	 * next song). On success, recurse play() with fromFallback:true so the inner play() does
	 * NOT re-record history and does NOT bump the generation. On exhaustion, surface the
	 * existing error. Never throws — tryFallback() is defensively wrapped.
	 */
	/** Normalized title+artist key identifying a logical song for the per-episode attempted set
	 *  (CR-03). Lowercased/trimmed; the exact normalization grain doesn't matter as long as the
	 *  same song hashes the same across its cross-source variants (which share title+artist). */
	private episodeKey(t: Track): string {
		return `${t.artist}${PENDING_KEY_SEP}${t.title}`.toLowerCase().trim();
	}

	private async runFallback(failed: Track) {
		// D-08 offline gate (Pitfall 1): if the device is offline, do NOT enter the failure chain.
		// Network failover would just 0-for-N against unreachable proxies and — critically — must
		// NOT burn the loop-guard counter (offline ≠ a track that failed all sources). Hand off to
		// the offline path (switch up-next to downloads, or pause with an offline notice) and return
		// BEFORE the consecutive-failure increment in handleTotalFailure ever runs.
		if (typeof navigator !== 'undefined' && navigator.onLine === false) {
			this.handleOffline();
			return;
		}
		const gen = this.playGen;
		// WR-01 re-entrancy guard: only ONE failover per generation. Both the stall watchdog and the
		// `error` listener route here, and a fallback's play(swap, fromFallback) deliberately does
		// NOT bump the gen — so a watchdog fire at 15s and a slow error at 16s could otherwise run
		// two concurrent fallbacks at the SAME gen (double swap onto audio.src, or double counter
		// increment + two skipped tracks for one failure). Bail if one is already in flight here.
		if (this.fallbackGen === gen) return;
		this.fallbackGen = gen;
		// CR-03 per-episode attempted set: a NEW logical song failing over starts a fresh set
		// (seeded with the source that just failed). A continuation of the SAME song (the A↔B
		// ping-pong) keeps accumulating into the existing set so each source is tried at most once.
		const key = this.episodeKey(failed);
		if (this.fallbackEpisodeKey !== key) {
			this.fallbackEpisodeKey = key;
			this.fallbackAttempted = new Set<SourceId>();
		}
		this.fallbackAttempted.add(failed.source);
		this.loading = true;
		this.error = null;
		const ac = new AbortController();
		// If a newer play() bumps the gen mid-search, abort the in-flight searchAll +
		// ensureTrackDetails so we don't burn the network on a stale attempt. The next
		// gen-check below stops us from clobbering the newer track.
		const watchdog = setInterval(() => {
			if (this.playGen !== gen) ac.abort();
		}, 200);
		try {
			const swap = await tryFallback(
				failed,
				settings.preferredSource,
				ac.signal,
				this.fallbackAttempted
			);
			if (this.playGen !== gen) return; // a newer play() supersedes — discard silently
			if (swap) {
				// Sync the queue slot too so next()/prev() walk the resolved track.
				const i = this.indexOf(failed);
				if (i >= 0) this.queue[i] = swap;
				await this.play(swap, { fromFallback: true });
				return;
			}
			// Every remaining source exhausted for THIS song. Instead of just surfacing the error
			// and stopping (the old behavior), run the never-stop policy (PLAY-07 / D-02, D-04,
			// D-05, D-12): break a failing repeat-one loop, count the failure, then either auto-skip
			// to the next track (below the cap) or trip the loop-guard and STOP with a sticky Retry
			// notice (at the cap). The finally below clears loading for the loop-guard stop; the
			// skip path's next()→play() bumps playGen and owns loading from there.
			this.handleTotalFailure(failed);
		} finally {
			clearInterval(watchdog);
			// Release the re-entrancy guard only if it still belongs to THIS generation (a newer
			// play()/fallback may have already claimed a fresh gen).
			if (this.fallbackGen === gen) this.fallbackGen = -1;
			if (this.playGen === gen) this.loading = false;
		}
	}

	/**
	 * Never-stop total-failure policy (PLAY-07/08 / D-02, D-04, D-05, D-12). Called from
	 * runFallback when EVERY source is exhausted for the current song. NOT called when offline —
	 * the offline gate short-circuits before any failure is counted (D-08), so an offline dry spell
	 * never burns the loop-guard budget.
	 *
	 *  - D-12: a failing repeat-one loop breaks repeat first (never-stop wins over explicit repeat),
	 *    so we don't loop a dead track forever.
	 *  - The failure is counted. At/over the cap (D-04) we STOP: pause, set a sticky loop-guard
	 *    notice carrying a Retry action (recoverFromStop), keep `error` for the inline now-bar, and
	 *    do NOT advance. Below the cap (D-02) we emit a batched skip notice and auto-skip via next().
	 *
	 * The skip path goes through the existing next() → play() which bumps playGen, so a user manual
	 * skip mid-failover supersedes correctly (Pitfall 2) — there is NO parallel fast-skip path.
	 */
	private handleTotalFailure(failed: Track) {
		// D-12: never-stop wins over explicit repeat — break a repeat-one loop on a failing track so
		// it doesn't loop a dead song forever, then continue with the skip/up-next path.
		if (this.repeatMode === 'one') {
			this.repeatMode = 'off';
			this.persist();
		}
		this.consecutiveFailures++;
		// WR-07: store an i18n KEY (the now-bar/NowPlaying render it via t()) so the inline error
		// matches the localized toast for the same event instead of raw English.
		this.error = 'toast.playbackStopped';
		// if (this.consecutiveFailures >= Player.FAILURE_CAP) {
		// 	this.tripLoopGuard();
		// 	return;
		// }
		// D-02 below the cap: emit a batched skip notice and auto-skip to the next track.
		this.emitSkipNotice(failed.title);
		this.next();
	}

	/**
	 * D-04 loop-guard STOP: stop auto-advancing, pause, clear the OS media UI, and surface ONE
	 * sticky Retry notice (recoverFromStop skips ahead + resets + re-arms, D-05). Extracted so both
	 * the consecutive-failure cap (handleTotalFailure) and the raw audio-error burst cap (CR-03, the
	 * resolve-but-unplayable ping-pong backstop) can trip the guard directly. Always sets the inline
	 * error key too (WR-07).
	 */
	// private tripLoopGuard() {
	// 	this.consecutiveFailures = Player.FAILURE_CAP; // pin at the cap (idempotent across callers)
	// 	this.error = 'toast.playbackStopped';
	// 	this.audio?.pause();
	// 	this.clearMedia();
	// 	this.notice = {
	// 		kind: 'stopped',
	// 		reason: 'loop-guard',
	// 		msg: 'toast.playbackStopped',
	// 		action: () => this.recoverFromStop()
	// 	};
	// }

	/**
	 * Recovery from the loop-guard stopped state (D-05). Bound to the sticky notice's Retry action
	 * and reused by a user "tap play" recovery: skip AHEAD to the next track (NOT retry-current, NOT
	 * regenerate), reset the consecutive-failure counter, and re-arm the never-stop chain. next()
	 * bumps playGen via play(), so this correctly supersedes any stale in-flight fallback.
	 */
	private recoverFromStop() {
		this.consecutiveFailures = 0;
		this.errorBurst = 0;
		// CR-03: re-arm — drop the per-episode attempted set so the skipped-ahead track gets a full
		// fresh set of sources to try.
		this.fallbackEpisodeKey = null;
		this.fallbackAttempted = new Set<SourceId>();
		// PLAY-RESILIENCE: a manual recovery re-arms everything — drop the probe-confirmed dead set so
		// previously-sidelined tracks get a fresh chance on the way out of the stopped state.
		this.unplayableUids.clear();
		this.unplayableStrikes.clear(); // over-aggressive-skip fix: a full recovery resets the strike budget too
		if (this.notice?.kind === 'stopped') this.notice = null;
		this.next();
	}

	/**
	 * Emit a batched auto-skip notice (D-02). N consecutive skips within SKIP_BURST_WINDOW_MS
	 * collapse into ONE notice carrying the running `count` (so the UI shows "{count} songs
	 * skipped" rather than N stacked toasts). Each skip (re)starts the debounce; when it elapses
	 * with no further skip the burst counter resets so the NEXT isolated failure starts at 1.
	 */
	private emitSkipNotice(title: string) {
		this.skipBurst++;
		this.notice = {
			kind: 'skip',
			// WR-03: emit the REAL toast key the host renders (singular vs the batched plural),
			// not a phantom `player.notice.skip` token that exists in no dictionary.
			msg: this.skipBurst > 1 ? 'toast.skippedMany' : 'toast.skipped',
			count: this.skipBurst,
			title
		};
		if (this.skipBurstTimer) clearTimeout(this.skipBurstTimer);
		this.skipBurstTimer = setTimeout(() => {
			this.skipBurst = 0;
			this.skipBurstTimer = null;
			// WR-04: clear the channel when the burst window closes so `player.notice` reflects
			// "nothing to show". Previously only 'stopped' notices were ever cleared, leaving a
			// stale 'skip' object that the layout effect (which tracks t()/appLang) would re-toast
			// out of nowhere on a later language switch or remount.
			if (this.notice?.kind === 'skip') this.notice = null;
		}, Player.SKIP_BURST_WINDOW_MS);
	}

	/**
	 * Offline path (PLAY-09 / D-07, D-08, D-09). Reached only from the runFallback offline gate, so
	 * the consecutive-failure counter is NEVER touched here (offline ≠ failure, D-08). Scope note
	 * (D-09): this is the PLAYER's offline switch only — app-shell / service-worker / offline route
	 * guards are Phase 24, not here.
	 *
	 *  - D-07: if the user has downloaded tracks not already in the current queue, switch up-next to
	 *    them (most-recent-download-first, deduped) and continue playing from the first one. play()'s
	 *    existing offline-blob branch streams it from the IndexedDB blob with no network, reusing the
	 *    single cachedBlobUrl revoke discipline (Pitfall 13) — no new object URL is minted here.
	 *  - D-08: if there are NO downloads to fall back to, pause and surface a sticky offline notice;
	 *    do not auto-advance into a dead network.
	 */
	private handleOffline() {
		this.loading = false;
		const have = new Set<string>([
			...this.queue.map((t) => t.uid),
			...(this.current ? [this.current.uid] : [])
		]);
		const offline = buildOfflineQueue(library.downloads, have);
		if (offline.length > 0) {
			// D-07: switch up-next to the downloaded tracks and continue. dedupeBest gives a fresh
			// array reference (reactivity) and collapses any cross-source duplicates. play() bumps
			// playGen, so a user gesture mid-switch still supersedes correctly.
			this.queue = dedupeBest([...(this.current ? [this.current] : []), ...offline], settings.preferredSource);
			void this.play(offline[0]);
			return;
		}
		// D-08: nothing downloaded to play — pause and show a sticky offline notice (no Retry action;
		// playback resumes naturally when connectivity returns and the user taps play).
		this.audio?.pause();
		// WR-07: i18n key (rendered via t()); WR-03: msg is the real toast key, not a phantom token.
		this.error = 'toast.offlineNoDownloads';
		this.notice = { kind: 'stopped', reason: 'offline', msg: 'toast.offlineNoDownloads' };
	}

	/**
	 * Move a queue entry from `from` to `to` (clamped) and pin the moved track as
	 * manual so the next fresh-play regeneration preserves it. No-op if indices are
	 * out of range or equal.
	 */
	reorderQueue(from: number, to: number) {
		const n = this.queue.length;
		if (from < 0 || from >= n) return;
		const target = Math.max(0, Math.min(n - 1, to));
		if (target === from) return;
		const next = [...this.queue];
		const [moved] = next.splice(from, 1);
		next.splice(target, 0, moved);
		this.queue = next;
		this.manualUids.add(moved.uid); // reordered = pinned manual
		this.persist(); // WR-05: every queue mutation persists — a reload keeps the user's order
	}

	/** Seek to a fraction [0,1] of the track. */
	seekFraction(frac: number) {
		this.abortFade(); // D-05: a seek gesture during a fade aborts the sleep stop
		if (!this.audio) return;
		// lw9-followup: stamp the seek time so a sympathetic audio.error fired by the same
		// seek (past-buffered-range on a non-range-capable CDN) doesn't kick off runFallback().
		this.lastSeekAt = Date.now();
		const clamped = Math.max(0, Math.min(1, frac));
		if (Number.isFinite(this.audio.duration) && this.audio.duration > 0) {
			// Duration is known — apply immediately + clear any pending restore-seek so the
			// loadedmetadata listener doesn't overwrite the user's intent later.
			this.audio.currentTime = clamped * this.audio.duration;
			this.pendingSeek = null;
		} else {
			// Metadata not loaded yet (fresh post-restore audio.src, or just-set src). Park the
			// target on pendingSeek so the loadedmetadata listener applies it the moment
			// duration lands.
			this.pendingSeekFrac = clamped;
		}
		// fab67f8-followup: if audio is paused (typical post-restore state — restore() doesn't
		// auto-play due to browser policy), the audio element hasn't started downloading
		// anything yet; just setting currentTime makes the browser snap back to 0 on the next
		// read because nothing is buffered to seek INTO. Kick off play() so the browser
		// actually fetches the byte range around the seek target. Matches industry behavior
		// (clicking the seek bar implies "play from here"). The user gesture from the click
		// satisfies autoplay restrictions.
		if (this.audio.paused) {
			void this.audio.play().catch(() => {
				/* autoplay rejected (rare on click) — user can tap play */
			});
		}
	}

	expand() {
		if (this.current) this.expanded = true;
	}
	collapse() {
		this.expanded = false;
	}
}

export const player = new Player();
