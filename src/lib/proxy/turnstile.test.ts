// turnstile — server-side siteverify gate for comment posting (quick-260926-nsz). The fetch is
// injected, so nothing here touches the network.

import { describe, expect, it, vi } from 'vitest';
import { verifyTurnstile, parseHostnames, SITEVERIFY_URL } from './turnstile';

const HOSTS = new Set(['openmusic.lol']);
const args = (o: Partial<Parameters<typeof verifyTurnstile>[0]> = {}) => ({
	token: 'tok',
	ip: '1.2.3.4',
	secret: 'sekret',
	hostnames: HOSTS,
	expectedAction: 'comment',
	...o
});
const reply = (body: unknown, status = 200) =>
	vi.fn(async (..._a: unknown[]) => new Response(JSON.stringify(body), { status }));
const pass = { success: true, hostname: 'openmusic.lol', action: 'comment' };

describe('parseHostnames', () => {
	it('splits a comma list, trims, lowercases and drops blanks', () => {
		expect([...parseHostnames(' openmusic.lol, LOCALHOST ,,127.0.0.1 ')]).toEqual([
			'openmusic.lol',
			'localhost',
			'127.0.0.1'
		]);
		expect(parseHostnames(undefined).size).toBe(0);
		expect(parseHostnames('  ,  ').size).toBe(0);
	});
});

describe('verifyTurnstile', () => {
	it('ok: posts secret/response/remoteip form-encoded to siteverify', async () => {
		const f = reply(pass);
		expect(await verifyTurnstile(args(), f)).toBe('ok');
		expect(f).toHaveBeenCalledTimes(1);
		const [url, init] = f.mock.calls[0] as [string, RequestInit];
		expect(url).toBe(SITEVERIFY_URL);
		expect(init.method).toBe('POST');
		expect(init.signal).toBeInstanceOf(AbortSignal);
		const form = new URLSearchParams(init.body as URLSearchParams);
		expect(form.get('secret')).toBe('sekret');
		expect(form.get('response')).toBe('tok');
		expect(form.get('remoteip')).toBe('1.2.3.4');
	});

	it('unconfigured: no secret or an empty allowlist — and siteverify is never called', async () => {
		for (const o of [{ secret: undefined }, { secret: '' }, { hostnames: new Set<string>() }]) {
			const f = reply(pass);
			expect(await verifyTurnstile(args(o), f)).toBe('unconfigured');
			expect(f).not.toHaveBeenCalled();
		}
	});

	it('rejected: success false, action mismatch, hostname mismatch', async () => {
		for (const body of [
			{ ...pass, success: false, 'error-codes': ['invalid-input-response'] },
			{ ...pass, action: 'login' },
			{ ...pass, action: undefined },
			{ ...pass, hostname: 'evil.example' },
			{ ...pass, hostname: undefined }
		]) {
			expect(await verifyTurnstile(args(), reply(body))).toBe('rejected');
		}
	});

	it('rejected: non-2xx, non-JSON, a network error or a timeout', async () => {
		expect(await verifyTurnstile(args(), reply(pass, 500))).toBe('rejected');
		expect(await verifyTurnstile(args(), vi.fn(async () => new Response('not json')))).toBe('rejected');
		expect(await verifyTurnstile(args(), vi.fn(async () => Promise.reject(new TypeError('network'))))).toBe('rejected');
		const timeout = vi.fn(async () => Promise.reject(new DOMException('timed out', 'TimeoutError')));
		expect(await verifyTurnstile(args(), timeout)).toBe('rejected');
	});
});
