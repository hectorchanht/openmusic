---
phase: quick-260919-2jo
plan: 01
subsystem: display-names / settings / routing
tags: [i18n, zh-convert, settings, download-tags, url-state]
requires:
  - src/lib/services/zh-convert.ts (tongwen s2t + t2s, already present)
  - src/lib/stores/names.svelte.ts (the single dn* resolver seam)
  - src/lib/services/audio-tags.ts (albumTag, from quick-260919-0mw)
provides:
  - lockScriptSync / warmScript / warmT2S / t2sConvertLineSync (zh-convert)
  - settings.zhScript ('off' | 'zh-Hant' | 'zh-Hans')
  - names.zhLock() — the script lock without the translation layer
  - pickTab / tabHref / syncTabUrl (url-tab.ts)
affects:
  - every names.dn* surface (110 call sites): rows, now-playing, Nowbar, OS media card, document title, share links, download filename
  - the album tag written by downloadTrack and by the bulk retag
  - /library and /artist/[name]/albums URLs
tech-stack:
  added: []          # zero new dependencies — tongwen-core/tongwen-dict were already installed
  patterns: [never-throw-degrade-to-identity, once-per-target-warm-latch, validated-url-param]
key-files:
  created:
    - src/lib/services/url-tab.ts
    - src/lib/services/url-tab.test.ts
  modified:
    - src/lib/services/zh-convert.ts
    - src/lib/services/zh-convert.test.ts
    - src/lib/config/defaults.ts
    - src/lib/stores/settings.svelte.ts
    - src/lib/stores/settings.svelte.test.ts
    - src/lib/stores/names.svelte.ts
    - src/lib/stores/names.test.ts
    - src/lib/services/download-track.ts
    - src/lib/services/download-track.test.ts
    - src/lib/services/retag.test.ts
    - src/routes/(app)/settings/translation/+page.svelte
    - src/routes/(app)/settings/downloads/+page.svelte
    - src/routes/(app)/library/+page.svelte
    - src/routes/(app)/artist/[name]/albums/+page.svelte
    - src/lib/i18n/*.ts (15 dictionaries)
decisions: [D-1, D-4, D-5, D-6, D-7, "Rule-2 sibling fix at the bulk-retag entry"]
metrics:
  duration: ~11 min
  tasks: 4 (+1 deviation)
  commits: 5
  files_changed: 31
  completed: 2026-09-19
---

# Quick 260919-2jo: Chinese script lock + URL-persistent tabs — Summary

A Settings → Translation control that forces every displayed Chinese title / artist / album into
one script (Traditional or Simplified), applied at the single `names.resolve` seam so all 110
`dn*` call sites inherit it, plus one shared `?tab=` read/write mechanism wired into the Library
and the artist discography.

## What shipped

| Task | Commit | What |
|---|---|---|
| 1 (F1) | `f02f523` | `warmT2S` / `t2sConvertLineSync` (the missing sync mirror), `ZhScript`, `lockScriptSync`, `warmScript` |
| 2 (F1) | `be84f71` | `settings.zhScript` + its validated load parse, the segmented control, 2 keys × 15 dictionaries |
| 3 (F1) | `3c0d54d` | the lock applied at `names.resolve`; `names.zhLock()`; the download album tag |
| — | `a9d7534` | **deviation (Rule 2):** the same raw-album fix at the bulk-retag entry |
| 4 (F2) | `14b47d3` | `url-tab.ts` (`pickTab` / `tabHref` / `syncTabUrl`) + both call sites |

Zero new dependencies — `tongwen-core` + `tongwen-dict` were already installed and already imported
by `zh-convert.ts`. No package-manager command ran (T-2jo-SC).

## Does the lock fix the motivating bug? (`過一招` title vs `过一招` album)

**Partly — and the specific screenshot was already fixed by an earlier task, not by this one.
Read this section before claiming the bug is closed.**

The raw string was carried by `src/lib/services/download-track.ts`, at the tag seam:

```ts
album: albumTag(r.album, r.title, dnTitle)   // before
album: albumTag(names.zhLock(r.album), r.title, dnTitle)   // after
```

`dnTitle` goes through `names.dn*` and is script-converted; `r.album` was the RAW catalog string.
That asymmetry is the whole bug. Three distinct cases, stated separately because they do not all
resolve the same way:

1. **Album == title in the opposite script** (the user's exact screenshot: file
   `Polar G - 過一招 (feat. 拉天糖).m4a`, album tag `过一招 (feat. 拉天糖)`). This was ALREADY closed by
   `quick-260919-0mw`, which widened `albumTag` to compare the album against BOTH the raw title and
   `dnTitle` — the album matches the raw title and is OMITTED entirely (36-D-10). There is a
   pre-existing test for it (`download-track.test.ts`, "SCRIPT MISMATCH: a Simplified album equal to
   the Traditional display title is dropped"). **This task did not fix that case; it was already
   fixed.** The plan's task-3 behaviour note framed it as the thing `zhLock` would close, and that
   framing was stale.
2. **A genuine, DISTINCT album name.** `albumTag` keeps it, and before this task it was written in
   whatever script the catalog used while the title tag beside it carried the user's script. This is
   what the lock actually fixes, and it is the residual half of the reported bug. New test:
   "SCRIPT LOCK: a DISTINCT album is written in the locked script".
3. **Lock OFF (the D-1 default) but `titleLang: zh-Hant` ON.** The mismatch in case 2 REMAINS. With
   the lock off `zhLock` is byte-for-byte identity, so a user who gets Traditional titles from the
   translation layer alone still gets a raw-script album tag. Closing that would mean inferring a
   script from `titleLang`, which is a translation target, not a script — out of scope and
   deliberately not done. **A user reporting this bug must turn the lock on.**

**Already-downloaded files are NOT retroactively fixed.** Their tags are bytes on disk; nothing
rewrites them until the user runs Settings → Downloads → "Retag downloaded songs" (or edits one
song in the metadata editor). That repair path had the identical raw-album bug — see the deviation
below — so it is fixed too, but it still requires an explicit user gesture (36-D-17: retag never
runs on its own).

## D-2 — the metadata editor's hand-typed text, traced

The plan asserted the exemption "holds by construction — `MetadataEditor` never writes a display
model, so a hand-edited string never re-enters `names.resolve`". **Traced, and that reasoning is
half wrong.** The conclusion holds for the FILE; it does not hold for the screen.

Path, verbatim:

1. `MetadataEditor.svelte:68-76` seeds its inputs from `names.dnTitle(tr.title)` / `dnArtist` inside
   an `untrack`ed, open-only `$effect`. So the fields start from display strings (already locked, if
   the lock is on) — but whatever the user leaves in the box is what moves on.
2. `save()` builds `patch = { title, artist, album }` from the raw input values and calls
   `retagOne({ uid, ...patch, cover, lyrics })`.
3. `retag.ts` contains **no reference to `names`, `dnTitle`, `dnArtist` or `zhLock`** (its own purity
   test asserts it imports nothing from `$lib/stores`). It hands `entry.title` straight to
   `tagAudioBlob`. **The file on disk therefore carries the typed string verbatim — the lock never
   touches it.** That is the exemption, and it is real.
4. **But** `onsaved(patch)` (`TrackMenu.svelte:1005`) then calls `library.applyMetadata(uid, patch)`
   and `player.adoptMetadata(uid, patch)`, which assign the typed strings onto `Track.title` /
   `.artist` / `.album` in the in-memory + persisted library model. Every render of those tracks goes
   through `names.dnTitle(track.title)` → `resolve` → `applyLock`. **So a hand-typed Chinese title IS
   re-scripted on screen while the lock is on**, because once it is in the catalog model it is
   indistinguishable from catalog text.

No code was added for this (conservative option, user asleep). Exempting it would need a persisted
"user-edited uid" set threaded through the lock — new persisted state, i.e. a Rule 4 architectural
call, and arguably the wrong behaviour anyway (a user who asks for "everything in Traditional"
probably means everything). Flagging it here rather than silently shipping a claim that is only
true at the disk boundary.

## F2 — the tab-set inventory

| # | Tab set | Verdict | Why |
|---|---|---|---|
| 1 | `/library` — liked / playlists / downloads / fav-artists / history | **CONVERTED** | It already READ `?tab=` (D-13) but never wrote it back. `pickTab` replaces the inline read+validate; `setTab` now also calls `syncTabUrl`. Precedence UNCHANGED: `?playlist=` beats `?tab=` beats the stored tab. |
| 2 | `/artist/[name]/albums` — Albums&EPs / Singles / All | **CONVERTED** | Was plain `$state` with no URL at all. Seeded via `pickTab` against a new `VALID_FILTERS`; each pill writes back. `?tab=single` is now a real cold-load target. |
| 3 | `NowPlaying` — Up Next / Lyrics / Related | **DEFERRED, not skipped** | NowPlaying is an overlay over whatever route is underneath and its open/closed state is not in the URL (`overlays.svelte.ts` uses raw `history.pushState` on purpose). On a cold load of `/library?np=lyrics` there is no overlay open and no track playing — there is nothing for the param to address. Converting it would mean designing overlay-state-in-URL first. |
| 4 | Settings sections | **NO WORK** | Already separate routes (`/settings/translation`, …) — URL-addressable by construction. |
| 5 | Charts sections | **NO WORK** | Same — already separate routes. |

`syncTabUrl` uses RAW `history.replaceState`, never `$app/navigation` (asserted by a
comment-filtered source test): SvelteKit's shallow-routing `pushState`/`replaceState` desync the
router index and make a later `goto()` a no-op, which `overlays.svelte.ts` documents at length.
`replace` adds no history entry, so the overlay-depth == history-depth invariant is untouched and
Back still leaves the page instead of replaying tab switches. D-5 holds: the default tab is stripped
from the URL, every other query param survives (`?playlist=abc` survives a tab switch, tested).

## Deviations from Plan

### Auto-fixed

**1. [Rule 2 — missing critical functionality] The bulk-retag entry carried the same raw album**
- **Found during:** tracing the motivating bug for this SUMMARY (after Task 4).
- **Issue:** `src/routes/(app)/settings/downloads/+page.svelte:114` built its `RetagEntry` list with
  `title: names.dnTitle(d.title)`, `artist: names.dnArtist(d.artist)` — and `album: d.album`, the raw
  catalog string. Identical shape to the download-seam bug the plan names, at a sibling caller the
  plan did not list. It matters more than the fresh-download path: this page is the ONLY route a user
  has to repair files downloaded before the lock existed, so fixing only `download-track.ts` would
  have shipped a "repair" that re-creates the bug.
- **Fix:** `album: names.zhLock(d.album)` + a source-composition test in `retag.test.ts` (the helper
  lives in a `.svelte` route and is not exported, so the assertion is at the source — the
  `names.test.ts` share-call-site idiom).
- **Commit:** `a9d7534`

### Assumption Drift (advisory)

1. **`dn*` call-site count.** Plan `<research_findings>`: "26 call sites". Measured: **110**
   (`grep -rn "names\.dn" src/ --include=*.svelte --include=*.ts`, tests excluded). The conclusion is
   unchanged and in fact stronger — one wrap at `resolve` covers all of them — but the number in the
   plan is wrong and the SUMMARY uses the measured one.
2. **Which case the album lock closes.** Plan task-3 behaviour: "`r.album = '过一招 (feat. 拉天糖)'` with
   `dnTitle = '過一招 (feat. 拉天糖)'` now compares equal and the album is correctly OMITTED". It already
   compared equal before this task — `quick-260919-0mw` passes BOTH the raw title and `dnTitle` to
   `albumTag`, and a test for exactly that string pair predates this work. The lock's real
   contribution is case 2 above (a distinct album). Recorded rather than quietly re-scoped.
3. **`ZhScriptSetting`'s home.** Plan put the type in `defaults.ts`. It lives in
   `settings.svelte.ts` beside `LyricsLang` / `SourceLang` / `TranslateMode`, and `defaults.ts`
   picks it up through its existing type-only import line — zero new import edges, and `settings`
   stays a LEAF (it imports nothing from `zh-convert`; the 3-member union is written out literally
   there so the leaf property holds).

## Verification

| Check | Result |
|---|---|
| `pnpm check` | **0 errors, 0 warnings**, 4540 files |
| `pnpm test` (full, unfiltered — 37-03's mock-leak warning respected) | **132 files / 2632 tests passed** |
| `pnpm vitest --run src/lib/services/zh-convert.test.ts` | 32 passed (22 pre-existing + 10 new) |
| `pnpm vitest --run src/lib/i18n/i18n.test.ts` | 29 passed — key-set parity green across all 15 |
| **F1 regression gate:** `names.test.ts` run UNMODIFIED after the `resolve` wrap | **11/11 passed** — the proof of D-1. The fixture had no `zhScript` at all, so `applyLock` saw `undefined`, took the not-a-script branch and returned input byte-for-byte. The 7 new lock tests were added only afterwards. |
| `grep -v '^\s*//' src/lib/services/url-tab.ts \| grep -c "from '$app/navigation'"` | **0** |

New test coverage: 10 (zh-convert) + 5 (settings) + 7 (names) + 12 (url-tab) + 2 (download-track) +
1 (retag) = **37 new tests**.

### NOT verified — needs a device or a live browser

No browser and no device in this session, so every check below is unexercised. None of it is
implied by the green suite:

- The lock actually repainting the **OS lock-screen / media-session card** and the **document
  title**. Both read `names.dn*` (`player.svelte.ts:1398`, `+layout.svelte:55`) so they inherit it
  structurally, but the repaint was not observed.
- The **cold-dict `warmLock` repaint** — i.e. that a first render in the source script is followed by
  a converted one once the tongwen dict lands. The rev-bump path is exercised only indirectly
  (tests await `warmScript` before asserting).
- **Tag inspection of a real downloaded file** in a file manager (title and album in one script).
- The **segmented control's rendering** on Settings → Translation (three pills, endonym labels).
- **Address-bar behaviour**: `?tab=downloads` appearing on a Library tab switch, surviving a reload,
  and Back still leaving the page rather than walking back through tab switches. `syncTabUrl` is
  `browser`-guarded, so the node test can only assert it is a no-op under SSR.
- `/artist/<name>/albums?tab=single` opening cold on Singles.

## Self-Check: PASSED

All created files exist on disk (`src/lib/services/url-tab.ts`, `url-tab.test.ts`, this SUMMARY);
all 5 commits resolve in `git log` (`f02f523`, `be84f71`, `3c0d54d`, `14b47d3`, `a9d7534`).
Nothing pushed to origin. `ROADMAP.md` / `STATE.md` untouched — orchestrator-owned.
