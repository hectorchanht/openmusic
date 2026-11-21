import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';

// version-picker-canonical (quick-261121-canon, Hector 2026-11-21 02:07 CST) —
// ManyToCanon’s presentation gate.
// STRUCTURAL gate for the golden-record presentation rule: "many to many to the
// best one, and from this best one". Dawn has many providers producing many
// variants, but the user FACES only ONE best version; ALL variants are available
// inside a SOURCES MODAL, and the modal is the ONLY place variants enumerate.
// Vitest here has no jsdom, so — like cover-menu.test.ts — these assertions read
// SOURCE with comments stripped.

const read = (p: string) => readFileSync(p, 'utf-8');
function stripComments(src: string): string {
	return src
		.replace(/<!--[\s\S]*?-->/g, '')
		.replace(/\/\*[\s\S]*?\*\//g, '')
		.split('\n')
		.filter((l) => !/^\s*\/\//.test(l))
		.join('\n');
}

const picker = stripComments(read('src/lib/components/VersionPicker.svelte'));
const menu = stripComments(read('src/lib/components/TrackMenu.svelte'));
const nowPlaying = stripComments(read('src/lib/components/NowPlaying.svelte'));
const songRow = stripComments(read('src/lib/components/SongRow.svelte'));
const compactRow = stripComments(read('src/lib/components/CompactRow.svelte'));

describe('golden-record presentation — one render, variants only in the sources modal', () => {
	it('list rows NEVER enumerate variants (no picker, no variant fan-out in a row)', () => {
		for (const row of [songRow, compactRow]) {
			expect(row).not.toContain('VersionPicker');
			expect(row).not.toContain('fetchVariants');
		}
	});

	it('the sources modal badges the record default + the pin, and carries the pin toggle', () => {
		expect(picker).toContain('defaultUid');
		expect(picker).toContain('pinnedUid');
		expect(picker).toContain('onpinvariant');
		expect(picker).toContain("t('versions.default')");
		expect(picker).toContain("t('versions.pinned')");
	});

	it('both modal mounts feed the record: variants register in, default/pin read out', () => {
		for (const mount of [menu, nowPlaying]) {
			expect(mount).toContain('registerRecordVariants');
			expect(mount).toContain('readDefaultVariantUid');
			expect(mount).toContain('readVariantPin');
			expect(mount).toContain('pinRecordVariant');
			expect(mount).toContain('onpinvariant');
		}
	});
});
