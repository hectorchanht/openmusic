---
phase: quick-261102-sfc
plan: 01
type: execute
wave: 1
depends_on: []
files_modified:
  - src/routes/(app)/settings/home/+page.svelte
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
  - src/routes/(app)/+page.svelte
  - src/lib/components/Nowbar.svelte
  - src/routes/(app)/settings/downloads/+page.svelte
  - src/routes/(app)/settings/activity/+page.svelte
  - DESIGN.md
  - src/lib/components/SponsoredStrip.svelte
autonomous: true
requirements: [HOME-AUDIT-P1]

must_haves:
  truths:
    - "Settings → Home shows a 'Tile size' picker with exactly two mockup options, Comfortable and Compact; picking Compact stores homeDensity='list', picking Comfortable stores 'grid'; a stored 'pile' shows Comfortable selected"
    - "Library-shelf grid tiles and the D-06 fallback grid tiles paint covers via a lazy <img> over the gradient; a dead cover URL leaves the gradient, not a blank tile"
    - "Every shelf title on Home is an <h3> (18 titleNav sites) with no visual change"
    - "Home error text uses var(--color-danger-text), which clears 4.5:1 on every theme floor"
    - "Gear, Randomize, Retry, search pill and sponsor chips all have >=48px tall hit areas; SponsoredStrip has no px font sizes"
  artifacts:
    - path: "src/routes/(app)/settings/home/+page.svelte"
      provides: "Two-option Tile size preview picker"
      contains: "settings.tileSize"
    - path: "src/lib/i18n/en.ts"
      provides: "settings.tileSize + settings.tileSizeDesc keys (tileDensity* retired)"
      contains: "settings.tileSizeDesc"
    - path: "src/routes/(app)/+page.svelte"
      provides: "lazy grid covers, h3 shelf headings, token error colour, 48px hit boxes"
      contains: "<h3 class=\"subhead\">"
    - path: "src/lib/components/SponsoredStrip.svelte"
      provides: "48px chip hit area via ::after, rem font sizes"
      contains: "::after"
  key_links:
    - from: "src/routes/(app)/settings/home/+page.svelte"
      to: "settings.homeDensity"
      via: "value mapping list⇄Compact, else⇄Comfortable"
      pattern: "homeDensity === 'list'"
    - from: "src/routes/(app)/+page.svelte"
      to: "src/app.css --color-danger-text"
      via: ".error colour"
      pattern: "var\\(--color-danger-text\\)"
---

<objective>
Fix the five verified P1 findings from the Home page impeccable audit: (1) rename the misrepresenting "Tile density" setting to a two-option "Tile size" picker with identical stored behaviour, (2) make library-grid + fallback-grid covers lazy `<img>`s with onerror fallback, (3) make the 18 shelf titles real `<h3>` headings, (4) route error text through the existing `--color-danger-text` token, (5) bring Home controls and sponsor chips up to the 48dp Android touch floor and purge px font sizes.

Purpose: Home is the landing surface for a first-class Android APK; these are the accessibility / correctness / perf gaps that fail the craft floor.
Output: edited settings page, 15 locale dictionaries, Home page, Nowbar + two settings pages (token swap), DESIGN.md line, SponsoredStrip.
</objective>

<execution_context>
@/Users/laichan/.claude/plugins/cache/gsd-plugin/gsd/4.5.3/workflows/execute-plan.md
@/Users/laichan/.claude/plugins/cache/gsd-plugin/gsd/4.5.3/templates/summary.md
</execution_context>

<context>
@./CLAUDE.md
@./DESIGN.md
@/Users/laichan/.claude/skills/impeccable/reference/craft-floor.md
@src/routes/(app)/+page.svelte
@src/routes/(app)/settings/home/+page.svelte
@src/lib/components/SponsoredStrip.svelte
@src/lib/components/SettingPicker.svelte

<interfaces>
<!-- Already in the codebase — REUSE, do not re-create. -->

src/app.css (quick-261102-s5t already added the token the audit asked for — use it, do NOT add a second `--color-error-text`):
  :root                      --color-danger-text: #ff7a90
  :root[data-theme='light']  --color-danger-text: #c62a47
  gold (#100c06) / sakura (#120b10) inherit #ff7a90 — contrast computed: #ff7a90 on #100c06 ≈ 7.8:1, on #120b10 ≈ 7.8:1 (pass); #c62a47 on #ffffff ≈ 5.5:1, on #f7f7fa ≈ 5.2:1 (pass). No app.css change needed.

src/lib/i18n/*.ts — these keys ALREADY exist in all 15 dictionaries and are UNUSED in source (left over from quick-260618-goe):
  "settings.densityComfortable"  (en "Comfortable", zh-Hant "舒適", de "Kompakt"/"Komfortabel" …)
  "settings.densityCompact"      (en "Compact", zh-Hant "緊湊", …)
  → reuse them as the two option labels. Only TWO new keys are needed: settings.tileSize, settings.tileSizeDesc.
  Keys to retire (only used by settings/home/+page.svelte lines 584/589): settings.tileDensity, settings.tileDensityDesc.

src/lib/components/SettingPicker.svelte (variant="preview"):
  options: { v, label, preview: Snippet }[]; value; onpick(v)
  mock primitives usable inside preview snippets: .mock-chrome .mock-col .mock-row .mock-grid .mock-tile .mock-line (.dim)

src/routes/(app)/+page.svelte existing patterns:
  discovery grid tile (line ~1443): `<div class="art" style:background-image={fallbackCover(...)}></div>{#if cover}<img class="al-cover-img" src=… loading="lazy" decoding="async" alt="" onerror={hideOnError} />{/if}<div class="scrim"></div>`
  .art { position:absolute; inset:0 } .scrim { position:absolute; inset:0 } .al-cover-img { position:absolute; inset:0; object-fit:cover; border-radius:inherit } .q { position:absolute; top:6px; right:6px }
  titleNav snippet (line ~1294) rendered at 18 sites; .subhead-nav is display:flex, width:100%, min-height:44px, margin:14px 16px 14px 0, sets its own font-size/weight.
  .gear 38×38 (line ~1777), .searchpill padding 11px 16px (~37px tall), .more/.retry 40×40 bordered circles (line ~1842), .error { color:#ff7a90 } (line ~1907)
  class:compact={settings.homeDensity === 'list'} at line ~1213 — the ONLY behavioural read of homeDensity; comment block at ~1871-1873 ("w87: COMPACT density … set on .section from settings.homeDensity") is accurate about mechanism, stale about the setting's name.
</interfaces>
</context>

<constraints>
- OTHER SESSIONS ARE COMMITTING CONCURRENTLY on this worktree (`main`; many unrelated dirty files e.g. src/lib/services/*.ts, src/lib/proxy/*.ts). `git add` ONLY the exact paths you changed — never `git add -A` / `git add .`. Commit with explicit paths.
- Node: `export PATH=~/.nvm/versions/node/v24.13.0/bin:$PATH` before any pnpm command.
- House style: tabs; every non-obvious change gets a comment tagged `quick-261102-sfc`; never remove existing decision-ref comments (D-xx, w87, quick-xxxxxx-xxx …) — amend them.
- i18n files: double quotes for keys AND values; `i18n.test.ts` enforces identical key sets across all dictionaries.
- Font sizes rem-only (no px).
- Read /Users/laichan/.claude/skills/impeccable/reference/craft-floor.md before touching UI.
- Commit messages end with: `Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>`.
- Zero `as any`, no new deps, no settings migration, `HomeDensity` type and `homeSectionDensity` untouched.
</constraints>

<tasks>

<task type="auto">
  <name>Task 1: Rename "Tile density" → two-option "Tile size" picker (finding 1)</name>
  <files>src/routes/(app)/settings/home/+page.svelte, src/lib/i18n/en.ts, src/lib/i18n/ar.ts, src/lib/i18n/de.ts, src/lib/i18n/es.ts, src/lib/i18n/fr.ts, src/lib/i18n/hi.ts, src/lib/i18n/id.ts, src/lib/i18n/it.ts, src/lib/i18n/pt.ts, src/lib/i18n/ru.ts, src/lib/i18n/th.ts, src/lib/i18n/tr.ts, src/lib/i18n/vi.ts, src/lib/i18n/zh-Hans.ts, src/lib/i18n/zh-Hant.ts, src/routes/(app)/+page.svelte</files>
  <action>
**i18n (15 dictionaries — every `src/lib/i18n/*.ts` that contains `"settings.tileDensity"`):** First `grep -rn "settings.tileDensity" src --include='*.svelte' --include='*.ts' | grep -v src/lib/i18n/` and confirm the ONLY consumers are settings/home/+page.svelte lines ~584/589 (expected). Then in each dictionary rename IN PLACE: `"settings.tileDensity"` → `"settings.tileSize"` and `"settings.tileDensityDesc"` → `"settings.tileSizeDesc"` (keeps alphabetical-ish neighbourhoods; no key-set drift). Values (desc deliberately echoes each locale's existing `settings.densityCompact` word so the hint and the option label agree):
- en: "Tile size" / "How big the shelf tiles are — Compact fits more per row."
- zh-Hant: "圖塊大小" / "書架圖塊的大小——「緊湊」每行可放更多。"
- zh-Hans: "图块大小" / "货架图块的大小——“紧凑”每行可放更多。"
- de: "Kachelgröße" / "Wie groß die Regal-Kacheln sind — „Kompakt“ bringt mehr pro Reihe unter."
- es: "Tamaño de los mosaicos" / "El tamaño de los mosaicos de las estanterías: «Compacto» cabe más por fila."
- fr: "Taille des vignettes" / "La taille des vignettes des étagères : « Compacte » en affiche plus par ligne."
- it: "Dimensione dei riquadri" / "Quanto sono grandi i riquadri degli scaffali: «Compatto» ne mostra di più per riga."
- pt: "Tamanho dos blocos" / "O tamanho dos blocos das prateleiras — «Compacto» cabe mais por linha."
- ru: "Размер плиток" / "Размер плиток на полках — «Компактный» вмещает больше в ряд."
- tr: "Karo boyutu" / "Raf karolarının boyutu — «Kompakt» her satıra daha fazla sığdırır."
- ar: "حجم البلاطات" / "حجم بلاطات الرفوف — «مدمج» يعرض أكثر في كل صف."
- hi: "टाइल का आकार" / "शेल्फ़ टाइलों का आकार — «सघन» में हर पंक्ति में ज़्यादा आते हैं।"
- id: "Ukuran ubin" / "Seberapa besar ubin rak — «Kompak» memuat lebih banyak per baris."
- th: "ขนาดไทล์" / "ขนาดของไทล์บนชั้นวาง — «กะทัดรัด» ใส่ได้มากขึ้นต่อแถว"
- vi: "Kích thước ô" / "Kích thước các ô trên kệ — «Nhỏ gọn» hiển thị nhiều hơn mỗi hàng."
Do NOT touch `settings.densityList/Pile/Grid` (per-section density still uses them) nor `settings.densityComfortable/Compact` (now reused).

**settings/home/+page.svelte:** Replace section 6 (`<!-- 6. TILE DENSITY -->`, ~lines 582-597) with a "6. TILE SIZE" section: h2 + SettingHint use `t('settings.tileSize')` / `t('settings.tileSizeDesc')`; keep the `LayoutList` icon. The `SettingPicker variant="preview"` gets exactly two options: `{ v: 'grid', label: t('settings.densityComfortable'), preview: sizeComfortable }` and `{ v: 'list', label: t('settings.densityCompact'), preview: sizeCompact }`. `value={settings.homeDensity === 'list' ? 'list' : 'grid'}` (so a stored 'pile' displays as Comfortable), `onpick={setDensity}` unchanged (it receives 'grid' | 'list', both valid HomeDensity; no migration, `homeDensity` field + type untouched — decision from the audit: behaviour identical, Compact == 'list', Comfortable == anything else, because `+page.svelte` only reads `homeDensity` for `class:compact`). Add a `quick-261102-sfc` comment stating this mapping and WHY (the old 3-shape picker claimed to set the shelf layout, but `densityOf()` passes 'list' as the global default and ignores it; the only effect is 130→96px tiles + tighter gaps).
Replace the `densityList`/`densityPile`/`densityGrid` snippets (~lines 366-399) with two SIZE mockups built from the same `.mock-*` primitives (CSS-only per SettingPicker rules): `sizeComfortable` = `.mock-chrome` > `.mock-line` (width 35%) + `.mock-row` (flex-wrap nowrap) of 3 `.mock-tile` at width 26px; `sizeCompact` = same but 4 `.mock-tile` at width 18px with a smaller gap if `.mock-row` exposes one via style (otherwise just the tile width difference). Update the snippet header comment ("homeDensity — three tiny layout mockups…") to "homeDensity — two tile-size mockups". Delete now-unused `densityLabels` only if nothing else references it (grep: it is used only at lines 591-593 → remove the `$derived`). Keep `densities` (used by `densitySeg`). Amend the `densitySeg` comment block (~line 405-409) that says "the same enum as the global tile density below … the global preview already teaches the same three-shape vocabulary" — append a `quick-261102-sfc` note that the global picker is now a two-option Tile size and the per-section seg is the only place the three shapes are shown.

**+page.svelte comments only (no behaviour):** amend the w87 comment at ~1871-1873 with a `quick-261102-sfc` line: "settings UI now calls this 'Tile size' (Compact = 'list', Comfortable = any other value); the stored enum is unchanged." Leave the `class:compact` expression as-is.
  </action>
  <verify>
    <automated>export PATH=~/.nvm/versions/node/v24.13.0/bin:$PATH && cd /Users/laichan/code/tung/openmusic && test "$(grep -rl 'settings.tileDensity' src | wc -l | tr -d ' ')" = "0" && test "$(grep -l '"settings.tileSizeDesc"' src/lib/i18n/*.ts | wc -l | tr -d ' ')" = "15" && grep -q "densityComfortable" "src/routes/(app)/settings/home/+page.svelte" && pnpm test -- src/lib/i18n src/lib/stores/settings</automated>
  </verify>
  <done>Settings → Home section 6 reads "Tile size" with two mockup cards (Comfortable / Compact); picking Compact stores 'list', Comfortable stores 'grid'; `settings.tileDensity*` keys gone from all 15 dictionaries, `settings.tileSize*` present in all 15 with real translations; i18n parity test + settings tests pass; `pnpm check` clean for the touched files.</done>
</task>

<task type="auto">
  <name>Task 2: Home page — lazy grid covers, h3 shelf headings, error token, 48px hit boxes (findings 2-5a)</name>
  <files>src/routes/(app)/+page.svelte, DESIGN.md, src/lib/components/Nowbar.svelte, src/routes/(app)/settings/downloads/+page.svelte, src/routes/(app)/settings/activity/+page.svelte</files>
  <action>
**(2) Lazy grid covers — mirror the discovery grid tile at ~1443-1444.**
- `libraryShelf` grid branch (~line 1672): change `<div class="art" use:lazyCover={…} style:background-image={rowCover ? \`url(${rowCover})\` : fallbackCover(track.uid)}></div>` to `<div class="art" use:lazyCover={{ track, onResolved: () => bumpCoverVersion() }} style:background-image={fallbackCover(track.uid)}></div>{#if rowCover}<img class="al-cover-img" src={rowCover} loading="lazy" decoding="async" alt="" onerror={hideOnError} />{/if}` — keep `use:lazyCover` on `.art`, `.scrim` stays after the img.
- D-06 fallback grid (~line 1247): keep the pin-first `{@const art = …}`; `.art` carries only `fallbackCover(track.uid)`; insert `{#if art}<img class="al-cover-img" src={art} loading="lazy" decoding="async" alt="" onerror={hideOnError} />{/if}` directly after `.art` and BEFORE the `.q` badge and `.scrim` (DOM order = paint order for the absolute siblings, so the badge and scrim still sit above the cover).
- Amend the comment at ~1638 ("a CSS url() background is never lazy…") / add a `quick-261102-sfc` comment at each site: CSS `background-image:url()` was never lazy and had no onerror, so a dead URL left a blank tile and never reached hideOnError's dead-URL marking. `.al-cover-img` already has `border-radius: inherit` and `.tile` has `overflow:hidden`, so no CSS change is needed.

**(3) Shelf titles as headings.** In the `titleNav` snippet (~1294) wrap the button: `<h3 class="subhead"><button class="subhead-nav" …>…</button></h3>`. Add CSS `.subhead { margin: 0; }` only — the button sets its own font-size/weight/line box and keeps its `margin: 14px 16px 14px 0`, so this is zero visual change (an h3 with margin:0 containing one block-level flex child adds no height). Comment with `quick-261102-sfc`: 18 shelf titles were buttons only, so the Home outline had a single h2. `.ph-head` (aria-hidden placeholder) needs no change. Songs-of-year uses titleNav → covered.

**(4) Error token.** `.error { color: var(--color-danger-text); … }` (the token quick-261102-s5t already added; dark #ff7a90, light #c62a47; gold/sakura inherit #ff7a90 at ≈7.8:1 on their floors — verified by WCAG luminance math, no app.css edit). Also swap these trivially-safe INLINE ERROR TEXT uses (same role, single `color:` declaration, theme-visible on bg/surface): `src/lib/components/Nowbar.svelte` `.err` (~641 — DESIGN.md's named example), `src/routes/(app)/settings/downloads/+page.svelte` `.summary .hint.removed` (~568), `.hint.reject` (~605) and the `.txt[aria-invalid='true']` border (~602), `src/routes/(app)/settings/activity/+page.svelte` `.item.danger` (~148). Leave `.mi.danger` / `.danger` action-label tints, RowBadges `.unavailable`, SongRow `.is-danger`, DownloadControl, SettingRow and library edit-row as-is (destructive-action tint, not error text; TrackMenu's comment explicitly declined a token there — note this in the SUMMARY, do not sprawl). In `DESIGN.md` line 156 change to: `- **Alarm Coral Text** (\`alarm-coral-text\`, CSS token \`--color-danger-text\`): inline error text, such as a Nowbar playback error. Light theme overrides it to #c62a47 for 4.5:1.`

**(5a) Touch targets on Home (visual size unchanged, zero layout shift — extend the hit box with a pseudo-element, which belongs to the button for hit-testing):**
- `.gear` (38×38): add `position: relative;` and `.gear::after { content: ''; position: absolute; inset: -5px; }` → 48×48 hit.
- `.more, .retry` (40×40): add `position: relative;` and `.more::after, .retry::after { content: ''; position: absolute; inset: -4px; }` → 48×48 hit. (`.retry` is inline-grid inside `<p class="error">`; position:relative is fine.)
- `.searchpill`: add `min-height: 48px;` (DESIGN.md hit is 44, Android floor is 48); keep `border-radius: 999px` and padding.
Comment each with `quick-261102-sfc: Android 48dp touch floor (PRODUCT.md: APK is first-class); hit box only, glyph/circle unchanged`. Do not change the `.more` spinning / disabled rules.
  </action>
  <verify>
    <automated>export PATH=~/.nvm/versions/node/v24.13.0/bin:$PATH && cd /Users/laichan/code/tung/openmusic && P="src/routes/(app)/+page.svelte" && test "$(grep -c 'url(\${rowCover})\|url(\${art})' "$P")" = "0" && test "$(grep -c '<h3 class="subhead">' "$P")" = "1" && test "$(grep -c '#ff7a90' "$P")" = "0" && grep -q 'var(--color-danger-text)' "$P" && grep -q 'min-height: 48px' "$P" && grep -q '\.gear::after' "$P" && grep -q 'color-danger-text' DESIGN.md && pnpm check 2>&1 | tail -3</automated>
  </verify>
  <done>Library grid + fallback grid tiles render covers via lazy `<img>` with onerror → gradient; all 18 shelf titles are inside `<h3 class="subhead">` with no visual change; `.error` + the four listed sibling sites use `var(--color-danger-text)`; gear/randomize/retry have 48×48 hit boxes via ::after, search pill min-height 48px; DESIGN.md names the token; `pnpm check` reports 0 errors (pre-existing warnings/errors in unrelated files listed separately in SUMMARY).</done>
</task>

<task type="auto">
  <name>Task 3: SponsoredStrip — 48px chip hit areas + rem font sizes (finding 5b)</name>
  <files>src/lib/components/SponsoredStrip.svelte</files>
  <action>
Chips are ~25px tall (11px/1 line-height + 7px×2 padding). The strip is `overflow-x: auto`, which forces `overflow-y` to auto too, so any hit extension MUST stay inside the strip's own padding box or it creates a vertical scroll. Therefore:
- `.sponsored { padding: 12px 0; }` (was `2px 0 12px`; +10px row height — the only visual change — and it also keeps the chip hit box from ever overlapping the gear's extended hit box above or the search pill below, because the extension never leaves the strip).
- `.sp-btn { position: relative; font-size: 0.6875rem; }` (11/16) and `.sp-btn::after { content: ''; position: absolute; inset: -12px 0; }` → 25 + 24 = 49px tall hit, no horizontal extension (chips have a 6px gap; `inset: -12px 0` keeps x at 0 so neighbours never overlap). Pseudo-element hits on an `<a>` count as the link.
- `.disclosure { font-size: 0.5625rem; }` (9/16).
Comment with `quick-261102-sfc`: Android 48dp touch floor + rem-only rule; explain the overflow-y clipping constraint so nobody later "optimises" the padding back down. Keep the HIDE RULE V2 comment and all slot data untouched.
  </action>
  <verify>
    <automated>export PATH=~/.nvm/versions/node/v24.13.0/bin:$PATH && cd /Users/laichan/code/tung/openmusic && F=src/lib/components/SponsoredStrip.svelte && test "$(grep -c 'font-size: [0-9.]*px' $F)" = "0" && grep -q '\.sp-btn::after' $F && grep -q 'inset: -12px 0' $F && pnpm test -- src/lib/services/home-layout src/lib/i18n 2>&1 | tail -5</automated>
  </verify>
  <done>Sponsor chips look the same but accept taps across a 49px-tall band; no px font sizes remain in SponsoredStrip; strip does not gain a vertical scrollbar; home-layout + i18n tests pass.</done>
</task>

</tasks>

<threat_model>
## Trust Boundaries

| Boundary | Description |
|----------|-------------|
| cover URL → `<img src>` | Cover URLs come from upstream catalogues / cache; already rendered the same way by the discovery grid and librarySongRow. |

## STRIDE Threat Register

| Threat ID | Category | Component | Disposition | Mitigation Plan |
|-----------|----------|-----------|-------------|-----------------|
| T-sfc-01 | Tampering | grid tile `<img src={rowCover}>` | accept | Same source + same `.al-cover-img`/`hideOnError` path the discovery grid and pile rows already use; moving from CSS `url()` to `<img>` does not widen the surface (no `srcset`, no script context). |
| T-sfc-02 | Denial of Service | lazy `<img loading="lazy">` | mitigate | Lazy loading REDUCES eager network fan-out vs the CSS background it replaces. |
| T-sfc-SC | Tampering | npm installs | accept | No package installs in this plan. |
</threat_model>

<verification>
- `pnpm check` → 0 errors in touched files (list any pre-existing failures elsewhere separately).
- `pnpm test -- src/lib/i18n src/lib/stores/settings src/lib/services/home-layout` → pass.
- Grep gates in each task's `<automated>` block.
- Optional visual: `pnpm dev` (port 4321/5173), open `/settings/home` → section 6 shows two mockup cards; open `/` → shelves unchanged; Elements panel shows `h3.subhead` wrappers, grid tiles have `img.al-cover-img`.
</verification>

<success_criteria>
- Findings 1-5 of the Home audit are all closed with no behaviour change to `homeDensity` storage, no settings migration, no new CSS token (the existing `--color-danger-text` is reused), no new deps.
- Three commits (one per task) each `git add`-ing only the files listed in that task's `<files>`; each message ends with the required Co-Authored-By line.
</success_criteria>

<output>
Create `.planning/quick/261102-sfc-home-audit-p1-fixes-tile-size-rename-laz/261102-sfc-SUMMARY.md` when done. Include: the list of `#ff7a90` sites deliberately left (action tints), the WCAG ratios used, and any pre-existing `pnpm check`/`pnpm test` failures unrelated to this task.
</output>
