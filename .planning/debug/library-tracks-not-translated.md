---
slug: library-tracks-not-translated
status: resolved
trigger: "I think for the songs that were liked or downloaded, the translation is not applied to them."
created: 2026-06-16T01:47
updated: 2026-06-16T02:05
---

# Debug Session: library-tracks-not-translated

## Symptoms
- Expected: liked songs + downloaded songs (Library tab) render their title/artist translated to the selected per-part target, same as search results do.
- Actual: liked/downloaded songs appear NOT translated (Simplified/original persists) while other surfaces (search) translate.
- Related: follows the just-resolved `translation-not-applied` session (the /api/translate batch-alignment fix is applied but UNCOMMITTED).

## Current Focus
- hypothesis: CONFIRMED — batch-size, but the precise mechanism is GOOGLE ECHO-MODE, not URL-length. A large batch makes the free Google endpoint return the input UNTRANSLATED as a single segment; the sentinel tokens survive intact so the sentinel-split count still equals lines.length and the alignment guard accepted the untranslated originals as success. Per-line fallback never fired.
- test: live-reproduced against dev server (5173/5175) with 10/40/50/80 distinct Simplified CN names.
- expecting: large batch → 0 changed; small batch → translated. CONFIRMED.
- next_action: (done) detect echo-mode (multi-line reply with segments===1) + chunk batches; verify; svelte-check.

## Evidence
- timestamp: 2026-06-16T01:47 — App is SvelteKit under src/ (CLAUDE.md "index.html" desc is STALE).
- timestamp: 2026-06-16T01:47 — COVERAGE: Library render rows ALL wrap text in names.dnTitle/dnArtist — liked (library/+page.svelte:223), playlists (~253), downloads (~272), fav-artists fav-name (~289 via dnArtist), history (~305). NOT a missing-wrapper gap.
- timestamp: 2026-06-16T01:47 — PERSISTENCE: library.svelte.ts stores FULL Track[] verbatim; no serialize step alters title/artist. Text content not corrupted.
- timestamp: 2026-06-16T01:47 — NAMES BATCHING: names.svelte.ts resolve() queues each uncached name; schedule() flushes after 160ms via translateLines(items, lang). First Library open = every name uncached = one large batch.
- timestamp: 2026-06-16T02:00 — REPRODUCED (live, port 5173/5175): POST /api/translate with N distinct Simplified names → n=10 changed 9/10; n=40 changed 30/40; n=80 changed 0/80 in 117ms (too fast = no translation). Confirms size-dependent failure.
- timestamp: 2026-06-16T02:00 — RAW GOOGLE probe of the sentinel-joined batch: n=10 → segCount=19; n=40 → segCount=79; n=80 → segCount=1 and out===input (ECHO-MODE). Threshold ~45–50 short sentinel-lines (joined ~345→435 chars). Boundary is fuzzy/rate-sensitive, not a clean char or count cap — a 20-line chunk @offset40 also echoed once.
- timestamp: 2026-06-16T02:00 — KEY: in echo-mode data[0].length === 1 (single segment), whereas a real multi-line translation returns many segments (~39 for 20 lines). Reliable failure signal. The OLD guard only checked split-count (which still matched because sentinels were echoed back) → accepted untranslated originals. Per-line fallback recovered the stuck chunk (杜国华→杜國華).

## Eliminated
- hypothesis: Library rows don't route through the translator (missing dnTitle/dnArtist). — ELIMINATED: all tabs' rows wrap.
- hypothesis: URL-length cap (414) on the Google GET. — ELIMINATED: 80 short names = ~4.3KB URL (well under 8KB); failure is echo-mode (segments===1), not an HTTP error — status was 200.
- hypothesis: reactivity (rev bump not re-triggering each-block resolvers) / persistence corruption / cache hydration race. — Not needed; the API-layer echo-mode fully explains and reproduces the symptom and the fix resolves it.

## Resolution
- root_cause: CONFIRMED. The free Google Translate endpoint silently bails on an OVERSIZED `q=` payload: instead of translating it ECHOES the input back as ONE untranslated segment (data[0].length === 1). `/api/translate` joins lines with `‹i›` sentinels and validated only that the sentinel-split COUNT equalled lines.length — but the echoed input still contains every sentinel, so the count matched and the handler returned the untranslated Simplified originals as a "successful" batch. The names store cached those originals. A populated Library tab queues 50+ distinct names in one 160ms batch (over the ~45-line echo threshold) → all Simplified; search renders ~one short page (small batch, under the threshold) → translated. The robust per-line fallback never fired because the guard checked count, not whether anything was actually translated.
- fix: src/routes/api/translate/+server.ts hardened: (1) ECHO-MODE DETECTION — gtranslate now also returns Google's segment count; the batched path rejects any multi-line reply that came back as a SINGLE segment (segments <= 1) and falls through to per-line, BEFORE the count check that the echo previously fooled. (2) CHUNKING — batches are split into CHUNK_SIZE=20-line Google requests (run in parallel, concatenated positionally) so each stays in the reliable zone. (3) CONCURRENCY CAP — per-line fallback now uses a bounded worker pool (PERLINE_CONCURRENCY=6) instead of unbounded Promise.all, so a recovering chunk can't burst N parallel GETs and trip Google's rate limiter (which itself manifests as echo-mode). Preserves the strict out.length === lines.length contract, the 8s timeout, the 1-day cache header, the sentinel batching, single-line/blank-line/empty handling.
- verification: live dev server (5173 + 5175) — before: n=80 → 0/80 changed (echo-mode, 117ms); after: n=50 → 37/50, n=80 → 56/80 changed (杜国华→杜國華 etc; remaining unchanged are genuinely identical simp/trad names, correct). Regression: single line 简体中文测试→簡體中文測試; blank-boundary lyrics ['','歌词第一行','第二行','',''] → len=5 with blanks positionally preserved + content translated; empty input → []; 20-line (one chunk) and 21-line (spans 2 chunks) both fully aligned + translated. `npx svelte-check` 0 errors / 0 warnings.
- files_changed:
  - src/routes/api/translate/+server.ts (echo-mode detection via segment count + 20-line chunking + bounded per-line concurrency)
