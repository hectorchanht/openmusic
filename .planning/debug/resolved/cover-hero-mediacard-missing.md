---
gsd_debug_version: 1.0
slug: cover-hero-mediacard-missing
status: resolved
trigger: |
  1. The song cover in "playing now" (NowPlaying hero) is NOT shown while the SAME song shows its cover in the "Up Next" list. The song cover should be used everywhere for the same song and cached (share one resolved cover across hero + up-next + tiles).
  2. Media card (Android lock-screen / notification media session) sometimes does NOT show the song info — possibly due to lack of song cover but unconfirmed. Ensure song title and artist name are ALWAYS rendered in the media card.
created: "2026-07-08"
updated: "2026-07-08"
---

# Debug Session: cover-hero-mediacard-missing

## Symptoms

### Issue 1 — NowPlaying hero cover missing while Up Next has it
- Screenshot 1 (NowPlaying full screen): song "每當變幻時" by 林家謙 is actively playing (2:24 / 3:09, pause button shown).
  - The large hero cover area at the TOP of NowPlaying is EMPTY — only a purple→dark gradient, no cover art.
  - In the "Up Next" list below, the SAME song "每當變幻時 / 林家謙" (highlighted/current row) DOES show a cover thumbnail. So the cover IS resolved/cached for the up-next row but the hero does not render it.
- Expected: hero cover = the same resolved cover shown in the up-next row for the identical uid/song.
- User ask: one resolved cover reused EVERYWHERE for the same song, and cached.

### Issue 2 — Media card missing song info
- Screenshot 2 (Android quick-settings media card): the media card shows title text "enmusic — music streaming fo…" (the app/PWA name, not the song), a faded app-logo background, and transport buttons. No song title / artist visible.
- Expected: media card always shows the playing song's title + artist (and cover when available), never the app name placeholder.
- Uncertain whether missing cover is the cause; user wants title+artist guaranteed regardless of cover.

## Environment
- Platform: Android (Chrome PWA per media card style; possibly Capacitor APK — confirm). Screenshot chrome = Samsung/Android quick settings.
- App: MusicSquare / OpenMusic (SvelteKit + Svelte 5 runes).

## Reproduction
- Play a track (observed with netease/CN-source track "每當變幻時" by 林家謙). Open NowPlaying → hero cover blank though up-next thumbnail present. Check Android media card → shows app name instead of song title/artist.

## Likely-relevant code (starting points, verify)
- src/lib/components/NowPlaying.svelte — hero cover render (1652L)
- src/lib/components/Nowbar.svelte, CompactRow.svelte — up-next / tile cover render
- src/lib/actions/lazyCover.ts — cover loading action
- src/lib/services/cover-cache.ts + src/lib/stores/cover-version.svelte.ts — cover cache (uid → name → null) + reactive version
- src/lib/stores/player.svelte.ts — resolvedCover, current, media session driving
- src/lib/services/media-session.ts (web) + native-media-session.ts (Capacitor) — media card metadata (title/artist/artwork)

## Current Focus
- hypothesis: Two independent asymmetries. (1) Hero cover cell is the ONLY cover surface that does not read the reactive cover cache — it reads `player.resolvedCover` alone; sibling surfaces (up-next rows, neighbor cells) resolve via `use:lazyCover` and read the cache reactively, so a cover that lands after play()'s narrow resolve windows shows on up-next but never on the hero. (2) Media-session metadata is written ONLY inside play()'s success branches; restore()+resume never sets it, so the OS card falls back to the PWA/app name.
- test: code trace of the two cover paths + all metadata write sites.
- expecting: hero derived should fall back to readCoverByUidOrName; restore()/play() should set metadata from the stub title/artist unconditionally.
- next_action: AWAITING HUMAN VERIFY — THREE fixes bundled uncommitted in the working tree. User to confirm on the real Android/PWA device that (1) the NowPlaying hero cover matches the up-next thumbnail for the same song, (2) the Android media card shows song title + artist (not the app name), and (3) the media-card ARTWORK shows the song cover once it has resolved anywhere (up-next / tile), not the favicon. On confirm → archive to resolved/ + append knowledge base + commit.

- reasoning_checkpoint:
  hypothesis: "Issue 1: hero cover blank while up-next shows it because the hero (current cover-cell) reads only player.resolvedCover, while up-next rows read the reactive cover cache via use:lazyCover/resolvedCovers. When the current song's cover lands AFTER play()'s two narrow resolvedCover windows (resolveCoverAsync fires only if resolvedCover starts null + is gen-guarded; healCover only repairs a non-null DEAD url), the cache gets the cover but player.resolvedCover is never refreshed, so the hero stays on the gradient. Issue 2: media card shows the app name because ms.metadata is set ONLY inside play()'s success branches (offline-blob 2143, network 2244, resolveCoverAsync 2389); restore() and the resume paths (toggle/play-event/OS play handler) never set it, so after a PWA reopen the OS card falls back to the document/PWA name."
  confirming_evidence:
    - "NowPlaying.svelte:1186 hero current cell renders effectiveCover only; effectiveCover (:450) = swappedCover ?? player.resolvedCover ?? null — NO cache read."
    - "NowPlaying.svelte:1311 up-next .q-art uses use:lazyCover + resolvedCovers[uid] ?? track.cover; lazyCover (lazyCover.ts) resolves via chain AND reads/writes the cover cache — a fully cache-reactive path the hero lacks."
    - "player.svelte.ts:2317 resolveCoverAsync fires only `if (!this.resolvedCover)` and is gen-guarded (:2380); healCover (:2434) only repairs a non-null DEAD https url. Neither re-pulls a cover that lands in the cache via another surface."
    - "grep of all metadata writes: only player.svelte.ts:903 (clear), 2143, 2244, 2389 — all inside play()/resolveCoverAsync. restore() (:367) sets audio.src but never ms.metadata; toggle() (:2570) and the play/playing/pause event handlers only call syncPlaybackState() (playbackState, not metadata)."
    - "readCoverByUidOrName is already the established reactive-cache read used by home tiles (+page.svelte:597,875) — reusing it on the hero matches the existing architecture."
  falsification_test: "If the hero cover were driven by the same resolvedCovers/lazyCover path as up-next, both would show/hide together — it is not, so the asymmetry is real. If metadata were set on a resume path, a grep would show a metadata write outside play()/resolveCoverAsync — it does not."
  fix_rationale: "Fix 1 makes the hero read the SAME reactive cover cache every other surface uses (readCoverByUidOrName as a fallback after resolvedCover), so one resolved cover is reused everywhere and repaints live via coverVersion(). Fix 2 adds a syncMetadata() helper and calls it (a) synchronously at play() top from the stub title/artist (so the card is populated during the resolve gap and on the fallback early-return) and (b) in restore() after seeding current+cover (so a PWA reopen+resume shows title/artist). Title/artist come off the always-present stub, so they render regardless of cover — exactly the user ask."
  blind_spots: "Native (Capacitor) notification retention across a setMetadata-while-paused then setPlaybackState('playing') on resume is untestable here; relying on the plugin retaining the last metadata. Also cannot reproduce the exact Android screenshot locally — verification is code-path + unit tests + user confirmation."
- tdd_checkpoint: (unset)

## Evidence
- timestamp: 2026-07-08
  checked: NowPlaying.svelte hero cover render (:1150-1194) + effectiveCover derivation (:445-519)
  found: hero current cell background = effectiveCover only; effectiveCover = swappedCover ?? player.resolvedCover ?? null. Up-next .q-art (:1311) and neighbor cells (:1180/1189) use use:lazyCover + resolvedCovers[uid] ?? track.cover.
  implication: hero is the only cover surface NOT bound to the reactive cover cache — sibling surfaces resolve+read the cache, the hero waits on a single store field.
- timestamp: 2026-07-08
  checked: player.svelte.ts resolvedCover lifecycle (play 2095-2101/2317, resolveCoverAsync 2373-2397, healCover 2434-2472)
  found: resolvedCover seeded sync from track.cover??cache; resolveCoverAsync runs only when resolvedCover null AND gen-guarded; healCover only repairs a non-null DEAD https url, one-shot per uid|url.
  implication: if the current song's cover lands in the cache via a DIFFERENT surface (up-next lazyCover, backfill, sibling tile) after these windows, resolvedCover is never refreshed → hero stuck on gradient while up-next shows the cached cover. Root cause of Issue 1.
- timestamp: 2026-07-08
  checked: all ms.metadata / setMetadata writes across src (grep) + restore() (367-435) + toggle() (2570) + play/playing/pause event handlers (1145-1222)
  found: metadata written ONLY at player.svelte.ts 2143/2244/2389 (all inside play()/resolveCoverAsync) and cleared at 903. restore() sets audio.src but never metadata. toggle() + the play/playing/pause handlers only call syncPlaybackState() (sets playbackState, not metadata).
  implication: after a PWA reopen (restore) or any resume, the OS media card has no title/artist metadata and falls back to the document/PWA name ("OpenMusic — music streaming…"). Root cause of Issue 2.
- timestamp: 2026-07-08 (third bundled fix — coordinator-approved)
  checked: syncMetadata() (:923) + resolveCoverAsync() (:2416) artwork sources; import graph player→cover-version.svelte→cover-cache (pure) for circular-import risk.
  found: BOTH syncMetadata() and resolveCoverAsync() built artwork from `this.resolvedCover` ALONE. resolveCoverAsync fires ONLY when resolvedCover starts null + is gen-guarded (:2360 `if (!this.resolvedCover)`), so a cover that lands in the SHARED cover cache via another surface (up-next lazyCover, backfill, sibling tile) AFTER that window never reaches resolvedCover — the OS media-card artwork stayed on the /favicon.svg fallback even though the cache held the real cover. Same cache asymmetry the hero (Issue 1) just had. Import graph confirmed acyclic: player.svelte.ts already imports writeCoverBoth/bumpCoverVersion/removeCoverBoth from cover-version.svelte; that module imports only the pure cover-cache (never player) — so adding readCoverByUidOrName is NO new module edge and NO cycle.
  implication: the lock-screen art defeated the user's "one resolved cover everywhere for the same song" requirement whenever the cover landed after resolveCoverAsync's narrow window. Fixed by making syncMetadata() read the shared cache as a fallback (resolvedCover still wins). Chose readCoverByUidOrName (over the plain cover-cache read) because no circular-import risk exists and it mirrors the hero fix + the established architecture.

## Eliminated

## Resolution
- root_cause: |
    Issue 1: The NowPlaying hero (current cover-cell) is the only cover surface that reads `player.resolvedCover` alone; every sibling surface (up-next rows, carousel neighbors) resolves via `use:lazyCover` and reads the reactive cover cache. `player.resolvedCover` is refreshed only in play()'s narrow windows (resolveCoverAsync fires only when it starts null + is gen-guarded; healCover only repairs a non-null DEAD url), so a cover that lands in the cache via another surface after those windows is shown on up-next but never re-pulled into the hero.
    Issue 2: Media-session metadata (title/artist) is set ONLY inside play()'s success branches. restore() and the resume paths (toggle / play event / OS play handler) never set it, so after a PWA reopen the OS media card falls back to the app/PWA name with no song title/artist.
- fix: |
    Issue 1 (NowPlaying.svelte): the hero current cover-cell derived `effectiveCover` now falls back to
    the reactive cover cache — `swappedCover ?? player.resolvedCover ?? readCoverByUidOrName(current.uid,
    current.artist, current.title)`. readCoverByUidOrName depends on coverVersion(), so the hero repaints
    the instant ANY cover lands for the current song (the same cache every up-next row / home tile reads).
    One resolved cover is now reused everywhere for the same song. Normal path unchanged (resolvedCover
    still wins when set); the healCover $effect no-ops when the cover comes from the cache (resolvedCover
    null → healCover early-returns), and the cache value's health is maintained by the up-next lazyCover.
    Issue 2 (player.svelte.ts): added a private `syncMetadata()` helper that writes ms.metadata from
    this.current (title/artist/album + buildArtwork(resolvedCover)) — title/artist always present from the
    stub, so the card shows the song regardless of cover. Called (a) synchronously at play() top from the
    stub, so the card is populated during the resolve gap and on the runFallback early-return, and (b) in
    restore() after seeding this.current + resolvedCover, so a PWA reopen+resume shows title/artist instead
    of the bare app name (the restore path never calls play()).
    Issue 2 — THIRD bundled fix (coordinator-approved, media-card artwork): syncMetadata() now builds
    artwork from the SHARED cover cache, not resolvedCover alone —
    `buildArtwork(this.resolvedCover ?? readCoverByUidOrName(cur.uid, cur.artist, cur.title))`. This mirrors
    the Issue-1 hero fix so the lock-screen art picks up a cover that landed in the cache via another
    surface (up-next lazyCover, backfill, sibling tile) AFTER resolveCoverAsync's null+gen-guarded window —
    previously the media card stayed on /favicon.svg even though the cache had the real cover, defeating the
    user's "one cover everywhere for the same song" requirement for the lock screen. resolvedCover still
    takes precedence when set (normal resolved path unchanged); title/artist untouched. Import path chosen:
    readCoverByUidOrName from cover-version.svelte (NOT the plain cover-cache read) — verified no circular
    import (player already imports from cover-version.svelte, which imports only the pure cover-cache).
- verification: |
    - pnpm check: 0 errors, 0 warnings (4298 files) — re-run after the third bundled fix.
    - pnpm test: 1066 passed (69 files) — up from 1064, +2 more regression tests (4 total across the
      session for these two issues):
      • play() writes media metadata title/artist SYNCHRONOUSLY from the stub (before resolve settles).
      • restore() writes media metadata title/artist (never calls play()).
      • syncMetadata() builds artwork from the SHARED cover cache when resolvedCover is null (media-card
        asymmetry fix — the third bundled fix).
      • resolvedCover still WINS over the cache when both are present (precedence guard for `??`).
    - Existing MediaMetadata / resolvedCover suites still green (the async-cover-land Pitfall-4 test and
      the generation-guard supersede test unaffected — early sync write is an ADDITIONAL entry, assertions
      use >= and check the LAST entry).
    - COMMITTED without device verification per user approval 2026-07-08; device check deferred (cannot reproduce the Android media card
      or the exact cover-land timing race locally).
- files_changed:
    - src/lib/components/NowPlaying.svelte (Issue 1: effectiveCover reactive-cache fallback + import)
    - src/lib/stores/player.svelte.ts (Issue 2: syncMetadata helper + play()/restore() calls; THIRD fix:
      syncMetadata artwork now reads the shared cover cache via readCoverByUidOrName as a resolvedCover
      fallback)
    - src/lib/stores/player.svelte.test.ts (4 regression tests total: +2 from the third bundled fix)
