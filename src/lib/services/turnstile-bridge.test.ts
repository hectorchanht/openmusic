import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { BRIDGE_PATH, BRIDGE_MSG, bridgeOrigin, parseBridgeMessage } from '$lib/services/turnstile-bridge';
import { TURNSTILE_SITEKEY } from '$lib/services/turnstile-widget';
// Test-only import: the client parser hard-codes the cap so no proxy code enters the bundle.
import { TOKEN_MAX } from '$lib/proxy/comments';

describe('parseBridgeMessage', () => {
	it('accepts a token message', () => {
		expect(parseBridgeMessage({ type: 'om-ts-token', token: 'abc' })).toEqual({ type: 'om-ts-token', token: 'abc' });
	});

	it('rejects an empty, oversized or non-string token; accepts exactly the cap', () => {
		expect(parseBridgeMessage({ type: 'om-ts-token', token: '' })).toBeNull();
		expect(parseBridgeMessage({ type: 'om-ts-token', token: 'x'.repeat(2049) })).toBeNull();
		expect(parseBridgeMessage({ type: 'om-ts-token', token: 'x'.repeat(2048) })).toEqual({
			type: 'om-ts-token',
			token: 'x'.repeat(2048)
		});
		expect(parseBridgeMessage({ type: 'om-ts-token', token: 42 })).toBeNull();
		expect(parseBridgeMessage({ type: 'om-ts-token' })).toBeNull();
	});

	it('accepts a clear message', () => {
		expect(parseBridgeMessage({ type: 'om-ts-clear' })).toEqual({ type: 'om-ts-clear' });
	});

	it('rejects parent-bound echoes, unknown types and junk', () => {
		for (const d of [{ type: 'om-ts-hello' }, { type: 'om-ts-reset' }, { type: 'nope' }, 'om-ts-token', null, undefined]) {
			expect(parseBridgeMessage(d)).toBeNull();
		}
	});

	it('caps the token at the server TOKEN_MAX', () => {
		expect(TOKEN_MAX).toBe(2048);
		expect(parseBridgeMessage({ type: 'om-ts-token', token: 'x'.repeat(TOKEN_MAX) })).not.toBeNull();
		expect(parseBridgeMessage({ type: 'om-ts-token', token: 'x'.repeat(TOKEN_MAX + 1) })).toBeNull();
	});
});

describe('bridgeOrigin', () => {
	it('returns the origin of a base url, null for empty or unparseable', () => {
		expect(bridgeOrigin('https://openmusic.lol')).toBe('https://openmusic.lol');
		expect(bridgeOrigin('https://openmusic.lol/')).toBe('https://openmusic.lol');
		expect(bridgeOrigin('')).toBeNull();
		expect(bridgeOrigin('not a url')).toBeNull();
	});

	it('BRIDGE_PATH is the static bridge page', () => {
		expect(BRIDGE_PATH).toBe('/turnstile-bridge.html');
	});
});

// Drift guard: the standalone html cannot import, so its constants are pinned here.
describe('bridge page drift guard', () => {
	const html = readFileSync('static/turnstile-bridge.html', 'utf-8');

	it('uses the app sitekey and the server action', () => {
		expect(html).toContain(TURNSTILE_SITEKEY);
		expect(html).toMatch(/action['"]?\s*:\s*['"]comment['"]/);
		expect(html).toContain('render=explicit');
	});

	it('allowlists both WebView origins and speaks every protocol message', () => {
		expect(html).toContain('https://localhost');
		expect(html).toContain('capacitor://localhost');
		for (const v of Object.values(BRIDGE_MSG)) expect(html).toContain(v);
	});

	it('has no star literal (never a wildcard postMessage target)', () => {
		expect(html).not.toContain("'*'");
		expect(html).not.toContain('"*"');
	});

	it('_headers restricts framing of the bridge to the WebView origins', () => {
		const headers = readFileSync('_headers', 'utf-8');
		expect(headers).toMatch(
			/^\/turnstile-bridge\.html\n(?:[ \t]+.*\n)*?[ \t]+Content-Security-Policy:\s*frame-ancestors https:\/\/localhost capacitor:\/\/localhost/m
		);
	});
});

describe('NpComments wiring', () => {
	const svelte = readFileSync('src/lib/components/NpComments.svelte', 'utf-8');

	it('frames the bridge and accepts messages only from its own iframe', () => {
		expect(svelte).toContain('BRIDGE_PATH');
		expect(svelte).toContain('parseBridgeMessage(');
		expect(svelte).toContain('contentWindow');
		expect(svelte).toContain('BRIDGE_MSG.reset');
	});

	it('no longer ships the web-only note and never posts to a wildcard', () => {
		expect(svelte).not.toContain('postOnWeb');
		expect(svelte).not.toContain("'*'");
		expect(readFileSync('src/lib/i18n/en.ts', 'utf-8')).not.toContain('comments.postOnWeb');
	});
});
