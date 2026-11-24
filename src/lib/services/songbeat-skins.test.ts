// Workstream F — Song Beat skin registry + selector pins (NO SILENT BREAKAGE).
// Source-pins read the components (no jsdom, the songbeat-scroll-lock.test.ts pattern):
// they FAIL if the selector, a shipped skin renderer, or its fixed geometry disappears.
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { SONGBEAT_SKINS, skinDef, skinsInLockedOrder } from './songbeat-skins';
import { SONGBEAT_SKIN_IDS, parseSongBeatSettings, serializeSongBeatSettings, DEFAULT_SONGBEAT_SETTINGS } from './songbeat';

const npGame = readFileSync('src/lib/components/NpGame.svelte', 'utf-8');

describe('skin registry — locked order (feel → Square → Round → …)', () => {
	it('ships square then round, in order, with the core id list in lockstep', () => {
		expect(SONGBEAT_SKINS.map((d) => d.id)).toEqual(['square', 'round']);
		expect([...SONGBEAT_SKIN_IDS]).toEqual(['square', 'round']);
		expect(skinsInLockedOrder()).toBe(true);
		expect(skinDef('round').labelKey).toBe('songbeat.skin.round');
	});

	it('default skin is square; settings roundtrip a skin; garbage falls back to square', () => {
		expect(DEFAULT_SONGBEAT_SETTINGS.skin).toBe('square');
		expect(parseSongBeatSettings(null).skin).toBe('square');
		expect(parseSongBeatSettings('{"skin":"nope"}').skin).toBe('square');
		const s = parseSongBeatSettings(serializeSongBeatSettings({ ...DEFAULT_SONGBEAT_SETTINGS, skin: 'round' }));
		expect(s.skin).toBe('round');
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
