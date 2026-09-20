---
phase: quick-260919-vrq
plan: 01
type: execute
wave: 1
depends_on: []
files_modified:
  - src/lib/components/TrackMenu.svelte
  - src/lib/stores/library.svelte.ts
  - src/lib/stores/library.svelte.test.ts
  - src/lib/i18n/en.ts
  - src/lib/i18n/ar.ts
  - src/lib/i18n/de.ts
  - src/lib/i18n/es.ts
  - src/lib/i18n/fr.ts
  - src/lib/i18n/hi.ts
  - src/lib/i18n/id.ts
  - src/lib/i18n/it.ts
  - src/lib/i18n/pt.ts
  - src/lib/i18n/ru.ts
  - src/lib/i18n/th.ts
  - src/lib/i18n/tr.ts
  - src/lib/i18n/vi.ts
  - src/lib/i18n/zh-Hans.ts
  - src/lib/i18n/zh-Hant.ts
autonomous: true
requirements: [quick-260919-vrq]

must_haves:
  truths:
    - "Tapping the caret at the right of the idle Download row opens the 'Download from…' picker without starting a download"
    - "Tapping the Download label/meta area still starts the one-tap download exactly as before"
    - "Long-pressing the Download row still opens the picker, and the trailing native click does not also start a download"
    - "An app-downloaded song (non-device uid with an offline copy or a downloads-list row) shows a 'Remove download' row; a device: import shows only 'Don't import again' — never both"
    - "Tapping 'Remove download' opens an in-menu confirm sheet with honest body copy, ONE toggle ('Also delete the offline copy on this device', default on), Cancel, and a destructive Remove; Back / scrim / drag-down dismiss it without removing anything"
    - "Confirm with the toggle ON: library row dropped, unavailable mark cleared, blobStore.del(uid) called, excludeUid recorded, toast, menu closes"
    - "Confirm with the toggle OFF: library row dropped, unavailable mark cleared, blobStore.del NOT called, no exclusion mark, toast, menu closes; files on disk survive"
    - "library.removeDownload(uid) with no options behaves byte-for-byte as today (library/+page.svelte edit-mode swipe and noImport unaffected)"
    - "Every new i18n key exists in all 15 dictionaries (parity test green); svelte-check green; the new store test proves both toggle directions"
  artifacts:
    - path: "src/lib/stores/library.svelte.ts"
      provides: "removeDownload(uid, opts?: { deleteFile?: boolean }) — additive opt-out, default true"
      contains: "deleteFile"
    - path: "src/lib/stores/library.svelte.test.ts"
      provides: "two cases: default deletes the blob; deleteFile:false drops the row and never calls blobStore.del"
      contains: "deleteFile: false"
    - path: "src/lib/components/TrackMenu.svelte"
      provides: "split Download row (main + sibling caret button); Remove-download row; rmOpen confirm sheet with SettingToggle"
      contains: "trackmenu-rmdl"
    - path: "src/lib/i18n/en.ts"
      provides: "menu.removeDownload, menu.removeDownloadBody, menu.removeDownloadDeleteFile, menu.removeDownloadAction, toast.downloadRemoved"
      contains: "menu.removeDownloadDeleteFile"
  key_links:
    - from: "src/lib/components/TrackMenu.svelte (caret button)"
      to: "openDownloadPicker"
      via: "onclick"
      pattern: "onclick=\\{openDownloadPicker\\}"
    - from: "src/lib/components/TrackMenu.svelte confirmRemoveDownload()"
      to: "library.removeDownload(uid, { deleteFile })"
      via: "toggle state threaded as the option"
      pattern: "removeDownload\\(track\\.uid, \\{ deleteFile: rmDeleteFile \\}\\)"
    - from: "src/lib/stores/library.svelte.ts removeDownload"
      to: "blobStore.del"
      via: "gated on opts.deleteFile ?? true"
      pattern: "deleteFile \\?\\? true"
---

<objective>
In `TrackMenu.svelte`: (1) make the Download row's caret a real tap target that opens the existing "Download from…" picker while one-tap and long-press keep their current behaviour; (2) add a "Remove download" row for app-downloaded songs that opens an in-menu CONFIRM SHEET carrying one toggle — "Also delete the offline copy on this device" — whose state decides whether the files die (and an exclusion mark is recorded) or only the library row goes. `library.removeDownload` gains an additive `{ deleteFile }` opt-out (default true) with a node-level test for both directions. Plus i18n keys in all 15 dictionaries.

Purpose: the user asked verbatim "add remove download into the menu, and click the arrow next to download meta info will open download modal, both long press download or click the arrow will trigger it", then "the confirm modal should include checkbox on remove file on disk and auto added to exclude list, so user can choose to remove from device or not". A `window.confirm()` cannot hold a checkbox, so the confirm is an in-menu sheet built from the sub-sheet pattern TrackMenu already owns.

Output: modified `TrackMenu.svelte`, `library.svelte.ts` (+test), 5 new keys × 15 locale files. No new components, no new modal primitive.
</objective>

<execution_context>
@/Users/laichan/.claude/plugins/cache/gsd-plugin/gsd/4.5.3/workflows/execute-plan.md
@/Users/laichan/.claude/plugins/cache/gsd-plugin/gsd/4.5.3/templates/summary.md
</execution_context>

<context>
@/Users/laichan/code/tung/openmusic/CLAUDE.md
@/Users/laichan/code/tung/openmusic/src/lib/components/TrackMenu.svelte
@/Users/laichan/code/tung/openmusic/src/lib/stores/library.svelte.ts
@/Users/laichan/code/tung/openmusic/src/lib/stores/library.svelte.test.ts
@/Users/laichan/code/tung/openmusic/src/lib/components/SettingToggle.svelte
@/Users/laichan/code/tung/openmusic/src/lib/actions/longpress.ts
@/Users/laichan/code/tung/openmusic/src/lib/i18n/en.ts

<interfaces>
<!-- Already in the codebase — use directly, do not re-derive. -->

TrackMenu.svelte — state / deriveds / functions (script):
  let pickerOpen = $state(false);                                     // line 78 — THE sub-sheet flag to mirror
  const isDevice = $derived(!!track && isDeviceUid(track.uid));      // ~line 90
  let blobPresent = $state<boolean | null>(null);                     // ~line 511; null = not probed yet. Blob-backed truth (quick-260913-jq4)
  const dlMeta / dlProbing / dlLabel                                  // probed `FLAC · 38.2 MB` meta + skeleton flag + composed label
  async function startDownload()                                      // ~line 454
  async function openDownloadPicker()                                 // ~line 619; guards `if (!track?.uid || isDevice) return;`
  function noImport()                                                 // ~line 488: excludeUid(uid, `${names.dnArtist(a)} - ${names.dnTitle(t)}`.trim()) → library.removeDownload → toast.noImportDone → close()
  function close()                                                    // ~line 200: `pickerOpen = false; tagsOpen = false; coverAc?.abort(); dlPickAc?.abort(); lyricAc?.abort(); onclose();`
  Imports already present: Trash2, ChevronDown, X (lucide), library, toast, t, tapBounce, longpress, dragClose, focusTrap, overlays, excludeUid, names, fly.
  NOT yet imported: SettingToggle → `import SettingToggle from '$lib/components/SettingToggle.svelte';`

TrackMenu.svelte — the sub-sheet overlay registration pattern (~line 806):
  $effect(() => {
    if (pickerOpen && track) {
      untrack(() => overlays.open("trackmenu-picker", () => (pickerOpen = false)));
      return () => untrack(() => overlays.dismiss("trackmenu-picker"));
    }
  });

TrackMenu.svelte — the sub-sheet markup pattern (~line 1116, OUTSIDE the `{#if open && track}` block):
  {#if pickerOpen && track}
    <button class="scrim" aria-label={t('menu.close')} onclick={() => (pickerOpen = false)}></button>
    <div class="menu" transition:fly={{ y: 240, duration: 200 }} use:dragClose={{ onclose: () => (pickerOpen = false) }} use:focusTrap>
      <div class="menu-head">{t('menu.addToPlaylist')}</div>
      … <button class="mi" …> rows …
    </div>
  {/if}

Idle Download row markup today (~line 1083-1087, inside `{#if !isDevice} … {:else}`):
  <button class="mi" aria-label={`${dlLabel} · ${t('menu.downloadHoldHint')}`} title={t('menu.downloadHoldHint')} onclick={startDownload} onlongpress={openDownloadPicker} use:longpress use:tapBounce>
    <Download size={18} /> {t('menu.download')}
    {#if dlProbing}<span class="count skel" aria-hidden="true"></span>{:else if dlMeta}<span class="count">{dlMeta}</span>{/if}
    <ChevronDown size={14} class="hold-caret" aria-hidden="true" />
  </button>

noImport row today (~line 994-996):
  {#if isDevice}
    <button class="mi" onclick={noImport} use:tapBounce><EyeOff size={18} /> {t('menu.noImport')}</button>
  {/if}

Styles today (~line 1334-1363):
  .mi { width: 100%; display: flex; align-items: center; gap: 12px; background: none; border: none; color: var(--color-text); font-size: 15px; padding: 12px; border-radius: 10px; cursor: pointer; text-align: left; }
  .mi:hover { background: var(--color-surface); }   .mi.accent { color: var(--color-primary); }
  .mi .count { margin-left: auto; … }
  .menu-head { font-size: calc(13px * var(--fs-title, 1)); color: var(--color-text-muted); padding: 8px 10px; … }
  .mi :global(.hold-caret) { flex: none; color: var(--color-text-muted); margin-left: auto; }   // dead after Task 1 — delete
  .mi .count + :global(.hold-caret) { margin-left: 4px; }                                        // dead after Task 1 — delete

MetadataEditor.svelte footer (the body-copy + two-button shape to copy, lines 216-222 / 245-246):
  <p class="hint">{t('tags.hint')}</p>
  <div class="actions">
    <button class="mi" onclick={onclose} use:tapBounce>{t('tags.cancel')}</button>
    <button class="mi primary" …>{t('tags.save')}</button>
  </div>
  .hint { color: var(--color-text-muted); font-size: 12px; line-height: 1.4; padding: 10px 12px 4px; margin: 0; }
  .actions { display: flex; gap: 8px; padding: 4px; }

SettingToggle.svelte — props (`$props()`):
  { label: string; icon?: Component<{ size?: number }>; checked: boolean; onchange: () => void; hint?: string; disabled?: boolean }
  Renders <button role="switch" aria-checked> + label + decorative pill. Usage: <SettingToggle label={…} checked={flag} onchange={() => (flag = !flag)} />
  This is the app's ONLY boolean-control idiom (no `type="checkbox"` exists anywhere in src) — reuse it, do not hand-roll a checkbox.

library.svelte.ts — removeDownload (line 278), verbatim today:
  removeDownload(uid: string) {
    this.downloads = this.downloads.filter((t) => t.uid !== uid);
    if (this.unavailable.has(uid)) { const next = new Set(this.unavailable); next.delete(uid); this.unavailable = next; }
    this.save();
    void blobStore.del(uid);
  }
  Callers today: library/+page.svelte:240 (`library.removeDownload(track.uid)`, edit-mode swipe), TrackMenu noImport(). Both must stay byte-for-byte.

library.svelte.test.ts — harness: `vi.mock('$app/environment', …browser:true)`; `const { blobDel } = vi.hoisted(() => ({ blobDel: vi.fn(async () => {}) }))`; `vi.mock('$lib/services/blob-store', () => ({ blobStore: { del: blobDel } }))`; `mk(over)` Track factory (uid 'netease-1'); existing cases at :232 (device uid) and :301-304 (`blobDel` toHaveBeenCalledWith('kuwo:7')) show the assertion shape.

blob-store.ts — del(uid) (line 839): clearStoredName; NATIVE → nativeDel (refuses `device:` uid as its FIRST statement, 34 Pitfall 1; otherwise deletes app-private copy + the public Music/OpenMusic MediaStore row, 999.1-D-11 — `deleteFromMusic` never throws, a failed MediaStore delete is silent). WEB → deletes the IndexedDB blob (the app's offline copy). Never throws either way.

import-exclusions.ts: `export function excludeUid(uid: string, label: string): void`

longpress.ts: after a hold fires, a one-shot click suppressor is attached on `document` in the CAPTURE phase and eats the next click wherever it lands (quick-260913-p2k). Target-agnostic → splitting the row does not weaken it. Do not modify.

Existing i18n keys to REUSE (present in all 15 dicts):
  menu.downloadFrom     "Download from…"  → caret button aria-label
  menu.downloadHoldHint "Hold to choose source and format" → stays on the MAIN button
  tags.cancel           "Cancel"          → the sheet's Cancel button
  menu.close            → scrim aria-label (already used by every sub-sheet)
</interfaces>
</context>

<tasks>

<task type="auto">
  <name>Task 1: Split the idle Download row so the caret is a sibling button that opens the picker</name>
  <files>src/lib/components/TrackMenu.svelte</files>
  <action>
In the idle Download branch (`{:else}` after `{:else if blobPresent === true}`, ~line 1083), replace the single `<button class="mi">` with a flex wrapper holding TWO sibling buttons — a `<button>` cannot nest a `<button>`, so a tappable caret forces this split:

- `<div class="mi-split">` wrapper.
- MAIN button: keep `class="mi"`, `aria-label={`${dlLabel} · ${t('menu.downloadHoldHint')}`}`, `title={t('menu.downloadHoldHint')}`, `onclick={startDownload} onlongpress={openDownloadPicker} use:longpress use:tapBounce`, and its children `<Download size={18} /> {t('menu.download')}` + the existing `{#if dlProbing}…{:else if dlMeta}…{/if}` `.count` block, same order. Remove the `<ChevronDown>` from inside it.
- CARET button, next sibling: `<button type="button" class="mi-caret" aria-label={t('menu.downloadFrom')} title={t('menu.downloadFrom')} onclick={openDownloadPicker} use:tapBounce><ChevronDown size={14} /></button>`. No `aria-hidden` on it — it is a real control. Reusing `menu.downloadFrom` as its name is deliberate (names exactly the sheet it opens; no new key) — say so in the comment.

CSS (~line 1359-1363): DELETE the two dead `.hold-caret` rules + their comment. ADD in their place:
- `.mi-split { display: flex; align-items: center; }`
- `.mi-split .mi { flex: 1; min-width: 0; }` (`.mi`'s `width: 100%` must yield to flex; `.count`'s `margin-left: auto` still pushes the meta to the main button's right edge, so icon/label/meta rhythm is unchanged).
- `.mi-caret { flex: none; display: flex; align-items: center; background: none; border: none; color: var(--color-text-muted); padding: 12px 14px; border-radius: 10px; cursor: pointer; }` + `.mi-caret:hover { background: var(--color-surface); }` — same 12px vertical padding as `.mi` so row height is identical; 14px horizontal → ~42px hit target.

Comments (house style, tag `quick-260919-vrq`):
- AMEND the `quick-260916-0d9` HTML comment above the row: its last sentence ("The caret + the hold hint … make it discoverable") now says the caret is a SIBLING BUTTON opening the same picker on tap (a button cannot nest a button), and that longpress.ts's document-capture suppressor is target-agnostic, so a hold's trailing click is eaten whether it lands on the main button, the caret, or the sheet under the finger (verified in `clickCapture`, not assumed). Keep every existing sentence about quick-260913-p2k and dragClose.
- Comment on the new CSS: why `.mi-split .mi { flex: 1 }` overrides `width: 100%`, and that `.hold-caret` went because the glyph is no longer decoration.

Do NOT touch: `longpress.ts`, the busy (`dl-progress`) branch, the Downloaded (`Check`) branch, the header `.hd-btn`, `openDownloadPicker` internals, the picker sheet.
  </action>
  <verify>
    <automated>cd /Users/laichan/code/tung/openmusic && grep -c 'class="mi-caret"' src/lib/components/TrackMenu.svelte | grep -q '^1$' && ! grep -q 'hold-caret' src/lib/components/TrackMenu.svelte && grep -q 'onclick={openDownloadPicker}' src/lib/components/TrackMenu.svelte && pnpm check 2>&1 | tail -3</automated>
  </verify>
  <done>Idle Download row renders as `.mi-split` > [`.mi` main (Download icon, label, `.count` meta, onclick=startDownload, onlongpress=openDownloadPicker, use:longpress), `.mi-caret` (ChevronDown, aria-label=menu.downloadFrom, onclick=openDownloadPicker)]; no `hold-caret` string remains; `pnpm check` 0 errors.</done>
</task>

<task type="auto" tdd="true">
  <name>Task 2: library.removeDownload gains an additive { deleteFile } opt-out, with a two-direction test</name>
  <files>src/lib/stores/library.svelte.ts, src/lib/stores/library.svelte.test.ts</files>
  <behavior>
    - Test 1 (default preserved): `library.downloads = [mk({ uid: 'kuwo:9' })]; library.markUnavailable('kuwo:9'); library.removeDownload('kuwo:9');` → `isDownloaded` false, `isUnavailable` false, `blobDel` toHaveBeenCalledWith('kuwo:9').
    - Test 2 (opt-out): same setup with uid 'kuwo:10', `blobDel.mockClear()`, `library.removeDownload('kuwo:10', { deleteFile: false })` → `isDownloaded` false, `isUnavailable` false, persisted payload's `downloads` no longer contains 'kuwo:10', and `blobDel` NOT toHaveBeenCalled.
  </behavior>
  <action>
RED first: add a new `describe('quick-260919-vrq removeDownload { deleteFile } opt-out', …)` block at the end of `library.svelte.test.ts` with a `beforeEach` that resets `library.downloads = []`, `library.unavailable = new Set()`, `memStore.clear()`, `blobDel.mockClear()` (copy the reset shape used by the `quick-260915-vb9 per-list clears` describe at ~line 256-264). Write the two cases above. Run `pnpm test -- src/lib/stores/library.svelte.test.ts` — Test 2 must FAIL (TS error or `blobDel` called) before the store changes. Commit `test(quick-260919-vrq): add failing test for removeDownload deleteFile opt-out`.

GREEN: change the signature to `removeDownload(uid: string, opts: { deleteFile?: boolean } = {})` and the last statement to `if (opts.deleteFile ?? true) void blobStore.del(uid);`. Nothing else in the method moves — row filter, `unavailable` clear and `save()` run in BOTH directions (the row is gone either way, so its mark has nothing to annotate). Zero-arg calls are byte-for-byte today's behaviour, so `library/+page.svelte:240` and `noImport()` are untouched by definition — do not edit them.

Amend the method's existing 34-D-06 JSDoc (do not delete it) with a `quick-260919-vrq` paragraph: `deleteFile: false` is the TrackMenu "Remove download" sheet's untick path — the user chose to keep the files; the row goes, the bytes stay (native: app-private copy + Music/OpenMusic entry; web: the IndexedDB copy). The exclusion mark is NOT this method's business — the caller decides (see TrackMenu `confirmRemoveDownload`).

Run the file's tests → green. Commit `feat(quick-260919-vrq): removeDownload deleteFile opt-out`.
  </action>
  <verify>
    <automated>cd /Users/laichan/code/tung/openmusic && grep -q "deleteFile ?? true" src/lib/stores/library.svelte.ts && grep -q "deleteFile: false" src/lib/stores/library.svelte.test.ts && pnpm test -- src/lib/stores/library.svelte.test.ts 2>&1 | tail -5</automated>
  </verify>
  <done>`removeDownload(uid, opts = {})` exists with `opts.deleteFile ?? true` gating `blobStore.del`; both new cases pass alongside every pre-existing case in the file; no other call site changed.</done>
</task>

<task type="auto">
  <name>Task 3: Add the five Remove-download i18n keys to all 15 dictionaries</name>
  <files>src/lib/i18n/en.ts, src/lib/i18n/ar.ts, src/lib/i18n/de.ts, src/lib/i18n/es.ts, src/lib/i18n/fr.ts, src/lib/i18n/hi.ts, src/lib/i18n/id.ts, src/lib/i18n/it.ts, src/lib/i18n/pt.ts, src/lib/i18n/ru.ts, src/lib/i18n/th.ts, src/lib/i18n/tr.ts, src/lib/i18n/vi.ts, src/lib/i18n/zh-Hans.ts, src/lib/i18n/zh-Hant.ts</files>
  <action>
Add exactly FIVE keys to every dictionary. DOUBLE quotes for key AND value (manual convention in `src/lib/i18n/*.ts`; no formatter enforces it). Insert the four `menu.*` keys immediately after the existing `"menu.noImport"` line (line 313 in Latin-script dicts, 335 in zh-Hans/zh-Hant) and the `toast.*` key immediately after `"toast.noImportDone"` — every dict has both anchors.

English (en.ts — the reference locale that defines `TranslationKey`):
- `"menu.removeDownload": "Remove download"` — the row label AND the sheet's `.menu-head`.
- `"menu.removeDownloadBody": "The song stays in your library and streams again when you tap it. A file you saved through your browser's download folder can't be reached from here."`
- `"menu.removeDownloadDeleteFile": "Also delete the offline copy on this device"` — the toggle label. TRUE ON BOTH PLATFORMS: on Android `blobStore.del` removes the app-private copy and the Music/OpenMusic entry; on the web it removes the IndexedDB copy. It must NOT say "file on disk" / "from your phone" in a way that implies reaching a browser-folder file.
- `"menu.removeDownloadAction": "Remove"` — the destructive button.
- `"toast.downloadRemoved": "Download removed. The song stays in your library."` — used for BOTH toggle states (both drop the row; the toast promises only what both do). It must NOT say "won't come back" — the untick path can be re-imported by a later scan.

Copy must stay HONEST in every locale (the user's explicit decision): what survives (library row, re-stream on tap, browser-folder file) vs what the toggle destroys (this app's offline copy). Translate properly per locale in the register each dict already uses for `menu.noImport` / `toast.noImportDone` / `settings.retagDownloadsDesc` (zh-Hant 「匯入」/「檔案」/「裝置」, zh-Hans 「导入」/「文件」/「设备」; pt European register "Não voltar a importar"; ar/hi/th/vi/ru/tr/id/de/es/fr/it likewise). Do NOT paste English into non-English files. `menu.removeDownload` reads like a sibling of the locale's `menu.noImport` (short verb phrase, no trailing period); `menu.removeDownloadAction` is the locale's one-word "Remove".

No key for the caret label (Task 1 reuses `menu.downloadFrom`) and none for Cancel (the sheet reuses `tags.cancel`).
  </action>
  <verify>
    <automated>cd /Users/laichan/code/tung/openmusic && for k in menu.removeDownload menu.removeDownloadBody menu.removeDownloadDeleteFile menu.removeDownloadAction toast.downloadRemoved; do n=$(grep -l "\"$k\"" src/lib/i18n/*.ts | grep -v -e test -e index -e detect | wc -l | tr -d ' '); [ "$n" = "15" ] || { echo "$k in $n/15 dicts"; exit 1; }; done && pnpm test -- src/lib/i18n/i18n.test.ts 2>&1 | tail -5</automated>
  </verify>
  <done>Each of the 5 keys appears in exactly 15 dictionary files, double-quoted; `i18n.test.ts` key-set parity passes; no non-English dict carries the English string for these keys.</done>
</task>

<task type="auto">
  <name>Task 4: "Remove download" row + in-menu confirm sheet with the delete-file toggle, disjoint from "Don't import again"</name>
  <files>src/lib/components/TrackMenu.svelte</files>
  <action>
IMPORT: `import SettingToggle from '$lib/components/SettingToggle.svelte';` beside the other component imports (VersionPicker / DownloadRing / MetadataEditor).

STATE (beside `pickerOpen`, line 78): `let rmOpen = $state(false);` and `let rmDeleteFile = $state(true);`. Comment (`quick-260919-vrq`): why a SHEET and not `window.confirm` — the confirm carries a toggle whose state changes what the removal does, and `confirm()` cannot hold one; so it mirrors the playlist-picker sub-sheet exactly (same scrim/.menu/fly/dragClose/focusTrap, own overlay id, reset in `close()`). Default ON = today's `removeDownload` behaviour (999.1-D-11 both copies) so the row still means what its label says; reset to `true` on every open so a prior untick never silently carries over to another song.

close() (~line 200): add `rmOpen = false;` beside `pickerOpen = false; tagsOpen = false;`.

OVERLAY (beside the `trackmenu-picker` effect, ~line 806), same shape + `untrack` guard, distinct id:
  $effect(() => { if (rmOpen && track) { untrack(() => overlays.open("trackmenu-rmdl", () => (rmOpen = false))); return () => untrack(() => overlays.dismiss("trackmenu-rmdl")); } });

HANDLERS (below `noImport()`, ~line 496):
- `function openRemoveDownload() { if (!track?.uid) return; rmDeleteFile = true; rmOpen = true; }`
- `function confirmRemoveDownload()`:
  `if (!track?.uid) return;`
  `if (rmDeleteFile) excludeUid(track.uid, `${names.dnArtist(track.artist)} - ${names.dnTitle(track.title)}`.trim());` — same label expression as `noImport`.
  `library.removeDownload(track.uid, { deleteFile: rmDeleteFile });`
  `toast.show(t('toast.downloadRemoved')); rmOpen = false; close();`
  Comment block (`quick-260919-vrq`) recording, honestly:
  (a) TOGGLE ON = delete + exclude, per the user's words ("checkbox on remove file on disk and auto added to exclude list"). The mark is belt-and-braces here, not dead state: `deleteFromMusic` never throws, so a MediaStore delete that silently fails leaves a Music/OpenMusic copy a later scan could find; the mark records the user's intent against that.
  (b) TOGGLE OFF = row only. `blobStore.del` is never reached; the app-private copy, the Music/OpenMusic entry (native) or the IndexedDB copy (web) all survive. NO exclusion mark: the user chose to keep the file, and a mark keyed on the APP uid would not block a rescan anyway — a rescan imports that surviving file under a NEW `device:` uid. Do not overclaim; the toast and body copy promise nothing about it not coming back.
  (c) Why the sheet is for APP downloads only: `blobStore.del` REFUSES a `device:` uid as its first statement (34 Pitfall 1), so "delete the offline copy" is something the app literally cannot do for an import — offering the toggle there would be a UI lie. `device:` keeps `noImport`.
  (d) Web: the toggle is SHOWN, not hidden/disabled — `blobStore.del` in a browser build deletes the IndexedDB offline copy, which is real, reachable bytes; only a browser-download-folder file is unreachable, and `menu.removeDownloadBody` says so (same truth as `settings.retagDownloadsDesc`).

ROW MARKUP — turn the `{#if isDevice}` noImport block (~line 994) into if / else-if so the two rows are DISJOINT by structure:
  {#if isDevice}
    <button class="mi" onclick={noImport} use:tapBounce><EyeOff size={18} /> {t('menu.noImport')}</button>
  {:else if blobPresent === true || library.isDownloaded(track.uid)}
    <button class="mi" onclick={openRemoveDownload} use:tapBounce><Trash2 size={18} /> {t('menu.removeDownload')}</button>
  {/if}
GATE comment (`quick-260919-vrq`): "something to remove" is EITHER thing `removeDownload` clears — an offline copy (`blobPresent === true`, blob-backed truth per quick-260913-jq4) OR a downloads-list row (`library.isDownloaded`, which can be true with NO blob: `addDownload` runs before the fetch and the web `<a download>` save reports success on a cancelled dialog). `blobPresent` alone would leave that stale row unremovable here; `isDownloaded` alone would hide the row for a blob whose list entry was lost. `=== true` (not truthy) so the row cannot flash in during the null pre-probe tick. `!isDevice` is implied by the `{:else if}`.

AMEND the existing `quick-260919-30x` comment on that block (do not delete it): (1) "Nothing currently exposes removal for an APP download" → the `{:else if}` below is that removal, via a confirm sheet; (2) its argument that an exclusion on an app-download uid is "dead state forever … since no scan ever imports an app download under its own uid" held while removal ALWAYS deleted both copies — it stops holding once the user can keep the file: a surviving Music/OpenMusic copy is exactly what a later scan can re-import (under a new `device:` uid, so a uid-keyed mark is not a guaranteed block either — see confirmRemoveDownload). The two rows stay mutually exclusive.

SHEET MARKUP — place directly after the `{#if pickerOpen && track} … {/if}` block (~line 1124), OUTSIDE `{#if open && track}` like every sub-sheet:
  {#if rmOpen && track}
    <button class="scrim" aria-label={t('menu.close')} onclick={() => (rmOpen = false)}></button>
    <div class="menu" transition:fly={{ y: 240, duration: 200 }} use:dragClose={{ onclose: () => (rmOpen = false) }} use:focusTrap>
      <div class="menu-head">{t('menu.removeDownload')}</div>
      <p class="hint">{t('menu.removeDownloadBody')}</p>
      <SettingToggle label={t('menu.removeDownloadDeleteFile')} checked={rmDeleteFile} onchange={() => (rmDeleteFile = !rmDeleteFile)} />
      <div class="actions">
        <button class="mi" onclick={() => (rmOpen = false)} use:tapBounce>{t('tags.cancel')}</button>
        <button class="mi danger" onclick={confirmRemoveDownload} use:tapBounce><Trash2 size={18} /> {t('menu.removeDownloadAction')}</button>
      </div>
    </div>
  {/if}
Cancel / scrim / drag-down / Back all converge on `rmOpen = false` through the overlay's close handler — nothing is removed on any dismiss route. Comment the block (`quick-260919-vrq`) with why SettingToggle (the app's ONLY boolean-control idiom — `role="switch"` + aria-checked — so no hand-rolled checkbox) and why it is mounted outside `{#if open && track}` (same reason as the playlist picker: survives the parent menu closing).

CSS: add `.hint { color: var(--color-text-muted); font-size: 12px; line-height: 1.4; padding: 10px 12px 4px; margin: 0; }` and `.actions { display: flex; gap: 8px; padding: 4px; }` (verbatim from MetadataEditor.svelte:245-246 — same look, two files; note the source in a comment) plus `.mi.danger { color: var(--color-danger, #e5484d); }` — check `src/app.css` for an existing red/danger token first and use it if one exists; the fallback literal is only for when none does. If `.hint` or `.actions` already exist in TrackMenu's style block, reuse them rather than redeclaring.

VERIFY end-to-end: `pnpm check` (0 errors) and `pnpm test` (all green).
  </action>
  <verify>
    <automated>cd /Users/laichan/code/tung/openmusic && grep -q 'trackmenu-rmdl' src/lib/components/TrackMenu.svelte && grep -q 'removeDownload(track.uid, { deleteFile: rmDeleteFile })' src/lib/components/TrackMenu.svelte && grep -q '{:else if blobPresent === true || library.isDownloaded(track.uid)}' src/lib/components/TrackMenu.svelte && grep -q '<SettingToggle' src/lib/components/TrackMenu.svelte && ! grep -q "confirm(t('menu.removeDownload" src/lib/components/TrackMenu.svelte && grep -c 'rmOpen = false' src/lib/components/TrackMenu.svelte | awk '$1>=4' | grep -q . && pnpm check 2>&1 | tail -3 && pnpm test 2>&1 | tail -6</automated>
  </verify>
  <done>Row renders under `{:else if blobPresent === true || library.isDownloaded(track.uid)}` opposite `{#if isDevice}` noImport and opens the `rmOpen` sheet (registered as `trackmenu-rmdl`, reset in `close()`); the sheet shows body copy, one SettingToggle (default on), Cancel, Remove; confirm threads the toggle into `library.removeDownload(uid, { deleteFile })` and calls `excludeUid` only when on; no `window.confirm` for this feature; `pnpm check` 0 errors; `pnpm test` fully green.</done>
</task>

</tasks>

<threat_model>
## Trust Boundaries

| Boundary | Description |
|----------|-------------|
| user tap → filesystem delete | A sheet button triggers `blobStore.del`, which on Android destroys real files (999.1-D-11) and on web the IndexedDB copy |

## STRIDE Threat Register

| Threat ID | Category | Component | Disposition | Mitigation Plan |
|-----------|----------|-----------|-------------|-----------------|
| T-vrq-01 | Tampering (accidental destruction) | `confirmRemoveDownload()` | mitigate | Destructive action only from the explicit Remove button inside a dedicated sheet; scrim/drag/Back/Cancel all dismiss without removing; body copy states what dies and what survives |
| T-vrq-02 | Tampering (user-owned file) | `removeDownload` reaching a `device:` uid | mitigate | Sheet unreachable for `device:` uids by the `{#if isDevice}/{:else if}` structure; `blobStore.del`'s native branch refuses `device:` as its first statement (34 Pitfall 1) — defence in depth, unchanged |
| T-vrq-03 | Tampering (regression in existing callers) | `removeDownload` signature change | mitigate | Additive `opts = {}` with `deleteFile ?? true`; zero-arg calls are byte-for-byte today's behaviour; Test 1 pins the default |
| T-vrq-04 | Repudiation (silent skip of the delete) | `deleteFile: false` path | mitigate | Test 2 asserts `blobStore.del` is NOT called AND the row is gone, so neither half can drift silently |
| T-vrq-05 | Elevation (unintended action from a hold) | split Download row + longpress | mitigate | longpress.ts document-capture suppressor is target-agnostic; untouched, verification recorded in the row comment |
| T-vrq-06 | Information (stale toggle state) | `rmDeleteFile` | mitigate | Reset to `true` in `openRemoveDownload()` on every open |
| T-vrq-SC | Tampering | npm installs | accept | No new dependencies |
</threat_model>

<verification>
- `pnpm check` → 0 errors.
- `pnpm test` → green: `i18n.test.ts` parity across 15 locales; `library.svelte.test.ts` incl. the two new opt-out cases and the pre-existing :232 / :301-304 cases.
- `grep -c 'hold-caret' src/lib/components/TrackMenu.svelte` → 0; `grep -c "confirm(t('menu.removeDownload" …` → 0.
- Manual (dev server 4321 or 5173): non-device, not-yet-downloaded song → ⋮ menu → tap caret → "Download from…" opens, no preparing toast; tap label → download starts; hold label ~500ms → picker opens, NO download. Downloaded song → "Remove download" present, "Don't import again" absent → tap → sheet with body, toggle ON, Cancel, Remove; Back gesture / scrim / drag-down close it and the song stays downloaded. Toggle OFF + Remove → toast, menu closes, Library → Downloads no longer lists it, blob still present (re-open menu: Edit-metadata row still shows because `blobPresent` is true). Toggle ON + Remove → row gone AND blob gone (Download row returns on re-open).
</verification>

<success_criteria>
- Caret is a labelled sibling button whose tap opens the picker; one-tap and long-press behaviour unchanged.
- "Remove download" appears only for non-device entries with something to remove, opens an in-menu sheet (no `window.confirm`) with honest copy and one delete-file toggle, and is structurally disjoint from "Don't import again".
- Toggle ON → files deleted + `excludeUid`; toggle OFF → row only, no mark, no del; both toast and close.
- `library.removeDownload` opt-out is additive with default `true`; both directions unit-tested; existing callers untouched.
- 5 new keys in all 15 dictionaries, double-quoted, properly translated, none promising "won't come back".
- `quick-260919-vrq` comments at each changed site; 0d9 and 30x amended, not removed; 34-D-06 JSDoc amended.
- No changes outside `TrackMenu.svelte`, `library.svelte.ts` (+test), and `src/lib/i18n/*.ts`.
</success_criteria>

<output>
Create `.planning/quick/260919-vrq-trackmenu-remove-download-row-and-a-tapp/260919-vrq-SUMMARY.md` when done.
</output>
