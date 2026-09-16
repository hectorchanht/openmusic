# Deferred — quick-260916-0d9 (Download-from picker)

## 1. Per-source TIER sub-rows (kuwo FLAC *and* kuwo 320K as separate rows)

The sheet offers ONE row per source, at the user's current `settings.downloadQuality`. Choosing a
format therefore means choosing a source row, not picking a tier.

**Why deferred:** `probeDownload` memoises on `${uid}|${settings.downloadQuality}` and takes no tier
argument — the tier is baked into both the memo key and the `ensureTrackDetails` call. Offering each
source's full ladder would multiply the probe count ~3x per source, against a fan-out already capped
at 2 in flight specifically to stay clear of the `apiFetch` governor (api-fetch-flood-freeze).

**Upgrade path:** add an optional `tier: DefaultQuality` parameter to `probeDownload`, key it into
the memo instead of reading `settings` directly, and thread it to `ensureTrackDetails`. Then expand
each source row into its ladder, probing lazily on row expansion rather than on sheet open.

### 1b. Same-source ALBUM / variant sub-rows

Related, discovered while driving the sheet against the live dev server: `collapseVariants` buckets
by `source|album|tag`, so "Hello" / Adele yielded 3 qq + 3 netease + 4 ytmusic rows — eleven rows
each labelled with nothing but its source name. `versionsIncludingOwn` now keeps one row per SOURCE
and drops the album siblings, which also cut the probe pool from eleven to four on that query.

**Why deferred:** surfacing those siblings needs a second line of row text (album, `Live`, `Acoustic`)
and a decision about whether a compilation reissue is a meaningful download choice at all. The
Play-from-source `VersionPicker` already exposes per-variant selection for playback.

**Upgrade path:** render `v.album` / `variantTag(v.title)` as a secondary line and lift the
per-source cap, gated on the tier work above so the row count stays bounded.

## 2. Keyboard / desktop entry to the picker

The picker is reachable by long-press only, which is a touch gesture. `use:longpress`
`preventDefault`s `contextmenu`, so right-click does not reach it either, and there is no keyboard
affordance.

**Why deferred:** the app is mobile-first and the one-tap Download row must stay the primary,
unchanged action; adding a second visible entry point to the same row is a layout change, not a
wiring change.

**Upgrade path:** dispatch the same `onlongpress` payload from the action's existing `contextmenu`
handler behind an opt-in parameter (e.g. `use:longpress={{ duration: 450, contextmenu: true }}`),
so only call sites that want a desktop entry get one.
