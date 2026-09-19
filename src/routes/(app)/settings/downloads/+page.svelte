<script lang="ts">
	// Settings → Downloads. The home for anything about the FILES (/settings/playback keeps download
	// QUALITY). Two controls now share it:
	//   1. Device import (34) — scan this phone's Music/Download folders and list what is found.
	//   2. Retag (36-D-17)    — retro-tag the offline copies the app still holds.
	// Import is NATIVE-ONLY; retag works on the web build too, so the import block is the only thing
	// behind the native gate and the retag section below stays outside it.
	import { onMount } from 'svelte';
	import { goto } from '$app/navigation';
	import { Capacitor } from '@capacitor/core';
	import {
		ChevronLeft,
		Tags,
		HardDriveDownload,
		Smartphone,
		CircleAlert,
		Check,
		FolderSearch,
		SlidersHorizontal,
		FileMusic,
		Timer,
		ListFilter,
		ListX,
		Regex,
		EyeOff
	} from '@lucide/svelte';
	import { settings } from '$lib/stores/settings.svelte';
	import { library } from '$lib/stores/library.svelte';
	import { names } from '$lib/stores/names.svelte';
	import { blobStore, replayPendingDeviceWrites } from '$lib/services/blob-store';
	// quick-260919-ejm: the sweep now includes imported songs, so this page has to be able to COUNT
	// them before it asks. PURE module (the sole owner of the `device:` literal).
	import { isDeviceUid } from '$lib/services/device-track';
	// quick-260919-3j1: the sweep's cover was the PERSISTED Track.cover — not the user's pin and not
	// the shared reactive cache. See the ladder in the entry loop below.
	import { readPinnedCover, readCoverByUidOrName } from '$lib/stores/cover-version.svelte';
	import { retagDownloads, type RetagEntry } from '$lib/services/retag';
	import { deviceImport } from '$lib/stores/device-import.svelte';
	import { readExclusions, unexcludeUid } from '$lib/services/import-exclusions';
	// quick-260919-3j1: the PURE pin read, not the `.svelte.ts` reactive wrapper — this is an onMount
	// batch build, not a reactive render, and the page must not take a reactive dependency on the
	// pin record while assembling a list.
	import { getPinnedLyrics } from '$lib/services/lyric-pins';
	import {
		PRESET_ORDER,
		PRESET_LABELS,
		IMPORT_EXTENSIONS,
		parseFilename,
		validateCustomPattern,
		type PresetId
	} from '$lib/services/device-filename';
	import { tapBounce } from '$lib/actions/tapBounce';
	import { t } from '$lib/i18n';

	let msg = $state('');
	let eligible = $state<RetagEntry[]>([]);
	let busy = $state(false);
	let progress = $state<{ done: number; total: number } | null>(null);

	// 34-UI-SPEC contract 7: the FIRST UI-layer native gate in the app (every other isNativePlatform
	// call lives in $lib/services/* or the player). Read in onMount rather than at module scope so it
	// stays inside the browser-guard discipline, and kept to this page body — the settings-index row
	// is NOT gated, because the retag control below works on web and the row leads to it.
	let native = $state(false);

	// quick-260919-30x — THE RECOVERY LIST. `[uid, label][]`, seeded from localStorage in onMount.
	// D-9: deliberately NO `*.svelte.ts` reactive wrapper. lyric-pins needed one because a pin is
	// written from one surface while another renders it live during playback; here the only WRITER is
	// TrackMenu and the only READER is this page, and the two cannot be mounted at the same time — so
	// a plain local `$state` seeded once on mount is the whole requirement. The absence is a decision,
	// not an omission.
	let excluded = $state<[string, string][]>([]);

	function allowAgain(uid: string) {
		unexcludeUid(uid);
		excluded = excluded.filter(([u]) => u !== uid);
		// D-4: allowing only makes the file ELIGIBLE again; the scan above is what brings it back.
		// A per-file import would need a single-row scan path that does not exist.
		flash(t('toast.noImportUndone'));
	}

	// Progress is read from the STORE, never from page-local state: navigating away must not cancel
	// the scan and coming back must re-attach to it (contract 3).
	const scanning = $derived(deviceImport.phase === 'requesting' || deviceImport.phase === 'scanning');
	const pct = $derived(
		deviceImport.total > 0 ? Math.min(100, Math.round((deviceImport.done / deviceImport.total) * 100)) : 0
	);
	const s = $derived(deviceImport.summary);

	// Contract 6: the DRAFT is page-local and the SAVED pattern lives in the store. They diverge on a
	// rejection and that divergence IS the contract — the typed text stays under the user's eyes while
	// the last working pattern stays in force.
	let patternDraft = $state('');
	const PREVIEW_SAMPLE = '01. Adele - Hello (Live).mp3';

	// The preview runs against ONE fixed sample using the SAVED (already probe-passed) pattern, never
	// the draft and never a file list — so it can never become a second unbounded execution path
	// (T-34-21 / contract 6).
	const preview = $derived.by(() => {
		const v = deviceImport.rules.customPattern ? validateCustomPattern(deviceImport.rules.customPattern) : null;
		const r = parseFilename(PREVIEW_SAMPLE, deviceImport.rules, v && v.ok ? v.re : null);
		return r.artist ? `${r.artist} · ${r.title}` : r.title || '—';
	});

	// Presets are multi-select and tried in the order the user DECLARED them (device-filename.ts:
	// first match wins), so enabling appends rather than re-sorting into canonical order.
	function togglePreset(p: PresetId) {
		const on = deviceImport.rules.presets.includes(p);
		deviceImport.setRules({
			presets: on ? deviceImport.rules.presets.filter((x) => x !== p) : [...deviceImport.rules.presets, p]
		});
	}
	function toggleExt(ext: string) {
		const on = deviceImport.rules.extensions.includes(ext);
		deviceImport.setRules({
			extensions: on ? deviceImport.rules.extensions.filter((x) => x !== ext) : [...deviceImport.rules.extensions, ext]
		});
	}
	// Contract 6: validate on BLUR and on accordion-collapse, NEVER per keystroke — compiling a
	// half-typed regex on every input event paints a red error under the user's own finger.
	function commitPattern() { deviceImport.setCustomPattern(patternDraft); }

	onMount(async () => {
		settings.load();
		library.load();
		deviceImport.load();
		patternDraft = deviceImport.rules.customPattern;
		native = Capacitor.isNativePlatform();
		excluded = Object.entries(readExclusions());
		// quick-260919-ejm (D-2) — RECOVERY POINT. The in-place rewrite of an imported file is
		// temp-then-stream, and the ONE window it cannot make atomic is a process death MID-STREAM:
		// the user's file is left partial and the complete new bytes sit in the temp file beside a
		// journal entry. This is one of exactly two places that finishes the job (the other is the
		// top of the next `overwriteDeviceFile`). No app-boot hook, deliberately — a file write in
		// the app shell's mount is the class of automatic write this codebase keeps out.
		//
		// FIRE-AND-FORGET: `replayPendingDeviceWrites` never throws and never rejects, and a page
		// mount must never await a file write. On the overwhelmingly common path the journal is
		// empty and this is a single localStorage read.
		void replayPendingDeviceWrites();
		// 36-D-18: the scope is the app's OWN downloads it STILL HOLDS A COPY OF — never a device-wide
		// sweep. `library.downloads` is the reference list (a row survives a failed/cancelled save), so
		// `blobStore.has` is what makes the count honest. Sequential because the list is small and
		// `has` is a cheap index/stat probe, not a read.
		const out: RetagEntry[] = [];
		for (const d of library.downloads) {
			if (!d?.uid) continue;
			if (!(await blobStore.has(d.uid))) continue;
			// The display-name translation happens HERE, not in retag.ts — the service stays store-free,
			// and the tag and the filename it writes then agree with what the user sees in the app.
			//
			// quick-260919-2jo — the album rides `names.zhLock`, the SIBLING of the download seam's
			// own fix (download-track.ts). Same bug in the same shape: title/artist went through the
			// display-name layer (script-converted) while the album stayed the RAW catalog string, so
			// a bulk retag rewrote a Traditional title next to a Simplified album — and this page is
			// the ONLY route a user has to repair files they downloaded before the lock existed, so
			// fixing only the fresh-download path would have left the repair itself broken. zhLock,
			// not dnTitle: synchronous and network-free, no /api/translate batch in the retag loop.
			//
			// quick-260919-3j1 (F1) — THE SWEEP WAS WRITING THE WRONG COVER. `cover: d.cover` reads the
			// PERSISTED Track.cover: not the user's pin, and not the shared reactive cache every list
			// surface renders from. So this batch has always re-tagged files with stale art, and would
			// have ignored a cover pin entirely. The ladder below is the one `download-track.ts` uses,
			// minus `player.resolvedCover` (a now-playing concept with no place in a batch loop).
			//
			// This is what makes the opt-in sweep the REPAIR PATH for every file downloaded or pinned
			// before the embed seams existed.
			//
			// RAW `d.artist` / `d.title` for the cache lookup, NOT dnArtist/dnTitle: the name layer is
			// matchKey'd on raw CATALOG metadata (download-track.ts RULE 1), so a display-language
			// string misses the cache for exactly the users the script conversion exists for.
			out.push({
				uid: d.uid,
				title: names.dnTitle(d.title),
				artist: names.dnArtist(d.artist),
				album: names.zhLock(d.album),
				cover: readPinnedCover(d.uid) ?? readCoverByUidOrName(d.uid, d.artist, d.title) ?? d.cover,
				// quick-260919-3j1 (F3): the sweep carries the PINNED LRC too. `?? undefined` so an
				// absent pin is OMISSION — `tagAudioBlob` runs a setter only for a truthy field, so the
				// file's own lyrics are preserved; `RetagEntry.lyrics` has no clear verb, by design.
				// Together with the cover ladder above this makes the opt-in sweep the repair path for
				// every file downloaded before the embed seams existed.
				lyrics: getPinnedLyrics(d.uid) ?? d.lrc ?? undefined
			});
		}
		eligible = out;
	});

	// quick-260919-ejm: how many of the files about to be rewritten are the USER'S OWN. Note there
	// is deliberately NO change to the eligible loop above: imported rows have always been in that
	// list (they live in `library.downloads` and `blobStore.has` reads them in place, 34-D-05) and
	// were always skipped by `retagOne`. The absence of a change there is the point — lifting the
	// refusal in the service is the whole mechanism, and this page only has to be honest about it.
	const importedCount = $derived(eligible.filter((e) => isDeviceUid(e.uid)).length);

	function flash(m: string) { msg = m; setTimeout(() => (msg = ''), 2600); }

	// 36-D-17: opt-in ONLY. This runs from a tap, after a confirm naming the count, and from nowhere
	// else — no onMount call, no $effect, no background pass. Retag rewrites files the user already
	// has, so it never happens without them asking for it.
	// 36-D-19: the per-file isolation lives in retag.ts; this page only reports what came back, and
	// the report is the truth (tagged vs skipped), not an optimistic "done".
	async function retag() {
		if (busy) return;
		if (eligible.length === 0) { flash(t('settings.retagNone')); return; }
		// quick-260919-ejm — THE AUTHORISED-RISK DISCLOSURE. This sweep can now rewrite files the app
		// does not own, in place, and the user agrees to that BEFORE it runs, with the count in front
		// of them. Appended rather than swapped, so the existing sentence (what the sweep does, and
		// that an untaggable file is left alone) is still the first thing read. D-4: imported songs
		// are in the default scope rather than opt-in — there is no per-row selection UI to opt into,
		// and the bulk sweep is what was asked for; the confirm IS the opt-in.
		const ask =
			importedCount > 0
				? `${t('settings.retagConfirm', { count: eligible.length })}\n\n${t('settings.retagImported', { count: importedCount })}`
				: t('settings.retagConfirm', { count: eligible.length });
		if (!confirm(ask)) return;
		busy = true;
		try {
			const r = await retagDownloads(eligible, (done, total) => (progress = { done, total }));
			flash(t('settings.retagDone', { tagged: r.tagged, total: r.total, skipped: r.total - r.tagged }));
		} finally {
			busy = false;
			progress = null;
		}
	}
</script>

<svelte:head><title>{t('settings.title')}</title></svelte:head>

<header class="head">
	<button class="back" aria-label={t('settings.backToSettings')} onclick={() => goto('/settings')} use:tapBounce><ChevronLeft size={22} /></button>
	<h1>{t('settings.groupDownloads')}</h1>
</header>

<section>
	<h2><HardDriveDownload size={15} /> {t('import.heading')}</h2>
	{#if !native}
		<!-- Contract 7: one honest line on the web build. No disabled button, no "coming soon". -->
		<p class="muted">{t('import.webOnly')}</p>
	{:else}
		<!-- CTA SLOT: the button is REPLACED IN PLACE while scanning, same footprint, so nothing
		     below it reflows (contract 3). -->
		{#if scanning}
			<div
				class="cta busy"
				aria-busy="true"
				role="progressbar"
				aria-valuemin="0"
				aria-valuemax="100"
				aria-valuenow={deviceImport.total > 0 ? pct : undefined}
				aria-valuetext={deviceImport.total > 0 ? undefined : t('import.scanning')}
			>
				<!-- quick-260809-mvz: `.motion-always` on the indeterminate sliver — the global
				     `:root[data-reduce-motion] * { animation: none }` rule would otherwise freeze it,
				     and a frozen progress indicator reads as a hung app. The determinate fill has no
				     such exemption; losing its width transition is harmless. -->
				<div class="rail" class:indet={deviceImport.total === 0}>
					<i
						class="fill"
						class:sliver={deviceImport.total === 0}
						class:motion-always={deviceImport.total === 0}
						style:width={deviceImport.total > 0 ? `${pct}%` : undefined}
					></i>
				</div>
				<span class="lbl-prog">
					{deviceImport.total > 0
						? t('import.scanProgress', {
								done: deviceImport.done.toLocaleString(),
								total: deviceImport.total.toLocaleString()
							})
						: t('import.scanning')}
				</span>
				<button class="chip cancel" onclick={() => deviceImport.cancel()} use:tapBounce aria-label={t('import.cancel')}>{t('import.cancel')}</button>
			</div>
		{:else}
			<button class="cta" onclick={() => deviceImport.runImport()} use:tapBounce>
				<Smartphone size={18} aria-hidden="true" /> {t('import.cta')}
			</button>
		{/if}
		<p class="muted">{t('import.ctaNote')}</p>

		<!-- RESULT SLOT: exactly ONE of permission / empty / summary renders (contracts 3/4/7). The
		     CTA stays tappable in BOTH denied states — a dead control is worse than a re-prompt. -->
		{#if deviceImport.permission === 'denied-permanently'}
			<p class="hint perm"><CircleAlert size={14} aria-hidden="true" /> {t('import.permBlocked')}</p>
		{:else if deviceImport.permission === 'denied'}
			<p class="hint perm"><CircleAlert size={14} aria-hidden="true" /> {t('import.permDenied')}</p>
		{:else if s && !scanning}
			{#if s.added === 0 && s.relinked === 0 && s.removed === 0 && s.complete}
				<div class="empty-block">
					<FolderSearch size={20} aria-hidden="true" />
					<strong>{t('import.none')}</strong>
					<span class="hint">{t('import.noneBody')}</span>
				</div>
			{:else}
				<!-- Contract 4: a ZERO-count category renders NOTHING. A column of "0 skipped" lines
				     buries the one line that matters. A cancelled run has no separate flag — it is
				     `complete: false` plus whatever was added before it stopped. -->
				<div class="summary">
					<strong>
						<Check size={16} aria-hidden="true" />
						{s.complete ? t('import.summaryAdded', { count: s.added }) : t('import.summaryCancelled', { count: s.added })}
					</strong>
					{#if s.relinked > 0}<span class="hint">{t('import.summaryRelinked', { count: s.relinked })}</span>{/if}
					{#if s.already > 0}<span class="hint">{t('import.skipAlready', { count: s.already })}</span>{/if}
					{#if s.skippedShort > 0}<span class="hint">{t('import.skipTooShort', { count: s.skippedShort, seconds: s.minSeconds })}</span>{/if}
					{#if s.skippedExt > 0}<span class="hint">{t('import.skipExtension', { count: s.skippedExt })}</span>{/if}
					{#if s.skippedRule > 0}<span class="hint">{t('import.skipRule', { count: s.skippedRule })}</span>{/if}
					<!-- quick-260919-30x: the user's own per-file marks get their own line — reporting an
					     explicit choice as a skip RULE would misattribute it. Same zero-renders-nothing
					     contract as every sibling. -->
					{#if s.skippedExcluded > 0}<span class="hint">{t('import.skipExcluded', { count: s.skippedExcluded })}</span>{/if}
					<!-- Last, and the only line in the error colour: it is the only one describing a loss. -->
					{#if s.removed > 0}<span class="hint removed">{t('import.summaryRemoved', { count: s.removed })}</span>{/if}
				</div>
			{/if}
		{/if}
	{/if}
</section>

{#if native}
	<!-- Contract 2: the rules are a COLLAPSED accordion below the CTA, never a sub-page and never an
	     inline wall — D-14 says the defaults must already work, so the config must not be in the way.
	     Open state is deliberately NOT persisted; every visit starts collapsed. -->
	<details class="advanced">
		<summary use:tapBounce><SlidersHorizontal size={15} aria-hidden="true" /> {t('import.rules')}</summary>
		<!-- FIRST child, deliberately: a user who opens this out of curiosity is told immediately
		     that they can close it again (D-14). -->
		<p class="muted">{t('import.rulesNote')}</p>

		<!-- Order = most-likely-to-be-adjusted first: parsing, length, types, skip rules. -->
		<section>
			<h2><FileMusic size={15} /> {t('import.parsing')}</h2>
			<!-- UI-SPEC Spacing KNOWN FLAG: `.chip` is ~33px tall, below the 44px touch minimum. It is
			     the app's established chip (/settings/playback) and is reused VERBATIM here — fixing it
			     on one page creates drift; fixing it app-wide is a dedicated pass. -->
			<div class="chips">
				{#each PRESET_ORDER as p (p)}
					<!-- LITERAL labels: they describe a filename shape, not prose. -->
					<button class="chip" class:on={deviceImport.rules.presets.includes(p)} aria-pressed={deviceImport.rules.presets.includes(p)} onclick={() => togglePreset(p)} use:tapBounce>{PRESET_LABELS[p]}</button>
				{/each}
			</div>
			<button class="row-toggle" onclick={() => deviceImport.setRules({ stripTrackNo: !deviceImport.rules.stripTrackNo })} aria-pressed={deviceImport.rules.stripTrackNo} use:tapBounce>
				<span>{t('import.stripTrackNo')}</span>
				<span class="sw" class:on={deviceImport.rules.stripTrackNo}></span>
			</button>
			<button class="row-toggle" onclick={() => deviceImport.setRules({ stripBrackets: !deviceImport.rules.stripBrackets })} aria-pressed={deviceImport.rules.stripBrackets} use:tapBounce>
				<span>{t('import.stripBrackets')}</span>
				<span class="sw" class:on={deviceImport.rules.stripBrackets}></span>
			</button>
			<!-- D-15, stated plainly. Without this the presets read as an override and a user will
			     "fix" correctly-tagged files. Not filler — do not drop. -->
			<p class="muted">{t('import.parsingNote')}</p>

			<!-- The raw-regex escape hatch hides ONE LEVEL DEEPER (contract 2): a user who opened
			     "Import rules" to flip a switch never sees a regex field. -->
			<details class="advanced nested" ontoggle={(e) => { if (!e.currentTarget.open) commitPattern(); }}>
				<summary use:tapBounce><Regex size={14} aria-hidden="true" /> {t('import.customPattern')}</summary>
				<p class="muted">{t('import.customPatternNote')}</p>
				<!-- autocapitalize/autocorrect/spellcheck off is a real bug fix, not a nicety: iOS Safari
				     capitalises the first character of a regex and autocorrects `(?<artist>` into
				     something that no longer compiles. -->
				<input
					class="txt mono"
					type="text"
					bind:value={patternDraft}
					placeholder="^(?<artist>.+?) - (?<title>.+)$"
					autocapitalize="off"
					autocorrect="off"
					spellcheck="false"
					aria-label={t('import.customPattern')}
					aria-invalid={deviceImport.patternError ? 'true' : undefined}
					aria-describedby={deviceImport.patternError ? 'pattern-msg' : undefined}
					onblur={commitPattern}
				/>
				{#if deviceImport.patternError}
					<p id="pattern-msg" class="hint reject">
						{t(deviceImport.patternError === 'invalid' ? 'import.patternInvalid' : deviceImport.patternError === 'no-groups' ? 'import.patternNoGroups' : 'import.patternTooSlow')}
					</p>
				{/if}
				<p class="hint mono"><span class="muted">{t('import.patternPreview')}</span> {PREVIEW_SAMPLE} → {preview}</p>
			</details>
		</section>

		<section>
			<h2><Timer size={15} /> {t('import.minLength')}</h2>
			<div class="lbl"><span>{t('import.minLength')}</span><span class="val">{deviceImport.rules.minSeconds}s</span></div>
			<input
				type="range"
				min="0"
				max="120"
				step="5"
				value={deviceImport.rules.minSeconds}
				oninput={(e) => deviceImport.setRules({ minSeconds: Number(e.currentTarget.value) })}
				aria-label={t('import.minLength')}
			/>
			<p class="muted">{t('import.minLengthNote')}</p>
		</section>

		<section>
			<h2><ListFilter size={15} /> {t('import.fileTypes')}</h2>
			<div class="chips">
				{#each IMPORT_EXTENSIONS as ext (ext)}
					<!-- LITERAL labels: file extensions are identifiers, not prose. -->
					<button class="chip" class:on={deviceImport.rules.extensions.includes(ext)} aria-pressed={deviceImport.rules.extensions.includes(ext)} onclick={() => toggleExt(ext)} use:tapBounce>{ext}</button>
				{/each}
			</div>
			<p class="muted">{t('import.fileTypesNote')}</p>
		</section>

		<section>
			<h2><ListX size={15} /> {t('import.skipRules')}</h2>
			<textarea
				class="txt"
				rows="3"
				placeholder={'interview\nringtone\nvoice memo'}
				autocapitalize="off"
				spellcheck="false"
				{...{ autocorrect: 'off' }}
				value={deviceImport.rules.skipRules.join('\n')}
				onblur={(e) => deviceImport.setRules({ skipRules: e.currentTarget.value.split('\n').map((x) => x.trim()).filter(Boolean) })}
				aria-label={t('import.skipRules')}
			></textarea>
			<p class="muted">{t('import.skipRulesNote')}</p>
		</section>
	</details>
{/if}

<section>
	<h2><Tags size={15} /> {t('settings.groupDownloads')}</h2>
	<button class="item" onclick={retag} disabled={busy || eligible.length === 0} use:tapBounce>
		<Tags size={18} /> {t('settings.retagDownloads', { count: eligible.length })}
	</button>
	<p class="hint">{t('settings.retagDownloadsDesc')}</p>
	{#if progress}<p class="muted">{t('settings.retagProgress', { done: progress.done, total: progress.total })}</p>{/if}
</section>

<!-- quick-260919-30x — the recovery list for "Don't import again". It is the MITIGATION for D-3's
     accepted failure mode (a MediaStore provider rebuild reassigns _IDs, so a mark can lapse or, in
     the pathological case, land on a different file): every mark is visible here and reversible in
     one tap, rather than being invisible state the user cannot reach.
     NOT behind `{#if native}` on purpose — a mark made on the phone is still worth SEEING and
     clearing on the web build, and the section renders its own empty line when there is nothing. -->
<section>
	<h2><EyeOff size={15} /> {t('settings.excludedHeading')}</h2>
	<p class="muted">{t('settings.excludedNote')}</p>
	{#if excluded.length === 0}
		<p class="muted">{t('settings.excludedNone')}</p>
	{:else}
		{#each excluded as [uid, label] (uid)}
			<!-- Plain {label} interpolation: Svelte escapes it. No @html — the label is composed from
			     catalog strings the app did not author. -->
			<div class="excl-row">
				<span class="excl-label">{label || uid}</span>
				<button class="chip" onclick={() => allowAgain(uid)} use:tapBounce>{t('settings.excludedRestore')}</button>
			</div>
		{/each}
	{/if}
</section>

{#if msg}<p class="flash">{msg}</p>{/if}

<style>
	.head { display: flex; align-items: center; gap: 8px; padding: 14px 0 12px; }
	.back { background: none; border: none; color: var(--color-text); cursor: pointer; display: grid; place-items: center; width: 36px; height: 36px; }
	.head h1 { font-size: 1.4rem; margin: 0; }
	section { margin: 18px 0; }
	section h2 { display: flex; align-items: center; gap: 6px; font-size: 0.85rem; text-transform: uppercase; letter-spacing: 0.5px; color: var(--color-text-muted); margin: 0 0 10px; }
	.muted { color: var(--color-text-muted); font-size: 12px; margin: 8px 0 0; }
	.hint { color: var(--color-text-muted); font-size: 12px; margin: -2px 0 10px 4px; }
	.item { width: 100%; display: flex; align-items: center; gap: 12px; background: var(--color-surface-2); border: 1px solid var(--color-border); color: var(--color-text); padding: 14px; border-radius: 12px; font-size: 15px; cursor: pointer; text-align: left; margin-bottom: 8px; }
	.item:disabled { opacity: 0.5; cursor: default; }
	.chip { background: var(--color-surface-2); border: 1px solid var(--color-border); color: var(--color-text); padding: 8px 14px; border-radius: 999px; font-size: 13px; cursor: pointer; }
	.advanced { margin: 22px 0; padding: 10px 12px; background: var(--color-surface-2); border: 1px solid var(--color-border); border-radius: 12px; }
	.advanced summary { display: inline-flex; align-items: center; gap: 6px; font-size: 0.85rem; text-transform: uppercase; letter-spacing: 0.5px; color: var(--color-text-muted); cursor: pointer; padding: 4px 0; min-height: 44px; }
	/* quick-260919-30x: the recovery row reuses `.item`'s surface tokens and the page's existing
	   `.chip` for its button — only the label/button split is new. */
	.excl-row { display: flex; align-items: center; gap: 12px; background: var(--color-surface-2); border: 1px solid var(--color-border); border-radius: 12px; padding: 10px 10px 10px 14px; margin-bottom: 8px; }
	.excl-label { flex: 1; min-width: 0; font-size: 14px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
	.flash { position: fixed; left: 50%; transform: translateX(-50%); bottom: calc(var(--tabbar-h) + 70px); background: #000; color: #fff; padding: 10px 16px; border-radius: 999px; font-size: 13px; }

	/* Contract 3/4 + UI-SPEC Color: the import CTA is this page's single accent-filled action. */
	.cta { width: 100%; min-height: 48px; display: flex; align-items: center; justify-content: center; gap: 8px; background: var(--color-primary); color: #fff; border: none; border-radius: 12px; font-size: 15px; font-weight: 600; cursor: pointer; }
	.cta:focus-visible { outline: 2px solid var(--color-primary); outline-offset: 2px; }
	.cta.busy { background: var(--color-surface-2); color: var(--color-text); border: 1px solid var(--color-border); justify-content: space-between; padding: 0 8px 0 14px; gap: 12px; font-weight: 400; }
	.lbl-prog { font-size: 13px; color: var(--color-text-muted); white-space: nowrap; }
	.rail { flex: 1; height: 6px; background: var(--color-surface-2); border: 1px solid var(--color-border); border-radius: 999px; overflow: hidden; position: relative; }
	.rail .fill { display: block; height: 100%; background: var(--color-primary); border-radius: 999px; transition: width 0.25s linear; }
	.rail.indet .fill.sliver { width: 35%; transition: none; animation: np-indet 1.1s ease-in-out infinite; }
	@keyframes np-indet {
		0% { transform: translateX(-110%); }
		100% { transform: translateX(310%); }
	}
	.chip.cancel { min-height: 44px; min-width: 44px; color: var(--color-text-muted); }
	.hint.perm { display: flex; gap: 6px; align-items: flex-start; color: var(--color-text-muted); font-size: 12px; margin: 8px 0; }
	.summary, .empty-block { background: var(--color-surface-2); border: 1px solid var(--color-border); border-radius: 12px; padding: 14px; margin: 12px 0; display: flex; flex-direction: column; gap: 6px; }
	.summary strong { font-size: 15px; font-weight: 600; display: flex; gap: 6px; align-items: center; }
	.summary .hint { font-size: 12px; color: var(--color-text-muted); margin: 0; }
	.summary .hint.removed { color: #ff7a90; }
	.empty-block { align-items: center; text-align: center; color: var(--color-text-muted); }
	.empty-block .hint { margin: 0; }

	/* Rules panel (contracts 5/6). `.chip.on`, `.row-toggle` and `.sw` are the settings idiom,
	   copied verbatim from /settings/playback. Free-text inputs are NEW to this app — no
	   `type="text"` or `<textarea>` existed anywhere in src/, so UI-SPEC sets their shape. */
	.chips { display: flex; flex-wrap: wrap; gap: 8px; }
	.chip.on { background: var(--color-primary); color: #fff; border-color: transparent; }
	.row-toggle { width: 100%; display: flex; align-items: center; justify-content: space-between; background: var(--color-surface-2); border: 1px solid var(--color-border); color: var(--color-text); padding: 13px 14px; border-radius: 12px; font-size: 14px; cursor: pointer; margin: 8px 0 0; }
	.sw { width: 40px; height: 22px; border-radius: 999px; background: var(--color-border); position: relative; transition: background 0.15s ease; flex: none; }
	.sw::after { content: ''; position: absolute; top: 2px; left: 2px; width: 18px; height: 18px; border-radius: 50%; background: #fff; transition: transform 0.15s ease; }
	.sw.on { background: var(--color-primary); }
	.sw.on::after { transform: translateX(18px); }
	.txt { width: 100%; min-height: 44px; padding: 12px 14px; background: var(--color-surface-2); border: 1px solid var(--color-border); border-radius: 12px; color: var(--color-text); font-family: inherit; font-size: 14px; }
	.txt::placeholder { color: var(--color-text-muted); }
	.txt:focus-visible { outline: 2px solid var(--color-primary); outline-offset: 2px; }
	.txt[aria-invalid='true'] { border-color: #ff7a90; }
	/* A regex is code: in Inter, `\s` and `\5` are ambiguous. The only monospace in the phase. */
	.mono { font-family: ui-monospace, SFMono-Regular, Menlo, monospace; font-size: 13px; }
	.hint.reject { color: #ff7a90; font-size: 12px; margin: 6px 0 0; }
	.advanced.nested { margin: 12px 0 0; }
	.lbl { display: flex; justify-content: space-between; font-size: 14px; margin-bottom: 6px; }
	input[type='range'] { width: 100%; accent-color: var(--color-primary); }
	.chip:focus-visible, .row-toggle:focus-visible, .advanced summary:focus-visible { outline: 2px solid var(--color-primary); outline-offset: 2px; }
</style>
