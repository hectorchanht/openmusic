// Workstream F — Song Beat skin registry (brief §2.2/§2.3).
// ONE registry, registry-driven selector: adding a skin = one component + one entry
// here + one id appended to SONGBEAT_SKIN_IDS in songbeat.ts (locked order). Skins are
// stateless renderers: they receive lane state + callbacks from NpGame (the core caller)
// and emit raw lane down/up events only — they never own timing, score, sound or the
// player. This module is pure (no DOM, no stores) so the registry order and the
// selector wiring stay node-testable (songbeat-skins.test.ts).
import type { TranslationKey } from '$lib/i18n';
import { SONGBEAT_SKIN_IDS, type SongBeatSkinId } from '$lib/services/songbeat';
import type { PadId } from '$lib/services/tapalong';

/** Pad ACCESSIBLE names — one shared map for every pad-style skin (never re-declared
 *  per skin; ONE FUNCTION ONE PATH). Workstream H (2026-11-23): pads render ICONS
 *  (SongBeatPadIcon) — this map is the aria-label only, never visible pad text. */
export const PAD_LABEL: Record<PadId, string> = { kick: 'KICK', snare: 'SNARE', pluck: 'PLUCK', shaker: 'SHAKER' };

export interface SongBeatSkinDef {
	id: SongBeatSkinId;
	/** i18n key for the selector label (parity-guarded across all locales). */
	labelKey: TranslationKey;
	/** Fixed-geometry family (NO STRETCH: geometry is set by this spec, never content). */
	geometry: 'pads-2x2' | 'lanes-4' | 'lanes-4-chars' | 'pulse-ring' | 'lanes-4-rain';
}

/** The shipped skins, in the LOCKED application order. Square is the default and the
 *  first entry forever — users who never touch the selector keep Square exactly. */
export const SONGBEAT_SKINS: readonly SongBeatSkinDef[] = [
	{ id: 'square', labelKey: 'songbeat.skin.square', geometry: 'pads-2x2' },
	{ id: 'round', labelKey: 'songbeat.skin.round', geometry: 'pads-2x2' },
	{ id: 'highway', labelKey: 'songbeat.skin.highway', geometry: 'lanes-4' },
	{ id: 'character-catch', labelKey: 'songbeat.skin.characterCatch', geometry: 'lanes-4-chars' }
];

/** Registry integrity: the defs and the core's selectable ids are the same set, in
 *  the same order — a drift here would let the selector offer an unbuilt skin. */
export function skinsInLockedOrder(): boolean {
	return (
		SONGBEAT_SKINS.length === SONGBEAT_SKIN_IDS.length &&
		SONGBEAT_SKINS.every((def, i) => def.id === SONGBEAT_SKIN_IDS[i])
	);
}

export function skinDef(id: SongBeatSkinId): SongBeatSkinDef {
	return SONGBEAT_SKINS.find((def) => def.id === id) ?? SONGBEAT_SKINS[0];
}
