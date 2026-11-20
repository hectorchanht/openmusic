// Diverse "top picks" builder — one hit from each of N distinct random artists,
// cross-source de-duplicated to the best-quality variant. Shared by the home page
// (top picks + Randomize) and the player's queue auto-grow.
import { searchAll } from '$lib/services/catalog';
import { dedupeBest } from '$lib/services/dedupe';
import { settings } from '$lib/stores/settings.svelte';
import type { Track } from '$lib/sources/types';

export const ARTIST_POOL = [
	'周杰伦', '邓紫棋', '林俊杰', '陈奕迅', '五月天', '李荣浩', '张惠妹', '王菲', '周深', '李宗盛',
	'Taylor Swift', 'Ed Sheeran', 'Lana Del Rey', 'Bruno Mars', 'Adele', 'The Weeknd', 'Billie Eilish', 'Coldplay', 'Maroon 5', 'Dua Lipa'
];

function sample<T>(arr: T[], n: number): T[] {
	const a = [...arr];
	for (let i = a.length - 1; i > 0; i--) {
		const j = Math.floor(Math.random() * (i + 1));
		[a[i], a[j]] = [a[j], a[i]];
	}
	return a.slice(0, n);
}

/**
 * Build `count` diverse picks: search `count` random distinct artists, take each
 * artist's top result, cross-source-dedupe, and exclude any uids already present.
 * Best-effort — silently skips artists that error or return nothing.
 */
export async function buildDiversePicks(count: number, excludeUids: Set<string> = new Set()): Promise<Track[]> {
	const artists = sample(ARTIST_POOL, Math.min(count, ARTIST_POOL.length));
	const results = await Promise.allSettled(artists.map((a) => searchAll(a, 1)));
	const tops: Track[] = [];
	for (const r of results) {
		if (r.status !== 'fulfilled') continue;
		const top = r.value.interleaved[0];
		if (top) tops.push(top);
	}
	return dedupeBest(tops, settings.preferredSource).filter((t) => !excludeUids.has(t.uid));
}
