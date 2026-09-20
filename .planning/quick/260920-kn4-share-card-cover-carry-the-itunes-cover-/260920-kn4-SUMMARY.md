---
phase: quick-260920-kn4
plan: 01
subsystem: share
tags: [share, og-card, cover, itunes, ytmusic]
requires:
  - src/lib/services/itunes-cover.ts (itunesSongCover, recallItunesId)
  - src/lib/services/share.ts (coverToken, songShareUrl)
  - src/lib/services/abort-signal.ts (combinedSignal)
provides:
  - TrackMenu share-card iTunes cover fallback (shareCoverFallback)
affects:
  - src/lib/components/TrackMenu.svelte
tech-stack:
  added: []
  patterns:
    - on-open prewarm $effect (AbortController + untrack + late-result drop), mirroring dlProbe/localProbe
    - module-scope per-uid session memo, hits only
key-files:
  created: []
  modified:
    - src/lib/components/TrackMenu.svelte
    - src/lib/services/share.test.ts
decisions:
  - "Share-card cover fallback resolves iTunes on menu open; the coverToken grammar and /api/og host allow-list are NOT widened (T-3uo-02 posture unchanged)"
  - "The prewarm never writes the cover cache — displayed art stays the YTM cover everywhere"
metrics:
  duration: 8 min
  completed: 2026-09-20
---

# Quick 260920-kn4: Share Card Cover — Carry the iTunes Cover Summary

Share links for songs showing a YouTube Music cover now carry `?ci=i:<itunes-id>` via an on-open iTunes prewarm, so `/api/og` renders real album art instead of the branded OpenMusic fallback — without widening the token grammar or changing any displayed cover.

## What Was Done

**Task 1 — grammar pin** (`src/lib/services/share.test.ts`, commit `54dcf56`)

Added one `quick-260920-kn4` case in the existing `coverToken` describe block asserting all three YouTube Music artwork hosts (`lh3.googleusercontent.com`, `i.ytimg.com`, `yt3.googleusercontent.com`) return `null`, both with and without an iTunes id as the second arg. The comment records *why* this is pinned (opaque irregular paths; `/api/og` fetch hosts must not widen per T-3uo-02) so a later "fix" to the grammar trips a red test. This passes against current code — a guard, not a RED test.

**Task 2 — prewarm + synchronous pick** (`src/lib/components/TrackMenu.svelte`, commit `f6f87fd`)

- Imports extended in place: `coverToken` onto the existing `$lib/services/share` import, `itunesSongCover` onto the existing `$lib/services/itunes-cover` import. No new modules.
- New `<script module lang="ts">` block holding `const shareItunesMemo = new Map<string, string>()` (uid → mzstatic URL). **Module scope rather than the plan's suggested instance const**: every list page mounts its own `<TrackMenu>`, so an instance field would re-issue the same iTunes GET on each page crossing. Hits only — a miss or abort is never memoised.
- `let shareCoverFallback = $state<string | null>(null)` plus an on-open `$effect` modelled on the `blobPresent` / `dlProbe` / `localProbe` siblings: deps kept to exactly `{open, track, activeCover}`; resets to null when closed; returns early when `coverToken(cover, recallItunesId(cover)) !== null` so a working carrier is never overridden; memo hit short-circuits; otherwise `untrack(() => itunesSongCover(target.artist, target.title, combinedSignal(8_000, ac.signal)))` with a late-result drop on `ac.signal.aborted || track?.uid !== target.uid` and `return () => ac.abort()`.
- Raw `target.artist` / `target.title` used, never the `names.dn*` display strings.
- No cover-cache writer is called; the only `writeCoverBoth` occurrence added is the 🔴 comment forbidding it.
- `doShare()`: `const shareCover = shareCoverFallback ?? activeCover;` hoisted **above** `onclose()` so the value is captured before the parent flips `open` false. Only that read moved; `dTitle`/`dArtist` and every existing decision-ref comment are untouched. No new `await` — `nav.share(` remains synchronously reachable from the gesture.

## Verification — observed results

| Check | Command | Observed |
|---|---|---|
| Typecheck | `pnpm check` | `COMPLETED 4576 FILES 0 ERRORS 0 WARNINGS 0 FILES_WITH_PROBLEMS` |
| Task 1 suite | `pnpm vitest --run src/lib/services/share.test.ts` | 1 file, **102 tests passed** |
| Task 2 suites | `pnpm vitest --run share.test.ts itunes-cover.test.ts` | 2 files, **128 tests passed** |
| Full suite | `pnpm test` | 145 files, **2974 tests passed** |
| `grep -c 'shareCoverFallback ?? activeCover'` | TrackMenu.svelte | `1` |
| `grep -c 'itunesSongCover('` | TrackMenu.svelte | `1` |
| `git diff \| grep -c '^+.*writeCoverBoth'` | TrackMenu.svelte | `1` — inspected: the prohibition **comment**, not a call |
| No new await before `nav.share(` | `sed`-scoped grep over `doShare` | Only the two pre-existing awaits (`nav.share`, `clipboard.writeText`) remain |
| Blast radius | `git status --short` on share.ts / og-cover.ts / api/og / cover-backfill.ts / cover-version.svelte.ts | empty — all untouched |
| quick-260920-kia preserved | grep | Share row still unconditional at L1291 |

**Live data-level proof of the carrier chain** (run here, not assumed): `itunes.apple.com/search?entity=song` returned HTTP 200 in 0.21 s for a real song, yielding `https://is1-ssl.mzstatic.com/.../1200x1200bb.jpg` and `collectionId 1817609404` — an mzstatic host and a 10-digit numeric id, inside `IT_ID = /^[0-9]{1,12}$/`, so `coverToken` emits `i:1817609404`. Both halves of the chain (`itunesSongCover → recallItunesId`, `coverToken(mzstatic, id) → i:<id>`) are already pinned by existing tests.

**NOT verified — requires a human at a browser.** The plan's Task 2 manual sanity step (dev server, open the menu on a googleusercontent-covered song, tap Share, inspect the clipboard URL for `?ci=i:<digits>`; then a Deezer-covered song still yields `?ci=d:<32hex>`; row/hero art unchanged in both) was **not performed** — it needs real UI interaction and clipboard access. The component wiring is the one piece with no node-testable coverage (no jsdom project in this repo), so this check is the remaining evidence gap.

## Deviations from Plan

**1. [Rule 2 — correctness] Module-scope memo instead of an instance-scope const**

- **Found during:** Task 2, step 2.
- **Plan text:** "a module-level `const` in the instance script is fine since the component is a singleton menu."
- **Actual:** Added a `<script module lang="ts">` block. A `const` in the instance script is per-instance, and TrackMenu is **not** a singleton — the codebase's known "per-page row boilerplate" debt means 5-6 list pages each mount their own. An instance const would fragment the memo per page and re-issue the iTunes GET on every page crossing, defeating the memo's stated purpose.
- **Files modified:** `src/lib/components/TrackMenu.svelte`
- **Commit:** `f6f87fd`

## Assumption Drift (advisory)

None material. The plan's anchors (`activeCover` at L162, the `blobPresent`/`dlProbe` effect idioms, `doShare` shape, the kia-modified Share row) all matched the file as found.

## Known Stubs

None.

## Threat Flags

None. No new network host, endpoint, or trust boundary was introduced — the prewarm reuses the existing client→`itunes.apple.com` tier with the same artist+title term, and the value that leaves on the share URL is still a closed-grammar `i:<digits>` token. T-kn4-01 (grammar not widened) and T-kn4-02 (bounded, gated, aborted, memoised) are both satisfied as planned.

## Commits

- `54dcf56` — test(quick-260920-kn4): pin YouTube Music cover hosts out of the coverToken grammar
- `f6f87fd` — fix(quick-260920-kn4): carry the iTunes cover on share links when the displayed art cannot tokenize

Diff vs `d88fe80`: 2 files, +118 / −3.

## Self-Check: PASSED

- `src/lib/components/TrackMenu.svelte` — FOUND (modified, committed)
- `src/lib/services/share.test.ts` — FOUND (modified, committed)
- `.planning/quick/260920-kn4-share-card-cover-carry-the-itunes-cover-/260920-kn4-SUMMARY.md` — FOUND
- Commit `54dcf56` — FOUND in `git log`
- Commit `f6f87fd` — FOUND in `git log`

## Browser verification (orchestrator, 2026-09-20)

The evidence gap the executor flagged — component wiring has no node coverage (no jsdom project) — is now CLOSED. Run against `pnpm dev` (port 4321) in the in-app browser pane, with `navigator.share` stubbed to capture its argument (the pane has no real share sheet, and stubbing avoids the clipboard-permission branch entirely):

**Case 1 — the fix firing (a ytmusic-covered track).** Search `富士山下 陳奕迅` → first result row `《富士山下》陳奕迅 — 微音` (`uid:joox:ZF309E51DDA505`). Opened its TrackMenu, waited ~3s for the on-open prewarm, tapped Share:

```
https://openmusic.lol/song/微音/《富士山下》陳奕迅?ci=i%3A1443345687&u=jooxZF309E51DDA505
```

Then read the cover cache for that same uid:

```
uid:joox:ZF309E51DDA505 → {"u":"https://yt3.googleusercontent.com/kyYKMO-z_whXchb5p6lQwPPf--OzC2Uyvs-0glizKfHeMsetyCGi9qkU3A-zX2GGRXYJfT…"}
微音|富士山下陳奕迅      → (same googleusercontent URL)
```

This is the decisive pair. `coverToken` returns null for a `yt3.googleusercontent.com` URL BY GRAMMAR (now pinned by Task 1's test), so `?ci=i:1443345687` cannot have come from `activeCover`. It can only have come from `shareCoverFallback`. Before this change the same tap would have emitted NO `ci` at all and the card would have fallen through to `/api/og`'s text re-resolve → `OG_FALLBACK_BYTES`.

**Displayed art unchanged (the explicit non-goal).** Both cache layers still hold the googleusercontent URL after the share — no iTunes URL was written to the shared cover cache, so the hero and every row still paint exactly what they painted before.

**Case 2 — a track that tokenizes on its own.** Search `Hotline Bling` → `Hotline Bling — Drake`, shared as `?ci=i%3A1440841363&u=jooxZ4CB0DF64EC09E`. The existing carrier path is intact.

**Premise confirmed at scale.** A dump of the live cover cache shows the displayed covers are overwhelmingly `yt3.googleusercontent.com` (王菲|知己知彼, 古巨基|必殺技, 陳奕迅|最佳損友, 陳慧嫻|飄雪, 吳雨霏|逼得太緊 …). That is the population that had silently lost its `?ci=` carrier after quick-260919-0mw promoted YTM to the front of the tier chain — i.e. the user-reported "shows openmusic as cover sometimes" was closer to "most of the time" for a CJK library.

**Still not verified:** the real iOS `navigator.share` sheet (the gesture path). The stub proves `nav.share` is reached with the right payload and the code introduces no `await` before it, but only a real device proves the gesture survives. Also untested: a song iTunes does not carry at all — that still degrades to the branded card, which is the pre-existing server-chain behaviour, not a regression.
