// AI voice button — microphone capture (quick-261122-voice).
//
// HYBRID STT (the todo's open question, decided here):
//  1. `speech` — the browser's own recogniser (SpeechRecognition / webkitSpeechRecognition).
//     iOS Safari and Android Chrome ship it; it streams interim text (the user SEES their words
//     appear, which is the reassurance an elderly user needs), costs nothing, and knows
//     Cantonese as `yue-Hant-HK`.
//  2. `record` — devices without it (the Capacitor Android WebView) record a short clip with
//     MediaRecorder and POST it to /api/voice/transcribe (Whisper large-v3-turbo, `yue`).
//     Auto-stops after ~1.4 s of silence once speech was heard (an AnalyserNode level meter —
//     a mic-level probe only; the playback engine stays plain <audio>, 43-D-09 untouched),
//     with a hard 12 s cap.
//  3. `none` — no mic API at all: the sheet says so.
// A `speech` session that dies with a `network` / `service-not-allowed` error (iOS PWA
// quirks) retries once in `record` mode before giving up.
import { apiFetch } from '$lib/services/api-base';
import { speechRecognitionLang, type VoiceLang } from '$lib/services/voice-intent';

export type CaptureMode = 'speech' | 'record' | 'none';
export type CaptureError = 'denied' | 'no-speech' | 'network' | 'unsupported';

export interface CaptureCallbacks {
	onInterim(text: string): void;
	onFinal(text: string): void;
	onError(code: CaptureError): void;
	/** Fired when a record-mode clip stops and is uploading (UI → "thinking"). */
	onUploading?(): void;
}

export interface CaptureHandle {
	/** Finish now and deliver what was heard. */
	stop(): void;
	/** Drop everything; no callbacks fire afterwards. */
	abort(): void;
}

interface SpeechRecognitionLike {
	lang: string;
	interimResults: boolean;
	continuous: boolean;
	maxAlternatives: number;
	onresult: ((e: { resultIndex: number; results: ArrayLike<ArrayLike<{ transcript: string }> & { isFinal: boolean }> }) => void) | null;
	onerror: ((e: { error: string }) => void) | null;
	onend: (() => void) | null;
	start(): void;
	stop(): void;
	abort(): void;
}
type SpeechRecognitionCtor = new () => SpeechRecognitionLike;

function speechCtor(): SpeechRecognitionCtor | null {
	if (typeof window === 'undefined') return null;
	const w = window as unknown as { SpeechRecognition?: SpeechRecognitionCtor; webkitSpeechRecognition?: SpeechRecognitionCtor };
	return w.SpeechRecognition ?? w.webkitSpeechRecognition ?? null;
}

function canRecord(): boolean {
	return (
		typeof navigator !== 'undefined' &&
		!!navigator.mediaDevices?.getUserMedia &&
		typeof (globalThis as { MediaRecorder?: unknown }).MediaRecorder === 'function'
	);
}

export function captureMode(): CaptureMode {
	if (speechCtor()) return 'speech';
	if (canRecord()) return 'record';
	return 'none';
}

export function startCapture(lang: VoiceLang, appLang: string, cb: CaptureCallbacks, mode = captureMode()): CaptureHandle {
	if (mode === 'speech') return startSpeech(lang, appLang, cb);
	if (mode === 'record') return startRecord(lang, cb);
	queueMicrotask(() => cb.onError('unsupported'));
	return { stop() {}, abort() {} };
}

function startSpeech(lang: VoiceLang, appLang: string, cb: CaptureCallbacks): CaptureHandle {
	const Ctor = speechCtor()!;
	const rec = new Ctor();
	rec.lang = speechRecognitionLang(lang, appLang);
	rec.interimResults = true;
	rec.continuous = false;
	rec.maxAlternatives = 1;
	let done = false;
	let heard = '';
	let fallback: CaptureHandle | null = null;
	const finish = (fn: () => void) => {
		if (done) return;
		done = true;
		fn();
	};
	rec.onresult = (e) => {
		let text = '';
		let final = false;
		for (let i = 0; i < e.results.length; i++) {
			text += e.results[i][0]?.transcript ?? '';
			if (e.results[i].isFinal) final = true;
		}
		heard = text.trim();
		if (final && heard) finish(() => cb.onFinal(heard));
		else if (!done) cb.onInterim(heard);
	};
	rec.onerror = (e) => {
		if (done) return;
		if (e.error === 'not-allowed') return finish(() => cb.onError('denied'));
		if ((e.error === 'network' || e.error === 'service-not-allowed') && canRecord()) {
			// iOS standalone-PWA / offline-recogniser quirk → one retry through Whisper.
			done = true;
			fallback = startRecord(lang, cb);
			return;
		}
		if (e.error === 'no-speech' || e.error === 'aborted') return finish(() => (heard ? cb.onFinal(heard) : cb.onError('no-speech')));
		finish(() => cb.onError(e.error === 'network' ? 'network' : 'no-speech'));
	};
	rec.onend = () => finish(() => (heard ? cb.onFinal(heard) : cb.onError('no-speech')));
	try {
		rec.start();
	} catch {
		queueMicrotask(() => finish(() => cb.onError('unsupported')));
	}
	return {
		stop() {
			if (fallback) return fallback.stop();
			try {
				rec.stop(); // onend/onresult deliver what was heard
			} catch {
				finish(() => (heard ? cb.onFinal(heard) : cb.onError('no-speech')));
			}
		},
		abort() {
			if (fallback) return fallback.abort();
			done = true;
			try {
				rec.abort();
			} catch {
				/* already ended */
			}
		}
	};
}

const SILENCE_MS = 1400;
const MAX_RECORD_MS = 12_000;
const NO_SPEECH_MS = 6000;
const LEVEL_THRESHOLD = 0.04;

function pickMime(): string {
	const MR = (globalThis as unknown as { MediaRecorder: { isTypeSupported?(t: string): boolean } }).MediaRecorder;
	for (const t of ['audio/webm;codecs=opus', 'audio/webm', 'audio/mp4', 'audio/ogg;codecs=opus']) {
		try {
			if (MR.isTypeSupported?.(t)) return t;
		} catch {
			/* keep looking */
		}
	}
	return '';
}

function startRecord(lang: VoiceLang, cb: CaptureCallbacks): CaptureHandle {
	let aborted = false;
	let stopped = false;
	let stream: MediaStream | null = null;
	let recorder: MediaRecorder | null = null;
	let ctx: AudioContext | null = null;
	let raf = 0;
	const timers: ReturnType<typeof setTimeout>[] = [];
	const chunks: Blob[] = [];
	let heardSpeech = false;

	const cleanup = () => {
		for (const t of timers) clearTimeout(t);
		if (raf) cancelAnimationFrame(raf);
		stream?.getTracks().forEach((t) => t.stop());
		void ctx?.close().catch(() => {});
	};
	const stop = () => {
		if (stopped) return;
		stopped = true;
		if (recorder && recorder.state !== 'inactive') recorder.stop();
		else cleanup();
	};

	void (async () => {
		try {
			stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true } });
		} catch (e) {
			if (!aborted) cb.onError((e as { name?: string })?.name === 'NotAllowedError' ? 'denied' : 'unsupported');
			return;
		}
		if (aborted || stopped) return cleanup();
		const mime = pickMime();
		try {
			recorder = mime ? new MediaRecorder(stream, { mimeType: mime }) : new MediaRecorder(stream);
		} catch {
			cleanup();
			if (!aborted) cb.onError('unsupported');
			return;
		}
		recorder.ondataavailable = (e) => {
			if (e.data.size) chunks.push(e.data);
		};
		recorder.onstop = async () => {
			cleanup();
			if (aborted) return;
			if (!heardSpeech && chunks.length === 0) return cb.onError('no-speech');
			const blob = new Blob(chunks, { type: recorder?.mimeType || mime || 'audio/webm' });
			cb.onUploading?.();
			try {
				const res = await apiFetch(`/api/voice/transcribe?lang=${lang}`, {
					method: 'POST',
					headers: { 'content-type': blob.type.split(';')[0] || 'audio/webm' },
					body: blob
				});
				const data = (await res.json()) as { text?: string };
				if (aborted) return;
				const text = (data.text ?? '').trim();
				if (text) cb.onFinal(text);
				else cb.onError('no-speech');
			} catch {
				if (!aborted) cb.onError('network');
			}
		};
		recorder.start(250);

		// Silence auto-stop — a level probe on the mic stream only.
		try {
			const AC = (window as unknown as { AudioContext?: typeof AudioContext; webkitAudioContext?: typeof AudioContext }).AudioContext
				?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
			if (AC) {
				ctx = new AC();
				const src = ctx.createMediaStreamSource(stream);
				const an = ctx.createAnalyser();
				an.fftSize = 1024;
				src.connect(an);
				const buf = new Float32Array(an.fftSize);
				let lastLoud = performance.now();
				const tick = () => {
					if (stopped || aborted) return;
					an.getFloatTimeDomainData(buf);
					let sum = 0;
					for (const v of buf) sum += v * v;
					const rms = Math.sqrt(sum / buf.length);
					const now = performance.now();
					if (rms > LEVEL_THRESHOLD) {
						heardSpeech = true;
						lastLoud = now;
					} else if (heardSpeech && now - lastLoud > SILENCE_MS) {
						return stop();
					}
					raf = requestAnimationFrame(tick);
				};
				raf = requestAnimationFrame(tick);
			} else {
				heardSpeech = true; // no meter → rely on the caps / the Done button
			}
		} catch {
			heardSpeech = true;
		}
		timers.push(setTimeout(stop, MAX_RECORD_MS));
		timers.push(
			setTimeout(() => {
				if (!heardSpeech && !stopped) {
					aborted = true;
					stopped = true;
					try {
						recorder?.stop();
					} catch {
						/* ignore */
					}
					cleanup();
					cb.onError('no-speech');
				}
			}, NO_SPEECH_MS)
		);
	})();

	return {
		stop,
		abort() {
			aborted = true;
			stop();
			cleanup();
		}
	};
}

/** Read text aloud (never throws; no-op without speechSynthesis). */
export function speak(text: string, lang: string): void {
	try {
		if (typeof window === 'undefined' || !('speechSynthesis' in window) || !text) return;
		window.speechSynthesis.cancel();
		const u = new SpeechSynthesisUtterance(text);
		u.lang = lang;
		u.rate = 0.9; // a touch slower for elderly listeners
		const voice = window.speechSynthesis.getVoices().find((v) => v.lang.replace('_', '-').toLowerCase() === lang.toLowerCase());
		if (voice) u.voice = voice;
		window.speechSynthesis.speak(u);
	} catch {
		/* TTS is a nicety */
	}
}

export function stopSpeaking(): void {
	try {
		if (typeof window !== 'undefined' && 'speechSynthesis' in window) window.speechSynthesis.cancel();
	} catch {
		/* ignore */
	}
}
