# Phase 38: Share links that play instantly and open in the app - Discussion Log

> **Audit trail only.** Do not use as input to planning, research, or execution agents.
> Decisions captured in `38-CONTEXT.md` — this log preserves how they were reached.

**Date:** 2026-09-20
**Phase:** 38-share-links-that-play-instantly-and-open-in-the-app
**Mode:** discuss (default, interactive)
**Areas discussed:** Restored song vs shared song · What the link carries · When prefetch fires · Where the shared song appears · Android App Links

## Scouting findings that reshaped the discussion

Three facts found before questioning, each of which changed what was worth asking:

1. **The live share link carries no song identity.** `TrackMenu.svelte:783` is the only share
   emitter → `songShareUrl()` → `/song/{artist}/{title}?ci=<coverToken>`. Artist + title strings
   only. The recipient re-resolves BY NAME, and that search fan-out *is* the latency. The roadmap
   entry's claim of a `?play=<token>` share link was wrong and has been corrected.
2. **`?play=` already implements the warm case, badly.** `(app)/+page.svelte:673` does
   `setQueue(...)` + `play(current, { fresh: true })` — precisely the queue-nuking the user asked to
   avoid. It survives only as a decoder for legacy links; nothing emits it any more.
3. **`restore()` runs on the share route too.** `src/routes/+layout.svelte:37` restores the previous
   session on EVERY route, so "nothing playing" is rarely literally true — a returning visitor has a
   song seated and paused when the link lands. This forced Area 1 to exist at all.

## Area 1 — Restored song vs shared song

| Question | Options presented | Selected |
|---|---|---|
| Paused restored session — cold or warm? | Paused = cold (rec) / Paused = warm / staleness threshold | **Paused = cold, shared song takes the seat** |
| What happens to the restored queue on cold arrival? | Keep + splice top (rec) / drop, fresh queue / keep, append to end | **Keep it, splice in at the top** |
| Re-opening the same link while that song is current? | No-op (rec) / re-seat + restart / you decide | **No-op** |
| Is the armed-but-unplayed state persisted? | Persist (rec) / ephemeral until playback / you decide | **Persist it** |

**Consequence:** cold and warm collapse into ONE insert path. That was the point of asking — the
alternative answers would have required two divergent queue behaviours.

## Area 2 — What the link carries

| Question | Options presented | Selected |
|---|---|---|
| Add a uid carrier to the link? | Yes, add `?u=` (rec) / no, stay carrier-free / only when already resolved | **Yes — add a uid carrier** |
| Dead or wrong carrier? | Silent fallback to name resolve (rec) / explicit error state / you decide | **Silently fall back** |
| What about `shareUrl`/`encodeShare` (sender's queue)? | Keep decoder, don't revive (rec) / revive it / delete it | **Keep the decoder, never emit** |
| Carrier format? | Plain readable param (rec) / opaque base64url / you decide | **Plain readable param** |

**Consequence:** the prefetch becomes a direct detail resolve rather than a search fan-out, which
materially changed the cost argument in Area 3.

## Area 3 — When prefetch fires

| Question | Options presented | Selected |
|---|---|---|
| When does the resolve fire? | On mount (rec) / on first interaction signal / on mount only when carrier present | **On mount, immediately** |
| How far does warm-up go? | Resolve + set `audio.src` (rec) / resolve URL only / force byte prefetch | **Resolve + set `audio.src`** |
| Legacy carrier-free links too? | Yes, same treatment (rec) / no, keep tap-to-resolve / you decide | **Yes, same treatment** |
| Tap arrives mid-prefetch? | Adopt the in-flight resolve (rec) / start a second / you decide | **Adopt the in-flight resolve** |

**Tension surfaced and accepted:** this partially reverses `quick-260809-38i`, which removed the
on-mount resolve. That quick's own comment shows its target was AUDIO ("no resolve, no playback" in
service of "must start NO audio"), so reinstating the resolve while keeping autoplay off is a
revisit, not a contradiction. Recorded explicitly as D-06.

## Area 4 — Where the shared song appears

| Question | Options presented | Selected |
|---|---|---|
| What does the landing page become? | Keep card + seat in nowbar (rec) / redirect into shell / full-bleed hero | **Keep the card, seat in the nowbar** |
| NowPlaying auto-expand? | Stay collapsed (rec) / auto-expand / you decide | **Stay collapsed** |
| The "Play on openmusic" button? | Keep, re-wire to armed track (rec) / remove / make primary | **Keep it, re-wired** |
| Feedback on a warm arrival? | Nowbar switch IS the feedback (rec) / show a toast / you decide | **Show a toast** |

**Only deviation from a recommendation in the whole discussion.** Noted in D-20 with its
justification: `relatedTapPlay` deliberately emits no toast because the user tapped the row, whereas
a share arrival changes the music without the user having touched the player. Costs a new key in
every locale dictionary.

## Area 5 — Android App Links (raised after the selected areas)

Not among the user's four selected areas, but half the phase scope had no decisions, so it was
raised rather than left to the planner to guess.

| Question | Options presented | Selected |
|---|---|---|
| How does the release SHA256 fingerprint get in? | User runs keytool (rec) / CI extracts from APK / CI generates the file | **User runs keytool, pastes it** |
| Which hosts are claimed? | `openmusic.lol` only (rec) / + `pages.dev` / you decide | **`openmusic.lol` only** |
| Which paths are intercepted? | Share routes `/song|/album|/artist` (rec) / everything / `/song` only | **Share routes only** |
| `appUrlOpen` while already running? | Same as web warm arrival (rec) / thin goto, page decides / you decide | **Same as the web warm arrival** |

**Constraint driving Q1:** the release keystore lives only in GitHub secrets
(`android-release.yml:97`), so the fingerprint is not readable from the dev machine. Distribution is
Obtainium/sideload rather than Play Store, so there is no Play App Signing re-sign — the release
keystore fingerprint is the single stable identity.

## Claude's discretion (explicitly left open)

- Toast wording and translation key name.
- The query-param letter for the uid carrier.
- Whether the cold arm is a new `player` method or a parameterisation of `restore()`.
- Whether legacy `/song/[slug]` gets the same treatment or is deprecated.

## Deferred ideas raised during discussion

- Reviving sender-side queue sharing (contradicts recipient-queue-survives).
- iOS Universal Links (no `ios/` directory).
- Claiming `openmusic.pages.dev`.
- Auto-expanding NowPlaying on arrival.
- Deleting `shareUrl`/`encodeShare` outright as dead code.
