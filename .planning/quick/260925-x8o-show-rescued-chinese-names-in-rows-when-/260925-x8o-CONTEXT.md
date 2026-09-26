# Quick Task 260925-x8o: Show rescued Chinese names in rows when the Chinese script lock is on - Context

**Gathered:** 2026-09-26
**Status:** Ready for planning
**Source:** user request (follow-up to quick-260925-wa7) + orchestrator code reading

<domain>
## Task Boundary

User: "after resolve Coral Sea — Jay Chou to 珊瑚海 — 周杰倫, this should be remembered and shown to
corresponding locale in songrow and displayed if the Translation → Chinese script is selecting either of the
chinese option."

quick-260925-wa7 made `resolveStub` rescue English/romanized names of Chinese songs with a VERIFIED
English→Chinese pair (YouTube Music en↔zh-TW by videoId, or iTunes HK↔US by trackId) and caches the pair in
`openmusic:name-rescue:v1` (`src/lib/services/name-rescue.ts`, key = normalized `artist|title`, hits 30 d,
misses 1 d, cap 500). This task makes that remembered pair DISPLAY: wherever the app shows that song's name
(song rows, home shelf tiles incl. Your Radio, Up Next, Now Playing, Nowbar, the track menu, the OS media
card), show 珊瑚海 / 周杰倫 instead of Coral Sea / Jay Chou — but ONLY when Settings → Translation → Chinese
script (`settings.zhScript`) is `zh-Hant` or `zh-Hans`, rendered in THAT script (周杰倫 vs 周杰伦). With the
setting `off`, display is byte-for-byte unchanged.
</domain>

<decisions>
## Implementation Decisions

### Where it plugs in (the display seam)
- `src/lib/stores/names.svelte.ts` is THE display seam: `dnTitle(text)` / `dnArtist(text)` / … funnel through
  `resolve()` → `resolveTranslated()` → `applyLock()` (quick-260919-2jo). ~40 `dnTitle` and ~62 `dnArtist`
  call sites already route through it. Apply the alias inside this seam, before `applyLock`, so the lock then
  renders it in the selected script — do not add per-component logic.

### Keying — artist alone is safe, title needs its artist
- ARTIST alias: raw artist text → Chinese artist ("Jay Chou" → 周杰倫), applied by `dnArtist(text)` with no
  extra context.
- TITLE alias MUST be keyed by the pair: "Coral Sea" alone must never become 珊瑚海 (Black Pearl's "Coral Sea
  (Chillout Mix)" and ooillk77's "Coral Sea" exist in the same search results). Give `dnTitle` an OPTIONAL
  second argument — the SAME track's raw artist — e.g. `dnTitle(text, artist?)`; without it no title alias
  applies (backward-compatible). Update the call sites that render a song title next to its own artist
  (SongRow, CompactRow, home `+page.svelte` song/stub tiles incl. Your Radio + chart shelves, NpUpNext,
  NpRelated, Nowbar, NowPlaying, TrackMenu header/detail, player.svelte.ts media-session metadata,
  +layout document title, VersionPicker). Album-name / artist-name uses of `dnTitle` (album pages, `a.name`)
  are NOT song titles — leave them.
- Normalization for the lookup must be the SAME normalization name-rescue.ts uses for its cache key (reuse its
  exported helpers — do not re-inline a second normalizer).

### Source of truth + persistence
- The alias source is the rescue's VERIFIED hits — reuse `openmusic:name-rescue:v1`; do not create a parallel
  store. "Remembered" means a verified pair survives reloads: display aliases should not silently expire after
  the 30-day hit TTL that governs re-lookup (planner decides: e.g. keep hits for display regardless of TTL, or
  extend the hit TTL, keeping the 500-entry cap). Misses never produce aliases.
- In-memory mirror: `dnTitle`/`dnArtist` run on every render of every row — the alias lookup must be an O(1)
  in-memory Map, hydrated once from localStorage (browser-guarded, try/catch, shape-guarded — the store is
  user-writable), and updated when a new pair is written.
- Live repaint: when a rescue writes a new pair (the user just tapped Coral Sea), visible rows must repaint to
  the Chinese name without a reload. `names.svelte.ts` is a runes store; `name-rescue.ts` is a pure `.ts`
  module that must NOT import the store (keep the pure/runes split). Use a tiny subscribe/notify hook exported
  by the pure module (or equivalent) that the store uses to bump its existing `rev`.

### What counts as a verified pair
- Pairs written by the wa7 rescue (verified by YTM English evidence or iTunes cross-store trackId).
- Claude's discretion: ALSO record a pair when `resolveStub` resolves a Latin-named stub to a track whose title
  is a bilingual `CJK - Latin` label title whose Latin part equals the query title (the "Zai Ai Ni" /
  "Graduation" case, where the ytmusic source already returns `再愛你 - Zai Ai Ni` and the rescue never fires).
  Only if it is cheap and uses the same verification rule — never record an unverified guess.

### Interplay with other display settings
- zhScript `off` → no alias, byte-for-byte today (pin with a test).
- Alias applies BEFORE translation: if titleLang/artistLang translation is on, the aliased Chinese text is what
  gets translated/locked (or skip translation for aliased text — planner decides; must not double-translate or
  flicker).
- The alias never changes stored data (library, history, share links, download tags written from raw fields)
  — display only. Check `download-track.ts` / MetadataEditor: download filenames/tags currently go through
  `dnTitle` — decide deliberately whether aliases should reach file tags (recommend: yes for the display
  filename only if it already follows the lock; keep MetadataEditor showing the user's raw editable value).

### Contracts
- SSR/browser guards; never throw from the seam; no network on the display path.
- House style: decision-ref comments tagged `quick-260925-x8o`; CLAUDE.md Shared Primitives table.
- Every commit leaves `pnpm test && pnpm check && pnpm build` green (main auto-pushes → auto-deploys).

### Claude's Discretion
- Exact API shape (`dnTitle(text, artist?)` vs a new `dnSongTitle(track)`), TTL handling for display, the
  bilingual-title recording, the notify mechanism.
</decisions>

<canonical_refs>
## Canonical References
- `src/lib/stores/names.svelte.ts` — display seam (resolve / resolveTranslated / applyLock / warmLock)
- `src/lib/services/name-rescue.ts` + `name-rescue.test.ts` — verified pairs + cache (quick-260925-wa7)
- `src/lib/services/discovery.ts` — resolveStub (where pairs are produced)
- `src/lib/services/zh-convert.ts` — `lockScriptSync`, `isChineseLine`
- `src/lib/components/SongRow.svelte`, `CompactRow.svelte`, `NpUpNext.svelte`, `NpRelated.svelte`,
  `Nowbar.svelte`, `NowPlaying.svelte`, `TrackMenu.svelte`, `src/routes/(app)/+page.svelte`,
  `src/lib/stores/player.svelte.ts` (media-session metadata)
- `src/lib/stores/names.test.ts` — existing seam tests to extend
- `.planning/quick/260925-wa7-rescue-english-and-romanized-chinese-son/260925-wa7-SUMMARY.md`
</canonical_refs>
