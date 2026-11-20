import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { __resetGovernor } from '$lib/services/api-base';
import { comments, commentBadge } from './comments.svelte';

// quick-260926-pb0 — the current-track comment thread store (dedupe, supersede, count, report).

const A = { uid: 'qq:1', artist: 'Adele', title: 'Hello' };
const B = { uid: 'qq:2', artist: 'Adele', title: 'Skyfall' };
const item = (id: string) => ({ id, name: 'Frank', text: id, t: 1 });

const json = (body: unknown, status = 200) =>
	new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

const gets = (m: ReturnType<typeof vi.fn>) =>
	m.mock.calls.filter(([, init]) => ((init as RequestInit | undefined)?.method ?? 'GET') === 'GET');

beforeEach(() => {
	comments.__reset();
	__resetGovernor();
});
afterEach(() => {
	vi.unstubAllGlobals();
});

describe('commentBadge', () => {
	it('null at zero, the number up to 99, then 99+', () => {
		expect(commentBadge(0)).toBeNull();
		expect(commentBadge(-1)).toBeNull();
		expect(commentBadge(Number.NaN)).toBeNull();
		expect(commentBadge(5)).toBe('5');
		expect(commentBadge(99)).toBe('99');
		expect(commentBadge(100)).toBe('99+');
		expect(commentBadge(250)).toBe('99+');
	});
});

describe('comments store', () => {
	it('load fetches once per track and exposes items + badge', async () => {
		const fetchMock = vi.fn(async (..._a: unknown[]) => json({ ok: true, items: [item('a'), item('b')] }));
		vi.stubGlobal('fetch', fetchMock);
		comments.load(A);
		expect(comments.loading).toBe(true);
		comments.load(A); // same uid: deduped
		await vi.waitFor(() => expect(comments.loading).toBe(false));
		comments.load(A);
		expect(fetchMock).toHaveBeenCalledTimes(1);
		const [url] = fetchMock.mock.calls[0] as [string];
		expect(url).toContain(`/api/comments?k=${comments.key}`);
		expect(comments.key).toMatch(/^[0-9a-f]{32}$/);
		expect(comments.items.map((i) => i.id)).toEqual(['a', 'b']);
		expect(comments.badge).toBe('2');
		expect(comments.uid).toBe(A.uid);
	});

	it("a newer track supersedes an older reply that lands late", async () => {
		const pending: Array<(r: Response) => void> = [];
		const fetchMock = vi.fn((..._a: unknown[]) => new Promise<Response>((res) => pending.push(res)));
		vi.stubGlobal('fetch', fetchMock);
		comments.load(A);
		await vi.waitFor(() => expect(pending.length).toBe(1));
		comments.load(B);
		await vi.waitFor(() => expect(pending.length).toBe(2));
		pending[1](json({ ok: true, items: [item('b1')] }));
		await vi.waitFor(() => expect(comments.loading).toBe(false));
		pending[0](json({ ok: true, items: [item('a1'), item('a2')] }));
		for (let i = 0; i < 10; i++) await Promise.resolve();
		await new Promise((r) => setTimeout(r, 0));
		expect(comments.uid).toBe(B.uid);
		expect(comments.items.map((i) => i.id)).toEqual(['b1']);
		expect(comments.badge).toBe('1');
	});

	it('a non-ok response → unavailable, no badge', async () => {
		vi.stubGlobal('fetch', vi.fn(async () => json({ ok: false }, 500)));
		comments.load(A);
		await vi.waitFor(() => expect(comments.loading).toBe(false));
		expect(comments.unavailable).toBe(true);
		expect(comments.items).toEqual([]);
		expect(comments.badge).toBeNull();
	});

	it('replace swaps the thread synchronously', async () => {
		vi.stubGlobal('fetch', vi.fn(async () => json({ ok: true, items: [] })));
		comments.load(A);
		await vi.waitFor(() => expect(comments.loading).toBe(false));
		expect(comments.badge).toBeNull();
		comments.replace([item('new'), item('old')]);
		expect(comments.visible.map((i) => i.id)).toEqual(['new', 'old']);
		expect(comments.badge).toBe('2');
	});

	// quick-260926-vur: post -> song change -> return must show the new comment. The store re-fetches
	// on the way back (the uid dedupe resets on a change); what used to serve the pre-post thread was
	// the BROWSER HTTP cache honouring the GET's max-age, fixed server-side with `no-cache`.
	it('a posted comment is refetched after a song change and back', async () => {
		let thread = [item('a')];
		const fetchMock = vi.fn(async (..._a: unknown[]) => json({ ok: true, items: thread }));
		vi.stubGlobal('fetch', fetchMock);
		comments.load(A);
		await vi.waitFor(() => expect(comments.loading).toBe(false));
		expect(comments.items.map((i) => i.id)).toEqual(['a']);
		thread = [item('new'), item('a')]; // the server now holds the post
		comments.replace(thread); // the post reply
		expect(comments.items.map((i) => i.id)).toEqual(['new', 'a']);
		comments.load(B);
		await vi.waitFor(() => expect(comments.loading).toBe(false));
		comments.load(A);
		await vi.waitFor(() => expect(comments.loading).toBe(false));
		expect(gets(fetchMock)).toHaveLength(3); // A, B, A
		expect(comments.uid).toBe(A.uid);
		expect(comments.items.map((i) => i.id)).toEqual(['new', 'a']);
	});

	it('report hides locally, drops the count and POSTs the report', async () => {
		const fetchMock = vi.fn(async (..._a: unknown[]) => json({ ok: true, items: [item('a'), item('b')] }));
		vi.stubGlobal('fetch', fetchMock);
		comments.load(A);
		await vi.waitFor(() => expect(comments.loading).toBe(false));
		comments.report('a');
		expect(comments.visible.map((i) => i.id)).toEqual(['b']);
		expect(comments.badge).toBe('1');
		await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));
		const [url, init] = fetchMock.mock.calls[1] as [string, RequestInit];
		expect(url.endsWith('/api/comments')).toBe(true);
		expect(init.method).toBe('POST');
		expect(JSON.parse(init.body as string)).toEqual({ k: comments.key, id: 'a', action: 'report' });
		expect(gets(fetchMock)).toHaveLength(1);
	});

	it('__reset clears every field', async () => {
		vi.stubGlobal('fetch', vi.fn(async () => json({ ok: true, items: [item('a')] })));
		comments.load(A);
		await vi.waitFor(() => expect(comments.loading).toBe(false));
		comments.report('a');
		comments.__reset();
		expect(comments.uid).toBeNull();
		expect(comments.key).toBeNull();
		expect(comments.items).toEqual([]);
		expect(comments.loading).toBe(false);
		expect(comments.unavailable).toBe(false);
		expect(comments.reported).toEqual([]);
		expect(comments.badge).toBeNull();
	});
});
