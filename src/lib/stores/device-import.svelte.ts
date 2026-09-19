// deviceImport — the runes singleton that DRIVES the device import (Phase 34, D-05/D-06/D-07/D-08/
// D-12/D-13/D-14). It is a thin wrapper over the pure brain in `$lib/services/device-import`: the
// brain decides what the library should become, this store pages the MediaStore bridge, APPLIES the
// resulting plan, and owns the reactive state the settings page renders.
//
// Rules persist under `openmusic:import-rules:v1` (IMPORT_RULES_KEY, D-12). D-14: the defaults are
// a working import on their own — `load()` plus one `runImport()` needs zero configuration, and the
// audio-read permission is asked for AT TAP TIME, never at launch.
//
// WHY PROGRESS LIVES HERE AND NOT IN THE PAGE (UI-SPEC contract 3): navigating away mid-scan must
// not cancel it, and coming back must re-attach to the run already in flight. A page-local `$state`
// dies with the component; a module singleton does not. Only `cancel()` cancels.
//
// GENERATION GUARD (the house idiom): `importGen` is bumped at the top of `runImport` and by
// `cancel()`. After EVERY await the loop re-reads it and bails when a newer call (or a cancel) has
// superseded this one — a cancel is not a kill signal to the bridge, the in-flight page still
// resolves and is simply ignored.
//
// NOTICE CHANNEL (CLAUDE.md: stores emit a TranslationKey, never localized text): completion is
// published as `notice` — a key plus params. The (app) layout host maps it through `t()` and clears
// it. This store imports neither the i18n layer nor the toast store.
import { browser } from '$app/environment';
import { MediaStoreSaver } from '$lib/services/media-store';
import { SCAN_PAGE_SIZE, syncDevice, type ImportSummary } from '$lib/services/device-import';
import {
	DEFAULT_IMPORT_RULES,
	IMPORT_RULES_KEY,
	parseImportRules,
	validateCustomPattern,
	type ImportRules,
	type PatternRejection
} from '$lib/services/device-filename';
import { excludedUids } from '$lib/services/import-exclusions';
import type { ScanRow } from '$lib/services/device-track';
import { library } from '$lib/stores/library.svelte';
import { blobStore } from '$lib/services/blob-store';
import { logAction } from '$lib/stores/actionLog.svelte';

export type ImportPhase = 'idle' | 'requesting' | 'scanning' | 'done';

export type ImportNotice = {
	key: 'toast.importDone' | 'toast.importFailed' | 'toast.patternFellBack';
	params?: Record<string, string | number>;
};

/**
 * The completion toast — ONE slot, so it carries the most actionable news.
 *
 * Precedence is failed > patternFellBack > done. The count is not lost by the middle case: the
 * persistent summary panel the user is already looking at renders every count in full (UI-SPEC
 * contract 4), whereas a silently demoted custom pattern has no other surface (UI-SPEC line 432
 * requires it to surface as a toast).
 */
export function importNotice(summary: ImportSummary, failed: boolean): ImportNotice {
	if (failed) return { key: 'toast.importFailed' };
	if (summary.patternFellBack) return { key: 'toast.patternFellBack' };
	return { key: 'toast.importDone', params: { count: summary.added } };
}

class DeviceImport {
	/** The persisted rule set (D-12). Replaced wholesale on every edit so the runes graph re-renders. */
	rules = $state<ImportRules>(DEFAULT_IMPORT_RULES);
	phase = $state<ImportPhase>('idle');
	/** Rows checked so far — monotonic within a run. */
	done = $state(0);
	/** 0 until the first page answers; only ever GROWS, so the bar never moves backwards. */
	total = $state(0);
	/** The last run's counts — survives navigation, which is why it lives in the store. */
	summary = $state<ImportSummary | null>(null);
	/** Set only when the grant was refused; null on a granted run (UI-SPEC contract 2). */
	permission = $state<'denied' | 'denied-permanently' | null>(null);
	/** Why the last typed custom pattern was refused. Never blocks import (UI-SPEC contract 6). */
	patternError = $state<PatternRejection | null>(null);
	/** store→UI channel: the layout host maps this through t() and clears it. */
	notice = $state<ImportNotice | null>(null);

	// CLAUDE.md internal-counter rule: these are read by NO template, so they are PLAIN fields, not
	// $state — a generation counter that invalidates the runes graph on every bump is pure churn.
	private loaded = false;
	private importGen = 0;

	/** Hydrate rules from localStorage once, in the browser. Idempotent — call it from onMount. */
	load() {
		if (this.loaded || !browser) return;
		this.loaded = true;
		try {
			this.rules = parseImportRules(localStorage.getItem(IMPORT_RULES_KEY));
		} catch {
			/* corrupt/unavailable — the defaults already in `rules` are a working import (D-14) */
		}
	}

	/** Merge a rules patch and persist. `customPattern` is NOT settable here — it must be validated. */
	setRules(patch: Partial<Omit<ImportRules, 'customPattern'>>) {
		this.rules = { ...this.rules, ...patch };
		this.save();
	}

	/**
	 * Validate-then-save a custom filename pattern. NON-DESTRUCTIVE on rejection (UI-SPEC contract
	 * 6): the last working pattern stays in force, so a half-typed regex can never block an import.
	 * Returns whether the pattern was accepted.
	 */
	setCustomPattern(src: string): boolean {
		if (src.trim() === '') {
			this.rules = { ...this.rules, customPattern: '' };
			this.patternError = null;
			this.save();
			return true;
		}
		const res = validateCustomPattern(src);
		if (!res.ok) {
			this.patternError = res.reason;
			return false;
		}
		this.rules = { ...this.rules, customPattern: src };
		this.patternError = null;
		this.save();
		return true;
	}

	/**
	 * Permission → paged scan → one syncDevice → apply. A second tap while a run is in flight is a
	 * no-op (UI-SPEC: the CTA does not stack runs), which is also the T-34-18 interleaving guard.
	 */
	async runImport(): Promise<void> {
		if (this.phase === 'requesting' || this.phase === 'scanning') return;
		const myGen = ++this.importGen;
		this.phase = 'requesting';
		this.permission = null;
		this.summary = null;
		this.notice = null;
		this.done = 0;
		this.total = 0;

		// D-14: the grant is asked for HERE, at tap time. A rejecting bridge maps to the SOFT denied
		// state so the button stays tappable and Android may ask again.
		let state: string;
		try {
			state = (await MediaStoreSaver.requestReadAudio()).state;
		} catch {
			state = 'denied';
		}
		if (myGen !== this.importGen) return;
		if (state === 'denied' || state === 'denied-permanently') {
			this.permission = state;
			this.phase = 'idle';
			logAction('import.permission', { state });
			return;
		}
		if (state !== 'granted') {
			// 'unsupported' (API <= 28, no RELATIVE_PATH column) is a failure, not a permission state:
			// nothing the user can do in App info would change it.
			this.notice = { key: 'toast.importFailed' };
			this.phase = 'idle';
			logAction('import.permission', { state });
			return;
		}

		this.phase = 'scanning';
		const rows: ScanRow[] = [];
		let complete = true;
		let failed = false;
		let offset = 0;
		for (;;) {
			try {
				const page = await MediaStoreSaver.scanAudio({ offset, limit: SCAN_PAGE_SIZE });
				// The gen re-check after EVERY await is the house guard: a cancel (or a newer run)
				// during the bridge call must discard this page, not apply it.
				if (myGen !== this.importGen) {
					complete = false;
					break;
				}
				const pageRows = Array.isArray(page?.rows) ? page.rows : [];
				rows.push(...pageRows);
				offset += pageRows.length;
				this.done = offset;
				// total only ever grows, so the progress bar never moves backwards mid-walk.
				this.total = Math.max(this.total, Number(page?.total) || 0);
				if (pageRows.length === 0 || offset >= this.total) break;
			} catch {
				// A rejecting page is a TRANSIENT failure, never evidence that anything is gone —
				// `complete: false` is what keeps D-08's drop pass from running.
				failed = true;
				complete = false;
				break;
			}
		}

		// Compile the untrusted pattern ONCE for the whole run (layer-2 ReDoS budgeting lives in the
		// brain). A pattern that no longer validates simply falls back to the D-13 presets.
		const v = this.rules.customPattern ? validateCustomPattern(this.rules.customPattern) : null;
		const custom = v && v.ok ? v.re : null;

		// quick-260919-30x: the user's per-file "don't import again" marks. Read HERE, at call time,
		// not at module load or on mount — the user may have marked files from the track menu since
		// this page was opened, and a scan that ignored those marks would put every one of them
		// straight back.
		const plan = syncDevice(library.downloads, rows, this.rules, { complete, custom, excluded: excludedUids() });

		// RELINK FIRST, then the downloads commit (34-06's handoff): the stored public URI must be
		// in the index before the entry it belongs to is published, or a relinked song is playable
		// only after the next launch.
		for (const r of plan.relink) blobStore.linkPublicUri(r.uid, r.uri);
		library.setDownloads(plan.downloads);
		// Only a COMPLETE walk confirms every listed file is present, so only it may clear the marks.
		if (complete) library.clearUnavailable();

		this.summary = plan.summary;
		this.phase = 'done';
		this.notice = importNotice(plan.summary, failed);
		logAction('import.done', {
			added: plan.summary.added,
			relinked: plan.summary.relinked,
			removed: plan.summary.removed,
			complete,
			failed,
			rows: rows.length
		});
	}

	/**
	 * Stop after the in-flight page. NOT a kill signal to the bridge — the page already requested
	 * still resolves and is discarded by the gen check. Partial results are KEPT and the D-07 drop
	 * pass does not run, because `complete` is false (D-08: a cancelled walk cannot tell "gone"
	 * from "never reached").
	 */
	cancel() {
		if (this.phase !== 'scanning') return;
		this.importGen++;
		logAction('import.cancel', {});
	}

	private save() {
		if (!browser) return;
		try {
			localStorage.setItem(IMPORT_RULES_KEY, JSON.stringify(this.rules));
		} catch {
			/* quota — non-fatal, the rules just stay session-local */
		}
	}
}

export const deviceImport = new DeviceImport();
