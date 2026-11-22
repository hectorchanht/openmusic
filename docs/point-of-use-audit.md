# Point-of-use audit — Settings + TrackMenu (2026-11-22)

> Gold line: **ANTIDOTE BESIDE THE SNAKE** — a control lives where its effect is felt, one tap away.
> Companions: **ONE FUNCTION ONE PATH** (a moved control leaves no copy behind) and **NO SILENT BREAKAGE**.
> This table is the map (todo step 4). **Status: PROPOSAL.** Nothing past instance #1 has moved.
> Hector approves rows → moves ship in small batches (shared component, 15 locales, tests, deploy + purge + live-verify).

**Reference pattern (instance #1, shipped quick-261120-lsheet):** a `SlidersHorizontal` button at the surface's
top-right action corner (`NowPlaying.svelte` `.lyr-set`) opens one bottom sheet (`LyricsSettingsSheet.svelte`) that holds
every control for that surface. Settings keeps no copy.

**Tap math.** A Settings control costs gear (1) + group row (1) + control (1) = **3 taps + scroll**. From Now Playing it
costs **4**, because you have to collapse NP first. A point-of-use sheet costs **2** (corner button + control). TrackMenu
actions cost **2** (⋮ + action).

**Legend.** **MOVE** = has a home surface (named below) · **STAYS** = global, reason given · **DUP** = a working copy
already exists at the point of use, so the other copy goes · **DONE** = instance #1, already moved.

## A. Settings index (`/settings`)

| # | Control | Changes | Felt where | Taps today | Class | Proposal / reason |
|---|---|---|---|---|---|---|
| A1 | App language | `appLang` | every screen | 2 | STAYS | Context-free by definition |
| A2 | Theme | `theme` | every screen | 2 | STAYS | Global |
| A3 | Accent colour | `accent` | every screen | 2 | STAYS | Global |
| A4 | App text size | `fontScaleApp` | every screen | 2 | STAYS | Global |
| A5 | Reduce motion | `reduceMotion` | every screen | 2 | STAYS | Global, and an accessibility setting people expect to find in Settings |
| A6 | Haptics | `haptics` | every tap | 2 | STAYS | Global |
| A7 | Share includes title | `shareIncludeTitle` | TrackMenu → Share | 2 | STAYS (for now) | Share hands straight off to the OS share sheet, so there is no in-app share surface to hold a toggle. Revisit if a share preview sheet is ever built |
| A8 | Car-mode button | `showCarModeButton` | NP / Nowbar button | 2 | STAYS | **Rule: a toggle that HIDES a control can't live on that control**, because once it's hidden there's no way back |
| A9 | Supporter card | sheet | — | 1 | STAYS | Account-like |

## B. Playback (`/settings/playback`)

| # | Control | Changes | Felt where | Taps today | Class | Proposal / reason |
|---|---|---|---|---|---|---|
| B1 | Streaming quality | `defaultQuality` | NP (the quality tag is already shown there) | 4 from NP | **MOVE** | Make the NP quality tag tappable → a small "Playback quality" picker. It is the snake itself |
| B2 | Download quality | `downloadQuality` | TrackMenu → Download | 3 | **MOVE** | Put a "Default quality" row in the existing download picker sheet (the Download long-press / caret / "Download from…") |
| B3 | Default source | `defaultSource` | search results, resolve | 3 | STAYS | Affects search and resolution across the whole app; there's no single surface |
| B4 | Sources (advanced) | `enabledSources` | search fan-out | 4 (`<details>`) | STAYS | Same reason as B3 |
| B5 | Auto-expand on play | `autoExpandOnPlay` | any song tap, any list | 3 | STAYS | Behaviour on every list |
| B6 | Tap → up-next mode | `tapUpnext` | **NP Up Next pane** | 4 from NP | **MOVE** | Add an **Up Next sheet**: a corner button on the Up Next tab (same spot as `.lyr-set`). It also takes B7 |
| B7 | Up-next per context (×N) | `upnextPerContext` | NP Up Next pane | 4 from NP | **MOVE** | Into the same Up Next sheet as B6 |
| B8 | Player swipe L/R | `swipePlayer` | Nowbar / NP cover | 4 from NP | STAYS | A gesture is invisible, so there's no visible spot to anchor a button. Keep it next to B9 so all gesture settings stay in one place |
| B9 | Row swipe L/R | `swipeRow` | every list | 3 | STAYS | Every list |
| B10 | Music videos on/off | `videoEnabled` | NP video stage / row tags | 3 | STAYS | This toggle hides the video surface itself (rule from A8) |
| B11 | Video quality | `videoQuality` | NP video stage | 3 | **DUP** | The `VideoStage` quality menu (`v-qbtn`) already writes the same field at the point of use. **Remove the Settings copy** |

## C. Appearance (`/settings/appearance`)

| # | Control | Changes | Felt where | Taps today | Class | Proposal / reason |
|---|---|---|---|---|---|---|
| C1 | Song-row editor | `rowActions`, title/artist/cover scale | every list | 3 | STAYS | Every list; its live replica preview is the right tool |
| C2 | NP title / artist size | `fontScaleNpTitle/NpArtist` | NP header | 4 from NP | STAYS (open question) | Could move to an NP-header sheet, but NP has no settings corner apart from lyrics. Holding it avoids scattering |
| C3 | Lyrics text size | `fontScaleLyrics` | **NP lyrics pane** | 4 from NP | **MOVE** | Add a "Display" group to the **Lyrics sheet** (instance #1). Split it out of `NpPreviewEditor` |
| C4 | Lyrics anchor | `lyricsAnchor` | NP lyrics pane | 4 from NP | **MOVE** | Lyrics sheet → Display group |
| C5 | Nowbar lyrics line | `nowbarLyrics` | Nowbar | 3 | **MOVE** | Lyrics sheet → Display group ("Also show on the Nowbar"). It's lyrics-scoped, so it belongs with C3 and C4 |
| C6 | Quality tag | `showQualityTag` | NP + rows + home | 3 | STAYS | Shows on many surfaces, and it's a hide-a-thing toggle (rule from A8) |
| C7 | Source tag | `showSourceTag` | NP + rows | 3 | STAYS | Same reason as C6 |

## D. Home (`/settings/home`)

| # | Control | Changes | Felt where | Taps today | Class | Proposal / reason |
|---|---|---|---|---|---|---|
| D1–D12 | Section order / hide / density, chart region + extra regions, genres, classic tags + countries, items per shelf, grid columns, landing tab, tile size, search pill, randomize | `home*` | **Home page only** | 3 (Home gear → Settings → Home) | **MOVE** (whole page as a unit) | The Home header gets a **"Customize home"** button at its action corner that opens the existing editor directly. **Open question for Hector:** is the editor still listed in the Settings index? Option (i): remove it from the index (strict ONE PATH). Option (ii): keep the index row as a pointer to the same single editor (it's the same page, not a copy). Recommendation: **(ii)**. It's one implementation, so nothing can drift, and it can still be found from Settings |

## E. Translation (`/settings/translation`)

| # | Control | Changes | Felt where | Taps today | Class | Proposal / reason |
|---|---|---|---|---|---|---|
| E0 | Lyrics translation, mode, line toggles, dedupe, skip, furigana, offset | `lyrics*`, `translateMode` | NP lyrics | 2 from NP | **DONE** | Instance #1 (quick-261120-lsheet). No copy left in Settings, verified |
| E1 | Chinese script | `zhScript` | every name | 3 | STAYS | Global |
| E2 | Artist / title / bio target + skip | `artistLang/titleLang/bioLang`, `*Skip` | every name | 3 | STAYS | Global. Bio is only felt on the artist page, but it shares the "apply to all" tab, and splitting it would break that |

## F. Data / Downloads / Account / Activity / About

| # | Control | Felt where | Class | Proposal / reason |
|---|---|---|---|---|
| F1 | Backup export / import / undo | — | STAYS | Storage |
| F2 | Re-download missing | Library → Downloads tab | **MOVE** | Belongs in the Library downloads tab, next to the Canon bar (it's the same heal-bar idiom) |
| F3 | Clear picks / name cache / cover cache / reset appearance / clear library | — | STAYS | Storage and reset actions |
| F4 | Clear search history | **Search page**, recent keywords | **DUP** | The Search page's recent-keywords header already has a clear-all (`suggest-clear` → ConfirmModal → `searchHistory.clear()`). **Remove the Settings → Data copy** |
| F5 | Downloads: device import, rules, retag, excluded list | Library → local files | STAYS | File management. Its own page is the right home |
| F6 | Account, sign-in, sync items | — | STAYS | Account |
| F7 | Activity log, About | — | STAYS | Diagnostics and information |

## G. TrackMenu actions (`TrackMenu.svelte`, ⋮ = 2 taps)

TrackMenu actions are per-song **actions**, not settings, so almost all of them are already at their point of use (the
song). Users can already re-order or hide every cell (`customize`).

| # | Action | Class | Note |
|---|---|---|---|
| G1 | Autoplay/remix, Play next, Add to queue, Like, Download (+ from source), Start radio, Versions, Change cover, Edit tags, Add to playlist, Go to artist/album, Share, Details | AT POINT OF USE | Song-scoped. Nothing to move |
| G2 | Fix lyrics | AT POINT OF USE (2 entries, both kept) | Also reachable from the lyrics sheet's Source group. **Not a duplicate:** the menu reaches any song's lyrics from a list row, while the sheet covers the one playing. Both open the same picker (one implementation) |
| G3 | View comments / View related | AT POINT OF USE | Shortcuts into NP tabs, shown only for the current track. Users can hide them |
| G4 | Customize | AT POINT OF USE | Edits the menu from inside the menu |
| G5 | Repeat, Sleep timer | STAYS (decided) | Hector moved these off the NP transport row (quick-260919-0mw, D-08). Sleep timer also shows an indicator on the Nowbar and NP while it's active |
| G6 | Shuffle queue, Clear queue | **MOVE? (needs Hector)** | These act on the queue, so their natural home is the **Up Next sheet** (B6/B7), right beside the queue. That would reverse the ii6 / GLN-5 decisions, so it's only a proposal |

## Proposed batches (after Hector's ✓)

1. **Lyrics sheet "Display" group** (C3, C4, C5): extends an existing sheet. Lowest risk, biggest payoff.
2. **Remove the duplicates**: B11 (Settings `videoQuality` picker) and F4 (Data → Clear search history). Each is a surface-only removal.
3. **Up Next sheet** (B6, B7, plus G6 if approved). New shared sheet on the instance-#1 pattern.
4. **Quality at the snake** (B1 NP tag picker, B2 download-picker default row).
5. **Home "Customize"** (D, option (ii)), **F2** Library re-download.

Count: 9 MOVE rows (+ G6 pending) · 2 DUP · 1 DONE · the rest STAYS. Settings keeps account, language, look, storage,
global behaviour and gestures. Nothing is scattered without a sheet to hold it.
