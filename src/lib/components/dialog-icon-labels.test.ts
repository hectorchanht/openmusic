// Workstream H batch 5 — dialog / sheet ICON-label regression pins
// (NO SILENT BREAKAGE). Hector 2026-11-23 22:08 (Dawn-Design §8 v1.6): dialog
// and sheet action buttons whose labels a glyph can carry are icon-only;
// words survive as aria-label + title. These pins FAIL if a converted dialog
// control regains visible text or loses its accessible name.
// NOT converted (batch report): SyncReviewModal's Merge / Keep mine / Use
// theirs (a three-way data-provenance choice with no unambiguous glyphs on a
// destructive-choice dialog), SleepTimerSheet minute rows (duration VALUES —
// the number is the label's substance), dialog TITLES / menu-head headings
// (headings are content, not control labels).
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';

const confirm = readFileSync('src/lib/components/ConfirmModal.svelte', 'utf-8');
const menuBtn = readFileSync('src/lib/components/MenuActionButton.svelte', 'utf-8');
const trackMenu = readFileSync('src/lib/components/TrackMenu.svelte', 'utf-8');
const libraryPage = readFileSync('src/routes/(app)/library/+page.svelte', 'utf-8');
const layout = readFileSync('src/routes/(app)/+layout.svelte', 'utf-8');
const charts = readFileSync('src/routes/(app)/charts/top/+page.svelte', 'utf-8');
const sleep = readFileSync('src/lib/components/SleepTimerSheet.svelte', 'utf-8');
const voice = readFileSync('src/lib/components/VoiceSheet.svelte', 'utf-8');
const supporter = readFileSync('src/lib/components/SupporterSheet.svelte', 'utf-8');

describe('H batch 5 — ConfirmModal actions are icon-only', () => {
	it('Cancel = X; Confirm = caller glyph (confirmIcon prop, Check default), label as aria-label', () => {
		expect(confirm).toContain("aria-label={t('tags.cancel')}");
		expect(confirm).toContain('<X size={18} />');
		expect(confirm).toContain('confirmIcon?: Component');
		expect(confirm).toContain('aria-label={confirmLabel}');
		expect(confirm).toContain('<ConfirmIcon size={18} />');
		expect(confirm).not.toContain('use:tapBounce>{confirmLabel}</button');
		expect(confirm).not.toContain("use:tapBounce>{t('tags.cancel')}</button>");
	});
	it('call sites pass the glyph that matches the confirm semantics', () => {
		expect(libraryPage).toContain('confirmIcon={Trash2}');
		expect(readFileSync('src/routes/(app)/search/+page.svelte', 'utf-8')).toContain('confirmIcon={Trash2}');
		expect(readFileSync('src/routes/(app)/settings/+page.svelte', 'utf-8')).toContain('confirmIcon={RotateCcw}');
		expect(readFileSync('src/routes/(app)/settings/account/+page.svelte', 'utf-8')).toContain('confirmIcon={LogOut}');
	});
});

describe('H batch 5 — sheet + menu action buttons are icon-only', () => {
	it('MenuActionButton supports icon-only via the label prop', () => {
		expect(menuBtn).toContain('label?: string');
		expect(menuBtn).toContain('aria-label={label}');
		expect(menuBtn).toContain('class:icon-only={label && !children}');
	});
	it('TrackMenu sub-sheets: new playlist, remove-download, cover/lyrics actions icon-only', () => {
		expect(trackMenu).toContain("aria-label={t('menu.newPlaylist')}");
		expect(trackMenu).toContain("aria-label={t('menu.removeDownloadAction')}");
		expect(trackMenu).toContain("label={t('tags.cancel')}");
		expect(trackMenu).toContain("label={t('menu.refreshCover')}");
		expect(trackMenu).toContain("label={t('menu.lyricsRetry')}");
		expect(trackMenu).toContain("label={t('menu.useTheseLyrics')}");
		expect(trackMenu).toContain("label={t('menu.lyricsAuto')}");
		expect(trackMenu).toContain("label={t('menu.writeOwnLyrics')}");
		expect(trackMenu).not.toContain("<Plus size={18} /> {t('menu.newPlaylist')}");
	});
	it('library list menu rows are icon-only', () => {
		expect(libraryPage).toContain("aria-label={t('library.deletePlaylist')}");
		expect(libraryPage).toContain("aria-label={t('library.clearList')}");
		expect(libraryPage).not.toContain("<Trash2 size={18} /> {t('library.deletePlaylist')}");
	});
	it('update-bar Reload and charts offline CTA are glyphs', () => {
		expect(layout).toContain("aria-label={t('update.reload')}");
		expect(layout).toContain('<RefreshCw size={16} />');
		expect(layout).not.toContain("{t('update.reload')}\n\t\t\t</button>");
		expect(charts).toContain("aria-label={t('offline.goToLibrary')}");
		expect(charts).toContain('<Library size={18} />');
	});
	it('sleep timer: end-of-track = MoonStar, cancel = X (minute rows stay values)', () => {
		expect(sleep).toContain('<MoonStar size={18} />');
		expect(sleep).toContain("aria-label={t('timer.endOfTrack')}");
		expect(sleep).toContain("aria-label={t('timer.cancel')}");
		expect(sleep).toContain("{t('timer.minutes', { n: min })}");
	});
	it('voice sheet actions are icon-only', () => {
		expect(voice).toContain("aria-label={t('voice.done')}");
		expect(voice).toContain("aria-label={t('voice.ok')}");
		expect(voice).toContain("aria-label={t('voice.no')}");
		expect(voice).toContain("aria-label={t('voice.askAgain')}");
		expect(voice).not.toContain("<Check size={34} strokeWidth={3} /> {t('voice.ok')}");
		expect(voice).not.toContain("use:tapBounce>{t('voice.done')}</button>");
	});
	it('supporter verify is a ShieldCheck glyph (hardcoded EN label kept as aria-label)', () => {
		expect(supporter).toContain('<ShieldCheck size={18} />');
		expect(supporter).toContain("aria-label={verifying ? 'Verifying…' : 'Verify key'}");
		expect(supporter).not.toContain("{verifying ? 'Verifying…' : 'Verify key'}\n\t\t\t\t\t</button>");
	});
});
