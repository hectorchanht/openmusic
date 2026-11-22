// quick-261122-voice — /api/voice/intent + /api/voice/transcribe, driven with a fabricated
// { request, platform } and a mocked Workers AI binding (same idiom as translate/server.test.ts).
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { POST as intentPOST } from './intent/+server';
import { POST as transcribePOST } from './transcribe/+server';
import { __resetVoiceBudget, VOICE_MONTHLY_BUDGET_NEURONS, extractJson, toBase64 } from '$lib/proxy/voice-ai';

type Run = (model: string, input: Record<string, unknown>) => Promise<unknown>;

function kvMock() {
	const store = new Map<string, string>();
	return {
		store,
		get: vi.fn(async (k: string) => store.get(k) ?? null),
		put: vi.fn(async (k: string, v: string) => void store.set(k, v))
	};
}

async function callIntent(body: unknown, env: Record<string, unknown> = {}) {
	const request = new Request('https://openmusic.lol/api/voice/intent', {
		method: 'POST',
		headers: { 'content-type': 'application/json' },
		body: typeof body === 'string' ? body : JSON.stringify(body)
	});
	const event = { request, platform: { env } } as unknown as Parameters<typeof intentPOST>[0];
	const res = await intentPOST(event);
	return (await res.json()) as { intent: { kind: string; query: string; answer: string }; via: string };
}

beforeEach(() => __resetVoiceBudget());

describe('/api/voice/intent', () => {
	it('short transport commands never touch the AI', async () => {
		const run = vi.fn<Run>();
		const out = await callIntent({ text: '暫停', lang: 'yue' }, { AI: { run } });
		expect(out).toEqual({ intent: { kind: 'pause', query: '', answer: '' }, via: 'rules' });
		expect(run).not.toHaveBeenCalled();
	});

	it('uses the LLM in JSON mode and caches the result in KV', async () => {
		const run = vi.fn<Run>(async () => ({
			response: { kind: 'play_song', query: '帝女花 任剑辉', answer: '' },
			usage: { neurons: 10 }
		}));
		const kv = kvMock();
		const out = await callIntent({ text: '我想聽任劍輝個帝女花', lang: 'yue' }, { AI: { run }, TRANSLATE_CACHE: kv });
		expect(out.via).toBe('ai');
		expect(out.intent).toEqual({ kind: 'play_song', query: '帝女花 任剑辉', answer: '' });
		const input = run.mock.calls[0][1];
		expect((input.response_format as { type: string }).type).toBe('json_schema');
		expect(kv.store.size).toBe(1);
		// Repeat → cache, no second AI call.
		const again = await callIntent({ text: '我想聽任劍輝個帝女花', lang: 'yue' }, { AI: { run }, TRANSLATE_CACHE: kv });
		expect(again.via).toBe('cache');
		expect(run).toHaveBeenCalledTimes(1);
	});

	it('parses a string response and sanitises garbage kinds', async () => {
		const run = vi.fn<Run>(async () => ({ response: 'Sure! {"kind":"delete_all","query":"x","answer":""}' }));
		const out = await callIntent({ text: '帝女花', lang: 'yue' }, { AI: { run } });
		// model said garbage → normalized unknown → the rules' playable phrase wins
		expect(out.intent).toMatchObject({ kind: 'play_song', query: '帝女花' });
		expect(out.via).toBe('rules');
	});

	it('Q&A comes back as an answer', async () => {
		const run = vi.fn<Run>(async () => ({ response: { kind: 'answer', query: '', answer: '帝女花係唐滌生嘅名作。' } }));
		const out = await callIntent({ text: '帝女花係邊個寫㗎？', lang: 'yue' }, { AI: { run } });
		expect(out.intent.kind).toBe('answer');
		expect(out.intent.answer).toContain('唐滌生');
	});

	it('falls back to the 8B model, then to the rules, never throwing', async () => {
		const run = vi.fn<Run>(async () => {
			throw new Error('JSON Mode couldn\'t be met');
		});
		const out = await callIntent({ text: '播張學友嘅歌', lang: 'yue' }, { AI: { run } });
		expect(run).toHaveBeenCalledTimes(2);
		expect(out).toEqual({ intent: { kind: 'play_artist', query: '張學友', answer: '' }, via: 'rules' });
	});

	it('no binding / over budget → rules', async () => {
		expect((await callIntent({ text: '播帝女花' })).via).toBe('rules');
		__resetVoiceBudget(VOICE_MONTHLY_BUDGET_NEURONS);
		const run = vi.fn<Run>();
		expect((await callIntent({ text: '播帝女花' }, { AI: { run } })).via).toBe('rules');
		expect(run).not.toHaveBeenCalled();
	});

	it('bad JSON body → unknown, 200', async () => {
		const out = await callIntent('{nope');
		expect(out.intent.kind).toBe('unknown');
	});
});

async function callTranscribe(bytes: Uint8Array, type: string, env: Record<string, unknown> = {}, lang = 'yue') {
	const request = new Request(`https://openmusic.lol/api/voice/transcribe?lang=${lang}`, {
		method: 'POST',
		headers: { 'content-type': type },
		body: bytes as BodyInit
	});
	const event = { request, url: new URL(request.url), platform: { env } } as unknown as Parameters<typeof transcribePOST>[0];
	const res = await transcribePOST(event);
	return { status: res.status, body: (await res.json()) as { text: string } };
}

describe('/api/voice/transcribe', () => {
	it('sends base64 audio + the Whisper language code', async () => {
		const run = vi.fn<Run>(async () => ({ text: ' 播帝女花 ' }));
		const out = await callTranscribe(new Uint8Array([1, 2, 3]), 'audio/webm', { AI: { run } });
		expect(out.body.text).toBe('播帝女花');
		const input = run.mock.calls[0][1];
		expect(input.language).toBe('yue');
		expect(input.audio).toBe(toBase64(new Uint8Array([1, 2, 3])));
	});

	it('rejects non-audio and oversized bodies', async () => {
		expect((await callTranscribe(new Uint8Array([1]), 'text/plain')).status).toBe(415);
		expect((await callTranscribe(new Uint8Array(1_600_000), 'audio/webm')).status).toBe(413);
	});

	it('AI failure → empty text', async () => {
		const run = vi.fn<Run>(async () => {
			throw new Error('down');
		});
		expect((await callTranscribe(new Uint8Array([1]), 'audio/mp4', { AI: { run } })).body.text).toBe('');
	});
});

describe('voice-ai helpers', () => {
	it('extractJson handles object, fenced string, and junk', () => {
		expect(extractJson({ response: { a: 1 } })).toEqual({ a: 1 });
		expect(extractJson({ response: '```json\n{"a":2}\n```' })).toEqual({ a: 2 });
		expect(extractJson({ response: 'nope' })).toBeNull();
		expect(extractJson(null)).toBeNull();
	});
});
