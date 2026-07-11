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
import { resolveCoverForTrack, resolveDeezerHQ } from '$lib/services/cover-backfill';
// quick-260615-hep: feed every displayed now-playing cover into the shared cache (both layers) +
// bump the global reactive signal so other surfaces (homepage tiles) reuse the art and repaint live.
// quick-260704-20e: removeCoverBoth evicts a DEAD current cover before healCover re-resolves it.
// cover-hero-mediacard-missing (Issue 2, media-card fix): readCoverByUidOrName lets syncMetadata build
// the OS media-card artwork from the SHARED cover cache (uid-first → name), so a cover that landed via
// another surface after resolveCoverAsync's null+gen-guarded window still reaches the lock screen. No
// new module edge / no cycle: this store already imports from cover-version.svelte, which imports only
// the pure cover-cache (never the player).
import {
	writeCoverBoth,
	bumpCoverVersion,
	removeCoverBoth,
	readCoverByUidOrName
} from '$lib/stores/cover-version.svelte';
// quick-260704-3ov: the pure serialize/parse codec was extracted out of this god-object into
// a colocated, node-tested module (the "runes store thinly wraps a pure helper" precedent).
import { STATE_KEY, serializePlayerState, parsePlayerState } from '$lib/stores/player-persist';

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
// quick-260630-sgw: verbose action log. logAction is a tiny never-throw fn (the store imports the
// player NOT vice-versa — no cycle). Calls below are ADDITIVE diagnostics: side-effect-free w.r.t.
// playback, NEVER on the timeupdate firehose.
import { logAction } from '$lib/stores/actionLog.svelte';
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
	 *  surface a sticky Retry notice instead of auto-advancing again (D-04). Also reused as the
	 *  ABSOLUTE raw-audio-error ceiling (debug-nowbar-freeze-reresolve-loop). */
	private static FAILURE_CAP = 5;
	/**
	 * SYSTEMIC-FAILURE SKIP CEILING (debug-nowbar-frozen-audius-spam). Counts CONSECUTIVE
	 * failure-driven auto-skips — the raw-audio-error ceiling AND handleTotalFailure — that reached NO
	 * real `playing`. The existing per-track guards each bound ONE track (STRIKE_CAP → dead uid, the
	 * errorBurst/rapid ceiling → skip THIS track, the per-episode fallback set → try each source once),
	 * but NOTHING bounded the WHOLE-QUEUE case: under a systemic outage (region-lock, dead/rate-limited
	 * source) every track 403s, so the never-stop chain skips → resolves (qq/detail) → auto-grows
	 * (buildSimilarQueue = 8× searchAll) → prefetches, on and on. Each cycle fires a fresh burst of
	 * /api/* requests; with no ceiling they pile up until the browser connection pool saturates and the
	 * app freezes — the TRUE driver of this bug (the api-base governor only caps the blast radius). Once
	 * this many DISTINCT tracks fail back-to-back with zero successful playback, the situation is
	 * systemic and churning only spams, so haltRunawayRecovery() STOPS (pause + sticky Retry) instead of
	 * advancing again.
	 *
	 * This is NOT the false-positive STOP that debug-nowbar-freeze-reresolve-loop disabled: THAT tripped
	 * on a SYNCHRONOUS rapid-error storm on a SINGLE track (a transient CDN blip re-erroring in a tight
	 * loop). THIS trips only after N SEPARATE tracks each fail with no audio in between — a genuine
	 * systemic signal a transient blip cannot reach, because a single real `playing` resets the counter.
	 * Recovery is the existing recoverFromStop (Retry): skip ahead, drop the dead sets, re-arm.
	 * Plain field (not $state) — internal loop-guard budget, never read reactively by the UI.
	 */
	private failoverSkips = 0;
	private static SYSTEMIC_SKIP_CAP = 5;
	/** RAPID-FIRE BRAKE window (debug-nowbar-freeze-reresolve-loop). Two consecutive audio `error`
	 *  events closer together than this — with NO intervening real `playing` — cannot be two distinct
	 *  network failures: a fresh detail re-resolve + a full `<audio>` load simply cannot complete this
	 *  fast. Errors inside this window are therefore a SYNCHRONOUS re-attach storm (a revoked/instantly
	 *  -403 blob: URL, a cache-instant re-resolve, or a same-tick re-drive), which is what pegs the
	 *  main thread and freezes the whole app. 400ms is comfortably longer than any real resolve+load
	 *  and far shorter than the gap between genuine transient failures. */
	private static RAPID_ERROR_WINDOW_MS = 400;
	/** How many CONSECUTIVE rapid (sub-RAPID_ERROR_WINDOW_MS) errors are tolerated before the handler
	 *  stops re-driving recovery and force-skips. 3 lets a legitimate one-shot fast re-resolve recover
	 *  (error → reresolve → playing) while cutting a true synchronous loop off after a couple of turns,
	 *  long before it can burn measurable CPU. */
	private static RAPID_ERROR_CAP = 3;
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
	 * SINGLE AUDIO.SRC AUTHORITY + RE-DRIVE BRAKE (debug-song-click-lrc-flood-noplay). All roads that
	 * attach a new stream go through driveSrc(), which is the ONE place `audio.src` is set for playback
	 * (the offline-blob / restore paths aside). The observed "api loop hell" was the SAME track's src
	 * re-driven in a tight loop — `<audio>` requests `(canceled)` before firing `error`, so the
	 * error-based ceiling (errorBurst / failoverSkips) NEVER engaged and the flood was unbounded. This
	 * brake counts rapid re-sets of the SAME uid with NO real `playing` between: distinct uids (normal
	 * fast-skipping) never trip it; a same-uid re-drive storm (a reactive re-entry or a recovery
	 * ping-pong) trips it → STOP (haltRunawayRecovery) with a logged trigger, so a stream that cannot
	 * start is surfaced as a Retry instead of pinning the app. Reset by a real `playing` (output = not
	 * looping) and recoverFromStop. Plain fields — internal, never read reactively. */
	private lastDriveUid: string | null = null;
	private lastDriveAt = 0;
	private driveBurst = 0;
	private static SRC_REDRIVE_WINDOW_MS = 1500;
	private static SRC_REDRIVE_CAP = 4;
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
	/** RAPID-FIRE BRAKE state (debug-nowbar-freeze-reresolve-loop). `lastAudioErrorAt` is the wall-clock
	 *  time of the previous audio `error`; `rapidErrorBurst` counts CONSECUTIVE errors that fired inside
	 *  RAPID_ERROR_WINDOW_MS of the one before (a synchronous re-attach storm). A normally-spaced error
	 *  resets `rapidErrorBurst` to 0; a real `playing` and a fresh play() reset both. Plain fields —
	 *  internal loop-guard budget, never read reactively by the UI. */
	private lastAudioErrorAt = 0;
	private rapidErrorBurst = 0;
	/**
	 * SINGLE-RETRY GUARD (debug-reresolve-loop-stops-playback → simplified in debug-midplay-stall-background):
	 * count of consecutive post-playback in-place `reresolveCurrent()` attempts for the current src
	 * WITHOUT an intervening real `playing`. A track that produced audio then errored gets exactly ONE
	 * same-src re-resolve (recovers a genuinely transient mid-track buffer/CDN blip without restarting the
	 * song); a second error before any `playing` means the URL is persistently dead (e.g. a netease
	 * region-lock byte-stream 403), so the error path STOPS re-resolving and falls through to the
	 * cross-source fallback + advance (SKIP), per the never-stop spec. Reset to 0 on a real `playing`, a
	 * new src (play()), and recoverFromStop. */
	private reresolveBurst = 0;
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

	/** quick-260618-lsw: the uid the Up-Next LIST is anchored to. NowPlaying slices the queue from
	 *  THIS uid's live index (resolved by findIndex each render), NOT from the live current index —
	 *  so an auto-advance (which advances `current` but leaves this put) keeps the just-played song
	 *  in the list; only the now-playing highlight moves down a row. Set ONLY on a fresh user play
	 *  (`play({fresh})`) and on a new-list install (setQueue/setListQueue/clearQueue); deliberately
	 *  NOT touched by next()/prev()/auto-advance/failover/manual inserts so the slice start stays put
	 *  as the highlight moves. PUBLIC because NowPlaying reads it reactively. Session-scoped VIEW
	 *  anchor — intentionally NOT persisted (a reload re-derives it on the first play; NowPlaying's
	 *  clamp falls back to the live current index when it is null/absent). */
	upNextAnchorUid = $state<string | null>(null);

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

	/** quick-260704-20e: one-shot guard for healCover — keyed on `${uid}|${resolvedCover}`. An
	 *  errored current-cell background paint re-fires the NowPlaying $effect, so without this a dead
	 *  URL would re-probe forever (T-20e-02 DoS). Mirrors lazyCover's per-row `done` flag: the key is
	 *  added BEFORE probing so the second call short-circuits. Cleared at play() entry — a genuine
	 *  track change invalidates prior heals and keeps the set from growing unbounded. Plain field. */
	private healProbed = new Set<string>();

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

	/** Write the persistable slice of player state to localStorage. Called immediately on
	 *  imperative state changes (play/setQueue/toggleShuffle/cycleRepeat) and throttled to
	 *  ~2s on the audio `timeupdate` firehose. SSR-safe + try/catch-guarded.
	 *  quick-260704-3ov: the pure string build (whitelist strip + `v:1` envelope) now lives in
	 *  serializePlayerState — this method keeps only the Player-owned shell (browser guard,
	 *  no-current removeItem branch, try/catch). Persisted bytes are unchanged. */
	private persist() {
		if (!browser) return;
		if (!this.current) {
			try { localStorage.removeItem(STATE_KEY); } catch { /* ignore */ }
			return;
		}
		try {
			localStorage.setItem(
				STATE_KEY,
				serializePlayerState({
					current: this.current,
					queue: this.queue,
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
		// quick-260704-3ov: the pure parse (JSON.parse-in-try/catch, the `!raw` and `!current.uid`
		// null gates, reshape defaults, seek clamp, and the D-11 repeatMode migration) now lives in
		// parsePlayerState — which returns null for EVERY one of the old early-return cases, so the
		// single `if (!parsed) return;` below is behavior-identical to the old three early-returns.
		const parsed = parsePlayerState(localStorage.getItem(STATE_KEY));
		if (!parsed) return;
		const target = parsed.current;
		const seek = parsed.seek;
		this.queue = parsed.queue;
		this.shuffle = parsed.shuffle;
		this.repeatMode = parsed.repeatMode;
		this.current = target;
		// cover-hero-mediacard-missing (Issue 2 + Issue 1): the restore path never calls play(), so
		// without this the OS media card had no metadata on a PWA reopen → it fell back to the bare
		// app name once the user resumed. Seed the ONE cover field (mirrors play()'s sync seed: track
		// cover → uid cache → name cache) so the hero/nowbar paint any known cover, THEN write the
		// media metadata from the restored track so title/artist are present the moment playback resumes.
		this.resolvedCover =
			target.cover ??
			getCachedCoverByUid(target.uid) ??
			getCachedCover(target.artist, target.title) ??
			null;
		this.syncMetadata();
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
			// SINGLE AUTHORITY (debug-song-click-lrc-flood-noplay): re-attach through the braked setter
			// so a reresolve that keeps re-driving the same dead src is bounded → STOP, not a flood.
			if (!this.driveSrc(resolved.uid, src)) return;
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
	/**
	 * RESOLVE-PHASE WATCHDOG (26-06 / gap-1 BLOCKER, RESOLVE-02). Distinct from STALL_TIMEOUT_MS: the
	 * stall watchdog covers the audio LOAD phase (src set, no `playing`); THIS bounds the earlier
	 * NETWORK RESOLVE phase — the `ensureTrackDetails(track)` await in play(), BEFORE any src is set. A
	 * tapped song whose upstream resolve stalls (a qijieya/qq flake) used to sit in `loading` up to
	 * apiFetch's ~25s REQUEST_TIMEOUT_MS with NO cross-source fallback and NO skip (the UAT hang: a
	 * fresh qq tap logged `play` then nothing — no resolve.ok/fail/fallback/skip — for 23s). On elapse
	 * the in-flight resolve is aborted and the SAME song is routed into the existing kuwo-first
	 * cross-source walk (runFallback → tryFallback → handleTotalFailure auto-skip). Intended band ~5-8s:
	 * comfortably UNDER the ~25s apiFetch timeout (so a stall fails fast) and comfortably OVER a healthy
	 * sub-2s resolve (so the happy path never trips it and never fans out). Private static tunable. */
	private static RESOLVE_WATCHDOG_MS = 6000;
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

	/**
	 * EXTERNAL-PAUSE SELF-HEAL (autoadvance-pauses-after-1s). On Android Chrome a genuinely-playable
	 * track — typically right after an auto-advance src swap — plays ~1s then gets PAUSED by an
	 * external event (audio-focus loss to a transient notification sound, background/lock-screen power
	 * throttle, or a transient suspend during the swap). The element fires a `pause` event but NO
	 * `error`, so none of the load-time recovery (armStall/maybeRetryAutoplay) and none of the
	 * `error`-path re-resolve engages — the track sits frozen at ~0:01 until a manual tap or a
	 * foreground return re-issues play. The fix re-issues `audio.play()` from the `pause` listener,
	 * but ONLY for an UNEXPECTED pause: the track must have actually played (hasPlayedSinceSrc), there
	 * must be time remaining (not at/near end), and the pause must NOT have been deliberate.
	 *
	 * `deliberatePause` is set true by the FOUR sanctioned pause sources (user toggle, MediaSession
	 * pause action, sleep-timer finishExpiry, offline handleOffline) via `pauseAudio()` immediately
	 * before they call `audio.pause()`, and consumed (read+reset) inside the `pause` listener. Any
	 * pause that arrives WITHOUT this flag is treated as external and self-healed. Plain field —
	 * internal, never reactive.
	 */
	private deliberatePause = false;
	/** Pending resume timer slot (debounced re-play). SIMPLIFY (debug-midplay-stall-background): the
	 *  external-pause self-heal that used to set this was removed (it fought external audio-focus loss
	 *  ~2×/sec — the voice-note interference). The slot + disarmResume() are retained as harmless
	 *  cancel points (nothing sets it now) so the many disarmResume() call sites stay valid; a future
	 *  resume mechanism can reuse it. */
	private resumeTimer: ReturnType<typeof setTimeout> | null = null;

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
	// BOUNDED NEXT-SONG BLOB PRE-BUFFER (reintroduced: bg-lockscreen-stall-noskip). The f7c2580 flood was
	// the UNBOUNDED version — prebufferedUid was set ONLY on 200-OK, so a dead/varying-vkey URL re-fetched
	// on every churn cycle (the FLAC flood that helped freeze the app). This version is BOUNDED so it
	// gives the bg-stall protection WITHOUT the flood: prebufferedUid is claimed BEFORE the fetch and set
	// on BOTH success AND failure → a URL is fetched AT MOST ONCE per uid, never re-fetched; single
	// in-flight (a newer next aborts the prior); fired ONLY from the ≥5s timeupdate prefetch gate, never
	// on churn. Purpose: a backgrounded/locked src-swap plays LOCAL bytes with NO network byte-load that
	// could silently hang (the bg stall). The offline-download blob path (cachedBlobUrl) is separate.
	private prebufferedUid: string | null = null;
	private prebufferedBlobUrl: string | null = null;
	private prebufferController: AbortController | null = null;
	/** bg-lockscreen-stall-noskip: one-shot per-src flag — a load stall retries the SAME song ONCE, then
	 *  the next stall skips. Reset on a new src (play()) and on a real `playing`. Plain field. */
	private stallRetried = false;
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
	 * NEVER-STOP (quick-260630-q03): uids of dead tracks that have already been given their ONE
	 * second-chance retry on advance. When current ends and the next candidate is in `unplayableUids`,
	 * the advance re-resolves + replays it ONCE (a transient probe failure recovers this way) and
	 * records the uid here so it is never retried again this session — a genuinely-dead track is then
	 * skipped, so the retry can never become an infinite loop. Plain Set (NOT $state — only the dimmed
	 * ✗ row needs reactivity, and that lives on `unplayableUids`), mirroring the manualUids/removedUids
	 * side-state discipline. Session-scoped, never persisted. Cleared in lockstep with `unplayableUids`
	 * (clearQueue / recoverFromStop) and per-uid on a real `playing` recovery + manual retryUnplayable,
	 * so a recovered track is eligible for a fresh retry after a later transient blip.
	 */
	private retriedDeadUids = new Set<string>();

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
	 * quick-260627-huo (HUO-RETRY): max DELAYED fresh re-resolve attempts armed per uid before it is
	 * finally allowed to be promoted into unplayableUids. The user hit a genuinely-playable Next-up
	 * song getting permanently sidelined because two quick transient upstream blips reached STRIKE_CAP.
	 * Instead of "strike → dead", we now do "strike → (a few seconds later) re-resolve from scratch →
	 * only dead after these delayed attempts are exhausted". Bounded so endless playback never fires an
	 * unbounded resolve burst that reads as bot traffic (T-huo-01). Private static for tunability.
	 */
	private static RETRY_RESOLVE_MAX = 2;
	/** quick-260627-huo (HUO-RETRY): base delay before the first delayed re-resolve ("a few seconds
	 *  later" per the user). Later attempts back off linearly (delay * (attempt+1)) so a stubbornly
	 *  flaky upstream is probed at a decreasing rate, not hammered. */
	private static RETRY_RESOLVE_DELAY_MS = 4000;

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
			logAction('mark-dead', { uid });
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
	 * quick-260627-huo (HUO-RETRY): the prefetchNext walk's single decision point for a DEFINITIVE
	 * failure (a no-url resolve OR a hard probe `error`) on a next-up candidate. Records the strike (so
	 * strike accounting is unchanged), then chooses between two outcomes when the strike reaches
	 * STRIKE_CAP:
	 *  - if the uid still has delayed-retry BUDGET left, UNDO the premature promotion and instead arm a
	 *    bounded, backed-off fresh re-resolve a few seconds later — a genuinely-playable song hit by a
	 *    transient blip recovers automatically without the user tapping Retry (the original complaint);
	 *  - if the budget is exhausted, leave it promoted into unplayableUids (genuinely dead — the ✗ row
	 *    still draws and nextPlayableIndex still routes past it, so recovery never becomes an infinite
	 *    skip-stall).
	 * A sub-cap strike (first failure) behaves exactly as before: not dead, not scheduled — it is the
	 * existing "transient-equivalent, retry on demand" round.
	 */
	private handleDefinitiveFailure(uid: string): void {
		const reachedCap = this.strikeUnplayable(uid);
		if (!reachedCap) return; // sub-cap: transient-equivalent this round, nothing further to do
		const budgetLeft = (this.retryResolveAttempts.get(uid) ?? 0) < Player.RETRY_RESOLVE_MAX;
		if (budgetLeft) {
			// Undo the premature death and try a fresh re-resolve a few seconds later instead.
			this.unplayableUids.delete(uid);
			this.scheduleRetryResolve(uid);
		}
		// else: budget exhausted — leave it promoted (genuinely dead).
	}

	/**
	 * quick-260627-huo (HUO-RETRY): pending DELAYED re-resolve timer per uid (for cancellation). A uid
	 * appears here only while a scheduleRetryResolve() setTimeout is in flight; the callback deletes its
	 * own entry the instant it fires. Plain Map — internal loop-guard state, never read reactively in
	 * markup. Cleared in lockstep with unplayableStrikes (clearQueue / recoverFromStop) and per-uid on
	 * retryUnplayable / real `playing` so no orphan timer survives a track change (T-huo-02).
	 */
	private retryResolveTimers = new Map<string, ReturnType<typeof setTimeout>>();
	/**
	 * quick-260627-huo (HUO-RETRY): delayed re-resolve budget consumed per uid. Bumped each time
	 * scheduleRetryResolve arms a timer for the uid; once it reaches RETRY_RESOLVE_MAX the caller stops
	 * scheduling and lets the uid be promoted into unplayableUids (a genuinely-dead track must still be
	 * routed past — recovery is bounded, never an infinite skip-stall). Reset in lockstep with
	 * unplayableStrikes (T-huo-01).
	 */
	private retryResolveAttempts = new Map<string, number>();

	/**
	 * quick-260627-huo (HUO-RETRY): arm a single DELAYED, backed-off fresh re-resolve for a next-up uid
	 * that just hit a definitive failure, INSTEAD of marching it straight to permanent death. After the
	 * delay it clears the uid's strike (so the fresh attempt starts clean) and re-runs the existing
	 * prefetchNext() walk — reusing ALL of prefetch's abort/dedupe/probe machinery rather than
	 * duplicating any resolve logic.
	 *
	 * Bounded + deduped + self-guarded:
	 *  - returns early if a timer is already pending for this uid (one in-flight retry per uid), OR if
	 *    the per-uid delayed-attempt budget is already exhausted (caller promotes to dead instead);
	 *  - backs off linearly per attempt so a stubbornly flaky upstream is not hammered;
	 *  - the timer callback re-reads this.current/queue AT FIRE TIME (never a closed-over index) and
	 *    drops silently if the track was passed/removed or is already known-dead — no resolve burst,
	 *    no stale write (T-huo-02).
	 *
	 * Best-effort: never throws, never bumps playGen, never calls next()/runFallback. It only re-arms
	 * prefetchNext().
	 */
	private scheduleRetryResolve(uid: string): void {
		// Dedupe: one in-flight delayed retry per uid.
		if (this.retryResolveTimers.has(uid)) return;
		const attempts = this.retryResolveAttempts.get(uid) ?? 0;
		// Budget exhausted — the caller will leave the uid promoted to dead.
		if (attempts >= Player.RETRY_RESOLVE_MAX) return;
		this.retryResolveAttempts.set(uid, attempts + 1);
		// Back off on later attempts so a flaky upstream is probed at a decreasing rate.
		const delay = Player.RETRY_RESOLVE_DELAY_MS * (attempts + 1);
		const timer = setTimeout(() => {
			// One-shot — drop our own pending-timer entry first so a future failure can re-arm.
			this.retryResolveTimers.delete(uid);
			// Self-guard: re-read current/queue at fire time. Only re-resolve if the uid is still AHEAD
			// of the current track and has not since been confirmed dead. If the track was passed,
			// removed, or already promoted, drop silently — best-effort recovery, never a forced replay.
			const curIdx = this.indexOf(this.current);
			const aheadIdx = this.queue.findIndex((t) => t.uid === uid);
			if (aheadIdx < 0 || aheadIdx <= curIdx) return; // not ahead anymore — nothing to recover
			if (this.unplayableUids.has(uid)) return; // already confirmed dead elsewhere
			// Re-run the prefetch walk for a FRESH upstream re-resolve + re-probe. We deliberately do NOT
			// clearStrike() here: the uid is already at STRIKE_CAP, so a candidate that STILL fails
			// definitively re-enters handleDefinitiveFailure at-cap and either re-schedules (budget left,
			// with backoff) or is finally promoted to dead (budget exhausted) — that is what makes the
			// delayed path CONVERGE and stay bounded. A candidate that RECOVERS lands in its slot and is
			// never re-struck; its stale at-cap strike is cleared on the real `playing` event (and by
			// clearQueue / recoverFromStop / retryUnplayable) so it does not leak into a later session.
			void this.prefetchNext();
		}, delay);
		this.retryResolveTimers.set(uid, timer);
	}

	/** quick-260627-huo (HUO-RETRY): cancel + forget a single uid's pending delayed re-resolve timer
	 *  (a superseding recovery point: manual retry, or a real `playing` for the now-current track). */
	private cancelRetryResolve(uid: string): void {
		const timer = this.retryResolveTimers.get(uid);
		if (timer !== undefined) clearTimeout(timer);
		this.retryResolveTimers.delete(uid);
	}

	/** quick-260627-huo (HUO-RETRY): cancel EVERY pending delayed re-resolve timer and empty both the
	 *  timer + attempt-budget maps. Called wherever unplayableStrikes.clear() is (clearQueue /
	 *  recoverFromStop) so a full session reset leaves no orphan timer and no carried budget. */
	private cancelAllRetryResolves(): void {
		for (const timer of this.retryResolveTimers.values()) clearTimeout(timer);
		this.retryResolveTimers.clear();
		this.retryResolveAttempts.clear();
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

	/**
	 * cover-hero-mediacard-missing (Issue 2): write the OS/browser media metadata (title + artist +
	 * album + best-known artwork) from the CURRENT track. Title/artist come straight off the track
	 * (always present post-search), so the media card ALWAYS shows the song identity regardless of
	 * whether a cover has resolved yet. Artwork mirrors the HERO fix: resolvedCover wins when set, else
	 * fall back to the SHARED cover cache (readCoverByUidOrName, uid-first → name), else buildArtwork's
	 * /favicon.svg. WHY the cache fallback (media-card asymmetry): resolveCoverAsync fires ONLY when
	 * resolvedCover starts null + is gen-guarded, so a cover that lands in the shared cache via another
	 * surface (up-next lazyCover, backfill, sibling tile) AFTER that window never reaches resolvedCover
	 * — reading resolvedCover alone would leave the lock-screen art on the favicon even though the cache
	 * has the real cover. Assigns a BRAND-NEW MediaMetadata (Pitfall 4) so the lock screen repaints, and
	 * mirrors the current playbackState.
	 *
	 * WHY it exists: before this, ms.metadata was written ONLY inside play()'s success branches, so
	 * paths that never call play() — a PWA reopen (restore()) then a resume — left the OS card with no
	 * metadata, and it fell back to the bare document/PWA name ("OpenMusic — music streaming…"). This
	 * is the ONE reusable place restore() and play()-entry can guarantee the card is populated.
	 * No-ops when there is no current track or no media session (SSR / feature-absent). Never throws.
	 */
	private syncMetadata() {
		const ms = this.ms;
		const cur = this.current;
		if (!ms || !cur) return;
		ms.metadata = makeMetadata({
			title: names.dnTitle(cur.title),
			artist: names.dnArtist(cur.artist),
			album: cur.album,
			// resolvedCover wins when set; else the shared cover cache (a cover that landed via another
			// surface), else buildArtwork's favicon fallback — mirrors the NowPlaying hero fix.
			artwork: buildArtwork(
				this.resolvedCover ?? readCoverByUidOrName(cur.uid, cur.artist, cur.title)
			)
		});
		ms.playbackState = playbackStateFor(!!this.current, this.playing);
	}

	/** Clear OS media metadata + set state 'none' when playback stops / track cleared (MS-05/MS-02). */
	private clearMedia() {
		this.keepAliveOff(); // playback stopped / track cleared — release the background keep-alive
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
			// bg-lockscreen-stall-noskip: the FOREGROUND backstop. The same recovery is ALSO driven by the
			// media `stalled` event (which fires in a hidden tab, unlike this throttled setTimeout) so a
			// backgrounded/locked stall is rescued in time. Both route through the one bounded handler.
			this.recoverLoadStall();
		}, Player.STALL_TIMEOUT_MS);
	}

	/**
	 * Bg-tolerant load-stall recovery — the retry-once-then-skip the user asked for (bg-lockscreen-stall-
	 * noskip). A backgrounded/locked src that never produces `playing` fires NO `audio.error` (so the
	 * bg-error-skip path never runs) and armStall's setTimeout is throttled in a long-hidden tab — so this
	 * is ALSO driven by the media `stalled` event, which DOES fire in a hidden tab. Bounded + guarded:
	 *  - no-op once the src produced audio (hasPlayedSinceSrc), on a deliberate pause, or with no current;
	 *  - an autoplay-policy pause (bytes present + paused) routes to the single autoplay retry, NEVER a skip;
	 *  - FIRST stall on a src → re-resolve + re-attach the SAME song ONCE (a transient bg byte-load stall
	 *    usually clears with a fresh URL); reresolveCurrent goes through the braked driveSrc so it cannot
	 *    itself loop;
	 *  - a SECOND stall with still no `playing` → the song is genuinely stuck → strike + advance (skip) so
	 *    music never stops (mirrors bg-error-skip). next() bumps playGen, superseding this src's stale arms.
	 * stallRetried resets on a new src (play()) and a real `playing`, so a later transient stall on another
	 * track starts with a fresh single-retry budget — no cross-track accumulation.
	 */
	private recoverLoadStall() {
		if (this.hasPlayedSinceSrc) return; // already producing audio — not a load stall
		if (this.deliberatePause) return; // user paused — respect it (do not fight the OS)
		if (!this.current || !this.audio) return;
		const el = this.audio;
		if (el.paused && el.readyState >= Player.HAVE_CURRENT_DATA) {
			this.maybeRetryAutoplay(this.playGen); // autoplay-policy pause, not a no-bytes load stall
			return;
		}
		if (!this.stallRetried) {
			this.stallRetried = true;
			logAction('stall.retry', { uid: this.current.uid });
			void this.reresolveCurrent(); // retry the SAME song ONCE (fresh URL + re-attach)
			return;
		}
		logAction('stall.skip', { uid: this.current.uid });
		this.playing = false;
		this.strikeUnplayable(this.current.uid);
		this.next();
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
	 * SINGLE AUDIO.SRC AUTHORITY + RE-DRIVE BRAKE (debug-song-click-lrc-flood-noplay). The one place a
	 * playback stream is attached to `<audio>` for a network/CDN track. Returns true after setting the
	 * src; returns FALSE (and STOPS via haltRunawayRecovery) when the SAME uid has been re-driven
	 * SRC_REDRIVE_CAP times within SRC_REDRIVE_WINDOW_MS with no real `playing` between — the same-track
	 * re-drive storm the error-based ceiling cannot catch (the element `(cancels)` the prior load before
	 * it fires `error`, so errorBurst never climbs). A NEW uid (normal fast-skipping) resets the burst,
	 * so this fires ONLY on a genuine loop. Logs `src.redrive-brake` with the culprit uid so the trigger
	 * is captured in the Activity log. Callers MUST bail their own play/re-resolve when this returns false.
	 */
	private driveSrc(uid: string, url: string): boolean {
		if (!this.audio) return false;
		const now = Date.now();
		this.driveBurst =
			uid === this.lastDriveUid && now - this.lastDriveAt < Player.SRC_REDRIVE_WINDOW_MS
				? this.driveBurst + 1
				: 0;
		this.lastDriveUid = uid;
		this.lastDriveAt = now;
		if (this.driveBurst >= Player.SRC_REDRIVE_CAP) {
			logAction('src.redrive-brake', { uid, burst: this.driveBurst });
			this.driveBurst = 0;
			this.haltRunawayRecovery(); // pause + abort in-flight + sticky Retry — never a spinning flood
			return false;
		}
		this.audio.src = url;
		return true;
	}

	/**
	 * EXTERNAL-PAUSE SELF-HEAL: the ONE sanctioned way to pause the element. Sets `deliberatePause`
	 * so the `pause` listener knows this stop was intentional (user / MediaSession / sleep-timer /
	 * offline) and must NOT be self-healed. Every code path that pauses on purpose calls this instead
	 * of `audio.pause()` directly. A pause that arrives WITHOUT this flag is treated as external
	 * (Android audio-focus loss / background throttle) and re-played by the listener.
	 */
	private pauseAudio() {
		this.deliberatePause = true;
		this.disarmResume(); // an intentional pause cancels any pending external-pause resume
		this.keepAliveOff(); // a deliberate stop releases the background keep-alive (bg-resolve-gap-stall)
		this.audio?.pause();
	}

	/** Cancel a pending external-pause resume (new src / real playing / deliberate pause / ended). */
	private disarmResume() {
		if (this.resumeTimer) {
			clearTimeout(this.resumeTimer);
			this.resumeTimer = null;
		}
	}

	/** BACKGROUND KEEP-ALIVE (bg-resolve-gap-stall round 2) — Web Audio silent source + its context.
	 *  Plain fields (never reactive): audio-graph handles, not UI state. */
	private keepAliveCtx: AudioContext | null = null;
	private keepAliveNode: OscillatorNode | null = null;

	/**
	 * BACKGROUND KEEP-ALIVE (bg-resolve-gap-stall round 2). Once the <audio> element stops decoding
	 * (between tracks, during a cold ensureTrackDetails resolve, or an ensureAhead grow) nothing keeps
	 * the page awake — Android freezes the WebView, so the in-flight network fetch never settles and
	 * playback hangs (the residual dead-run freeze: a long region-locked skip run ends on a cold
	 * resolve/grow that never returns until foreground). A near-silent Web Audio graph is active audio
	 * output from the SAME page, so it holds the page awake across those gaps. Crucially it is NOT a
	 * competing HTMLMediaElement — the second-<audio> focus-steal that broke autoadvance-pauses-after-1s
	 * does not apply; Web Audio shares the page's own output and never claims the MediaSession pill.
	 *
	 * Unlocked lazily here (AudioContext needs a user gesture — play() supplies it on the first tap),
	 * then kept RUNNING for the whole auto-advance session; only a DELIBERATE pause/stop tears it down.
	 * Gain is inaudible-but-nonzero (so the graph is not optimised away) at a sub-audible frequency.
	 * Fully feature-detected + try/catch: any absence/failure is a silent no-op and the player falls
	 * back to prior behaviour. DEVICE-VERIFY PENDING — Web Audio background behaviour is not
	 * reproducible off-device.
	 */
	private keepAliveOn() {
		if (!browser) return;
		try {
			if (!this.keepAliveCtx) {
				const Ctor: typeof AudioContext | undefined =
					typeof AudioContext !== 'undefined'
						? AudioContext
						: (globalThis as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
				if (!Ctor) return; // no Web Audio — no-op
				this.keepAliveCtx = new Ctor();
			}
			const ctx = this.keepAliveCtx;
			void ctx.resume?.(); // needs the play() gesture on the first call's stack; idempotent after
			if (!this.keepAliveNode) {
				const osc = ctx.createOscillator();
				const gain = ctx.createGain();
				gain.gain.value = 0.0001; // inaudible, but non-zero so the node counts as active output
				osc.frequency.value = 30; // sub-audible
				osc.connect(gain).connect(ctx.destination);
				osc.start();
				this.keepAliveNode = osc;
			}
		} catch {
			/* Web Audio unavailable / blocked — silent no-op, prior behaviour unchanged */
		}
	}

	/** Tear down the background keep-alive graph (a DELIBERATE pause or a full stop). */
	private keepAliveOff() {
		try {
			this.keepAliveNode?.stop();
		} catch {
			/* already stopped */
		}
		this.keepAliveNode = null;
		try {
			void this.keepAliveCtx?.suspend?.();
		} catch {
			/* ignore */
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
		// EXTERNAL-PAUSE SELF-HEAL: the sleep-timer stop is INTENTIONAL — route through pauseAudio()
		// so the `pause` listener does not treat it as an external pause and re-play the track.
		this.pauseAudio();
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
				logAction('visibility', { hidden: document.hidden });
				// On hide, flush the exact current position so a bg eviction can't persist a stale time.
				// On foreground return we do NOTHING: the foreground auto-resume mechanism was removed
				// (quick-260703-i7e) because it re-issued play() on the current track when the tab became
				// visible, causing unwanted playback more often than it helped. Playback now starts/resumes
				// only from explicit user action or normal track-end auto-advance.
				if (document.hidden) {
					this.flushPersist();
				}
			});
			// Page Lifecycle API (Chrome/Android); browsers without it simply never fire it.
			document.addEventListener('freeze', () => this.flushPersist());
		}
		if (typeof window !== 'undefined') {
			// Covers bfcache eviction / navigation away on mobile Safari + Chrome.
			window.addEventListener('pagehide', () => this.flushPersist());
			window.addEventListener('pageshow', (e: PageTransitionEvent) => {
				if (!e.persisted || !this.audio) return; // only a bfcache restore needs the re-sync
				logAction('bfcache.restore');
				this.currentTime = this.audio.currentTime || 0;
				this.playing = !this.audio.paused;
			});
		}
		// SIMPLIFY (debug-midplay-stall-background): the headphone-unplug `devicechange` listener was
		// removed along with the external-pause self-heal it fed. We no longer force-resume any pause, so
		// there is nothing to suppress on an unplug — the browser's own "becoming noisy" pause is simply
		// respected (which is the desired behavior anyway: audio stays paused when headphones are pulled).
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
			logAction('playing', { uid: this.current?.uid });
			// `playing` is the event that means audio is ACTUALLY producing output (CR-01).
			// D-13/D-14: mark the src as having played + disarm the initial-load stall watchdog.
			this.hasPlayedSinceSrc = true;
			this.disarmStall();
			// Next-song-current-but-paused fix: real audio started — the autoplay-retry arm is moot.
			this.autoplayRetryArmed = false;
			// Audio is actually producing output — cancel any pending resume timer.
			this.disarmResume();
			// D-06 success reset: a real `playing` event is the natural counter reset — the track
			// is actually producing audio, so the never-stop chain has recovered. Clear the
			// consecutive-failure budget + the audio-error burst, and drop any sticky 'stopped'
			// (loop-guard / offline) notice so the UI stops showing "playback stopped" the instant
			// playback resumes.
			this.consecutiveFailures = 0;
			this.failoverSkips = 0; // SYSTEMIC-FAILURE CEILING (debug-nowbar-frozen-audius-spam): real audio = the storm is not systemic.
			this.driveBurst = 0; // SINGLE AUTHORITY (debug-song-click-lrc-flood-noplay): real output = the src re-drive is not looping.
			this.lastDriveUid = null;
			this.stallRetried = false; // bg-lockscreen-stall-noskip: real output = the load did not stall; fresh retry budget.
			this.errorBurst = 0;
			this.reresolveBurst = 0; // RERESOLVE-LOOP GUARD: real audio = the same-src re-resolve recovered.
			this.rapidErrorBurst = 0; // RAPID-FIRE BRAKE (debug-nowbar-freeze-reresolve-loop): output = the storm ended.
			this.lastAudioErrorAt = 0;
			// Over-aggressive-skip fix: this track actually produced audio — drop any accumulated
			// unplayable strikes for it so an earlier transient prefetch/probe failure can't push it
			// toward a false permanent skip later in the session.
			if (this.current) {
				this.clearStrike(this.current.uid);
				// NEVER-STOP (quick-260630-q03): a recovered track is eligible for a fresh second-chance
				// retry if it hits a later transient blip — drop its one-retry record.
				this.retriedDeadUids.delete(this.current.uid);
				// quick-260627-huo: a track that actually started playing has recovered — cancel any stale
				// pending delayed re-resolve for it and reset its delayed-attempt budget so a later
				// transient blip on the same song starts from a clean slate.
				this.cancelRetryResolve(this.current.uid);
				this.retryResolveAttempts.delete(this.current.uid);
			}
			// CR-03: real playback succeeded — end the fallback episode so the next failure for ANY
			// song (incl. this one later) starts with a fresh attempted set.
			this.fallbackEpisodeKey = null;
			this.fallbackAttempted = new Set<SourceId>();
			if (this.notice?.kind === 'stopped') this.notice = null;
		});
		el.addEventListener('pause', () => {
			logAction('pause', { deliberate: this.deliberatePause });
			this.playing = false;
			this.syncPlaybackState();
			// WR-05: a pause during the initial-load window means the user opted OUT of this load —
			// disarm the stall watchdog so it can't, 15s later, runFallback → play(swap) and start
			// audio against an explicit pause. Mirrors the `ended` disarm. (Masked before CR-01 by
			// the early `play`-event disarm; reachable now that disarm only happens on real audio.)
			this.disarmStall();
			// Next-song-current-but-paused fix: an observed `pause` (user OR the swallowed autoplay
			// rejection itself) clears the autoplay-retry arm so we NEVER re-play() from inside the
			// INITIAL-LOAD retry seam (per specialist — that would fight a genuine user pause). The
			// initial-load retry is driven solely from the canplay/immediate seam set up in play().
			this.autoplayRetryArmed = false;
			// SIMPLIFY (debug-midplay-stall-background): we do NOT force play() against a pause anymore.
			// The old external-pause self-heal (scheduleExternalResume) re-issued play() on every
			// non-deliberate pause — but because a successful re-play fires `playing`, which refunded the
			// per-src budget (externalResumeBudget=0), the EXTERNAL_RESUME_CAP never engaged and the
			// player fought an external audio-focus holder ~2×/sec indefinitely (log Pattern A). That is
			// exactly the "interferes with other apps' voice notes" complaint: the OS pauses us to let
			// another app speak, we immediately grab focus back. Per the user's target spec we now
			// RESPECT any pause (whether a deliberate stop or an external audio-focus loss) and simply
			// consume the deliberate flag. Recovery of a background-stalled track is no longer attempted:
			// the foreground auto-resume mechanism was removed (quick-260703-i7e), so playback resumes only
			// on explicit user action or normal track-end auto-advance — never by fighting the OS while
			// backgrounded, and never on foreground return.
			this.deliberatePause = false;
			this.disarmResume();
		});
		el.addEventListener('canplay', () => {
			// Next-song-current-but-paused fix: the canplay event is the readyState-ready signal — if a
			// non-fresh advance armed an autoplay retry but bytes were not yet present when play() ran,
			// re-attempt the single play() now that the element has buffered. maybeRetryAutoplay is
			// gen-guarded + one-shot + only acts on a paused, bytes-present element, so this is a no-op
			// in every other case (fresh play, already playing, user pause, no arm).
			this.maybeRetryAutoplay(this.playGen);
		});
		// bg-lockscreen-stall-noskip: the BACKGROUND-RELIABLE load-stall signal. `stalled` fires when the
		// element is trying to fetch media data but none is forthcoming — and unlike setTimeout it FIRES
		// in a hidden/locked tab, so it rescues the silent bg byte-load hang that produces no `audio.error`
		// and that armStall's throttled timer misses. Only act on an INITIAL-load stall (before the src
		// ever produced audio); a mid-track buffer dip after playback started is left to the browser.
		el.addEventListener('stalled', () => {
			if (!this.hasPlayedSinceSrc) this.recoverLoadStall();
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
			logAction('ended', { uid: this.current?.uid });
			this.playing = false;
			this.syncPlaybackState();
			this.disarmStall(); // track finished — no initial-load stall to watch for
			// EXTERNAL-PAUSE SELF-HEAL: a natural end-of-track also fires `pause` (just before/with
			// `ended`). Cancel any resume the `pause` listener may have scheduled so we never re-play a
			// track that finished on its own — `ended` owns the advance into next().
			this.disarmResume();
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
			const willReresolve =
				Date.now() - this.lastSeekAt < Player.SEEK_ERROR_WINDOW_MS || this.hasPlayedSinceSrc;
			logAction('audio.error', {
				uid: this.current?.uid,
				hasPlayed: this.hasPlayedSinceSrc,
				reresolve: willReresolve
			});
			this.disarmStall(); // an error event is the failure signal — the watchdog is redundant now

			// ─── RAPID-FIRE BRAKE + ABSOLUTE CEILING (debug-nowbar-freeze-reresolve-loop) ───────────────
			// Every recovery action below (reresolveCurrent, runFallback→play) re-attaches audio.src; a
			// re-attached src that errors AGAIN before producing audio re-enters this handler. Two paths
			// could loop unbounded and PEG THE MAIN THREAD → the whole SvelteKit app freezes (nowbar stuck
			// on the loading line, no tap registers): (1) the seek-error branch calls reresolveCurrent()
			// with no cap/counter/guard (repro: 2000+ synchronous src-sets); (2) the fall-through counts
			// errorBurst but its FAILURE_CAP guard is commented out (ef2c751) so it never trips. Both were
			// unbounded. This block is the single explicit ceiling for ALL error paths and is checked
			// FIRST. Both bounds SKIP (strike the track + advance), NEVER the ef2c751-disabled
			// tripLoopGuard() STOP — that hard pause + sticky "playback stopped" Retry notice was the
			// false-positive that stranded the player on a transient CDN blip / region-lock churn
			// (debug-midplay-stall-background root cause C, debug-reresolve-loop-stops-playback). Skipping
			// honours never-stop; a genuine give-up still surfaces only via the offline / no-url paths.
			const now = Date.now();
			// A rapid error = fired < RAPID_ERROR_WINDOW_MS after the previous one with no `playing`
			// between. No real resolve + <audio> load completes that fast, so this is a synchronous
			// re-attach storm, not a distinct network failure. A normally-spaced error resets the run.
			this.rapidErrorBurst = now - this.lastAudioErrorAt < Player.RAPID_ERROR_WINDOW_MS ? this.rapidErrorBurst + 1 : 0;
			this.lastAudioErrorAt = now;
			this.errorBurst++;
			// (a) source-level brake: cut a synchronous loop off at RAPID_ERROR_CAP consecutive rapid
			//     errors — refusing to re-drive recovery is what stops the CPU peg (a cap alone would
			//     still spin synchronously up to it). (b) absolute backstop: FAILURE_CAP raw errors since
			//     the last real `playing` regardless of spacing (the slow resolve-but-unplayable ping-pong
			//     across 3+ sources the per-episode `attempted` set cannot bound). Either bound → SKIP.
			if (this.rapidErrorBurst >= Player.RAPID_ERROR_CAP || this.errorBurst >= Player.FAILURE_CAP) {
				logAction('error.ceiling', {
					uid: this.current?.uid,
					rapid: this.rapidErrorBurst,
					burst: this.errorBurst
				});
				this.errorBurst = 0;
				this.rapidErrorBurst = 0;
				this.reresolveBurst = 0;
				// D-12: never-stop wins over explicit repeat — break a repeat-one loop on a failing track.
				if (this.repeatMode === 'one') {
					this.repeatMode = 'off';
					this.persist();
				}
				this.playing = false;
				// Strike the current track so nextAdvanceIndex / the prefetch walk route past it (bounded +
				// recoverable: advanceTo still grants one second-chance retry and a real `playing` clears
				// the strikes), then advance. next() bumps playGen via play(), superseding any in-flight
				// fallback/reresolve for the now-abandoned dead track so it cannot re-enter this handler.
				if (this.current) this.strikeUnplayable(this.current.uid);
				// SYSTEMIC-FAILURE CEILING (debug-nowbar-frozen-audius-spam): this ceiling just fired for
				// yet another track with no real `playing` since the last one. Count it; once
				// SYSTEMIC_SKIP_CAP distinct tracks fail back-to-back the outage is systemic, so STOP
				// (pause + Retry) rather than skipping into another resolve/regenerate/prefetch burst that
				// only spams /api/*. A real `playing` resets failoverSkips, so this can't trip on a blip.
				if (++this.failoverSkips >= Player.SYSTEMIC_SKIP_CAP) {
					this.haltRunawayRecovery();
					return;
				}
				this.next();
				return;
			}
			// ────────────────────────────────────────────────────────────────────────────────────────────

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
			// SIMPLIFY (debug-midplay-stall-background): a track that has ALREADY produced audio
			// (hasPlayedSinceSrc) but then errors gets ONE in-place same-src re-resolve — this recovers a
			// genuinely transient mid-track buffer/CDN blip WITHOUT restarting the song, which is the good
			// case the old RERESOLVE_CAP loop was built for. But the dominant real-world signature (log
			// Pattern B: netease region-lock) is a URL that resolves fine, plays ~1s, then the byte-stream
			// 403s and re-errors instantly — for which repeatedly re-resolving the SAME dead URL (up to
			// the cap, then falling through) was a wasteful storm that pinned the player mid-song. So we
			// cap the in-place recovery at ONE attempt: if a re-resolved src errors AGAIN before producing
			// audio, we treat the track as failed and fall through to the cross-source fallback + advance
			// (SKIP), per the user's "fails to resolve → skip it" spec. reresolveBurst resets on the next
			// real `playing` / new src / recoverFromStop.
			if (this.hasPlayedSinceSrc) {
				// BG-SKIP-FIRST (bg-resolve-gap-stall, Freeze 2). In a HIDDEN / locked WebView the in-place
				// reresolveCurrent() below re-attaches a fresh src and then awaits `playing`/`error` events
				// that never fire — Android freezes the page the instant the errored track stops decoding, so
				// reresolveCurrent's network re-resolve hangs and the element sits at 0:00 with no duration
				// forever (observed: resolve.ok → a single audio.error → 44 min of nothing until foreground).
				// reresolveCurrent deliberately arms no stall watchdog (see its D-14 note), so nothing escapes.
				// So when hidden we SKIP the in-place recovery ENTIRELY and advance straight into the next
				// track — depth-2 pre-warmed by prefetchNext()/warmAfter(), so its play() short-circuits with
				// NO cold background resolve, completing the src-swap in one JS turn before the page freezes
				// and thus keeping audio (and the MediaSession pill) alive. Foreground keeps the richer
				// in-place reresolve + cross-source recovery below. This SUBSUMES the old post-cap
				// bg-error-skip (debug-bg-no-pill-split-play-stop, Option B): skipping on the FIRST error is
				// strictly safer than giving one hang-prone in-place attempt. An external audio-focus loss
				// (voice note) fires `pause`, not `audio.error`, so it never enters here — i7e's "do not
				// fight the OS" mandate stays intact (this is a forward skip of a genuinely errored stream).
				if (typeof document !== 'undefined' && document.hidden) {
					logAction('bg-error-skip', { uid: this.current?.uid });
					// DEAD-RUN MITIGATION (bg-resolve-gap-stall round 2): strike the errored track so a
					// whole region-locked batch (netease 403-after-resolve) is not re-churned on every queue
					// pass. At STRIKE_CAP (2) the uid is promoted into unplayableUids, so nextAdvanceIndex /
					// prefetchNext route past it instead of replaying it (the log showed the same 5-track
					// batch bg-error-skipping again a minute later). Bounded + recoverable: advanceTo still
					// grants one second-chance retry, and a real `playing` clears the strikes.
					if (this.current) this.strikeUnplayable(this.current.uid);
					this.playing = false;
					this.next();
					return;
				}
				this.reresolveBurst++;
				if (this.reresolveBurst <= 1) {
					void this.reresolveCurrent();
					return;
				}
				logAction('reresolve.cap', { uid: this.current?.uid, n: this.reresolveBurst });
				// fall through (foreground only) — the single in-place recovery failed; SKIP via the
				// cross-source runFallback/advance below.
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
			// CR-03 note: the dominant region-lock mode is "URL resolves, the <audio> 403s" — the `error`
			// event fires while tryFallback keeps 'succeeding' (it resolves SOME url every cycle), so
			// handleTotalFailure (and consecutiveFailures) never runs and the A↔B ping-pong would be
			// unbounded. The raw-audio-error ceiling that backstops this now lives at the TOP of the
			// handler (debug-nowbar-freeze-reresolve-loop): errorBurst is incremented + checked against
			// FAILURE_CAP there for EVERY error path (this fall-through, the seek branch, and the in-place
			// reresolve), and the rapid-fire brake cuts a synchronous storm off even sooner. So this
			// per-episode fallback keeps only the cross-source retry — the absolute cap is no longer
			// duplicated here (its old commented FAILURE_CAP/tripLoopGuard STOP block was removed; the
			// ceiling now SKIPS, not STOPS).
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
		// EXTERNAL-PAUSE SELF-HEAL: an OS/lock-screen pause is INTENTIONAL — route through pauseAudio()
		// so the `pause` listener honours it instead of re-playing the track.
		ms.setActionHandler('pause', () => this.pauseAudio());
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
		// quick-260618-lsw (LSW-03): a brand-new list is a fresh start — re-anchor the Up-Next list to
		// the new current (or null when cold) so old played songs do not bleed into the new Up-Next.
		this.upNextAnchorUid = this.current?.uid ?? null;
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
		// quick-260618-lsw (LSW-03): installing a new list re-anchors the Up-Next list to current.
		this.upNextAnchorUid = current.uid;
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
		// quick-260618-lsw (LSW-03): the list collapses to [current], so the anchor follows the
		// surviving current (or null when there is none).
		this.upNextAnchorUid = this.current?.uid ?? null;
		this.manualUids.clear();
		this.pendingManual = null; // quick-260618-fiz (Fix 4): drop any uncommitted manual carry too
		this.unplayableUids.clear(); // PLAY-RESILIENCE: a user queue reset clears the dead-track set too
		this.unplayableStrikes.clear(); // …and the sub-cap strike budget in lockstep (over-aggressive-skip fix)
		this.retriedDeadUids.clear(); // NEVER-STOP (quick-260630-q03): …and the one-retry record in lockstep
		this.cancelAllRetryResolves(); // quick-260627-huo: …and cancel any pending delayed re-resolve timers (no leak)
		// bg-lockscreen-stall-noskip: drop any pre-buffered next-song blob so a queue reset can't later
		// serve stale local bytes for a since-removed track (and never leak the Object URL).
		this.prebufferController?.abort();
		if (this.prebufferedBlobUrl) URL.revokeObjectURL(this.prebufferedBlobUrl);
		this.prebufferedBlobUrl = null;
		this.prebufferedUid = null;
		// A queue reset cancels any pending resume timer so a fresh session starts clean.
		this.disarmResume();
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
				// 26-09 (Gap 2): thread the 26-07 report callback so the GROW path is verifiable in the
				// Activity log too (parity with regenerate's fresh-play upnext.source). This does NOT change
				// ensureAhead's control flow — it already has its own buildDiversePicks net below.
				let via: 'similar' | 'artist' | 'lastresort' | 'empty' | 'diverse' = 'empty';
				let more = await buildSimilarQueue(current, have, (v) => (via = v));
				// Never-stop invariant (STATE.md Phase 16): if Last.fm is dry AND the same-artist search
				// yields nothing, fall back to diverse random picks so an obscure-artist queue still grows.
				if (!more.length) {
					more = await buildDiversePicks(8, have);
					via = 'diverse';
				}
				if (myQueueGen !== this.queueGen) return; // an explicit setQueue/setListQueue superseded
				if (more.length) this.queue = this.queueWithAnchor([...this.queue, ...more], current);
				logAction('grow.added', { count: more.length });
				if (more.length) logAction('upnext.source', { via, count: more.length });
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
	 * this round (retried on demand).
	 *
	 * quick-260629-nyl Task 2 — two LAYERED never-stop additions, both reusing existing machinery:
	 *  (2a) timeout → delayed retry: a probe TIMEOUT (transient "playable later on click") now arms the
	 *       existing bounded/backed-off scheduleRetryResolve so the candidate is re-resolved a few
	 *       seconds later instead of being skipped-and-forgotten. It STILL is not marked dead (no ✗).
	 *  (2b) walk-exhaustion → eager ensureAhead: if the forward walk lands NO playable candidate (every
	 *       entry ahead is dead/timed-out/off the end), the queue is eagerly grown via the existing
	 *       ensureAhead so next()/track-end always has somewhere to advance — fixing the "stops on 2-3
	 *       consecutive unplayable" stall. ensureAhead is idempotent + queueGen-guarded + grows only on
	 *       a short tail, so it is a safe no-op otherwise.
	 * This is what guarantees "the next song can always be played":
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

		// quick-260629-nyl Task 2b: track whether the walk LANDED a probe-verified playable candidate.
		// If it falls out of the loop having landed NOTHING (every entry ahead was dead/timed-out/off
		// the end), eagerly grow the queue so next()/track-end always has somewhere to advance — the
		// "stops on 2-3 consecutive unplayable" fix (see the post-loop ensureAhead below).
		let landed = false;
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
					this.handleDefinitiveFailure(cand.uid);
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
					if (probe.errored) {
						this.handleDefinitiveFailure(cand.uid);
					} else {
						// quick-260629-nyl Task 2a: a probe TIMEOUT is the transient "playable later on click"
						// class the user reports. Previously this branch did a bare `continue` — the candidate
						// was skipped this round and NEVER re-armed for a delayed retry (only an at-cap
						// definitive failure scheduled one). Arm the EXISTING bounded, backed-off, dedupe- +
						// budget-guarded scheduleRetryResolve so it re-resolves a few seconds later instead of
						// being silently skipped-and-forgotten. A timeout MUST still NOT add to unplayableUids
						// (no ✗ row for a transient); scheduleRetryResolve self-converges (it no-ops once the
						// per-uid RETRY_RESOLVE_MAX budget is spent, then next() simply routes past on demand).
						this.scheduleRetryResolve(cand.uid);
					}
					continue; // timeout (retry armed) or sub-cap error: walk to the next candidate
				}

				// LANDED a probe-verified playable track. Locate the slot FRESHLY by uid (never a
				// closed-over index, Pitfall 1) and write back only if still AHEAD of the recomputed
				// current — same in-place sync play() does, so the later play() no-ops.
				const writeIdx = this.queue.findIndex((t) => t.uid === cand.uid);
				if (writeIdx >= 0 && writeIdx > this.indexOf(this.current)) {
					this.queue[writeIdx] = resolved;
					this.prewarmNextAssets(resolved);
				}
				landed = true;
				// DEPTH-2 WARM (bg-resolve-gap-stall, Freeze 1). The dominant region-lock signature is a
				// URL that resolves + probes fine, plays ~1s, then the byte-stream 403s (audio.error) — so
				// the immediate-next we just landed can still die at play-time and the never-stop chain SKIPS
				// to the track AFTER it. If that track was never pre-resolved, its play() must run a cold
				// network resolve; in a backgrounded/frozen WebView that resolve hangs and the player freezes
				// at 0:00 (observed: bg-error-skip → play → no resolve.ok → dead until foreground). So
				// best-effort pre-resolve the FOLLOWING entry too (no probe — we only need detailsLoaded so
				// its play() short-circuits with no cold network round-trip). Fire-and-forget, reusing the
				// walk's abort signal + seedUid stale-guard.
				void this.warmAfter(cand.uid, sig, seedUid);
				return; // done — landed the next playable (+ warmed the one after)
			}
			// quick-260629-nyl Task 2b: the walk fell out of the loop without landing a playable
			// candidate (every entry ahead was dead / timed-out / off the end of the queue). Today
			// nothing grows the queue here — growth is only reactive inside next() — so 2-3 consecutive
			// unplayable up-next entries could leave next() with nothing to advance to (the reported
			// stall). Proactively top up via the EXISTING ensureAhead so generated related songs are
			// appended BEFORE the track ends. ensureAhead is idempotent (single in-flight growPromise),
			// queueGen-guarded, only grows when the tail is within 2 of current, and never throws / never
			// bumps playGen — so this is a safe no-op when the tail is already long. Re-check the
			// seedUid/abort stale-guard first so a superseded walk does not grow a stale queue.
			if (!landed && !sig.aborted && this.current?.uid === seedUid) {
				void this.ensureAhead();
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
	 * DEPTH-2 WARM (bg-resolve-gap-stall, Freeze 1). Best-effort pre-resolve of the queue entry that
	 * FOLLOWS the one prefetchNext() just landed, so a region-lock 403 on the landed immediate-next
	 * (URL resolves + probes fine, then the byte-stream 403s at play-time) skips forward into an
	 * already-detailsLoaded track whose play() SHORT-CIRCUITS ensureTrackDetails — no cold network
	 * resolve in the background src-swap gap where a frozen Android WebView would hang it at 0:00.
	 *
	 * Deliberately does NOT probe (probing costs a ~1s muted test-play per candidate and we only need
	 * the audioUrl cached so play() no-ops its resolve) and NEVER marks anything dead (a resolve blip
	 * just leaves the entry cold — play() resolves it on demand). Reuses prefetchNext's AbortSignal and
	 * seedUid so a superseding walk / track change discards it. Never throws, never bumps playGen.
	 */
	private async warmAfter(landedUid: string, sig: AbortSignal, seedUid: string | undefined) {
		const landedIdx = this.queue.findIndex((t) => t.uid === landedUid);
		if (landedIdx < 0) return;
		const after = this.queue[landedIdx + 1];
		if (!after) return; // landed track is the tail — growth is ensureAhead's job
		if (this.unplayableUids.has(after.uid)) return; // known-dead — next() routes past it anyway
		if (after.detailsLoaded && after.audioUrl) return; // already warm — nothing to do
		try {
			const resolved = await ensureTrackDetails(after, sig);
			if (sig.aborted || this.current?.uid !== seedUid) return; // superseded / current moved on
			if (!resolved.audioUrl) return; // no url — leave cold, play() retries on demand
			const w = this.queue.findIndex((t) => t.uid === after.uid);
			if (w >= 0 && w > this.indexOf(this.current)) this.queue[w] = resolved;
		} catch {
			/* best-effort warm — a transient resolve failure leaves the entry cold */
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
		void this.prebufferNext(track); // bg-lockscreen-stall-noskip: local bytes for the bg src-swap
	}

	/**
	 * BOUNDED next-song blob pre-buffer (bg-lockscreen-stall-noskip). Fetch the RESOLVED immediate-next's
	 * full bytes into a Blob NOW — while the current song plays and the page is reliably awake — and hold
	 * it as a `blob:` URL keyed by uid, so play() at advance swaps to LOCAL bytes: a backgrounded/locked
	 * src-swap then has NO network byte-load that could silently hang (the bg stall this fixes).
	 *
	 * BOUNDED (the f7c2580 flood fix): prebufferedUid is claimed BEFORE the await and left set on BOTH a
	 * 200-OK AND a failure/abort, so a dead or slow URL is fetched AT MOST ONCE per uid and NEVER re-
	 * fetched on churn; single in-flight (a newer next aborts the prior); fired only from the ≥5s
	 * timeupdate prefetch gate (prewarmNextAssets), never on the never-stop churn. Skipped for a
	 * downloaded track (offline blob serves it) and where fetch/URL are absent. Raw fetch of media bytes
	 * (NOT apiFetch — media never routes through the /api governor). Never throws, never bumps playGen.
	 */
	private async prebufferNext(track: Track) {
		if (!browser) return;
		const url = track.audioUrl;
		if (!url) return;
		if (typeof fetch === 'undefined' || typeof URL === 'undefined' || !URL.createObjectURL) return;
		if (library.isDownloaded(track.uid)) return; // offline-blob branch already serves this locally
		if (this.prebufferedUid === track.uid) return; // already buffered OR already attempted (flood fix)
		// Supersede any prior in-flight prebuffer for a DIFFERENT next track, then CLAIM this uid BEFORE
		// the await — so a failed fetch below is never retried (the f7c2580 bug set this only on 200-OK).
		this.prebufferController?.abort();
		this.prebufferController = new AbortController();
		const sig = this.prebufferController.signal;
		this.prebufferedUid = track.uid;
		try {
			const resp = await fetch(url, { signal: sig, referrerPolicy: 'no-referrer' });
			if (sig.aborted) return;
			if (!resp.ok) return; // dead URL — leave the uid claimed so it is NOT re-fetched (play() uses the CDN URL)
			const blob = await resp.blob();
			if (sig.aborted) return;
			if (this.prebufferedBlobUrl) URL.revokeObjectURL(this.prebufferedBlobUrl);
			this.prebufferedBlobUrl = URL.createObjectURL(blob);
		} catch {
			/* abort / CORS / network — uid stays claimed (no re-fetch); play() falls back to the CDN URL */
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
		logAction('play', { uid: track.uid, source: track.source, fresh: !!opts?.fresh });
		// BACKGROUND KEEP-ALIVE (bg-resolve-gap-stall round 2): (re)assert the silent Web Audio source
		// synchronously at the TOP of play() — BEFORE the ensureTrackDetails await — so the page stays
		// awake across a cold background resolve. Idempotent (no-op once running); a fresh user tap
		// supplies the AudioContext-unlock gesture, and every later auto-advance just keeps it running.
		this.keepAliveOn();
		this.reresolveBurst = 0; // RERESOLVE-LOOP GUARD: a genuine new play() gives the track a fresh re-resolve budget.
		// RAPID-FIRE BRAKE (debug-nowbar-freeze-reresolve-loop): a genuine new play() starts a fresh
		// synchronous-storm budget — the first error on a new src must never count as "rapid" (0 = no
		// prior error this src). errorBurst is deliberately NOT reset here (CR-01: it must survive
		// auto-skips so a RUN of dead tracks still trips the absolute ceiling; only a real `playing` or
		// recoverFromStop clears it).
		this.rapidErrorBurst = 0;
		this.lastAudioErrorAt = 0;
		this.healProbed.clear(); // quick-260704-20e: a new track invalidates prior current-cover heals (also caps set growth).
		// A direct play() (queue/auto-advance/share link) supersedes any optimistic overlay,
		// so a stale pending bar never lingers once a real track takes over.
		this.pendingTrack = null;
		this.pendingKey = '';
		this.error = null;
		this.loading = true;
		this.current = track;
		// STALE-FLAG FIX (background-autoadvance-stall follow-up): reset hasPlayedSinceSrc the MOMENT we
		// commit to the new current track — NOT later at src-set (which happens only after the async
		// ensureTrackDetails resolve, up to several seconds). Otherwise, during that resolve gap `current`
		// is the NEW track while `hasPlayedSinceSrc` still holds the OLD (played) track's `true`. A dead
		// new track (e.g. netease 403) that errors in that window was then misrouted into the
		// already-played recovery (reresolveCurrent + external-pause self-heal) instead of the
		// cross-source fallback that advances PAST it — the observed "next track hangs at 0:00" in the
		// background. reresolveCurrent (a mid-track re-attach) deliberately does NOT go through play(), so
		// it keeps its own true — only a genuine track change resets here.
		this.hasPlayedSinceSrc = false;
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
		// cover-hero-mediacard-missing (Issue 2): populate the OS media card title/artist IMMEDIATELY
		// from the stub — BEFORE the async ensureTrackDetails resolve — so the card never shows the bare
		// app name during the resolve gap or when a track goes through the runFallback early-return
		// (which returns before the post-resolve metadata write below). The later writes only REFRESH
		// the artwork once a cover resolves; title/artist are guaranteed here regardless of cover.
		this.syncMetadata();
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
					// A NEW src cancels any pending resume timer from the prior track and clears a stale
					// deliberate-pause flag so the next pause is judged on this src's own merits.
					this.disarmResume();
					this.deliberatePause = false;
					this.audio.src = this.cachedBlobUrl;
					this.armStall();
					// quick-260627-huo (HUO-PREFETCH): EAGER one-shot prefetch of the immediate-next at
					// src-set — independent of the ~5s timeupdate gate — so a SHORT track or a FAST skip
					// still has its next song pre-resolved + probe-verified before it ends (gapless,
					// non-stop advance). Fired AFTER the src is attached so prefetchNext's indexOf(current)
					// sees the correct current track. Arming prefetchArmedForSrc=true makes the timeupdate
					// gate (the long-track backstop) a no-op for this src — single walk per src (T-huo-03).
					// Best-effort + fire-and-forget (gen-guarded by prefetch's own seedUid/abort); NOT
					// gated on the `playing` event (memory: that froze iOS — reverted).
					this.prefetchArmedForSrc = true;
					void this.prefetchNext();
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
			// RESOLVE-PHASE WATCHDOG (26-06 / gap-1 BLOCKER, RESOLVE-02). The click-to-play network resolve
			// used to run with NO signal + NO timeout — a stalled upstream (qijieya/qq flake) sat in
			// `loading` up to apiFetch's ~25s REQUEST_TIMEOUT_MS with no cross-source fallback and no skip
			// (the UAT hang). Bound it: race the resolve against a short RESOLVE_WATCHDOG_MS deadline. On the
			// deadline we (a) set `timedOut`, (b) `ac.abort()` the in-flight resolve so the stalled /api
			// fetch is cancelled and the connection frees (apiFetch rejects a caller-abort — T-26-06-02), and
			// (c) win the race with the (audioUrl-less) tapped stub so play() unblocks and routes into
			// runFallback BELOW even if a downstream ignored the signal — the never-hang guarantee does NOT
			// depend on adapter cooperation. The offline-blob early-return above never reaches here, so local
			// bytes never arm this. A fast, healthy resolve wins the race first → `timedOut` stays false, the
			// timer is cleared in `finally` (no dangling timer / spurious late abort), and the single-source
			// happy path proceeds with NO cross-source fan-out (the ~3-call budget is preserved).
			const ac = new AbortController();
			let timedOut = false;
			// Kick off the resolve WITH the abort signal (ensureTrackDetails threads it to the adapter →
			// apiFetch). Attach a swallowing .catch up-front: after the watchdog aborts, the in-flight
			// resolve rejects LATE (apiFetch caller-abort) and the race has already settled — this prevents
			// that late rejection surfacing as an unhandled rejection. A PRE-timeout reject is caught by the
			// try/catch below (routed as a failed resolve).
			const resolveP = ensureTrackDetails(track, ac.signal);
			resolveP.catch(() => {});
			let resolveTimer: ReturnType<typeof setTimeout> | undefined;
			const timeoutP = new Promise<Track>((resolve) => {
				resolveTimer = setTimeout(() => {
					timedOut = true;
					ac.abort(); // cancel the stalled upstream fetch — free the connection (T-26-06-02)
					resolve(track); // unblock with the unresolved (audioUrl-less) stub → runFallback below
				}, Player.RESOLVE_WATCHDOG_MS);
			});
			let resolved: Track;
			try {
				resolved = await Promise.race([resolveP, timeoutP]);
			} catch {
				// A hard resolve throw (network error, or a non-timeout abort) is a failed resolve: fall back
				// to the tapped track (audioUrl-less) so the shared resolve-failure branch below routes it
				// into the cross-source walk (never-throw parity with the null-resolve path).
				resolved = track;
			} finally {
				clearTimeout(resolveTimer); // fast resolve → no dangling timer / spurious late abort
			}
			if (myGen !== this.playGen) return; // CR-02: superseded mid-resolve — discard
			if (timedOut) {
				// Make the hang→fallback transition visible in the Activity log (Settings → Activity log).
				logAction('resolve.timeout', { uid: track.uid, source: track.source });
			} else {
				logAction(resolved.audioUrl ? 'resolve.ok' : 'resolve.fail', {
					uid: resolved.uid,
					source: resolved.source,
					hasUrl: !!resolved.audioUrl
				});
			}
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
			if (timedOut || !resolved.audioUrl) {
				// Resolve FAILED — the watchdog fired (stalled upstream) OR the resolve returned no
				// audioUrl. Both route into the cross-source fallback (gte / 26-06 gap-1): walk the
				// remaining sources kuwo-first for the SAME song before surfacing an error. On a playable
				// hit runFallback() calls play() again with fromFallback:true; on total exhaustion
				// handleTotalFailure auto-skips via next() — the player never sits permanently in `loading`.
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
				// BOUNDED BLOB PRE-BUFFER consume (bg-lockscreen-stall-noskip): if the immediate-next was
				// pre-buffered to LOCAL bytes, swap to the blob: URL so a backgrounded/locked src-set has
				// NO network byte-load that could silently hang. Ownership transfers to cachedBlobUrl (its
				// existing revoke discipline owns it from the next play()); clear the prebuffer slot so it
				// is not double-revoked. `else if` — never override the offline-download blob above.
				else if (this.prebufferedUid === resolved.uid && this.prebufferedBlobUrl) {
					this.cachedBlobUrl = this.prebufferedBlobUrl;
					src = this.cachedBlobUrl;
					this.prebufferedBlobUrl = null;
					this.prebufferedUid = null;
				}
				// Initial-load arming point (D-13): a NEW src for this track. Reset the played flag +
				// arm the stall watchdog so a silent no-audio start (no `playing`/`timeupdate`
				// within ~15s) routes into failover.
				this.hasPlayedSinceSrc = false;
				this.stallRetried = false; // bg-lockscreen-stall-noskip: fresh src → fresh single-retry budget
				// RELAX-PREFETCH: a NEW src — re-arm the one-shot delayed prefetch gate so the
				// timeupdate listener fires prefetchNext ~5s into THIS track's playback.
				this.prefetchArmedForSrc = false;
				// Next-song-current-but-paused fix: a NEW src clears any prior autoplay-retry arm.
				this.autoplayRetryArmed = false;
				// A NEW src cancels any pending resume timer from the prior track and clears a stale
				// deliberate-pause flag so the next pause is judged on this src's own merits.
				this.disarmResume();
				this.deliberatePause = false;
				// SINGLE AUTHORITY (debug-song-click-lrc-flood-noplay): attach the stream through the ONE
				// braked setter. If this play() is the Nth rapid re-drive of the SAME track with no
				// `playing` between (a reactive re-entry / recovery ping-pong — the "api loop hell"), the
				// brake STOPS with a logged trigger and we bail this play() rather than re-driving again.
				if (!this.driveSrc(resolved.uid, src)) return;
				this.armStall();
				// RELAX-PREFETCH (debug-song-click-lrc-flood-noplay): prefetch is driven ONLY by the
				// timeupdate playback-elapsed gate (~5s into REAL playback) — the eager on-every-src fire
				// + silent probe walk (quick-260627-huo) was REMOVED as part of the single-authority
				// simplification. A track that never starts (the failure case) thus never triggers the
				// speculative probe/resolve churn that fed the storm; a track that actually plays still
				// pre-warms its next for a gapless advance. prefetchArmedForSrc stays false (set above) so
				// the timeupdate gate arms the single walk once this src crosses the elapsed threshold.
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
			// COVER-01 (Plan 26-02): the now-playing track ALREADY painted from a SOLID inline source
			// cover (kuwo pic / qq album_pic / netease pic — the click-to-play hot path with NO cover
			// network call). Fire a BOUNDED, LAZY, post-paint Deezer HQ UPGRADE off the audio critical
			// path: at most ONE Deezer call for the CURRENT now-playing track only (never a per-tile
			// fan-out — T-26-02-01), generation-guarded, never awaited. `else if` keeps it mutually
			// exclusive with the full-chain miss path above — a track is EITHER coverless (full chain)
			// OR has an inline cover (single Deezer upgrade), never both.
			else if (httpsOnly(this.resolvedCover)) void this.upgradeCoverAsync(resolved, myGen);
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
				// quick-260618-lsw (LSW-02 / LSW-01): a fresh click anchors the Up-Next list at the
				// clicked song so it is the FIRST row. Set AFTER weaveFreshHistory installs the woven
				// queue so the anchor uid is definitely present in this.queue. Auto-advance (the non-fresh
				// else branch below) leaves this put so the just-played song stays in the list.
				this.upNextAnchorUid = resolved.uid;
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
	 * Bounded, lazy Deezer HQ cover UPGRADE for the now-playing track (Plan 26-02, COVER-01). The
	 * counterpart to resolveCoverAsync (which fires ONLY when resolvedCover is NULL — a coverless miss):
	 * this fires ONLY when the track ALREADY painted from a SOLID inline source cover (kuwo pic / qq
	 * album_pic / netease pic), to lazily pick up Deezer's higher-quality album art post-paint. It is the
	 * single OPTIONAL cover call in the click-to-play ~3-call budget:
	 *   - issues ONLY the Deezer tier (resolveDeezerHQ — no iTunes, no CN searchAll → NO per-tile fan-out),
	 *   - fires at most ONCE per play for the CURRENT now-playing track only (never inside a queue loop),
	 *   - is generation-guarded by the captured myGen (bails the instant a newer play() supersedes),
	 *   - is never awaited on the audio critical path (playback never waits on it — T-21-07 accept).
	 * On a SOLID upgrade that DIFFERS from the current cover: set resolvedCover, bump the reactive signal
	 * (resolveDeezerHQ already wrote BOTH cache layers — mirror resolveCoverAsync Site C, do NOT double-
	 * write), and re-fire a FRESH MediaMetadata so the OS lock screen repaints. A miss / same-URL result /
	 * a supersede leaves the inline cover standing (never a downgrade, never a broken image).
	 */
	private async upgradeCoverAsync(resolved: Track, myGen: number) {
		let url: string | null = null;
		try {
			url = await resolveDeezerHQ(resolved);
		} catch {
			url = null; // resolveDeezerHQ never throws, but stay defensive — never reject.
		}
		if (myGen !== this.playGen) return; // a newer play() superseded — keep the current art (T-21-06)
		if (!httpsOnly(url) || url === this.resolvedCover) return; // miss / no change → inline cover stands
		this.resolvedCover = url;
		// resolveDeezerHQ already wrote BOTH cache layers — only bump the reactive signal (mirror Site C).
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
	 * Probe a cover URL with new Image() — resolve true if it LOADS (keep it), false on error (treat
	 * as broken → repair). SSR guard: when Image is undefined resolve false. Never rejects. Private
	 * 12-line twin of lazyCover's probeImage (quick-260704-20e) so the heal does NOT cross the action
	 * boundary; mirrors the exact idiom preloadNextCover already uses (decoding/referrerPolicy).
	 */
	private probeCover(url: string): Promise<boolean> {
		if (typeof Image === 'undefined') return Promise.resolve(false);
		return new Promise<boolean>((resolve) => {
			try {
				const img = new Image();
				img.decoding = 'async';
				img.referrerPolicy = 'no-referrer';
				img.onload = () => resolve(true);
				img.onerror = () => resolve(false);
				img.src = url;
			} catch {
				resolve(false);
			}
		});
	}

	/**
	 * quick-260704-20e: SELF-HEAL a DEAD current cover — the missing counterpart to resolveCoverAsync
	 * (which fires only when resolvedCover is NULL). resolvedCover is seeded FIRST from track.cover — a
	 * source-CDN thumbnail that frequently expires / is served over http: — and resolveCoverAsync's
	 * `if (!this.resolvedCover)` guard never re-resolves a non-null-but-DEAD URL, so the now-playing
	 * current cell paints a broken url as a CSS background = the reported "black cover". This mirrors
	 * lazyCover's per-row dead-URL self-heal (probe → removeCoverBoth → resolveCoverForTrack) but for
	 * the ONE now-playing field. NowPlaying calls this ONLY when effectiveCover === player.resolvedCover
	 * (swappedCover absent) — the Last.fm hi-res swap path is untouched (it wins via
	 * effectiveCover = swappedCover ?? resolvedCover, and is already verified real by maybeSwapCover's
	 * onload before it is set). NOT gated on the audio `playing` event (MEMORY: that froze iOS
	 * background playback — reverted). Reuses existing helpers only — no new resolver/cache/dep/route.
	 */
	async healCover(uid: string) {
		try {
			// (1) The effect passes the uid it observed; a mismatch means the track already changed — bail.
			if (!this.current || this.current.uid !== uid) return;
			// (2) A null/gradient cover is the resolveCoverAsync MISSING path, not here; a non-https value
			//     is not a probe target. Only a present https URL can be "dead but painted".
			const url = this.resolvedCover;
			if (!httpsOnly(url)) return;
			// (3) One-shot per uid+url (mirror lazyCover's `done`): probe AT MOST once so an errored
			//     background paint can never re-trigger an infinite re-probe loop (T-20e-02). Add BEFORE probing.
			const key = `${uid}|${url}`;
			if (this.healProbed.has(key)) return;
			this.healProbed.add(key);
			// (4) Snapshot the generation + identity off the current track (CR-02 supersedence guard).
			const myGen = this.playGen;
			const { artist, title } = this.current;
			// (5) Probe the displayed cover. TRUE (loads fine) → do nothing, the zero-network fast path.
			const alive = await this.probeCover(url);
			if (alive) return;
			// (6) Dead url. Bail if a newer play() superseded this heal mid-probe (T-20e-03).
			if (myGen !== this.playGen) return;
			// Evict BOTH cache layers (empty-uid safe — removeCoverBoth skips the shared 'uid:' slot for
			// an empty uid) so the stale dead cover is dropped before the re-resolve re-caches.
			removeCoverBoth(uid, artist, title);
			// (7) Re-resolve via the SHARED tier chain (Deezer→iTunes→CN; never throws; writes both cache
			//     layers internally on a SOLID hit). Re-check the gen AFTER the await → discard a stale heal.
			const fresh = await resolveCoverForTrack(this.current);
			if (myGen !== this.playGen) return;
			// (8) Commit ONLY a SOLID https result (T-20e-01). A null/miss keeps the gradient — never
			//     re-commit the dead url (D-12). resolveCoverForTrack already wrote both cache layers — do
			//     NOT double-write (mirror resolveCoverAsync Site C); just bump so other tiles repaint.
			if (httpsOnly(fresh)) {
				this.resolvedCover = fresh;
				bumpCoverVersion();
			}
		} catch {
			// Best-effort — a failure leaves the gradient (never a broken image, never throws).
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
			// 26-09 (Gap 2 / UPNEXT-01): capture WHICH formation path buildSimilarQueue took via the
			// 26-07 report callback so the Up-Next source is verifiable in the Activity log. 'diverse' is
			// added locally for the safety-net branch below (never reported by buildSimilarQueue itself).
			let via: 'similar' | 'artist' | 'lastresort' | 'empty' | 'diverse' = 'empty';
			let tail = await buildSimilarQueue(seed, exclude, (v) => (via = v));
			if (myQueueGen !== this.queueGen) return; // WR-06: superseded by an explicit setQueue()
			// 26-09 (Gap 2 / T-26-09-01): mirror ensureAhead's never-empty safety net. On EVERY fresh
			// click-to-play regenerate ran with NO fallback — installing buildSimilarQueue's [] left a
			// dead-end empty Up-Next. When every similar path is dry, fall back to diverse picks so a
			// fresh play is never left with an empty Up-Next.
			if (tail.length === 0) {
				tail = await buildDiversePicks(8, exclude);
				if (myQueueGen !== this.queueGen) return; // WR-06 re-checked after the SECOND await (T-26-09-02)
				via = 'diverse';
			}
			this.queue = this.queueWithAnchor([...head, ...manualEntries, ...tail], seed);
			// 26-09: log the formation source + count so the UAT "up-next is one track.getSimilar call,
			// never empty" claim is verifiable on device (Settings → Activity log).
			logAction('upnext.source', { via, count: tail.length });
		} catch {
			/* leave queue as-is */
		}
	}

	toggle() {
		this.abortFade(); // D-05: a play/pause gesture during a fade aborts the sleep stop
		if (!this.audio) return;
		// EXTERNAL-PAUSE SELF-HEAL: a user tap is INTENTIONAL — pausing routes through pauseAudio()
		// so the `pause` listener does not immediately re-play the track the user just paused.
		if (this.audio.paused) this.audio.play().catch(() => {});
		else this.pauseAudio();
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
		this.retriedDeadUids.delete(track.uid); // NEVER-STOP (quick-260630-q03): a manual retry resets the auto-retry budget
		this.cancelRetryResolve(track.uid); // quick-260627-huo: a manual retry supersedes any pending delayed retry
		void this.play(track, { fresh: false });
	}

	/**
	 * NEVER-STOP advance walk (quick-260630-q03). Like nextPlayableIndex, but a dead track that has
	 * NOT yet had its one second-chance retry is ALSO a valid advance target (advanceTo gives it that
	 * retry). Returns the first index after `from` that is either playable or dead-but-not-yet-retried;
	 * -1 only when every entry ahead is playable-exhausted AND already-retried. This is what stops the
	 * "next 3 are dead → silent stop": those 3 are now retried in order instead of skipped to nothing.
	 */
	private nextAdvanceIndex(from: number): number {
		for (let k = from + 1; k < this.queue.length; k++) {
			const uid = this.queue[k].uid;
			if (!this.unplayableUids.has(uid)) return k; // playable
			if (!this.retriedDeadUids.has(uid)) return k; // dead, but owed its one retry
		}
		return -1;
	}

	/**
	 * NEVER-STOP (quick-260630-q03): advance to queue[index]. If the track is still marked dead, give
	 * it its single second-chance — record it in retriedDeadUids (so it is never retried twice this
	 * session → no infinite loop), drop it from the dead set + reset its strike/delayed-retry budget,
	 * and replay it NON-fresh (a transient probe failure recovers here; a genuinely-dead track simply
	 * re-fails and the resilience chain advances past it). A playable track just plays.
	 */
	private advanceTo(index: number): void {
		const t = this.queue[index];
		logAction('advance', { toUid: t.uid });
		if (this.unplayableUids.has(t.uid)) {
			logAction('retry-dead', { uid: t.uid });
			this.retriedDeadUids.add(t.uid);
			this.unplayableUids.delete(t.uid);
			this.clearStrike(t.uid);
			this.cancelRetryResolve(t.uid);
			this.play(t, { fresh: false });
			return;
		}
		this.play(t);
	}

	next() {
		this.abortFade(); // D-05: a skip gesture during a fade aborts the sleep stop
		const i = this.indexOf(this.current);
		const j = this.nextAdvanceIndex(i);
		if (j >= 0) {
			this.advanceTo(j); // plays a playable track, or retries the next dead one ONCE (in order)
			return;
		}
		// Every entry ahead is playable-exhausted AND already had its one retry (or end-of-queue).
		// D-10/D-12: no repeat-all wrap — auto-generated up-next is the continuation. Grow via
		// ensureAhead, then advance into the freshly-added tracks (fresh tracks are never dead/retried,
		// so they are valid candidates). Never silently no-op on a dead/exhausted tail (that was the
		// stall): only when sources are truly dry does ensureAhead add nothing and the reactive
		// never-stop chain owns the genuine stop.
		logAction('grow.request');
		void this.ensureAhead().then(() => {
			const k = this.indexOf(this.current);
			const n = this.nextAdvanceIndex(k);
			if (n >= 0) this.advanceTo(n);
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
				logAction('fallback', { fromSource: failed.source, toSource: swap.source });
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
		// SIMPLIFY (debug-midplay-stall-background): a track that failed ALL sources is SKIPPED, not
		// stopped — so do NOT set this.error='toast.playbackStopped' here. Setting it made the sticky
		// "playback stopped - couldn't load songs" toast appear on every skip; when a region-lock storm
		// stalled the advance chain in the background (log Pattern B), no subsequent `playing` cleared
		// it and the user saw a "stopped" message while the player was merely skipping. The batched
		// skip notice below is the correct, self-dismissing signal for a skip. `this.error` is reserved
		// for a genuine give-up (offline with no downloads / a resolve throw), not the never-stop skip.
		// SYSTEMIC-FAILURE CEILING (debug-nowbar-frozen-audius-spam): a total failover (EVERY source
		// exhausted for this song) is another distinct failed track. Once SYSTEMIC_SKIP_CAP tracks fail
		// back-to-back with no playback, STOP rather than skipping into yet another regenerate/resolve
		// burst that spams /api/*. A real `playing` resets failoverSkips so this can't trip on a blip.
		if (++this.failoverSkips >= Player.SYSTEMIC_SKIP_CAP) {
			this.haltRunawayRecovery();
			return;
		}
		// D-02: emit a batched skip notice and auto-skip to the next track.
		this.emitSkipNotice(failed.title);
		this.next();
	}

	/**
	 * SYSTEMIC-FAILURE STOP (debug-nowbar-frozen-audius-spam; the re-enabled successor of the
	 * ef2c751-disabled tripLoopGuard). Halt the never-stop recovery once it has become a RUNAWAY
	 * (SYSTEMIC_SKIP_CAP distinct tracks failed back-to-back with no playback) — the state that
	 * otherwise churns resolve/regenerate/prefetch bursts and spams /api/* until the app freezes.
	 *
	 * Crucially this ACTUALLY STOPS THE SPAM AT THE SOURCE: it does not just pause the <audio>, it
	 * aborts the in-flight prefetch walk and cancels every pending delayed re-resolve, and — because it
	 * does NOT call next()/advanceTo — nothing re-arms ensureAhead/regenerate/prefetch. It then surfaces
	 * ONE sticky Retry notice; recoverFromStop (D-05) skips ahead, drops the dead sets, and re-arms.
	 *
	 * Why this can't false-positive the way the disabled rapid-error STOP did: see SYSTEMIC_SKIP_CAP.
	 * Routes the pause through pauseAudio() (the intentional-pause path) so the `pause` listener treats
	 * it as deliberate and never fights it with a re-play (mirrors handleOffline / the sleep-timer stop).
	 */
	private haltRunawayRecovery() {
		logAction('recovery.halt', { skips: this.failoverSkips });
		this.failoverSkips = 0;
		this.consecutiveFailures = Player.FAILURE_CAP; // pin at the cap (idempotent across callers)
		this.errorBurst = 0;
		this.rapidErrorBurst = 0;
		this.reresolveBurst = 0;
		this.loading = false;
		this.playing = false;
		// Cut every out-of-band /api/* fetch source dead so the STOP genuinely stops the spam.
		this.prefetchController?.abort();
		this.cancelAllRetryResolves();
		this.disarmStall();
		this.pauseAudio(); // intentional pause — the `pause` listener will not re-play it
		this.clearMedia();
		this.error = 'toast.playbackStopped';
		this.notice = {
			kind: 'stopped',
			reason: 'loop-guard',
			msg: 'toast.playbackStopped',
			action: () => this.recoverFromStop()
		};
	}

	/**
	 * Recovery from the loop-guard stopped state (D-05). Bound to the sticky notice's Retry action
	 * and reused by a user "tap play" recovery: skip AHEAD to the next track (NOT retry-current, NOT
	 * regenerate), reset the consecutive-failure counter, and re-arm the never-stop chain. next()
	 * bumps playGen via play(), so this correctly supersedes any stale in-flight fallback.
	 */
	private recoverFromStop() {
		this.consecutiveFailures = 0;
		this.failoverSkips = 0; // SYSTEMIC-FAILURE CEILING (debug-nowbar-frozen-audius-spam): a manual retry re-arms it.
		this.driveBurst = 0; // SINGLE AUTHORITY (debug-song-click-lrc-flood-noplay): a manual retry re-arms the src brake.
		this.lastDriveUid = null;
		this.errorBurst = 0;
		this.rapidErrorBurst = 0; // RAPID-FIRE BRAKE (debug-nowbar-freeze-reresolve-loop): a full recovery re-arms it too.
		this.lastAudioErrorAt = 0;
		// CR-03: re-arm — drop the per-episode attempted set so the skipped-ahead track gets a full
		// fresh set of sources to try.
		this.fallbackEpisodeKey = null;
		this.fallbackAttempted = new Set<SourceId>();
		// PLAY-RESILIENCE: a manual recovery re-arms everything — drop the probe-confirmed dead set so
		// previously-sidelined tracks get a fresh chance on the way out of the stopped state.
		this.unplayableUids.clear();
		this.unplayableStrikes.clear(); // over-aggressive-skip fix: a full recovery resets the strike budget too
		this.retriedDeadUids.clear(); // NEVER-STOP (quick-260630-q03): a full recovery clears the one-retry record too
		this.cancelAllRetryResolves(); // quick-260627-huo: a full recovery cancels every pending delayed re-resolve
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
		// EXTERNAL-PAUSE SELF-HEAL: this offline pause is INTENTIONAL — route through pauseAudio() so
		// the `pause` listener does not fight it with a doomed re-play against the dead network.
		this.pauseAudio();
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
