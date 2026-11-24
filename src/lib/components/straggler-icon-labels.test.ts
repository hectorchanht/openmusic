// Workstream H batch 6 — final straggler-sweep ICON-label regression pins
// (NO SILENT BREAKAGE). Hector 2026-11-23 22:08 (Dawn-Design §8 v1.6): after
// batches 1–5, this sweep hunted every remaining visible text label on a
// CONTROL that a glyph in the app's icon language can carry. These pins FAIL
// if any converted straggler regains visible text or loses its accessible
// name. The complete list of labels judged NOT icon-carriable (with reasons)
// lives in the batch-6 commit message and the workstream's final report:
// setting names, value chips (languages / regions / sources / extensions /
// genres), duration values, dialog titles and headings, field labels,
// status readouts, and content (titles, lyrics, names, counts).
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';

const books = readFileSync('src/lib/components/BooksList.svelte', 'utf-8');
const community = readFileSync('src/lib/components/CommunityLyricsList.svelte', 'utf-8');
const editor = readFileSync('src/lib/components/LyricsEditor.svelte', 'utf-8');
const metadata = readFileSync('src/lib/components/MetadataEditor.svelte', 'utf-8');
const npAbout = readFileSync('src/lib/components/NpAbout.svelte', 'utf-8');
const video = readFileSync('src/lib/components/VideoStage.svelte', 'utf-8');
const comments = readFileSync('src/lib/components/NpComments.svelte', 'utf-8');
const game = readFileSync('src/lib/components/NpGame.svelte', 'utf-8');
const npLyrics = readFileSync('src/lib/components/NpLyrics.svelte', 'utf-8');
const layout = readFileSync('src/routes/(app)/+layout.svelte', 'utf-8');
const album = readFileSync('src/routes/(app)/album/[name]/+page.svelte', 'utf-8');
const artist = readFileSync('src/routes/(app)/artist/[name]/+page.svelte', 'utf-8');
const search = readFileSync('src/routes/(app)/search/+page.svelte', 'utf-8');
const libraryPage = readFileSync('src/routes/(app)/library/+page.svelte', 'utf-8');

describe('H batch 6 — straggler controls are icon-only', () => {
	it('books: back = ChevronLeft, show-more = ChevronDown', () => {
		expect(books).toContain("aria-label={t('books.allBooks')}");
		expect(books).toContain("aria-label={t('artist.showMore')}");
		expect(books).not.toContain("<ChevronLeft size={18} /> {t('books.allBooks')}");
	});
	it('community lyrics fork = Pencil glyph', () => {
		expect(community).toContain("aria-label={t('community.fork')}");
		expect(community).not.toContain("<Pencil size={13} /> {t('community.fork')}");
	});
	it('lyrics editor tools are glyphs (import/retime/distribute/stamp/chars/even/review/back/save)', () => {
		for (const key of ['lyricsEditor.import', 'lyricsEditor.retime', 'lyricsEditor.distribute', 'lyricsEditor.stamp', 'lyricsEditor.chars', 'lyricsEditor.charsEven', 'lyricsEditor.review', 'lyricsEditor.back']) {
			expect(editor, key).toContain(`aria-label={t('${key}')}`);
		}
		expect(editor).toContain('<FileUp size={14} />');
		expect(editor).toContain('<Eye size={16} />');
		expect(editor).not.toContain("<Clock size={12} /> {t('lyricsEditor.stamp')}");
		expect(editor).not.toContain("<Type size={12} /> {t('lyricsEditor.chars')}");
	});
	it('metadata editor: cancel = X, save = Check', () => {
		expect(metadata).toContain("aria-label={t('tags.cancel')}");
		expect(metadata).toContain("aria-label={saving ? t('tags.saving') : t('tags.save')}");
		expect(metadata).toContain('<Check size={18} />');
	});
	it('video retry/close and about retry are glyphs', () => {
		expect(npAbout).toContain("aria-label={t('video.retry')}");
		expect(video).toContain("aria-label={t('video.retry')}");
		expect(video).toContain("aria-label={t('nowplaying.closeVideo')}");
		expect(video).not.toContain("<X size={14} /> {t('nowplaying.closeVideo')}");
	});
	it('comments composer: post = Send, cancel = X, write = PenLine', () => {
		expect(comments).toContain("aria-label={t('comments.post')}");
		expect(comments).toContain('<Send size={16} />');
		expect(comments).toContain("aria-label={t('comments.cancel')}");
		expect(comments).toContain("aria-label={t('comments.write')}");
	});
	it('game result controls are glyphs (results text itself untouched)', () => {
		expect(game).toContain("aria-label={t('songbeat.playAgain')}");
		expect(game).toContain("aria-label={t('songbeat.keepListening')}");
		expect(game).toContain("aria-label={t('songbeat.backToLyrics')}");
		expect(game).toContain('<RotateCcw size={18} />');
		expect(game).toContain('<Headphones size={18} />');
		expect(game).toContain('<MicVocal size={18} />');
	});
	it('np lyrics: retranslate = RefreshCw, add-lyrics = PenLine', () => {
		expect(npLyrics).toContain("aria-label={t('lyricsSettings.retranslate')}");
		expect(npLyrics).toContain("aria-label={t('nowplaying.addLyrics')}");
	});
	it('toast retry = RotateCcw; offline CTAs = Library glyph on every page', () => {
		expect(layout).toContain("aria-label={t('toast.retry')}");
		for (const [name, src] of [['album', album], ['artist', artist], ['search', search]] as const) {
			expect(src, name).toContain("aria-label={t('offline.goToLibrary')}");
			expect(src, name).toContain('<Library size={18} />');
			expect(src, name).not.toContain("use:tapBounce>{t('offline.goToLibrary')}</button>");
		}
	});
	it('heal = Wrench, canon re-download = Download', () => {
		expect(album).toContain("aria-label={t('heal.all')}");
		expect(libraryPage).toContain("aria-label={t('heal.all')}");
		expect(libraryPage).toContain("aria-label={t('canon.redownload')}");
		expect(libraryPage).toContain('<Wrench size={16} />');
	});
	it('artist show-more = ChevronDown glyph', () => {
		expect(artist).toContain("aria-label={t('artist.showMore')}");
		expect(artist).not.toContain("{t('artist.showMore')}<ChevronDown size={18}/>");
	});
});
