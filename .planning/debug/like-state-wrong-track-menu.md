---
status: awaiting_human_verify
trigger: "are you sure the like detection mechanism in menu content is wired? unliked songs are also say liked."
created: 2026-09-16
updated: 2026-09-16
---

# Debug: like state reads as "liked" for songs that are not liked

## Symptoms

**Expected:** Opening the ⋯ track menu on a song that has never been liked shows the UNLIKED
state — outline heart, "Like" label.

**Actual:** It shows the LIKED state — filled heart / "Liked" label — for songs the user never
liked.

**Error messages:** None reported. Silent wrong state, no console error.

**Timeline:** Reported 2026-09-16. Not known whether it ever worked; the user's phrasing
("are you sure … is wired?") suggests they suspect it has never been correct, not that it
regressed. Do not assume a regression without finding the commit.

**Reproduction:** Not yet reproduced. User did not say which surface or which source.
TrackMenu opens from search, home, album, artist, library and now-playing up-next.

## Known call chain (already located — do not re-grep)

- `src/lib/stores/library.svelte.ts:98` — `isLiked(uid: string): boolean`
- `src/lib/stores/library.svelte.ts:102` — `toggleLike` uses `isLiked` to pick add-vs-remove
- `src/lib/components/TrackMenu.svelte:49` — `const liked = $derived(track ? library.isLiked(track.uid) : false)`
- `src/lib/components/TrackMenu.svelte:145-147` — post-toggle toast calls `isLiked` again

The wire exists. The defect is in the VALUE, not a missing call.

## Hypotheses (ranked, to be tested not assumed)

1. **uid mismatch.** Identity is `uid = ${source}:${songid}`, COLON form, via `makeUid()`
   (`src/lib/sources/types.ts`). If a surface builds a uid with a different separator, or
   passes a bare songid where a uid is expected, `isLiked` compares apples to oranges.
   Highest-risk arrival paths: top picks, up-next/similar, history restore, device import,
   ytmusic — anything that did NOT come from a plain search.
2. **The comparison itself.** Read the body of `isLiked` before assuming it is a plain
   `.some(x => x.uid === uid)`. A truthy non-boolean return, or a match on a falsy/undefined
   uid, would explain a universal false-positive: if one stored liked entry has no uid and the
   incoming stub also has none, `undefined === undefined` marks EVERY such track liked.
3. **Reactivity.** `liked` is `$derived` over `library.liked`. An in-place array mutation
   instead of a `$state` reassignment leaves the derived stale. Ranked last: that yields a
   STALE value, not a uniformly wrong one.

## Discriminating question — answer this FIRST

Is it EVERY song that reads as liked, or only songs from certain sources/surfaces?

That one fact splits hypothesis 1 (source-specific) from hypothesis 2 (always truthy) and
should be cheap to settle by inspecting `library.liked[].uid` against the uid the menu passes,
for one search-sourced track and one non-search-sourced track.

## Current Focus

reasoning_checkpoint:
  hypothesis: "A liked entry with uid '' poisons isLiked: home/charts open TrackMenu on a name-stub (uid:'') and the Like row is tappable on it (D-01 no loading gate), so one tap stores {uid:''} in library.liked; every later stub-opened menu reads isLiked('') === true → 'Liked' for songs never liked. Answer to the discriminating question: NOT every song — only surfaces whose menu track is a uid-less stub (home discovery tiles, charts/tags, charts/countries) while it resolves; search/library/album rows carry real uids and are unaffected."
  confirming_evidence:
    - "library.svelte.ts:98 isLiked is a plain .some(t => t.uid === uid) — no guard on empty uid"
    - "stubTrack() builds uid:'' in +page.svelte:551, charts/tags:51, charts/countries:52; TrackMenu:490 comment D-01: action list ALWAYS renders on the stub; Like row (TrackMenu:556) has no gate"
    - "RowBadges.svelte:18 already guards `!!uid && library.isLiked(uid)` with a comment naming exactly this trap — the menu path never got the same guard"
    - "player-persist.ts:103 reshape() also yields uid:'' for a corrupt persisted current → NowPlaying heart is a second writer path"
  falsification_test: "If library.liked contains NO entry with uid '' and the menu still says Liked on an unliked real-uid track, this hypothesis is wrong."
  fix_rationale: "Guard where every caller converges: isLiked('') → false, toggleLike on a uid-less track → no-op, load() prunes '' entries (self-heals already-poisoned storage). Plus disable the menu Like row on a uid-less stub so the tap can't fire a misleading toast."
  blind_spots: "Cannot read the user's real localStorage from this sandbox (no browser tools); mechanism is proven from code, poison presence in the user's store is inferred."
next_action: user confirms on device — long-press a home discovery tile (or charts row) on a song never liked: the Like row must read 'Like' (disabled while resolving, enabled once resolved); Library → Liked must show no blank/ghost row

## Evidence

- 2026-09-16 checked: `isLiked` body (library.svelte.ts:98) — found: `this.liked.some((t) => t.uid === uid)`, boolean, no empty-uid guard. implication: a stored entry with uid '' matches every uid '' query.
- 2026-09-16 checked: every `uid:` construction in src — found: `stubTrack()` returns `uid: ''` on home (+page.svelte:551), charts/tags (:51), charts/countries (:52); `player-persist.ts:103` `uid: p.uid ?? ''`; catalog.ts:251 (internal compare target only, never reaches UI). implication: uid-less Tracks DO reach TrackMenu as `menuTrack` while the host page resolves the stub.
- 2026-09-16 checked: TrackMenu template — found: D-01 comment (:490) "action list ALWAYS renders (no loading gate)"; Like row (:556) has no gate; like() → library.toggleLike(track) stores the stub verbatim. implication: one tap on Like during the resolve window persists {uid:''} into liked.
- 2026-09-16 checked: RowBadges.svelte:18 — found: `!!uid && library.isLiked(uid)` plus a comment that uid:'' name-stub rows "can never light up". implication: the trap was known and patched at ONE caller, not at the shared function.
- 2026-09-16 checked: i18n menu.like/menu.liked in all 16 locales — found: distinct in every locale except th.ts (both "ชอบ"). implication: not the reported cause (user is en/zh), noted as a side finding.

## Eliminated

- hypothesis: uid separator/shape mismatch (H1) — evidence: every adapter and similar.ts emit `${source}:${songid}`; a mismatch yields a FALSE NEGATIVE (liked song shows Like), never the reported false positive. 2026-09-16
- hypothesis: stale $derived / in-place mutation (H3) — evidence: toggleLike/clearLiked reassign `this.liked`; adoptCover mutates in place but only `cover`, never uid/membership. 2026-09-16
- hypothesis: locale strings collide (menu.like === menu.liked) — evidence: only th.ts collides; en/zh-Hant/zh-Hans are distinct. 2026-09-16

## Resolution

- root_cause: `library.isLiked(uid)` was a bare `.some(t => t.uid === uid)` with no identity guard. Home (`+page.svelte:551`) and both charts pages build the TrackMenu track as a name-stub with `uid: ''` while the real Track resolves, and the menu's Like row is tappable on that stub (D-01: no loading gate). One tap persisted `{uid:''}` into `library.liked`; from then on every stub-opened menu evaluated `isLiked('')` → true and rendered "Liked" for songs never liked. Surface-specific (stub surfaces only), not universal — RowBadges had already worked around it at its own call site (`!!uid &&`) instead of fixing the shared function.
- fix: (1) `isLiked` returns false for an empty uid; (2) `toggleLike` is a no-op on a uid-less track; (3) `load()` prunes uid-less entries so an already-poisoned store self-heals; (4) TrackMenu Like row is `disabled={!track.uid}` so the stub tap cannot fire a no-op + misleading toast. Commit 8a848d9 (local only, not pushed).
- verification: 3 new tests in library.svelte.test.ts fail on the pre-fix code (3 failed / 23 passed) and pass after (26/26); full suite 129 files / 2482 tests green; `pnpm check` 0 errors 0 warnings. Awaiting human confirmation on a stub surface (home/charts) on device.
- files_changed: [src/lib/stores/library.svelte.ts, src/lib/stores/library.svelte.test.ts, src/lib/components/TrackMenu.svelte]
