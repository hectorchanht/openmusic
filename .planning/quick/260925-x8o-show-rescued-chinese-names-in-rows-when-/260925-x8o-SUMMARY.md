---
phase: quick-260925-x8o
plan: 01
subsystem: display-names
tags: [i18n, names, zh-script-lock, name-rescue, display-seam]
requires:
  - quick-260925-wa7 (verified English→Chinese pairs in openmusic:name-rescue:v1)
  - quick-260919-2jo (Chinese script lock in names.svelte.ts)
provides:
  - readRescueHits() / onRescueHit() in services/name-rescue.ts
  - alias layer in names.svelte.ts — dnTitle(text, artist?) / dnArtist(text)
affects:
  - every song-title surface (rows, home shelves, Up Next, Related, Now Playing, Nowbar, TrackMenu, VersionPicker, search suggestions, downloads sweep, document.title, OS media card, download filename/tags, share link)
tech-stack:
  added: []
  patterns:
    - pure-module subscribe/notify hook → runes store rev bump (keeps the pure/runes split)
    - source-grep present/absent guard for optional-argument call sites
key-files:
  created: []
  modified:
    - src/lib/services/name-rescue.ts
    - src/lib/services/name-rescue.test.ts
    - src/lib/stores/names.svelte.ts
    - src/lib/stores/names.test.ts
    - src/lib/components/SongRow.svelte
    - src/lib/components/NpUpNext.svelte
    - src/lib/components/NpRelated.svelte
    - src/lib/components/Nowbar.svelte
    - src/lib/components/NowPlaying.svelte
    - src/lib/components/TrackMenu.svelte
    - src/lib/components/VersionPicker.svelte
    - src/routes/(app)/+page.svelte
    - src/routes/(app)/search/+page.svelte
    - src/routes/(app)/settings/downloads/+page.svelte
    - src/routes/+layout.svelte
    - src/lib/stores/player.svelte.ts
    - src/lib/services/download-track.ts
    - src/lib/services/download-track.test.ts
    - CLAUDE.md
decisions:
  - "Rescued aliases bypass /api/translate and go only through the script lock; the translation cache is never written with alias text"
  - "Title alias is keyed by matchKey(track artist, title); an artist alias is created only for a single-performer zh artist"
  - "Under zh-Hant an alias round-trips through Simplified before the s2t lock (tongwen phrase table is keyed on Simplified; a raw s2t over-converts 周杰倫 to 周傑倫)"
  - "Display ignores the 30-day lookup TTL; MAX_ENTRIES (500) still bounds the set; misses never alias"
  - "TrackMenu share title passes the artist, giving /song/周杰倫/珊瑚海 instead of the hybrid /song/周杰倫/Coral Sea"
  - "names.clearCache() does not touch the rescue cache (resolution cache, not translation cache)"
metrics:
  duration: ~10 min
  completed: 2026-09-26
  tasks: 3
  files: 19
---

# Quick 260925-x8o: Show rescued Chinese names in rows when the Chinese script lock is on — Summary

A wa7-verified pair like "Coral Sea / Jay Chou" → 珊瑚海 / 周杰倫 now shows on every song-title surface while Settings → Translation → Chinese script is zh-Hant (珊瑚海 / 周杰倫) or zh-Hans (珊瑚海 / 周杰伦). With the setting off, the output is unchanged byte for byte. All of it goes through one alias layer in the `names` display seam.

## Commits

| Task | Commit | Description |
|------|--------|-------------|
| 1 | 5344441 | `readRescueHits()` (TTL-free, shape-guarded) + `onRescueHit()` notify hook, fired after the persist attempt so a quota failure still repaints |
| 2 | c70e51b | Alias layer in `names.svelte.ts`: `dnTitle(text, artist?)`, `dnArtist`, one hydration read per session, live repaint through `rev` |
| 3 | f09d9e3 | 32 song-title call sites pass their own artist; 14-row source-grep guard; urx TrackMenu row updated; download-track assertion; CLAUDE.md row |

## Verification (observed)

- Task 1 gate: name-rescue.test.ts 40/40; full suite 152 files / 3306 tests passed; `pnpm check` 0 errors 0 warnings; `pnpm build` done.
- Task 2 gate: names.test.ts 28/28; full suite 3316 passed; check 0/0; build done.
- Task 3 gate: `bare song-title dnTitle sites left: 0` (32 on HEAD db18376 before the edits); names + download-track tests 92/92; full suite 3330 passed; check 0/0; build done.
- RED confirmed before each GREEN: Task 1 had 5 new tests failing; Task 2 had 5 failing; Task 3 had all 14 guard rows plus the updated urx row failing on the unedited call sites.
- **Live check** against the user's dev server on :5173, in a throwaway headless Chrome 154 profile over CDP. I seeded `openmusic:name-rescue:v1` = `{'jaychou|coralsea': {a:'周杰倫', t:'珊瑚海', at}}`, a restored current track (Coral Sea / Jay Chou), and two liked rows (Coral Sea / Jay Chou, Coral Sea (Chillout Mix) / Black Pearl), then loaded `/library`:
  - zh-Hant: Library SongRow `珊瑚海 周杰倫`; Nowbar `珊瑚海` + `周杰倫`; document.title `珊瑚海 • 周杰倫`; Black Pearl row `Coral Sea (Chillout Mix) Black Pearl` (not aliased).
  - zh-Hans: SongRow `珊瑚海 周杰伦`; Nowbar `珊瑚海` / `周杰伦`; document.title `珊瑚海 • 周杰伦`; Black Pearl row not aliased.
  - off: SongRow `Coral Sea Jay Chou`; Nowbar `Coral Sea` / `Jay Chou`; document.title `Coral Sea • Jay Chou`.
  - A second zh-Hant pass matched the first exactly. On the very first pass the Nowbar and title were missing. The cause was my harness, not the app: the seeding page's pagehide `persist()` (current = null) wiped the seeded player key. The fix was to seed with `Page.addScriptToEvaluateOnNewDocument`; the Library rows were correct on every pass.
- Not live-verified: the OS media card (native/Media Session UI), NowPlaying expanded view, TrackMenu, the tap-time live repaint driven by a real rescue, and download file tags. These are covered by unit tests (the source-grep guard plus the live-repaint `rev` test), not observed in a browser.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] The zh-Hant lock over-converted the Traditional alias 周杰倫 to 周傑倫**
- **Found during:** Task 2 (GREEN run)
- **Issue:** `lockScriptSync` uses tongwen s2t, whose phrase table is keyed on Simplified. `周杰伦 → 周杰倫` is correct, but an already-Traditional `周杰倫` is char-mapped `杰 → 傑` and comes out `周傑倫`. Aliases arrive in Traditional (YTM zh-TW / iTunes HK). Sent straight to `applyLock`, the rescued row would have shown 周傑倫 while CN-catalog rows of the same artist show 周杰倫.
- **Fix:** `private lockAlias(a)` in names.svelte.ts: under zh-Hant, `lockScriptSync(a, 'zh-Hans')` first, then `applyLock`. The t2s dict is warmed once through the existing `warmLock('zh-Hans')` latch, and its rev bump repaints a cold first render. zh-Hans is unchanged. The zh-Hant test pins `周杰倫`.
- **Files modified:** src/lib/stores/names.svelte.ts, src/lib/stores/names.test.ts
- **Commit:** c70e51b

**2. [Accepted by orchestrator] Share-link title carries the paired alias (TrackMenu)**
- CONTEXT literally says "share links unchanged". But the artist is aliased alone by decision, so a bare share title would have produced the hybrid `/song/周杰倫/Coral Sea`. The recipient's resolveStub cannot rescue that, because a non-Latin artist skips the wa7 rescue. Passing the pair gives `/song/周杰倫/珊瑚海`, which the existing t2s rescue-on-miss (quick-260808-urx) resolves. Share links have carried display names since urx. There is a decision comment at the call site.

### TDD Gate Compliance

Each task has a single `feat(...)` commit and no separate `test(...)` RED commit. This follows the orchestrator constraint to commit only on a fully green gate, since main auto-pushes and auto-deploys. RED was run and observed locally before each GREEN (counts above) and was never committed.

## Assumption Drift (advisory)

- **Found during:** Task 2. **Planned:** "`applyLock` still renders the selected script (周杰倫 vs 周杰伦)", which assumes the lock is the identity on Traditional input under zh-Hant. **Actual:** tongwen s2t is not idempotent on Traditional text (`周杰倫 → 周傑倫`). **Why it matters:** without the round-trip, must-have truth #1 would fail. Handled as deviation 1.

## Design notes the plan asked to record

- **Single-performer artist rule:** an artist alias is created only when `splitArtists(zh.artist).length === 1`. The wa7 smoke pair `Joker Xue / The Actor → 薛之謙, 阿蘭, 劉宇寧, 白舉綱 & 袁成傑` still gives the title alias 演員, but "Joker Xue" alone is never renamed to a five-performer credit. Marked with a `ponytail:` comment giving the upgrade path (per-part alignment).
- **Bilingual-title recording skipped:** I did not add pair recording for YTM's `再愛你 - Zai Ai Ni` style titles. That evidence comes from a single row (wa7 deviation 1), not a cross-locale verification, and CONTEXT says never to record an unverified guess.
- **`names.clearCache()`** deliberately leaves `openmusic:name-rescue:v1` alone. It is the resolution cache, not the translation cache (one-line comment in code).
- **MetadataEditor** stays bare (`names.dnTitle(tr.title)`) so the editor shows the user's raw editable value. The source-grep guard pins this.

## Deferred Issues

- Pre-existing, not caused by this task: under the zh-Hant lock, **any** already-Traditional Chinese name from an upstream (for example a JOOX/HK row carrying `周杰倫`) goes through the same tongwen over-conversion and shows `周傑倫`. Only the alias path got the Simplified round-trip. A global fix would apply the same round-trip inside `lockScriptSync` for zh-Hant (zh-convert.ts). That touches every locked surface and belongs to quick-260919-2jo's lock, so I left it as is.

## Known Stubs

None.

## Threat Flags

None. The alias text flows only to the text sinks listed in the plan's threat model (T-x8o-01..05 mitigations are implemented: `validName` guard, pair keying, single-performer rule, one hydration read, per-listener try/catch).

## Self-Check: PASSED

- FOUND: src/lib/services/name-rescue.ts exports `readRescueHits`, `onRescueHit`, `RescueHitListener`
- FOUND: src/lib/stores/names.svelte.ts contains `dnTitle(text: string, artist?: string)` and one `onRescueHit(` (constructor)
- FOUND commits: 5344441, c70e51b, f09d9e3
