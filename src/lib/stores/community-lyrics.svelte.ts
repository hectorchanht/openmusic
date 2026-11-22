// community-lyrics (reactive) — the per-song community lyric versions the app has fetched
// (quick-261122-ugcb3, UGC lyrics B3). A LEAF store: it imports only pure services, so the lyric
// read (lyric-pins.svelte.ts readLyrics) can take it as its third rung without an import cycle.
// Writes that need the signed-in session (submit, pin, report) take the transport as a `fetcher`
// argument — the component passes auth.authedFetch — so this store never imports the auth store.
//
// READ CHAIN (brief §4): pin → upstream track.lrc → COMMUNITY canonical → null. Community fills the
// no-lyrics case directly; where upstream exists it joins the Fix-lyrics picker as labelled versions.
//
// Fetch discipline: ensure(track) is idempotent per uid per session (one edge-cached GET), and is
// called by the app layout ONLY for a current track whose upstream walk came back empty, and by the
// picker's community list on open — never per render.

import type { Track } from '$lib/sources/types';
import {
	lyricsSongKey,
	fetchCommunityLyrics,
	submitCommunityLyrics,
	voteCommunityLyrics,
	type CommunityVersion,
	type Fetcher,
	type SubmitInput
} from '$lib/services/community-lyrics';

type Entry = { k: string | null; versions: CommunityVersion[]; loading: boolean };

/** Session-scoped per-uid memo bound: plenty for a listening session, tiny in memory. */
const MAX_ENTRIES = 300;

class CommunityLyrics {
	/** Keyed by track uid. Reassigned (never mutated in place) so readers re-run. */
	entries = $state<Record<string, Entry>>({});
	/** Plain field: in-flight guard, never read reactively. */
	private started = new Set<string>();

	private set(uid: string, e: Entry) {
		const next = { ...this.entries, [uid]: e };
		const keys = Object.keys(next);
		if (keys.length > MAX_ENTRIES) {
			for (const old of keys.slice(0, keys.length - MAX_ENTRIES)) {
				delete next[old];
				this.started.delete(old);
			}
		}
		this.entries = next;
	}

	/** Fetch this song's versions once per session. Never throws. */
	async ensure(track: Pick<Track, 'uid' | 'artist' | 'title'> | null | undefined, force = false): Promise<void> {
		const uid = track?.uid;
		if (!uid || (!force && this.started.has(uid))) return;
		this.started.add(uid);
		const prev = this.entries[uid];
		this.set(uid, { k: prev?.k ?? null, versions: prev?.versions ?? [], loading: true });
		const k = await lyricsSongKey(track.artist ?? '', track.title ?? '');
		if (!k) {
			this.set(uid, { k: null, versions: [], loading: false });
			return;
		}
		const versions = await fetchCommunityLyrics(k);
		this.set(uid, { k, versions: versions ?? [], loading: false });
	}

	versionsFor(uid: string | null | undefined): CommunityVersion[] {
		return uid ? (this.entries[uid]?.versions ?? []) : [];
	}
	keyFor(uid: string | null | undefined): string | null {
		return uid ? (this.entries[uid]?.k ?? null) : null;
	}
	isLoading(uid: string | null | undefined): boolean {
		return !!uid && !!this.entries[uid]?.loading;
	}
	/** The canonical (most-pinned visible) version's text — the read chain's third rung. */
	canonicalLrc(uid: string | null | undefined): string | null {
		return this.versionsFor(uid)[0]?.lrc || null;
	}

	/** Submit a version for `uid`'s song; on success the list is replaced with the server's. */
	async submit(uid: string, fetcher: Fetcher, input: SubmitInput) {
		const r = await submitCommunityLyrics(fetcher, input);
		if (r.ok) this.set(uid, { k: input.k, versions: r.versions, loading: false });
		return r;
	}

	/** Move this listener's vote onto `id` (pins are the vote). Fire-and-forget. */
	async pin(uid: string, fetcher: Fetcher, id: string): Promise<void> {
		const k = this.keyFor(uid);
		if (!k) return;
		const v = await voteCommunityLyrics(fetcher, k, id, 'pin');
		if (v) this.set(uid, { k, versions: v, loading: false });
	}

	/** Report a version: hidden locally at once, the server decides at HIDE_REPORTS. */
	async report(uid: string, fetcher: Fetcher, id: string): Promise<void> {
		const k = this.keyFor(uid);
		if (!k) return;
		const e = this.entries[uid];
		if (e) this.set(uid, { ...e, versions: e.versions.filter((x) => x.id !== id) });
		await voteCommunityLyrics(fetcher, k, id, 'report');
	}
}

export const communityLyrics = new CommunityLyrics();
