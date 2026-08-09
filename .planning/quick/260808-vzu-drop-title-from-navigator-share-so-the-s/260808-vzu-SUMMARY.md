---
phase: quick-260808-vzu
plan: 01
subsystem: share
tags: [share, web-share-api, settings, i18n]
requires: [quick-260808-vkd]
provides: ["shareIncludeTitle setting — Web Share payload is link-only by default"]
affects:
  - src/lib/config/defaults.ts
  - src/lib/stores/settings.svelte.ts
  - "src/routes/(app)/settings/general/+page.svelte"
  - src/lib/components/TrackMenu.svelte
  - "src/routes/(app)/album/[name]/+page.svelte"
  - "src/routes/(app)/artist/[name]/+page.svelte"
tech-stack:
  added: []
  patterns: ["browser=true settings harness with vi.resetModules() per case, so a module-scope singleton's once-guard can be re-exercised"]
key-files:
  created:
    - src/lib/stores/settings-persist.svelte.test.ts
  modified:
    - src/lib/config/defaults.ts
    - src/lib/stores/settings.svelte.ts
    - "src/routes/(app)/settings/general/+page.svelte"
    - src/lib/components/TrackMenu.svelte
    - "src/routes/(app)/album/[name]/+page.svelte"
    - "src/routes/(app)/artist/[name]/+page.svelte"
    - src/lib/services/share.test.ts
    - "src/lib/i18n/{ar,de,en,es,fr,hi,id,it,pt,ru,th,tr,vi,zh-Hans,zh-Hant}.ts"
decisions:
  - "The title line becomes a SETTING, not a deletion — the user explicitly rejected dropping it; some users want the context inline"
  - "Default OFF: concatenating targets (WhatsApp) render title + text as two lines, duplicating the OG card's own `Song • Artist`"
  - "OFF branch is `{ text: url }` with no placeholder title — the Web Share spec's at-least-one-member rule is satisfied by `text` alone"
  - "No new <h2> in the settings UI — the row label is self-describing, and a heading would cost a third i18n key across 15 locales for no information"
metrics:
  duration: 8 min
  completed: 2026-08-08
requirements: [QUICK-260808-VZU]
---

# Quick 260808-vzu: Gate the Web Share title behind a setting — Summary

`shareIncludeTitle` (default **OFF**) now controls whether the Web Share payload carries the
`Song • Artist` title line. With it off, all three `navigator.share` call sites send `{ text: url }`
— a bare link that concatenating targets render as one line with the OG card unfurling beneath it,
instead of the title, then the link, then the same title again inside the card. Flipping the toggle
in Settings → General restores the old `{ title, text: url }` shape.

## What Changed

| File | Change |
|------|--------|
| `src/lib/config/defaults.ts` | `shareIncludeTitle: false` in `GENERAL_DEFAULTS` |
| `src/lib/stores/settings.svelte.ts` | **four** touchpoints: `$state` declaration (:164), tamper-guarded load branch (:267-270), save payload (:369), `resetGeneral()` (:436) |
| `src/routes/(app)/settings/general/+page.svelte` | `Share2` icon import, `toggleShareTitle()`, a `.row-toggle` section reusing the existing `.sw` styles |
| 15 × `src/lib/i18n/*.ts` | `"settings.shareIncludeTitle"` + `"settings.shareIncludeTitleDesc"`, genuine translations, double quotes, inserted adjacent to the `reduceMotion` pair |
| `TrackMenu.svelte:212` · `album/[name]:469` · `artist/[name]:212` | payload → `settings.shareIncludeTitle ? { title: …, text: url } : { text: url }` |
| `src/lib/services/share.test.ts` | vkd's `it.each` assertions rewritten to the gated shape (describe, file list, comment block kept) |
| `src/lib/stores/settings-persist.svelte.test.ts` | **new** — genuine `load()` / `save()` / `resetGeneral()` round-trips |

The `resetGeneral()` touchpoint is the one that is silently skippable: without it, the "reset group"
button leaves the setting stuck at the user's old value. Test 8 pins it.

## RED Gate — Observed, Verbatim

Run against **unmodified production sources**, before any production edit
(`pnpm vitest --run src/lib/services/share.test.ts src/lib/stores/settings-persist.svelte.test.ts`):

```
 × src/lib/components/TrackMenu.svelte gates the nav.share title on the setting and keeps the link in `text` 4ms
 × src/routes/(app)/album/[name]/+page.svelte gates the nav.share title on the setting and keeps the link in `text` 1ms
 × src/routes/(app)/artist/[name]/+page.svelte gates the nav.share title on the setting and keeps the link in `text` 1ms
 × defaults to false when nothing is persisted 146ms
 × an explicitly persisted `true` wins on load 6ms
 × a corrupt non-boolean falls back to the default (false) 6ms
 × save() writes the field into the persisted blob 6ms
 × resetGeneral() reverts the field AND the persisted blob 6ms

 Test Files  2 failed (2)
      Tests  8 failed | 55 passed (63)
```

Failing assertions, verbatim from the run:

```
share.test.ts:568  expect(src).toMatch(/nav\.share\(settings\.shareIncludeTit…/)
AssertionError: expected '<script lang="ts">\n\timport { tick, …' to match /nav\.share\(settings\.shareIncludeTit…/
AssertionError: expected '<script lang="ts">\n\t// Album page. …' to match /nav\.share\(settings\.shareIncludeTit…/
AssertionError: expected '<script lang="ts">\n\t// Artist page.…' to match /nav\.share\(settings\.shareIncludeTit…/
AssertionError: expected undefined to be false // Object.is equality   (default)
AssertionError: expected undefined to be true  // Object.is equality   (persisted true)
AssertionError: expected undefined to be false // Object.is equality   (corrupt 'yes')
AssertionError: expected undefined to be true  // Object.is equality   (save payload)
AssertionError: expected true to be false      // Object.is equality   (resetGeneral)
```

`git status` at that moment listed only `src/lib/services/share.test.ts` and the new
`src/lib/stores/settings-persist.svelte.test.ts` as changed — **zero production files touched**.
The tests were red on arrival on the first run; no test needed replacing mid-execution, and the
plan's hand-verified regexes matched all three implemented shapes on the first try (no rerun of the
`[^}]*`-cannot-cross-`}` trap). Note the honest detail: assertion 3 (vkd's no-`url`-member
invariant) was **already satisfied** pre-change — vkd had removed the `url` member. It is carried
forward as a regression guard, not as a RED contributor. Assertions 1 and 2 supplied the 3
structural failures.

## Gates — Observed Numbers

| Gate | Baseline (measured this session) | After |
|------|----------------------------------|-------|
| `pnpm test` | **89 files / 1531 tests**, 0 failures, exit 0 | **90 files / 1536 tests** passed, 0 failures |
| `pnpm check` | 4368 files 0/0 (prior session) | **4369 FILES 0 ERRORS 0 WARNINGS 0 FILES_WITH_PROBLEMS** |
| `pnpm build` | — | **exit 0** (adapter-cloudflare) |
| `pnpm build:native` | — | **exit 0** (adapter-static) |

The baseline was measured, not assumed — a `pnpm test` run before any edit reported
`Test Files 89 passed (89) / Tests 1531 passed (1531)`. +1 file and +5 tests are the new round-trip
file; the 3 structural cases were modified in place, not added, so the count matches the plan's
prediction exactly.

## Constraint Compliance (verified via `git diff -U0`)

`git diff -U0` on the three call-site files, filtered to removed lines, returns **exactly 3 lines**:

```
-			if (nav.share) await nav.share({ title: `${dTitle} • ${dArtist}`, text: url });
-			if (nav.share) await nav.share({ title: dArtist ? `${dName} • ${dArtist}` : dName, text: url });
-			if (nav.share) await nav.share({ title, text: url });
```

- **Zero comment lines deleted** — SHARE-02, OG-ZH-01, OG-EP-01, OG-PATH-02, quick-260723-r4p/ry1,
  quick-260808-urx and the entire quick-260808-vkd block survive byte-identical; the vzu block was
  appended *below* vkd's.
- **Zero clipboard lines changed** — `grep -c clipboard.writeText` returns 1 in each of the three files.
- **`text: url` preserved exactly as vkd left it** in both ternary branches; no `url` member anywhere.
- **Zero `as any`** added — the conditional payload typechecks as `ShareData` without a cast
  (`pnpm check` 0/0 confirms).
- All 15 locale files carry both keys (`grep -c` returns 2 per file), double-quoted, genuine
  translations, i18n key-set parity green.
- **No deploy run.**

## HONEST LIMIT — Not Device-Verified

**Real share-sheet output cannot be verified in this environment.** There is no OS share sheet here,
and no curl or unit test exercises one. The structural test proves the **call shape only** — that a
revert or an ungated `nav.share({…})` gets caught. It does not prove what a recipient sees.

**Required device UAT (yours):**
1. Setting **OFF** (the default) — share a song from a real phone to WhatsApp. The message should be
   the bare URL on one line, with the OG card unfurling beneath it. No `Song • Artist` line above.
2. Flip **Settings → General → Include title when sharing** ON, share again — the `Song • Artist`
   line returns above the link.
3. Worth eyeballing in the same pass: the setting survives an app reload, and Reset group turns it
   back off.

Not deployed — production is ahead of this session's knowledge, and `pnpm run deploy` (not
`pnpm deploy`, which hits pnpm's builtin) is the working form if you want it shipped.

## Deviations from Plan

None — plan executed as written. The plan's Tests 1-3 were written as three assertions inside the
one existing 3-case `it.each` (the vkd precedent the plan itself points at), which is what its own
done-criterion ("the 3 structural cases FAIL") describes.

## Assumption Drift (advisory)

- **Planned:** all three new structural assertions contribute to the RED gate.
  **Actual:** assertion 3 (no bare `url` ShareData member) passed against unmodified sources — vkd
  had already removed the `url` member, so nothing could match it.
  **Why it matters:** the "3 structural failures" in the RED output came from assertions 1 and 2
  alone. Assertion 3 is a carried-forward regression guard, not evidence the new behavior was absent.
  Non-blocking; the gate's purpose (proving the gated shape did not yet exist) was still met.

## Commits

- `571daf4` — `test(quick-260808-vzu): RED — gate the nav.share title on a shareIncludeTitle setting`
- `f2462f4` — `feat(quick-260808-vzu): add the shareIncludeTitle setting (default off)`
- `936a61a` — `feat(quick-260808-vzu): gate the nav.share title on settings.shareIncludeTitle`

## Self-Check: PASSED

- `src/lib/config/defaults.ts` — FOUND, `shareIncludeTitle: false` in `GENERAL_DEFAULTS`
- `src/lib/stores/settings.svelte.ts` — FOUND, 4 `shareIncludeTitle` touchpoints
- `src/routes/(app)/settings/general/+page.svelte` — FOUND, `settings.shareIncludeTitle` toggle
- `src/lib/stores/settings-persist.svelte.test.ts` — FOUND, 5 tests passing
- `src/lib/services/share.test.ts` — FOUND, 58 tests passing
- All 15 `src/lib/i18n/*.ts` — FOUND, 2 new keys each
- Commits `571daf4`, `f2462f4`, `936a61a` — all FOUND in `git log`
