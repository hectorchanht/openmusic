---
slug: translation-not-applied
status: resolved
trigger: "Translation not applied across all parts (lyrics/artist name/song title/info). User selected Traditional Chinese target + excluded English-only, but Simplified Chinese still shows. Goal: every part (lyrics/artist/title/info) must render translated to the selected target when translation is on for that part. Names+titles must translate everywhere they appear."
created: 2026-06-16T00:22
updated: 2026-06-16T00:30
---

# Debug Session: translation-not-applied

## Symptoms
- Expected: with target=zh-Hant and skip=[en] (English-only excluded), all Chinese (incl. Simplified) text in lyrics, artist names, song titles, and Last.fm info renders converted to Traditional Chinese.
- Actual: Simplified Chinese still shows in those parts. Translation "seems not applied" — intermittent across parts.
- User ask: grep all render sites by class name, ensure every part routes through translation when enabled.

## Current Focus
- hypothesis: PRIMARY ROOT CAUSE — `/api/translate` newline-batch alignment guard. The proxy joins all lines with `\n` into one Google Translate request (`sl=auto&tl=<lang>&dt=t`), splits the reply by `\n`, and returns the ORIGINAL lines whenever `out.length !== lines.length` (src/routes/api/translate/+server.ts:57-59). Google does NOT preserve newline segment counts (merges/splits/strips short or blank lines), so the alignment check frequently fails and the ENTIRE batch falls back to originals → Simplified text persists.
- test: instrument /api/translate (or unit-test it) with a multi-line zh-Hans batch incl. short/blank lines; observe out.length vs lines.length mismatch → fallback to originals.
- expecting: mismatch on multi-line batches; single-line works.
- next_action: confirm alignment-failure root cause; then fix batching to be alignment-robust (e.g. per-line `q` params / Google `dt=t` segment-array mapping with sentinel tokens that survive translation, or chunk+retry per line on mismatch) so partial/whole batches no longer collapse to originals.

## Evidence
- timestamp: 2026-06-16T00:22 — App is SvelteKit (NOT the legacy index.html described in CLAUDE.md). Translation is a runtime CONTENT-translation feature, separate from UI i18n.
- timestamp: 2026-06-16T00:22 — Settings model (src/lib/stores/settings.svelte.ts): per-part targets lyricsLang/artistLang/titleLang/lastfmLang/bioLang + per-part skip whitelists artistSkip/titleSkip/lyricsSkip/lastfmSkip. effectiveTarget('auto') → appLang.
- timestamp: 2026-06-16T00:22 — Decision logic (src/lib/i18n/detect.ts:74 shouldTranslate) is CORRECT for the reported case: for a zh-Hant/zh-Hans target it deliberately FALLS THROUGH even when src===target (lines 78-88), because the simp/trad disambiguation char-set is small and undercounts; it relies on /api/translate to normalize script. So the decision layer DOES request translation for Simplified text → not the bug.
- timestamp: 2026-06-16T00:22 — Backend conversion is capable: /api/translate maps zh-Hant→zh-TW, zh-Hans→zh-CN (LANG_MAP) and Google `tl=zh-TW` does perform Simplified→Traditional script conversion. So conversion works WHEN alignment passes.
- timestamp: 2026-06-16T00:22 — COVERAGE spot-check (grep by class name r-title/r-artist/al-name/hd-title/np-title/etc): main render sites ARE wrapped in names.dnTitle/dnArtist/dnLastfm — search/+page.svelte:580-581, library/+page.svelte:223, charts/tags+countries:201-202, album:619, artist:494, TrackMenu:242-243 (hd-*), Nowbar:131-132 (np-*), home +page.svelte:762/791-792/850-851/896. So coverage is largely OK; coverage is NOT the primary cause of the broad simplified-persistence.
- timestamp: 2026-06-16T00:22 — Lyrics path (NowPlaying.svelte:253-272): collects sendText[] of all non-skipped lines, calls translateLines(sendText, lang); render gate `showTr = translated.length === lines.length`. Whole-batch fallback (from /api/translate alignment guard) → translated===originals → Simplified stays. Same fragile batch.
- timestamp: 2026-06-16T00:22 — Names path (names.svelte.ts:48-69): batches ALL distinct visible names in a 160ms window into one Set → translateLines(items, lang). One alignment mismatch in /api/translate returns originals for the WHOLE batch → all artist/title names stay Simplified.

## Eliminated
- hypothesis: shouldTranslate wrongly skips Simplified text when target=zh-Hant (src===target skip). — ELIMINATED: detect.ts:78-88 explicitly falls through for zh targets; it does request translation.
- hypothesis: render sites don't route through the translator (coverage gap). — MOSTLY ELIMINATED as PRIMARY cause: spot-check shows main rows wrapped. (Keep as SECONDARY: verify minor sites — TrackMenu detail <dd> at 317-319 render raw detailTrack.title/artist/album; home al-name album tiles; any list not yet checked.)

## Secondary scope (user's "apply everywhere" ask)
- Verify EVERY visible part render routes through dnTitle/dnArtist/dnLastfm (or lyrics translate). Candidates to confirm/patch: TrackMenu.svelte:317-319 (raw detail dd), any al-name/album-name tiles, suggest-title/offline-title/fav-name/artist-name/t-title sites. Grep handles: classes r-title r-artist al-name t-title t-artist hd-title hd-artist g-title fav-name suggest-title offline-title artist-name np-title np-artist.

## Resolution
- root_cause: CONFIRMED. `/api/translate` joined all lines with `\n` into one Google request and split the reply on `\n`, returning ORIGINALS whenever `out.length !== lines.length`. Google Translate STRIPS leading/trailing blank lines (and reflows segments), so any batch with a boundary blank — extremely common in lyrics intros/outros, and possible in mixed name Sets — produced a different segment count and collapsed the ENTIRE batch to Simplified. Reproduced live: `['歌词第一行','第二行','','']` (4 lines) returned only `'歌詞第一行\n第二行'` → split=2 → mismatch → originals. Same for a leading blank.
- fix: (1) BATCH ALIGNMENT — `src/routes/api/translate/+server.ts` rewritten to separate lines with a unique non-blank sentinel `‹i›` (on its own line) that survives translation and resists blank-line stripping, then split the reply back on those sentinels (regex tolerant of reflowed whitespace). Single-line requests bypass batching. On any residual segment mismatch or transport failure it falls back to PER-LINE requests (parallel) so one bad line never poisons the batch. Preserves the empty-on-failure contract, the 8s timeout, the 1-day cache header, and the strict `out.length === lines.length` contract every caller relies on (services/translate.ts, stores/names.svelte.ts, NowPlaying stitch). (2) COVERAGE SWEEP — class-name grep across all routes/components confirmed every visible content surface already routes through names.dnTitle/dnArtist/dnLastfm/dnBio (search, library, charts, album, artist, home tiles, Nowbar, NowPlaying, TagChips). The ONE gap — TrackMenu detail `<dd>` (lines 317-319) rendering raw `detailTrack.title/artist/album` — now routes title/album through `names.dnTitle` and artist through `names.dnArtist`. Settings-screen tag chips and user-typed search-history queries are intentionally left raw (config controls / the user's own literal input, not translatable content).
- verification: `npx svelte-check` 0 errors / 0 warnings. Live dev server (localhost:5175) POST /api/translate with the previously-collapsing batches now returns aligned Traditional output: `['','歌詞第一行','第二行','','']` (blanks preserved positionally), names `周杰伦→周杰倫 / 邓紫棋→鄧紫棋 / 林俊杰→林俊傑`, single line `简体中文测试→簡體中文測試`. Home route renders 200, no compile/runtime errors in dev log.
- files_changed:
  - src/routes/api/translate/+server.ts (sentinel-based alignment-robust batching + per-line fallback)
  - src/lib/components/TrackMenu.svelte (detail dd title/artist/album now via names.dn* resolvers)
