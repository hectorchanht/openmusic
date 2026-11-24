// Workstream H batch 4 — settings ICON-label regression pins (NO SILENT BREAKAGE).
// Hector 2026-11-23 22:08 (Dawn-Design §8 v1.6): settings action controls whose
// labels a glyph can carry are icon-only; words survive as aria-label + title.
// These pins FAIL if the converted controls regain visible text or lose their
// accessible names. NOT converted (documented in the batch report): setting
// NAME rows (SettingToggle / SettingRow labels — unique setting names with no
// glyph vocabulary; their controls — switch / chevron / value badge — are
// already glyphic) and value chips (language / region / source / extension
// names are data values, not control labels).
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';

const activity = readFileSync('src/routes/(app)/settings/activity/+page.svelte', 'utf-8');
const about = readFileSync('src/routes/(app)/settings/about/+page.svelte', 'utf-8');
const downloads = readFileSync('src/routes/(app)/settings/downloads/+page.svelte', 'utf-8');
const account = readFileSync('src/routes/(app)/settings/account/+page.svelte', 'utf-8');
const translation = readFileSync('src/routes/(app)/settings/translation/+page.svelte', 'utf-8');

describe('H batch 4 — settings action rows are icon-only', () => {
	it('activity log: Copy / Upload / Clear carry their labels as aria-labels', () => {
		expect(activity).toContain("aria-label={t('settings.activityCopy')}");
		expect(activity).toContain("aria-label={t('settings.activityUpload')}");
		expect(activity).toContain("aria-label={t('settings.activityClear')}");
		expect(activity).not.toContain("<Copy size={18} /> {t('settings.activityCopy')}");
		expect(activity).not.toContain("<Trash2 size={18} /> {t('settings.activityClear')}");
	});
	it('about: reset-ID row is a RotateCcw glyph with an aria-label', () => {
		expect(about).toContain("aria-label={t('privacy.resetId')}");
		expect(about).not.toContain("<span>{t('privacy.resetId')}</span>");
	});
	it('downloads: import CTA + cancel, retag controls and restore are icon-only', () => {
		expect(downloads).toContain("aria-label={t('import.cta')}");
		expect(downloads).toContain("aria-label={t('import.cancel')}");
		expect(downloads).not.toContain("{t('import.cta')}\n\t\t\t</button>");
		expect(downloads).toContain("aria-label={t('settings.retagPause')}");
		expect(downloads).toContain("aria-label={t('settings.retagResume')}");
		expect(downloads).toContain("aria-label={t('settings.retagCancel')}");
		expect(downloads).toContain("aria-label={t('settings.excludedRestore')}");
		expect(downloads).toContain('<Pause size={14} />');
		expect(downloads).toContain('<Undo2 size={14} />');
	});
	it('downloads retag row: Tags glyph + bare numeric count, full phrase as aria-label', () => {
		expect(downloads).toContain("aria-label={t('settings.retagDownloads', { count: eligible.length })}");
		expect(downloads).toContain('<span class="count">{eligible.length}</span>');
	});
	it('account: verify (ShieldCheck), send link (Send) and Google (G glyph) submits are icon-only', () => {
		expect(account).toContain('<ShieldCheck size={20} />');
		expect(account).toContain('<Send size={20} />');
		expect(account).toContain("aria-label={verifying ? t('account.verifying') : t('account.verifyCode')}");
		expect(account).toContain("aria-label={sending ? t('account.sending') : t('account.sendLink')}");
		expect(account).toContain("aria-label={googleLoading ? t('account.googleSigningIn') : t('account.googleSignIn')}");
		expect(account).not.toContain("{verifying ? t('account.verifying') : t('account.verifyCode')}\n\t\t\t\t\t</button>");
	});
	it('translation tabs: All = Layers, Artist = User, Title = Type, Bio = FileText', () => {
		expect(translation).toContain("aria-label={t('settings.translateApplyAll')}");
		expect(translation).toContain('<Layers size={16} />');
		expect(translation).toContain('icon: User');
		expect(translation).toContain('icon: Type');
		expect(translation).toContain('icon: FileText');
		expect(translation).toContain('aria-label={t(part.headingKey)}');
		expect(translation).not.toContain("use:tapBounce>{t(part.headingKey)}</button>");
		expect(translation).toContain('width: 34px; height: 34px;');
	});
});
