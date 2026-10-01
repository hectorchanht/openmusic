---
phase: quick-261001-grb
plan: 01
type: execute
wave: 1
depends_on: []
files_modified:
  - src/lib/services/download-label.ts
  - src/lib/services/download-label.test.ts
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
  - src/lib/i18n/i18n.test.ts
  - src/routes/(app)/album/[name]/+page.svelte
  - src/lib/components/TrackMenu.svelte
  - src/lib/components/DownloadControl.svelte
  - src/lib/components/ToastHost.svelte
autonomous: true
requirements: [QUICK-261001-GRB]

must_haves:
  truths:
    - "Album download toasts read 'Downloading · {artist} - {album} {n}/{total}' while running and 'Saved · {artist} - {album} {saved}/{total}' at the end (display-language names, same as the album header)"
    - "Single-song download toasts (TrackMenu startDownload, TrackMenu pickDownload, DownloadControl run) read 'Downloading · {artist} - {song}' / 'Downloaded · {artist} - {song}' / failure variants with the same label"
    - "A missing artist yields just the title/album (no dangling ' - ')"
    - "Every locale carries the new/changed keys with the {label} placeholder; i18n parity test passes"
    - "The toast pill truncates a long CJK label with an ellipsis on a 375px viewport (no overflow, single line)"
    - "Stores/services remain i18n-free — download-album.ts and download-track.ts are untouched"
  artifacts:
    - path: "src/lib/services/download-label.ts"
      provides: "pure downloadLabel(artist, title) => 'artist - title' | title"
      exports: ["downloadLabel"]
    - path: "src/lib/i18n/en.ts"
      provides: "toast.downloading, toast.albumProgress, toast.albumSaved, toast.downloaded, toast.downloadFailedKeptInLibrary, toast.noAudioFor with {label}"
      contains: "toast.downloading"
    - path: "src/lib/components/ToastHost.svelte"
      provides: "ellipsis truncation on .msg"
      contains: "text-overflow: ellipsis"
  key_links:
    - from: "src/routes/(app)/album/[name]/+page.svelte"
      to: "src/lib/services/download-label.ts"
      via: "downloadLabel(names.dnArtist(albumArtist), names.dnTitle(name)) passed as {label} to t()"
      pattern: "toast\\.albumProgress'.*label"
    - from: "src/lib/components/TrackMenu.svelte"
      to: "src/lib/services/download-label.ts"
      via: "downloadLabel(names.dnArtist(track.artist), names.dnTitle(track.title, track.artist))"
      pattern: "downloadLabel\\("
    - from: "src/lib/components/DownloadControl.svelte"
      to: "src/lib/stores/names.svelte.ts"
      via: "new import of names for display-language label"
      pattern: "import \\{ names \\}"
---

<objective>
Make every download toast name what is being downloaded: albums as `{artist} - {album} {n}/{total}`, single songs as `{artist} - {song}`, using the display-language names the UI already shows.

Purpose: "Downloading 3 of 10…" / "Downloaded · added to Library" give no clue WHICH album/song is in flight — with background album jobs (quick 40-D-06) now outliving the page, the user needs the name in the toast.
Output: one pure label helper + test, 6 i18n keys across 15 locales with a `{label}` placeholder, 3 UI call sites wired, toast host ellipsis.
</objective>

<execution_context>
@/Users/laichan/.claude/plugins/cache/gsd-plugin/gsd/4.5.3/workflows/execute-plan.md
@/Users/laichan/.claude/plugins/cache/gsd-plugin/gsd/4.5.3/templates/summary.md
</execution_context>

<context>
@./CLAUDE.md
@src/lib/i18n/en.ts
@src/lib/i18n/i18n.test.ts
@src/routes/(app)/album/[name]/+page.svelte
@src/lib/components/TrackMenu.svelte
@src/lib/components/DownloadControl.svelte
@src/lib/components/ToastHost.svelte

<interfaces>
<!-- Extracted from codebase. Use directly — no exploration. -->

From src/lib/i18n/index.ts:
```ts
export function interpolate(str: string, params?: Record<string, string | number>): string; // replaces {token}; UNKNOWN tokens are left intact (a missed param shows literally as "{label}")
export function t(key: TranslationKey, params?: Record<string, string | number>): string;
```

From src/lib/stores/names.svelte.ts (the display seam — song title passes its OWN artist, artist/album names pass none):
```ts
names.dnArtist(text: string): string   // '' in → '' out
names.dnTitle(text: string, artist?: string): string
```

From src/lib/sources/types.ts `Track`: `title: string; artist: string; album: string;`

From src/lib/stores/toast.svelte.ts: `toast.show(msg: string, opts?: { action?, duration? })` — a second call REPLACES the message.

From src/lib/services/download-album.ts (DO NOT MODIFY — i18n-free by design):
```ts
export async function downloadAlbum(tracks, meta: { artist, album }, onProgress?: (n: number, total: number) => void): Promise<{ saved: number; total: number }>
```

Current en.ts keys (L475-490):
```
"toast.preparingDownload": "Preparing download…",      // KEEP unchanged — also used as the generic "working" toast by likeAlbum, addAlbumToPlaylist and DownloadControl busyLabel
"toast.albumProgress": "Downloading {n} of {total}…",   // CHANGE
"toast.albumSaved": "Saved {saved} of {total}",          // CHANGE
"toast.noAudio": "No audio available",                   // KEEP unchanged — generic (gated() in TrackMenu L265/268, DownloadControl no-target L145)
"toast.downloaded": "Downloaded · added to Library",     // CHANGE (only used by the 3 single-song download sites)
"toast.downloadFailedKeptInLibrary": "Couldn't save · kept in Library",  // CHANGE (same 3 sites)
```

Call sites to wire:
- album/[name]/+page.svelte `downloadAlbum()` L490-508: `globalToast.show(t('toast.preparingDownload'))` at start; `onProgress` → `t('toast.albumProgress', { n, total })`; final `t('toast.albumSaved', { saved, total })`. The meta object `{ artist: names.dnArtist(albumArtist), album: names.dnTitle(name) }` is already computed on L503 — hoist into consts and build the label from them.
- TrackMenu.svelte `startDownload()` L556-571 and `pickDownload(v)` L805-818: `toast.show(t('toast.preparingDownload'))` then the `res === 'saved' ? downloaded : res === 'no-audio' ? noAudio : downloadFailedKeptInLibrary` ternary. `track` is the identity Track; `names` is already imported (L9).
- DownloadControl.svelte `run()` L134-160: same shape; the Track in hand is `target` (resolved ?? track ?? await resolve()). `names` is NOT imported yet. The `!target` branch (L145) keeps the generic `toast.noAudio` — there is nothing to label. `busyLabel` (L102) keeps `toast.preparingDownload`.
</interfaces>
</context>

<tasks>

<task type="auto" tdd="true">
  <name>Task 1: Label helper + i18n keys in all 15 locales + parity assertions</name>
  <files>src/lib/services/download-label.ts, src/lib/services/download-label.test.ts, src/lib/i18n/en.ts, src/lib/i18n/ar.ts, src/lib/i18n/de.ts, src/lib/i18n/es.ts, src/lib/i18n/fr.ts, src/lib/i18n/hi.ts, src/lib/i18n/id.ts, src/lib/i18n/it.ts, src/lib/i18n/pt.ts, src/lib/i18n/ru.ts, src/lib/i18n/th.ts, src/lib/i18n/tr.ts, src/lib/i18n/vi.ts, src/lib/i18n/zh-Hans.ts, src/lib/i18n/zh-Hant.ts, src/lib/i18n/i18n.test.ts</files>
  <behavior>
    - downloadLabel('陳奕迅', '明年今日') === '陳奕迅 - 明年今日'
    - downloadLabel('', '明年今日') === '明年今日' (no dangling separator); whitespace-only artist treated as empty
    - i18n.test.ts: for EVERY locale, each of toast.downloading / toast.albumProgress / toast.albumSaved / toast.downloaded / toast.downloadFailedKeptInLibrary / toast.noAudioFor contains the literal "{label}"; albumProgress additionally contains "{n}" and "{total}"; albumSaved contains "{saved}" and "{total}". Existing parity test stays green.
  </behavior>
  <action>
    1. Create `src/lib/services/download-label.ts` (pure, no imports, tabs, single quotes) exporting `downloadLabel(artist: string, title: string): string` — returns `${artist} - ${title}` when `artist.trim()` is non-empty, else `title`. Header comment: quick-261001-grb, "the one place the `artist - title` toast grammar lives; callers pass DISPLAY-language names from names.dnArtist/dnTitle (stores/services stay i18n-free per CLAUDE.md)". Co-located `download-label.test.ts` with the two cases above (vitest, node).
    2. In `src/lib/i18n/en.ts` (DOUBLE QUOTES for keys and values — manual convention, no formatter), next to the existing toast download keys:
       - ADD `"toast.downloading": "Downloading · {label}"` (shared by single-song start and album start)
       - ADD `"toast.noAudioFor": "No audio available · {label}"`
       - CHANGE `"toast.albumProgress": "Downloading · {label} {n}/{total}"`
       - CHANGE `"toast.albumSaved": "Saved · {label} {saved}/{total}"`
       - CHANGE `"toast.downloaded": "Downloaded · {label}"`
       - CHANGE `"toast.downloadFailedKeptInLibrary": "Couldn't save · {label} — kept in Library"`
       Leave `toast.preparingDownload` and `toast.noAudio` untouched (still used generically — see interfaces).
    3. Apply the same 2 additions + 4 changes to the other 14 locale dictionaries (ar, de, es, fr, hi, id, it, pt, ru, th, tr, vi, zh-Hans, zh-Hant), translating only the verb/noun words and keeping the ` · {label} {n}/{total}` shape identical so the label reads the same everywhere. e.g. zh-Hant: "正在下載 · {label}", "正在下載 · {label} {n}/{total}", "已儲存 · {label} {saved}/{total}", "已下載 · {label}", "無法儲存 · {label} — 已保留在音樂庫", "沒有可用的音訊 · {label}". Keep each locale's existing placement/order of keys; double quotes.
    4. In `src/lib/i18n/i18n.test.ts` add one `it(...)` block iterating `Object.keys(dicts)` asserting the placeholder presence listed in behavior (use `toContain('{label}')`). This closes the hole the parity test leaves: a locale that drops `{label}` would otherwise show a nameless toast.
    Run `pnpm test -- src/lib/i18n src/lib/services/download-label` — must pass before Task 2.
  </action>
  <verify>
    <automated>cd /Users/laichan/code/tung/openmusic && pnpm vitest --run src/lib/i18n/i18n.test.ts src/lib/services/download-label.test.ts && grep -L '"toast.downloading"' src/lib/i18n/{ar,de,en,es,fr,hi,id,it,pt,ru,th,tr,vi,zh-Hans,zh-Hant}.ts | grep -c . | grep -qx 0</automated>
  </verify>
  <done>downloadLabel exported + 2 tests green; all 15 locales expose toast.downloading and toast.noAudioFor and the 4 changed keys with {label}; i18n parity + new placeholder test pass; `grep -c "'" src/lib/i18n/en.ts`-style check shows no single-quoted i18n lines were introduced.</done>
</task>

<task type="auto">
  <name>Task 2: Wire the three download surfaces + toast ellipsis, verify on dev server</name>
  <files>src/routes/(app)/album/[name]/+page.svelte, src/lib/components/TrackMenu.svelte, src/lib/components/DownloadControl.svelte, src/lib/components/ToastHost.svelte</files>
  <action>
    1. Album page `downloadAlbum()`: hoist `const artist = names.dnArtist(albumArtist); const album = names.dnTitle(name); const label = downloadLabel(artist, album);` before the start toast. Replace start toast with `t('toast.downloading', { label })`; onProgress with `t('toast.albumProgress', { label, n, total })`; final with `t('toast.albumSaved', { label, saved, total })`; pass `{ artist, album }` to `downloadAlbumTracks` (same values as today). Import `downloadLabel` from `$lib/services/download-label`. Do NOT touch likeAlbum / addAlbumToPlaylist (they keep the generic preparingDownload toast). Add a `// quick-261001-grb` comment on the hoisted label line.
    2. TrackMenu `startDownload()` and `pickDownload()`: compute `const label = downloadLabel(names.dnArtist(track.artist), names.dnTitle(track.title, track.artist));` right after the `library.downloading.has` guard (the ORIGINAL `track` is the identity per quick-260916-0d9 — label by it, not by `picked`/`p.track`). Start toast → `t('toast.downloading', { label })`; result ternary → `t('toast.downloaded', { label })` / `t('toast.noAudioFor', { label })` / `t('toast.downloadFailedKeptInLibrary', { label })`. Leave gated()'s two `toast.noAudio` calls (L265/268) unchanged. Import `downloadLabel`.
    3. DownloadControl `run()`: add `import { names } from '$lib/stores/names.svelte'` and the `downloadLabel` import. Build the label from `target` AFTER it is resolved (after the `!target` early return, which keeps generic `toast.noAudio`). The start toast fires before resolution: when `track` is non-null use its label in `t('toast.downloading', { label })`; when only a `resolve` closure exists (album stub rows) keep `t('toast.preparingDownload')` for the start toast and switch to the labelled result toasts once `target` is known. Result ternary → downloaded / noAudioFor / downloadFailedKeptInLibrary with `{ label }`. `busyLabel` (L102) unchanged.
    4. ToastHost.svelte: on `.toast .msg` add `white-space: nowrap; overflow: hidden; text-overflow: ellipsis;` (min-width:0 is already there so the flex child can shrink; `max-width: min(92vw, 520px)` on the pill bounds it on a 375px phone). Comment: quick-261001-grb — labels now carry CJK artist/album names, one line + ellipsis instead of a wrapping pill.
    5. Grep gate: `grep -rn "toast\.\(downloaded\|albumProgress\|albumSaved\|downloadFailedKeptInLibrary\|noAudioFor\|downloading\)'" src --include='*.svelte' --include='*.ts'` — every hit outside `src/lib/i18n/` must pass a `label` param (no literal "{label}" can leak since interpolate leaves unknown tokens intact).
    6. `pnpm check` (svelte-check) and `pnpm test` (whole suite) green.
    7. Dev-server verify (probe `curl -s -o /dev/null -w '%{http_code}' http://localhost:4321` then 5173; start `pnpm dev` if neither answers): using the browser tool at 375px width, (a) open an album page (e.g. search 陳奕迅, open an album), tap the album Download action, observe the toast sequence "Downloading · {artist} - {album}", "Downloading · … 1/N" … "Saved · … N/N"; (b) long-press a search result → Download, observe "Downloading · {artist} - {song}" then "Downloaded · {artist} - {song}" (or the failure variant naming the song). Confirm a long CJK label ends in an ellipsis within the pill and the pill does not exceed the viewport. Deezer/CN upstreams are reachable in this sandbox (memory). Record what was observed in the SUMMARY. Do NOT push.
  </action>
  <verify>
    <automated>cd /Users/laichan/code/tung/openmusic && pnpm check && pnpm vitest --run && grep -c "text-overflow: ellipsis" src/lib/components/ToastHost.svelte | grep -qx 1 && grep -c "downloadLabel(" "src/routes/(app)/album/[name]/+page.svelte" src/lib/components/TrackMenu.svelte src/lib/components/DownloadControl.svelte | awk -F: '$2==0{f=1} END{exit f}'</automated>
  </verify>
  <done>Album and single-song download toasts show display-language `artist - name` (+ n/total for albums) on the dev server; svelte-check and the full vitest suite pass; toast pill single-line with ellipsis at 375px; download-album.ts / download-track.ts untouched; nothing pushed.</done>
</task>

</tasks>

<threat_model>
## Trust Boundaries

| Boundary | Description |
|----------|-------------|
| upstream metadata → toast text | artist/title strings from CN/Deezer sources are rendered in the toast |

## STRIDE Threat Register

| Threat ID | Category | Component | Disposition | Mitigation Plan |
|-----------|----------|-----------|-------------|-----------------|
| T-grb-01 | Tampering (XSS) | ToastHost.svelte `.msg` | mitigate | already text-content interpolation `{toast.msg}` (T-23-01) — never `{@html}`; this plan adds no markup path |
| T-grb-02 | DoS (layout) | ToastHost pill with very long CJK label | mitigate | nowrap + overflow hidden + ellipsis; pill max-width min(92vw,520px) |
| T-grb-SC | Tampering | npm installs | accept | no new dependencies in this plan |
</threat_model>

<verification>
- `pnpm vitest --run` green (i18n parity + new placeholder test + download-label test)
- `pnpm check` green
- Dev-server observation of both toast flows recorded in SUMMARY
</verification>

<success_criteria>
- Album toasts: `Downloading · {artist} - {album}` → `Downloading · {artist} - {album} {n}/{total}` → `Saved · {artist} - {album} {saved}/{total}`
- Single-song toasts: `Downloading · {artist} - {song}` → `Downloaded · {artist} - {song}` / `Couldn't save · {artist} - {song} — kept in Library` / `No audio available · {artist} - {song}`
- Missing artist → title only; names are display-language (dnArtist/dnTitle)
- All 15 locales updated, double quotes, parity test green; services untouched; toast truncates with ellipsis
</success_criteria>

<output>
Create `.planning/quick/261001-grb-download-toast-shows-artist-album-n-of-n/261001-grb-SUMMARY.md` when done
</output>
