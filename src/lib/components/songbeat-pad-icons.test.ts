// Workstream H — Song Beat ICON pads regression pins (NO SILENT BREAKAGE).
// Hector 2026-11-23 22:07 (GOLD Icon Status Mapping / One-Look-Knows): every label on
// the Song Beat surface that an icon can carry IS an icon; the words survive only as
// aria-labels. These pins FAIL if a pad ever renders its instrument name as visible
// text again, if two pads share a glyph, if the aria names are dropped, or if the
// fixed pad geometry (NO STRETCH) moves. Source pins follow the repo's established
// component-test pattern (songbeat-skins.test.ts / play-glyph-wiring.test.ts — this
// project has no jsdom and does not SSR-render components in tests).
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { PAD_LABEL } from '$lib/services/songbeat-skins';
import type { PadId } from '$lib/services/tapalong';

const PADS: PadId[] = ['kick', 'snare', 'pluck', 'shaker'];
const padIcon = readFileSync('src/lib/components/SongBeatPadIcon.svelte', 'utf-8');
const npGame = readFileSync('src/lib/components/NpGame.svelte', 'utf-8');
const square = readFileSync('src/lib/components/SongBeatSquareSkin.svelte', 'utf-8');
const round = readFileSync('src/lib/components/SongBeatRoundSkin.svelte', 'utf-8');

describe('Song Beat pad icons — shared glyph component (Workstream H)', () => {
	it('each pad renders an svg icon: snare=Lucide Drum, pluck=Lucide Guitar, kick+shaker=custom SVGs', () => {
		expect(padIcon).toContain("import { Drum, Guitar } from '@lucide/svelte'");
		expect(padIcon).toContain("pad === 'snare'");
		expect(padIcon).toContain('<Drum {size}');
		expect(padIcon).toContain("pad === 'pluck'");
		expect(padIcon).toContain('<Guitar {size}');
		expect(padIcon).toContain("pad === 'kick'");
		expect(padIcon).toContain("pad === 'shaker'");
		// The two custom glyphs are inline <svg> in the Lucide stroke style.
		expect((padIcon.match(/<svg /g) ?? []).length).toBe(2);
		expect(padIcon).toContain('viewBox="0 0 24 24"');
		expect(padIcon).toContain('stroke-width="2"');
		expect(padIcon).toContain('stroke="currentColor"');
	});

	it('the four pad glyphs are pairwise distinct (one branch + one identity per pad)', () => {
		for (const pad of PADS) {
			expect(padIcon).toContain(`data-pad-icon={pad}`);
			expect(padIcon).toContain(`pad === '${pad}'`);
		}
		// Distinct bodies: Drum component, Guitar component, bass-drum circles, maraca ellipse.
		expect(padIcon).toContain('<ellipse');
		expect(padIcon).toContain('cx="12" cy="10" r="7"');
		const branches = padIcon.match(/pad === '(kick|snare|pluck|shaker)'/g) ?? [];
		expect(new Set(branches).size).toBe(4);
	});

	it('the glyph component itself carries NO visible instrument words', () => {
		for (const pad of PADS) expect(padIcon).not.toContain(PAD_LABEL[pad]);
		expect(padIcon).toContain('aria-hidden="true"');
	});
});

describe('Song Beat pad icons — skins render icons, never visible text labels', () => {
	for (const [name, src] of [['Square', square], ['Round', round]] as const) {
		it(`${name} skin: pads render the shared icon component and NO visible text label`, () => {
			expect(src).toContain("import SongBeatPadIcon from '$lib/components/SongBeatPadIcon.svelte'");
			expect(src).toContain('<SongBeatPadIcon {pad} />');
			expect(src).not.toContain('pad-label');
			expect(src).not.toContain('{PAD_LABEL[pad]}</span>');
		});

		it(`${name} skin: aria-labels still carry the instrument names`, () => {
			expect(src).toContain('aria-label={PAD_LABEL[pad]}');
			for (const pad of PADS) expect(PAD_LABEL[pad].length).toBeGreaterThan(0);
		});
	}

	it('pad geometry is unchanged (NO STRETCH pin)', () => {
		expect(square).toContain('height: 104px');
		expect(round).toContain('width: 112px; height: 112px');
		expect(round).toContain('aspect-ratio: 1');
		expect(round).toContain('border-radius: 50%');
	});
});

describe('Song Beat toolbar — labels became icons (Workstream H sweep)', () => {
	it('difficulty selector is icon-led: 1→4 intensity bars, name only in aria-label/title', () => {
		expect(npGame).toContain('class="diff-bars"');
		expect(npGame).toContain('class:filled={b <= di}');
		expect(npGame).toContain('aria-label={t(DIFF_KEY[d as Difficulty])}');
		expect(npGame).not.toContain('>{t(DIFF_KEY[d as Difficulty])}</button>');
	});

	it('skin selector is icon-led: Square/Circle shape glyphs, name only in aria-label/title', () => {
		expect(npGame).toContain('<Square size={16}');
		expect(npGame).toContain('<Circle size={16}');
		expect(npGame).toContain('aria-label={t(def.labelKey)}');
		expect(npGame).not.toContain('>{t(def.labelKey)}</button>');
	});

	it('challenge toggle carries the Swords icon, name only in aria-label/title', () => {
		expect(npGame).toContain('<Swords size={16}');
		expect(npGame).toContain("aria-label={t('songbeat.challenge')}");
		expect(npGame).not.toContain(">{t('songbeat.challenge')}</button>");
	});

	it('calibration + volume rows lead with Crosshair / Volume2 icons; quantities stay numeric', () => {
		expect(npGame).toContain('<Crosshair size={16}');
		expect(npGame).toContain('<Volume2 size={16}');
		expect(npGame).toContain("aria-label={t('songbeat.calibration')}");
		expect(npGame).toContain("aria-label={t('songbeat.volume')}");
		// The calibration VALUE is a quantity — it stays visible and numeric.
		expect(npGame).toContain('{beat.calibrationMs}ms');
		// Approach pills are quantities too — untouched numeric text.
		expect(npGame).toContain('}s</button>');
	});

	it('the shipped scroll LOCK toggle is not regressed (44×44, Lock/LockOpen = state)', () => {
		expect(npGame).toContain('lock-toggle');
		expect(npGame).toContain('<Lock size={20}');
		expect(npGame).toContain('<LockOpen size={20}');
		expect(npGame).toContain('width: 44px; height: 44px');
	});
});
