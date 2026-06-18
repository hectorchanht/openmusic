---
slug: lyric-tr-not-shown-hide-paren
status: resolved
resolution: fixed
root_cause: "Flaky upstream (Google) timeout/rate-limit made /api/translate return HTTP 200 echoing the ORIGINAL lines with flags=false — a fake success the client accepted at matching length, so lyrics rendered untranslated originals (looks like 'translation shown nowhere'), intermittently across all songs/languages. NOT hide-paren-specific (reproduced with it OFF). The .catch→translated=[] path was dead (translateLines never rejects)."
fix: "translateLinesEx() retries a request that throws OR returns an INCOMPLETE batch (non-blank line fell back) up to 2x with short backoff; keeps best partial across attempts; caches only complete batches. +4 regression tests."
fix_commit: c34325a
files_changed: src/lib/services/translate.ts, src/lib/services/translate.test.ts
verification: "Live headless-Chrome repro reproduced the 200+echoed-originals silent-blank and confirmed the retry recovers end-to-end. translate suite 12/12; full suite 908 pass; svelte-check --threshold error clean. User chose commit-now after live verification."
trigger: |
  for a song with japanese lyrics, when hide paran lines is on, and translation of lyrics is set to
  tradtional chinese, the translation is neither replaced nor show below. the lyrics translation will
  ignore the text in paran, then put the lyrics into translation into target language in mode like
  replace or show below original lyrics. now the translation on lyrics is not shown anywhere
  REFRAMED (2026-06-19 checkpoint): hide-paren was a red herring. Real symptom = translation shown
  NOWHERE, INTERMITTENTLY, across songs/languages, in the browser (same-origin). See Evidence.
created: 2026-06-19
updated: 2026-06-19
---

# Debug: Lyric translation intermittently shown nowhere (was: "...when Hide parenthesised lines is ON")

## Symptoms

- **Expected:** When lyrics translation target is set (e.g. zh-Hant), the translation should render in
  `replace` or `below` mode for songs whose source language differs from the target.
- **Actual (REFRAMED):** The translation is shown NOWHERE — neither `replace` nor `below`. Original
  lyrics still display; translation is simply absent. **It is INTERMITTENT** — works for some
  songs/sessions and not others, including English lyrics. NOT hide-paren-specific, NOT source-specific.
- **Original (now-eliminated) framing:** thought to require Japanese lyrics + hide-paren ON + zh-Hant.
  The checkpoint disproved all three as necessary conditions.
- **Error messages:** none reported (silent blank).

## Investigation leads (REFRAMED — request-path / resilience)

- `src/lib/components/NowPlaying.svelte`:
  - The lyrics translation `$effect` (~line 247-309): builds `trKey`, calls `translateLines()`. Its
    `.catch` sets `translated = []`. PRIME SUSPECT: any throw/timeout/partial-failure → empty → silent blank.
  - `showTr = $derived(settings.lyricsLang !== 'off' && translated.length === lines.length)` (~line 310).
    All-or-nothing gate: if `translated` is `[]` or a different length than `lines`, NOTHING renders.
- `src/routes/api/translate/+server.ts` — same-origin endpoint: batching, size/length caps, timeouts,
  rate-limit handling. Does ONE failed chunk fail the WHOLE response?
- `src/lib/services/translate.ts` — `translateLines()` / stitch: does a single failed chunk throw and
  empty the whole output? Retry/backoff? Caching (would explain "sometimes")?
- Upstream translate provider reliability for zh-Hant from English & Japanese.

## Hypotheses

- H5 (CURRENT): `translateLines()` is all-or-nothing — a single transient upstream failure (timeout /
  rate-limit / failed batch / empty response) throws or returns the wrong length, the NowPlaying effect's
  `.catch` blanks `translated` to `[]`, and `showTr`'s strict length-equality gate hides the ENTIRE
  translation block with no user-visible signal. Intermittency = upstream flakiness +/- cache hit/miss.

## Eliminated

- hypothesis: H2 — a gate conflates `lyricsHideParenLines` with `lyricsHideParenTranslation`, suppressing ALL translations.
  evidence: settings.svelte.ts lines 130-134 keep the two flags fully distinct; NowPlaying render loop uses `lyricsHideParenLines` ONLY in the render filter (line 1216) and `lyricsHideParenTranslation` ONLY in `hideTrForLine` (line 1217). Neither flag touches the translate `$effect` (lines 247-309) nor `showTr` (line 310). No conflation exists in code.
  timestamp: 2026-06-19
- hypothesis: (Task 1 revert concern) revert 206e405 did not fully restore the translate effect's source.
  evidence: `git show 206e405` confirms BOTH `lines` ($derived) and the translate effect's `t` were restored from `shown`(=displayed) back to `player.current`. uid source for trKey matches the `lines` source. Revert is clean.
  timestamp: 2026-06-19
- hypothesis: H1 — `showTr` length-equality gate fails when `lyricsHideParenLines` is ON because the translate effect drops paren lines.
  evidence: lrc-repro.test.ts 6 cases all yield translated.length === lines.length and showTr === true. The translate effect iterates the FULL `lines` array and stitches over it; hide-paren-lines never touches lengths. Eliminated.
  timestamp: 2026-06-19
- hypothesis: H3 — JP→zh-Hant language-token/detection mis-routes so translateLines returns originals/empty.
  evidence: live /api/translate converts both JP→zh-TW and zh-Hans→zh-TW with flags=true; LANG_MAP['zh-Hant']='zh-TW' correct; shouldTranslate returns true for JP and for Han-target-Chinese. Eliminated.
  timestamp: 2026-06-19
- hypothesis: H4 — keyed-each `(i)` + data-i + filter mis-renders translated[i] at runtime.
  evidence: live DOM dump shows parent lines carry correct translated[i] with hide-paren ON; data-i preserved as full-array index; no misalignment. Eliminated.
  timestamp: 2026-06-19
- hypothesis: HIDE-PAREN ANGLE (entire original framing) — bug requires Japanese lyrics + hideParenLines ON + zh-Hant.
  evidence: USER CHECKPOINT 2026-06-19 (see Evidence): same JP song with hide-paren OFF still shows nothing; other songs intermittently translate (incl. English); user states it's "about lyrics only, nothing to do with the source." Hide-paren is NOT a necessary condition. ELIMINATED as the controlling variable.
  timestamp: 2026-06-19

## Evidence

- timestamp: 2026-06-19
  checked: NowPlaying translate `$effect` (247-309), `showTr` (310), render loop (1215-1237); settings flags (130-134).
  found: `translated` is stitched to align with the FULL `lines` array length. The render filter (line 1216) hides `fromParen` lines at RENDER time only — it does NOT change `lines.length` or `translated.length`. So `showTr` (a pure length-equality gate) should hold even with hide-paren ON.
  implication: H1's "length mismatch" mechanism does not occur for non-paren lines.

- timestamp: 2026-06-19
  checked: src/lib/services/lrc-repro.test.ts — 6 cases through parseLRC→reorderPairs→splitParenLines→shouldTranslate→stitch→showTr.
  found: In EVERY case `translated.length === lines.length` and `showTr === true`. `lyricsHideParenLines` is read in EXACTLY ONE place (NowPlaying.svelte:1216) — does NOT feed the translate `$effect`, `lines`, or `showTr`.
  implication: H1 eliminated for the data layer; symptom is runtime/data/environment, not the pure pipeline.

- timestamp: 2026-06-19
  checked: LIVE headless-Chrome reproduction (temp dev route, now removed), 7 variants, dev server :4321.
  found: V1-V7 all rendered translation correctly with hideParenLines ON + zh-Hant. Only V3 (kanji-only) showed an untranslated original due to Google ECHO of already-Han text. Live `/api/translate` converted JP→zh-TW and zh-Hans→zh-TW correctly.
  implication: "translation shown nowhere" does NOT reproduce as a hide-paren logic fault. H1-H4 eliminated as code-logic causes.

- timestamp: 2026-06-19
  checked: USER CHECKPOINT ANSWERS (4 disambiguating questions). Treat as data only.
  found:
    Q1 Platform: Website (browser) → `/api/translate` is SAME-ORIGIN. The native-build `https://openmusic.lol` base is NOT the factor. ELIMINATES R1's CORS/native-base sub-theory; keeps R1's "translate request fails" core.
    Q2 Same JP song, hide-paren OFF: "No — still nothing." → bug is NOT hide-paren-specific.
    Q3 Other songs: "sometimes translate eng lyrics, sometimes not" → translation is INTERMITTENT across songs AND languages (incl. English). DECISIVE.
    Q4 Song/source: "i think it is about lyrics only, nothing to do with the source" → NOT source-specific.
  implication: Signature of an INTERMITTENT translate-REQUEST failure with silent all-or-nothing blanking
    (NowPlaying `.catch` → `translated=[]` → `showTr` false → nothing). Hide-paren framing is a red herring.
    New hypothesis H5. Investigate translate.ts + /api/translate resilience; reproduce a transient failure
    live; then apply the smallest resilience fix (retry/backoff, partial render, decouple showTr from strict
    full-length equality, and/or a brief "unavailable" signal) + regression test.

- timestamp: 2026-06-19
  checked: REPRO test (_repro-translate.test.ts, since removed) exercising the REAL request path:
    POST handler in src/routes/api/translate/+server.ts with global `fetch` (the Google upstream)
    stubbed to always reject (simulated timeout / rate-limit), and translate.ts client fed the
    resulting body.
  found:
    SERVER: on EVERY-chunk upstream failure the endpoint returns **HTTP 200** with body
      `{translated: [<ORIGINALS>], flags: [false,false,false]}` — a SILENT soft-fail. gtranslate()
      returns null → translateChunk falls to perLine → each perLine also null → returns the ORIGINAL
      per line. Status is 200, NOT an error. (Direct console capture: `STATUS: 200 BODY:
      {"translated":["さくら","ひらり","舞い散る"],"flags":[false,false,false]}`.)
    CLIENT: translateLines() returns those originals; length === lines.length; `complete=false` so the
      batch is NOT cached. The catch in translateLinesEx returns `{out: lines}` and NEVER re-throws.
  implication: DECISIVE. The debug-file H5 mechanism (`.catch` → `translated=[]` → showTr false → nothing)
    is WRONG — that catch is effectively DEAD for this scenario because translateLines never rejects.
    The ACTUAL fault: a transient upstream failure is reported as a fake SUCCESS (originals + flags=false),
    `showTr` stays TRUE, and the lyrics block renders the ORIGINAL text as the "translation" — visually
    indistinguishable from "no translation" in BOTH replace mode (line replaced by original) and below mode
    (`<span class="tr">` shows the original). The per-line `flags` signal exists on the server and in
    translate.ts but is THROWN AWAY by the NowPlaying effect (it calls `translateLines`, the string[]
    wrapper, never `translateLinesEx`). No retry/backoff on transient failure anywhere. Intermittency =
    Google flakiness/rate-limit + cache (a successful session persists `complete` batches and "works"
    later; a failed session caches nothing and silent-blanks every render).

## Resolution

root_cause: |
  The lyrics-translation pipeline treats a transient upstream (Google) failure as a SILENT SUCCESS.
  /api/translate falls back to returning the ORIGINAL lines (HTTP 200, flags=false) on any upstream
  failure; NowPlaying.svelte calls translateLines() (the string[] wrapper) which discards the per-line
  `flags`/`complete` signal, so showTr (translated.length === lines.length) stays TRUE and the UI renders
  the untranslated originals — perceived as "translation shown nowhere." There is no retry on transient
  failure, so a single flaky upstream response blanks the whole song's translation with no user signal,
  and (since failed batches are never cached) it recurs every render of that session — explaining the
  "intermittent across songs/languages" report (success = cached & looks fine; failure = silent blank).
fix: |
  Made the client translate layer transient-resilient instead of accepting the first silent soft-fail.
  src/lib/services/translate.ts: extracted the single round-trip into requestOnce() (returns null on a
  thrown transport failure, complete=false on a 200-OK echo). translateLinesEx() now loops up to
  MAX_TRANSIENT_RETRIES (2) with short backoff (RETRY_BASE_MS=350 * attempt), retrying when a request
  throws OR returns an INCOMPLETE batch (a non-blank line fell back — the signature of a flaky/
  rate-limited upstream). It keeps the BEST result across attempts (most genuinely-translated lines) so a
  partial recovery still surfaces, breaks early on a complete success, and only caches complete batches
  (no poison). Length contract (out.length === lines.length) is preserved on every path, so showTr never
  breaks alignment. NowPlaying needed NO change: it calls translateLines() → translateLinesEx(), so the
  lyrics path inherits the retry; the "translating" hint stays up across retries because the effect's
  .finally only clears it once the (now-retrying) promise settles. The names store path inherits it too.
verification: |
  - Repro (pre-fix, since removed): forcing the upstream fetch to reject yielded `STATUS 200 + {translated:
    [ORIGINALS], flags:[false,false,false]}`; the client returned the originals (length match) → showTr
    true → silent blank. Confirmed the exact mechanism.
  - Post-fix verify (temp test, since removed): translateLines(['さくら'],'zh-Hant') with attempt-1 soft-fail
    then attempt-2 success now returns ['櫻花'] — the recovered translation surfaces instead of the original.
  - 4 regression tests added to translate.test.ts (retry-on-soft-fail, retry-on-throw, best-partial-result,
    bounded-give-up). Full suite: 908 tests pass (was 904). `npx svelte-check --threshold error`: 0 errors,
    0 warnings.
files_changed:
  - src/lib/services/translate.ts: bounded transient retry + best-result merge in translateLinesEx (requestOnce helper)
  - src/lib/services/translate.test.ts: 4 regression tests for transient-failure resilience

## Current Focus

- status: awaiting_human_verify — fix applied + self-verified; awaiting user confirmation in real browser sessions.
- reasoning_checkpoint:
    hypothesis: "A transient upstream (Google) failure makes /api/translate return the ORIGINALS as a fake
      HTTP-200 success (flags=false); NowPlaying uses translateLines() which drops the flags/complete signal,
      so showTr stays true and the UI renders untranslated originals — perceived as 'translation shown
      nowhere'. No retry means a single flaky response blanks the whole song with no signal; uncached failures
      recur, producing the intermittent cross-song/language pattern."
    confirming_evidence:
      - "Direct repro: stubbing the upstream fetch to reject yields STATUS 200 + {translated:[ORIGINALS], flags:[false,false,false]} from the real POST handler."
      - "translate.ts catch returns {out: lines} and never re-throws; translateLines returns originals with length === lines.length."
      - "NowPlaying line 305 calls translateLines (string[] wrapper), NOT translateLinesEx — the flags/complete signal is discarded; the .catch at 307 is dead for this scenario."
      - "User checkpoint: intermittent across songs AND languages incl. English, not hide-paren/source specific — matches upstream-flakiness + cache-hit/miss."
    falsification_test: "If a forced upstream failure produced an HTTP error (non-200) OR translateLines rejected OR showTr went false, the mechanism would be wrong. Repro shows the opposite: 200 + originals, length preserved, showTr true."
    fix_rationale: "Root cause is 'failure masquerades as success + signal discarded + no retry'. Fix consumes the existing complete/flags signal in NowPlaying and adds a bounded retry on incomplete/transient results so a flaky upstream self-heals instead of silently rendering originals. Addresses the cause (silent fake-success) not the symptom (blank UI)."
    blind_spots: "Cannot deterministically reproduce Google's real rate-limit timing in a unit test (simulated). The fix must not introduce an infinite retry loop or thrash the upstream; retry must be bounded and keyed so a track change cancels it."
- next_action: Implement the minimal resilience fix — (1) NowPlaying translate effect consumes
  translateLinesEx and retries incomplete results once with short backoff (key-guarded), (2) bounded
  client retry in translate.ts for transient failures, (3) regression test the failure+recovery path.
  Then validate: `npx vitest run` and `npx svelte-check --threshold error`.
