---
phase: quick-260920-m0l
plan: 01
status: complete
subsystem: settings-home, app-shell-nav
tags: [settings, nav, overlays, a11y]
key-files:
  modified:
    - src/lib/components/SettingPicker.svelte
    - "src/routes/(app)/settings/home/+page.svelte"
    - "src/routes/(app)/+layout.svelte"
    - src/lib/services/library-tabs.ts
    - src/lib/services/library-tabs.test.ts
decisions:
  - "Home preview mocks: a `focus` param marks the element the section configures; the OFF half draws an empty same-size `.mock-focus.slot` so it reads as 'this is what disappears' rather than showing nothing"
  - "Both the search-bar AND randomize pairs got the fix — identical defect, identical one-param fix; fixing only the reported one would leave a known-broken sibling"
  - "Tabbar interception routes through the EXISTING overlays.navigateAway, never a hand-rolled collapse-then-goto (which SvelteKit resolves as a silent no-op)"
  - "Gated on overlays.depth, not player.expanded — `expanded` misses a menu opened on top of the sheet"
  - "The click rule is a pure shouldInterceptNavClick in library-tabs.ts so the carve-outs are node-tested, not asserted inside a .svelte file"
---

# Quick 260920-m0l — two reported UI defects

## 1. Home preview mocks did not say what they configure

`homeHeader` rendered the same frame four times with nothing marking the element that
moves between Off and On, so the user had to diff two cards. Added a `focus` param that
applies the accent dashed outline from the Appearance wings (quick-260920-kxz) —
decorative only; the mocks are `aria-hidden` and take no focus.

The OFF half has nothing to outline (the element's absence IS the setting), so it draws
an empty `.mock-focus.slot` box of the same size in the same place.

**One bug found while verifying, not by inspection:** `.slot` collapsed to height 0. As a
bare flex child of the column `.mock-chrome` it had nothing to hold it open, so the
outline drew as a hairline and the Off card was back to showing nothing. Fixed with
`flex: none` on the primitive.

Measured after the fix: pill Off slot and On bar both 182x13; badge Off slot and On badge
both 14x10.

## 2. A tabbar tap did not close Now Playing

`+layout.svelte` already documented this as a known ceiling whose fix "needs its own
look" because of the overlays history sentinel. No new mechanism was needed —
`overlays.navigateAway` already exists and is what `NowPlaying.openArtistName` and
`TrackMenu.gotoArtist` use.

Load-bearing ordering, already solved there and NOT re-derived:
- `goto()` runs FIRST, overlays still open. Closing first makes goto() a **silent no-op**
  (the overlay's raw Back entry is no longer current) — the trap recorded in the
  `page-switch-lag-tap-dead` debug note.
- `navigating` suppresses the `history.back()` each unmounting host's cleanup fires,
  which would otherwise pop the just-pushed destination straight back off.
- Afterwards it closes every still-open overlay — and `nowplaying`'s close handler IS
  `player.collapse()`, so the collapse is free. No hand-rolled collapse call.

## Verification

Driven on the live dev server at `:5173`.

| Check | Result |
|---|---|
| All four Home mocks highlight their own element | 4 `.mock-focus` nodes, Off/On sizes matched |
| Tab click with an overlay open | depth 1 -> `/search` to `/library?tab=playlists` -> depth 0, overlay gone |
| No silent goto no-op | URL actually changed |
| Tab click at depth 0 | plain anchor still navigates (`/`) |
| Back after the intercepted nav | returns to the previous route, no snap-past |
| Gates | `pnpm check` 0 errors 0 warnings; `pnpm test` 2992/2992 in 145 files (+5) |

**Honest gap:** the overlay used for the live nav test was a **track menu**, not the
now-playing sheet — the audio path does not resolve in this sandbox, so no real track
would start. Both register in the same stack and go through the same `navigateAway`, and
`nowplaying`'s close handler is `player.collapse()` (NowPlaying.svelte:430), so the
collapse follows by construction — but it was not directly observed. Worth one tap on a
real device.
