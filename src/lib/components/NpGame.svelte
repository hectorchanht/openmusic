<script module lang="ts">
	// quick-261121-beat: module-scope run park (the trCache precedent in NpLyrics) —
	// switching tabs unmounts this pane, so a live run is parked here keyed by
	// song|difficulty|challenge and restored on return (brief §3.1: leaving the tab
	// parks the run; the clock follows the song and state re-derives from note states).
	import type { Run as BeatRun } from '$lib/services/songbeat';
	const runPark = new Map<string, { run: BeatRun; endState: 'complete' | 'failed' | null }>();
</script>

<script lang="ts">
	import { untrack, onDestroy } from 'svelte';
	import { player } from '$lib/stores/player.svelte';
	import { t, type TranslationKey } from '$lib/i18n';
	import { tapBounce } from '$lib/actions/tapBounce';
	// quick-261122-npfix: Song Beat scroll LOCK — auto-pin on round start, a visible top-corner
	// toggle as its face + manual override (rules: services/songbeat-scroll-lock.ts).
	import { Lock, LockOpen, Crosshair, Volume2, Swords, Square, Circle, Columns4, WholeWord, HeartPulse, CloudRain } from '@lucide/svelte';
	import { pinScroll } from '$lib/actions/pinScroll';
	import { nextScrollLock } from '$lib/services/songbeat-scroll-lock';
	import { readLyrics } from '$lib/stores/lyric-pins.svelte';
	import { parseLyrics } from '$lib/stores/lyric-script.svelte';
	import { getEffectiveLyricOffset } from '$lib/stores/lyric-offset.svelte';
	import { reorderPairs, splitParenLines, activeLineAt, type LyricLine } from '$lib/services/lrc';
	import { commentThreadKey } from '$lib/services/comments';
	import {
		generateChart,
		createRun,
		visibleNotes,
		generateCharChart,
		charChartToNoteChart,
		visibleChars,
		charChartCacheKey,
		serializeCharChart,
		parseCharChart,
		tapDown,
		tapUp,
		advanceRun,
		seekRun,
		runStats,
		lanePad,
		bestKey,
		parseBest,
		bestEligible,
		chartCacheKey,
		serializeChart,
		parseChart,
		parseSongBeatSettings,
		serializeSongBeatSettings,
		APPROACH_OPTIONS,
		type Chart,
		type CharChart,
		type Run,
		type RunStats,
		type BestRecord,
		type Difficulty,
		type Judgment
	} from '$lib/services/songbeat';
	import {
		padOrder,
		velocityFromPosition,
		nextPluckStep,
		INTENSITY_SCALES,
		parseTapAlongSettings,
		serializeTapAlongSettings,
		type PadId,
		type TapAlongSettings
	} from '$lib/services/tapalong';
	import { playPadSound, unlockSynth, setSynthVolume } from '$lib/util/tap-synth';
	// Workstream F: skin registry + renderers (brief §2.2) — the selector below is
	// registry-driven; each skin is a stateless component under SongBeat*Skin.svelte.
	import { SONGBEAT_SKINS, skinDef } from '$lib/services/songbeat-skins';
	import SongBeatSquareSkin from '$lib/components/SongBeatSquareSkin.svelte';
	import SongBeatRoundSkin from '$lib/components/SongBeatRoundSkin.svelte';
	import SongBeatHighwaySkin from '$lib/components/SongBeatHighwaySkin.svelte';
	import SongBeatCharCatchSkin from '$lib/components/SongBeatCharCatchSkin.svelte';
	import SongBeatPulseSkin from '$lib/components/SongBeatPulseSkin.svelte';
	import SongBeatRainSkin from '$lib/components/SongBeatRainSkin.svelte';
	import { kick, snare, pluck, shaker } from '$lib/util/haptics';

	// The pane's only parent seam: the results card's "back to lyrics" (the tab itself
	// is NowPlaying state). Everything else the game reads straight from the stores.
	let { onExit }: { onExit?: () => void } = $props();

	// ---- persisted settings (§7: game keys under openmusic:songbeat:v1; instrument
	// volume/intensity are Tap-Along's keys — read/written here, never duplicated) ----
	function lsGet(key: string): string | null {
		try {
			return typeof localStorage !== 'undefined' ? localStorage.getItem(key) : null;
		} catch {
			return null;
		}
	}
	function lsSet(key: string, value: string): void {
		try {
			typeof localStorage !== 'undefined' && localStorage.setItem(key, value);
		} catch {
			/* private mode — settings just don't persist */
		}
	}

	let beat = $state(parseSongBeatSettings(lsGet('openmusic:songbeat:v1')));
	let tapCfg = $state<TapAlongSettings>(parseTapAlongSettings(lsGet('openmusic:tapalong:v1')));
	$effect(() => {
		lsSet('openmusic:songbeat:v1', serializeSongBeatSettings(beat));
	});
	$effect(() => {
		lsSet('openmusic:tapalong:v1', serializeTapAlongSettings(tapCfg));
		setSynthVolume(tapCfg.synthVolume);
	});

	// ---- song identity + chart inputs (the NpLyrics pipeline, minus translation
	// lines: a chart anchors on the ORIGINAL lines only) ----
	const track = $derived(player.current);
	const gameLines = $derived<LyricLine[]>(
		(() => {
			const src = readLyrics(player.current);
			if (!src) return [];
			return splitParenLines(reorderPairs(parseLyrics(src))).filter((l) => !l.isTranslation);
		})()
	);
	const lyricOffset = $derived(getEffectiveLyricOffset(player.current?.uid));

	let songHash = $state('');
	$effect(() => {
		const tr = track;
		if (!tr) {
			songHash = '';
			return;
		}
		let live = true;
		void commentThreadKey(tr.artist, tr.title).then((h) => {
			if (!live) return;
			// Insecure-origin fallback (commentThreadKey bails without crypto.subtle):
			// a local FNV hex keeps the game playable; charts stay deterministic per
			// spelling on this device, just not the shared SHA namespace.
			songHash = h ?? fnvHex(`${tr.artist}|${tr.title}`);
			});
		return () => {
			live = false;
		};
	});
	function fnvHex(s: string): string {
		let h1 = 0x811c9dc5;
		for (let i = 0; i < s.length; i++) {
			h1 ^= s.charCodeAt(i);
			h1 = Math.imul(h1, 0x01000193);
		}
		return (h1 >>> 0).toString(16).padStart(8, '0').repeat(4).slice(0, 32);
	}

	// ---- run lifecycle ----
	let chart = $state<Chart | null>(null);
	// Skin D's char chart (addendum §3) — set only while the char family is active;
	// the run itself always plays a plain Chart (the derived target-note chart).
	let charChart = $state<CharChart | null>(null);
	let run = $state<Run | null>(null);
	let runKey = $state('');
	let endState = $state<'complete' | 'failed' | null>(null);
	// quick-261122-npfix: the scroll lock (true = the sheet's scroller is pinned under the game).
	let scrollLocked = $state(false);
	let cardClosed = $state(false);
	let best = $state<BestRecord | null>(null);
	let newBest = $state(false);
	let now = $state(0);
	let stats = $state<RunStats | null>(null);

	const chartKey = $derived(
		songHash && track ? `${track.uid}|${beat.difficulty}|${songHash}|${gameLines.length}|${Math.floor(player.duration)}` : ''
	);

	// Character-Catch (Skin D) plays a different chart FAMILY (addendum §3): its own
	// char chart + derived target-note chart, parked separately from the note-chart
	// runs. The family rides at the END of the park key so settleParked's segment
	// indices never move. A song with no lyric lines cannot play it — the skin is
	// honestly unavailable there and the surface falls back to Square (addendum §2).
	const charAvailable = $derived(gameLines.length > 0);
	const effectiveSkin = $derived(beat.skin === 'character-catch' && !charAvailable ? 'square' : beat.skin);
	const chartFamily = $derived(effectiveSkin === 'character-catch' ? 'char' : 'note');

	$effect(() => {
		const key = chartKey;
		const challenge = beat.challenge;
		const family = chartFamily;
		if (!key || !songHash) return;
		const fullKey = `${key}|${challenge}|${family}`;
		untrack(() => {
			if (fullKey === runKey) return;
			// Park the outgoing run before replacing it (tab switches unmount instead —
			// that path is covered by onDestroy below). A run that already settled
			// every note banks its best first (§6: a track/config change ends the run).
			if (run && runKey) {
				settleParked(runKey, run);
				runPark.set(runKey, { run, endState });
			}
			runKey = fullKey;
			endState = null;
			cardClosed = false;
			newBest = false;
			// Chart: localStorage cache first (an optimisation — regeneration is the
			// source of truth and must equal it, §4.2), else generate + store.
			let ch: Chart;
			if (family === 'char') {
				// Skin D: the char chart under its own cache key (addendum §3); the
				// run plays the derived target-note chart, so every core rule —
				// judgment, scoring, HP, bests — is the shared path, never a fork.
				const ck = charChartCacheKey(songHash, beat.difficulty);
				let cc = parseCharChart(lsGet(ck));
				if (!cc) {
					cc = generateCharChart(gameLines, player.duration, beat.difficulty, songHash);
					lsSet(ck, serializeCharChart(cc));
				}
				charChart = cc;
				ch = charChartToNoteChart(cc);
			} else {
				charChart = null;
				const ck = chartCacheKey(songHash, beat.difficulty);
				let nch = parseChart(lsGet(ck));
				// A cached GRID chart is only valid while the song still shows no lyric
				// lines: lyrics load async, so a grid generated inside the load window
				// must not poison the cache once the real lines arrive.
				if (nch && nch.source === 'grid' && gameLines.length > 0) nch = null;
				if (!nch) {
					nch = generateChart(gameLines, player.duration, beat.difficulty, songHash);
					lsSet(ck, serializeChart(nch));
				}
				ch = nch;
			}
			chart = ch;
			const parked = runPark.get(fullKey);
			run = parked ? parked.run : createRun(ch, beat.difficulty, challenge);
			if (parked) endState = parked.endState;
			// Entering (or re-entering) a run mid-song: notes already past are
			// seek-skipped, never mass-missed (§6 derivation) — opening the tab at
			// 2:00 in must not drain challenge HP to zero on the first frame.
			if (!endState) seekRun(run, player.liveTime());
			// quick-261122-npfix: AUTO-PIN — a live round (fresh, or re-entered mid-round) starts
			// locked; re-entering a finished round's results card leaves the panel scrollable.
			scrollLocked = nextScrollLock(scrollLocked, endState ? 'roundEnd' : 'roundStart');
			stats = runStats(run);
			const mode = challenge ? 'challenge' : 'casual';
			best = parseBest(lsGet(bestKey(songHash, beat.difficulty, mode)));
		});
	});

	onDestroy(() => {
		if (run && runKey) {
			settleParked(runKey, run);
			runPark.set(runKey, { run, endState });
		}
	});

	/** Bank a best for a run being parked/replaced, if it settled the whole chart
	 *  (§6). The run's identity is parsed back out of its park key:
	 *  uid|difficulty|songHash|lines|duration|challenge. Idempotent — the loop's
	 *  own settleBest may already have banked the same run. */
	function settleParked(key: string, r: Run): void {
		const st = runStats(r);
		if (!bestEligible(st)) return;
		const parts = key.split('|');
		const diff = parts[1] as Difficulty;
		const hash = parts[2];
		if (!hash || !diff) return;
		const mode = parts[5] === 'true' ? 'challenge' : 'casual';
		const bk = bestKey(hash, diff, mode);
		const existing = parseBest(lsGet(bk));
		if (!existing || st.score > existing.score) {
			const rec: BestRecord = { score: st.score, grade: st.grade, accuracy: st.accuracy, maxCombo: st.maxCombo };
			lsSet(bk, JSON.stringify(rec));
		}
	}

	// ---- the game loop: rAF on the audio-element clock (never the 4Hz $state) ----
	let lastT = -1;
	$effect(() => {
		let raf = 0;
		const frame = () => {
			raf = requestAnimationFrame(frame);
			const tNow = player.liveTime();
			now = tNow;
			const r = run;
			if (!r) return;
			if (lastT >= 0 && Math.abs(tNow - lastT) > 0.4) {
				// Seek (or a track loop): re-derive from note states (§6). A seek back
				// before the end reopens a finished run.
				seekRun(r, tNow);
				if (endState && chart && tNow < (chart.notes.at(-1)?.t ?? 0)) {
					endState = null;
					cardClosed = false;
					newBest = false;
					scrollLocked = nextScrollLock(scrollLocked, 'roundStart'); // quick-261122-npfix
				}
			}
			lastT = tNow;
			if (player.playing && !endState) {
				for (const ev of advanceRun(r, tNow)) {
					if (ev.kind === 'miss') showPop(r.chart.notes[ev.index].lane, 'miss', 0);
				}
			}
			const st = runStats(r);
			stats = st;
			if (!endState && st.failed) {
				endState = 'failed';
				scrollLocked = nextScrollLock(scrollLocked, 'roundEnd'); // quick-261122-npfix: results scroll
				if (player.playing) player.toggle(); // HP 0: the music stops with the round (§5.3)
			} else if (!endState && st.complete && chart) {
				const lastNote = chart.notes.at(-1);
				if (lastNote && tNow > lastNote.t + lastNote.dur + 1.2) {
					endState = 'complete';
					settleBest(st);
					scrollLocked = nextScrollLock(scrollLocked, 'roundEnd'); // quick-261122-npfix
				}
			}
		};
		raf = requestAnimationFrame(frame);
		return () => cancelAnimationFrame(raf);
	});

	function settleBest(st: RunStats): void {
		if (!songHash) return;
		const mode = beat.challenge ? 'challenge' : 'casual';
		const key = bestKey(songHash, beat.difficulty, mode);
		const existing = parseBest(lsGet(key));
		if (bestEligible(st) && (!existing || st.score > existing.score)) {
			const rec: BestRecord = { score: st.score, grade: st.grade, accuracy: st.accuracy, maxCombo: st.maxCombo };
			lsSet(key, JSON.stringify(rec));
			best = rec;
			newBest = true;
		} else {
			best = existing;
		}
	}

	// ---- judgment popups + pad flash (per lane) ----
	let pops = $state<Record<number, { text: string; cls: string; hint: string; seq: number }>>({});
	let flash = $state<Record<number, { j: Judgment | 'ghost'; seq: number }>>({});
	let seq = 0;
	function showPop(lane: number, j: Judgment, dt: number): void {
		seq++;
		const hint = j !== 'miss' && Math.abs(dt) > 0.04 ? (dt < 0 ? t('songbeat.early') : t('songbeat.late')) : '';
		pops = { ...pops, [lane]: { text: t(JUDGE_KEY[j]), cls: j, hint, seq } };
		flash = { ...flash, [lane]: { j, seq } };
	}

	// ---- input: the fusion layer (§3.2) — every tap sounds, hit or ghost ----
	let pluckStep = 0;
	let lastPluckAt = 0;
	const hapticsFor: Record<PadId, (i: number, v: number) => void> = { kick, snare, pluck, shaker };

	function padDown(lane: number, e: PointerEvent): void {
		e.preventDefault();
		(e.currentTarget as HTMLElement).setPointerCapture?.(e.pointerId);
		unlockSynth();
		const pad = lanePad(lane);
		// Velocity from tap position within the pad (Tap-Along's rule).
		const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
		const dx = (e.clientX - rect.left) / Math.max(1, rect.width) - 0.5;
		const dy = (e.clientY - rect.top) / Math.max(1, rect.height) - 0.5;
		const velocity = velocityFromPosition(Math.min(1, Math.hypot(dx, dy) * 2));
		// Judgment first (it never delays the sound — both happen on pointerdown).
		let weight = -1;
		if (run && player.playing && !endState) {
			const out = tapDown(run, lane, player.liveTime(), beat.calibrationMs / 1000);
			if (out.kind === 'hit' && out.judgment) {
				weight = out.judgment === 'perfect' ? 1 : out.judgment === 'great' ? 0.7 : 0.4;
				showPop(lane, out.judgment, out.dt);
				stats = runStats(run);
			}
		}
		if (weight < 0) {
			seq++;
			flash = { ...flash, [lane]: { j: 'ghost', seq } };
		}
		// The instrument sounds NOW — judged hits at accuracy-scaled velocity (§3.2).
		const vel = weight >= 0 ? velocity * (0.7 + 0.3 * weight) : velocity;
		if (pad === 'pluck') {
			const nowMs = performance.now();
			pluckStep = nextPluckStep(pluckStep, nowMs - lastPluckAt);
			lastPluckAt = nowMs;
			playPadSound('pluck', pluckStep, vel);
		} else {
			playPadSound(pad, 0, vel);
		}
		hapticsFor[pad](INTENSITY_SCALES[tapCfg.intensity], velocity);
	}

	function padUp(lane: number): void {
		if (run && player.playing && !endState) {
			tapUp(run, lane, player.liveTime(), beat.calibrationMs / 1000);
			stats = runStats(run);
		}
	}

	// ---- derived render helpers ----
	const displayPads = $derived(padOrder(beat.mirror));
	// Lane-field skins (Highway / Rain): the visible-note set + display lane order,
	// re-derived per frame from run state — the skins themselves stay stateless.
	const fallingNotes = $derived(run ? visibleNotes(run, now, beat.approachSec) : []);
	const displayLanes = $derived(beat.mirror ? [3, 2, 1, 0] : [0, 1, 2, 3]);
	// Skin D: the raining character set (stream + targets) for the char family.
	const fallingChars = $derived(
		effectiveSkin === 'character-catch' && charChart ? visibleChars(charChart, run, now, beat.approachSec) : []
	);
	const activeLine = $derived(activeLineAt(gameLines, now, lyricOffset));
	const activeLineText = $derived(activeLine.idx >= 0 ? gameLines[activeLine.idx]?.text ?? '' : '');

	/** The next unresolved note per lane inside the approach window. Carries the
	 *  GROW-OUT geometry inputs (Hector 2026-11-23 22:09): signedDt = now − note.t
	 *  (negative before the hit moment, 0 AT the border = PERFECT, positive past it)
	 *  — skins turn it into size/position via growOut() and nothing else. */
	function nextNote(lane: number): { progress: number; hold: boolean; signedDt: number; holdProgress: number } | null {
		if (!run || !chart) return null;
		for (let i = 0; i < chart.notes.length; i++) {
			const n = chart.notes[i];
			if (n.lane !== lane) continue;
			const st = run.notes[i].state;
			if (st === 'holding') {
				const p = n.dur > 0 ? Math.min(1, Math.max(0, (now - n.t) / n.dur)) : 1;
				return { progress: 1, hold: true, signedDt: now - n.t, holdProgress: p };
			}
			if (st !== 'pending') continue;
			const dt = n.t - now;
			if (dt < -0.22) continue;
			if (dt > beat.approachSec) return null;
			return { progress: Math.min(1, Math.max(0, 1 - dt / beat.approachSec)), hold: false, signedDt: -dt, holdProgress: 0 };
		}
		return null;
	}

	function laneOf(pad: PadId): number {
		return pad === 'kick' ? 0 : pad === 'snare' ? 1 : pad === 'pluck' ? 2 : 3;
	}

	const DIFF_KEY: Record<Difficulty, TranslationKey> = {
		relaxed: 'songbeat.relaxed',
		standard: 'songbeat.standard',
		fever: 'songbeat.fever',
		hell: 'songbeat.hell'
	};
	const JUDGE_KEY: Record<Judgment, TranslationKey> = {
		perfect: 'songbeat.perfect',
		great: 'songbeat.great',
		good: 'songbeat.good',
		miss: 'songbeat.miss'
	};

	function restartRun(): void {
		if (!chart) return;
		run = createRun(chart, beat.difficulty, beat.challenge);
		endState = null;
		cardClosed = false;
		newBest = false;
		scrollLocked = nextScrollLock(scrollLocked, 'roundStart'); // quick-261122-npfix: AUTO-PIN
		stats = runStats(run);
		runPark.delete(runKey);
	}

	function playAgain(): void {
		restartRun();
		player.seekFraction(0); // auto-plays if paused (the tap-to-seek contract)
	}

	function keepListening(): void {
		cardClosed = true;
		if (!player.playing) player.toggle();
	}
</script>

<div class="game" use:pinScroll={scrollLocked}>
	<!-- quick-261122-npfix: the scroll LOCK's visible face (Hector 2026-11-22). Top corner of the
	     game surface, 44×44, icon = the CURRENT state one-to-one (locked → Lock, unlocked →
	     LockOpen), aria-pressed mirrors it. A tap is the manual override; a round start re-pins. -->
	<button type="button" class="lock-toggle" class:on={scrollLocked} aria-pressed={scrollLocked} aria-label={t('songbeat.scrollLock')} title={t('songbeat.scrollLock')} onclick={() => (scrollLocked = nextScrollLock(scrollLocked, 'toggle'))} use:tapBounce>{#if scrollLocked}<Lock size={20} aria-hidden="true" />{:else}<LockOpen size={20} aria-hidden="true" />{/if}</button>
	<!-- HUD (§3.3): difficulty + skin left, combo centre, score right; the HP bar
	     renders ONLY in challenge mode — in casual play the slot is absent entirely. -->
	<div class="hud">
		<span class="hud-left">{t(DIFF_KEY[beat.difficulty])} · {t(skinDef(effectiveSkin).labelKey)}{#if chart?.source === 'grid'} · {t('songbeat.gridChart')}{/if}</span>
		<span class="hud-combo">{#if (stats?.combo ?? 0) >= 2}{stats?.combo} {t('songbeat.combo')}{/if}</span>
		<span class="hud-score">{(stats?.score ?? 0).toLocaleString()}</span>
	</div>
	{#if beat.challenge}
		<div class="hp" aria-hidden="true"><div class="hp-fill" style:width={`${stats?.hp ?? 100}%`}></div></div>
	{/if}

	<div class="lyric-strip" aria-hidden="true">{activeLineText}</div>

	{#if !track}
		<p class="ready">{t('songbeat.ready')}</p>
	{:else}
		<!-- Skins (brief §2.3, Workstream F): Square is the default renderer; Round is
		     the circular variant; Highway is the four-lane field; Character-Catch
		     rains the lyric characters themselves. All are stateless — switching
		     preserves the run (Character-Catch parks its own chart family's run). -->
		{#if effectiveSkin === 'character-catch'}
			<SongBeatCharCatchSkin chars={fallingChars} lanes={displayLanes} {pops} {flash} approachSec={beat.approachSec} onPadDown={padDown} onPadUp={padUp} groupLabel={t('nowplaying.game')} />
		{:else if beat.skin === 'rain'}
			<SongBeatRainSkin notes={fallingNotes} lanes={displayLanes} {pops} {flash} approachSec={beat.approachSec} onPadDown={padDown} onPadUp={padUp} groupLabel={t('nowplaying.game')} />
		{:else if beat.skin === 'pulse'}
			<SongBeatPulseSkin pads={displayPads} {laneOf} {nextNote} {pops} {flash} approachSec={beat.approachSec} onPadDown={padDown} onPadUp={padUp} groupLabel={t('nowplaying.game')} />
		{:else if beat.skin === 'highway'}
			<SongBeatHighwaySkin notes={fallingNotes} lanes={displayLanes} {pops} {flash} approachSec={beat.approachSec} onPadDown={padDown} onPadUp={padUp} groupLabel={t('nowplaying.game')} />
		{:else if beat.skin === 'round'}
			<SongBeatRoundSkin pads={displayPads} {laneOf} {nextNote} {pops} {flash} approachSec={beat.approachSec} onPadDown={padDown} onPadUp={padUp} groupLabel={t('nowplaying.game')} />
		{:else}
			<SongBeatSquareSkin pads={displayPads} {laneOf} {nextNote} {pops} {flash} approachSec={beat.approachSec} onPadDown={padDown} onPadUp={padUp} groupLabel={t('nowplaying.game')} />
		{/if}
	{/if}

	<!-- Toolbar (§7): every game setting at the point of use, never in global Settings. -->
	<!-- Workstream H (Hector 2026-11-23, Icon Status Mapping): every toolbar LABEL is an
	     icon — skin = its shape glyph (Square/Circle), difficulty = 1→4 intensity bars,
	     challenge = crossed swords, calibration = crosshair, volume = speaker. Words live
	     on as aria-label/title only. Pure quantities stay NUMERIC (approach seconds,
	     calibration ms value, score) — an icon cannot carry a number. -->
	<div class="toolbar">
		<div class="seg" role="group" aria-label={t('songbeat.skin')}>
			{#each SONGBEAT_SKINS as def (def.id)}
				<button type="button" class="icon-btn" class:active={beat.skin === def.id} aria-pressed={beat.skin === def.id}
					aria-label={t(def.labelKey)} title={def.id === 'character-catch' && !charAvailable ? t('songbeat.charUnavailable') : t(def.labelKey)}
					disabled={def.id === 'character-catch' && !charAvailable}
					onclick={() => { beat = { ...beat, skin: def.id }; }}>{#if def.id === 'round'}<Circle size={16} aria-hidden="true" />{:else if def.id === 'highway'}<Columns4 size={16} aria-hidden="true" />{:else if def.id === 'character-catch'}<WholeWord size={16} aria-hidden="true" />{:else if def.id === 'pulse'}<HeartPulse size={16} aria-hidden="true" />{:else if def.id === 'rain'}<CloudRain size={16} aria-hidden="true" />{:else}<Square size={16} aria-hidden="true" />{/if}</button>
			{/each}
		</div>
		<div class="seg" role="group" aria-label={t('songbeat.difficulty')}>
			{#each ['relaxed', 'standard', 'fever', 'hell'] as d, di (d)}
				<button type="button" class="icon-btn" class:active={beat.difficulty === d} aria-pressed={beat.difficulty === d}
					aria-label={t(DIFF_KEY[d as Difficulty])} title={t(DIFF_KEY[d as Difficulty])}
					onclick={() => { beat = { ...beat, difficulty: d as Difficulty }; }}><span class="diff-bars" aria-hidden="true">{#each [0, 1, 2, 3] as b (b)}<span class="diff-bar" class:filled={b <= di} style:height={`${4 + b * 3}px`}></span>{/each}</span></button>
			{/each}
		</div>
		<button type="button" class="toggle icon-btn" class:on={beat.challenge} aria-pressed={beat.challenge}
			aria-label={t('songbeat.challenge')} title={t('songbeat.challenge')}
			onclick={() => { beat = { ...beat, challenge: !beat.challenge }; }}><Swords size={16} aria-hidden="true" /></button>
		<div class="seg" role="group" aria-label={t('songbeat.approach')}>
			{#each APPROACH_OPTIONS as a (a)}
				<button type="button" class:active={beat.approachSec === a} aria-pressed={beat.approachSec === a}
					onclick={() => { beat = { ...beat, approachSec: a }; }}>{a.toFixed(2).replace(/0$/, '')}s</button>
			{/each}
		</div>
		<label class="slider" aria-label={t('songbeat.calibration')}>
			<Crosshair size={16} aria-hidden="true" />
			<span class="slider-value">{beat.calibrationMs > 0 ? '+' : ''}{beat.calibrationMs}ms</span>
			<input type="range" min="-150" max="150" step="5" value={beat.calibrationMs} aria-label={t('songbeat.calibration')}
				oninput={(e) => { beat = { ...beat, calibrationMs: Number((e.currentTarget as HTMLInputElement).value) }; }} />
		</label>
		<label class="slider" aria-label={t('songbeat.volume')}>
			<Volume2 size={16} aria-hidden="true" />
			<input type="range" min="0" max="100" step="1" value={Math.round(tapCfg.synthVolume * 100)} aria-label={t('songbeat.volume')}
				oninput={(e) => { tapCfg = { ...tapCfg, synthVolume: Number((e.currentTarget as HTMLInputElement).value) / 100 }; }} />
		</label>
	</div>

	<!-- Results (§5.4): inside the tab, never a modal over the music. -->
	{#if endState && stats && !cardClosed}
		<div class="results" role="status">
			{#if endState === 'failed'}
				<div class="r-grade fail">{t('songbeat.gameOver')}</div>
				<div class="r-line">{t('songbeat.completed', { pct: stats.total ? Math.round((stats.settled / stats.total) * 100) : 0 })}</div>
			{:else}
				<div class="r-grade">{stats.grade}</div>
			{/if}
			<div class="r-score">{stats.score.toLocaleString()}</div>
			<div class="r-line">
				{t('songbeat.accuracy')} {Math.round(stats.accuracy * 100)}% · {t('songbeat.maxCombo')} {stats.maxCombo}
			</div>
			{#if effectiveSkin === 'character-catch'}
				<!-- Skin D's signature number (addendum §3): per-character catch accuracy —
				     the core accuracy over target characters, under its own name. -->
				<div class="r-line">{t('songbeat.charAccuracy')} {Math.round(stats.accuracy * 100)}%</div>
			{/if}
			<div class="r-counts">
				<span class="perfect">{t('songbeat.perfect')} {stats.counts.perfect}</span>
				<span class="great">{t('songbeat.great')} {stats.counts.great}</span>
				<span class="good">{t('songbeat.good')} {stats.counts.good}</span>
				<span class="miss">{t('songbeat.miss')} {stats.counts.miss}</span>
			</div>
			{#if best}
				<div class="r-line best">{t('songbeat.best')} {best.score.toLocaleString()}{#if newBest && endState === 'complete'} · {t('songbeat.newRecord')}{/if}</div>
			{/if}
			<div class="r-actions">
				<button type="button" class="r-btn primary" onclick={playAgain} use:tapBounce>{t('songbeat.playAgain')}</button>
				{#if endState === 'failed'}
					<button type="button" class="r-btn" onclick={keepListening} use:tapBounce>{t('songbeat.keepListening')}</button>
				{:else}
					<button type="button" class="r-btn" onclick={() => onExit?.()} use:tapBounce>{t('songbeat.backToLyrics')}</button>
				{/if}
			</div>
		</div>
	{/if}
</div>

<style>
	.game { display: flex; flex-direction: column; gap: 10px; padding: 10px 2px 14px; position: relative; }
	.hud { display: flex; align-items: baseline; justify-content: space-between; min-height: 22px; padding-inline-end: 50px; }
	/* quick-261122-npfix: the scroll-lock toggle — top corner, 44×44 hit box (DESIGN.md minimum);
	   the HUD reserves 50px at its end so the score never sits under it. */
	.lock-toggle { position: absolute; top: 2px; inset-inline-end: 2px; width: 44px; height: 44px; display: grid; place-items: center; padding: 0; border-radius: 50%; border: 1px solid var(--color-border, rgba(255,255,255,0.14)); background: var(--color-surface-2); color: var(--color-text-muted); cursor: pointer; z-index: 2; }
	.lock-toggle.on { background: var(--color-accent, #00c2b8); border-color: var(--color-accent, #00c2b8); color: #04211f; }
	.hud-left { font-size: 12px; color: var(--color-text-muted); letter-spacing: 0.04em; }
	.hud-combo { font-size: 14px; font-weight: 700; color: var(--color-accent, #00c2b8); }
	.hud-score { font-size: 16px; font-weight: 700; font-variant-numeric: tabular-nums; }
	.hp { height: 5px; border-radius: 3px; background: var(--color-surface-2); overflow: hidden; }
	.hp-fill { height: 100%; background: var(--color-accent, #00c2b8); border-radius: 3px; transition: width 0.18s linear; }
	.lyric-strip { min-height: 20px; text-align: center; font-size: 14px; color: var(--color-text-muted); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
	.ready { text-align: center; color: var(--color-text-muted); font-size: 13px; padding: 18px 8px; }
	.toolbar { display: flex; flex-wrap: wrap; gap: 8px 12px; align-items: center; }
	.seg { display: inline-flex; border: 1px solid var(--color-border, rgba(255,255,255,0.14)); border-radius: 999px; overflow: hidden; }
	.seg button { padding: 6px 10px; font-size: 12px; background: transparent; color: var(--color-text-muted); border: 0; cursor: pointer; }
	.seg button.active { background: var(--color-accent, #00c2b8); color: #04211f; font-weight: 700; }
	/* Skin D unavailable on a no-lyrics song (addendum §2): the selector entry dims
	   and refuses the tap; its title carries the honest reason. */
	.seg button:disabled { opacity: 0.45; cursor: not-allowed; }
	.toggle { padding: 6px 12px; font-size: 12px; border-radius: 999px; border: 1px solid var(--color-border, rgba(255,255,255,0.14)); background: transparent; color: var(--color-text-muted); cursor: pointer; }
	.toggle.on { background: #e5484d; border-color: #e5484d; color: #fff; font-weight: 700; }
	/* Workstream H: icon-only toolbar buttons keep the seg/toggle geometry (NO STRETCH —
	   fixed padding box, glyph centred, content never resizes the control). */
	.seg button.icon-btn, .toggle.icon-btn { display: inline-grid; place-items: center; min-width: 36px; min-height: 28px; line-height: 0; }
	.toggle.icon-btn { padding: 6px 10px; }
	.diff-bars { display: inline-flex; align-items: flex-end; gap: 2px; height: 13px; }
	.diff-bar { width: 3px; border-radius: 1px; background: currentColor; opacity: 0.25; }
	.diff-bar.filled { opacity: 1; }
	.slider { display: inline-flex; align-items: center; gap: 8px; font-size: 12px; color: var(--color-text-muted); }
	.slider input { width: 110px; accent-color: var(--color-accent, #00c2b8); }
	.results { border: 1px solid var(--color-border, rgba(255,255,255,0.14)); background: var(--color-surface-2); border-radius: 14px; padding: 16px; text-align: center; display: flex; flex-direction: column; gap: 6px; align-items: center; }
	.r-grade { font-size: 44px; font-weight: 900; line-height: 1; color: var(--color-accent, #00c2b8); }
	.r-grade.fail { font-size: 24px; color: #e5484d; }
	.r-score { font-size: 22px; font-weight: 800; font-variant-numeric: tabular-nums; }
	.r-line { font-size: 13px; color: var(--color-text-muted); }
	.r-line.best { color: var(--color-text); }
	.r-counts { display: flex; gap: 10px; flex-wrap: wrap; justify-content: center; font-size: 11px; font-weight: 700; letter-spacing: 0.04em; }
	.r-counts .perfect { color: var(--color-accent, #00c2b8); }
	.r-counts .miss { color: #e5484d; }
	.r-actions { display: flex; gap: 8px; margin-top: 6px; }
	.r-btn { padding: 9px 16px; border-radius: 999px; border: 1px solid var(--color-border, rgba(255,255,255,0.14)); background: transparent; color: var(--color-text); font-size: 13px; cursor: pointer; }
	.r-btn.primary { background: var(--color-accent, #00c2b8); border-color: var(--color-accent, #00c2b8); color: #04211f; font-weight: 700; }
</style>
