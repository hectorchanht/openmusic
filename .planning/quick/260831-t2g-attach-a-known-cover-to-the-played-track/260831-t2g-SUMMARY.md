---
quick_id: 260831-t2g
title: Attach a known cover to the played track so cover fetching is skipped
date: 2026-09-01
status: complete
commit: ade3ec7
---

# What shipped

A surface that already knows a track's art now hands it to the player, which skips cover
resolution entirely. Album tracks all show the album cover.

| | before | after |
|---|---|---|
| album row `current.cover` | `http://y.gtimg.cn/…` (qq's own thumbnail) | the Deezer album cover |
| two rows of the same album | could differ | byte-identical |
| `/api/deezer/search` cover calls per play | 1 (the HQ upgrade) | **0** |

# Cause

`playStub` already accepted a `cover`, but used it only for the optimistic now-bar and then threw
it away — the resolved track went to `play()` unchanged. So every album row resolved its own
cover: N wasted fetches per album plus visible inconsistency when sources returned different art
for sibling tracks. The album page compounded it by passing `null` while `heroImg` was on screen.

# Changes

- **`playStub` carries the caller's cover onto the resolved track.** It wins over the source's
  inline art on purpose — the point is that every song on an album shows the album's cover.
- **Keyed by SONG identity (`matchKey(artist,title)`), not uid.** This was the crux and cost two
  wrong attempts: a tap resolves to one source, then cross-source fallback replays the *same song*
  under a *different uid*, so a uid-keyed marker was lost at that hop. Live, that showed as an
  album row still displaying qq's thumbnail even after the first fix.
- **`play()` re-applies the attached cover after `ensureTrackDetails`**, which returns a track
  carrying the source's art and would otherwise overwrite `current.cover` — the field the nowbar
  and persistence read. (`resolvedCover` already survived, being `if (!this.resolvedCover)`-guarded,
  which is why the bug was invisible in the store but obvious in the UI.)
- **The Deezer HQ upgrade is skipped for an attached cover.** That call was the remaining per-play
  cover fetch, and on an album it would also let siblings drift apart. Tracks whose cover came from
  the source inline still get upgraded, so CN thumbnail quality is unchanged — a deliberate
  narrowing rather than deleting the Plan 26-02 upgrade outright.
- **Album page passes `heroImg`** at both `playStub` call sites.

# Verification

Live on the dev server with the cover cache cleared between runs:

- tap *Spies* → `current.cover` = the Deezer album cover (previously the qq http thumbnail)
- tap *High Speed* → the **same** cover, matching the album hero exactly
- `/api/deezer/search` cover calls across both plays: **zero**

6 unit tests: the attach, no HQ upgrade for it, upgrade still firing for source-inline covers,
siblings landing on one cover, a non-https caller cover ignored, and the resolve-overwrite
regression.

Worth recording: an earlier draft of those tests **passed vacuously**. The suite-wide `beforeEach`
stubs `play()`, and `mockEnsure` was left unset, so execution never reached the cover branches at
all. They now restore the real `play()` and resolve `ensureTrackDetails`, which is what caught the
resolve-overwrite bug in the first place.

`pnpm test` 100 files / **1872 tests** (+6); `pnpm check` 4404 files, 0 errors 0 warnings.

# Not covered

Only `playStub` callers attach a cover today — the album page and the home discovery tiles (which
already passed `item.image`). Surfaces that call `player.play()` directly (search rows, artist
rows, library) still resolve covers the old way; extending the same carry there is a follow-up.
