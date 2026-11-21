import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import {
	getCommentDraft,
	setCommentDraft,
	clearCommentDraft,
	getCommentName,
	setCommentName
} from './comment-drafts';

// quick-261120-cdraft — Hector's rule: an unposted comment must never be lost to a track
// change. The store under test is the ONLY thing standing between a typed comment and an
// auto-advance; every assertion is a way that comment could otherwise silently vanish or
// land on the wrong song. In-memory localStorage stub, the lyric-pins.test.ts way.

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
	__raw(k: string, v: string): void {
		this.m.set(k, v);
	}
}

const DRAFT_KEY = 'openmusic:comment-drafts:v1';
const KEY_A = 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';
const KEY_B = 'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb';

describe('comment-drafts — unsent comments survive everything but Post / Cancel', () => {
	let store: MemStorage;
	const original = (globalThis as { localStorage?: Storage }).localStorage;

	beforeEach(() => {
		store = new MemStorage();
		Object.defineProperty(globalThis, 'localStorage', { value: store, configurable: true });
	});
	afterEach(() => {
		Object.defineProperty(globalThis, 'localStorage', { value: original, configurable: true });
	});

	it('saves and restores a draft per song', () => {
		setCommentDraft(KEY_A, 'this song is a masterpiece');
		expect(getCommentDraft(KEY_A)).toBe('this song is a masterpiece');
		expect(getCommentDraft(KEY_B)).toBe('');
	});

	it('never leaks one song\u2019s draft onto another', () => {
		setCommentDraft(KEY_A, 'for song A');
		setCommentDraft(KEY_B, 'for song B');
		expect(getCommentDraft(KEY_A)).toBe('for song A');
		expect(getCommentDraft(KEY_B)).toBe('for song B');
		setCommentDraft(KEY_A, 'edited for A');
		expect(getCommentDraft(KEY_B)).toBe('for song B');
	});

	it('clear-on-post: clearing removes only that song\u2019s draft', () => {
		setCommentDraft(KEY_A, 'posted!');
		setCommentDraft(KEY_B, 'still drafting');
		clearCommentDraft(KEY_A);
		expect(getCommentDraft(KEY_A)).toBe('');
		expect(getCommentDraft(KEY_B)).toBe('still drafting');
	});

	it('an emptied box is no draft — blank text removes the entry', () => {
		setCommentDraft(KEY_A, 'typed then deleted');
		setCommentDraft(KEY_A, '   ');
		expect(getCommentDraft(KEY_A)).toBe('');
		expect(store.getItem(DRAFT_KEY)).toBe('{}');
	});

	it('rejects text over the composer limit, never truncates', () => {
		setCommentDraft(KEY_A, 'x'.repeat(281));
		expect(getCommentDraft(KEY_A)).toBe('');
		setCommentDraft(KEY_A, 'x'.repeat(280));
		expect(getCommentDraft(KEY_A)).toHaveLength(280);
	});

	it('an empty thread key is always a no-op (no shared identity-less slot)', () => {
		setCommentDraft('', 'orphan');
		expect(getCommentDraft('')).toBe('');
		expect(store.getItem(DRAFT_KEY)).toBeNull();
		clearCommentDraft('');
	});

	it('corrupt storage reads as no drafts and never throws', () => {
		store.__raw(DRAFT_KEY, '{not json');
		expect(getCommentDraft(KEY_A)).toBe('');
		store.__raw(DRAFT_KEY, '["array"]');
		expect(getCommentDraft(KEY_A)).toBe('');
	});

	it('the name is global: saved once, restored for every song; empty forgets it', () => {
		expect(getCommentName()).toBe('');
		setCommentName('Hector');
		expect(getCommentName()).toBe('Hector');
		setCommentName('');
		expect(getCommentName()).toBe('');
	});
});
