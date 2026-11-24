import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

// quick-261123-dlsrc (Hector 2026-11-23 04:05): the TrackMenu showed BOTH the old source's
// "✓ Downloaded" face AND the "Download from source" cell after a source switch. The pure
// rule is pinned in download-state.test.ts and the store read in library.svelte.test.ts;
// this file pins the WIRING — every status surface reads the current-source answer, and the
// menu's two download faces can never co-render for a current-source-downloaded track.
const read = (name: string) => readFileSync(fileURLToPath(new URL(`./${name}`, import.meta.url)), 'utf8');

describe('download status wiring follows the current source (quick-261123-dlsrc)', () => {
	it('TrackMenu download cell reads isDownloadedForCurrentSource, not the song-level bridge', () => {
		const menu = read('TrackMenu.svelte');
		expect(menu).toContain('library.isDownloadedForCurrentSource(tr)');
		expect(menu).toContain('library.downloadUidForCurrentSource(resolved)');
		expect(menu).toContain('library.downloadUidForCurrentSource(track)');
	});

	it('(2) current source downloaded → Download-from-source cell is gated OFF (downloaded state only)', () => {
		const menu = read('TrackMenu.svelte');
		// canShow('downloadSource') must refuse when the current source is downloaded
		// (list entry or the exact-uid blob probe) — the two faces are mutually exclusive.
		expect(menu).toContain('!(track && library.isDownloadedForCurrentSource(track))');
		expect(menu).toContain('blobPresent !== true');
	});

	it('(1) DownloadControl + RowBadges status reads are current-source, not downloadUidFor', () => {
		const control = read('DownloadControl.svelte');
		expect(control).toContain('library.isDownloadedForCurrentSource(dlTrack)');
		expect(control).not.toContain('library.downloadUidFor(dlTrack)');
		const badges = read('RowBadges.svelte');
		expect(badges).toContain('library.downloadUidForCurrentSource(track)');
	});

	it('the song-level downloadUidFor bridge remains for playback (player untouched by this fix)', () => {
		const player = readFileSync(
			fileURLToPath(new URL('../stores/player.svelte.ts', import.meta.url)),
			'utf8'
		);
		expect(player).toContain('library.downloadUidFor(');
	});
});
