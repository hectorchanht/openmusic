import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

// Display-name pin (Hector 2026-11-20): the public-facing brand is "OpenMusic"
// (CamelCase, first cap per word) on every user-visible surface, while
// infrastructure identifiers (openmusic.lol, openmusic:* keys, package/repo
// names) stay lowercase. This source-reading gate — the same technique as
// sponsored-strip.test.ts / free-page.test.ts (no jsdom here) — fails if a
// display surface drifts back to the retired all-lowercase wordmark.
// The wordmark styling rule pinned here too: in styled HTML UI the "Music"
// half renders in the shared accent token var(--color-primary); plain-text
// contexts stay a single "OpenMusic" string with no markup.

const read = (p: string) => readFileSync(p, 'utf-8');

describe('brand display name — OpenMusic (2026-11-20 sweep)', () => {
	it('home brand header renders the two-tone wordmark in the accent token', () => {
		const home = read('src/routes/(app)/+page.svelte');
		expect(home).toContain(
			'<span class="brand-name"><span>Open</span><span class="brand-music">Music</span></span>'
		);
		expect(home).toContain('.brand-music { color: var(--color-primary); }');
		expect(home).not.toContain('> openmusic</div>');
	});

	it('app.html shell title / PWA title / OG site name are OpenMusic', () => {
		const html = read('src/app.html');
		expect(html).toContain('<title>OpenMusic — music streaming for earth</title>');
		expect(html).toContain('name="apple-mobile-web-app-title" content="OpenMusic"');
		expect(html).toContain('property="og:site_name" content="OpenMusic"');
		expect(html).toContain('"name":"OpenMusic"');
		expect(html).not.toContain('content="openmusic"');
		// …while the canonical URL stays lowercase infrastructure.
		expect(html).toContain('href="https://openmusic.lol/"');
	});

	it('root layout TITLE + og:site_name are OpenMusic', () => {
		const layout = read('src/routes/+layout.svelte');
		expect(layout).toContain('const TITLE = "OpenMusic — music streaming for earth";');
		expect(layout).toContain('property="og:site_name" content="OpenMusic"');
	});

	it('manifest name + short_name are OpenMusic', () => {
		const manifest = JSON.parse(read('static/manifest.webmanifest')) as {
			name: string;
			short_name: string;
		};
		expect(manifest.name).toBe('OpenMusic');
		expect(manifest.short_name).toBe('OpenMusic');
	});

	it('Logo + static icon aria-labels are OpenMusic', () => {
		expect(read('src/lib/components/Logo.svelte')).toContain('aria-label="OpenMusic"');
		expect(read('static/favicon.svg')).toContain('aria-label="OpenMusic"');
		expect(read('static/icon-maskable.svg')).toContain('aria-label="OpenMusic"');
	});

	it('no i18n locale carries a lowercase brand in a display string', () => {
		const dir = 'src/lib/i18n';
		for (const name of readdirSync(dir)) {
			if (!name.endsWith('.ts') || name.endsWith('.test.ts') || name === 'index.ts') continue;
			const src = read(join(dir, name));
			expect(src, `${name} · brand`).not.toContain('· openmusic');
			expect(src, `${name} aboutLine`).not.toContain('"openmusic ·');
			expect(src, `${name} aboutLine value`).not.toContain(': "openmusic');
		}
		// The English titles pin the exact suffixed form.
		const en = read('src/lib/i18n/en.ts');
		expect(en).toContain('"settings.title": "Settings · OpenMusic"');
		expect(en).toContain('"album.title": "{name} · OpenMusic"');
		expect(en).toContain('"settings.aboutLine": "OpenMusic ·');
	});

	it('share-card defaults read OpenMusic', () => {
		expect(read('src/lib/services/share.ts')).toContain("'Listen on OpenMusic'");
		expect(read('static/llms.txt')).toContain('# OpenMusic');
		expect(read('static/og.svg')).toContain('Open<tspan');
	});
});
