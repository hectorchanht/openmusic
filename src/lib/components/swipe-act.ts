import type { Component } from 'svelte';
import { SkipForward, SkipBack, Heart, ListStart, ListEnd } from '@lucide/svelte';
import type { Track } from '$lib/sources/types';
import type { SwipeAct, SwipeMap } from '$lib/config/defaults';
import type { SwipeActionOpts } from '$lib/actions/swipeAction';
import type { CoverSwipeOpts } from '$lib/actions/coverSwipe';
import { player } from '$lib/stores/player.svelte';
import { toast } from '$lib/stores/toast.svelte';
import { likeWithUndo } from '$lib/components/like-with-undo';
import { tick as hapticTick } from '$lib/util/haptics';
import { t } from '$lib/i18n';

// quick-261108-swp (Hector 2026-11-08): the ONE place a sideways swipe on a song row turns into an
// action. The user picks each direction in Settings → Playback (settings.swipeRow); every row
// surface (SongRow's default, the charts pages, album, Related) routes through rowSwipe() so the
// choice, the stub-resolve, the toast and the haptic can never drift between pages again (the
// album page's right-swipe queued under a Heart icon before this).

/** Reveal glyph for each act — `null` = nothing to show (that direction is off). */
export const SWIPE_ICON: Record<SwipeAct, Component<{ size?: number }> | null> = {
	next: SkipForward,
	prev: SkipBack,
	like: Heart,
	playNext: ListStart,
	queue: ListEnd,
	off: null
};

/** A row's song for `act`, possibly behind a resolve. `undefined` = superseded (do nothing, say
 *  nothing); `null` = nothing playable there. `act` lets a host hand a queueable name-stub to
 *  playNext/queue (the player resolves it on play) while Like waits for a real identity. */
export type SwipeTarget = (act: SwipeAct) => Track | null | undefined | Promise<Track | null | undefined>;

// WR-03 / D-16 (carried over from the per-page guards): a second swipe on the same row while its
// multi-second stub resolve is still in flight is a no-op. Plain Set — the UI never reads it.
const inFlight = new Set<string>();

function handler(act: SwipeAct, target: SwipeTarget, key: string | undefined): (() => void) | undefined {
	switch (act) {
		case 'off':
			return undefined;
		case 'next':
			return () => {
				hapticTick();
				player.next();
			};
		case 'prev':
			return () => {
				hapticTick();
				player.prev();
			};
		default:
			return async () => {
				const k = key && `${act}:${key}`;
				if (k) {
					if (inFlight.has(k)) return;
					inFlight.add(k);
				}
				try {
					const tr = await target(act);
					if (tr === undefined) return;
					if (!tr) {
						toast.show(t('home.unplayable'));
						return;
					}
					hapticTick();
					if (act === 'like') {
						likeWithUndo(tr);
					} else if (act === 'playNext') {
						player.playNext(tr);
						toast.show(t('toast.playingNext'));
					} else {
						player.addToQueue(tr);
						toast.show(t('toast.addedToQueue'));
					}
				} finally {
					if (k) inFlight.delete(k);
				}
			};
	}
}

/** swipeAction opts for a song row under the user's swipe map. `key` (the row's identity) arms
 *  the in-flight guard — pass it whenever `target` resolves over the network. */
export function rowSwipe(map: SwipeMap, target: SwipeTarget, key?: string): SwipeActionOpts {
	return { onSwipeRight: handler(map.right, target, key), onSwipeLeft: handler(map.left, target, key) };
}

/** coverSwipe opts for the PLAYING song's surfaces (Nowbar, Now Playing cover) under
 *  settings.swipePlayer. A drag RIGHT fires the right-swipe act through coverSwipe's `onprev` slot,
 *  a drag LEFT the left-swipe act through `onnext`. An 'off' direction (and playNext/queue, which
 *  mean nothing for the song already playing) rubber-bands and never fires; 'prev' keeps the
 *  first-track boundary (`hasPrevNeighbor`). No haptic on next/prev — the track change is the
 *  feedback, as before this setting. */
export function playerSwipe(
	map: SwipeMap,
	current: Track | null,
	hasPrevNeighbor: boolean
): Pick<CoverSwipeOpts, 'onprev' | 'onnext' | 'hasPrev' | 'hasNext'> {
	const fn = (a: SwipeAct): (() => void) | null => {
		if (a === 'next') return () => player.next();
		if (a === 'prev') return () => player.prev();
		if (a === 'like' && current) {
			return () => {
				hapticTick();
				likeWithUndo(current);
			};
		}
		return null;
	};
	const right = fn(map.right);
	const left = fn(map.left);
	const noop = () => {};
	return {
		onprev: right ?? noop,
		onnext: left ?? noop,
		hasPrev: !!right && (map.right !== 'prev' || hasPrevNeighbor),
		hasNext: !!left && (map.left !== 'prev' || hasPrevNeighbor)
	};
}
