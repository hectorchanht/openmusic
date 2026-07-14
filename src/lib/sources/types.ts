// Canonical data-layer contracts for the source-adapter registry (Phase 1, DATA-04).
//
// These interfaces are the load-bearing design: a `SourceAdapter` runs CLIENT-side
// (calls /api/<source>/..., normalizes upstream JSON → Track) and a `ProxyAdapter`
// (see ../proxy/proxy-types.ts) runs on the Cloudflare edge. Both are keyed by the
// same `SourceId`. Adding a source = one client file + one proxy file + one line in
// each registry; aggregation/dispatch code NEVER names a source.
//
// Field shape reconciles RESEARCH.md (lines 225-256) with the legacy serializeTrack
// whitelist (legacy/index.html:1764-1768) so QQ/JOOX detail calls keep the extra
// fields they read.

// Type-only import (erased at compile time — no runtime cycle; settings.svelte.ts imports
// SourceId from here, mirroring the existing defaults.ts ↔ settings type-cycle pattern).
import type { DefaultQuality } from '$lib/stores/settings.svelte';

export type SourceId =
	| 'netease'
	| 'qq'
	| 'kuwo'
	| 'joox'
	| 'fivesing'
	| 'jamendo'
	| 'audius'
	| 'ytmusic';

export interface Track {
	/** Canonical id = `${source}:${songid}` (D-10, COLON form). Stable across reorder/paginate. */
	uid: string;
	source: SourceId;
	songid: string;
	title: string;
	artist: string;
	album: string;
	cover: string | null;
	/** null until resolve() populates it (Netease provides it at search time). */
	audioUrl: string | null;
	/** null until resolved (JOOX has it at search time; Netease resolves via lrcUrl). */
	lrc: string | null;
	/** Netease only — separate URL fetched in resolve(). */
	lrcUrl: string | null;
	detailsLoaded: boolean;
	quality: string | null;
	qualityLabel: string | null;
	/** Search keyword — QQ/JOOX detail calls need it. */
	keyword: string;
	/** 1-based, ORDERING ONLY (interleave). NEVER used for identity (Pitfall 4). */
	displayIndex: number;

	// --- source-specific extras (from the serializeTrack whitelist) — optional ---
	songMid?: string; // QQ/JOOX
	qqId?: string; // QQ
	qqSearchKey?: string; // QQ detail needs it
	qqIndex?: number; // QQ ordering
	jooxIndex?: number; // JOOX positional fallback ONLY — see Pitfall 4
	jooxSongId?: string; // JOOX
	jooxSongMid?: string; // JOOX
	qqQualityText?: string | null;
	jooxQualityText?: string | null;
	pay?: string | null; // QQ paywall signal
	pageUrl?: string; // QQ
	/** Track length in SECONDS. `undefined` means the source did NOT report a duration —
	 *  NEVER penalized by scoreMatch (D-03 unknown-neutrality). Additive/optional like the
	 *  Last.fm fields below; NOT in any serialize whitelist. QQ populates it from the detail
	 *  body's `song_play_time` (search rows carry no duration). */
	duration?: number;
	/** 5sing — `fc` (翻唱/cover) | `bz` (伴奏/karaoke) | `yc` (原创/original).
	 *  Identity-critical: songid is NOT unique across songtypes, so the uid folds songtype
	 *  into the songid via `${songtype}-${songid}` (hvu Pitfall, mirrors JOOX Pitfall 4). */
	fivesingSongType?: 'fc' | 'bz' | 'yc';

	// --- Last.fm enrichment (Phase 8, additive/optional) — never overwrites source data ---
	tags?: string[]; // top-5 display tags
	bio?: string; // English bio snippet, HTML-stripped (D-07)
	bioUrl?: string; // Last.fm attribution link, REQUIRED when bio shown (D-08)
	lastfmArt?: string; // hi-res cover candidate, placeholder-filtered (D-04)

	// --- Phase 26 lazy name-stub marker (RESOLVE-02), additive/optional ---
	/** A sourceless / songid-less name-only stub (the shape Plan 26-03's Last.fm `track.getSimilar`
	 *  Up-Next emits). When true, `ensureTrackDetails` resolves it kuwo-first through ONE source at a
	 *  time via `resolveNameStub` (never a fan-out) instead of dispatching to `SOURCES[source].resolve`.
	 *  Additive/optional so no existing construction or serialize path changes (mirrors the Last.fm
	 *  fields above). `source`/`songid` on such a stub are placeholders, never dispatched. */
	resolveByName?: boolean;
}

export interface SourceAdapter {
	id: SourceId;
	label: string;
	enabledByDefault: boolean;
	/** Whether this source may be AUTO-SELECTED to resolve a track it did NOT originate — i.e. become
	 *  a cross-source-failover TARGET (fallback.ts) or the kuwo-first name-stub resolver
	 *  (catalog.ts `resolveNameStub`). `undefined`/`true` = eligible (every mainstream source stays
	 *  undefined). `false` = searchable + explicit-pick ONLY, NEVER an auto-resolve target — used by
	 *  YTMusic, whose upstream is adversarial + IP-locked, so it is kept OFF the kuwo→qq→netease→joox
	 *  resolve floor (27-CONTEXT). A FAILED ytmusic track still falls FORWARD to that floor like any
	 *  other; only the reverse (a mainstream track failing over TO ytmusic) is barred. The flag is
	 *  DECLARED here in Plan 27-01; the failover / name-stub code that HONORS it lands in Plan 27-04. */
	autoResolveEligible?: boolean;
	search(keyword: string, page: number, signal: AbortSignal): Promise<Track[]>;
	/** Lazy resolution: audioUrl + lrc + quality + detailsLoaded.
	 *  `quality` (WR-07): an explicit per-call quality tier — used by the download path to
	 *  request settings.downloadQuality WITHOUT mutating the global streaming default (the old
	 *  temporary-swap pattern raced concurrent playback resolves and could be persisted by any
	 *  mid-window save()). Absent → the adapter reads settings.defaultQuality as before. */
	resolve(track: Track, signal: AbortSignal, quality?: DefaultQuality): Promise<Track>;
}

export interface SettledSourceResult {
	source: SourceId;
	status: 'ok' | 'error';
	tracks: Track[];
	/** Typed per-source error message for Phase-4 status UI (DATA-03). */
	error?: string;
}

/**
 * Build the canonical track uid. D-10 COLON form, e.g. makeUid('netease','123') === 'netease:123'.
 * Every adapter's search() MUST emit uids via this helper so identity is uniform.
 */
export function makeUid(source: SourceId, songid: string): string {
	return `${source}:${songid}`;
}
