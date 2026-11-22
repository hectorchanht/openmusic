// AI voice button — the runes store (quick-261122-voice).
//
// Flow (the Hotel Portal AI Bulk Edit pattern — AI PROPOSES, human CONFIRMS, system EXECUTES):
//   tap the big button → `listening` (mic open, interim words shown live)
//   → `thinking` (/api/voice/intent, then the search/library lookup that turns the intent
//     into a concrete proposal — the card always names the REAL song that OK will play)
//   → `card` (big cover + "I will play X", huge OK / No buttons, read aloud by the host)
//   → OK executes exactly the proposal; No re-opens the mic (the undo for a misheard request
//     happens BEFORE anything plays — nothing is ever executed unconfirmed).
//
// Decisions recorded for the todo's open questions:
//  - STT: hybrid — Web Speech where present, Whisper upload otherwise (voice-capture.ts).
//  - AI: Workers AI (llama-3.3-70b JSON mode) behind a monthly neuron cap + KV cache, rule
//    parser as the never-throw floor (voice-ai.ts / voice-intent.ts).
//  - Confirmation: EVERY intent goes through the card (play AND controls) — one consistent
//    gesture to learn; Q&A shows the answer with a single Close.
//  - Undo: the card's "No — say again" + up to 3 alternate songs on the card; after OK a toast
//    offers "Ask again" (the host wires it), which re-opens the mic.
//  - Elderly shape: a large floating button on every tab (default ON), auto-listening on tap,
//    huge type, read-aloud card, music ducks (pauses) while the mic is open so it does not
//    hear itself, and resumes if the user cancels.
//
// House rules: stores emit raw data, never localized text (the sheet maps reasons → t());
// every async step is generation-guarded (`gen`) so a cancel/re-listen supersedes it.
import { browser } from '$app/environment';
import type { Track } from '$lib/sources/types';
import { player } from '$lib/stores/player.svelte';
import { library } from '$lib/stores/library.svelte';
import { history } from '$lib/stores/history.svelte';
import { settings } from '$lib/stores/settings.svelte';
import { logAction } from '$lib/stores/actionLog.svelte';
import { searchAll } from '$lib/services/catalog';
import { dedupeBest, dedupeShelfList } from '$lib/services/dedupe';
import { apiFetch } from '$lib/services/api-base';
import {
	normalizeIntent,
	parseIntentLocal,
	resolveVoiceLang,
	type VoiceIntent,
	type VoiceLang
} from '$lib/services/voice-intent';
import { captureMode, startCapture, stopSpeaking, type CaptureError, type CaptureHandle } from '$lib/services/voice-capture';
import { ALTERNATES, LIST_CAP, controlFor, pickArtistTracks, swapAlternate, type VoiceProposal } from '$lib/services/voice-plan';

export type VoicePhase = 'listening' | 'thinking' | 'card' | 'error';

const INTENT_TIMEOUT_MS = 8000;
const SEARCH_TIMEOUT_MS = 7000;

class Voice {
	open = $state(false);
	phase = $state<VoicePhase>('listening');
	/** Live words while listening, then the final transcript. */
	transcript = $state('');
	proposal = $state<VoiceProposal | null>(null);
	error = $state<CaptureError | null>(null);
	/** Bumped when a proposal executes — the host shows the "Ask again" toast off it. */
	executed = $state<{ n: number; proposal: VoiceProposal | null }>({ n: 0, proposal: null });

	// Plain fields — internal guards the UI never reads (house convention).
	private gen = 0;
	private capture: CaptureHandle | null = null;
	private abort: AbortController | null = null;
	/** Music was playing when the mic opened — resume it on cancel. */
	private ducked = false;

	get lang(): VoiceLang {
		const nav = browser && typeof navigator !== 'undefined' ? [...(navigator.languages ?? [navigator.language])] : [];
		return resolveVoiceLang(settings.voiceLang, settings.appLang, nav);
	}

	get supported(): boolean {
		return browser && captureMode() !== 'none';
	}

	/** Entry point — MUST be called from the tap handler (Web Speech needs the user gesture). */
	start() {
		if (!browser) return;
		history.load();
		this.open = true;
		this.listen();
	}

	listen() {
		const gen = ++this.gen;
		this.teardown();
		stopSpeaking();
		this.proposal = null;
		this.error = null;
		this.transcript = '';
		this.phase = 'listening';
		if (player.playing) {
			this.ducked = true;
			player.toggle();
		}
		logAction('voice.listen', { lang: this.lang, mode: captureMode() });
		this.capture = startCapture(this.lang, settings.appLang, {
			onInterim: (text) => {
				if (gen === this.gen) this.transcript = text;
			},
			onUploading: () => {
				if (gen === this.gen) this.phase = 'thinking';
			},
			onFinal: (text) => {
				if (gen !== this.gen) return;
				this.capture = null;
				this.transcript = text;
				void this.understand(text, gen);
			},
			onError: (code) => {
				if (gen !== this.gen) return;
				this.capture = null;
				logAction('voice.error', { code });
				this.error = code;
				this.phase = 'error';
			}
		});
	}

	/** The "I'm done talking" button. */
	finishListening() {
		this.capture?.stop();
	}

	/** Typed fallback (keyboard users, a failing mic) — same pipeline as speech. */
	submitText(text: string) {
		const t = text.trim();
		if (!t) return;
		const gen = ++this.gen;
		this.teardown();
		this.transcript = t;
		void this.understand(t, gen);
	}

	private async understand(text: string, gen: number) {
		this.phase = 'thinking';
		const ac = new AbortController();
		this.abort = ac;
		const intent = await this.fetchIntent(text, ac.signal);
		if (gen !== this.gen) return;
		logAction('voice.intent', { kind: intent.kind, query: intent.query });
		const proposal = await this.propose(intent, ac.signal);
		if (gen !== this.gen) return;
		this.proposal = proposal;
		this.phase = 'card';
	}

	private async fetchIntent(text: string, signal: AbortSignal): Promise<VoiceIntent> {
		const timeout = AbortSignal.timeout(INTENT_TIMEOUT_MS);
		try {
			const res = await apiFetch('/api/voice/intent', {
				method: 'POST',
				headers: { 'content-type': 'application/json' },
				body: JSON.stringify({ text, lang: this.lang }),
				signal: AbortSignal.any ? AbortSignal.any([signal, timeout]) : signal
			});
			const data = (await res.json()) as { intent?: unknown };
			return normalizeIntent(data.intent);
		} catch {
			// Offline / route down — the same rules the edge falls back to.
			return parseIntentLocal(text);
		}
	}

	/** Search with a time cap, keeping the best PARTIAL result if slow sources lag. */
	private async search(query: string, signal: AbortSignal): Promise<Track[]> {
		let latest: Track[] = [];
		const done = searchAll(query, 1, {}, signal, (p) => {
			latest = p.interleaved;
		})
			.then((r) => {
				latest = r.interleaved;
			})
			.catch(() => {});
		await Promise.race([done, new Promise((r) => setTimeout(r, SEARCH_TIMEOUT_MS))]);
		return dedupeBest(latest, settings.preferredSource);
	}

	private async propose(intent: VoiceIntent, signal: AbortSignal): Promise<VoiceProposal> {
		const control = controlFor(intent.kind);
		if (control) {
			if (!player.current && control !== 'resume') return { kind: 'none', reason: 'nothing-playing', query: '' };
			if (!player.current) {
				// "Resume" with nothing loaded = carry on where they left off → last played song.
				const last = dedupeShelfList(history.entries) as Track[];
				if (!last.length) return { kind: 'none', reason: 'nothing-playing', query: '' };
				return { kind: 'play-list', source: 'history', label: '', tracks: last.slice(0, LIST_CAP) };
			}
			return { kind: 'control', action: control };
		}
		switch (intent.kind) {
			case 'answer':
				return { kind: 'answer', text: intent.answer };
			case 'play_liked': {
				const list = dedupeShelfList(library.liked);
				if (!list.length) return { kind: 'none', reason: 'no-liked', query: '' };
				return { kind: 'play-list', source: 'liked', label: '', tracks: list.slice(0, LIST_CAP * 5) };
			}
			case 'play_history': {
				const list = dedupeShelfList(history.entries) as Track[];
				if (!list.length) return { kind: 'none', reason: 'no-history', query: '' };
				return { kind: 'play-list', source: 'history', label: '', tracks: list.slice(0, LIST_CAP) };
			}
			case 'play_song': {
				const list = await this.search(intent.query, signal);
				if (!list.length) return { kind: 'none', reason: 'not-found', query: intent.query };
				return { kind: 'play-song', track: list[0], alternates: list.slice(1, 1 + ALTERNATES) };
			}
			case 'play_artist': {
				const list = pickArtistTracks(await this.search(intent.query, signal), intent.query);
				if (!list.length) return { kind: 'none', reason: 'not-found', query: intent.query };
				return { kind: 'play-list', source: 'artist', label: intent.query, tracks: list };
			}
			case 'play_genre': {
				const list = (await this.search(intent.query, signal)).slice(0, LIST_CAP);
				if (!list.length) return { kind: 'none', reason: 'not-found', query: intent.query };
				return { kind: 'play-list', source: 'genre', label: intent.query, tracks: list };
			}
			default:
				return { kind: 'none', reason: 'not-understood', query: '' };
		}
	}

	/** "Not this one — that one": promote an alternate song on the card. */
	pickAlternate(uid: string) {
		const p = this.proposal;
		if (p?.kind === 'play-song') this.proposal = swapAlternate(p, uid);
	}

	/** OK — execute exactly what the card shows. */
	confirm() {
		const p = this.proposal;
		if (!p) return this.close();
		logAction('voice.confirm', { kind: p.kind });
		switch (p.kind) {
			case 'play-song':
				player.setQueue([p.track], 'search');
				void player.play(p.track, { fresh: true });
				break;
			case 'play-list': {
				const ctx = p.source === 'liked' ? 'liked' : p.source === 'history' ? 'history' : 'search';
				player.setListQueue(p.tracks, ctx);
				void player.play(p.tracks[0], { fresh: true, sameList: true });
				break;
			}
			case 'control':
				if (p.action === 'pause') {
					if (player.playing) player.toggle();
				} else if (p.action === 'resume') {
					if (!player.playing) player.toggle();
				} else if (p.action === 'next') player.next();
				else player.prev();
				break;
			default:
				// answer / none: nothing to execute — behave like Close (resume ducked music).
				return this.close();
		}
		this.ducked = false; // the executed action owns playback now
		this.executed = { n: this.executed.n + 1, proposal: p };
		this.dismiss();
	}

	/** Close without executing — music that was ducked for the mic resumes. */
	close() {
		const resume = this.ducked;
		this.dismiss();
		if (resume && !player.playing && player.current) player.toggle();
	}

	private dismiss() {
		this.gen++;
		this.teardown();
		stopSpeaking();
		this.open = false;
		this.phase = 'listening';
		this.proposal = null;
		this.error = null;
		this.ducked = false;
	}

	private teardown() {
		this.capture?.abort();
		this.capture = null;
		this.abort?.abort();
		this.abort = null;
	}
}

export const voice = new Voice();
