---
phase: quick-260919-1we
plan: 01
subsystem: lyrics
tags: [lyrics, trackmenu, nowbar, settings, i18n, localstorage]
requires: [catalog.lyricWalk, services/lrc, stores/cover-version (as the shape to copy)]
provides:
  - services/lyric-pins (bounded per-uid LRC pin store)
  - stores/lyric-pins.svelte (lyricVersion / readLyrics / pinLyrics / unpinLyrics)
  - catalog.collectLyricCandidates
  - lrc.activeLineAt
  - settings.nowbarLyrics
affects: [NowPlaying lyrics pane, TrackMenu, Nowbar, Settings -> Playback, MetadataEditor retag]
tech-stack:
  added: []
  patterns: [wrap-dont-rewrite reactive version signal, read-time pin layering, enumerate-all collector beside a stop-at-first walk]
key-files:
  created:
    - src/lib/services/lyric-pins.ts
    - src/lib/services/lyric-pins.test.ts
    - src/lib/stores/lyric-pins.svelte.ts
    - src/lib/stores/lyric-pins.svelte.test.ts
  modified:
    - src/lib/services/catalog.ts
    - src/lib/services/catalog.test.ts
    - src/lib/services/lrc.ts
    - src/lib/services/lrc.test.ts
    - src/lib/components/TrackMenu.svelte
    - src/lib/components/NowPlaying.svelte
    - src/lib/components/Nowbar.svelte
    - src/lib/config/defaults.ts
    - src/lib/stores/settings.svelte.ts
    - src/routes/(app)/settings/playback/+page.svelte
    - src/lib/i18n/*.ts (all 15)
decisions: [D-1, D-2, D-3, D-4, D-5, D-6, D-7, D-8]
metrics:
  tasks: 5
  commits: 5
  files-changed: 29
  completed: 2026-09-19
---

# Quick 260919-1we: Lyrics picker + reloader in the song menu, and the Nowbar lyric line — Summary

Two features on the existing lyric machinery: a per-uid **lyric pin** (`openmusic:lyric-pins:v1`)
that a `Fix lyrics` sheet in `TrackMenu` writes from a live per-source walk, applied at READ time so
it outranks every other lyric source on every surface at once; and an opt-in docked-Nowbar line that
replaces the artist name with the currently-sung lyric.

## What shipped

| # | Commit | What |
|---|--------|------|
| 1 | `2d6caa7` | `services/lyric-pins.ts` (+ 9 tests) and the `stores/lyric-pins.svelte.ts` reactive wrapper |
| 2 | `8a6f2fc` | `lyricFromSource` extracted from `lyricWalk`; `collectLyricCandidates` added beside it (+ 7 tests) |
| 3 | `de6192d` | The Fix-lyrics row + picker sheet, the `readLyrics` read sites, 5 keys × 15 dictionaries (+ 6 tests) |
| 4 | `61d97d2` | `lrc.activeLineAt` extracted pure (+ 5 tests); the `nowbarLyrics` setting, its toggle, 2 keys × 15 dictionaries |
| 5 | `0a315a2` | The docked Nowbar lyric line |

F1 is commits 1–3, F2 is commits 4–5. They are not mixed.

## The three things you asked me to state plainly

### 1. Does a user's explicit pin actually beat Phase 37's embedded-LRC path for a downloaded song?

**Yes, by construction — and I proved it with a runnable test, not by reading code.**

The mechanism (D-4): `readLyrics(track)` is `getPinnedLyrics(uid) ?? track?.lrc ?? null`. Phase 37's
embedded path is `player.enrichFromLocalFile`, whose entire lyric effect is one line
(`src/lib/stores/player.svelte.ts:791`):

```ts
if (found.lrc && !cur.lrc) this.current = { ...cur, lrc: found.lrc };
```

It writes the file's tag onto `current.lrc` — which is only the **second** rung of `readLyrics`. It
never reads or clears the pin record, so the pin wins regardless of ordering. Phase 37's *other*
lyric writer, `backfillLyrics(q)`, lands on the same field and loses the same way.

The proof is `src/lib/stores/lyric-pins.svelte.test.ts` (6 assertions, node-runnable, no jsdom).
It reconstructs that exact write and asserts the read both ways round:

- pin first, then enrichment lands on `current.lrc` → the read returns the pin;
- enrichment first (read returns the file's tag), then the user pins → the **same object**, no
  player call, no replay, and the read returns the pin;
- plus the case that motivated read-time layering at all: a whole-object `{ ...cur, ... }`
  reassignment — the shape of the four `this.current = …` sites that would clobber a pin written
  *into* the track — leaves the pin standing.

I wrote that test even though the plan said the wrapper needed none (see Deviations). Without it the
headline claim of F1 was only provable by reading two files side by side.

The one thing the test cannot cover is the **device/imported** case end-to-end: `enrichFromLocalFile`
only runs against a real offline blob. The logic above is field-level and blob-independent, so I am
confident in it, but see §3.

### 2. Does the Nowbar line write the DOM on line change, or every `timeupdate` tick?

**On line change.** Reasoned, not profiled — it is a structural property of the derived, and there is
no meter in this repo I could point at instead.

Three separate things keep the tick cost off the DOM:

- `lyricLines = $derived(parseLRC(readLyrics(player.current) ?? ""))` depends on the lyric **string**
  and `lyricVersion()`, **not** on `player.currentTime`. So `parseLRC` runs once per *track*, not per
  tick. (It is also `parseLRC` alone — no `reorderPairs` / `splitParenLines`, which exist to serve
  NowPlaying's stacked pane and have no meaning in an 11px single row.)
- `lyricText = $derived.by(...)` does depend on `currentTime`, so it re-**evaluates** ~4×/s. Its body
  is an early return plus one `activeLineAt` forward scan over tens of lines. With the setting off it
  is a single boolean read and nothing else — the gate precedes the scan.
- It returns a **string**, and the render site is `{#key lyricText}` around a text interpolation.
  Svelte 5 re-creates a keyed block only when the key actually differs, so ~4×/s of identical strings
  produce **zero** DOM writes; the write (and the `in:fade`) happens on the tick where the line
  changes. No `$effect`, no `logAction`, nothing else added to the timeupdate firehose.

The stability that makes this true at the logic level is asserted in `lrc.test.ts` — `activeLineAt`
returns the same `{idx, time}` for every `now` inside one line's span (`5` and `7.2` both → `idx 0`).

### 3. What I could not verify without a device or a live browser

No browser or device automation was available in this session, so everything below is verified by
type-checking and unit tests only:

- **The sheet actually opening and listing rows.** `collectLyricCandidates` is unit-tested against
  mocked adapters. A real walk hits live upstreams, and per MEMORY only kuwo and Deezer are reachable
  from this sandbox (netease/qq Meting proxies are blocked), so a real run here would show a
  one-row or empty sheet regardless of correctness — it would prove nothing either way.
- **The dry-walk Retry row and the Use-automatic row rendering.** Their conditions are pure
  (`!lyricCandidates.length`; `readLyrics(track) !== (track.lrc ?? null)`) and type-check, but I never
  saw them on screen.
- **"No layout shift, no flicker" in the Nowbar.** `.np-lyric` sets no height, margin or padding and
  shares `.np-artist`'s `font-size: 11px`, so the row geometry is unchanged by construction — but
  I did not measure the rendered row height in either branch.
- **Persistence across an app restart.** The round-trip is unit-tested against an in-memory
  localStorage stub; a real reload was not exercised.
- **The `Mic2` icon rendering.** Confirmed present in the installed `@lucide/svelte`
  (`dist/icons/mic-2.js`) and it type-checks; not seen rendered.
- **The MetadataEditor retag writing the chosen lyrics into a file.** `retagOne` needs a real blob.
- **All 13 non-English translations are mine, unreviewed by a native speaker.** Key-set parity is
  machine-enforced (`i18n.test.ts`, 29 assertions); wording is not.

## Decisions carried into the code

Every one is tagged `quick-260919-1we` at its implementation site with its D-ref.

- **D-1/D-2** — per-uid key `openmusic:lyric-pins:v1`, storing the **LRC text**, not a source id.
- **D-3 / T-1we-01** — both caps live at the writer: reject `> 20 000` chars (never truncate — a half
  LRC is a worse lie than no pin; a pre-existing pin survives the rejection), trim to 100 entries
  oldest-first. This is the one way the feature could have broken something unrelated: localStorage is
  a shared origin quota and the cover cache's writer swallows `QuotaExceededError`, so an unbounded
  record would have surfaced as "covers silently stopped caching".
- **D-4** — read-time layering, one definition, used at every lyrics surface.
- **D-5** — one row per source, same `matchKey` + `scoreMatch` step as the walk (`lyricFromSource`,
  extracted verbatim), `LYRICLESS_SOURCES` skipped. No second ranking algorithm.
- **D-6** — the sheet open *is* the reloader; Retry only on a dry walk, Use-automatic only when a pin
  exists. Dropping a pin reuses `menu.lyricsAuto` as its toast rather than minting a sixth key.
- **D-7** — `nowbarLyrics: false`, mirroring `showQualityTag`.
- **D-8** — the lyric **replaces** the artist line; the `embed` variant is excluded.

## Deviations from Plan

### Auto-added

**1. [Rule 2 — missing verification] Added `src/lib/stores/lyric-pins.svelte.test.ts`**
- **Found during:** Task 3.
- **Plan said:** the reactive wrapper "gets no test of its own (runes + rAF)".
- **Why I added one anyway:** F1's headline claim — the pin beats Phase 37's embedded LRC — was
  otherwise unprovable except by reading `player.svelte.ts:791` next to `readLyrics`. The file runs
  fine under the node project (no jsdom needed; `bumpLyricVersion` takes its documented synchronous
  rAF fallback), so the cost was six assertions.
- **Commit:** `de6192d`.

**2. [Rule 2 — correctness] The Nowbar lyric yields to `player.error`**
- **Found during:** Task 5.
- **Issue:** the plan's markup puts the `player.error` branch inside the `{:else}`, with the stated
  intent "a playback error must never be hidden behind a lyric". As written, a non-empty `lyricText`
  would have taken the row and hidden the error.
- **Fix:** `if (player.error) return "";` in `lyricText`'s early-return block, so an error hands the
  row back to the artist+error branch. Markup matches the plan; intent is now actually enforced.
- **Commit:** `0a315a2`.

### Adjusted without changing intent

**3. `collectLyricCandidates` ordering assertion rewritten.** The plan's prose and the old
`crossSourceLyric` comments say "kuwo-first", but the registry was reordered on 2026-08-31 (kuwo's
upstream cert expired; qq took the primary seat). My first ordering test asserted kuwo-first and
failed. Rewritten to assert **registry order against deliberately inverted completion order** (kuwo
answers instantly, qq last) — which is the property that actually matters and is a stronger test than
the one that would have passed. No production change.

**4. `MetadataEditor`'s `lyrics` prop now falls back to the row's own track.** Previously
`player.current?.uid === track.uid ? player.current.lrc : null`; now
`readLyrics(current-if-same-uid, else track)`, per the plan's explicit instruction. A non-current
track therefore contributes its own `lrc` where it used to contribute `null`. Still zero network —
the editor never resolves.

**5. `NowPlaying`'s `lines` derived uses an IIFE.** `readLyrics(...)` is called once and reused rather
than called twice (guard + argument), because each call takes the `lyricVersion()` dependency.
Cosmetic; same semantics.

### Assumption Drift (advisory)

**Registry order is qq-first, not kuwo-first.** The plan (and the surviving comments in `catalog.ts`)
describe the lyric walk as a "kuwo-first walk". Live `SOURCES` order is
`qq, netease, kuwo, joox, fivesing, jamendo, audius, ytmusic`. Nothing in this task depends on which
source leads — both the walk and the collector just inherit `getEnabledAdapters({})` — but a reader
of the new comments should not take "kuwo-first" literally. I did not touch the stale comments;
they are pre-existing and out of scope.

## Known Stubs

None.

## Threat Flags

None. The plan's register is fully honoured:

- **T-1we-01** (DoS, quota) — mitigated at the writer, both caps asserted in tests.
- **T-1we-02** (tampering) — upstream LRC text reaches the DOM only through Svelte text
  interpolation, which escapes. `grep -c "@html"` over `TrackMenu.svelte` / `Nowbar.svelte` returns
  one hit and it is my own comment saying not to add one.
- **T-1we-03** (DoS, fan-out) — the parallel walk fires on the row tap only, is wrapped in
  `combinedSignal(15_000, ac.signal)`, aborts on a re-tap via the generation guard, and `lyricAc` is
  aborted in `close()` alongside `coverAc`/`dlPickAc`.
- **T-1we-04** (info disclosure) — accepted as planned; public lyric text, no new origin.

## Verification

- `pnpm check` — **0 errors, 0 warnings**, 4538 files.
- `pnpm test` — **131 files, 2595 tests, all passing** (the whole suite, not a filtered `-t` run —
  37-03's SUMMARY warns that mocked cover-cache reads leak between suites in `player.svelte.test.ts`).
- `catalog.test.ts` 76/76, with the pre-existing `lyricByName` describe block **unmodified** — the
  regression gate for Task 2's extraction.
- `i18n.test.ts` 29/29 — key-set parity across all 15 dictionaries.
- `grep -rn "readLyrics(" NowPlaying Nowbar TrackMenu` — present in all three.
- Both caps present in code, not only in prose.

## Self-Check: PASSED

All four created files exist on disk; all five commit hashes resolve in `git log`.
