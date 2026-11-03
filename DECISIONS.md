# DECISIONS.md — one decision, one decider

Phase 0 audit for the behaviour-unification effort (quick-261102-rxf, 2026-11-02).
**Audit only — no behaviour was changed to produce this file.**

Principle: every user-visible decision about a song is made by exactly ONE shared
function/module. Surfaces render the decider's result; they never re-decide. A
parallel implementation of an existing decision is a bug even if it currently agrees.
Where surfaces disagree today, the "winner" named per domain is the product truth;
converging to it is the only intended behaviour change.

Line numbers are against local `main` at `87a43319` (which merged origin's
`ef301bd5` cov1 artist gate and `92ecd601`/`68d8d088` covgate OG identity gate).
They will drift as convergence lands — each domain section is the inventory at audit
time, not a live index.

Status legend per domain: **Decider** = the module that wins, **Consumers to move** =
call sites that must stop deciding locally, **Delete** = code that goes away,
**Persisted** = stored keys whose format changes (need a version bump / migration).

---

## 1. Song identity / matching keys

### Implementations found
Two shared families coexist, plus ~12 local copies.

| Symbol | file:line | Normalizes | Order |
|---|---|---|---|
| `norm` | services/match-key.ts:24 | lowercase, `[（(【\[]…[)）\]】]` drop, ` - remaster/live/acoustic/explicit/feat/ft` dash tail, non-letter/digit strip. **No script fold.** | — |
| `matchKey` | services/match-key.ts:38 | `norm(artist)\|norm(title)` | artist-first |
| `versionedMatchKey` | services/match-key.ts:49 | lowercase + punctuation only (keeps brackets/version tails), no fold | artist-first |
| `foldScript` | services/dedupe.ts:87 | per-character T→S via `t2sConvertLineSync(c)`, gate `\p{Script=Han}` (folds JP kanji too); **cold dict → input unchanged** | — |
| `songKey` | services/dedupe.ts:156 | foldScript + lowercase + brackets + dash tail + own-artist `"<artist> - "` prefix + `stripTranslation` (:106) + punctuation | title-first |
| `titleKey` | dedupe.ts:183 | title half of songKey | — |
| `sameSongKey` / `sameSongStrings` | dedupe.ts:236/245 | songKey equal, OR equal title + `aliasArtist` (script-run subset) | — |
| `sameArtistCredit` | dedupe.ts:277 | artist half equal OR alias OR shared **whole** `splitArtists` segment (never substring) | — |
| `sameSongByCredit` | dedupe.ts:306 | titleKey equal AND sameArtistCredit | — |
| `versionKey` / `isSameShelfSong` | dedupe.ts:373/401 (shifted ~+56 post-merge) | sameSongKey AND same rendition | — |
| `normAlbum` | dedupe.ts:331 | lowercase + punctuation, no brackets, no fold | — |
| `similarity` (in scoreMatch) | services/score-match.ts:156 | `matchKey(foldScript(a), foldScript(t))` — 3rd key form | artist-first |
| `foldedKey` | proxy/jbsou.ts:112 | same as `similarity` (edge) | artist-first |
| `fusionKey` | services/chart-parse.ts:303 | matchKey after cutting ` - …` and `《…` tails, no fold (comment :319 admits) | artist-first |
| `aliasCoverCacheKey` / `aliasArtistCoverCacheKey` | services/cover-cache.ts:153/162 | **whole-line phrase** `t2sConvertLineSync` gated by `isChineseLine`, then matchKey | artist-first |
| `foldArtistName` | services/sync/merge-logic.ts:59 | trim+lowercase+whole-line t2s; **persisted** as tombstone `f:<fold>` | — |
| `componentMatches` / `isStrongMatch` | services/name-rescue.ts:33/48 | norm equality or ≥3-char containment | — |
| `cleanTitle` | name-rescue.ts:57 | own bracket strip; feat tail requires a dot | — |
| `strongFolded` | services/discovery.ts:87 | isStrongMatch after async whole-line t2s | — |
| `canonicalKey` | proxy/musicbrainz-shared.ts:94 | `&amp;`/"and", NFD mark strip, lowercase, punctuation (artist identity) | — |
| `nameRuns`/`sameArtistForm` | services/artist-display.ts:27/44 | script runs, no fold; duplicates `SCRIPT_RUNS` from dedupe.ts:57 | — |

Local copies that re-implement normalization instead of importing:
- dedupe-deezer.ts:25 local `key(t)` — old norm chain, **no foldScript / stripTranslation / prefix**; comment :23 says "mirror it here" but it drifted. Used at :100/:125.
- dedupe-deezer.ts:36 `normField`; deezer-pick.ts:30 `norm` (NFKD).
- discovery.ts:109-110 `foldScript(...).toLowerCase().replace(/\s+/g,'')` + ≥50% char-overlap.
- score-match.ts:376 `artistTokens`; score-context.ts:98 `tokenizeQuery`; song-variant.ts:196 `normQualifier`.
- autocomplete-logic.ts:88/100/115 case-only keys; player.svelte.ts:3979 `playStub` pendingKey and :5494 `episodeKey` (unfolded, bounds the fallback "same song" set); catalog.ts:743 lyric memo; radio.ts:64; search/+page.svelte:314; artist-tiles.ts:78; (app)/+page.svelte:328-330 fav-artist filter; SongRow.svelte:220 album==title.
- kuwo.ts:111 `songTitle` strips ` -《…》` at ingestion only because songKey keeps it.

### Divergences
1. **Fold vs no fold.** songKey folds; matchKey explicitly doesn't (match-key.ts:15). Fallback adopts a 简 row for a 繁 track via sameSongKey (fallback.ts:357), but the same-song checks for covers are matchKey-only (player.svelte.ts:4163, :4789; library.svelte.ts:283) → art lost across exactly the swap those keys exist for. cover-cache.ts:111 comment claims matchKey is "folded" — false.
2. **Three fold algorithms.** Per-character (foldScript) vs whole-line phrase (cover-cache, merge-logic, discovery, cover-backfill, og-cover). 緊急聯絡人 → 紧急联络人 vs 紧急联系人 — different keys for the same input.
3. **Two gates.** `\p{Script=Han}` (folds kanji) vs `isChineseLine` (kana/hangul first, narrower HAN range detect.ts:28).
4. **Key order.** songKey title-first, matchKey artist-first; dedupe-deezer.ts:125 compares its unfolded key against groups dedupeBest merged with the folded key → 繁/简 twin groups not enriched.
5. **feat.** norm/songKey strip only the dash form; name-rescue requires a dot; score-match.ts:380 / dedupe.ts:489 / artist-display.ts:69 strip bare "feat X". Artist side never strips feat in songKey/matchKey.
6. **Translation tail / own-artist prefix** only in songKey. matchKey gates (resolve-edge, catalog lyric, jbsou, radio, similar, cover keys) treat `玻璃 - glass` ≠ `玻璃`.
7. **Artist alias** only in sameSongStrings/sameArtistCredit; songKey equality (groupVariants, dedupeBest, comments, variants.ts:66) and every matchKey site miss `G.E.M.` ≡ `G.E.M.邓紫棋`.
8. **Tail rules in one place each.** `-《…》` cut at kuwo ingestion and fusionKey; plain ` - …` subtitle cut only in fusionKey.
9. **Claimed-same gates differ.** jbsou.ts:21 claims "the same gate resolve-edge and catalog use" but jbsou folds; resolve-edge.ts:107 claims to normalize "IDENTICALLY to the client's dedupe" but uses matchKey, not songKey.
10. **Case-only keys** next to normalized ones; home fav-artist filter (`trim().toLowerCase()`) vs library favKey (`foldArtistName`) → a 周杰倫 entry stored as 周杰伦 drops off the shelf.
11. **Rendition split three ways** (matchKey/songKey drop "(Live)"; versionedMatchKey keeps it; isSameShelfSong = songKey+versionKey). `downloadUidFor` (library.svelte.ts:648, versionedMatchKey) and `downloadFor`/`otherDownloadOf` (:604, isSameShelfSong) disagree for the same pair.
12. **Album** normalized three ways (normAlbum, `matchKey('', album)` in audio-tags.albumTag, case-only in SongRow).

### Winner
`services/dedupe.ts` identity family is the superset and is already edge-safe (imported by proxy/jbsou.ts). Converge to ONE identity module exporting:
- `identityKey(artist, title)` = songKey rules (fold, brackets, dash tail, prefix, translation strip, punctuation) **plus** the feat. tail rule (bare, dotted, bracketed), applied identically to every caller.
- `sameSong(a, b)` = sameSongKey ∪ sameSongByCredit (alias + whole-segment credit).
- `sameArtist(a, b)` = sameArtistCredit (whole segment, never substring — 阿傑 ≠ 阿傑正傳, Jay ≠ Jay Park).
- `renditionKey` = versionKey, for the shelf/download "same file" question.
- one fold: per-character T→S (`foldScript`), moved to zh-convert.ts (see §2), with ONE gate.

### Convergence plan
- `matchKey` becomes `identityKey` (artist-first order kept only if a persisted key needs it; otherwise delete match-key.ts). `versionedMatchKey` → renditionKey.
- Move: dedupe-deezer local key, score-match `similarity`, jbsou `foldedKey`, fusionKey, cover-cache alias keys, foldArtistName, name-rescue cleanTitle/componentMatches, discovery local fold, playStub/episodeKey, home fav filter, autocomplete keys, SongRow album check, catalog lyric gate, resolve-edge gate.
- Delete: match-key.ts (or reduce to re-export), dedupe-deezer `key`/`normField`, the duplicated `SCRIPT_RUNS`/`FEAT_TAIL` copies, kuwo-ingestion tail cut once identityKey owns `-《…》`.
- **Persisted** (version bump or lazy re-key): cover-cache name keys (`openmusic:cover-cache:v1`), name-rescue cache (`openmusic:name-rescue:v1`), edge resolve cache (`RESOLVE_CACHE_VERSION`), og resolve cache key, `similar-<matchKey>` uids, comment-thread hash (songKey → SHA-256), sync tombstones `f:<fold>`, crowd-pick hash `n` (versionedMatchKey).

---

## 2. Script handling (zhs ↔ zht)

### Implementations found
- **Dictionary owner:** services/zh-convert.ts — s2t `buildConvertLine` :46 / `loadConvertLine` :66; t2s `buildT2sConvertLine` :194 / `loadT2sConvertLine` :216; `warmS2T` :93, `warmT2S` :268 (fire-and-forget), `warmScript(target)` :379 (awaitable, never rejects); `isChineseLine` :126.
- **Cold behaviour:** `s2tConvertLineSync` :113 → null; `t2sConvertLineSync` :280 → null; `lockScriptSync` :360 → **input unchanged**; `foldScript` (dedupe.ts:87) → **input unchanged** + triggers warmT2S.
- **Warm sites:** (app)/+layout.svelte:208-211 onMount fire-and-forget (both dicts); +layout:179 awaited before lockAddressBar; names.svelte.ts:379 warmLock, :488 warm(); library.svelte.ts:409 warmFold → healDupes again; comments.ts:33 awaits and **refuses to run cold** (:34) — the only correct matcher; lastfm.ts:304; translate.ts:283.
- **Search keyword building:** **no widening anywhere.** `searchAll` (catalog.ts:95) passes the raw keyword; cache key `keyword.trim().toLowerCase()` (:105) splits 周杰倫/周杰伦 into separate entries and separate upstream queries. No adapter imports zh-convert. Script-aware queries exist only in: discovery.resolveStub t2s retry on miss (:202-208), rescueLatin (:231), cover-backfill coverSearchTerms (:336/:365), og-cover t2s-first (:561-568), lastfm album alternates (:305).
- **Display seam:** names.svelte.ts `dnArtist` :437 / `dnTitle` :457 / `dnLastfm` :472 / `dnBio` :480 → `resolve` :342 → `applyLock` :356; `zhLock` :392; `artistHref` :405; `lockUrl` :417. lyric-script.svelte.ts routes through `names.zhLock`.

### Divergences
1. **Matching before warm.** Boot warm is fire-and-forget, but `library.load()` runs first in the same onMount (+layout:200) → `healDupes` (library.svelte.ts:146) folds cold → 繁/简 twins not merged until the second heal. dedupeBest / sameSongKey / scoreMatch in search, fallback, queue, NpRelated have no warm guarantee. **Persisted while cold:** merge-logic.ts:61 tombstones (`f:周杰倫` cold vs `f:周杰伦` warm).
2. **Edge cold start.** jbsou.ts:113 folds on the edge with a cold isolate → unfolded key (acknowledged :110-111). og-cover awaits async conversion (always warm).
3. Per-character vs whole-line fold split (§1 #2) and gate split (§1 #3).
4. **Search is script-blind** (above). Fallback failover, lyric walk, resolveNameStub all search the failed/stub track's script only.
5. **Two s2t display paths.** names.svelte.ts:288-305 writes s2t results into the persisted `openmusic:name-tr:v2` cache, then `applyLock` runs again on top; translate.ts uses `s2tConvertLines`.
6. **Ad-hoc script conversion outside dn\***: both song pages lazy-import `names.zhLock` for `shownTitle`/`shownArtist` (song/[slug]/+page.svelte:50-51,187; song/[artist]/[title]/+page.svelte:46-47,185) — skips translation and rescue aliases; album tags via zhLock in download-track.ts:509 / player.svelte.ts:1284 but via dnTitle in UI. Raw, unlocked: settings/downloads/+page.svelte:498-499, :524; SyncReviewModal.svelte:37.

### Winner
- **Conversion + warm state:** zh-convert.ts. Add the single identity fold there (`foldForIdentity` = per-character T→S, one gate) and an awaitable `ensureFoldReady()`; foldScript moves out of dedupe.ts.
- **Matching:** always on Simplified-folded identity keys (§1). Any persisted or cache-keyed fold must `await ensureFoldReady()` first (comments.ts:32-34 pattern).
- **Search widening:** `searchAll` builds the keyword set `{q, t2s(q), s2t(q)}` (deduped) and fans out, merging pools; cache key = folded keyword. Invariant: 周杰倫/周杰伦 and 陳奕迅/陈奕迅 return the same pool and same top pick.
- **Display:** names.svelte.ts (`dn*` → `applyLock`) is the only layer converting display script. `zhLock` stays only for URL/href building.

### Convergence plan
- Boot: await `ensureFoldReady()` before `library.load()`'s heal (or make heal await it).
- Move foldScript callers, cover-cache alias keys, merge-logic, discovery, cover-backfill, og-cover onto the one fold.
- Song pages, album tags, SyncReviewModal, settings/downloads lists → `dnTitle`/`dnArtist`.
- **Persisted:** sync tombstones `f:<fold>`, `openmusic:name-tr:v2` (s2t entries written via the fast path).

---

## 3. Playback candidate acceptance

### Implementations found
Shared primitives (services/song-variant.ts): `rankAcceptable` :347 (pools official-plausible → variant-plausible → official-short → variant-short, `poolsInOrder` :305), `findOfficial` :366, `pickOfficial` :380, `candidateTier` :323, `isAcceptableSubstitute` :125, `isOfficialTitle` :208 (bracket qualifier or VARIANT_KEYWORD :150-167 incl. 鈴聲/彩鈴/片段/試聽/環繞), `partitionOfficial` :227, `SHORT_TRACK_SEC = 60` :264, `isImplausiblyShort` :288, `ALLOW_COVER_AS_AUTO_SUBSTITUTE = false` :427, `isAutoAcceptableArtist` :439 → dedupe `sameArtistCredit` :277.

| Path | file:line | Artist gate | Title identity | Variants | Duration | Depth | Verdicts |
|---|---|---|---|---|---|---|---|
| fallback `tryFallback` → `raceSources` → `tryOneSource` | services/fallback.ts:105/222/317 | yes, whole-segment | sameSongKey ∥ sameSongByCredit + isAcceptableSubstitute | demote (tier race) | target `failed.duration` | 3/source, per-candidate continue | ok/empty/rejected/**inconclusive**; one sequential pass over inconclusive (:147-155) |
| catalog `resolveNameStub` | services/catalog.ts:250 | yes (same predicate) | same | rankAcceptable | pool median | 3/source but a throw abandons the whole source (:328-330) | **none** |
| catalog edge-cache adoption + resolve-edge + /api/resolve | catalog.ts:500-547; proxy/resolve-edge.ts:109-112 | **exact norm equality, no fold/duet/alias** | `rows.find(matchKey === want)` (brackets dropped → `X（鈴聲版）` = `X`) | **none** | **none** | first match | DRY cached 900s |
| discovery `resolveStub` → `attempt` → `preferEligible` | services/discovery.ts:200/45/114 | yes (:74, :124) | **isStrongMatch ≥3-char containment / ≥50% char overlap — no sameSongKey** | **dedupeBest BEFORE pickOfficial (:65)** — the ringtone-wins shape | median of collapsed pool | single pick, no resolve walk | none |
| JBSou pipe | services/jbsou-fallback.ts:16; proxy/jbsou.ts:130/238 | **exact folded matchKey** (duet refused) | songid, else folded matchKey, else scoreMatch ≥ 8 | keyword list only (hard reject) | none | one row | ok/nomatch/fail |
| prefetch probe | player.svelte.ts:3613 → :3800 `probePlayable` → :1850 `handleDefinitiveFailure` → tryFallback | inherits fallback | | | | | probe timeout ≠ strike |

### Divergences
1. Five artist rules: whole-segment (fallback/catalog/discovery), exact folded (jbsou.ts:138), exact unfolded (resolve-edge.ts:111), substring ≥2 (og-cover `ogArtistMatches` :432), substring ≥3 (name-rescue.ts:38).
2. **Edge cache overrides the tapped row:** a kuwo/joox `X (Live)` with no qq mid can be silently swapped to qq's studio URL (catalog.ts:500-521) — the only gate is `entryMatchesOwn` (:477) when a qq mid exists.
3. **discovery collapses before ranking** (:65) and its tier-1 expansion check is not artist-gated (:56) → a plain-titled cover by another artist suppresses the kugou/migu fan-out, then gets filtered → null.
4. **discovery's `?? ineligible`** last resort (:118) can auto-pick bilibili/archive/ccmixter/ytmusic.
5. **Inconclusive accounting gaps:** health-gated adapters return `[]` with status ok (joox.ts:259, kuwo.ts:95) → counted `empty` (tried). runFallback pre-adds `failed.source` (player.svelte.ts:5509) — for a name stub that is the placeholder `primarySourceId()` = qq (similar.ts:95,147) → **qq excluded without being tried**. `FALLBACK_BUDGET_MS = 20000` (player:1460) aborts before the inconclusive pass (fallback.ts:140) → struck as timeout. catalog/discovery have no verdicts. `RESOLVE_WATCHDOG_MS = 6000` (player:1435) cuts resolveNameStub short.
6. `searchAll(query, 8, …)` in fallback.ts:329 passes **page 8**, not a limit (kuwo/qq request 80 rows) vs resolveNameStub page 1.
7. Junk variants are demoted, never rejected, by rankAcceptable (a ringtone-only pool still plays as last resort); JBSou hard-rejects by keyword; resolve-edge doesn't look.
8. Comment drift: catalog.ts:245 "KUWO-FIRST" but walk is registry order (qq first).

### Winner
One predicate in song-variant.ts: `acceptCandidate(target, candidate, ctx) → { accept, tier, reason }` = (`sameSongKey` ∥ `sameSongByCredit`) ∧ `isAcceptableSubstitute` ∧ `isAutoAcceptableArtist` (whole-segment), tier from `poolsInOrder` with target duration when known. Plus one shared walker owning `SourceVerdict` (ok / empty / rejected / inconclusive + one sequential exhaustive pass), used by tryFallback AND resolveNameStub. Semantics preserved exactly as the brief states: covers never auto-substituted; duet credits containing the target count as original; junk/qualified/short never beat a clean full version; race-aborted/errored/health-gated = inconclusive.

### Convergence plan
- discovery: drop dedupeBest-before-partition; gate tier-1 expansion and the final pick through acceptCandidate; remove `?? ineligible` non-eligible picks (use `isAutoResolveEligible`).
- resolve-edge + edge-cache adoption + JBSou: replace matchKey/scoreMatch floors with acceptCandidate (edge-safe: song-variant → dedupe → zh-convert).
- Walker: health-gated `[]` reported as inconclusive; name-stub placeholder source not pre-marked attempted; budget expiry runs the inconclusive pass before striking (or the budget is sized for it).
- fallback `searchAll` page arg fixed to 1.

---

## 4. Ranking

### Implementations found
- `rankAcceptable` song-variant.ts:347 — 4-pool tier, input order within pool (no similarity). Callers fallback, catalog.
- `pickOfficial` :380 — first non-empty pool, max scoreMatch. Caller discovery.
- `scoreMatch` services/score-match.ts:464 — similarity + −4 per un-asked VARIANT_KEYWORD (:33-88, a **different list** from song-variant's) − 16 if < 60 s; ctx terms from `computeSetContext` (score-context.ts:110). Callers search `rankList` (search/+page.svelte:412-415), pickOfficial, jbsou.ts:140, catalog lyricFromSource.
- `dedupeBest` dedupe.ts:586 — collapses by bracket-dropping folded key; winner by `better()` (qualityRank > preferredSource > SOURCE_RANK); COVER_PREF swap :613. Callers: search :501/:506/:575, discovery :65, player setQueue :3206 / queueWithAnchor :3216 / offline :5769, NpRelated:94, similar.ts:277/:289, picks.ts:37, artist page :308/:332, cover-backfill :247/:291/:375/:750.
- `dedupeBestWithDeezer` dedupe-deezer.ts:89 (local unfolded key). Caller search :518-522.
- `groupVariants` → `collapseVariants` dedupe.ts (~:337/:403) — **unranked** interleave order. Callers search :70, VersionPicker.svelte:59, variants.ts:104.
- `dedupeShelfList` / `isSameShelfSong` (rendition-aware), `rankByArtistExactness` (artist page).
- Lists: similar.ts Last.fm `match` order then `interleaved[0]`/artist → dedupeBest; NpRelated interleave order; home-charts random-in-rank; chart-parse RRF; charts.ts:192 sort by apple; radio seeded shuffle; picks top-1/artist.

### Divergences
1. Variant detection: rankAcceptable hard tier (bracket qualifier or its keyword list, incl. remaster/伴唱/消音/ktv/DJ版/unplugged); scoreMatch soft −4 from a list lacking those (unlisted `(中四版)`, `(Radio Edit)` = 0 penalty); dedupeBest none.
2. Duration: rankAcceptable < 60 s or < 0.5× expected; scoreMatch < 60 s only; dedupeBest none.
3. Within-tier: registry interleave vs scoreMatch vs SOURCE_RANK.
4. **Collapse before ranking:** search `rankList(dedupeBest(...))` (:506), discovery :65, player queue :3206 (Live + studio in one album queue merge). Shelves use rendition-aware dedupe → queue and shelf disagree on "same song".
5. VersionPicker ("Play from source") shows unranked order; auto-play prefers official/plausible — the picker doesn't reflect the pick.

### Winner
`rankAcceptable` extended into the one comparator: tier (official/variant × plausible/short, target-aware, duration-aware) → scoreMatch similarity → preferredSource → playback source order (§5) → quality. scoreMatch's variant list is replaced by `isOfficialTitle`/bracket qualifier. Dedupe becomes "group by identityKey, head = comparator max" and runs AFTER/inside ranking, never collapsing a clean version into its variants first. Search, auto-pick, VersionPicker, related/similar and chart shelves consume the ranked order (truncate only).

### Convergence plan
- search: `rankList` over the comparator; dedupeBest/dedupeBestWithDeezer become group-heads of the ranked list.
- discovery/pickOfficial, VersionPicker/collapseVariants, NpRelated, similar fallback tiers, picks → comparator.
- Queue dedupe keeps renditions (use `renditionKey`, matching shelves).
- Delete scoreMatch's private VARIANT_KEYWORDS, dedupe-deezer local key, `pickOfficial` once subsumed.

---

## 5. Source priority

### Implementations found
1. registry.ts:74 `SOURCES` literal order (qq, joox, netease, gdnetease, kuwo, suyin, kugou, migu, …) — implicitly drives search fan-out + 200 ms stagger (catalog.ts:44,165-180), `interleave` (:211-232), **resolveNameStub walk**, lyricWalk, similar `sourceLadder` (similar.ts:114) and `primarySourceId` (:95), fallbackOrder base.
2. registry.ts:122 `TIER_1_SOURCES` (qq, joox, kuwo, netease, suyin) — discovery first pass; no kugou/migu.
3. `autoResolveEligible:false` on archive/bilibili/ccmixter/ytmusic (fivesing/jamendo/audius on the floor).
4. fallback.ts:67-72 `PASS_RATE_RANK` → effective joox, kuwo, kugou, qq, netease, gdnetease, migu, fivesing, jamendo, audius, suyin; preferred hoisted.
5. fallback.ts:220-221 `PRIORITY_WINDOW_MS = 300`, degraded 2500.
6. dedupe.ts:40 `SOURCE_RANK` (qq 4 > netease/gdnetease/joox 3 > kuwo/suyin 2 > kugou/migu 1 …) — dedupe winners everywhere.
7. dedupe.ts:613 `COVER_PREF` joox, migu, qq, netease, kuwo.
8. cover-backfill.ts:356-383 race, 300 ms window, `['itunes','joox-migu','qq','deezer','ytmusic']`.
9. cover-backfill.ts:794-801 picker order: own, qq, itunes, deezer, other CN, ytmusic.
10. cover-backfill.ts:532-535 share: itunes → deezer.
11. og-cover.ts (~:761) Last.fm → deezer → itunes → kuwo → deezer original → deezer title-only.
12. resolve-edge.ts:16-28 — edge cache is **qq-only** and adopted first on every cold resolve.
13. catalog.ts:29 `LYRICLESS_SOURCES`.
14. settings/playback/+page.svelte:33-40 preferred-source UI order.
15. jbsou-fallback.ts:14 — JBSou rescue for netease/qq only.
16. Health gates per adapter (`*-health.ts`), no central list.
Stale comments: catalog.ts:245/:259, fallback.ts:28-31 say "kuwo-first".

### Divergences
- Playback target (joox, kuwo, kugou, qq, netease, migu, suyin last): fallbackOrder close; resolveNameStub = registry (qq first, suyin mid); discovery tier-1 lacks kugou/migu and SOURCE_RANK puts qq > joox > kuwo, suyin > kugou/migu; edge cache qq first; search interleave qq first.
- **Two tables drive auto-play and disagree:** PASS_RATE_RANK (joox=kuwo=kugou > qq) vs SOURCE_RANK (qq > joox > kuwo > kugou).
- Cover target (JOOX > Migu > QQ > Netease > Kuwo): COVER_PREF matches; race puts iTunes first; picker QQ first; og-cover has no JOOX/Migu/QQ/Netease tier.
- Two separate 300 ms windows (fallback, cover-backfill).

### Winner
registry.ts owns every order, one table per purpose: `PLAYBACK_ORDER` (joox, kuwo, kugou, qq, netease, gdnetease, migu, …, suyin last), `COVER_ORDER` (joox, migu, qq, netease, kuwo) + `COVER_RACE_TIERS` (iTunes / JOOX / Migu …) + `COVER_PRIORITY_WINDOW_MS = 300`, `SEARCH_FANOUT_ORDER`, eligibility flag. `SOURCES` literal order stops carrying meaning.

### Convergence plan
fallbackOrder, resolveNameStub walk, discovery tier-1, dedupe SOURCE_RANK tie-break, fallback race window → PLAYBACK_ORDER. COVER_PREF, cover race, picker, og-cover tiers → COVER_ORDER/COVER_RACE_TIERS. Search stagger/interleave → SEARCH_FANOUT_ORDER. Delete PASS_RATE_RANK, SOURCE_RANK, COVER_PREF literals, the two window constants, stale comments.
**Open question:** edge resolve cache is qq-only and adopted first — it must either obey PLAYBACK_ORDER (adopt only when qq would be first eligible) or be documented as a deliberate speed exception.

---

## 6. Cover resolution

### Implementations found
- Cache: services/cover-cache.ts (name/uid/artist/itunes/crowd families, TTL 14 d, alias key :153); `getCrowdCover` uses versionedMatchKey (:516) while the auto name layer uses matchKey (:112).
- Reactive read: stores/cover-version.svelte.ts `readCoverByUidOrName` :110-126 = chosen (pin → crowd) → **name → uid** (latest-wins); `readChosenCover` :133; `readCoverByName` :208; `writeCoverBoth` :234 (canonical writer + bump).
- Row ladder: services/row-cover.ts `pickRowCover` :61-78 = chosen → explicit → cached → row-resolved → seeded (unless dead).
- In-app resolver: cover-backfill.ts `resolveTrackChain` :340-432 — parallel race (§5 #8). **No identity gate on any rung** (iTunes `limit=1` top hit itunes-cover.ts:74/:190; Deezer `data[0]` deezer.ts:177-193; CN `tracks.find(joox && cover)` :371; QQ/YTM `dedupeBest[0]`). Header comments still describe a sequential chain.
- `resolveCoverForTrack` :457, `backfillCovers` :554, `backfillArtistCovers` :611 (Deezer track-search `data[0].artist.picture` → iTunes), `resolveShareCover` :517, `collectCoverCandidates` :716.
- lazyCover.ts `resolveCoverForRow` :107-218 — reads **uid first, then name** (:125-126); Netease → iTunes hit passed to `onResolved` without a cache write (:171-173).
- player.svelte.ts: `displayCover` :478-484 (embedded → readCoverByUidOrName → resolvedCover); play() seed :4140-4166 puts **`track.cover` ahead of cache**; Site A :4175-4180 writes the seed (source thumbnail / attached album art) to the shared name layer; restore() seed :725-747 (no bump); `preferItunesOverNetease` :4715-4752 (no cache write; builds MediaMetadata itself); `resolveCoverAsync` :4754; `adoptCover` :4835; `healCover` :4936.
- library.svelte.ts `adoptCover` :254-264 — `setCachedCover` directly, name layer only, **no bump, no uid layer** (bypasses writeCoverBoth).
- OG/edge: routes/api/og/+server.ts (bytes cache → `ci` token → resolve cache keyed by matchKey → `resolveCoverTiered`); proxy/og-cover.ts `resolveCoverTiered` (Last.fm track.getinfo → t2s → Deezer → iTunes → kuwo → Deezer original → Deezer title-only). **Gated since covgate:** `ogArtistMatches` :432 (substring ≥2) / `ogIdentityMatches` :462, scanning 5 results in original + t2s + s2t forms.
- media-artwork.ts `resolveArtworkDataUrl` :154-179 (→ /api/og fallback).

Surfaces: SongRow/CompactRow/NpUpNext/NpRelated/home library tiles → pickRowCover + lazyCover; home discovery tiles → pickRowCover(null, …, readCoverByName) (**no pin/crowd**); home fallback grid → `readChosenCover ?? track.cover` (**no cache**); Nowbar/NowPlaying hero/media session → displayCover; NowPlaying prev/next cells → `readChosenCover ?? resolvedCovers[uid] ?? tk.cover` (**no cache**); NowPlaying share URL → **`player.resolvedCover` only** (:496-505) while TrackMenu share uses displayCover; song pages (both shapes) → `readCoverByUidOrName(seated) ?? og.image` (post-covgate); artist hero → Deezer `pickBestArtistId` / Last.fm ?? pickHeroCover; related-artist avatars, home artist tiles, OG artist → track-search `data[0].artist.picture`; album hero → Deezer `search/album limit=1` (ungated) then seeded onto every queued song and written to each song's name layer via Site A; OG album → track-search `data[0].album.cover`; download embed → displayCover → readCoverByUidOrName → r.cover → /api/og.

### Divergences
1. **In-app chain is ungated; OG is gated** (with substring ≥2 artist rule, not whole-segment). The brief's premise "in-app is gated" does not hold today.
2. Rung order differs per surface (race iTunes-first; OG Last.fm/Deezer-first; picker QQ-first; share iTunes→Deezer; heal iTunes-first; artist Deezer→iTunes).
3. Cache read order: readCoverByUidOrName name-first vs lazyCover uid-first.
4. play()/restore() put the seed ahead of the cache and Site A writes ungated seeds (source thumb, album hero) as "latest" for every surface.
5. Writers invisible to displayCover: preferItunesOverNetease, lazyCover Netease branch, restore heal (no bump). Lock-screen art (iTunes) ≠ hero (Netease).
6. Writer outside writeCoverBoth: library.adoptCover.
7. Readers skipping the shared cache / chosen cover: NowPlaying neighbour cells, home fallback grid, home discovery tiles, chart shelf (`a.image ?? readArtistCover`).
8. Artist image has two chains (hero `pickBestArtistId` vs track-search `data[0]`); album cover two ungated chains.
9. OG identity input is **display text** (native media session, download embed, share pass `dnTitle`/`dnArtist`) → translated "Jay Chou" becomes the resolve key.
10. `NETEASE_PIC_RE` duplicated (player.svelte.ts:63, lazyCover.ts:17).

### Winner
- **Read:** `readCoverByUidOrName` in cover-version.svelte.ts grows into the full ladder (chosen → explicit/attached → name → uid → seed-if-not-dead) and every surface calls it (pickRowCover delegates; displayCover = embedded ?? it). Latest-wins via writeCoverBoth only.
- **Resolve:** `resolveTrackChain`, with ONE identity predicate (§1 `sameSong`/`sameArtist`, whole-segment) applied to every candidate on every rung — the covgate rule moved from og-cover into the shared identity module. `/api/og` renders the same decision (same predicate, same rung table from §5). Miss → branded/gradient fallback, never another song's cover.

### Convergence plan
- Move `ogIdentityMatches` → identity module; og-cover and every cover-backfill rung, backfillArtistCovers, album hero, Last.fm hi-res swap call it.
- Site A / play() / restore() seed: cache-first, and never write an ungated seed to the name layer.
- preferItunesOverNetease, lazyCover Netease branch, restore heal, library.adoptCover → writeCoverBoth.
- NowPlaying neighbour cells, home fallback grid, discovery tiles, chart shelf, NowPlaying share → the one reader.
- OG/media/share requests carry catalog identity (raw artist/title or uid), display text only for the card label.
- Delete duplicated NETEASE_PIC_RE, lazyCover's private read order.

---

## 7. Quality truth

### Implementations found
- **Template:** services/display-quality.ts `withDownloadQuality` :38, `trackQualityLabel` :45, `displayQualityLabel` :55, `trackSourceLabel` :68. library.svelte.ts:630 `qualityForDownload`.
- Uses template: NowPlaying.svelte:473-478 pill; TrackMenu.svelte:1583-1590 detail "Quality" (:2112); VersionPicker.svelte:62-63 (trackQualityLabel, record never merged).
- **Own computation:** TrackMenu.svelte:2117 detail "File" (`localFileMeta` + `formatDownloadMeta`); :2119 detail "Source" = raw `detailTrack.source`; :1337/:1370/:1371/:1833-1868 download cells; :2249-2263 "Download from…" sheet (inline `SOURCES[v.source]?.label`); DownloadControl.svelte:126-134; **home fallback tile `+page.svelte:1248 {track.qualityLabel ?? track.quality}`**; download-probe.ts `formatDownloadMeta` :199 (container > label > container), `localFileMeta` :153; player.svelte.ts:1331-1342 `applyDownloadQuality` (**hand-copied withDownloadQuality**); player :1086-1096 adopt reads quality-before-label.
- Stub claims: lrc.ts:402 `inferQualityFromUrl` (non-lossless ext → "320K", mislabels m4a/128k); per-source vocabularies (FLAC vs LOSSLESS vs HQ/STD vs 320K; ytmusic 128k, suyin 320K hard-coded).
- **Four rankers:** download-upgrade.ts:24 `qualityRank`, download-track.ts:135 `donorRank`, dedupe.ts:42 `qualityRank`, sources/quality.ts:18-22 bands; plus download-track.ts:121 `currentQualityMeets` (strict `=== 'lossless'`).

### Divergences
Home tile ignores record + `showQualityTag`; detail sheet "Quality" vs "File" disagree (stale stub label on an mp3); three precedence orders; raw source id in detail; player duplicate merge; four rankers with different bands; reresolve/fallback blob swaps (player :1019-1027, :4487-4497) skip applyDownloadQuality.

### Winner
display-quality.ts. Extend with `qualityRank(label)` (merging the four rankers + currentQualityMeets), `canonicalQualityLabel` (one vocabulary), and a file-meta formatter taking the record pair. Every surface printing quality/format/size goes through it.

### Convergence plan
Home tile, detail File/Source rows, download cells/sheet, DownloadControl, VersionPicker (merge record for own source), player applyDownloadQuality + blob swaps → display-quality. Delete the four rankers and the player copy.

---

## 8. Display names

### Implementations found
names.svelte.ts `dnArtist` :437, `dnTitle` :457, `zhLock` :392, `applyLock` :356; artist-display.ts `fullestDisplayName` :92-110, `creditSegments`/`primaryCredit`; musicbrainz.ts `pickLocaleName` :118-140 (falls back to **MB canonical** :139); artist-names.ts `resolveArtistNames` :121-145; name-rescue.ts aliases.
Surfaces: SongRow title dnTitle; smart subtitle per-segment dnArtist; default subtitle `dnArtist(track.album || track.artist)` (**album through artist translator**, SongRow:223); Nowbar/MediaSession/doc title/share/TrackMenu whole-string dnArtist; NowPlaying artist line per-segment; artist header `dnArtist(fullestDisplayName(pickLocaleName(...)))` (:122-158, :521); artist share/loading/empty `dnArtist(name)`; artist `<title>` raw `{name} · openmusic` (:496); song pages `zhLock` only; skip toast **raw `track.title`** (player :2138, :2890, :5638 → layout :108); preferItunesOverNetease MediaMetadata **raw** (:4744-4745); SyncReviewModal raw.

### Divergences
Canonical-for-display only rescued on the artist header (via fullestDisplayName); artist page disagrees with itself; song pages skip translation/aliases; per-segment vs whole-string dnArtist give different text (alias map keyed by whole-string norm); raw skip toast / Netease metadata / SyncReviewModal; four different artist-identity normalizers (norm, canonicalKey, sameArtistForm, deezer-pick norm) + dedupe sameArtistCredit + og substring rule; display names leak into resolve identity (§6 #9).

### Winner
names.svelte.ts: one `displayArtist(raw, identityForms?)` / `displayTitle(title, artist)` that folds in `pickLocaleName` + `fullestDisplayName` (fullest credited form wins; canonical never shrinks display) + lock applied once. Artist identity resolution (`resolveArtistNames`) shared. Per-segment vs whole-string decided once inside it.

### Convergence plan
Artist header/share/title, NowPlaying segments, SongRow (album subtitle via dnTitle), song pages, skip toast, Netease metadata, SyncReviewModal, MediaSession → the one derivation. Artist identity predicate = §1 `sameArtist`.

---

## 9. Lyrics selection

### Implementations found
stores/lyric-pins.svelte.ts `readLyrics` :70 (pin → track.lrc → null), `pinLyrics` :76, `unpinLyrics` :82; services/lyric-pins.ts:53 `getPinnedLyrics` (uid-keyed). Chain: catalog.ts:564 own resolve, :578-586 crossSourceLyric, :611-636 lyricWalk, :693 lyricByName, :735-790 collectLyricCandidates; player `backfillLyrics` :1168-1232; enrichFromLocalFile :1351.
Pin wins: NpLyrics:73/109, Nowbar:90/151, TrackMenu gesture write :921-931/:961, MetadataEditor via :2310, settings/downloads:192 (reimplemented `getPinnedLyrics(d.uid) ?? d.lrc`).
**Pin ignored:** Track Detail TrackMenu:2128-2130; fresh-download embed download-track.ts:512 (+ donor :302); automatic embed player :1262-1290 (backfillLyrics doesn't short-circuit on a pin).

### Divergences
Pin loses on three surfaces; pin keyed by track uid while download/retag paths key by record uid (twin miss); "Use automatic" leaves the pinned lyrics in the file and enrichFromLocalFile can resurrect them; local lyric offset keyed by uid only (applies a chain-tuned offset to the pinned LRC) while shared offset is keyed by uid+lrc.

### Winner
`readLyrics` (record-uid aware: pin by uid OR download twin). Every surface — NowPlaying, Track Detail, download embed, auto embed, retag — reads it. Offset keyed by (uid, lrc hash).

---

## 10. Queue / Up Next semantics

### Implementations found
Primitives (player.svelte.ts): `setQueue` :3191 (anchor = current even if current not in list), `setListQueue` :3245 (anchors current via `queueWithAnchor`), `postPlayQueue` :4651, `playStub` :3972, `spliceAndPlay` :3335; defaults config/defaults.ts:183 `QueueContext`, :211 `UPNEXT_DEFAULTS`; settings.svelte.ts:784 `effectiveUpnextMode`. Window: NowPlaying.svelte:379-385 `upNextStart = anchorIdx>=0 ? anchorIdx : ci>=0 ? ci : 0` (only window computation). Re-seat: only `reorderQueue` :5800.
List surfaces (install method): home discovery tiles / charts top,tags,countries,shelf / search suggestion → `playStub` [tr] only; home fallback grid → setQueue + play; home fallback refresh/mount → setQueue with no play (R/+page :917, :1168); home liked/downloads/history/playlist shelves → play(context) **no install**; home radio / RadioList → playStub → setListQueue; search rows → setListQueue + play; library → playList (setListQueue + play); album → playStub → setListQueue (stale-tap guarded); artist → setListQueue + play; discography pack → setQueue([first]) + **non-fresh** play + late setQueue; packs / songs-of-year → playStub → setListQueue (unguarded); share/song page → spliceAndPlay/armTrack; TrackMenu radio → playStub → setListQueue (no sameList); remix → setQueue; version pick → play(fresh) no context.

### Divergences
1. **`playNext` can hide current** (spliceAfterCurrent :3285 moves the anchor row after current, no re-seat).
2. **`prev()` can hide current** (:5462 never re-seats; anchor == current with predecessors arises from restore, late list install, `albumQueue(index)`), also coverSwipe prev.
3. `setQueue` doesn't guarantee membership → home fallback mount/refresh and discography late install can drop the playing song out of the window.
4. Discography is the only non-fresh start (no history weave, Play-next pins lost).
5. Two install orders (install-before-play vs play-then-install, the latter racing postPlayQueue).
6. Stale-tap guard only on album rows.
7. Same `home-discovery` context, different sourcing; Home shelves never install a list while Library does for the same contexts.
8. Radio list discarded under defaults (regenerate replaces it).

### Winner
- **Window:** a store-derived `upNextWindowStart = min(anchorIdx, ci)` (when both ≥ 0) in player.svelte.ts; NowPlaying reads it. A reorder/playNext/prev/setQueue/restore can never hide current by construction.
- **Sourcing:** one `player.startList(list, seed, ctx, { sameList, cover })` owning resolve, install order, stale-tap guard and membership; `setQueue` private or always anchors current. Per-context defaults stay in UPNEXT_DEFAULTS.

---

## 11. Download truth

### Implementations found
library.svelte.ts: `isDownloaded(uid)` :586 (exact uid), `addDownload` :589 (isSameShelfSong), `otherDownloadOf` :603, `qualityForDownload` :630, `downloadUidFor` :645 (versionedMatchKey), `isUnavailable` :661. Consumers: RowBadges:42-50 (via download-state.ts), DownloadControl:91-98, TrackMenu :1043/:1597/:1623/:1833, library page, home shelf, player :772/:913/:1019/:4218/:4487 (downloadUidFor → blobStore.get), :5764 buildOfflineQueue.
**Direct blob/FS derivation:** TrackMenu :1270-1290 `blobPresent = blobStore.has(track.uid)` (drives Downloaded cell, probes, Edit-tags, tag write), :1461 `blobStore.stat`; download-probe.ts:163; download-track.ts:220-221; download-album.ts:168-176 (`sameSongKey` without versionKey — live matches studio); settings/downloads:154-156; settings/data:121/141-142; device-import.svelte.ts:199-205; player :1102 adopt (exact uid).

### Divergences
Five "same song" identities (exact uid, versionedMatchKey, isSameShelfSong, sameSongKey, blob exact uid); rows/menus say "not downloaded" for a twin the player plays offline; radio/remix/detail fast paths exact-uid; TrackMenu trusts the blob, everything else trusts the list; offline queue includes records with no blob / unavailable.

### Winner
library.svelte.ts: one `downloadFor(track) → { uid, record, hasFile }` built on renditionKey (§1) + a reactive blob-presence cache. Every row, badge, menu, the player and the settings pages consume it.

---

## 12. Gestures

### Implementations found
Shared: src/lib/gestures/springSnap.ts:58 `createSpringSnap` (reduceMotion → instant; discards release velocity :93). Reference implementations meeting all rules: actions/chipReorder.ts (quick-261102-chipflip) and TrackMenu.svelte:264-480 (quick-261102-menudrag).

| Gesture | file | Violations |
|---|---|---|
| chipReorder | actions/chipReorder.ts:79 | none |
| TrackMenu edit grid | TrackMenu.svelte:255-580 | none |
| swipeAction | actions/swipeAction.ts:50 | cancel/lost/blur → `up()` commits (229-231, 106-109, 224); commit at release not settle (209-210) — NpUpNext removes the row mid-spring |
| swipeRemove | actions/swipeRemove.ts:38 | same; **unused** (only test + comments) |
| coverSwipe | actions/coverSwipe.ts:43 | commit at release + CSS transition settle; pointercancel commits; no lostpointercapture/blur/buttons==0; bare setPointerCapture :189 |
| dragClose | actions/dragClose.ts:37 | pointercancel can dismiss; no lost/blur; bare setPointerCapture :109 |
| dragReorder | actions/dragReorder.ts:63 | no follow at all, no glide/spring; pointercancel commits with cancel coords |
| scrub | actions/scrub.ts:27 | pointercancel commits seek; no lostpointercapture (stuck preview) |
| NpUpNext grip | NpUpNext.svelte:156-177 | no sibling glide; commit at release (teleport); pointercancel commits; bare capture :162 |
| NowPlaying collapse | NowPlaying.svelte:608-674 | CSS curve not springSnap; commit at release; pointercancel collapses; bare capture :629 |
| NowPlaying sheet | NowPlaying.svelte:817-909 | CSS + setTimeout(290) commit; pointercancel commits; bare capture :835 |
| RowActionsConfig | RowActionsConfig.svelte:146-178 | no glide; teleport commit; pointercancel commits; bare capture :154 (never ported to menudrag) |
| VideoStage seek | VideoStage.svelte:308-312 | **mutates audio mid-drag** (`seekFraction` on input); no pointercancel |
| dragScroll / rubberOverscroll / longpress / tapBounce | — | compliant or N/A by design |

### Winner
A shared `createDragSession` in src/lib/gestures/ generalized from chipReorder.ts:98-200: guarded capture + window net + buttons==0; `onUp` vs `onCancel` separation; 1:1 transform with transition none; springSnap per axis; `onCommit` fired from settle. Every action/component supplies geometry + commit only. Delete swipeRemove.

---

## 13. Failure vocabulary

### Implementations found
Channels: `player.notice` (player.svelte.ts:262; `'skip'` batched by `emitSkipNotice` :5722 with `SKIP_BURST_WINDOW_MS` 2500; `'stopped'` loop-guard/offline/up-next-dry; `'corrupt-download'`), rendered by (app)/+layout.svelte:74-122; `player.error` (inline at Nowbar:356, NowPlaying:1231); caller `toast.show` after playStub misses.
Paths: `handleTotalFailure` :5614 (skip + batched toast, `SYSTEMIC_SKIP_CAP` 5 → halt); `runFallback` :5497 (budget expiry :5560-5565 **silent skip, not counted**); `play()` catch :4560 (**stop, raw `e.message`**); device-missing :4234 (error + skip toast — double channel); audio error ceiling :2851 (skip, counted); bg-error-skip :3013 (silent by design, not counted); `!failed` :3106 (**inline stop, no notice**); stall watchdog :2121 (skip toast, **not counted**); `haltRunawayRecovery` :5654 (systemic stop + Retry); `handleDryGrow` :5414 (exhaustion stop, same `toast.playbackStopped` text as systemic); `handleOffline` :5767 (separate, correct).
Caller toasts on tap misses: `home.unplayable` (~25 sites: home, RadioList, TrackMenu, SongRow, search, every chart page, every pack page, songs-of-year, discography) and `album.unplayable` (album page ×8) — identical text, different keys, no title; `toast.noAudio*`, `toast.radioEmpty`.

### Divergences
List starts (pack/album/discography/songs-of-year Play) abort on track 0 instead of skipping to list[1]; play() catch stops with untranslatable text; `!failed` stops non-systemically; silent skips; systemic cap counts only some skip paths (a run of timeouts never trips it); `consecutiveFailures` write-only, `FAILURE_CAP` doc stale; batched toast `"{count} songs skipped — {reason}"` drops names; exhaustion and systemic share wording; duplicated toast gate `tr === null && player.pendingTrack == null` (~20 copies, album swipe/menu ungated).

### Winner
One private `Player.reportFailure(track, kind: 'skip' | 'systemic' | 'exhausted' | 'offline', reason)` owning recordSkip, strike, `failoverSkips` (every audible skip counts), the batched skip notice (names kept), and distinct stop notices for exhausted vs systemic. playStub/list-start misses route through it (skip to next stub, one notice) instead of caller toasts.

---

## 14. Settings honoured

### Bypasses found
- **showQualityTag:** home fallback tile pill `+page.svelte:1248` ignores it.
- **showSourceTag:** only NowPlaying honours it (no single gate).
- **reduceMotion:** only sets `:root[data-reduce-motion]` CSS (app.css:154-159); Svelte transitions run via WAAPI and ignore it — NowPlaying.svelte:1020 fly, TrackMenu ×7, ConfirmModal, ToastHost, SupporterSheet, SleepTimerSheet, SyncReviewModal, VersionPicker, MetadataEditor, (app)/+layout:455, library:577, album:881. JS smooth scrolls NpLyrics:338, NpUpNext:217. ShelfChevrons:76 reads only the OS query.
- **defaultQuality/downloadQuality:** catalog.ts:564 passes the raw pref, not the effective `tier` (:445) → gdnetease always 320 (gdnetease.ts:128); many adapters ignore the pref; download-track.ts:122 `currentQualityMeets` treats 'auto' as met while `donorMatchesTier` (:148) applies effectiveQuality — two deciders in one file.
- **zhScript/names:** SyncReviewModal:37, settings/downloads:524, TrackMenu:2119 raw.
- **lyricsLang/lyricsSkip:** Nowbar line never applies the machine translation; hide-paren filters differ between Nowbar and NpLyrics.
- **lastfmSkip:** read but no settings UI.
- **enabledSources:** cover-backfill.ts:296/:753 call `SOURCES.qq` regardless of enablement.

### Winner
- Quality: `sources/quality.ts effectiveQuality`, resolved once in `catalog.ensureTrackDetails`; adapters and currentQualityMeets receive `tier`.
- Motion: one `motionMs(ms)` / `reducedMotion()` (app flag OR OS query) in the settings store used by every `transition:` param, JS scroll behaviour and ShelfChevrons.
- Tag visibility: gate inside the display-quality consumer layer.
- Names/script: §8. Lyrics translation: one lyric-line derivation shared by NpLyrics and Nowbar. Sources: every adapter access via `getEnabledAdapters`.

---

## Execution order (Phase 1–3)

Dependencies drive the order: identity and script are consumed by acceptance, ranking, cover and download.

1. §2 script (fold owner + warm contract + search widening) → 2. §1 identity → 3. §5 source priority → 4. §3 acceptance → 5. §4 ranking → 6. §6 cover → 7. §8 display names → 8. §7 quality → 9. §11 download → 10. §9 lyrics → 11. §10 queue → 12. §13 failure → 13. §12 gestures → 14. §14 settings sweep.

Per domain: characterization tests on the golden fixtures first (pin today's behaviour, so the change is a visible diff), then one commit converging consumers + deleting the parallel code, suite green and svelte-check 0 after each.

Golden fixtures → domains:
| Fixture | Domains |
|---|---|
| 說了再見 / 周杰倫 (cover substitution) | 3, 4 |
| Without You (Explicit) / 高爾宣 OSN (wrong cover) | 1, 6 |
| 最後一次 / 高爾宣 OSN (quality label) | 7 |
| 別問很可怕 / J.Sheon (false unplayable) | 3 |
| 偏偏喜歡你 / 陳百強 (ringtone variant) | 3, 4 |
| sunkis 宋秉勤 (display name) | 8 |
| duet credit (target inside multi-artist credit) | 1, 3 |
| 周杰倫/周杰伦, 陳奕迅/陈奕迅 | 1, 2, 4 |

Phase 3 invariant suite (permanent): same song ⇒ same cover URL on row, now bar, song page and OG card; same pool ⇒ same top pick in search, auto-play and VersionPicker; 繁/簡 queries ⇒ same pool; covers-only pool ⇒ song skipped, never substituted; duet credit ⇒ accepted as original; a reorder ⇒ current song still visible in Up Next.

## Open questions (need a product call before converging)
1. **Edge resolve cache (qq-only, adopted first):** obey PLAYBACK_ORDER, or keep as a documented speed exception? (§5)
2. **Junk-only pools:** brief says junk "never beats a clean full version" — today a ringtone-only pool still auto-plays as last resort. Keep (demote) or reject (skip)? Plan assumes keep. (§3)
3. **OG artist rule:** covgate uses substring ≥2; the identity module uses whole-segment. Plan converges OG to whole-segment (stricter: may turn some current OG hits into branded fallback). (§6)
4. **Search widening cost:** fanning out up to 3 keyword variants triples upstream search calls for mixed-script queries; plan dedupes variants (most queries yield 1–2) and keeps the apiFetch governor in charge.
