// Workstream F — Song Beat skin registry + selector pins (NO SILENT BREAKAGE).
// Source-pins read the components (no jsdom, the songbeat-scroll-lock.test.ts pattern):
// they FAIL if the selector, a shipped skin renderer, or its fixed geometry disappears.
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { SONGBEAT_SKINS, skinDef, skinsInLockedOrder } from './songbeat-skins';
import {
	SONGBEAT_SKIN_IDS,
	parseSongBeatSettings,
	serializeSongBeatSettings,
	DEFAULT_SONGBEAT_SETTINGS,
	createRun,
	visibleNotes,
	type Chart
} from './songbeat';

const npGame = readFileSync('src/lib/components/NpGame.svelte', 'utf-8');

describe('skin registry — locked order (feel → Square → Round → Highway → Character-Catch → Pulse → Rain)', () => {
	it('ships all six skins, in order, with the core id list in lockstep', () => {
		expect(SONGBEAT_SKINS.map((d) => d.id)).toEqual(['square', 'round', 'highway', 'character-catch', 'pulse', 'rain']);
		expect([...SONGBEAT_SKIN_IDS]).toEqual(['square', 'round', 'highway', 'character-catch', 'pulse', 'rain']);
		expect(skinsInLockedOrder()).toBe(true);
		expect(skinDef('round').labelKey).toBe('songbeat.skin.round');
		expect(skinDef('highway').labelKey).toBe('songbeat.skin.highway');
		expect(skinDef('highway').geometry).toBe('lanes-4');
		expect(skinDef('character-catch').labelKey).toBe('songbeat.skin.characterCatch');
		expect(skinDef('character-catch').geometry).toBe('lanes-4-chars');
		expect(skinDef('pulse').labelKey).toBe('songbeat.skin.pulse');
		expect(skinDef('pulse').geometry).toBe('pulse-ring');
		expect(skinDef('rain').labelKey).toBe('songbeat.skin.rain');
		expect(skinDef('rain').geometry).toBe('lanes-4-rain');
	});

	it('default skin is square; settings roundtrip a skin; garbage falls back to square', () => {
		expect(DEFAULT_SONGBEAT_SETTINGS.skin).toBe('square');
		expect(parseSongBeatSettings(null).skin).toBe('square');
		expect(parseSongBeatSettings('{"skin":"nope"}').skin).toBe('square');
		const s = parseSongBeatSettings(serializeSongBeatSettings({ ...DEFAULT_SONGBEAT_SETTINGS, skin: 'round' }));
		expect(s.skin).toBe('round');
		const h = parseSongBeatSettings(serializeSongBeatSettings({ ...DEFAULT_SONGBEAT_SETTINGS, skin: 'highway' }));
		expect(h.skin).toBe('highway');
		const c = parseSongBeatSettings(serializeSongBeatSettings({ ...DEFAULT_SONGBEAT_SETTINGS, skin: 'character-catch' }));
		expect(c.skin).toBe('character-catch');
		const p = parseSongBeatSettings(serializeSongBeatSettings({ ...DEFAULT_SONGBEAT_SETTINGS, skin: 'pulse' }));
		expect(p.skin).toBe('pulse');
		const r = parseSongBeatSettings(serializeSongBeatSettings({ ...DEFAULT_SONGBEAT_SETTINGS, skin: 'rain' }));
		expect(r.skin).toBe('rain');
	});
});

describe('Rain skin — droplets on the grow-out skeleton', () => {
	const rain = readFileSync('src/lib/components/SongBeatRainSkin.svelte', 'utf-8');
	it('NpGame renders it from the shared visible-note derivation with its own glyph', () => {
		expect(npGame).toContain('SongBeatRainSkin');
		expect(npGame).toContain("beat.skin === 'rain'");
		expect(npGame).toContain('CloudRain');
		expect(npGame).toContain("def.id === 'rain'");
	});

	it('the surface line is the centred border and drops are placed by growOut only', () => {
		expect(rain).toContain('rain-field');
		expect(rain).toContain('surface-line');
		expect(rain).toContain('growOut(n.signedDt, approachSec)');
		expect(rain).toContain('HALF * (1 + g.offset)');
		// Fixed geometry: 280px field, line at its centre, 22px drops, 44×14 puddles.
		expect(rain).toContain('height: 280px');
		expect(rain).toContain('top: 140px');
		expect(rain).toContain('width: 22px; height: 22px');
		expect(rain).toContain('width: 44px; height: 14px');
	});

	it('lanes render the shared pad ICON, never a visible text label (Workstream H)', () => {
		expect(rain).toContain("import SongBeatPadIcon from '$lib/components/SongBeatPadIcon.svelte'");
		expect(rain).toContain('<SongBeatPadIcon pad={lanePad(lane)}');
		expect(rain).not.toContain('lane-label');
		expect(rain).toContain('aria-label={PAD_LABEL[lanePad(lane)]}');
	});
});

describe('Pulse skin — one pulsing heart on the grow-out skeleton', () => {
	const pulse = readFileSync('src/lib/components/SongBeatPulseSkin.svelte', 'utf-8');
	it('NpGame renders it in the chain with its own selector glyph', () => {
		expect(npGame).toContain('SongBeatPulseSkin');
		expect(npGame).toContain("beat.skin === 'pulse'");
		expect(npGame).toContain('HeartPulse');
		expect(npGame).toContain("def.id === 'pulse'");
	});

	it('the stage is a fixed circle whose border is the perfect line; the ring grows by growOut', () => {
		expect(pulse).toContain('pulse-stage');
		expect(pulse).toContain('width: 200px; height: 200px');
		expect(pulse).toContain('border-radius: 50%');
		expect(pulse).toContain('growOut(stage.signedDt, approachSec)');
		expect(pulse).toContain('pulse-ring');
	});

	it('lanes render the shared pad ICON, never a visible text label (Workstream H)', () => {
		expect(pulse).toContain("import SongBeatPadIcon from '$lib/components/SongBeatPadIcon.svelte'");
		expect(pulse).toContain('<SongBeatPadIcon {pad}');
		expect(pulse).not.toContain('pad-label');
		expect(pulse).toContain('aria-label={PAD_LABEL[pad]}');
	});
});

describe('skin selector UI (shipped with Round, the first added skin)', () => {
	it('NpGame renders a registry-driven selector persisted through beat settings', () => {
		expect(npGame).toContain('SONGBEAT_SKINS');
		expect(npGame).toContain("t('songbeat.skin')");
		expect(npGame).toContain('skin: def.id');
		expect(npGame).toContain('SongBeatRoundSkin');
		expect(npGame).toContain('SongBeatSquareSkin');
	});

	it('the scroll LOCK toggle survives on the game surface (Dawn game law)', () => {
		expect(npGame).toContain('lock-toggle');
		expect(npGame).toContain("t('songbeat.scrollLock')");
	});
});

describe('Round skin — fixed circular geometry (NO STRETCH)', () => {
	const round = readFileSync('src/lib/components/SongBeatRoundSkin.svelte', 'utf-8');
	it('pads are fixed circles; the approach ring is circular', () => {
		expect(round).toContain('songbeat-skin-round');
		expect(round).toContain('border-radius: 50%');
		expect(round).toContain('width: 112px; height: 112px');
		expect(round).toContain('aspect-ratio: 1');
	});
});

describe('Highway skin — four lanes on the grow-out skeleton', () => {
	const highway = readFileSync('src/lib/components/SongBeatHighwaySkin.svelte', 'utf-8');
	it('NpGame renders it from the shared visible-note derivation', () => {
		expect(npGame).toContain('SongBeatHighwaySkin');
		expect(npGame).toContain('visibleNotes(run, now, beat.approachSec)');
		expect(npGame).toContain("beat.skin === 'highway'");
	});

	it('the selector gives Highway its own glyph (Icon Status Mapping)', () => {
		expect(npGame).toContain('Columns4');
		expect(npGame).toContain("def.id === 'highway'");
	});

	it('the judge line is the centred border and notes are placed by growOut only', () => {
		expect(highway).toContain('judge-line');
		expect(highway).toContain('lane-hit');
		expect(highway).toContain('growOut(n.signedDt, approachSec)');
		// Fixed geometry: 280px field, the line at its centre (140px), 18px notes.
		expect(highway).toContain('height: 280px');
		expect(highway).toContain('top: 140px');
		expect(highway).toContain('HALF * (1 + g.offset)');
	});

	it('lanes render the shared pad ICON, never a visible text label (Workstream H)', () => {
		expect(highway).toContain("import SongBeatPadIcon from '$lib/components/SongBeatPadIcon.svelte'");
		expect(highway).toContain('<SongBeatPadIcon pad={lanePad(lane)}');
		expect(highway).not.toContain('lane-label');
		expect(highway).toContain('aria-label={PAD_LABEL[lanePad(lane)]}');
	});

	it('visibleNotes windows pending notes and reports holds', () => {
		const chart: Chart = {
			version: 1,
			source: 'lyric-est',
			notes: [{ t: 10, lane: 1, type: 'hold', dur: 30, anchor: false }]
		};
		const run = createRun(chart, 'standard', false);
		// Before the approach window: nothing to draw.
		expect(visibleNotes(run, 0, 1.6)).toEqual([]);
		// Half-way through the approach: progress ≈ 0.5, signedDt ≈ −0.8.
		const mid = visibleNotes(run, 9.2, 1.6);
		expect(mid).toHaveLength(1);
		expect(mid[0].progress).toBeCloseTo(0.5, 5);
		expect(mid[0].signedDt).toBeCloseTo(-0.8, 5);
		expect(mid[0].holding).toBe(false);
		// At the hit moment: progress 1, signedDt 0 — the border crossing.
		const at = visibleNotes(run, 10, 1.6);
		expect(at[0].progress).toBe(1);
		expect(at[0].signedDt).toBe(0);
		// Past the miss tail: the note leaves the field (advanceRun settles it in play).
		expect(visibleNotes(run, 10.3, 1.6)).toEqual([]);
	});
});
