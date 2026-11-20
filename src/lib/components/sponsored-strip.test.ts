import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

// quick-261119-tiponly (Hector 2026-11-19) — STRUCTURAL gate for the tip-jar-only
// support rail. Hector cancelled EVERY referral sponsor (all six are named in
// the ban lists below — this file is the one place they may still appear) and
// the "Sponsored" label itself: the only element
// left is his own ☕ Tip jar pill, mounted inside the Home header row so Home's
// top takes one row only. This gate keeps the referrals from quietly drifting
// back — the same source-reading technique as settings-ui.test.ts /
// free-page.test.ts (Vitest here has NO jsdom, so components cannot render).

const read = (p: string) => readFileSync(p, 'utf-8');
/** Assert against CODE, not prose: the components DOCUMENT the cancellation and
 *  name the cancelled sponsors in their decision comments, so comments are
 *  stripped before the referral/label assertions (a comment can never satisfy
 *  or trip the gate). The whole-src referral walk below is the exception: it
 *  reads RAW text, and its allowlist is exactly the decision-record comments. */
function stripComments(src: string): string {
	return src
		.replace(/<!--[\s\S]*?-->/g, '')
		.replace(/\/\*[\s\S]*?\*\//g, '')
		.split('\n')
		.filter((l) => !/^\s*\/\//.test(l))
		.join('\n');
}

const STRIP = 'src/lib/components/SponsoredStrip.svelte';
const CONFIG = 'src/lib/config/sponsored.ts';
const HOME = 'src/routes/(app)/+page.svelte';

describe('tip-jar-only rail (quick-261119-tiponly)', () => {
	const strip = stripComments(read(STRIP));
	const config = stripComments(read(CONFIG));

	it('the component renders ONE element: the gold ☕ Tip jar pill', () => {
		expect(strip).toContain('☕ Tip jar');
		expect(strip).toContain('#F0A832');
		expect(strip).toContain('TIP_JAR_URL');
		expect(strip).toMatch(/target="_blank"/);
		expect(strip).toMatch(/rel="noopener"/);
		// Exactly one anchor in the whole component.
		expect([...strip.matchAll(/<a[\s>]/g)]).toHaveLength(1);
	});

	it('tracks the click as tip_jar_opened from the header', () => {
		expect(strip).toContain("track('tip_jar_opened', { location: 'header' })");
	});

	it('has NO "Sponsored" disclosure label and no scroll-row layout', () => {
		expect(strip).not.toContain('class="disclosure"');
		expect(strip).not.toContain('aria-label="Sponsored"');
		expect(strip).not.toContain('overflow-x');
		expect(strip).not.toContain('sponsored ?');
	});

	it('still honours the Settings → Supporter hide toggle (SPONSORED_HIDE_KEY)', () => {
		expect(strip).toContain('SPONSORED_HIDE_KEY');
		expect(strip).toMatch(/localStorage\.getItem\(SPONSORED_HIDE_KEY\) === '1'/);
		expect(strip).toContain('hasTipJarLink()');
	});

	it('the config holds NO referral URLs or referral helpers any more', () => {
		for (const gone of [
			'WISE_URL',
			'COINBASE_URL',
			'BINANCE_URL',
			'AIRALO_URL',
			'KOINLY_URL',
			'AIRWALLEX_URL',
			'hasAnySponsorLink',
			'hasWiseLink',
			'hasCoinbaseLink',
			'hasBinanceLink',
			'hasAiraloLink',
			'hasKoinlyLink',
			'hasAirwallexLink'
		]) {
			expect(config, gone).not.toContain(gone);
		}
		// …while the supporter machinery the config also owns stays untouched.
		for (const kept of [
			'TIP_JAR_URL',
			'GUMROAD_PRODUCT_PERMALINK',
			'ADMIN_KEY_SHA256',
			'SUPPORTER_KEY',
			'SPONSORED_HIDE_KEY',
			'TIP_LICENSE_KEY',
			'export function isSupporter()',
			'SUPPORTER_TIERS'
		]) {
			expect(config, kept).toContain(kept);
		}
	});

	it('Home mounts the pill INSIDE the header row, next to the gear — no strip row below it', () => {
		const home = read(HOME);
		const headerOpen = home.indexOf('<header class="topnav">');
		const headerClose = home.indexOf('</header>');
		const mount = home.indexOf('<SponsoredStrip />');
		expect(headerOpen).toBeGreaterThan(-1);
		expect(mount).toBeGreaterThan(headerOpen);
		expect(mount).toBeLessThan(headerClose);
		// The gear lives in the same right-side cluster.
		const cluster = home.slice(headerOpen, headerClose);
		expect(cluster).toContain('class="top-actions"');
		expect(cluster).toContain('class="gear"');
		// Exactly one mount on the page.
		expect([...home.matchAll(/<SponsoredStrip \/>/g)]).toHaveLength(1);
	});

	it(
		'no referral sponsor names survive anywhere in src (raw — comments included)',
		() => {
			// RAW text on purpose, matching the task's own gate
			// (`grep -rnw "Wise|Coinbase|Binance" src` returns nothing): the
			// production decision comments deliberately do NOT name the cancelled
			// sponsors, so even a comment reintroducing one fails here. This file
			// is the single exception — it holds the ban list itself.
			const banned = ['Wise', 'Coinbase', 'Binance', 'Airalo', 'Koinly', 'Airwallex'];
			const files: string[] = [];
			const walk = (dir: string) => {
				for (const name of readdirSync(dir)) {
					const p = join(dir, name);
					if (statSync(p).isDirectory()) walk(p);
					else if (/\.(ts|svelte)$/.test(name)) files.push(p);
				}
			};
			walk('src');
			expect(files.length).toBeGreaterThan(100);
			for (const f of files) {
				if (f.endsWith('sponsored-strip.test.ts')) continue;
				const raw = read(f);
				for (const b of banned) {
					expect(raw, `${f} must not mention ${b}`).not.toContain(b);
				}
			}
		},
		// The walk reads every source file once; on this slow shared FS that
		// legitimately takes longer than the 5s default test timeout.
		30_000
	);
});
