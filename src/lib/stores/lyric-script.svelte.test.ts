import { describe, it, expect, vi, beforeEach } from 'vitest';

// quick-260919-2jo (follow-up) — the Chinese script lock reaches LYRICS.
//
// The bug this pins: 2jo's lock lived only at `names.resolve`, so titles/artists/meta obeyed it
// while the lyrics pane and the Nowbar line — a separate pipeline (`readLyrics` → `parseLRC`) —
// kept rendering whatever script the upstream LRC shipped.
//
// Harness note: settings is deliberately NOT mocked (unlike names.test.ts). The lock path is
// `names.zhLock` → `applyLock`, which never reaches the translate layer, so the real store is both
// usable and strictly better here — `settings.zhScript` is a genuine `$state`, which is what lets
// the LIVE-REPAINT test below prove the "applies instantly" half of the requirement instead of
// assuming it. translate stays mocked purely to assert the lock makes NO network call.
vi.mock('$app/environment', () => ({ browser: true }));

const translateMock = vi.fn();
vi.mock('$lib/services/translate', () => ({
	translateLinesEx: (...a: unknown[]) => translateMock(...a)
}));

const memStore = new Map<string, string>();
vi.stubGlobal('localStorage', {
	get length() {
		return memStore.size;
	},
	clear: () => memStore.clear(),
	getItem: (k: string) => (memStore.has(k) ? (memStore.get(k) as string) : null),
	key: (i: number) => Array.from(memStore.keys())[i] ?? null,
	removeItem: (k: string) => void memStore.delete(k),
	setItem: (k: string, v: string) => void memStore.set(k, String(v))
} satisfies Storage);

/** Warm one direction's dict on the SAME module instance the freshly-reset store holds. */
async function warmLock(target: 'zh-Hant' | 'zh-Hans'): Promise<void> {
	const zh = await import('$lib/services/zh-convert');
	await zh.warmScript(target);
}

/** Fresh module graph + the lock set to `script`, warmed. */
async function load(script: 'off' | 'zh-Hant' | 'zh-Hans') {
	const mod = await import('./lyric-script.svelte');
	const { settings } = await import('$lib/stores/settings.svelte');
	settings.zhScript = script;
	if (script !== 'off') await warmLock(script);
	else await warmLock('zh-Hans');
	return { ...mod, settings };
}

const LRC = '[00:00.00]難忘的一天\n[00:05.50]頭髮亂了\n[00:09.00]Man I Need\n[00:12.00]さくらの唄';

beforeEach(() => {
	translateMock.mockReset();
	memStore.clear();
	vi.resetModules();
});

describe('parseLyrics — the lyric script lock seam', () => {
	it("'off' is byte-for-byte identical (D-1 — the no-surprise default)", async () => {
		const { parseLyrics } = await load('off');
		expect(parseLyrics(LRC).map((l) => l.text)).toEqual([
			'難忘的一天',
			'頭髮亂了',
			'Man I Need',
			'さくらの唄'
		]);
	});

	it("'zh-Hans' re-scripts Traditional lyrics — the reported bug", async () => {
		const { parseLyrics } = await load('zh-Hans');
		const out = parseLyrics(LRC).map((l) => l.text);
		expect(out[0]).toBe('难忘的一天');
		expect(out[1]).toBe('头发乱了'); // phrase-level, not char-only
		expect(out[2]).toBe('Man I Need'); // English untouched
		expect(out[3]).toBe('さくらの唄'); // kana ⇒ ja ⇒ never converted
		expect(translateMock).not.toHaveBeenCalled(); // offline conversion, never the API path
	});

	it("'zh-Hant' mirrors it", async () => {
		const { parseLyrics } = await load('zh-Hant');
		expect(parseLyrics('[00:01.00]难忘的一天')[0].text).toBe('難忘的一天');
	});

	it('preserves timestamps, ordering and the splitParenLines contract downstream', async () => {
		const { parseLyrics } = await load('zh-Hans');
		const { splitParenLines } = await import('$lib/services/lrc');
		const lines = splitParenLines(parseLyrics('[00:03.20]頭髮亂了 (Messy hair)'));
		expect(lines.map((l) => [l.time, l.text, l.fromParen ?? false])).toEqual([
			[3.2, '头发乱了', false],
			[3.2, 'Messy hair', true]
		]);
	});

	it('is null/empty safe (no lyrics, instrumental, unsynced plain text)', async () => {
		const { parseLyrics } = await load('zh-Hans');
		expect(parseLyrics(null)).toEqual([]);
		expect(parseLyrics(undefined)).toEqual([]);
		expect(parseLyrics('')).toEqual([]);
		expect(parseLyrics('頭髮亂了')).toEqual([]); // no timestamp ⇒ parseLRC drops it
	});

	it('degrades to the ORIGINAL text while the dict is still cold (never blank)', async () => {
		const { parseLyrics } = await import('./lyric-script.svelte');
		const { settings } = await import('$lib/stores/settings.svelte');
		settings.zhScript = 'zh-Hans'; // deliberately NOT warmed
		expect(parseLyrics('[00:01.00]難忘的一天')[0].text).toBe('難忘的一天');
	});
});

describe('lockLyricLines — the translation column', () => {
	it('locks positionally and leaves non-Chinese alone', async () => {
		const { lockLyricLines } = await load('zh-Hans');
		expect(lockLyricLines(['難忘的一天', 'Man I Need', ''])).toEqual([
			'难忘的一天',
			'Man I Need',
			''
		]);
	});

	it('is a no-op while the lock is off', async () => {
		const { lockLyricLines } = await load('off');
		expect(lockLyricLines(['難忘的一天'])).toEqual(['難忘的一天']);
	});
});

// The "instantly" half of the requirement: flipping the setting must repaint lyrics that are
// ALREADY on screen (a playing song with the pane open), with no reload and no track change. Both
// components call parseLyrics inside a `$derived`, so this reproduces that exact shape and asserts
// the derived actually invalidates — rather than assuming the dependency was taken.
describe('live repaint — flipping the setting invalidates a mounted $derived', () => {
	it('re-derives lyrics in place on every flip, in both directions', async () => {
		const { parseLyrics } = await import('./lyric-script.svelte');
		const { settings } = await import('$lib/stores/settings.svelte');
		await warmLock('zh-Hant');
		await warmLock('zh-Hans');

		const src = '[00:01.00]難忘的一天';
		const rendered = $derived(parseLyrics(src).map((l) => l.text).join(''));
		// Read through a closure: a bare `rendered` outside a reactive context trips the compiler's
		// state_referenced_locally warning (it cannot see that each read is a fresh one).
		const read = () => rendered;

		settings.zhScript = 'off';
		expect(read()).toBe('難忘的一天');
		settings.zhScript = 'zh-Hans';
		expect(read()).toBe('难忘的一天'); // repaints without re-parsing a new track
		settings.zhScript = 'zh-Hant';
		expect(read()).toBe('難忘的一天');
		settings.zhScript = 'off';
		expect(read()).toBe('難忘的一天');
	});
});
