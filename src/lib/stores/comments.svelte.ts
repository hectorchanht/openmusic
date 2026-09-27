// quick-260926-pb0: the comment thread of the CURRENT track, lifted out of NpComments so NowPlaying
// can print the count on the Comments tab while the pane is unmounted. One edge-cached GET per
// track, and only when Now Playing is on screen — the trigger lives in NowPlaying.svelte, not here.
// A LEAF store (like settings): it never imports player — the caller passes the track in — so it
// stays node-testable and cannot form an import cycle.

import { commentThreadKey, fetchComments, reportComment, type CommentItem } from '$lib/services/comments';
import type { Track } from '$lib/sources/types';

/** Tab count label: null at 0, the number up to 99, then '99+' (the server caps a thread at 100). */
export function commentBadge(n: number): string | null {
	if (!(n > 0)) return null;
	return n > 99 ? '99+' : String(n);
}

class Comments {
	/** The track this thread belongs to — NowPlaying uses it as a stale guard. */
	uid = $state<string | null>(null);
	/** Thread key; null = not yet resolved / unavailable. */
	key = $state<string | null>(null);
	items = $state<CommentItem[]>([]);
	loading = $state(false);
	unavailable = $state(false);
	/** Session-wide local hides. Ids are UUIDs, so they never collide across threads. */
	reported = $state<string[]>([]);

	// Supersede guard — a PLAIN field, deliberately not $state (the player.svelte.ts
	// generation-guard convention): nothing renders it, and a newer load() must drop older replies.
	private gen = 0;

	/** The reporter stops seeing a comment at once, whatever the server decides. */
	get visible(): CommentItem[] {
		return this.items.filter((i) => !this.reported.includes(i.id));
	}

	get badge(): string | null {
		return commentBadge(this.visible.length);
	}

	/** Load `track`'s thread. Deduped per uid, so half<->full sheet toggles never refetch. */
	load(track: Pick<Track, 'uid' | 'artist' | 'title'>): void {
		if (this.uid === track.uid) return;
		const g = ++this.gen;
		this.uid = track.uid;
		this.key = null;
		this.items = [];
		this.unavailable = false;
		this.loading = true;
		void (async () => {
			// Both service calls are never-throw (sentinel returns).
			const k = await commentThreadKey(track.artist, track.title);
			if (g !== this.gen) return; // a newer track owns the thread — drop this reply
			if (!k) {
				this.unavailable = true;
				this.loading = false;
				return;
			}
			this.key = k;
			const got = await fetchComments(k);
			if (g !== this.gen) return;
			if (got === null) this.unavailable = true;
			else this.items = got;
			this.loading = false;
		})();
	}

	/** The server's post reply is the whole thread, newest first; the caller has checked the uid. */
	replace(items: CommentItem[]): void {
		this.items = items;
	}

	report(id: string): void {
		this.reported = [...this.reported, id];
		if (this.key) void reportComment(this.key, id); // fire-and-forget
	}

	/** Test hook. */
	__reset(): void {
		this.gen++;
		this.uid = null;
		this.key = null;
		this.items = [];
		this.loading = false;
		this.unavailable = false;
		this.reported = [];
	}
}

export const comments = new Comments();
