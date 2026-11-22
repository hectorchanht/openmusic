// quick-261122-books — the Books tab's load-bearing core: turn a scatter of long-form chapter
// tracks (廣播劇 / 有聲書 / 說書) into SERIES, each sorted by its parsed chapter number.
//
// The defect this exists to prevent (Hector 2026-11-22 screenshot): search already returns a
// full page of 風雲谷 chapters, but as a flat list in upstream order — 783, 948, 95, … — which is
// unusable for a book. Every Books surface (Continue listening, the series view, Play-from-here)
// goes through the three functions below so the grouping and the order can never drift.
//
// PURE .ts: no runes, no `$app/*`, no DOM — node-testable (book-chapters.test.ts pins every
// title shape from the screenshot). Track is a type-only import.
import type { Track } from '$lib/sources/types';

/** A parsed chapter marker. `strong` = an explicit 第X集/章 (or EP / zero-padded) marker — the
 *  only kind that makes a track count as a BOOK on its own; a bare trailing number only orders
 *  chapters inside a series the track already belongs to. */
export interface ParsedChapter {
	n: number;
	strong: boolean;
	/** The title with the chapter marker removed — the series name candidate. */
	rest: string;
}

const CN_DIGIT: Record<string, number> = {
	零: 0, 〇: 0, 一: 1, 二: 2, 两: 2, 兩: 2, 三: 3, 四: 4, 五: 5, 六: 6, 七: 7, 八: 8, 九: 9
};
const CN_UNIT: Record<string, number> = { 十: 10, 百: 100, 千: 1000 };
const CN_CHARS = '零〇一二两兩三四五六七八九十百千万萬';

/**
 * Chinese numeral → number. Two shapes, both seen on CN audiobook catalogues:
 *  - STRUCTURED (has 十/百/千/万): 七百八十三 = 783, 十 = 10, 二十 = 20, 一百零五 = 105.
 *  - POSITIONAL (digits only): 七八三 = 783, 〇三五 = 35 — each char is one decimal digit.
 * null for anything else (empty, a stray non-numeral char).
 */
export function parseChineseNumber(s: string): number | null {
	if (!s) return null;
	for (const ch of s) if (!CN_CHARS.includes(ch)) return null;
	if (!/[十百千万萬]/.test(s)) {
		let n = 0;
		for (const ch of s) n = n * 10 + CN_DIGIT[ch];
		return n;
	}
	let total = 0;
	let section = 0;
	let digit = 0;
	for (const ch of s) {
		if (ch in CN_DIGIT) {
			digit = CN_DIGIT[ch];
		} else if (ch in CN_UNIT) {
			// a bare leading 十 means 1×10 (十五 = 15)
			section += (digit || 1) * CN_UNIT[ch];
			digit = 0;
		} else {
			// 万 / 萬
			total += (section + digit) * 10000;
			section = 0;
			digit = 0;
		}
	}
	return total + section + digit;
}

function toNumber(token: string): number | null {
	const t = token.replace(/\s+/g, '');
	if (/^\d+$/.test(t)) return parseInt(t, 10);
	return parseChineseNumber(t);
}

/** Tidy what is left of a title once the chapter marker is cut out: separators and empty
 *  brackets at the edges go, inner spacing collapses. */
function tidyRest(s: string): string {
	return s
		.replace(/[（(【\[]\s*[)）\]】]/g, ' ')
		.replace(/\s+/g, ' ')
		.replace(/^[\s\-–—_:：|｜·.,，、]+|[\s\-–—_:：|｜·.,，、]+$/g, '')
		.trim();
}

// 第 783 集 / 第七八三集 / 第一百零五章 / 第 0035 回 — the canonical marker. Spaces inside are
// allowed (`七界武神 - 第 944 集`).
const RE_DI = new RegExp(`第\\s*([0-9]+|[${CN_CHARS}]+)\\s*([章集回话話讲講期节節卷部篇])`);
// EP12 / Ep.12 / ep 12 / E12
const RE_EP = /\b(?:ep|e)\.?\s*(\d{1,5})\b/i;
// 783集 / 0035章 — a number glued to a unit with no 第.
const RE_UNIT = new RegExp(`(?:^|[^0-9${CN_CHARS}])([0-9]{1,5})\\s*([章集回话話讲講期节節])`);
// a zero-padded run (0035, 007) anywhere — padding is itself a chapter tell.
const RE_PADDED = /(?:^|[^0-9])(0\d{2,4})(?![0-9])/;
// a bare trailing number after a separator (`风云谷 783`, `风云谷-95`) — weak.
const RE_TRAIL = /^(.*\S)[\s\-–—_:：|｜.]+\(?(\d{2,4})\)?$/;

/**
 * Parse the chapter number out of a track title. Returns null when the title carries no
 * chapter marker at all — an ordinary song.
 *
 * Bare trailing numbers are WEAK (`strong: false`) and never 19xx/20xx (a year in a song name
 * such as "Summer 2008" must not become chapter 2008).
 */
export function parseChapter(title: string): ParsedChapter | null {
	const s = (title ?? '').trim();
	if (!s) return null;
	let m = RE_DI.exec(s);
	if (m) {
		const n = toNumber(m[1]);
		if (n != null) return { n, strong: true, rest: tidyRest(s.slice(0, m.index) + ' ' + s.slice(m.index + m[0].length)) };
	}
	m = RE_UNIT.exec(s);
	if (m) {
		const start = m.index + m[0].indexOf(m[1]);
		return { n: parseInt(m[1], 10), strong: true, rest: tidyRest(s.slice(0, start) + ' ' + s.slice(m.index + m[0].length)) };
	}
	m = RE_EP.exec(s);
	if (m) return { n: parseInt(m[1], 10), strong: true, rest: tidyRest(s.slice(0, m.index) + ' ' + s.slice(m.index + m[0].length)) };
	m = RE_PADDED.exec(s);
	if (m) {
		const start = m.index + m[0].indexOf(m[1]);
		return { n: parseInt(m[1], 10), strong: true, rest: tidyRest(s.slice(0, start) + ' ' + s.slice(start + m[1].length)) };
	}
	m = RE_TRAIL.exec(s);
	if (m && !/^(19|20)\d\d$/.test(m[2])) {
		const rest = tidyRest(m[1]);
		if (rest) return { n: parseInt(m[2], 10), strong: false, rest };
	}
	return null;
}

/** Does this track look like a chapter of a long-form book on its own (a STRONG marker)? */
export function isBookChapter(track: Pick<Track, 'title'>): boolean {
	return parseChapter(track.title)?.strong === true;
}

/** Fold for identity: case, whitespace and punctuation only. Deliberately NOT the dedupe
 *  script-fold — that one is dictionary-backed and cold on first paint, and this key is
 *  persisted (`openmusic:books:progress`), so it must be the same on every call. */
function fold(s: string): string {
	return (s || '').toLowerCase().replace(/[^\p{L}\p{N}]+/gu, '');
}

/** An album that is really "no album": empty, a placeholder, or just the title again. */
function usableAlbum(track: Pick<Track, 'album' | 'title'>): string {
	const a = (track.album ?? '').trim();
	if (!a) return '';
	if (/^(unknown|未知|-+|null|undefined)$/i.test(a)) return '';
	if (fold(a) === fold(track.title)) return '';
	// an album that itself carries a chapter marker is a per-episode label, not the series
	if (parseChapter(a)?.strong) return '';
	return a;
}

/**
 * The human series NAME — Track.album when it is a real one (CN catalogues file every chapter
 * of 風雲谷 under album 風雲谷), else the title with its chapter marker cut out.
 */
export function seriesName(track: Pick<Track, 'album' | 'title'>): string {
	const album = usableAlbum(track);
	if (album) return album;
	const p = parseChapter(track.title);
	return p?.rest || (track.title ?? '').trim();
}

/**
 * Series identity: the folded series name + the narrator (artist). Two narrators reading the
 * same book are two different series — the chapter numbering and voices don't line up.
 */
export function seriesKey(track: Pick<Track, 'album' | 'title' | 'artist'>): string {
	return `${fold(seriesName(track))}|${fold(track.artist)}`;
}

/** Chapter number for ordering, or +Infinity (unnumbered rows sink to the end, stable). */
export function chapterNumber(track: Pick<Track, 'title'>): number {
	return parseChapter(track.title)?.n ?? Number.POSITIVE_INFINITY;
}

/**
 * Ascending chapter order. Returns a NEW array; ties (and unnumbered rows) keep their input
 * order. Also collapses duplicate chapter numbers (the same chapter from two sources) to the
 * first occurrence — a book's chapter list shows each chapter once.
 */
export function sortChapters<T extends Pick<Track, 'title'>>(tracks: readonly T[]): T[] {
	const seen = new Set<number>();
	const out: T[] = [];
	const indexed = tracks.map((t, i) => ({ t, i, n: chapterNumber(t) }));
	indexed.sort((a, b) => (a.n === b.n ? a.i - b.i : a.n - b.n));
	for (const { t, n } of indexed) {
		if (Number.isFinite(n)) {
			if (seen.has(n)) continue;
			seen.add(n);
		}
		out.push(t);
	}
	return out;
}

export interface BookSeries<T> {
	key: string;
	name: string;
	narrator: string;
	/** Chapters in ascending order (sortChapters). */
	chapters: T[];
}

/**
 * Group tracks into series. Only tracks that parse as chapters join a series; a series needs
 * at least one STRONG-marker chapter (a lone `Summer 08` is a song, not a book). Series come
 * back in first-seen order — the caller's input order (search relevance, recency) is the
 * series order.
 */
export function groupSeries<T extends Pick<Track, 'album' | 'title' | 'artist'>>(
	tracks: readonly T[]
): BookSeries<T>[] {
	const groups = new Map<string, { name: string; narrator: string; items: T[]; strong: boolean }>();
	for (const t of tracks) {
		const p = parseChapter(t.title);
		if (!p) continue;
		const key = seriesKey(t);
		let g = groups.get(key);
		if (!g) {
			g = { name: seriesName(t), narrator: (t.artist ?? '').trim(), items: [], strong: false };
			groups.set(key, g);
		}
		g.items.push(t);
		if (p.strong) g.strong = true;
	}
	const out: BookSeries<T>[] = [];
	for (const [key, g] of groups) {
		if (!g.strong) continue;
		out.push({ key, name: g.name, narrator: g.narrator, chapters: sortChapters(g.items) });
	}
	return out;
}

/**
 * The SEARCH term for a series. Catalogue album strings are often marketing-stuffed
 * (`雪中悍刀行|多播剧|无删减完整版|热播剧原著|…`) and upstream search returns nothing for the
 * whole string (found live, quick-261122-books), so cut at the first list separator / bracket
 * and keep the core title. Falls back to the full name when the cut would leave nothing.
 */
export function seriesQuery(name: string): string {
	const full = (name ?? '').trim();
	const core = full
		.replace(/^[【\[（(][^】\]）)]*[】\]）)]\s*/, '')
		.split(/[|｜/／【\[（(]|\s[-–—]\s/)[0]
		.trim();
	return core || full;
}

/**
 * Play-from-here: `chapter` and every chapter AFTER it, in order. A chapter not in the list
 * (a stale progress entry) yields just the chapters numbered above it, so Continue never
 * replays earlier ones.
 */
export function chaptersFrom<T extends Pick<Track, 'title'> & { uid: string }>(
	sorted: readonly T[],
	chapter: T
): T[] {
	const i = sorted.findIndex((t) => t.uid === chapter.uid);
	if (i >= 0) return sorted.slice(i);
	const n = chapterNumber(chapter);
	return [chapter, ...sorted.filter((t) => chapterNumber(t) > n)];
}
