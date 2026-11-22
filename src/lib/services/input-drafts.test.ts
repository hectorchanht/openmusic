import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { readFileSync } from 'node:fs';
import {
	getInputDraft,
	setInputDraft,
	clearInputDraft,
	lyricsDraftKey,
	encodeLyricsDraft,
	decodeLyricsDraft,
	SEARCH_DRAFT,
	MAX_INPUT_DRAFTS,
	MAX_INPUT_DRAFT_CHARS
} from './input-drafts';

// GOLD RULE guard (Hector 2026-11-21, ALL Dawn products, quick-261122-rules): all user input is
// auto-cached. Every assertion is a way typed text could otherwise silently vanish.

class MemStorage {
	private m = new Map<string, string>();
	getItem(k: string): string | null {
		return this.m.has(k) ? (this.m.get(k) as string) : null;
	}
	setItem(k: string, v: string): void {
		this.m.set(k, String(v));
	}
	removeItem(k: string): void {
		this.m.delete(k);
	}
	clear(): void {
		this.m.clear();
	}
}

const g = globalThis as unknown as { localStorage?: Storage };
let saved: Storage | undefined;
beforeEach(() => {
	saved = g.localStorage;
	g.localStorage = new MemStorage() as unknown as Storage;
});
afterEach(() => {
	g.localStorage = saved;
});

describe('input drafts store', () => {
	it('round-trips a draft and keeps slots separate', () => {
		setInputDraft(SEARCH_DRAFT, '陳奕迅 富士');
		setInputDraft(lyricsDraftKey('kuwo:1'), 'x');
		expect(getInputDraft(SEARCH_DRAFT)).toBe('陳奕迅 富士');
		expect(getInputDraft(lyricsDraftKey('kuwo:1'))).toBe('x');
		expect(getInputDraft(lyricsDraftKey('kuwo:2'))).toBe('');
	});
	it('blank text clears; explicit clear clears', () => {
		setInputDraft(SEARCH_DRAFT, 'abc');
		setInputDraft(SEARCH_DRAFT, '   ');
		expect(getInputDraft(SEARCH_DRAFT)).toBe('');
		setInputDraft(SEARCH_DRAFT, 'abc');
		clearInputDraft(SEARCH_DRAFT);
		expect(getInputDraft(SEARCH_DRAFT)).toBe('');
	});
	it('an over-cap write is rejected, keeping the last good draft', () => {
		setInputDraft(SEARCH_DRAFT, 'good');
		setInputDraft(SEARCH_DRAFT, 'x'.repeat(MAX_INPUT_DRAFT_CHARS + 1));
		expect(getInputDraft(SEARCH_DRAFT)).toBe('good');
	});
	it('evicts the stalest draft past the cap; a rewrite refreshes recency', () => {
		setInputDraft(SEARCH_DRAFT, 'keep me');
		for (let i = 0; i < MAX_INPUT_DRAFTS - 1; i++) setInputDraft(lyricsDraftKey(`s:${i}`), `d${i}`);
		setInputDraft(SEARCH_DRAFT, 'keep me too'); // refresh → newest
		setInputDraft(lyricsDraftKey('s:new'), 'new');
		expect(getInputDraft(SEARCH_DRAFT)).toBe('keep me too');
		expect(getInputDraft(lyricsDraftKey('s:0'))).toBe(''); // stalest evicted
		expect(getInputDraft(lyricsDraftKey('s:new'))).toBe('new');
	});
	it('never throws on a corrupt record or missing storage; no-uid key is never a slot', () => {
		localStorage.setItem('openmusic:input-drafts:v1', '{nope');
		expect(getInputDraft(SEARCH_DRAFT)).toBe('');
		g.localStorage = undefined;
		expect(() => setInputDraft(SEARCH_DRAFT, 'x')).not.toThrow();
		expect(getInputDraft(SEARCH_DRAFT)).toBe('');
		expect(lyricsDraftKey('')).toBe('');
	});
	it('lyrics draft encode/decode round-trip; empty encodes to "" (clears the slot)', () => {
		const d = { raw: 'line one\nline two', lrc: '[00:00.00]line one\n', estimated: true };
		expect(decodeLyricsDraft(encodeLyricsDraft(d))).toEqual(d);
		expect(encodeLyricsDraft({ raw: ' ', lrc: '', estimated: false })).toBe('');
		expect(decodeLyricsDraft('garbage')).toBeNull();
		expect(decodeLyricsDraft(JSON.stringify({ raw: 1 }))).toBeNull();
	});
});

// Structural pins — the surfaces actually use the store (no jsdom in this project).
const ed = readFileSync('src/lib/components/LyricsEditor.svelte', 'utf-8');
const search = readFileSync('src/routes/(app)/search/+page.svelte', 'utf-8');

describe('surfaces wired to the auto-cache', () => {
	it('lyrics editor: restores the draft on open, persists on every edit path, clears ONLY on save', () => {
		expect(ed).toContain('decodeLyricsDraft(getInputDraft(lyricsDraftKey(track.uid)))');
		expect(ed).toMatch(/function onRawInput\(\) \{[\s\S]*?persistDraft\(\);/);
		expect(ed).toMatch(/function adjust\([\s\S]*?persistDraft\(\);/);
		expect(ed).toMatch(/lines\[i\]\.text = e\.currentTarget\.value;[^}]*persistDraft\(\)/);
		expect((ed.match(/clearInputDraft\(/g) ?? []).length).toBe(1);
		const save = ed.slice(ed.indexOf('function save()'));
		expect(save.slice(0, save.indexOf('\n\t}'))).toContain('clearInputDraft(lyricsDraftKey(track.uid))');
	});
	it('search: the box text persists on every change and comes back on mount', () => {
		expect(search).toMatch(/\$effect\(\(\) => \{\s*setInputDraft\(SEARCH_DRAFT, q\);/);
		expect(search).toContain('const savedSearchDraft = getInputDraft(SEARCH_DRAFT);');
		expect(search).toContain('q = savedSearchDraft || searchSession.q;');
		expect(search).toMatch(/else if \(savedSearchDraft\) \{[\s\S]*?q = savedSearchDraft;/);
	});
	it('the reference implementation (comment composer) is still auto-cached', () => {
		const nc = readFileSync('src/lib/components/NpComments.svelte', 'utf-8');
		expect(nc).toContain('setCommentDraft(');
	});
});
