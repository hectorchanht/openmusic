import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// Server-side tests for the /api/translate provider cascade (D-05 / D-06).
//
// Named `server.test.ts` (NOT `+server.test.ts`) so SvelteKit does not mistake it for a route
// module. Drives the exported POST handler with a fabricated { request, platform } and a stubbed
// global `fetch` that simulates each provider's documented response shape:
//   Azure  → [ { translations: [ { text } ] } ]
//   DeepL  → { translations: [ { text } ] }
//   Google → [ [ [translated, original], ... ] ]   (nested-array the parser expects)
//
// Coverage (plan 25-02 Task 3): (1) Azure success short-circuits before DeepL/Google;
// (2) Azure non-2xx / echo advances to DeepL; (3) no Azure/DeepL key ⇒ ONLY Google is fetched
// (skip-absent-tier); (4) all-echo/fail ⇒ originals returned with all-false flags and
// out.length === lines.length (contract preserved); (5) no provider key leaks into the body
// (T-25c-01 / T-25c-05).

import { POST } from './+server';

// A translated reply is the source text plus a provider tag so a test can prove WHICH tier
// produced the result (and that the output differs from the input — a genuine translation).
const TAG = { azure: '·az', deepl: '·dl', google: '·gg' } as const;
type Kind = keyof typeof TAG;
type Mode = 'translate' | 'echo' | 'fail';

function makeRes(ok: boolean, body: unknown): Response {
	return { ok, json: async () => body } as unknown as Response;
}

// Build the provider-specific response for a given mode. 'echo' returns the input verbatim
// (simulating Google echo-mode / a no-op translation); 'fail' is a non-2xx.
function providerBody(kind: Kind, text: string, mode: Mode): Response {
	if (mode === 'fail') return makeRes(false, {});
	const out = mode === 'echo' ? text : text + TAG[kind];
	if (kind === 'azure') return makeRes(true, [{ translations: [{ text: out, to: 'zh-Hant' }] }]);
	if (kind === 'deepl') return makeRes(true, { translations: [{ detected_source_language: 'ZH', text: out }] });
	return makeRes(true, [[[out, text]]]); // google single-segment nested array
}

const fetchMock = vi.fn();

// Which provider a fetched URL belongs to (for asserting cascade ordering / skips).
function hostOf(url: string): Kind | 'other' {
	if (url.includes('cognitive.microsofttranslator.com')) return 'azure';
	if (url.includes('api-free.deepl.com')) return 'deepl';
	if (url.includes('translate.googleapis.com')) return 'google';
	return 'other';
}
const fetchedProviders = (): Array<Kind | 'other'> =>
	fetchMock.mock.calls.map((c) => hostOf(String(c[0])));

// Route the stubbed fetch to each provider using per-test modes. A provider not listed in
// `modes` still responds benignly, but a well-behaved cascade should never fetch it — the
// tests assert on `fetchedProviders()` rather than throwing (a throw would be swallowed by the
// provider's own try/catch and hide the bug).
function wire(modes: { azure?: Mode; deepl?: Mode; google?: Mode }) {
	fetchMock.mockImplementation(async (input: unknown, init?: { body?: string }) => {
		const url = String(input);
		const host = hostOf(url);
		if (host === 'azure') {
			const text = JSON.parse(init?.body ?? '[{}]')[0]?.Text ?? '';
			return providerBody('azure', text, modes.azure ?? 'translate');
		}
		if (host === 'deepl') {
			const text = JSON.parse(init?.body ?? '{}').text?.[0] ?? '';
			return providerBody('deepl', text, modes.deepl ?? 'translate');
		}
		if (host === 'google') {
			const q = new URL(url).searchParams.get('q') ?? '';
			return providerBody('google', q, modes.google ?? 'translate');
		}
		return makeRes(false, {});
	});
}

// Invoke the POST handler with a fabricated CF request event.
async function callPost(lines: unknown, to: unknown, env?: Record<string, string>) {
	const request = { json: async () => ({ lines, to }) };
	const platform = { env: env ?? {} };
	const event = { request, platform } as unknown as Parameters<typeof POST>[0];
	return (await POST(event)) as Response;
}

beforeEach(() => {
	fetchMock.mockReset();
	vi.stubGlobal('fetch', fetchMock);
});
afterEach(() => {
	vi.restoreAllMocks();
});

describe('/api/translate provider cascade', () => {
	it('uses Azure when its key is present and does NOT fall through to DeepL/Google', async () => {
		wire({ azure: 'translate', deepl: 'translate', google: 'translate' });
		const res = await callPost(['杜国华'], 'zh-Hant', {
			AZURE_TRANSLATOR_KEY: 'az-key',
			AZURE_TRANSLATOR_REGION: 'eastasia'
		});
		const body = (await res.json()) as { translated: string[]; flags: boolean[] };
		expect(body.translated[0]).toBe('杜国华' + TAG.azure); // came from Azure
		expect(body.flags).toEqual([true]);
		expect(fetchedProviders()).toEqual(['azure']); // DeepL/Google never fetched
	});

	it('advances past an Azure non-2xx to DeepL', async () => {
		wire({ azure: 'fail', deepl: 'translate' });
		const res = await callPost(['周杰伦'], 'zh-Hant', {
			AZURE_TRANSLATOR_KEY: 'az-key',
			DEEPL_KEY: 'dl-key'
		});
		const body = (await res.json()) as { translated: string[]; flags: boolean[] };
		expect(body.translated[0]).toBe('周杰伦' + TAG.deepl); // DeepL surfaced
		expect(body.flags).toEqual([true]);
		expect(fetchedProviders()).toEqual(['azure', 'deepl']); // Google not reached
	});

	it('advances past an Azure echo (output === input) to DeepL', async () => {
		wire({ azure: 'echo', deepl: 'translate' });
		const res = await callPost(['邓紫棋'], 'zh-Hant', {
			AZURE_TRANSLATOR_KEY: 'az-key',
			DEEPL_KEY: 'dl-key'
		});
		const body = (await res.json()) as { translated: string[]; flags: boolean[] };
		expect(body.translated[0]).toBe('邓紫棋' + TAG.deepl);
		expect(fetchedProviders()).toEqual(['azure', 'deepl']);
	});

	it('skips absent tiers: with NO Azure/DeepL key, only Google is fetched', async () => {
		wire({ google: 'translate' });
		const res = await callPost(['简体'], 'zh-Hant', {}); // no provider keys
		const body = (await res.json()) as { translated: string[]; flags: boolean[] };
		expect(body.translated[0]).toBe('简体' + TAG.google); // keyless Google last-resort
		expect(body.flags).toEqual([true]);
		expect(fetchedProviders()).toEqual(['google']); // Azure/DeepL short-circuited (no fetch)
	});

	it('preserves the contract when every provider echoes/fails (originals, all-false flags, aligned length)', async () => {
		// No keys → only Google attempted; Google echoes every request (batched + per-line).
		wire({ google: 'echo' });
		const lines = ['简体一', '简体二', '简体三'];
		const res = await callPost(lines, 'zh-Hant', {});
		const body = (await res.json()) as { translated: string[]; flags: boolean[] };
		expect(body.translated).toEqual(lines); // fell back to the originals
		expect(body.flags).toEqual([false, false, false]); // nothing genuinely translated
		expect(body.translated.length).toBe(lines.length); // out.length === lines.length
		expect(body.flags.length).toBe(lines.length);
		expect(fetchedProviders().every((h) => h === 'google')).toBe(true); // absent tiers skipped
	});

	it('never leaks a provider key into the response body', async () => {
		wire({ azure: 'translate' });
		const env = {
			AZURE_TRANSLATOR_KEY: 'AZURE-SECRET-XYZ',
			AZURE_TRANSLATOR_REGION: 'eastasia',
			DEEPL_KEY: 'DEEPL-SECRET-XYZ'
		};
		const res = await callPost(['简体'], 'zh-Hant', env);
		const text = await res.text();
		expect(text).not.toContain(env.AZURE_TRANSLATOR_KEY);
		expect(text).not.toContain(env.DEEPL_KEY);
	});

	it('rejects an unknown target with the originals + all-false flags (no upstream call)', async () => {
		wire({ azure: 'translate', deepl: 'translate', google: 'translate' });
		const res = await callPost(['x', 'y'], 'klingon', { AZURE_TRANSLATOR_KEY: 'az-key' });
		const body = (await res.json()) as { translated: string[]; flags: boolean[] };
		expect(body.translated).toEqual(['x', 'y']);
		expect(body.flags).toEqual([false, false]);
		expect(fetchMock).not.toHaveBeenCalled(); // validated before any provider fetch
	});
});
