import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';

// quick-261120-cpost / ccount / cdraft — STRUCTURAL pins for the comments composer, in the
// track-menu-ssr.test.ts technique (no jsdom in this project, so the source is the gate).
// Hector's three orders of 2026-11-20, each a way the composer could silently regress:
//   1. Post must sit at the TOP of the composer (the on-screen keyboard covers the lower
//      composer — a Post under the textarea gets covered while typing).
//   2. The remaining-characters counter must sit INSIDE the textarea, not in the bottom bar.
//   3. An unposted comment must be wired to the per-song draft store (a track change used
//      to eat it), cleared only by Post success or explicit Cancel.
const src = readFileSync('src/lib/components/NpComments.svelte', 'utf-8');

describe('NpComments composer — Post on top, counter inside, drafts kept', () => {
	it('there is exactly one Post button', () => {
		expect(src.split('class="post"')).toHaveLength(2);
	});

	it('the Post button sits above the name input', () => {
		const post = src.indexOf('class="post"');
		const name = src.indexOf("placeholder={t('comments.namePlaceholder')}");
		expect(post).toBeGreaterThan(-1);
		expect(name).toBeGreaterThan(-1);
		expect(post).toBeLessThan(name);
	});

	it('the Post button keeps its exact disabled logic', () => {
		expect(src).toContain(
			'disabled={!text.trim() || posting || !comments.key || !token || comments.unavailable}'
		);
	});

	it('the counter renders inside the textarea wrap, after the textarea', () => {
		const wrap = src.indexOf('class="ta-wrap"');
		const area = src.indexOf('</textarea>');
		const count = src.indexOf("t('comments.remaining'");
		expect(wrap).toBeGreaterThan(-1);
		expect(area).toBeGreaterThan(wrap);
		expect(count).toBeGreaterThan(area);
	});

	it('the bottom bar holds neither the counter nor Post any more', () => {
		const barStart = src.indexOf('<div class="bar">');
		const bar = src.slice(barStart, src.indexOf('</div>', barStart));
		expect(bar).not.toContain('comments.remaining');
		expect(bar).not.toContain('class="post"');
		expect(bar).toContain('class="cancel"');
	});

	it('the composer is wired to the per-song draft store', () => {
		expect(src).toContain("from '$lib/services/comment-drafts'");
		expect(src).toContain('text = getCommentDraft(k)');
		expect(src).toContain('setCommentDraft(k, v)');
	});

	it('drafts clear only on Post success and explicit Cancel', () => {
		// import line + submit + close = at least three mentions of the clear verb
		expect(src.split('clearCommentDraft').length).toBeGreaterThanOrEqual(4);
	});
});
