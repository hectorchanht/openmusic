import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { BRIDGE_PATH, BRIDGE_MSG, bridgeOrigin, parseBridgeMessage } from '$lib/services/turnstile-bridge';
import { BRIDGE_PAGE_HTML, BRIDGE_ACTION } from '$lib/proxy/turnstile-bridge-page';
import { GET } from '../../routes/turnstile-bridge/+server';
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

	it('BRIDGE_PATH is the bridge route (not a .html — Pages 308s those to a 404)', () => {
		expect(BRIDGE_PATH).toBe('/turnstile-bridge');
	});
});

// quick-260926-ot5: the bridge is served by src/routes/turnstile-bridge/+server.ts from a page built
// out of the app's own constants; these pin what the page and its headers must contain.
describe('bridge page + route', () => {
	const html = BRIDGE_PAGE_HTML;

	it('uses the app sitekey and the server action', () => {
		expect(html).toContain(TURNSTILE_SITEKEY);
		expect(BRIDGE_ACTION).toBe('comment');
		expect(html).toContain(`action: "comment"`);
		expect(html).toContain('render=explicit');
	});

	it('allowlists both WebView origins and speaks every protocol message', () => {
		expect(html).toContain('"https://localhost"');
		expect(html).toContain('"capacitor://localhost"');
		for (const v of Object.values(BRIDGE_MSG)) expect(html).toContain(v);
	});

	it('has no star literal (never a wildcard postMessage target)', () => {
		expect(html).not.toContain("'*'");
		expect(html).not.toContain('"*"');
	});

	it('GET /turnstile-bridge serves the page with frame-ancestors limited to the WebView origins', async () => {
		// eslint-disable-next-line @typescript-eslint/no-explicit-any
		const res = await GET({} as any);
		expect(res.status).toBe(200);
		expect(res.headers.get('content-type')).toContain('text/html');
		expect(res.headers.get('Content-Security-Policy')).toBe('frame-ancestors https://localhost capacitor://localhost');
		expect(res.headers.get('X-Robots-Tag')).toBe('noindex');
		expect(await res.text()).toBe(BRIDGE_PAGE_HTML);
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
