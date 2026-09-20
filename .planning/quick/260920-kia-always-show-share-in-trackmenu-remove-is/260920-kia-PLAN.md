---
phase: quick-260920-kia
plan: 01
type: execute
wave: 1
depends_on: []
files_modified:
  - src/lib/components/TrackMenu.svelte
autonomous: true
requirements: [QUICK-260920-KIA]

must_haves:
  truths:
    - "Opening TrackMenu on an imported `device:` track shows the Share row"
    - "Opening TrackMenu on a catalog track still shows the Share row (no regression)"
    - "Download (header icon AND list row) is still hidden for `device:` tracks"
    - "Tapping Share on a `device:` track produces a `/song/<artist>/<title>` URL with NO `?u=` carrier (no local uid leaks)"
  artifacts:
    - path: "src/lib/components/TrackMenu.svelte"
      provides: "Unconditional Share row; updated Contract 8 decision comments"
      contains: "260920-kia"
  key_links:
    - from: "src/lib/components/TrackMenu.svelte"
      to: "src/lib/services/share.ts songShareUrl/uidCarrier"
      via: "doShare() → songShareUrl(..., track)"
      pattern: "songShareUrl\\("
---

<objective>
Make the Share row in TrackMenu unconditional: remove the `{#if !isDevice}` wrapper around the Share `<button class="mi">` only. Download's `isDevice` guard is untouched.

Purpose: user report "share button is missing from menu sometimes, it should always exist". The gate was UI-SPEC Contract 8 (Phase 34) hiding Share for `device:` imports on the rationale "a share link to a file only on this phone is nonsense (and would emit a URL carrying a local uid)". That mechanism claim is wrong today: `songShareUrl()` builds a NAME-based `/song/<artist>/<title>` link, and `share.ts` `uidCarrier()` already returns `null` for `isDeviceUid(id.uid)` (38-D-08), so an imported track shares a valid catalog link and no local uid reaches the URL.

Output: one-file diff in `TrackMenu.svelte` (one `{#if}` pair removed, two decision comments amended). No service, test, or i18n changes.
</objective>

<execution_context>
@/Users/laichan/.claude/plugins/cache/gsd-plugin/gsd/4.5.3/workflows/execute-plan.md
@/Users/laichan/.claude/plugins/cache/gsd-plugin/gsd/4.5.3/templates/summary.md
</execution_context>

<context>
@.planning/STATE.md
@./CLAUDE.md
@src/lib/components/TrackMenu.svelte
@src/lib/services/share.ts

<interfaces>
<!-- Verified during planning. Use directly — no exploration needed. -->

From src/lib/components/TrackMenu.svelte (line refs approximate, verify with grep):
- L97:   `const isDevice = $derived(!!track && isDeviceUid(track.uid));`  — KEEP (Download, dlProbe, "Don't import again" row, removeDownload all still read it)
- L938-942 (inside `<div class="head-actions">`): HTML comment beginning `<!-- 34 (RESEARCH bites #10/#11, UI-SPEC Contract 8): Download and Share are HIDDEN for device: entries — …` — AMEND
- L962: `{#if !isDevice}` opening the header DOWNLOAD icon fork — KEEP. The header renders NO Share icon; `Share2` is imported once and used only at L1201.
- L1198-1202:
  `<!-- Hidden for device: entries — a share link to a file only on this phone is nonsense (and would emit a URL carrying a local uid). See the header fork's note. -->`
  `{#if !isDevice}`
  `	<button class="mi" onclick={doShare} use:tapBounce><Share2 size={18} /> {t('menu.share')}</button>`
  `{/if}`
  — REMOVE the `{#if}`/`{/if}` pair, AMEND the comment.
- L726 `async function doShare()` → L785 `songShareUrl({ title: dTitle, artist: dArtist }, shareCover, recallItunesId(shareCover), track)`. No device branch in doShare and none needed (see Task 1 action).

From src/lib/services/share.ts:
```ts
export function songShareUrl(
	t: { title: string; artist: string },
	coverUrl?: string | null,
	itunesId?: string | null,
	id?: { uid: string; source: string; songid: string } | null
): string
// L454 inside uidCarrier(): `if (!id || isDeviceUid(id.uid)) return null;`  ← the runtime device skip
```

From src/lib/services/share.test.ts:
- L838: `it('a \`device:\` uid carries NOTHING — a local file must never share as a foreign kuwo song', …)` — ALREADY pins the behaviour this plan relies on. No new test required.
</interfaces>
</context>

<tasks>

<task type="auto">
  <name>Task 1: Unconditional Share row + amend the two Contract 8 decision comments</name>
  <files>src/lib/components/TrackMenu.svelte</files>
  <action>
Edit ONLY `src/lib/components/TrackMenu.svelte`. Three edits, nothing else in the file changes (no menu refactor, no other gates touched).

1. Share list row (~L1198-1202): delete the `{#if !isDevice}` line and its matching `{/if}` around the single `<button class="mi" onclick={doShare} …>` so the button renders unconditionally at the same list position. Preserve the surrounding tab indentation (tabs, per CLAUDE.md) so the button sits at the same indent level as its `.mi` siblings (Sleep timer / Go to artist / Detail).

2. Replace the row's HTML comment (currently "Hidden for device: entries — a share link to a file only on this phone is nonsense (and would emit a URL carrying a local uid). See the header fork's note.") with an amended decision record. It must (a) keep the reference to Contract 8 / the header fork's note, (b) tag `quick-260920-kia`, and (c) state the reasoning in house style, roughly: Share is UNCONDITIONAL — Contract 8's `!isDevice` guard on Share is superseded by quick-260920-kia. The original rationale ("a share link to a file only on this phone … would emit a URL carrying a local uid") was wrong about the mechanism: `songShareUrl()` emits a NAME-based `/song/{artist}/{title}` catalog link, and share.ts `uidCarrier()` returns null for `isDeviceUid()` (38-D-08), so an imported local track shares a valid catalog link and no `device:` uid ever reaches the URL. Sharing an imported song therefore has the same meaning as sharing any other song: "here is this song". Note that no runtime guard is added in doShare() — the device skip already lives at the one place all callers route through (share.ts), pinned by share.test.ts "a `device:` uid carries NOTHING". Do NOT reintroduce a device guard in doShare().

3. Header comment (~L938-942, inside `<div class="head-actions">`): AMEND, do not delete. Keep the "34 (RESEARCH bites #10/#11, UI-SPEC Contract 8)" reference and the Download half verbatim in meaning; change the sentence so it says Download is HIDDEN for device: entries (downloading a file already on this phone is nonsense), then add: "quick-260920-kia: Contract 8's SHARE half is SUPERSEDED — Share is unconditional; see the Share row's note below for why the 'local uid in the URL' premise no longer holds. The `!isDevice` fork below gates DOWNLOAD ONLY." Leave the trailing sentence about track-menu-gate.ts being resolve TIMING as-is.

Do NOT touch: `const isDevice` (still consumed by Download header fork, dlProbe, removeDownload gating, "Don't import again" row), the `{#if !isDevice}` at ~L962 (header Download), the `{#if !isDevice}` at ~L1081 (Download list row), or the `{#if isDevice}` at ~L1179. Do NOT add a test to share.test.ts — L838 already asserts a `device:` uid yields a carrier-free name URL, which is exactly the guarantee this change depends on.

After editing, confirm with `grep -n "{#if !isDevice}" src/lib/components/TrackMenu.svelte` that exactly TWO remain (header Download fork ~L962, Download list row ~L1081) and neither is adjacent to `onclick={doShare}`.
  </action>
  <verify>
    <automated>cd /Users/laichan/code/tung/openmusic && grep -n 'Share2 size' src/lib/components/TrackMenu.svelte && [ "$(grep -c '260920-kia' src/lib/components/TrackMenu.svelte)" -ge 2 ] && ! sed -n '1190,1210p' src/lib/components/TrackMenu.svelte | grep -B1 'onclick={doShare}' | grep -q '{#if' && pnpm check && pnpm test -- src/lib/services/share.test.ts</automated>
  </verify>
  <done>
    - The Share `<button class="mi" onclick={doShare}>` is not wrapped in any `{#if}`; both Download `{#if !isDevice}` forks (header ~L962, row ~L1081) and the `{#if isDevice}` "Don't import again" row are unchanged.
    - Both decision comments (header Contract 8 note, Share row note) still reference Contract 8 and now carry the `quick-260920-kia` supersession record explaining the name-based URL + share.ts device-skip mechanism.
    - `pnpm check` passes (0 errors); `share.test.ts` passes including the existing L838 `device:` carrier test.
    - No changes outside `src/lib/components/TrackMenu.svelte`.
  </done>
</task>

</tasks>

<threat_model>
## Trust Boundaries

| Boundary | Description |
|----------|-------------|
| client → OS share sheet / recipient | A share URL leaves the device; must not carry local identifiers |

## STRIDE Threat Register

| Threat ID | Category | Component | Disposition | Mitigation Plan |
|-----------|----------|-----------|-------------|-----------------|
| T-kia-01 | Information Disclosure | doShare() → songShareUrl() for a `device:` track | mitigate (already) | share.ts `uidCarrier()` returns null for `isDeviceUid()`; path segments are display names only; pinned by share.test.ts L838. No MediaStore id, file path, or `device:` uid reaches the URL. |
| T-kia-02 | Spoofing | recipient resolves a foreign song under a local file's title | accept | Same as today's name-based share for any catalog track (D-10 name resolve); the `u=` carrier is deliberately withheld for device tracks so a placeholder `kuwo` source can never be dispatched. |
| T-kia-SC | Tampering | npm installs | n/a | No package installs in this plan. |
</threat_model>

<verification>
- `pnpm check` green.
- `pnpm test -- src/lib/services/share.test.ts` green (existing device-uid test is the regression guard).
- `git diff --stat` shows only `src/lib/components/TrackMenu.svelte`.
- Optional manual: open TrackMenu on an imported device track in the dev server — Share row present, Download header icon + row absent.
</verification>

<success_criteria>
Share row renders for every track (catalog and `device:`); Download gating unchanged; both Contract 8 comments amended (not deleted) with the `quick-260920-kia` supersession and mechanism; typecheck + share tests pass; single-file diff.
</success_criteria>

<output>
Create `.planning/quick/260920-kia-always-show-share-in-trackmenu-remove-is/260920-kia-SUMMARY.md` when done.
</output>
