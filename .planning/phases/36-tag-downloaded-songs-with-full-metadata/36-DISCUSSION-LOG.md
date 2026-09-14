# Phase 36: Tag downloaded songs with full metadata - Discussion Log

> **Audit trail only.** Do not use as input to planning, research, or execution agents.
> Decisions are captured in CONTEXT.md — this log preserves the alternatives considered.

**Date:** 2026-09-13
**Phase:** 36-tag-downloaded-songs-with-full-metadata
**Areas discussed:** Tagger build + container coverage, Year/genre, Album artist + track number, Native side + failure visibility

---

## Tagger build + container coverage

### Q1 — How should the tag writers be built, given the zero-runtime-deps house rule?

| Option | Description | Selected |
|--------|-------------|----------|
| Hand-write, no dependency | Keeps CLAUDE.md's rule intact; pure .ts, node-testable; only the atoms/frames we emit. Cost: bulk of the phase's code | |
| Take a dependency | Faster to working code; breaks the stated house rule; bundle weight on a mobile-first PWA | ✓ |
| Hand-write, but bound it hard | Hand-write with an up-front declared field list per container | |

**User's choice:** Take a dependency
**Notes:** Chosen with the house-rule conflict explicitly on the table (the option text named it). Scope had already widened from cover-art-only to the full tag set across three containers, which is what justifies the exception. Recorded as D-01 — a settled, informed exception, not to be re-argued downstream.

### Q2 — Which containers get a writer in THIS phase?

| Option | Description | Selected |
|--------|-------------|----------|
| m4a/MP4 + FLAC only | The actual post-Phase-32 download mix; smallest honest scope | |
| All three (MP3 + m4a + FLAC) | ROADMAP goal names all three; extFromAudioUrl defaults unknown → mp3; what Phase 34's reader needs | ✓ |
| m4a + FLAC now, MP3 if cheap | Risk: "if cheap" is a judgement call agents resolve inconsistently | |

**User's choice:** All three

### Q3 — Phase 34 READS the tags this phase WRITES. Who owns the codec module?

| Option | Description | Selected |
|--------|-------------|----------|
| 36 owns it, write + read together | One module both phases use; the parser proves the writer via round-trip tests, no device needed | ✓ |
| 36 writes only, 34 adds read later | Smaller phase; writer ships unverified, 34 reverse-engineers the layout | |
| You decide | Settle during planning | |

**User's choice:** 36 owns it, write + read together

### Q4 — Which dependency shape should the researcher target?

| Option | Description | Selected |
|--------|-------------|----------|
| One wasm TagLib | Read+write for all three in one API; wasm payload on a mobile PWA; must work in WebView + node | |
| Per-container JS libs, hand-write gaps | Lighter, tree-shakeable; likely 2-3 packages, and read-only libs force hand-written gaps anyway | |
| Let the researcher decide on evidence | Lock "a dependency is allowed"; survey what exists today with real sizes and compat data | ✓ |

**User's choice:** Let the researcher decide on evidence
**Notes:** Claude flagged before the question that the ecosystem is lopsided — read-side libs are plentiful, write-across-MP3+MP4+FLAC is rare — and that this recollection was unverified. That uncertainty is exactly why the evidence-based option was the right call. D-04 records the hard constraints the researcher's pick must satisfy.

### Q5 — Where must the dependency run?

| Option | Description | Selected |
|--------|-------------|----------|
| Both web and native, same code path | One path, one behaviour, node-testable; requires browser/WebView + node compat | ✓ |
| Native APK only — web saves untagged | Keeps wasm out of the web bundle; two behaviours for one button | |
| Native-only, done in Kotlin | No wasm question; a second implementation language, and 34's reader would need it too | |

**User's choice:** Both web and native, same code path

### Q6 — If the dependency can't tag a given file, what happens?

| Option | Description | Selected |
|--------|-------------|----------|
| Save original bytes untouched, result stays 'saved' | Locked by the notes' never-corrupt rule; reporting 'failed' for a file that saved fine is untruthful | ✓ |
| Save untouched, but surface it to the user | Same bytes plus a distinct signal ('saved-untagged') | |
| You decide | Settle the sentinel shape during planning | |

**User's choice:** Save original bytes untouched, result stays 'saved'
**Notes:** The exact sentinel shape was still left to planning (recorded under Claude's Discretion).

---

## Year / genre — enrich or omit

### Q1 — Year and genre aren't on Track. What goes in those tags?

| Option | Description | Selected |
|--------|-------------|----------|
| Omit both — no enrichment on the download path | Honours omit-never-placeholder; zero added API calls on a path repeatedly trimmed (Phase 26: 59→3; api-fetch-flood freeze) | ✓ |
| Enrich both from Deezer/Last.fm at download time | Proxies already exist; costs 1-2 extra /api/* calls per song while the user waits on a large file | |
| Genre from Track.tags if present, year omitted | Zero new calls; genre present unpredictably on some downloads and not others | |

**User's choice:** Omit both

### Q2 — Duration: notes say take it from the decoded audio, not a tag guess.

| Option | Description | Selected |
|--------|-------------|----------|
| Let the container carry it — write no duration tag | MP4/FLAC STREAMINFO/MP3 headers already encode it; a tag can contradict the bytes | |
| Write Track.duration when present, omit otherwise | Explicit; QQ-reported duration can disagree with the downloaded tier | |
| You decide | Settle against the chosen library's API | ✓ |

**User's choice:** You decide → Claude's Discretion (D-09), with "let the container carry it" recorded as the strong prior.

### Q3 — Provenance tag naming the source or app?

| Option | Description | Selected |
|--------|-------------|----------|
| No provenance tags — clean file | The user's file is theirs; app branding lingers in their comment column forever | ✓ |
| Write a minimal comment/encoder tag | Would help 34 recognise its own writes — but 34 D-09 already does that by folder location | |
| You decide | Planning's call | |

**User's choice:** No provenance tags

---

## Album artist + track number

### Q1 — Where does track number come from?

| Option | Description | Selected |
|--------|-------------|----------|
| Album-page downloads only; omitted elsewhere | The album loop knows real order; search-tapped songs get none, per omit-never-placeholder | ✓ |
| Never write track number at all | Simplest; a whole album then plays back alphabetically on the device | |
| Album page always; guess from displayIndex elsewhere | Would stamp an interleaved search position as a permanent track number | |

**User's choice:** Album-page downloads only; omitted elsewhere
**Notes:** displayIndex exclusion is explicit in D-11 — `sources/types.ts` calls it "ORDERING ONLY, NEVER used for identity", and a search row's index is a position in an interleaved multi-source list.

### Q2 — Album artist rule (grouping-critical)

| Option | Description | Selected |
|--------|-------------|----------|
| Album-page context when present, else the track's own artist | Keeps compilations and featured-guest tracks under one album; artist fallback groups the common case | ✓ |
| Album-page context only; omit elsewhere | Strictest omit reading; omitting is itself a grouping decision and players fall back to track artist anyway | |
| Always Track.artist | Simple; splits a guest-heavy album into one entry per track — the exact failure the notes name | |

**User's choice:** Album-page context when present, else the track's own artist

### Q3 — Track.album is often empty on search stubs. What then?

| Option | Description | Selected |
|--------|-------------|----------|
| Omit the album tag; write title/artist only | Consistent with the omit rule; the player applies its own "Unknown album" convention | ✓ |
| Re-resolve to try to fill album before tagging | Adds a further lookup beyond downloadTrack's existing fresh resolve | |
| You decide | Planning's call | |

**User's choice:** Omit the album tag

### Q4 — Which cover image gets embedded?

| Option | Description | Selected |
|--------|-------------|----------|
| Whatever the app currently displays, via resolveArtworkDataUrl | Reuses the capped/timeout-bounded/CORS-tiered path; honours the user's attached-cover override; notes forbid a second fetch path | ✓ |
| Source cover only, ignore any user override | Embeds "official" art; the file then disagrees with what the user deliberately attached | |
| You decide | Settle the exact input during planning | |

**User's choice:** Whatever the app currently displays, via resolveArtworkDataUrl

---

## Native side + failure visibility

### Q1 — Populate MediaStore's own metadata columns too?

| Option | Description | Selected |
|--------|-------------|----------|
| In-file tags only — let the scanner index them | One source of truth; scanner fills columns on the IS_PENDING flip; web and native produce identical files | ✓ |
| Write both — tags AND ContentValues columns | No scanner dependency; two surfaces that can later disagree | |
| In-file tags now; add columns only if the device test shows a gap | Evidence-driven; needs a device verification checkpoint | |

**User's choice:** In-file tags only
**Notes:** Claude flagged that scanner behaviour varies by OEM. Captured in D-15 as a named fallback remedy rather than speculative work.

### Q2 — What does the user see while tagging happens?

| Option | Description | Selected |
|--------|-------------|----------|
| Nothing new — tagging stays inside the existing spinner | quick-260913-omi just added real byte progress; a second progress concept for a sub-second step isn't worth it | ✓ |
| Show a distinct 'tagging' state | Honest if the art fetch takes its full 6s; new UI state for a usually-instant step | |
| You decide | Settle against measured art-fetch cost | |

**User's choice:** Nothing new

### Q3 — Does a slow cover hold up the file save?

| Option | Description | Selected |
|--------|-------------|----------|
| Wait for it, but keep the 6s cap | Art is the most visible tag; 6s is bounded and already enforced; a miss still saves every other tag | ✓ |
| Save immediately without art if not already resolved | Fastest; a search-tapped download reliably lands art-less — the feature's main use case | |
| Resolve art first, then start the audio fetch | Guarantees art; adds latency before the download even starts | |

**User's choice:** Wait for it, with the 6s cap

### Q4 — Should already-downloaded files get retro-tagged?

| Option | Description | Selected |
|--------|-------------|----------|
| No — new downloads only; note it as deferred | Retag means in-place rewrite of a whole library — its own failure modes, its own phase | |
| Yes — include a 'retag my downloads' action | Immediate value for everything on disk; materially widens the phase | |
| No, but make the codec reusable for it | Ship new-downloads-only with a retag-shaped API | |
| **Other (free text)** | "use a checkbox to let user decide before tagging" | ✓ |

**User's choice:** Free text — "use a checkbox to let user decide before tagging", clarified as **option 1: retro-tag is opt-in** (a user-run action in Settings → Downloads; new downloads always tagged).
**Notes:** The free-text answer was ambiguous between "retro-tag is opt-in" and "tagging itself is opt-in". Claude asked in plain text rather than re-prompting, and the user confirmed option 1. Claude then flagged a boundary the choice implies: a device-wide retag would need MediaStore scanning, which is Phase 34's unbuilt deliverable — so D-18 scopes the retag to the app's own downloads (`library.downloads` / `Music/OpenMusic/`), keeping this phase free of a hard dependency on 34.

---

## Claude's Discretion

- Whether to write a duration tag at all (D-09) — prior: let the container carry it.
- Exact sentinel/return shape for a tagged-vs-untagged save, given `DownloadResult` stays `'saved'` (D-06).
- Progress and result reporting for a retag batch (D-17/D-19).
- Exact placement and wording of the retag control in the Settings download page.
- How the album-page position parameter is threaded into `downloadTrack` without widening its signature for every other caller.

## Deferred Ideas

- Year / genre enrichment — revisit only with a call-budget decision first.
- Device-wide retag of files the app did not write — needs Phase 34's MediaStore scan.
- MediaStore `ContentValues` metadata columns — held as the remedy if the scanner fails on-device.
- Lyrics embedded as a tag (`USLT` / `©lyr` / `LYRICS`) — `Track.lrc` is in hand at download time, cheap to add later, but outside the scoped tag set.
- Reviewed todos (not folded): 4 matches from `todo.match-phase 36`, all generic-keyword hits unrelated to file tagging.
