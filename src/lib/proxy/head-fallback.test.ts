import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { rewriteSiteFallback, FALLBACK_START, FALLBACK_END } from './head-fallback';

const appHtml = readFileSync(new URL('../../app.html', import.meta.url), 'utf8');
const render = (head: string) => appHtml.replace('%sveltekit.head%', head);

const PAGE_OG =
	'<meta property="og:type" content="music.song"/><meta property="og:url" content="https://openmusic.pages.dev/song/A/B"/><title>B • A</title>';

describe('rewriteSiteFallback (quick-261122-pageog)', () => {
	it('app.html carries exactly one marked fallback block after the head placeholder', () => {
		expect(appHtml.split(FALLBACK_START)).toHaveLength(2);
		expect(appHtml.split(FALLBACK_END)).toHaveLength(2);
		expect(appHtml.indexOf('%sveltekit.head%')).toBeLessThan(appHtml.indexOf(FALLBACK_START));
	});

	it('drops the whole static block on an SSR entity page that emitted per-page OG', () => {
		const out = rewriteSiteFallback(render(PAGE_OG), 'https://openmusic.pages.dev');
		expect(out.match(/property="og:url"/g)).toHaveLength(1);
		expect(out.match(/property="og:type"/g)).toHaveLength(1);
		expect(out.match(/<title>[^<]*<\/title>/g)).toHaveLength(1);
		expect(out).not.toContain('content="https://openmusic.lol/"');
		expect(out).not.toContain('<link rel="canonical" href="https://openmusic.lol/"');
		expect(out).not.toContain(FALLBACK_START);
	});

	it('shell page on a mirror: rebases og:url/og:image/twitter:image, keeps canonical on primary', () => {
		const out = rewriteSiteFallback(render(''), 'https://openmusic.pages.dev');
		expect(out).toContain('<meta property="og:url" content="https://openmusic.pages.dev/" />');
		expect(out).toContain('<meta property="og:image" content="https://openmusic.pages.dev/og.jpg" />');
		expect(out).toContain('<meta name="twitter:image" content="https://openmusic.pages.dev/og.jpg" />');
		expect(out).toContain('<link rel="canonical" href="https://openmusic.lol/" />');
		expect(out).toContain('"url":"https://openmusic.lol/"');
		expect(out.match(/<title>[^<]*<\/title>/g)).toHaveLength(1);
	});

	it('shell page on the primary origin is byte-identical', () => {
		const html = render('');
		expect(rewriteSiteFallback(html, 'https://openmusic.lol')).toBe(html);
	});

	it('never rebases onto a non-web origin', () => {
		const html = render('');
		expect(rewriteSiteFallback(html, 'null')).toBe(html);
		expect(rewriteSiteFallback(html, 'https://evil.example/"><script>')).toBe(html);
	});

	it('leaves chunks without a complete marked block untouched', () => {
		expect(rewriteSiteFallback('<p>hi</p>', 'https://x.dev')).toBe('<p>hi</p>');
		const partial = `<head>${FALLBACK_START}<title>t</title>`;
		expect(rewriteSiteFallback(partial, 'https://x.dev')).toBe(partial);
	});
});
