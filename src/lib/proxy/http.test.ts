import { describe, it, expect } from 'vitest';
import { corsHeaders } from './http';

describe('corsHeaders (T-01-02 — never an open relay)', () => {
	it('echoes an allowed own-origin, never `*`', () => {
		const h = corsHeaders('https://openmusic.lol');
		expect(h['Access-Control-Allow-Origin']).toBe('https://openmusic.lol');
		// the scoped origin must NOT be the wildcard
		expect(h['Access-Control-Allow-Origin']).not.toBe('*');
	});

	it('allows localhost dev origins', () => {
		expect(corsHeaders('http://localhost:5173')['Access-Control-Allow-Origin']).toBe(
			'http://localhost:5173'
		);
	});

	it('allows CF preview subdomains of openmusic.lol', () => {
		const o = 'https://abc123.openmusic.lol';
		expect(corsHeaders(o)['Access-Control-Allow-Origin']).toBe(o);
	});

	it('emits NO Access-Control-Allow-Origin for a disallowed origin (never `*` fallback)', () => {
		const h = corsHeaders('https://evil.example.com');
		expect(h['Access-Control-Allow-Origin']).toBeUndefined();
		// never falls back to wildcard for ANY value in the header map
		expect(Object.values(h)).not.toContain('*');
	});

	it('emits NO Access-Control-Allow-Origin when origin is null', () => {
		const h = corsHeaders(null);
		expect(h['Access-Control-Allow-Origin']).toBeUndefined();
		expect(Object.values(h)).not.toContain('*');
	});

	it('always sets Vary: Origin so caches do not cross-pollinate', () => {
		expect(corsHeaders('https://openmusic.lol').Vary).toBe('Origin');
	});
});
