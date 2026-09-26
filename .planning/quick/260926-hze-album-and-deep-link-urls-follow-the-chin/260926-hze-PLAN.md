---
phase: quick-260926-hze
plan: 01
type: execute
wave: 1
depends_on: []
files_modified:
  - src/lib/services/entity-href.ts
  - src/lib/services/entity-href.test.ts
  - src/lib/stores/names.svelte.ts
  - src/lib/stores/names.test.ts
  - src/lib/services/lastfm.ts
  - src/lib/services/lastfm.test.ts
  - src/lib/stores/library.svelte.ts
  - src/lib/stores/library.svelte.test.ts
  - src/routes/(app)/artist/[name]/+page.svelte
  - src/routes/(app)/artist/[name]/albums/+page.svelte
  - src/routes/(app)/+page.svelte
  - src/routes/(app)/album/[artist]/[name]/+page.svelte
  - src/routes/(app)/+layout.svelte
  - src/lib/services/url-tab.ts
  - src/lib/services/url-tab.test.ts
  - src/routes/(app)/charts/top/+page.svelte
autonomous: true
requirements: [quick-260926-hze]

must_haves:
  truths:
    - "Lock = Traditional: tapping an album on the artist page, the artist albums page, or any of the 3 home chart-album surfaces lands on /album/{Traditional title}?artist={Traditional artist}[&dzid|&mbid], with the title AND artist in the locked script"
    - "Lock = Simplified: the same taps land on the Simplified title/artist"
    - "Lock OFF: every album href is byte-identical to today (names.lockUrl returns the input string itself)"
    - "A reloaded locked album URL still loads its tracklist, including Last.fm-only chart albums: getAlbumTracklist('範特西','周杰倫') returns the 范特西 tracklist, and getAlbumTracklist('十一月的萧邦','周杰伦') returns the 十一月的蕭邦 tracklist"
    - "Typed, received, or history links in the other script (/artist/周杰伦, /album/范特西?artist=周杰伦, /song/…) are rewritten in the address bar to the locked script, without a refetch, a new history entry, or a rewrite of an overlay sentinel entry"
    - "A tab switch on /artist/{name}/albums or /charts/top after that rewrite keeps the locked name in the URL (syncTabUrl builds from the live address bar)"
    - "Lock OFF: a favourite saved as 周杰倫 shows a filled heart on /artist/周杰伦 once the t2s fold dict lands, and no Chinese favourite means the dict is never downloaded"
    - "Non-entity URLs (/library, /search?q=…, /settings/*) and non-Chinese names are never touched"
  artifacts:
    - path: "src/lib/services/entity-href.ts"
      provides: "lockEntityHref(href, lock): pure, same-app /artist|/album|/song href script locker"
      exports: ["lockEntityHref"]
    - path: "src/lib/services/entity-href.test.ts"
      provides: "fake-lock unit cases + real lockScriptSync round trip"
    - path: "src/lib/stores/names.svelte.ts"
      provides: "names.lockUrl(href)"
      contains: "lockUrl(href: string): string"
    - path: "src/lib/services/lastfm.ts"
      provides: "getAlbumTracklist Chinese-title script rescue"
      contains: "lockScriptSync"
    - path: "src/lib/stores/library.svelte.ts"
      provides: "self-warming script fold for favourite artists (foldRev + foldWarmed)"
      contains: "foldRev"
    - path: "src/routes/(app)/+layout.svelte"
      provides: "afterNavigate address-bar rewrite (lockAddressBar)"
      contains: "afterNavigate"
    - path: "src/lib/services/url-tab.ts"
      provides: "syncTabUrl(param, value, defaultValue) built from the live address bar"
      contains: "location.href"
  key_links:
    - from: "src/lib/stores/names.svelte.ts"
      to: "src/lib/services/entity-href.ts"
      via: "lockUrl → lockEntityHref(href, (s) => this.zhLock(s))"
      pattern: "lockEntityHref\\(href"
    - from: "src/routes/(app)/+page.svelte"
      to: "names.lockUrl"
      via: "goto(names.lockUrl(chartAlbumHref(a))) ×3"
      pattern: "names\\.lockUrl\\(chartAlbumHref"
    - from: "src/routes/(app)/+layout.svelte"
      to: "history.replaceState"
      via: "afterNavigate → lockAddressBar → names.lockUrl(location.pathname + location.search)"
      pattern: "names\\.lockUrl\\("
    - from: "src/lib/services/lastfm.ts"
      to: "src/lib/services/zh-convert.ts"
      via: "warmScript('zh-Hant') + lockScriptSync alternatives on a Chinese-title miss"
      pattern: "warmScript\\('zh-Hant'\\)"
    - from: "src/lib/stores/library.svelte.ts"
      to: "src/lib/services/zh-convert.ts"
      via: "warmScript('zh-Hans').then(() => this.foldRev++)"
      pattern: "foldRev\\+\\+"
---

<objective>
Finish "every URL follows the Chinese script lock", the follow-up to quick-260926-hl9, which only locked in-app /artist/ links. This task closes the four gaps hl9 left: (1) album TITLES in /album/ URLs, (2) home-page chart album links, (3) typed, received, or history links in the other script, and (4) with the lock OFF, a favourite artist saved in the other script is not matched until the t2s dict happens to be warm.

The model:
- The URL shows the locked script, and on reload it is the resolution key. So every resolver must accept either script.
- In-app builders emit locked URLs directly (no extra fetch). One address-bar rewrite catches everything else.

Output:
- a pure `lockEntityHref` plus `names.lockUrl`
- a Last.fm album-title rescue
- a self-warming favourite fold
- 6 album-link call sites wrapped
- an afterNavigate address-bar rewrite
- `syncTabUrl` reading the live address bar
</objective>

<execution_context>
@/Users/laichan/.claude/plugins/cache/gsd-plugin/gsd/4.5.3/workflows/execute-plan.md
@/Users/laichan/.claude/plugins/cache/gsd-plugin/gsd/4.5.3/templates/summary.md
</execution_context>

<context>
@./CLAUDE.md
@.planning/STATE.md
@.planning/quick/260926-hl9-artist-urls-follow-the-chinese-script-lo/260926-hl9-SUMMARY.md

House rules: tabs, single quotes in TS (not i18n), high comment density tagged `quick-260926-hze`, keep every existing decision-ref comment, pure `.ts` vs runes `.svelte.ts`, never-throw services, zero `as any` in production source.

Git: commit on the CURRENT branch `claude/festive-kapitsa-dac746`. Never push. Never touch main. Something auto-pushes main, so stay off it.

grep here is ugrep and has returned false-empty results before. Cross-check every "0 matches" gate with `sed -n` or Read before trusting it. Prefer `grep -F` (fixed strings) for the gates below.

<verified_findings>
Probed against real upstreams. Do NOT re-investigate:
- Script-BLIND (same result in either script): searchAll, Last.fm artist, Last.fm album lookup when only the ARTIST's script varies, deezerAlbum(title, artist), and MusicBrainz / Deezer by id.
- NOT script-blind: the Last.fm album TITLE.
  - getAlbumTracklist('范特西','周杰伦') = 10 tracks; ('範特西','周杰倫') = 0.
  - getAlbumTracklist('十一月的萧邦','周杰伦') = 0; ('十一月的蕭邦','周杰倫') = 12.
  - Last.fm keeps ONE canonical title per album, sometimes Simplified, sometimes Traditional.
  - Chart albums (no dzid/mbid) resolve ONLY through this path.
- SvelteKit shallow routing (`$app/navigation` replaceState/pushState) is BANNED here (see url-tab.ts and overlays.svelte.ts). It desyncs the router index and makes a later goto() a silent no-op.
  - The house idiom is RAW `history.replaceState(history.state, '', href)`. It updates the address bar only. `page.url` / `page.params` stay as navigated, so no component re-runs and nothing refetches.
</verified_findings>

<interfaces>
<!-- Extracted from the codebase. Use directly, no exploration needed. -->

src/lib/services/zh-convert.ts:
- `export type ZhScript = 'zh-Hant' | 'zh-Hans'`
- `export function isChineseLine(text: string): boolean`
- `export function lockScriptSync(text: string, target: ZhScript): string`. Never throws. Identity while cold. zh-Hant is idempotent on already-Traditional input (bxg).
- `export async function warmScript(target: ZhScript): Promise<void>`. Memoized builds, never rejects. 'zh-Hant' builds BOTH s2t and t2s; 'zh-Hans' builds t2s only.
- `export function t2sConvertLineSync(text: string): string | null`

src/lib/stores/names.svelte.ts (class Names, singleton `names`):
- `zhLock(text: string): string` (line ~360). Script lock only, reactive through `rev` + `settings.zhScript`. 'off' returns the input byte-for-byte.
- `artistHref(name: string): string` (line ~373). KEEP AS IS.
- Existing imports (line 43): `isChineseLine, s2tConvertLineSync, warmS2T, lockScriptSync, warmScript, type ZhScript` from `$lib/services/zh-convert`.

src/lib/services/lastfm.ts:
- `async function fetchInfo(params: Record<string, string>): Promise<LastfmInfo>` (line ~64). Cached 6h per sorted-param key through `cached()`. Resolves `{}` on any failure.
- `export async function getAlbumTracklist(album: string, artist: string): Promise<{ artist: string; title: string }[]>` (line ~284). Currently one fetchInfo call with `{ method: 'album.getinfo', album, artist }`.
- Imports use RELATIVE siblings (`./ttl-cache`, `./api-base`). Follow that file-local style: `./zh-convert`.

src/lib/services/discography.ts:111 `albumHref(entry, artistName)` → `'/album/' + enc(entry.name) + '?artist=' + enc(artistName) [+ '&mbid=…' | '&dzid=…']`. PURE, leave unchanged.
src/lib/services/home-charts.ts:136 `chartAlbumHref(album)` → albumHref with id/mbid null. PURE, leave unchanged.

src/lib/services/url-tab.ts:
- `tabHref(url: URL, param, value, defaultValue): string`. Pure. UNCHANGED. The library page still calls it with page.url plus goto.
- `syncTabUrl(url: URL, param, value, defaultValue): void` (line ~61). Browser-guarded, try/catch, raw history.replaceState.
- Callers of syncTabUrl (all pass `page.url` first):
  - charts/top/+page.svelte:210 `syncTabUrl(page.url, 'tab', 'tracks', 'tracks')`
  - charts/top/+page.svelte:218 `syncTabUrl(page.url, 'tab', 'artists', 'tracks')`
  - artist/[name]/albums/+page.svelte:88 `syncTabUrl(page.url, 'tab', f.id, 'main')`
- url-tab.test.ts:77 calls `syncTabUrl(u('https://x/library'), 'tab', 'history', 'liked')`.

src/lib/stores/overlays.svelte.ts:73 pushes raw sentinel entries with `history.pushState({ gsdOverlay: id }, '')`.

src/lib/stores/library.svelte.ts (class Library, singleton `library`):
- `favArtists = $state<string[]>([])` (line 38).
- `load()` (line 63): `if (this.loaded || !browser) return;`, then a try/catch hydrates from `openmusic:library:v1`, including favArtists.
- `private favKey(name)` (line ~217): carries the hl9 `ponytail:` comment. It is trim + lowercase, then `t2sConvertLineSync` when `isChineseLine`.
- `isFavArtist(name)` and `toggleFavArtist(name)` (lines ~225-237).
- Existing zh import (line 9): `isChineseLine, t2sConvertLineSync` from `$lib/services/zh-convert`.

Album-link call sites (all `goto(...)`):
- artist/[name]/+page.svelte:542 `goto(albumHref(al, name))`
- artist/[name]/albums/+page.svelte:106 `goto(albumHref(al, name))`
- (app)/+page.svelte:1502, 1509, 1523 `goto(chartAlbumHref(a))`. `names` is already imported at line 89.
- album/[artist]/[name]/+page.svelte:35-44 onMount builds `target` and calls `void goto(target, { replaceState: true })`. Its SSR-SAFETY comment (Pitfall 4) forbids a module-top STORE import.
- artist/[name]/+page.svelte:156 `const favArtist = $derived(library.isFavArtist(names.zhLock(name)));` (the hl9 heart).

src/routes/(app)/+layout.svelte:
- line 5 `import { goto } from '$app/navigation';`
- `names`, `settings`, `library` are imported.
- onMount (line ~157) calls `library.load(); settings.load(); names.warm();`.
</interfaces>
</context>

<tasks>

<task type="auto" tdd="true">
  <name>Task 1: lockEntityHref + names.lockUrl + Last.fm album-title rescue</name>
  <files>src/lib/services/entity-href.ts, src/lib/services/entity-href.test.ts, src/lib/stores/names.svelte.ts, src/lib/stores/names.test.ts, src/lib/services/lastfm.ts, src/lib/services/lastfm.test.ts</files>
  <behavior>
    entity-href.test.ts, with fake lock `(s) => s.replaceAll('伦', '倫')` (idempotent) and `enc = encodeURIComponent`:
    - '/artist/' + enc('周杰伦') → '/artist/' + enc('周杰倫')
    - '/artist/' + enc('周杰伦') + '/albums?tab=single' → '/artist/' + enc('周杰倫') + '/albums?tab=single'
    - '/album/' + enc('伦敦') + '?artist=' + enc('周杰伦') + '&dzid=123' → '/album/' + enc('倫敦') + '?artist=' + enc('周杰倫') + '&dzid=123' (dzid kept, order kept)
    - '/song/周杰伦/晴-天' (raw CJK, share grammar '-' = space) → '/song/' + enc('周杰倫') + '/晴-天' (the unchanged segment stays byte-for-byte raw)
    - hash kept: '/artist/' + enc('周杰伦') + '#top' → '/artist/' + enc('周杰倫') + '#top'
    - non-entity inputs are returned identical (toBe): '/library?tab=fav-artists', '/search?q=' + enc('周杰伦'), '//evil.example/artist/x', '/artists/x'
    - malformed '/artist/%E5' → returned unchanged, no throw
    - identity lock (lock 'off') on an entity href → returns the SAME string (toBe)
    - idempotence: lockEntityHref(lockEntityHref(h, fake), fake) === lockEntityHref(h, fake) for each entity case above
    - real round trip: after `await warmScript('zh-Hant')`, with lock `(s) => lockScriptSync(s, 'zh-Hant')`, '/album/' + enc('范特西') + '?artist=' + enc('周杰伦') → '/album/' + enc('範特西') + '?artist=' + enc('周杰倫'); with the 'zh-Hans' lock (after warmScript('zh-Hans')) the Traditional href goes back to Simplified
    names.test.ts, new describe 'names.lockUrl (quick-260926-hze)', reusing the hl9 artistHref describe's `settingsMock` + `warmLock` pattern:
    - zh-Hant: lockUrl('/album/' + enc('范特西') + '?artist=' + enc('周杰伦') + '&dzid=1') → '/album/' + enc('範特西') + '?artist=' + enc('周杰倫') + '&dzid=1'
    - 'off': the same input is returned toBe-identical
    lastfm.test.ts, new describe 'quick-260926-hze getAlbumTracklist script rescue'. The stubbed fetch reads `new URL(String(input), 'http://x').searchParams.get('album')` and returns `{ tracks: [...] }` only for the HIT title, `{}` otherwise; it counts calls:
    - Traditional miss → Simplified hit: getAlbumTracklist('範特西','周杰倫') returns the tracks; the 2nd call's album param is '范特西'
    - Simplified miss → Traditional hit: getAlbumTracklist('十一月的萧邦','周杰伦') returns the tracks; the hit call's album param is '十一月的蕭邦'
    - non-Chinese miss ('Parachutes','Coldplay') → [] after exactly ONE fetch call
    - first-lookup hit ('范特西' is the HIT) → exactly ONE fetch call
    - Chinese miss in every script → [] and never throws
  </behavior>
  <action>
RED first. Write entity-href.test.ts, the new names.test.ts describe, and the new lastfm.test.ts describe. Run them and confirm they fail (the module and method are missing, and the rescue is absent). Commit `test(quick-260926-hze): …`.

GREEN, in three files.

(a) Create `src/lib/services/entity-href.ts`, per locked decision 1. It is PURE and has no imports: the lock function is injected, so node tests can pass a fake and the module stays dependency-free. Export `lockEntityHref(href: string, lock: (s: string) => string): string`. Behaviour:
- If `href` does not match the anchored `^/(artist|album|song)/`, return `href` unchanged. The anchor also rejects '//host/…' protocol-relative input (T-hze-01).
- Split OFF the hash at the first '#', then the query at the first '?'. Do this by hand with indexOf/slice, NOT the URL parser: the URL parser would re-encode raw CJK and normalise dot segments, and unchanged segments must survive byte-for-byte.
- Split the path on '/'. For every segment AFTER the route word (index >= 2), decodeURIComponent it and run `lock`. If the result differs from the decoded text, replace the segment with `encodeURIComponent(locked)`; otherwise keep the ORIGINAL raw segment text. This keeps raw-CJK share paths, '-' spaces and 'albums' intact.
- Query: only when a query exists, parse it with URLSearchParams and lock ONLY the `artist` param, the one name-bearing param. If it changed, `params.set('artist', locked)` (set keeps position) and use `params.toString()` as the new query. Otherwise keep the original query text.
- Track a single `changed` flag. When nothing changed, return the input `href` itself. That makes lock 'off' a strict no-op.
- Wrap the whole body in ONE try/catch that returns `href`. It covers a malformed percent segment (decodeURIComponent URIError) and any throwing lock, so a bad URL can never throw into afterNavigate or a click handler (T-hze-02).
- Header comment: cite quick-260926-hze and this model: "URL shows the locked script and is the resolution key; every resolver is script-tolerant". Explain why `artist` is the only query param locked.

(b) names.svelte.ts, per locked decision 2. Import `lockEntityHref` from `$lib/services/entity-href`. Add a public `lockUrl(href: string): string` right after `artistHref`, returning `lockEntityHref(href, (s) => this.zhLock(s))`. Doc comment:
- it uses the script lock only, never translation (the same reason as artistHref);
- it is reactive through zhLock;
- 'off' returns the input itself;
- its callers are the album and chart-album links, the legacy album share forward, and the layout address-bar rewrite.
Keep `artistHref` unchanged.

(c) lastfm.ts, per locked decision 4. Add `import { isChineseLine, lockScriptSync, warmScript } from './zh-convert';`. In `getAlbumTracklist`:
1. Run the existing lookup. If `info.tracks?.length` is truthy, or `!isChineseLine(album)`, return `info.tracks ?? []`. That is zero extra cost for hits and for non-Chinese titles.
2. Otherwise `await warmScript('zh-Hant')`. It builds s2t + t2s and never rejects.
3. Build the DISTINCT alternatives from `[lockScriptSync(album, 'zh-Hans'), lockScriptSync(album, 'zh-Hant')]`, dropping any that equal `album`.
4. Try them SEQUENTIALLY (not Promise.all, so a first-alt hit costs one call, not two) through the same `fetchInfo({ method: 'album.getinfo', album: alt, artist })`. Return the first non-empty `tracks`.
5. If none hit, return [].
It stays never-throw, because fetchInfo, warmScript and lockScriptSync all never throw. The comment must record the probe evidence (範特西 0 vs 范特西 10; 十一月的萧邦 0 vs 十一月的蕭邦 12) and the fact that Last.fm keeps one canonical title per album in either script. Add a `ponytail:` note: enrichAlbum is deliberately NOT rescued, because Deezer supplies the hero cover in both scripts; the upgrade path is to rescue enrichAlbum the same way if a Last.fm-only album loses its bio or art.

Then run the targeted tests, then the gate (`pnpm test && pnpm check && pnpm build`, all green). Commit `feat(quick-260926-hze): lockEntityHref + names.lockUrl + Last.fm album-title script rescue`.
  </action>
  <verify>
    <automated>pnpm vitest run src/lib/services/entity-href.test.ts src/lib/stores/names.test.ts src/lib/services/lastfm.test.ts && pnpm test && pnpm check && pnpm build</automated>
  </verify>
  <done>All behaviour cases pass and existing lastfm/names tests still pass (the '魔杰座' hit test and the 'X','Y' miss test each make one call). `lockUrl(href: string): string` exists on names. The full gate is green. RED and GREEN commits are on claude/festive-kapitsa-dac746.</done>
</task>

<task type="auto" tdd="true">
  <name>Task 2: album links locked at the source + self-warming favourite fold + heart revert</name>
  <files>src/lib/stores/library.svelte.ts, src/lib/stores/library.svelte.test.ts, src/routes/(app)/artist/[name]/+page.svelte, src/routes/(app)/artist/[name]/albums/+page.svelte, src/routes/(app)/+page.svelte, src/routes/(app)/album/[artist]/[name]/+page.svelte</files>
  <behavior>
    library.svelte.test.ts, new describe 'quick-260926-hze self-warming favourite fold'. Each test runs `vi.resetModules()`, so the fresh zh-convert has t2s COLD. The existing top-level vi.mock of $app/environment / blob-store and the stubbed localStorage persist. Seed memStore 'openmusic:library:v1' before a dynamic `await import('./library.svelte')`, and get the SAME fresh zh-convert via `await import('$lib/services/zh-convert')`:
    - favArtists ['周杰倫'] → fresh.load() → isFavArtist('周杰倫') is true and isFavArtist('周杰伦') is false (cold precondition, proves the test is not vacuous) → `await zh.warmScript('zh-Hans')` → `await vi.waitFor(() => expect((fresh as unknown as { foldRev: number }).foldRev).toBe(1))` → isFavArtist('周杰伦') is true. No settings/lock is involved, so it is lock-independent.
    - favArtists ['Daft Punk'] only → load() → after a microtask flush, foldRev stays 0 (a Latin-only library never downloads the dict)
    - empty store → toggleFavArtist('周杰倫') → foldRev reaches 1 after the warm (the toggle path also warms)
    - the existing hl9 describe ('a favourite saved in one script matches…', 'Latin names keep…') still passes unchanged
  </behavior>
  <action>
RED first: add the new library describe, run it, and confirm it fails (no foldRev, and the fold stays cold). Commit `test(quick-260926-hze): …`.

GREEN, part 1: library.svelte.ts, per locked decision 7.
- Add `warmScript` to the existing zh-convert import.
- Add a reactive `private foldRev = $state(0);` with a comment: it is read by isFavArtist so a fold-dict landing repaints every heart and favourites list. If svelte-check or the compiler rejects `private` on a `$state` field, drop the modifier and keep the name.
- Add a PLAIN-field latch `private foldWarmed = false;`, commented as the house convention for loop guards: the UI never reads it.
- Add `private warmFold(): void`. It returns early if `this.foldWarmed`, or if no `this.favArtists` entry `isChineseLine`. Otherwise it sets the latch and fires `void warmScript('zh-Hans').then(() => { this.foldRev++; })`. It fires once, with no retry storm.
- Call `this.warmFold()` at the end of `load()`, after the try/catch, so it sees the hydrated list. Call it again at the end of `toggleFavArtist()`, after the favArtists assignment.
- `isFavArtist` gets `void this.foldRev;` as its first line (reactive dependency).
- Replace the hl9 `ponytail:` comment in favKey with the new behaviour: the fold now warms itself, lock-independent. Write a new `ponytail:` line naming the cost: a user with any Chinese favourite downloads the ~22 KB gzip t2s dict even with the lock off. Keep the hl9 decision text above it, and note "library still must not import names".

GREEN, part 2: the artist page heart revert, per locked decision 7. At artist/[name]/+page.svelte:156, set `const favArtist = $derived(library.isFavArtist(name));`. Update its comment: quick-260926-hze made library repaint itself via foldRev, so the hl9 names.zhLock detour is redundant. Keep the kmn and hl9 refs as history.

GREEN, part 3: album links, per locked decision 3. discography.ts and home-charts.ts stay pure and untouched.
- artist/[name]/+page.svelte:542 → `goto(names.lockUrl(albumHref(al, name)))`
- artist/[name]/albums/+page.svelte:106 → `goto(names.lockUrl(albumHref(al, name)))`. Confirm `names` is already imported there (it uses names.dnTitle).
- (app)/+page.svelte:1502, 1509, 1523 → `goto(names.lockUrl(chartAlbumHref(a)))`, all three.
- album/[artist]/[name]/+page.svelte onMount forward. Its SSR-SAFETY comment (Pitfall 4) forbids a module-top store import, so do NOT add a static `import { names }`. Instead replace `void goto(target, { replaceState: true });` with a dynamic `import('$lib/stores/names.svelte')`. On resolve, call `goto(names.lockUrl(target), { replaceState: true })`. On `.catch`, still call `goto(target, { replaceState: true })`, so a chunk failure never strands the recipient on "Opening album…". Add a comment covering:
  - quick-260926-hze;
  - the chunk is already loaded by the (app) layout, so there is no extra fetch;
  - the SSR invariant is kept;
  - known ceiling: on a cold share-link open the lock dict is usually still cold, so lockUrl is identity here and the layout's afterNavigate rewrite (Task 3) fixes the address bar.
- Add a one-line `quick-260926-hze` comment at each wrapped call site, or one comment per file.

Run the targeted tests and the grep gates, then the full gate. Commit `feat(quick-260926-hze): album links follow the script lock + self-warming favourite fold`.
  </action>
  <verify>
    <automated>pnpm vitest run src/lib/stores/library.svelte.test.ts && test "$(grep -F -c 'goto(names.lockUrl(chartAlbumHref(a)))' 'src/routes/(app)/+page.svelte')" = 3 && test "$(grep -F -c 'goto(names.lockUrl(albumHref(al, name)))' 'src/routes/(app)/artist/[name]/+page.svelte')" = 1 && test "$(grep -F -c 'goto(names.lockUrl(albumHref(al, name)))' 'src/routes/(app)/artist/[name]/albums/+page.svelte')" = 1 && test "$(grep -F -c '$derived(library.isFavArtist(name))' 'src/routes/(app)/artist/[name]/+page.svelte')" = 1 && test "$(grep -F 'isFavArtist(names.zhLock' 'src/routes/(app)/artist/[name]/+page.svelte' | grep -v -E '^[[:space:]]*(//|\*)' | wc -l | tr -d ' ')" = 0 && test "$(grep -F 'goto(chartAlbumHref(' 'src/routes/(app)/+page.svelte' | grep -v -E '^[[:space:]]*(//|\*|<!--)' | wc -l | tr -d ' ')" = 0 && test "$(grep -F -c 'names.lockUrl(target)' 'src/routes/(app)/album/[artist]/[name]/+page.svelte')" = 1 && test "$(grep -E '^[[:space:]]*import .*stores/' 'src/routes/(app)/album/[artist]/[name]/+page.svelte' | wc -l | tr -d ' ')" = 0 && pnpm test && pnpm check && pnpm build</automated>
  </verify>
  <done>Six album-link sites go through names.lockUrl. The legacy forward uses a dynamic import, so there is still no static store import in that SSR route. library.isFavArtist repaints via foldRev with the lock OFF. The artist heart is back to `library.isFavArtist(name)`. The full gate is green, and the commits are on the current branch. Cross-check any "0" gate with sed, since ugrep has returned false-empty results.</done>
</task>

<task type="auto">
  <name>Task 3: afterNavigate address-bar rewrite + syncTabUrl reads the live address bar</name>
  <files>src/routes/(app)/+layout.svelte, src/lib/services/url-tab.ts, src/lib/services/url-tab.test.ts, src/routes/(app)/charts/top/+page.svelte, src/routes/(app)/artist/[name]/albums/+page.svelte</files>
  <action>
(a) url-tab.ts, per locked decision 6. Change the signature to `syncTabUrl(param: string, value: string, defaultValue: string): void`. Inside the existing `browser` guard and try/catch, build from the LIVE address bar: `history.replaceState(history.state, '', tabHref(new URL(location.href), param, value, defaultValue))`. `tabHref` stays pure and unchanged. Update the doc comment with a quick-260926-hze ref. The reason: after the layout's raw address-bar rewrite, `page.url` is still the PRE-rewrite URL, so building from it would put the unlocked name back on a tab switch. Keep the existing "RAW, not $app/navigation" paragraph.
- Update the 3 callers: charts/top/+page.svelte:210 → `syncTabUrl('tab', 'tracks', 'tracks')` and :218 → `syncTabUrl('tab', 'artists', 'tracks')`; artist/[name]/albums/+page.svelte:88 → `syncTabUrl('tab', f.id, 'main')`. If `page` is no longer used in either file, leave its import alone: charts/top still uses `page.url` for pickTab at line 40, and the albums page's own pickTab uses it too.
- url-tab.test.ts:77 → `syncTabUrl('tab', 'history', 'liked')`. It stays an SSR no-op assertion. The existing "imports nothing from $app/navigation" test must stay green.

(b) (app)/+layout.svelte, per locked decision 5.
- Extend line 5 to `import { goto, afterNavigate } from '$app/navigation';` and add `import { warmScript } from '$lib/services/zh-convert';`.
- Add a top-level `async function lockAddressBar(): Promise<void>`:
  1. Read `settings.zhScript`. If it is not 'zh-Hant' or 'zh-Hans', return.
  2. `await warmScript(target)`. It is memoized, instant when warm, and never rejects.
  3. THEN read `here = location.pathname + location.search` (after the await, so a navigation that happened meanwhile is the one locked) and compute `locked = names.lockUrl(here)`.
  4. If `locked !== here` and `!history.state?.gsdOverlay` (never rewrite an overlay sentinel entry, T-hze-04), call `history.replaceState(history.state, '', locked + location.hash)` inside try/catch, following the url-tab idiom.
- Register `afterNavigate(() => void lockAddressBar());` at component top level. afterNavigate must be called during init, not inside onMount.
- ALSO call `void lockAddressBar();` once at the END of the existing onMount body, after `settings.load()`, before the teardown return. This covers the cold-load 'enter' case whatever the relative timing of SvelteKit's initial afterNavigate callback (the root mount runs with `sync: false`) and `settings.load()`. It is idempotent: the second call finds `locked === here`.
- The comment block (quick-260926-hze) must say:
  - RAW history.replaceState, NOT $app/navigation replaceState (cite the url-tab.ts / overlays.svelte.ts reasoning: shallow routing desyncs the router index and makes goto() a no-op);
  - `page.url` / `page.params` stay as navigated, so nothing re-runs or refetches;
  - replaceState fires neither popstate nor afterNavigate, so it cannot loop;
  - no history entry is added (overlay depth == history depth holds);
  - a reload of the rewritten URL resolves because every resolver is script-tolerant (searchAll, Deezer, MB/Deezer ids, resolveStub t2s rescue, the getAlbumTracklist rescue from Task 1);
  - syncTabUrl now reads the live bar so a tab switch keeps the rewrite;
  - no rAF/tick is used, because the Browser pane has a frozen rAF: afterNavigate + await only.

Run the targeted test and the grep gates, then the full gate. Commit `feat(quick-260926-hze): typed and received links follow the script lock`.

Optional, non-blocking: if a browser is available, run the dev server (probe 4321 then 5173) and spot-check:
1. With lock 繁體, hard-load /artist/周杰伦. The address bar becomes /artist/周杰倫 with no second network wave.
2. Switch the albums tab on /artist/周杰倫/albums. The name stays Traditional.
3. With lock 繁體, open a home chart album. The URL has a Traditional title and artist, and a reload still shows the tracklist.
Record what was observed in the SUMMARY. If no browser is available, say so. Unit tests plus the gate are the pass bar.
  </action>
  <verify>
    <automated>pnpm vitest run src/lib/services/url-tab.test.ts && test "$(grep -F 'syncTabUrl(page.url' 'src/routes/(app)/charts/top/+page.svelte' 'src/routes/(app)/artist/[name]/albums/+page.svelte' | grep -v -E ':[[:space:]]*(//|\*)' | wc -l | tr -d ' ')" = 0 && test "$(grep -F -c 'afterNavigate(' 'src/routes/(app)/+layout.svelte')" -ge 1 && test "$(grep -F -c 'gsdOverlay' 'src/routes/(app)/+layout.svelte')" -ge 1 && test "$(grep -F -c 'names.lockUrl(' 'src/routes/(app)/+layout.svelte')" -ge 1 && test "$(grep -F -c 'new URL(location.href)' src/lib/services/url-tab.ts)" -ge 1 && pnpm test && pnpm check && pnpm build</automated>
  </verify>
  <done>afterNavigate plus the one onMount call rewrite an other-script entity URL to the locked script through raw replaceState. Overlay sentinel entries are skipped, and 'off' makes no write. syncTabUrl takes (param, value, defaultValue) and builds from location.href, with all 3 callers and the test updated. The full gate is green, and the commit is on claude/festive-kapitsa-dac746 and not pushed.</done>
</task>

</tasks>

<threat_model>
## Trust Boundaries

| Boundary | Description |
|----------|-------------|
| address bar → layout rewrite | location.pathname/search are attacker-controlled (a received link) and feed lockEntityHref and then history.replaceState |
| URL param → Last.fm proxy | the album title from the URL drives up to 3 same-origin /api/lastfm/info GETs |

## STRIDE Threat Register

| Threat ID | Category | Component | Disposition | Mitigation Plan |
|-----------|----------|-----------|-------------|-----------------|
| T-hze-01 | Tampering | lockEntityHref | mitigate | Anchored `^/(artist|album|song)/` prefix: protocol-relative '//host' and absolute URLs pass through untouched. replaceState is same-origin-only (it throws on cross-origin, which the try/catch absorbs), so there is no open redirect. Segments are re-encoded with encodeURIComponent (a '/' inside a name stays %2F). |
| T-hze-02 | Denial of Service | lockEntityHref / lockAddressBar | mitigate | One try/catch around the whole lockEntityHref body returns the input on a malformed %-sequence or a throwing lock. lockAddressBar wraps replaceState in try/catch. Pinned by the '/artist/%E5' test. |
| T-hze-03 | Denial of Service | getAlbumTracklist rescue | accept | At most 2 extra GETs, only for a CHINESE title that missed. They run sequentially, are cached 6h per query by fetchInfo, and go through the apiFetch governor (dedupe + concurrency cap). Non-Chinese and hit paths make exactly one call (tested). |
| T-hze-04 | Tampering | lockAddressBar vs overlay sentinels | mitigate | Skip when `history.state?.gsdOverlay`. `history.state` is preserved on every write, so SvelteKit's index keys and overlay depth == history depth hold. There is no loop, because replaceState fires neither popstate nor afterNavigate. |
| T-hze-05 | Information Disclosure | library fold warm | accept | It loads a static, first-party dict chunk. No user data leaves the device. |
</threat_model>

<verification>
- Per task: targeted vitest, then `pnpm test && pnpm check && pnpm build` all green before each code commit (locked decision 8).
- Coverage audit:
  - Gap 1 (album titles) → Task 2 artist/albums wraps + Task 1 lockUrl.
  - Gap 2 (home chart albums) → Task 2, 3 sites.
  - Gap 3 (typed/received/history links) → Task 3 layout rewrite + legacy forward (Task 2) + syncTabUrl (Task 3).
  - Gap 4 (fav with lock OFF) → Task 2 foldRev.
  - "Every resolver script-tolerant" → Task 1 Last.fm title rescue.
  - Locked decisions 1-8 → Tasks 1/1/2/1/3/3/2/all.
- Out of scope, untouched: share.ts builders, discography.ts / home-charts.ts (stay pure), enrichAlbum rescue (the known ceiling is recorded in lastfm.ts), and `/song/{slug}` `n`/`a` query carriers (only `artist` is a locked param).
- Orchestrator E2E (worktree dev server, real upstreams): the three spot checks listed at the end of Task 3, plus lock OFF: a favourite stored as 周杰倫 shows a filled heart on a hard-loaded /artist/周杰伦.
</verification>

<success_criteria>
- With any lock on, every in-app album and chart-album link and every other-script entity URL in the address bar shows the locked script. With the lock off, nothing changes byte-for-byte.
- Locked album URLs reload with a tracklist, including Last.fm-only chart albums in either script.
- Tab switches never undo the rewrite.
- Favourite-artist hearts match across scripts with the lock off.
- The full gate is green after each commit. All commits are on claude/festive-kapitsa-dac746, none pushed.
</success_criteria>

<output>
Create `.planning/quick/260926-hze-album-and-deep-link-urls-follow-the-chin/260926-hze-SUMMARY.md` when done
</output>
