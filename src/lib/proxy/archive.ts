// Internet Archive edge helpers (quick-261020-arch) — shared by /api/archive/search.
//
// archive.org needs NO api key and no signing: `advancedsearch.php` finds items and
// `metadata/<identifier>` lists their files. Both shapes were live-probed from the
// VM on 2026-10-20 (see src/lib/sources/archive.ts for the source-level notes).
// The two pure helpers here are the whole trick:
//   - buildArchiveQuery: mediatype:audio + all keyword terms, downloads-desc — the
//     brief's default ordering (popularity among MATCHING items; the term gate
//     does the relevance work).
//   - pickPlayableFiles: an item's file list mixes originals, derivatives and
//     junk (__ia_thumb.jpg, *_files.xml, torrents, *_sample clips). Group by
//     basename (the same recording appears as FLAC + MP3 + OGG), pick the best
//     format per group (VBR MP3 > MP3 > FLAC > OGG Vorbis), skip samples.

/** One archive.org metadata file entry (only fields we read; all optional). */
export interface IaFile {
	name?: string;
	format?: string;
	size?: string | number;
	length?: string | number; // seconds, as string upstream
	title?: string;
	track?: string | number;
}

/** One flattened TRACK row of the /api/archive/search response (route → adapter). */
export interface ArchiveRow {
	identifier: string;
	file: string;
	title: string | null;
	itemTitle: string | null;
	creator: string | null;
	year: number | null;
	lengthSec: number | null;
	format: string;
	size: number | null;
}

/** One flattened, playable row the search route returns for the adapter. */
export interface IaPickedFile {
	file: string;
	title: string | null;
	lengthSec: number | null;
	format: string;
	size: number | null;
}

/** Format preference per recording-group (lower wins). */
const FORMAT_RANK: Record<string, number> = {
	'VBR MP3': 0,
	MP3: 1,
	Flac: 2,
	'Ogg Vorbis': 3
};

const LUCENE_SPECIALS = /[\\+\-!():^[\]"{}*?|&;/]/g;

/** Escape one keyword term for a Lucene query (archive.org's parser). */
function escapeTerm(term: string): string {
	return term.replace(LUCENE_SPECIALS, '\\$&');
}

/**
 * Build the advancedsearch `q` value: audio items matching EVERY keyword term
 * (bare terms search all fields — title/creator/description). An empty keyword
 * degrades to a plain mediatype scan (the route refuses it before this is used).
 */
export function buildArchiveQuery(keyword: string): string {
	const terms = keyword.split(/\s+/).map((t) => t.trim()).filter(Boolean).map(escapeTerm);
	if (terms.length === 0) return 'mediatype:audio';
	return `mediatype:audio AND (${terms.join(' AND ')})`;
}

function lengthSeconds(v: string | number | undefined): number | null {
	const n = typeof v === 'string' ? Number(v) : v;
	return typeof n === 'number' && Number.isFinite(n) && n > 0 ? Math.round(n) : null;
}

function sizeBytes(v: string | number | undefined): number | null {
	const n = typeof v === 'string' ? Number(v) : v;
	return typeof n === 'number' && Number.isFinite(n) && n > 0 ? n : null;
}

/** Group key: filename minus its final extension (path segments preserved). */
function groupKey(name: string): string {
	const dot = name.lastIndexOf('.');
	return dot > 0 ? name.slice(0, dot) : name;
}

/**
 * Pick the playable files of ONE item: one file per recording (best format),
 * in a stable name order. `_sample` files (30-second previews IA generates)
 * and everything outside the accepted format set are excluded.
 */
export function pickPlayableFiles(files: IaFile[]): IaPickedFile[] {
	const groups = new Map<string, IaFile[]>();
	for (const f of files) {
		if (!f || typeof f.name !== 'string' || !f.name) continue;
		if (f.name.includes('_sample')) continue;
		if (typeof f.format !== 'string' || !(f.format in FORMAT_RANK)) continue;
		const key = groupKey(f.name);
		const arr = groups.get(key);
		if (arr) arr.push(f);
		else groups.set(key, [f]);
	}
	const picked: IaPickedFile[] = [];
	for (const arr of groups.values()) {
		arr.sort((a, b) => (FORMAT_RANK[a.format as string] ?? 9) - (FORMAT_RANK[b.format as string] ?? 9));
		const best = arr[0];
		picked.push({
			file: best.name as string,
			title: typeof best.title === 'string' && best.title ? best.title : null,
			lengthSec: lengthSeconds(best.length),
			format: best.format as string,
			size: sizeBytes(best.size)
		});
	}
	// Deterministic order: disc/track order on IA follows filename order in practice.
	picked.sort((a, b) => a.file.localeCompare(b.file));
	return picked;
}
