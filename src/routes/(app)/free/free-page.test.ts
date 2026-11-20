import { describe, it, expect } from 'vitest';
import { readFileSync, existsSync } from 'node:fs';
import en from '$lib/i18n/en';

// quick-261118-free — STRUCTURAL gate for the /free showcase page, the Home band and the footer
// link. Vitest here is ONE node project with NO jsdom, so a Svelte component cannot be rendered;
// like settings-ui.test.ts, these assertions read SOURCE (comments stripped, so a comment that
// mentions a rule can never satisfy or trip it) plus the en dictionary the page renders from.

const read = (p: string) => readFileSync(p, 'utf-8');
function stripComments(src: string): string {
	return src
		.replace(/<!--[\s\S]*?-->/g, '')
		.replace(/\/\*[\s\S]*?\*\//g, '')
		.split('\n')
		.filter((l) => !/^\s*\/\//.test(l))
		.join('\n');
}

const FREE = 'src/routes/(app)/free/+page.svelte';
const HOME = 'src/routes/(app)/+page.svelte';
const BAND = 'src/lib/components/FreeBand.svelte';

describe('/free page', () => {
	const code = stripComments(read(FREE));

	it('renders every key section', () => {
		for (const s of ['hero', 'everything', 'show', 'account', 'honest', 'flex', 'compare', 'gateway', 'share', 'data']) {
			expect(code, `section ${s}`).toContain(`data-section="${s}"`);
		}
	});

	it('every free.* key it uses exists in en (strings go through t())', () => {
		const used = [...code.matchAll(/'(free\.[\w.]+)'/g)].map((m) => m[1]);
		expect(used.length).toBeGreaterThan(30);
		for (const k of used) expect(en, k).toHaveProperty(k);
	});

	it('See for yourself: the three real screenshots, settings first, lazy + sized, and on disk', () => {
		const order = ['shot-settings-top.webp', 'shot-settings-scroll.webp', 'shot-home.webp'];
		const at = order.map((f) => code.indexOf(`'/show/${f}'`));
		for (const i of at) expect(i).toBeGreaterThan(-1);
		expect(at).toEqual([...at].sort((a, b) => a - b));
		expect(code).toMatch(/<img src=\{s\.src\} alt=\{t\(s\.alt\)\} width="2560" height="1600" loading="lazy"/);
		expect(code).toContain('<figcaption>{t(s.caption)}</figcaption>');
		for (const f of order) expect(existsSync(`static/show/${f}`), f).toBe(true);
	});

	it('links the open-source repo and the Dawn Studio gateway', () => {
		expect(code).toContain('OPENMUSIC_REPO_URL');
		expect(code).toContain('DAWN_GATEWAY_URL');
	});

	it('shares on WhatsApp ONLY — no public-social share buttons', () => {
		expect(code).toContain('whatsappShareUrl');
		for (const banned of ['reddit', 'twitter', 'x.com', 'facebook', 'threads.net', 'telegram']) {
			expect(code.toLowerCase(), banned).not.toContain(banned);
		}
	});

	it('never mentions Discord (Hector standing rule) — page, band or any free.* string', () => {
		expect(read(FREE).toLowerCase()).not.toContain('discord');
		expect(read(BAND).toLowerCase()).not.toContain('discord');
		for (const [k, v] of Object.entries(en)) {
			if (k.startsWith('free.')) expect(v.toLowerCase(), k).not.toContain('discord');
		}
	});

	it('copy stays honest: resume scope matches the code, radio is not called AI, no invented prices', () => {
		const free = Object.entries(en).filter(([k]) => k.startsWith('free.'));
		const all = free.map(([, v]) => v).join('\n');
		// No account: resume is local. Signed in: the xdresume player sync family (quick-261118-freeresume)
		// — listed under the ACCOUNT, with its real limits (never mid-song, newest wins, switchable).
		expect(en['free.item.resume']).toMatch(/this device/);
		expect(code).toContain("'free.account.nowPlaying'");
		expect(en['free.account.nowPlaying']).toMatch(/another device/);
		expect(en['free.accountNote']).toMatch(/never while music is playing/);
		expect(en['free.accountNote']).toMatch(/most recently played device wins/);
		expect(all).not.toMatch(/doesn't follow you across devices/);
		expect(en['free.item.radio']).toMatch(/no AI model/);
		// Only the one brief-supplied running-cost figure; the comparison stays qualitative.
		const money = all.match(/\$\s?\d+/g) ?? [];
		expect(money).toEqual(['$5']);
	});
});

describe('Home "Free forever" band', () => {
	// Home is read RAW: its markup holds `/*` inside strings, which the naive comment stripper
	// would treat as a block-comment start. The asserted strings never occur in its comments.
	const home = read(HOME);
	const band = stripComments(read(BAND));

	it('the band links to /free', () => {
		expect(band).toMatch(/<a[^>]*href="\/free"/);
		expect(band).toContain("t('free.bandTitle')");
	});

	it('renders right AFTER the first shelf block inside the section loop — never above it', () => {
		expect(home).toContain("import FreeBand from '$lib/components/FreeBand.svelte'");
		const loop = home.indexOf('{#each resolveSectionOrder(settings.homeSectionOrder) as id (id)}');
		const lastBlock = home.indexOf("{:else if id === 'regions'}{@render regionsBlock()}");
		const bandInLoop = home.indexOf('{#if id === firstShelf}<FreeBand />{/if}');
		expect(loop).toBeGreaterThan(-1);
		expect(bandInLoop).toBeGreaterThan(lastBlock); // after the shelf's {@render}, same iteration
		expect(home).toMatch(/const firstShelf = \$derived\(\s*firstShelfId\(/);
	});

	it('is not at the top of Home: the tip-jar pill in the header, search pill and Top picks header all come first', () => {
		const firstBand = home.indexOf('<FreeBand />');
		expect(home.indexOf('<SponsoredStrip />')).toBeLessThan(firstBand);
		expect(home.indexOf("t('home.topPicks')")).toBeLessThan(firstBand);
	});

	it('the D-06 fallback grid (the only shelf in that mode) is followed by the band too', () => {
		const grid = home.indexOf('{#each fallbackSongs as track (track.uid)}');
		const after = home.indexOf('<FreeBand />', grid);
		const nextBranch = home.indexOf('{:else}', grid);
		expect(after).toBeGreaterThan(grid);
		expect(after).toBeLessThan(nextBranch);
	});
});

describe('footer link to /free', () => {
	it('Home ends with a footer that links to /free', () => {
		const home = read(HOME);
		expect(home).toMatch(/<footer class="home-footer">\s*<a href="\/free"/);
		expect(home.indexOf('<footer class="home-footer">')).toBeGreaterThan(home.indexOf('</section>'));
	});

	it('Settings → About lists /free beside the other about links', () => {
		const about = stripComments(read('src/routes/(app)/settings/about/+page.svelte'));
		expect(about).toMatch(/<a class="item link" href="\/free">/);
	});
});
