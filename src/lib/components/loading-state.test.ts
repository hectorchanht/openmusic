import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';

// quick-261029-xor1 — STRUCTURAL gate for Hector's standing loading rule (2026-10-29):
// NEVER spinner + skeleton together; exactly ONE indicator per loading area — spinner
// ONLY for small elements, skeleton ONLY for long text / lists. Same source-reading
// technique as settings-ui.test.ts (no jsdom in this project, so no rendering).
const read = (p: string) => readFileSync(p, 'utf-8');

describe('loading XOR rule (quick-261029-xor1)', () => {
	it('LoadingState renders the ring ONLY in the no-lines/no-rows variant', () => {
		const src = read('src/lib/components/LoadingState.svelte');
		// The ring is inside the spinner-only conditional, never unconditional.
		expect(src).toMatch(/\{#if rows === 0 && lines === 0\}\s*<span class="ring/);
		expect(src.match(/class="ring/g) ?? []).toHaveLength(1);
		// Skeleton branches still exist for both long-content shapes.
		expect(src).toContain('class="skrows"');
		expect(src).toContain('class="sklines"');
	});

	it('NpRelated skeleton list carries no spinner element', () => {
		const src = read('src/lib/components/NpRelated.svelte');
		expect(src).not.toContain('skel-spin');
		expect(src).not.toContain('row-spinner');
		// ...but the skeleton rows themselves remain.
		expect(src).toContain('row skel');
	});
});
