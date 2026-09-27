---
phase: quick-260926-vdp
plan: 01
type: execute
wave: 1
depends_on: []
files_modified:
  - src/lib/components/TrackMenu.svelte
  - src/lib/components/NowPlaying.svelte
  - src/routes/(app)/artist/[name]/+page.svelte
  - src/routes/(app)/library/+page.svelte
  - src/lib/i18n/i18n.test.ts
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
requirements: [QUICK-260926-VDP]
must_haves:
  truths:
    - "The track menu row and the picker header read 'Change lyrics' (localised); no surface says 'Fix lyrics' and the key menu.fixLyrics no longer exists in any locale"
    - "The lyrics picker shows one CARD per source: source label, a 'Current lyrics' check when that candidate is the pinned/current one, the candidate's FULL lyrics as plain text lines (no timestamps, no empty lines) in a box capped at roughly 9 lines that scrolls by itself, and a 'Use these lyrics' button; scrolling inside the box neither drags the sheet nor picks; only the button picks"
    - "Spinner while loading, 'No lyrics found' + Try again on a dry walk, and 'Use automatic lyrics' when a pin exists all behave exactly as before"
    - "Now Playing's narrow tab bar and the wide headings row show lucide icons instead of the four text labels; every tab button carries its translated label as aria-label + title; the active tab is still underlined/coloured; the comment count is a small pill on the top-right of the Comments icon (hidden at 0 / loading, '99+' cap); tab switching by tap and by grip drag works as before"
    - "The artist page action bar is three round icon-only buttons Heart · Play · Share in the album page's visual language (34px circles, Play a 56px primary circle with shadow); labels live in aria-label + title, Favourite carries aria-pressed; the 'Show more' pill further down is unchanged"
    - "The library action bar Play all / Shuffle / Edit / Options are 34px round icon buttons, each with aria-label + title (Edit flips to 'Done' while editing and keeps aria-pressed)"
  artifacts:
    - path: "src/lib/i18n/en.ts"
      provides: "menu.changeLyrics / menu.useTheseLyrics / menu.currentLyrics (menu.fixLyrics deleted) — mirrored in all 14 other locales"
      contains: "menu.changeLyrics"
    - path: "src/lib/components/TrackMenu.svelte"
      provides: "Change lyrics row + full-lyrics candidate cards"
      contains: "menu.useTheseLyrics"
    - path: "src/lib/components/NowPlaying.svelte"
      provides: "icon tab bar + icon headings with aria-labels and overlaid count pill"
      contains: "MessageCircle"
    - path: "src/routes/(app)/artist/[name]/+page.svelte"
      provides: "round icon-only Heart · Play · Share action row"
      contains: "act play"
    - path: "src/routes/(app)/library/+page.svelte"
      provides: "round icon action bar with labels"
      contains: "library.playAll"
  key_links:
    - from: "src/lib/components/TrackMenu.svelte"
      to: "src/lib/stores/lyric-script.svelte.ts"
      via: "parseLyrics(c.lrc) → text lines for the card body"
      pattern: "parseLyrics\\(c\\.lrc\\)"
    - from: "src/lib/components/TrackMenu.svelte"
      to: "pickLyrics"
      via: "the card's explicit 'Use these lyrics' button"
      pattern: "onclick=\\{\\(\\) => pickLyrics\\(c\\.lrc\\)\\}"
    - from: "src/lib/components/NowPlaying.svelte"
      to: "selectTab / gripDown"
      via: "buttons keep data-tab so `.closest('.subnav button[data-tab]')` still resolves through the SVG child"
      pattern: "data-tab=\"queue\""
---

<objective>
Rename "Fix lyrics" to "Change lyrics", turn the lyrics picker rows into cards that show each candidate's full lyrics with an explicit "Use these lyrics" button, and move four surfaces to icon-only round/tab buttons with accessible labels: the Now Playing tab bar + wide headings, the artist page action bar, and the library action bar.

Purpose: the user cannot choose between lyric candidates from a one-line preview, and the text-labelled tabs/pills waste horizontal space on phones where the icons already say it.
Output: updated TrackMenu, NowPlaying, artist page, library page, 15 locale dictionaries + the i18n deleted-key guard.
</objective>

<execution_context>
@/Users/laichan/.claude/plugins/cache/gsd-plugin/gsd/4.5.3/workflows/execute-plan.md
@/Users/laichan/.claude/plugins/cache/gsd-plugin/gsd/4.5.3/templates/summary.md
</execution_context>

<context>
@./CLAUDE.md
@src/lib/components/TrackMenu.svelte
@src/lib/components/NowPlaying.svelte
@src/routes/(app)/artist/[name]/+page.svelte
@src/routes/(app)/album/[name]/+page.svelte
@src/routes/(app)/library/+page.svelte
@src/lib/actions/dragClose.ts
@src/lib/i18n/en.ts
@src/lib/i18n/i18n.test.ts

<interfaces>
<!-- Verified against the checkout. Use directly — no exploration needed. -->

Baseline: `pnpm check` = 0 errors, 0 WARNINGS (unused CSS selectors and a11y issues are warnings — keep it at 0).

From `@lucide/svelte` 1.17.0 (all verified present in `node_modules/@lucide/svelte/dist/icons/` or `aliases/`):
  ListMusic, MicVocal (canonical; `Mic2` is its alias and is what TrackMenu already imports), MessageCircle, Sparkles, Heart, Play, Share2, Shuffle, Pencil, Check, Ellipsis

From src/lib/stores/lyric-script.svelte.ts:
  export function parseLyrics(txt: string | null | undefined): LyricLine[]   // LyricLine has `.text: string` (script-locked) — timestamps are NOT in `.text`

From src/lib/stores/comments.svelte.ts:
  commentBadge(n) → null when n <= 0, '99+' when n > 99, else String(n)   // the cap ALREADY exists; NowPlaying's `commentBadge` $derived (line ~620) reads it

From src/lib/actions/dragClose.ts (the picker sheet's `use:dragClose`):
  a close-drag starts on pointermove only when `node.scrollTop <= 0` and the finger pulled DOWN > 8px; `node` is the `.menu` element — an INNER overflow-y:auto box is not consulted, so a pull inside it while the sheet itself is at the top would start a sheet drag. Guard = stop `pointerdown` from bubbling out of the inner box (dragClose's `down()` then never arms).

a11y precedent (passes svelte-check at 0 warnings): `src/lib/components/NpLyrics.svelte:474` is `<div class="lyrics" role="group" aria-label={t('nowplaying.lyrics')} ... onpointerdown={...}>` — `pointerdown` IS in Svelte's interactive-handler list, so a plain `<div onpointerdown>` WITHOUT a role warns. Copy the role + aria-label.

TrackMenu.svelte anchors (line numbers at plan time):
  5     lucide import (has Mic2, Check, Sparkles, X)
  1125  the menu row: `<button class="mi" ... onclick={openLyricsPicker} use:tapBounce><Mic2 size={18} /> {t('menu.fixLyrics')}</button>`
  1400-1438  the picker sheet ({#if lyricsOpen && track}); header at 1410 uses t('menu.fixLyrics'); candidate rows 1419-1430; `.lyr-prev` style at 1591
  1514  `.menu` = position:fixed sheet, max-height: 90vh, overflow-y: auto (the sheet scrolls; cards live inside it)
  1559  `.mi` row style; 1588 `.dl-src` (flex:1, ellipsis); 1660 `.cover-none`

NowPlaying.svelte anchors:
  7          lucide import
  1166-1184  {#if wide} `.subnav.heads` (two inert aria-hidden headings + `.pair` Comments|Related toggle) {:else} `nav.subnav` with four data-tab buttons
  1474-1477  `.subnav`, `.subnav button`, `.subnav button.active`, `.subnav .count` styles; 1521-1532 `.subnav.heads` + `.pair`

artist/[name]/+page.svelte anchors:
  8        `import { Heart, Play, Share2 } from '@lucide/svelte';`
  453-468  the kmn action bar (three `.act` pills with `<span>` text; Play is `class="act primary"`)
  599      `<button class="act" ...>{t('artist.showMore')}</button>` — ALSO uses `.act`; must stay a text pill
  648-654  `.actions`, `.act`, `.act:hover`, `.act:disabled`, `.act.on`, `.act.primary`, `.act.primary:hover`

album/[name]/+page.svelte — THE reference (copy these values verbatim):
  827  `.album-actions { display: flex; align-items: center; justify-content: center; gap: 16px; margin: 2px 0 20px; }`
  828  `.act { display: grid; place-items: center; width: 34px; height: 34px; border-radius: 50%; background: var(--color-surface-2); border: 1px solid transparent; color: var(--color-text); cursor: pointer; transition: background 0.15s, transform 0.1s; }`
  829  `.act:hover { background: var(--color-surface); }`
  832  `@media (hover: hover) { .act:active { transform: scale(0.92); } }`
  833  `.act:disabled { opacity: 0.4; cursor: default; }`
  834  `.act.play { width: 56px; height: 56px; background: var(--color-primary); border-color: transparent; color: #fff; box-shadow: 0 6px 18px rgba(0, 0, 0, 0.4); }`
  icons are `size={20}`

library/+page.svelte anchors:
  7        lucide import (already has Play, Shuffle, Pencil, Check, Ellipsis)
  379-392  `.actions` row: Play (no label), Shuffle (no label), Edit (aria-pressed only, stray spaces after the icons), Options (labelled)
  550-551  `.edit-btn` pill + `[aria-pressed='true']`; 556 `.actions .edit-btn { flex: 0 1 auto; white-space: nowrap; min-width: 0; overflow: hidden; }`
  `.edit-btn` is used ONLY inside `.actions` (lines 381-390) — safe to restyle globally

i18n keys that already exist (reuse, do not mint): nowplaying.upNext, nowplaying.lyrics, nowplaying.comments, nowplaying.related, nowplaying.shuffle, library.playAll, library.edit, common.done ("Done"), menu.options, artist.favorite, artist.unfavorite, artist.playArtist, artist.share, menu.close, menu.lyricsAuto, menu.lyricsPickerNone, menu.lyricsRetry
Locale files: en ar de es fr hi id it pt ru th tr vi zh-Hans zh-Hant (15). DOUBLE quotes for keys and values, tab indent. `menu.fixLyrics` sits between `menu.changeCover` and `menu.lyricsTiming` in every file (en:425, zh-*:384, others:362).
</interfaces>
</context>

<tasks>

<task type="auto">
  <name>Task 1: Rename menu.fixLyrics → menu.changeLyrics and add the two picker keys in all 15 locales</name>
  <files>src/lib/i18n/en.ts, src/lib/i18n/ar.ts, src/lib/i18n/de.ts, src/lib/i18n/es.ts, src/lib/i18n/fr.ts, src/lib/i18n/hi.ts, src/lib/i18n/id.ts, src/lib/i18n/it.ts, src/lib/i18n/pt.ts, src/lib/i18n/ru.ts, src/lib/i18n/th.ts, src/lib/i18n/tr.ts, src/lib/i18n/vi.ts, src/lib/i18n/zh-Hans.ts, src/lib/i18n/zh-Hant.ts, src/lib/i18n/i18n.test.ts, src/lib/components/TrackMenu.svelte</files>
  <action>
In EVERY one of the 15 locale files, replace the `"menu.fixLyrics": …` line with `"menu.changeLyrics": …` and add `"menu.useTheseLyrics"` and `"menu.currentLyrics"` immediately after `"menu.lyricsAuto"`. Double quotes, tab indent, trailing comma — the house convention no tool enforces. Use exactly these values (they reuse each dictionary's existing word for "lyrics" and the verb its `menu.changeCover` already uses):

| locale | menu.changeLyrics | menu.useTheseLyrics | menu.currentLyrics |
|---|---|---|---|
| en | Change lyrics | Use these lyrics | Current lyrics |
| zh-Hans | 更换歌词 | 使用这版歌词 | 当前歌词 |
| zh-Hant | 更換歌詞 | 使用這版歌詞 | 目前歌詞 |
| de | Songtext ändern | Diesen Songtext verwenden | Aktueller Songtext |
| es | Cambiar la letra | Usar esta letra | Letra actual |
| fr | Changer les paroles | Utiliser ces paroles | Paroles actuelles |
| it | Cambia il testo | Usa questo testo | Testo attuale |
| pt | Alterar a letra | Usar esta letra | Letra atual |
| ru | Изменить текст песни | Использовать этот текст | Текущий текст |
| ar | تغيير كلمات الأغنية | استخدام هذه الكلمات | الكلمات الحالية |
| hi | बोल बदलें | ये बोल इस्तेमाल करें | मौजूदा बोल |
| id | Ubah lirik | Gunakan lirik ini | Lirik saat ini |
| th | เปลี่ยนเนื้อเพลง | ใช้เนื้อเพลงนี้ | เนื้อเพลงปัจจุบัน |
| tr | Şarkı sözlerini değiştir | Bu sözleri kullan | Mevcut sözler |
| vi | Đổi lời bài hát | Dùng lời này | Lời hiện tại |

In `src/lib/i18n/i18n.test.ts` append `'menu.fixLyrics'` to the `ABSENT` `as const` array (around line 99-105) so the deleted key is guarded in every locale like the description keys already are.

In `src/lib/components/TrackMenu.svelte` swap both `t('menu.fixLyrics')` usages (menu row ~1125 and picker header ~1410) to `t('menu.changeLyrics')` so `TranslationKey` still compiles at the end of this task. Do not touch the picker markup yet — Task 2 does that.
  </action>
  <verify>
    <automated>cd /Users/laichan/code/tung/openmusic && test "$(grep -rl '"menu.fixLyrics"' src/lib/i18n/ | wc -l | tr -d ' ')" = "0" && test "$(grep -l '"menu.changeLyrics"' src/lib/i18n/*.ts | grep -v test | wc -l | tr -d ' ')" = "15" && test "$(grep -l '"menu.useTheseLyrics"' src/lib/i18n/*.ts | wc -l | tr -d ' ')" = "15" && test "$(grep -l '"menu.currentLyrics"' src/lib/i18n/*.ts | wc -l | tr -d ' ')" = "15" && test "$(grep -rn "fixLyrics" src/ --include='*.svelte' --include='*.ts' | grep -v i18n.test.ts | wc -l | tr -d ' ')" = "0" && pnpm exec vitest run src/lib/i18n/i18n.test.ts</automated>
  </verify>
  <done>15 locales carry menu.changeLyrics / menu.useTheseLyrics / menu.currentLyrics with the table's values, none carries menu.fixLyrics, the ABSENT guard lists it, TrackMenu references only the new key, i18n parity + blank-value tests pass.</done>
</task>

<task type="auto">
  <name>Task 2: Lyrics picker cards showing each candidate's full lyrics with an explicit pick button</name>
  <files>src/lib/components/TrackMenu.svelte</files>
  <action>
Replace the candidate `{#each lyricCandidates as c (c.source)}` block (~1419-1430, the `button.mi` row with the one-line `lyr-prev` preview) with one CARD per candidate, keyed by `c.source` as now. Per card:

- `{@const current = c.lrc === pinnedNow}` and `{@const text = parseLyrics(c.lrc).map((l) => l.text.trim()).filter(Boolean).join('\n')}` — full lyrics, text only (parseLyrics already strips timestamps and script-locks via names.zhLock), empty lines dropped.
- `<div class="lyr-card" class:on={current}>` containing:
  1. header `<div class="lyr-head">`: `<span class="dl-src">{SOURCES[c.source]?.label ?? c.source}</span>` (reuse the existing `.dl-src` ellipsis class) and, only when `current`, `<span class="lyr-cur"><Check size={14} /> {t('menu.currentLyrics')}</span>`.
  2. body `<div class="lyr-body" role="group" aria-label={t('nowplaying.lyrics')} onpointerdown={(e) => e.stopPropagation()}>{text}</div>` — a SINGLE text interpolation (Svelte escapes; never `{@html}` — T-1we-02), rendered with `white-space: pre-line` so the `\n` joins become lines. The `role="group" aria-label` is the NpLyrics.svelte:474 precedent that keeps svelte-check at 0 warnings for a div with a pointer handler. The `stopPropagation` is the dragClose guard: dragClose arms in its own `pointerdown` on the `.menu` node and only checks the `.menu`'s scrollTop, so a scroll gesture inside this inner box would otherwise start a sheet drag whenever the sheet itself is at the top. Stopping the bubble means the finger inside the box only ever scrolls the box; the header/footer/rest of the sheet still drag-close as before. Add a comment tagged quick-260926-vdp saying exactly that.
  3. footer `<button class="mi" onclick={() => pickLyrics(c.lrc)} use:tapBounce><Mic2 size={18} /> {t('menu.useTheseLyrics')}</button>` — the ONLY pick target (a scrollable card must not pick on a scroll gesture). `pickLyrics` is unchanged (pins the RAW upstream `c.lrc`, toasts, writes tags, closes).

Keep everything around it untouched: the spinner branch, the `cover-none` + `menu.lyricsRetry` branch, and the trailing `menu.lyricsAuto` reset button.

Styles (in the component `<style>`): DELETE the now-unused `.lyr-prev` rule at ~1591 (an unused selector is a svelte-check warning). Add:
- `.lyr-card { border: 1px solid var(--color-border); border-radius: 12px; margin: 6px 4px; overflow: hidden; }`
- `.lyr-card.on { border-color: var(--color-primary); }`
- `.lyr-head { display: flex; align-items: center; justify-content: space-between; gap: 8px; padding: 10px 12px 2px; font-size: 0.8125rem; color: var(--color-text-muted); }`
- `.lyr-cur { display: inline-flex; align-items: center; gap: 4px; flex: none; color: var(--color-primary); font-size: 0.75rem; white-space: nowrap; }`
- `.lyr-body { max-height: 12rem; overflow-y: auto; overscroll-behavior: contain; padding: 4px 12px 8px; font-size: 0.875rem; line-height: 1.5; white-space: pre-line; color: var(--color-text); }` (12rem at 1.5 line-height ≈ 9 lines; the `.menu` sheet keeps its own 90vh scroll, so several cards stay reachable)

Update the picker's block comment (~1400-1405) — it still says "first timestamped line as a preview"; state that each card shows the full script-locked text and only the footer button picks (quick-260926-vdp), keeping the existing D-5 / T-1we-02 / quick-260919-2jo references.
  </action>
  <verify>
    <automated>cd /Users/laichan/code/tung/openmusic && test "$(grep -c 'lyr-prev' src/lib/components/TrackMenu.svelte)" = "0" && test "$(grep -c "menu.useTheseLyrics" src/lib/components/TrackMenu.svelte)" = "1" && test "$(grep -c "menu.currentLyrics" src/lib/components/TrackMenu.svelte)" = "1" && test "$(sed -n '/{#if lyricsOpen && track}/,/quick-260916-0d9/p' src/lib/components/TrackMenu.svelte | grep -c '{@html')" = "0" && grep -q 'onclick={() => pickLyrics(c.lrc)}' src/lib/components/TrackMenu.svelte && pnpm check 2>&1 | grep -q '0 ERRORS 0 WARNINGS'</automated>
  </verify>
  <done>Each candidate renders as a card with source label, "Current lyrics" check when pinned, full plain-text lyrics in a ~9-line scroll box that neither picks nor drags the sheet, and a "Use these lyrics" button that pins via pickLyrics; spinner / none+retry / automatic branches unchanged; svelte-check 0 errors 0 warnings.</done>
</task>

<task type="auto">
  <name>Task 3: Icon-only tabs and round action buttons — Now Playing, artist page, library</name>
  <files>src/lib/components/NowPlaying.svelte, src/routes/(app)/artist/[name]/+page.svelte, src/routes/(app)/library/+page.svelte</files>
  <action>
**NowPlaying.svelte (scope C).** Add `ListMusic, MicVocal, MessageCircle, Sparkles` to the lucide import on line 7 (all four verified in @lucide/svelte 1.17.0). In BOTH the narrow `nav.subnav` (~1177-1183) and the wide `.subnav.heads` row (~1167-1175) replace each text label with the icon at `size={20}` and give every button `aria-label={t('<key>')} title={t('<key>')}` using the SAME key it displayed: queue → ListMusic + nowplaying.upNext; lyrics → MicVocal + nowplaying.lyrics; comments → MessageCircle + nowplaying.comments; related → Sparkles + nowplaying.related. Keep `data-tab`, `class:active`, `onclick`, `use:tapBounce` exactly as they are (the grip machinery resolves `.closest('.subnav button[data-tab]')` through the SVG child unchanged). The two inert wide headings stay `aria-hidden="true" tabindex="-1"` and get only `title` (an aria-label on an aria-hidden node is noise). The count badge stays `{#if commentBadge}<span class="count">{commentBadge}</span>{/if}` right after the MessageCircle icon on both Comments buttons — the 0/loading hide and the '99+' cap already live in `commentBadge` / `comments.svelte.ts`.
Styles: `.subnav button` gains `position: relative; display: inline-flex; align-items: center; justify-content: center;` (keep min-height 40px, padding 8px 12px, the 2px transparent bottom border and the `.active` colour + primary underline as-is). `.subnav .count` becomes an overlay pill: replace `margin-left: 5px` with `position: absolute; top: 2px; right: 0; line-height: 1.2;` keeping the rest (padding 1px 6px, radius 999px, surface background, muted colour, tabular-nums, 0.6875rem). Append one quick-260926-vdp line to the np3/nsz comment block noting labels moved to aria-label/title.

**artist/[name]/+page.svelte (scope D).** In the kmn action bar (~455-468): delete the three `<span>…</span>` text children; icons become `size={20}`; rename Play's class from `act primary` to `act play` (album's exact class); add `title` mirroring each existing `aria-label` (fav: the favorite/unfavorite flip; play: artist.playArtist; share: artist.share); add `aria-pressed={favArtist}` to the Favourite button. Order stays Heart · Play · Share. Update the kmn comment ("pill buttons" → round icon buttons, quick-260926-vdp).
Styles: the `Show more` button at ~599 ALSO uses `.act` and must remain a text pill, so scope the round look to the row: keep `.act` / `.act:hover` / `.act:disabled` / `.act.on` as they are, delete the `.act.primary` and `.act.primary:hover` rules (unused → warning), and change/add:
- `.actions { display: flex; align-items: center; justify-content: center; gap: 16px; margin: 14px 0 6px; }` (drop flex-wrap)
- `.actions .act { display: grid; place-items: center; width: 34px; height: 34px; padding: 0; gap: 0; border-radius: 50%; border-color: transparent; transition: background 0.15s, transform 0.1s; }`
- `.actions .act.on { border-color: var(--color-primary); }` (keeps the favourited ring visible now that the base border is transparent)
- `@media (hover: hover) { .actions .act:active { transform: scale(0.92); } }`
- `.actions .act.play { width: 56px; height: 56px; background: var(--color-primary); color: #fff; box-shadow: 0 6px 18px rgba(0, 0, 0, 0.4); }`
- `.actions .act.play:hover { filter: brightness(1.06); }`

**library/+page.svelte (scope E).** In the `.actions` row (~379-392): Play gets `aria-label={t('library.playAll')} title={t('library.playAll')}`; Shuffle gets `aria-label={t('nowplaying.shuffle')} title={t('nowplaying.shuffle')}`; Edit keeps `aria-pressed={editMode}` and gets `aria-label={editMode ? t('common.done') : t('library.edit')}` plus the same expression as `title`; drop the stray spaces after the Check/Pencil icons inside the `{#if editMode}` branches; Options is already labelled. Icons to `size={18}`.
Styles: `.edit-btn` → `display: grid; place-items: center; width: 34px; height: 34px; padding: 0; border-radius: 50%; background: var(--color-surface-2); border: 1px solid transparent; color: var(--color-text); cursor: pointer; transition: background 0.15s, transform 0.1s;` (drop gap/font-size); keep `.edit-btn[aria-pressed='true']` primary fill; `.actions .edit-btn` becomes `flex: none;` (a circle must not shrink or clip). Add `@media (hover: hover) { .edit-btn:active { transform: scale(0.92); } }`.

Per scope F, touch nothing else: settings rows, "Write a comment", "Show more", "Go to library", TrackMenu rows, search pill, sleep-timer readout keep their text.
  </action>
  <verify>
    <automated>cd /Users/laichan/code/tung/openmusic && test "$(grep -c 'data-tab=.*aria-label=\|aria-label=.*data-tab=' src/lib/components/NowPlaying.svelte)" = "6" && grep -q 'MessageCircle' src/lib/components/NowPlaying.svelte && test "$(grep -c "nowplaying\.\(upNext\|lyrics\|comments\|related\)')}</button>" src/lib/components/NowPlaying.svelte)" = "0" && test "$(grep -c '<span>{.*artist\.\(playArtist\|favorite\|unfavorite\|share\)' 'src/routes/(app)/artist/[name]/+page.svelte')" = "0" && grep -q 'class="act play"' 'src/routes/(app)/artist/[name]/+page.svelte' && grep -q 'aria-pressed={favArtist}' 'src/routes/(app)/artist/[name]/+page.svelte' && test "$(grep -c 'act\.primary' 'src/routes/(app)/artist/[name]/+page.svelte')" = "0" && test "$(grep -c "aria-label=" 'src/routes/(app)/library/+page.svelte' | tr -d ' ')" -ge 4 && grep -q "library.playAll" 'src/routes/(app)/library/+page.svelte' && grep -q "common.done" 'src/routes/(app)/library/+page.svelte' && pnpm check 2>&1 | grep -q '0 ERRORS 0 WARNINGS' && pnpm test 2>&1 | tail -5 | grep -q 'Tests.*passed'</automated>
  </verify>
  <done>All six data-tab buttons and the two inert headings show icons with aria-label/title; count pill overlays the Comments icon; artist row is Heart · Play(56px) · Share circles with labels, aria-pressed, no text spans, Show-more pill intact; library action bar is four labelled 34px circles; svelte-check 0/0 and the full vitest suite passes.</done>
</task>

</tasks>

<threat_model>
## Trust Boundaries

| Boundary | Description |
|----------|-------------|
| upstream LRC → picker DOM | lyric text from CN sources is untrusted content rendered in the sheet |
| user pointer → sheet gestures | scroll inside a card must not become a pick or a sheet dismissal |

## STRIDE Threat Register

| Threat ID | Category | Component | Disposition | Mitigation Plan |
|-----------|----------|-----------|-------------|-----------------|
| T-vdp-01 | Tampering (XSS) | TrackMenu lyrics card body | mitigate | single `{text}` Svelte interpolation (escaped); grep gate proves no `{@html}` inside the picker block (extends T-1we-02) |
| T-vdp-02 | Denial of Service | huge LRC in a card | mitigate | body capped at 12rem with its own overflow scroll; the `.menu` keeps 90vh max-height — a 10k-line candidate cannot blow the sheet off-screen |
| T-vdp-03 | Repudiation (accidental pin) | card gestures | mitigate | pick is ONLY the explicit footer button; scroll box stops pointerdown bubbling so it neither picks nor drags the sheet |
| T-vdp-04 | Information Disclosure | icon-only buttons | mitigate | every icon button carries aria-label + title (screen readers / hover keep the label); wide inert headings stay aria-hidden |
| T-vdp-SC | Tampering | npm installs | accept | no package installs in this plan |
</threat_model>

<verification>
- `pnpm check` → `0 ERRORS 0 WARNINGS` (baseline is 0/0; unused selectors and a role-less pointer handler would regress it)
- `pnpm test` → all green (i18n parity across 15 locales, ABSENT guard for menu.fixLyrics)
- `grep -rn fixLyrics src/` → only the ABSENT entry in i18n.test.ts
- Orchestrator browser E2E: open a track menu → "Change lyrics" → cards show full lyrics, inner scroll does not close the sheet or pick, "Use these lyrics" pins + toasts; Now Playing tabs are icons with hover titles and the comment pill; artist page shows Heart · Play · Share circles; library bar shows four circles with hover titles.
</verification>

<success_criteria>
- No surface reads "Fix lyrics"; `menu.changeLyrics` / `menu.useTheseLyrics` / `menu.currentLyrics` exist in all 15 locales with double quotes.
- Lyrics picker = one card per source with full plain-text lyrics in a ~9-line scroll box, "Current lyrics" check on the pinned one, explicit "Use these lyrics" button; loading / none+retry / automatic branches unchanged.
- Now Playing tabs (narrow + wide) are lucide icons with aria-label + title, active underline kept, comment pill overlaid top-right with the existing 99+ cap.
- Artist action bar and library action bar are round icon-only buttons in the album page's visual language, every one labelled; the artist "Show more" pill and all scope-F text buttons untouched.
- `pnpm check` 0/0 and `pnpm test` green.
</success_criteria>

<output>
Create `.planning/quick/260926-vdp-change-lyrics-picker-with-full-lyrics-ic/260926-vdp-SUMMARY.md` when done.
</output>
