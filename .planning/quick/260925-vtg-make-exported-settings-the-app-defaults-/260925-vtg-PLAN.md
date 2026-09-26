---
phase: quick-260925-vtg
plan: 01
type: execute
wave: 1
depends_on: []
files_modified:
  - src/lib/config/defaults.ts
  - src/lib/services/home-layout.ts
  - src/lib/stores/settings.svelte.ts
  - src/app.css
  - src/lib/services/home-layout.test.ts
  - src/lib/services/home-charts.test.ts
  - src/lib/stores/settings-persist.svelte.test.ts
  - src/lib/stores/settings.svelte.test.ts
autonomous: true
requirements: [quick-260925-vtg]

must_haves:
  truths:
    - "A fresh install (no openmusic:settings:v1) starts with accent #00c2b8, rowActions ['download','like'], lyricsLang/bioLang 'off', artist/title/lyrics skip ['en'], zhScript 'zh-Hant', downloadQuality 'auto', showQualityTag true, homeChartRegion 'hk', homeExtraRegions ['us'], all 11 chart genres, and the user's home section order"
    - "Reset-to-default (resetAppearance / resetTranslation / resetPlayback / resetHome) lands on exactly those same values"
    - "An existing user's persisted blob is untouched on load: a saved zhScript 'off', homeChartRegion 'auto', rowActions [], downloadQuality 'lossless', showQualityTag false, lyricsLang 'auto' and their own homeSectionOrder all survive settings.load() unchanged"
    - "The one-time home-layout migration (homeLayoutVersion < 2) produces the same output for an existing blob as before this change"
    - "pnpm test, pnpm check and pnpm build are all green on the single commit"
  artifacts:
    - path: "src/lib/config/defaults.ts"
      provides: "New default literals + quick-260925-vtg decision-ref comments"
      contains: "quick-260925-vtg"
    - path: "src/lib/services/home-layout.ts"
      provides: "New DEFAULT_SECTION_ORDER (17-id permutation) and DEFAULT_CHART_GENRES (all 11)"
      contains: "quick-260925-vtg"
    - path: "src/lib/stores/settings.svelte.ts"
      provides: "load() guards that accept the OLD defaults ('off', 'auto') as valid persisted values; skip-list fallbacks read TRANSLATION_DEFAULTS"
      contains: "quick-260925-vtg"
    - path: "src/lib/stores/settings-persist.svelte.test.ts"
      provides: "Regression tests: persisted 'off' zhScript and persisted 'auto' chart region survive load"
      contains: "quick-260925-vtg"
  key_links:
    - from: "src/lib/stores/settings.svelte.ts"
      to: "src/lib/config/defaults.ts"
      via: "class-field init + load() fallbacks + reset*() all read the DEFAULTS consts (WR-10)"
      pattern: "HOME_DEFAULTS\\.homeChartRegion"
    - from: "src/lib/config/defaults.ts"
      to: "src/lib/services/home-layout.ts"
      via: "HOME_DEFAULTS.homeSectionOrder / homeChartGenres spread DEFAULT_SECTION_ORDER / DEFAULT_CHART_GENRES"
      pattern: "\\.\\.\\.DEFAULT_SECTION_ORDER"
---

<objective>
Adopt the user's exported settings (openmusic-backup 2026-09-26, key `openmusic:settings:v1`) as the app DEFAULTS — what a fresh install starts with and what every Reset-to-default reverts to — without touching any existing user's persisted values.

Purpose: the developer's own tuned configuration is the best-known starting point; today's defaults were set piecemeal across quick tasks and phase 39 and no longer reflect how the app is actually used.

Output: updated default literals + decision-ref comments in `defaults.ts` / `home-layout.ts`, two `load()` guard fixes in `settings.svelte.ts` so the new defaults cannot overwrite a saved old-default value, the pre-hydration accent in `app.css`, and updated/added tests. One green commit.
</objective>

<execution_context>
@/Users/laichan/.claude/plugins/cache/gsd-plugin/gsd/4.5.3/workflows/execute-plan.md
@/Users/laichan/.claude/plugins/cache/gsd-plugin/gsd/4.5.3/templates/summary.md
</execution_context>

<context>
@.planning/STATE.md
@src/lib/config/defaults.ts
@src/lib/services/home-layout.ts
@src/lib/stores/settings.svelte.ts

<interfaces>
<!-- Already read by the planner. Use directly — no exploration needed. -->

From src/lib/stores/settings.svelte.ts (types the new literals must satisfy):
```typescript
export type LyricsLang = 'off' | 'auto' | /* lang codes */ ...;
export type SourceLang = 'zh-Hant' | 'zh-Hans' | /* ... includes 'en' */ ...;
export type ZhScriptSetting = 'off' | 'zh-Hant' | 'zh-Hans';
export type RowAction = 'like' | 'download';
export const ACCENT_PRESETS = ['#7c5cff', '#1db954', '#ff0033', '#00c2b8', '#ff8a00', '#ff4d6d']; // #00c2b8 is already a preset
```

From src/lib/services/home-layout.ts:
```typescript
export const CHART_REGIONS = ['hk', 'tw', 'sg', 'jp', 'kr', 'us', ...] as const;   // 'hk' and 'us' are offered
export const CHART_GENRE_IDS = ['cantopop','mandopop','kpop','jpop','hiphop','rock','dance','rnb','electronic','alternative','asian'] as const; // the requested 11-genre default is EXACTLY pool order
export const HOME_SECTIONS = ['liked','downloads','radio','chart-songs','new-releases','chart-artists','chart-albums','yt-trending','genres','regions','top-hits','top-artists','tags','countries','fav-artists','playlists','history'] as const;
export const CLASSIC_SECTIONS = ['top-hits','top-artists','tags','countries'] as const;
export function migrateHomeLayout(order, hidden, density) // reads ONLY CHART_SECTIONS + CLASSIC_SECTIONS — never DEFAULT_SECTION_ORDER / DEFAULT_CHART_GENRES
export function resolveSectionOrder(saved) // undefined/empty/non-array → [...DEFAULT_SECTION_ORDER]; otherwise keeps saved order and appends missing ids in HOME_SECTIONS order
```

From src/lib/services/color.ts:
```typescript
export function darken(hex: string, amount: number): string; // round(c * (1 - amount)) per channel → darken('#00c2b8', 0.12) === '#00aba2'
```

Migration verdict (planner verified): `migrateHomeLayout` never reads `DEFAULT_SECTION_ORDER` or `DEFAULT_CHART_GENRES`, so an EXISTING blob (which always carries its own `homeSectionOrder`) migrates identically before and after this change. The only way the new order reaches a v1 blob is when that blob has NO `homeSectionOrder` key at all (`load()` line ~385 falls back to `HOME_DEFAULTS.homeSectionOrder`, then the migration finds nothing missing) — that is the "absent key" case the task explicitly allows.
</interfaces>
</context>

<tasks>

<task type="auto">
  <name>Task 1: Change the default literals, fix the two load() guards, refresh the decision-ref comments</name>
  <files>src/lib/config/defaults.ts, src/lib/services/home-layout.ts, src/lib/stores/settings.svelte.ts, src/app.css</files>
  <action>
**src/lib/config/defaults.ts** — change ONLY these literals (every other key already equals the backup; leave them alone):
- `DEFAULT_ACCENT` (line 29): `'#7c5cff'` → `'#00c2b8'`. Extend the doc comment: quick-260925-vtg — teal, the user's own exported settings adopted as the defaults (was #7c5cff; #00c2b8 is already an ACCENT_PRESETS entry so the picker highlights it).
- `APPEARANCE_DEFAULTS.rowActions` (line 77): `[]` → `['download', 'like'] as readonly RowAction[]`. Rewrite the quick-260920-kxz paragraph (lines 70-75): keep l9e's "the array is a left-to-right LAYOUT" and "the ⋮ menu is unconditional" rationale, replace the NEITHER-ON justification with: quick-260925-vtg supersedes kxz — a fresh row shows Download then Like, the user's own exported settings adopted as the defaults; an existing user's persisted `[]` still survives load() (Array.isArray guard, asserted in settings-persist). Keep the WR-10 line.
- `TRANSLATION_DEFAULTS` header comment (lines 81-83): rewrite — lyricsLang and bioLang are now 'off' too (quick-260925-vtg), so no surface auto-translates by default; artist/title/lastfm were already 'off' (k3y / f4y).
- `lyricsLang` (line 85): `'auto'` → `'off'`. `bioLang` (line 89): `'auto'` → `'off'` (keep the `as 'auto' | LyricsLang` cast — the type still allows 'auto').
- `artistSkip`, `titleSkip`, `lyricsSkip` (lines 90-92): `[]` → `['en'] as readonly SourceLang[]`. `lastfmSkip` STAYS `[]`. Add a one-line comment above them: quick-260925-vtg — English titles/artists/lyrics are never translated by default (user's exported settings); lastfmSkip left empty to match the export.
- `zhScript` (line 101): `'off'` → `'zh-Hant'`. Rewrite the quick-260919-2jo comment (lines 95-100): 2jo chose OFF so an EXISTING user saw no text change; quick-260925-vtg flips the DEFAULT to 'zh-Hant' (user's exported settings) — existing users are still untouched because load() now accepts a persisted 'off' as a real value (see the zhScript guard in settings.svelte.ts). Keep the WR-10 line.
- `downloadQuality` (line 118): `'lossless'` → `'auto'`; replace the trailing comment with: quick-260925-vtg — same 'auto' rule as defaultQuality (32-D-02: lossless on unmetered, '320' elsewhere), user's exported settings.
- `showQualityTag` (line 124): `false` → `true`. Rewrite the k5y comment: shown by default per quick-260925-vtg (user's exported settings); k5y's "extra chrome" reasoning is superseded. Do NOT touch `nowbarLyrics` (line 129) — but its comment says "for the same reason showQualityTag above is"; amend that one clause to "for the reason k5y originally gave for showQualityTag (before quick-260925-vtg flipped it)".
- `HOME_DEFAULTS.homeChartRegion` (line 205): `'auto'` → `'hk'` (keep the `as 'auto' | ChartRegion` cast). `homeExtraRegions` (line 206): `[]` → `['us']`. Rewrite the 39-D-25 comment (lines 202-204): 39-D-25 locked 'auto' + no extra regions + the 8-genre set; quick-260925-vtg supersedes those three by explicit user request (user's exported settings): region 'hk', extra ['us'], genres = all 11 (sourced from home-layout.ts so the two never drift). A persisted 'auto' is still honoured by load().

**src/lib/services/home-layout.ts**:
- `DEFAULT_CHART_GENRES` (lines 226-227): replace with the explicit 11-id literal in this order: cantopop, mandopop, kpop, jpop, hiphop, rock, dance, rnb, electronic, alternative, asian. Replace the "Locked default: Asian pop + Western core" comment with: quick-260925-vtg — every pool genre, in pool order (user's exported settings adopted as the defaults; supersedes the 39-D-10 8-genre lock). Kept as an explicit literal, not `[...CHART_GENRE_IDS]`, so a future pool addition does not silently widen the default.
- `DEFAULT_SECTION_ORDER` (lines 288-292): replace `[...HOME_SECTIONS]` with the explicit literal `['radio','downloads','liked','chart-songs','new-releases','chart-artists','chart-albums','yt-trending','genres','top-hits','top-artists','regions','tags','countries','fav-artists','playlists','history']` (typed `HomeSectionId[]`). Rewrite the doc comment: quick-260925-vtg — no longer === HOME_SECTIONS; this is the user's exported order (personal group radio-first, classic shelves interleaved where the export put them). It MUST remain a permutation of all 17 HOME_SECTIONS ids (guarded by home-layout.test.ts) because resolveSectionOrder returns it verbatim as the fallback. HOME_SECTIONS itself stays the canonical/append order and is unchanged. Do NOT change `HOME_SECTIONS`, `CLASSIC_SECTIONS`, `CHART_SECTIONS` or `migrateHomeLayout`.

**src/lib/stores/settings.svelte.ts** — two guard fixes plus WR-10 literal cleanup, all inside `load()`:
- zhScript guard (lines 348-351): the allowlist accepts only 'zh-Hant' | 'zh-Hans' and sends everything else to `TRANSLATION_DEFAULTS.zhScript`. With the default now 'zh-Hant', an existing user's explicit persisted `'off'` would be silently flipped. Widen the condition to `v.zhScript === 'off' || v.zhScript === 'zh-Hant' || v.zhScript === 'zh-Hans'`. Add to the T-2jo-02 comment: quick-260925-vtg — 'off' is a real persisted choice (and the pre-vtg default), so it must pass the guard; only absent/garbage falls to the default.
- homeChartRegion guard (lines 399-402): same trap — `'auto'` (the "Auto (…)" chip) is a legitimate persisted value that only survived because the fallback literal happened to be `'auto'`. Change the condition to accept `v.homeChartRegion === 'auto'` OR (string AND in `CHART_REGIONS`), and change the fallback literal `'auto'` to `HOME_DEFAULTS.homeChartRegion` (WR-10: no duplicated literal). Extend the T-39-25 comment: quick-260925-vtg — 'auto' is honoured as a persisted value; absent/garbage/'cn' now fall to the defaults.ts value ('hk', itself allowlisted), not a literal.
- Skip-list fallbacks (lines 288-291): the `: []` literals → `: [...TRANSLATION_DEFAULTS.artistSkip]` etc. for all four (WR-10 — the default now differs from `[]` for three of them, so an absent key must get the defaults.ts value). Add a short comment: quick-260925-vtg — read defaults.ts, not a literal; a persisted `[]` still wins (Array.isArray).
- Comments only: line ~212 "Off by default (PLAYBACK_DEFAULTS.showQualityTag)" → "Default lives in PLAYBACK_DEFAULTS.showQualityTag (ON since quick-260925-vtg)". Line ~621 `// quick-260919-2jo — back to 'off' (D-1)` → `// quick-260919-2jo / quick-260925-vtg — back to TRANSLATION_DEFAULTS.zhScript ('zh-Hant')`. Line ~549 mentions "#7c5cff → #6a48f0" as the darken worked example — leave it, it is a ratio illustration, not a default.
- Verify by reading (do not change): every other changed key's load() path is structurally safe for persisted old-default values — `??` for lyricsLang/bioLang/downloadQuality/accent, `typeof === 'boolean'` for showQualityTag, `Array.isArray` for rowActions/homeSectionOrder/homeExtraRegions/homeChartGenres. First-visit `appLang` detection (lines 276-278, 461-464) is untouched.

**src/app.css** (Claude's discretion, documented here): lines 9-10 hold the PRE-HYDRATION paint `--color-primary: #7c5cff; --color-primary-hover: #6a48f0;`. `applyTheme()` overwrites both from the saved/default accent at boot, so a fresh install would flash purple then snap to teal. Change them to `#00c2b8` / `#00aba2` (= darken('#00c2b8', 0.12)) with a trailing `/* quick-260925-vtg: matches DEFAULT_ACCENT; applyTheme() overrides at runtime */`. Grep app.css for any other `7c5cff`/`6a48f0` and update if found. Existing users are unaffected (applyTheme applies THEIR saved accent). Deliberately NOT changed: the brand gradients in `Logo.svelte`, `static/favicon.svg`, `static/icon-maskable.svg`, `static/og.svg` (brand art, not the accent setting) and the `var(--color-primary, #7c5cff)` fallbacks in `ToastHost.svelte` / `(app)/+layout.svelte` (dead fallbacks — the var is always defined).

Do NOT commit after this task — the tests are red until Task 2 and every commit must be green (main auto-pushes and auto-deploys).
  </action>
  <verify>
    <automated>cd /Users/laichan/code/tung/openmusic && pnpm check 2>&1 | tail -5 && grep -v '^\s*//' src/lib/config/defaults.ts | grep -c "'#7c5cff'\|'lossless'\|zhScript: 'off'\|showQualityTag: false\|homeChartRegion: 'auto'" | grep -qx 0 && grep -c "quick-260925-vtg" src/lib/config/defaults.ts src/lib/services/home-layout.ts src/lib/stores/settings.svelte.ts src/app.css</automated>
  </verify>
  <done>`pnpm check` is clean; no old-default literal remains in non-comment lines of defaults.ts; all four files carry a quick-260925-vtg decision-ref; `load()` accepts persisted `'off'` (zhScript) and `'auto'` (homeChartRegion); `DEFAULT_SECTION_ORDER` is the 17-id literal and `DEFAULT_CHART_GENRES` is the 11-id literal.</done>
</task>

<task type="auto">
  <name>Task 2: Update the tests that pin the old defaults and add the persisted-old-default regression guards</name>
  <files>src/lib/services/home-layout.test.ts, src/lib/services/home-charts.test.ts, src/lib/stores/settings-persist.svelte.test.ts, src/lib/stores/settings.svelte.test.ts</files>
  <action>
Update assertions to the NEW values only — never loosen, skip or delete a case. Tag each edited/added case with quick-260925-vtg in its title or a comment.

**src/lib/services/home-layout.test.ts**
- Lines 63-65 ("DEFAULT_SECTION_ORDER deep-equals HOME_SECTIONS"): replace with two cases — (a) `DEFAULT_SECTION_ORDER` toEqual the exact 17-id literal from Task 1; (b) a permutation guard: `[...DEFAULT_SECTION_ORDER].sort()` toEqual `[...HOME_SECTIONS].sort()` and `new Set(DEFAULT_SECTION_ORDER).size` toBe 17 (this is what keeps resolveSectionOrder's fallback valid). Keep the "distinct array" case (67-69) as-is.
- Lines 542-543: expect the 11-id literal; retitle "DEFAULT_CHART_GENRES is every pool genre in pool order (quick-260925-vtg)".
- Lines 714-720 (`reorderListed(full, 0, 12)` on the full default order): `full[0]` is now 'radio', so the last assertion becomes `expect(r[r.length - 1]).toBe('radio')`. The classic-index and sorted-equality assertions are unchanged. (Planner-traced: listed ids = 13, moving index 0 → 12 puts 'radio' in the last non-classic slot, which is index 16.)
- The resolveSectionOrder cases (88-130) append in HOME_SECTIONS order and are unaffected — confirm by running, do not edit.

**src/lib/services/home-charts.test.ts** — task counts are `non-genre + DEFAULT_CHART_GENRES.length`, so 8 → 11 shifts them by 3:
- Line 45-47: 14 → 17 (retitle "plans 17 tasks …"). Line 83-85: 12 → 15. Line 113: 14 → 17. The key lists built from `DEFAULT_CHART_GENRES.map(...)` self-adjust. Run the file; if any other `toHaveLength` derives from the genre count, shift it by 3 too.

**src/lib/stores/settings-persist.svelte.test.ts**
- rowActions block (88-153): the "defaults to []" case (93-97) → `['download', 'like']`; the corrupt non-array `it.each` (122-128) → falls back to `['download', 'like']`; the resetAppearance case (145-153) must START from a value that differs from the new default — use `[]` — and expect `['download', 'like']` in both the field and the persisted blob. Update the two kxz comments (91-93, 145-146) to say quick-260925-vtg reversed kxz back to both-on (Download first). The "persisted EMPTY array is honoured" case (114-120) is unchanged and is now a meaningful guard.
- Home chart block (194-297): `DEFAULT_GENRES` const (200) → the 11-id literal; "defaults to auto" (209-212) → 'hk'; "homeExtraRegions defaults to []" (215-218) → `['us']`; "blob without the three keys" (227-230) → 'hk' / `['us']`; the four corrupt-region cases (237-251: 'cn', 42, 'HK', 'garbage') → now load as 'hk' (retitle "… loads as the default (hk) …"); non-array extras (258-259) → `['us']`; resetHome (286-296) → 'hk' / `['us']` in field and blob. ADD one case: "a persisted 'auto' region survives load (quick-260925-vtg — Auto is a real choice, not corruption)" → `loadWith({ homeChartRegion: 'auto' })` yields 'auto'.
- ADD a small describe "settings persistence — zhScript survives load (quick-260925-vtg)" using the same `memStore` / `freshSettings()` pattern: (1) persisted `'off'` loads as `'off'`; (2) a blob without the key loads as `'zh-Hant'`; (3) a garbage value (`'bogus'`) loads as `'zh-Hant'`. These are the guards for the two load() traps fixed in Task 1.
- The 39-D-40 migration block (307-400) is unaffected (OLD_BLOB carries its own homeSectionOrder; the fresh-install case compares to HOME_DEFAULTS.homeSectionOrder by reference) — run, do not edit.

**src/lib/stores/settings.svelte.test.ts**
- zhScript block (286-306): the default case (291-293) → `'zh-Hant'`, retitle "defaults to 'zh-Hant' — quick-260925-vtg: the user's exported settings adopted as the defaults". The reset case (295-298): set `'zh-Hans'` first (it must differ from the new default or the case proves nothing), expect `'zh-Hant'` after `resetTranslation()`. Leave the darken test (258-275) alone — its `'#7c5cff'` is a local input to `darken`, not the default.

Confirmed NOT affected (planner-checked; do not edit unless the full run says otherwise): `names.test.ts` (settings fully mocked, sets zhScript/bioLang explicitly), `lyric-script.svelte.test.ts` (every case sets `settings.zhScript` via its `load()` helper), `backup-roundtrip.svelte.test.ts` (asserts a PERSISTED `showQualityTag: false` survives import — now a stronger test), `download-track.test.ts` / `download-probe.test.ts` (settings mocked with an explicit 'lossless'), `i18n.test.ts` (key names only), `qq/kuwo/joox.test.ts` (set `defaultQuality` explicitly; `defaultQuality` is unchanged).
  </action>
  <verify>
    <automated>cd /Users/laichan/code/tung/openmusic && pnpm vitest run src/lib/services/home-layout.test.ts src/lib/services/home-charts.test.ts src/lib/stores/settings-persist.svelte.test.ts src/lib/stores/settings.svelte.test.ts 2>&1 | tail -8 && grep -c "quick-260925-vtg" src/lib/stores/settings-persist.svelte.test.ts</automated>
  </verify>
  <done>The four test files pass with assertions moved to the new values; settings-persist gains the "persisted 'off' zhScript survives", "persisted 'auto' region survives" and absent/garbage-→-default cases; no `it.skip` / deleted case; every edited case references quick-260925-vtg.</done>
</task>

<task type="auto">
  <name>Task 3: Full gates, then one green commit</name>
  <files>src/lib/config/defaults.ts, src/lib/services/home-layout.ts, src/lib/stores/settings.svelte.ts, src/app.css, src/lib/services/home-layout.test.ts, src/lib/services/home-charts.test.ts, src/lib/stores/settings-persist.svelte.test.ts, src/lib/stores/settings.svelte.test.ts</files>
  <action>
Run the three gates in order and fix anything red BEFORE committing (main auto-pushes and Cloudflare Pages auto-deploys, so a red commit ships): `pnpm test` (full suite — this is where any test the planner classified as "not affected" would surface; fix by moving its assertion to the new default, never by loosening), then `pnpm check`, then `pnpm build`.

Then stage exactly the eight files above and commit ONCE: `feat(quick-260925-vtg): adopt the user's exported settings as the app defaults` with a body listing the changed keys (accent, rowActions, lyricsLang/bioLang, artist/title/lyrics skip, zhScript, downloadQuality, showQualityTag, homeChartRegion, homeExtraRegions, homeChartGenres, homeSectionOrder), the two load() guard fixes (persisted 'off' / 'auto' now survive), and "existing users' saved settings untouched; supersedes 39-D-25 / 39-D-10 chart defaults by explicit user request". End with the Co-Authored-By line from the session attribution. Do not push.
  </action>
  <verify>
    <automated>cd /Users/laichan/code/tung/openmusic && pnpm test 2>&1 | tail -6 && pnpm check 2>&1 | tail -3 && pnpm build 2>&1 | tail -3 && git log -1 --stat | head -15</automated>
  </verify>
  <done>`pnpm test`, `pnpm check`, `pnpm build` all green; exactly one new commit containing the eight files; working tree clean apart from pre-existing untracked files.</done>
</task>

</tasks>

<threat_model>
## Trust Boundaries

| Boundary | Description |
|----------|-------------|
| localStorage → settings.load() | `openmusic:settings:v1` is user/extension-writable (existing boundary; every changed key already crosses it) |

## STRIDE Threat Register

| Threat ID | Category | Component | Disposition | Mitigation Plan |
|-----------|----------|-----------|-------------|-----------------|
| T-vtg-01 | Tampering | settings.load() homeChartRegion fallback | mitigate | The fallback moves from the literal 'auto' to `HOME_DEFAULTS.homeChartRegion` ('hk'), which is itself inside `CHART_REGIONS`; the allowlist check is widened only by the exact string 'auto' (already handled downstream by resolveChartRegion). No unallowlisted value can reach the chart fetch planner. Persist tests cover 'cn' / 42 / 'HK' / 'garbage' → 'hk'. |
| T-vtg-02 | Tampering | settings.load() zhScript guard | mitigate | Widened only by the exact literal 'off' (a valid union member); garbage still falls to the default. Persist test covers 'bogus' → 'zh-Hant'. |
| T-vtg-03 | Tampering | DEFAULT_SECTION_ORDER not a permutation | mitigate | Explicit permutation test (sorted-equality + size 17) in home-layout.test.ts so resolveSectionOrder's verbatim fallback can never drop a section. |
| T-vtg-04 | Information disclosure | New defaults widen cold home fan-out (11 genres, +1 extra region) | accept | Same limiters already govern it (home FANOUT_CAP, cover-backfill CAP, apiFetch MAX_CONCURRENT_REQUESTS=8 + circuit breaker); the user has been running this exact configuration. |
| T-vtg-SC | Tampering | npm installs | accept | No package installs in this plan. |
</threat_model>

<verification>
- `pnpm test`, `pnpm check`, `pnpm build` green on HEAD.
- `grep -v '^\s*//' src/lib/config/defaults.ts | grep -c "'#7c5cff'"` → 0; `grep -c quick-260925-vtg` > 0 in defaults.ts, home-layout.ts, settings.svelte.ts, settings-persist.svelte.test.ts.
- settings-persist: persisted `zhScript: 'off'` → 'off'; persisted `homeChartRegion: 'auto'` → 'auto'; persisted `rowActions: []` → []; the 39-D-40 migration block unchanged and passing.
- home-layout.test: `[...DEFAULT_SECTION_ORDER].sort()` equals `[...HOME_SECTIONS].sort()`.
</verification>

<success_criteria>
- Fresh install and every reset group produce exactly the backup's values for the 11 changed keys; all other keys unchanged.
- No existing persisted value is altered by `load()` — specifically the two allowlist traps (zhScript 'off', homeChartRegion 'auto') are closed with regression tests.
- Existing-user home-layout migration output is byte-identical to before (migrateHomeLayout never reads the changed consts).
- Comments in defaults.ts / home-layout.ts justify the NEW values, tagged quick-260925-vtg, and note the 39-D-25 / 39-D-10 supersession.
- Single commit, all three gates green.
</success_criteria>

<output>
Create `.planning/quick/260925-vtg-make-exported-settings-the-app-defaults-/260925-vtg-SUMMARY.md` when done.
</output>
