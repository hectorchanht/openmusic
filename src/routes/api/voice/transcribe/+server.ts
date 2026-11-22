// AI voice button — speech-to-text endpoint (quick-261122-voice).
// POST <raw audio bytes> (Content-Type audio/webm|mp4|ogg|wav) ?lang=yue|cmn|en → { text }.
//
// STT is HYBRID (todo open question "iOS native dictation vs Whisper vs hybrid"): the client
// uses the browser's own Web Speech recogniser wherever it exists (iOS Safari, Android
// Chrome — free, streaming, on-device or vendor-hosted), and only devices WITHOUT it (the
// Capacitor Android WebView) record a short clip and send it here for Whisper. Capped at
// MAX_AUDIO_BYTES (≈ 20 s of opus) so one request can never run up the bill.
import type { RequestHandler } from './$types';
import { jsonResponse } from '$lib/proxy/http';
import { aiTranscribe } from '$lib/proxy/voice-ai';
import { VOICE_LANGS, type VoiceLang } from '$lib/services/voice-intent';

const MAX_AUDIO_BYTES = 1_500_000;

export const POST: RequestHandler = async ({ request, url, platform }) => {
	const origin = request.headers.get('origin');
	const reply = (text: string, status = 200) => jsonResponse({ text }, origin, { status, cacheControl: 'no-store' });
	const langParam = url.searchParams.get('lang');
	const lang: VoiceLang = (VOICE_LANGS as readonly (string | null)[]).includes(langParam) ? (langParam as VoiceLang) : 'yue';
	const type = request.headers.get('content-type') ?? '';
	if (!/^(audio|video)\//i.test(type) && type !== 'application/octet-stream') return reply('', 415);
	const declared = Number(request.headers.get('content-length') ?? '0');
	if (declared > MAX_AUDIO_BYTES) return reply('', 413);
	let bytes: Uint8Array;
	try {
		bytes = new Uint8Array(await request.arrayBuffer());
	} catch {
		return reply('', 400);
	}
	if (bytes.length > MAX_AUDIO_BYTES) return reply('', 413);
	return reply(await aiTranscribe(platform?.env, bytes, lang));
};
