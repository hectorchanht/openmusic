import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';

// Hector 2026-11-20 — covers display the Apple way: the WHOLE artwork at natural
// aspect, never centre-cropped (object-fit: cover was cutting faces off the wide
// 16:9 video-source thumbnails — his ロストライン comparison against the iOS widget).
// The treatment lives in ONE shared component (CoverArt.svelte, singleton rule);
// these source pins (the settings-ui / track-menu-ssr technique — no jsdom here)
// keep every surface routed through it and keep the gesture behaviours that share
// the cover nodes (long-press menu, double-tap dive, lazyCover chains) intact.
const read = (p: string) => readFileSync(p, 'utf-8');

describe('CoverArt — the shared no-crop cover renderer', () => {
	const src = read('src/lib/components/CoverArt.svelte');

	it('fits the artwork whole: the foreground layer is object-fit: contain', () => {
		expect(src).toMatch(/\.ca-fit\s*\{[^}]*object-fit: contain/);
	});

	it('fills the box with an ambient backdrop: same art, cover-fit, blurred + dimmed + enlarged', () => {
		expect(src).toMatch(/\.ca-ambient\s*\{[^}]*object-fit: cover/);
		expect(src).toMatch(/\.ca-ambient\s*\{[^}]*filter: blur\(/);
		expect(src).toMatch(/\.ca-ambient\s*\{[^}]*transform: scale\(/);
	});

	it('paints the fallback gradient as the base layer and drops the art on error (DEAD ≠ MISSING)', () => {
		expect(src).toContain('style:background={fallback}');
		expect(src).toContain('failedFor');
		expect(src).toContain('onerror={fail}');
	});

	it('both layers load the same src (one fetch, cache hit for the second)', () => {
		expect(src.match(/src=\{src\}/g)?.length).toBe(2);
	});
});

describe('every cover surface routes through CoverArt', () => {
	const surfaces = [
		'src/lib/components/NowPlaying.svelte',
		'src/lib/components/Nowbar.svelte',
		'src/lib/components/CarMode.svelte',
		'src/lib/components/SongRow.svelte',
		'src/lib/components/CompactRow.svelte',
		'src/lib/components/NpUpNext.svelte',
		'src/lib/components/NpRelated.svelte',
		'src/lib/components/TrackMenu.svelte',
		'src/routes/(app)/+page.svelte',
		'src/routes/(app)/album/[name]/+page.svelte',
		'src/routes/(app)/artist/[name]/+page.svelte',
		'src/routes/(app)/artist/[name]/albums/+page.svelte',
		'src/routes/(app)/charts/shelf/[kind]/[id]/+page.svelte',
		'src/routes/(app)/song/[slug]/+page.svelte',
		'src/routes/(app)/song/[artist]/[title]/+page.svelte',
		'src/routes/(app)/settings/downloads/+page.svelte'
	];
	for (const f of surfaces) {
		it(`${f} renders <CoverArt`, () => {
			expect(read(f)).toContain('<CoverArt');
		});
	}
});

describe('the crop is gone from the migrated surfaces', () => {
	it('NowPlaying no longer paints covers as CSS backgrounds (cellBg is gone)', () => {
		const np = read('src/lib/components/NowPlaying.svelte');
		expect(np).not.toContain('const cellBg');
		expect(np).not.toContain('style:background-image={cellBg');
		expect(np).not.toMatch(/cover-cell[^>]*style:background-image/);
	});

	it('the song share pages no longer object-fit: cover their hero', () => {
		expect(read('src/routes/(app)/song/[slug]/+page.svelte')).not.toContain('object-fit: cover');
		expect(read('src/routes/(app)/song/[artist]/[title]/+page.svelte')).not.toContain('object-fit: cover');
	});

	it('the cover-picker candidates are not cropped either (no .cand img rule)', () => {
		expect(read('src/lib/components/TrackMenu.svelte')).not.toContain('.cand img');
	});
});

describe('behaviours sharing the cover nodes survive', () => {
	it('NowPlaying current cell keeps double-tap + long-press menu + neighbour lazyCover', () => {
		const np = read('src/lib/components/NowPlaying.svelte');
		expect(np).toContain('class="cover-cell cur"');
		expect(np).toContain('use:doubleTap');
		expect(np).toContain('onlongpress={openCoverMenu}');
		expect(np).toContain('use:lazyCover={{ track: prevCover, onResolved: onCoverResolved }}');
		expect(np).toContain('use:lazyCover={{ track: nextCover, onResolved: onCoverResolved }}');
	});

	it('Nowbar + CarMode covers keep their double-tap dive', () => {
		expect(read('src/lib/components/Nowbar.svelte')).toMatch(/class="np-art"[\s\S]{0,400}use:doubleTap/);
		expect(read('src/lib/components/CarMode.svelte')).toMatch(/class="cm-art"[\s\S]{0,300}use:doubleTap/);
	});

	it('SongRow keeps its lazyCover chain on the art box', () => {
		expect(read('src/lib/components/SongRow.svelte')).toContain(
			'use:lazyCover={{ track, enabled: lazy, onResolved: (_uid, url) => (resolvedCover = url) }}'
		);
	});
});
