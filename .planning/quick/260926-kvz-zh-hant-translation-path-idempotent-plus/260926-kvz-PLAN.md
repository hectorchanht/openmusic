---
phase: quick-260926-kvz
plan: 01
type: execute
wave: 1
depends_on: []
files_modified:
  - src/lib/services/zh-convert.ts
  - src/lib/services/zh-convert.test.ts
  - src/lib/services/translate.ts
  - src/lib/stores/names.svelte.ts
  - src/lib/stores/names.test.ts
  - src/routes/(app)/song/[artist]/[title]/+page.svelte
  - src/routes/(app)/song/[artist]/[title]/loader.test.ts
autonomous: true
requirements: [quick-260926-kvz]

must_haves:
  truths:
    - "With a zh-Hant TRANSLATION target (artistLang/titleLang = zh-Hant), names.dnArtist('周杰倫') and names.dnArtist('周杰伦') both return 周杰倫 — so Now Playing, Up Next, the Nowbar and the artist-page h1 (all dnArtist) agree with the URL and hit-song rows"
    - "Every exported Simplified→Traditional entry point (s2tConvertLineSync, s2tConvertLines, lockScriptSync zh-Hant) is idempotent on already-Traditional input: 周杰倫 stays 周杰倫, 鍾鎮濤 stays 鍾鎮濤, 头发 still becomes 頭髮"
    - "A user whose localStorage already holds the poisoned entry openmusic:name-tr:v2:zh-Hant {周杰倫: 周傑倫} sees 周杰倫 once the dicts are warm, and that entry is removed from localStorage with no reload, no Clear-cache and no network call"
    - "Non-Chinese keys in the zh-Hant name cache (e.g. Coral Sea → 珊瑚海, a paid API translation) are never touched, and STORE_VER stays v2"
    - "On /song/{artist}/{title}, the client-rendered h1 and artist line follow the script lock (周杰伦 renders 周杰倫 under 繁體), while the SSR HTML, the /api/og cover URL and the share-arrival resolve keep the RAW route segments"
    - "Lock off: the song share page body is byte-identical to today (zhLock returns its input)"
  artifacts:
    - path: "src/lib/services/zh-convert.ts"
      provides: "private s2tMerge over the RAW convertLineSync/t2sLineSync handles; s2tConvertLineSync, s2tConvertLines and lockScriptSync zh-Hant all route through it; warmS2T warms both dicts"
      contains: "quick-260926-kvz"
    - path: "src/lib/services/zh-convert.test.ts"
      provides: "idempotence tests for s2tConvertLineSync / s2tConvertLines + the rewritten t2s-cold fallback test"
      contains: "quick-260926-kvz"
    - path: "src/lib/stores/names.svelte.ts"
      provides: "resolveTranslated zh-Hant offline fast path runs BEFORE the cache lookup and heals poisoned entries; cold path uses the latched warmLock('zh-Hant')"
      contains: "quick-260926-kvz"
    - path: "src/lib/stores/names.test.ts"
      provides: "zh-Hant translation idempotence + poisoned-cache self-heal + English-key-untouched tests"
      contains: "quick-260926-kvz"
    - path: "src/routes/(app)/song/[artist]/[title]/+page.svelte"
      provides: "shownTitle / shownArtist derived through a lazily-bound names.zhLock"
      contains: "shownArtist"
  key_links:
    - from: "src/lib/stores/names.svelte.ts resolveTranslated"
      to: "src/lib/services/zh-convert.ts s2tConvertLineSync"
      via: "offline fast path before m.get(text)"
      pattern: "s2tConvertLineSync\\(text\\)"
    - from: "src/lib/services/translate.ts resolveZhHant"
      to: "src/lib/services/zh-convert.ts s2tConvertLines"
      via: "dynamic import, now the merge"
      pattern: "s2tConvertLines\\("
    - from: "src/routes/(app)/song/[artist]/[title]/+page.svelte"
      to: "src/lib/stores/names.svelte.ts zhLock"
      via: "lazy import inside onMount, bound to a $state lock"
      pattern: "import\\('\\$lib/stores/names\\.svelte'\\)"
---

<objective>
Fix the live 周傑倫-vs-周杰倫 split on the TRANSLATION layer and the unlocked song share page body.

Root cause (verified by the orchestrator on the worktree dev server): quick-260926-bxg made only
`lockScriptSync` idempotent. `names.resolveTranslated`'s zh-Hant no-flash fast path
(`s2tConvertLineSync`) and `translate.ts` `resolveZhHant` (`s2tConvertLines`) still run RAW s2t,
so a JOOX/HK row's 周杰倫 becomes 周傑倫 while a CN row's 周杰伦 becomes 周杰倫. The lock that runs
afterwards cannot repair it (the merge keeps 傑, a char t2s changes). Worse, the fast path PERSISTED
the bad result into `openmusic:name-tr:v2:zh-Hant`, and the cache hit runs BEFORE the fast path, so
a converter fix alone would keep serving the poison to real users.

Purpose: one idempotent s2t for the whole app, a translation cache that heals itself without a
global wipe, and a share page whose visible text matches its (already locked) URL and tab title.
Output: 3 atomic commits on branch claude/festive-kapitsa-dac746 (never pushed).
</objective>

<execution_context>
@/Users/laichan/.claude/plugins/cache/gsd-plugin/gsd/4.5.3/workflows/execute-plan.md
@/Users/laichan/.claude/plugins/cache/gsd-plugin/gsd/4.5.3/templates/summary.md
</execution_context>

<context>
@./CLAUDE.md
@.planning/STATE.md
@.planning/quick/260926-bxg-zh-hant-lockscriptsync-idempotent-for-al/260926-bxg-SUMMARY.md
@src/lib/services/zh-convert.ts
@src/lib/services/zh-convert.test.ts
@src/lib/stores/names.svelte.ts
@src/lib/stores/names.test.ts
@src/routes/(app)/song/[artist]/[title]/+page.svelte
@src/routes/(app)/song/[artist]/[title]/loader.test.ts

<interfaces>
<!-- Extracted from the codebase. Use directly — no exploration needed. -->

src/lib/services/zh-convert.ts (current):
- `let convertLineSync: ConvertLine | null` (line 32) — RAW s2t handle, published by loadConvertLine()
- `let t2sLineSync: ConvertLine | null` (line 205) — RAW t2s handle, published by loadT2sConvertLine()
- `function loadConvertLine(): Promise<ConvertLine>` / `function loadT2sConvertLine(): Promise<ConvertLine>` — memoized, null the promise on rejection
- `export function warmS2T(): void` (line 90) — today warms s2t only
- `export function s2tConvertLineSync(text: string): string | null` (line 107) — today RAW s2t, null when cold or empty
- `export async function s2tConvertLines(lines: string[]): Promise<string[]>` (line 142) — today RAW s2t, identity on any fault, blanks pass through
- `function hantLockSync(text: string): string | null` (line 300) — the bxg merge, but built on the EXPORTED s2tConvertLineSync / t2sConvertLineSync (would recurse once s2tConvertLineSync becomes the merge)
- `export function lockScriptSync(text: string, target: ZhScript): string` (line 337)
- `export async function warmScript(target: ZhScript): Promise<void>` (line 356) — zh-Hant: `await Promise.allSettled([loadConvertLine(), loadT2sConvertLine()])`

src/lib/stores/names.svelte.ts (current):
- line 43: `import { isChineseLine, s2tConvertLineSync, warmS2T, lockScriptSync, warmScript, type ZhScript } from '$lib/services/zh-convert';`
- `private resolveTranslated(text, target, whitelist): string` (lines 260-303): shouldTranslate gate → `m = this.langCache(target)` → `hit = m.get(text)` return → zh-Hant fast path (274-287) → inflight → attempts → queue
- `private persist(lang: string)` writes `openmusic:name-tr:v2:<lang>` from the in-memory map
- `private warmLock(target: ZhScript): void` (348-354): latched in `lockWarmed` Set, `void warmScript(target).then(() => { this.rev++; })`
- `zhLock(text: string): string` — the lock without translation; reads rev + settings.zhScript
- `warm(): void` (440-456): `if (wantsHant) warmS2T();` then `this.warmLock(lock)` for the lock

src/routes/(app)/song/[artist]/[title]/+page.svelte (current):
- line 35-36: `const title = $derived(data.name || data.og.title); const artist = $derived(data.artist);`
- line 42-46: coverSrc built from RAW `data.artist` / `data.name` — leave untouched
- line 100-103 and 154-158: `arriveShared` / `replayShared` get `{ artist: data.artist, title: data.name, u: data.u }` — leave untouched
- line 170-183: `onMount(() => { if (!browser) return; ... ac = new AbortController(); inflight = arrive(); retry = () => void playNow(); return () => ac?.abort(); });`
- line 195-198: `<h1 class="title">{title}</h1>` / `{#if artist}<p class="artist">{artist}</p>{/if}`

loader.test.ts source guard extracts the onMount body with the regex `onMount\(\(\) => \{([\s\S]*?)\n\t\}\);` and asserts `playNow` appears in it exactly ONCE and no `.play(` / `.toggle(` — any new onMount line must not break either.
</interfaces>
</context>

<tasks>

<task type="auto" tdd="true">
  <name>Task 1: One idempotent s2t in zh-convert.ts (generalise the bxg merge)</name>
  <files>src/lib/services/zh-convert.ts, src/lib/services/zh-convert.test.ts, src/lib/services/translate.ts</files>
  <behavior>
    - s2tConvertLineSync('周杰倫') === '周杰倫' once both dicts are warm (was 周傑倫)
    - s2tConvertLineSync('周杰伦') === '周杰倫'; s2tConvertLineSync('头发') === '頭髮'; s2tConvertLineSync('台灣') === '台灣'
    - await s2tConvertLines(['周杰倫','周杰伦','','头发','鍾鎮濤']) → ['周杰倫','周杰倫','','頭髮','鍾鎮濤'] (blank slot kept, length 5)
    - warmS2T() alone, on a fresh module, ends with BOTH sync handles warm: vi.waitFor until t2sConvertLineSync('繁體') === '繁体'
    - t2s COLD (t2s dict import forced to fail): s2tConvertLineSync('周杰伦') === '周杰倫' (direct s2t, never worse than before), lockScriptSync('周杰伦','zh-Hant') === '周杰倫', await s2tConvertLines(['周杰伦','头发']) → ['周杰倫','頭髮']
    - s2t COLD (fresh module, nothing warmed): s2tConvertLineSync('简体') === null; lockScriptSync stays identity
    - every existing zh-convert test stays green (bxg lock tests, t2s tests, never-throw test)
  </behavior>
  <action>
Per locked decision 1 (quick-260926-kvz). Write the new tests FIRST and run them to see RED (do not commit a red tree — decision 4's gate requires green before every commit).

zh-convert.ts:
(a) Rewrite the private `hantLockSync` as `s2tMerge(text: string): string | null` and build it on the RAW module handles `convertLineSync` and `t2sLineSync`, NOT on the exported `s2tConvertLineSync` / `t2sConvertLineSync` (those now route through this helper, so calling them would recurse). Behaviour, identical to bxg: return null when `convertLineSync` is null or `text` is empty; compute `direct` = raw s2t of text inside try/catch (a throw returns null, preserving the never-throw contract); if `t2sLineSync` is null return `direct`; otherwise, inside a second try/catch that returns `direct` on any throw, fold = raw t2s of text, round = raw s2t of fold, split all three with `Array.from` (code points, keep the astral-char comment), return `direct` on any length mismatch, else per code point keep the source char where fold changed it and take round's char otherwise. Move the bxg WHY / Probed doc block onto this helper, keep every decision ref, and add a quick-260926-kvz line saying this is now the ONE s2t used by every exported entry point.
(b) `s2tConvertLineSync(text)` becomes `return s2tMerge(text);`. Rewrite its doc: the quick-260926-bxg paragraph that says the lock goes through the merge "rather than calling this directly" is now false — replace it with a quick-260926-kvz note that this IS the merge, so already-Traditional input keeps its source spelling (周杰倫 stays, 周傑倫 stays), null still means s2t cold, and t2s cold degrades to direct s2t (the pre-kvz behaviour, never worse).
(c) `s2tConvertLines(lines)`: keep the `lines.length === 0` early return. Then `await Promise.allSettled([loadConvertLine(), loadT2sConvertLine()])` (allSettled for the same reason warmScript documents — Promise.all would resolve early on a fast t2s failure while s2t is still in flight), then map each line: blank → unchanged, else `s2tConvertLineSync(line) ?? line` (s2t failed to load → per-line identity, which is the existing never-throw contract). Keep an outer try/catch returning `lines.slice()`. Update its doc: replace the bxg "already-Traditional input is NOT a no-op in general" sentence with a quick-260926-kvz note that it is now idempotent via the merge, and that it loads BOTH dicts.
(d) `warmS2T()` becomes `void warmScript('zh-Hant');` (warmScript never rejects; function hoisting makes the later declaration fine). Update its doc: quick-260926-kvz — warms BOTH dicts so the names no-flash fast path gets the merge at boot.
(e) `lockScriptSync`: the zh-Hant branch calls `s2tMerge(text)` (or `s2tConvertLineSync(text)` — same thing); zh-Hans unchanged. Update the order-step-3 comment and the warmScript doc comment so neither mentions `hantLockSync` any more (after this task `hantLockSync` must not appear anywhere in src/).
(f) COST block (around line 173): next to the bxg note, add a quick-260926-kvz line: a zh-Hant TRANSLATION user (not only a lock user) now also downloads the ~22 KB gzip t2s dict, because s2tConvertLines / warmS2T build both directions.
Do NOT touch the t2s build, `t2sConvertLines`, `t2sConvertLineSync`, `warmT2S`, `warmScript`'s code, or the zh-Hans lock path.

translate.ts (comments only, no code change): in the resolveZhHant header (lines ~136-143) note the dynamic import now also pulls the ~22 KB gzip t2s dict (quick-260926-kvz). In the Chinese-subset comment (~lines 170-173) the parenthetical "already-Traditional input s2t-passes-through unchanged" was false before this task and is true after it — append "(true since quick-260926-kvz: s2tConvertLines is the idempotent merge)" and keep T-25b-04.

zh-convert.test.ts:
- Add a describe 'quick-260926-kvz — every exported s2t entry point is idempotent' with: s2tConvertLineSync cases from <behavior> (warm with `await warmScript('zh-Hant')`); the s2tConvertLines 5-element batch; a fresh-module warmS2T test (`vi.resetModules()`, dynamic import, `m.warmS2T()`, `await vi.waitFor(() => expect(m.t2sConvertLineSync('繁體')).toBe('繁体'))`, then `m.s2tConvertLineSync('周杰倫')` === '周杰倫', `vi.resetModules()` at the end); an s2t-cold test on a fresh module asserting `s2tConvertLineSync('简体')` is null.
- REWRITE the existing bxg test 'PARTIAL warm (s2t only, t2s cold)…' (line ~286): `m.warmS2T()` now warms t2s too, so its `t2sConvertLineSync('繁體')` null assertion would fail. Make t2s cold the way the existing t2sConvertLines never-throw test does: `vi.doMock('tongwen-dict/dist/t2s-char.min.json', () => { throw new Error('chunk load failed'); })`, `vi.resetModules()`, fresh import, `await m.warmScript('zh-Hant')`, assert t2sConvertLineSync('繁體') is null, then the t2s-cold assertions from <behavior>, then `vi.doUnmock(...)` + `vi.resetModules()`. Keep its title's "never worse than before" meaning.
- The existing tests at lines ~33-35 ('is a no-op on already-Traditional input') and ~134-137 stay as-is; they are now true for a real reason.

Then run the gate and commit: `fix(quick-260926-kvz): make every Simplified→Traditional entry point idempotent on already-Traditional text` with the trailer line `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`. Stage only this task's three files. Tabs, single quotes, no `as any` in src.
  </action>
  <verify>
    <automated>cd /Users/laichan/code/tung/openmusic/.claude/worktrees/festive-kapitsa-dac746 && pnpm exec vitest run src/lib/services/zh-convert.test.ts src/lib/services/translate.test.ts src/lib/stores/lyric-script.svelte.test.ts src/lib/services/entity-href.test.ts src/lib/stores/names.test.ts && ! grep -rn 'hantLockSync' src && grep -c 'quick-260926-kvz' src/lib/services/zh-convert.ts && pnpm test && pnpm check && pnpm build</automated>
  </verify>
  <done>New kvz tests pass (they were RED before the change), the rewritten t2s-cold test passes, all pre-existing zh-convert / translate / lyric-script / entity-href / names tests pass, `hantLockSync` has no matches in src/, full gate green, one commit on the current branch.</done>
</task>

<task type="auto" tdd="true">
  <name>Task 2: Self-healing zh-Hant name cache in names.resolveTranslated</name>
  <files>src/lib/stores/names.svelte.ts, src/lib/stores/names.test.ts</files>
  <behavior>
    - artistLang 'zh-Hant', dicts warm: names.dnArtist('周杰倫') === '周杰倫' and names.dnArtist('周杰伦') === '周杰倫'; translateMock never called
    - poisoned seed memStore['openmusic:name-tr:v2:zh-Hant'] = {"周杰倫":"周傑倫","Coral Sea":"珊瑚海"} (artistLang + titleLang 'zh-Hant'), dicts warm: dnArtist('周杰倫') === '周杰倫'; the persisted JSON no longer has a 周杰倫 key; it still has "Coral Sea": "珊瑚海"; dnTitle('Coral Sea') === '珊瑚海'; translateMock never called
    - COLD then warm, same poisoned seed, `translateMock.mockReturnValue(new Promise(() => {}))` (so a flush can never bump rev): record `names.rev`, call dnArtist('周杰倫') once (no assertion on this cold value — one stale render is the accepted ceiling), `await vi.waitFor(() => expect(names.rev).toBeGreaterThan(before))` (the latched warm's own bump), then dnArtist('周杰倫') === '周杰倫' and the persisted 周杰倫 key is gone
    - names.warm() with artistLang 'zh-Hant' (lock off) warms BOTH dicts: `await vi.waitFor(() => expect(zh.t2sConvertLineSync('繁體')).toBe('繁体'))` on the same module instance
    - every existing names.test.ts test stays green (queue/attempt machinery on 'ja', lock, aliases, artistHref, lockUrl)
  </behavior>
  <action>
Per locked decision 2 (quick-260926-kvz). Depends on Task 1 (s2tConvertLineSync is now the merge). Write the new tests FIRST in a new describe block 'names — zh-Hant translation is idempotent and self-heals (quick-260926-kvz)' at the end of names.test.ts, mirroring the urx block's setup (flip settingsMock.artistLang / titleLang to 'zh-Hant'; beforeEach already restores 'ja' and clears memStore; warm with `await (await import('$lib/services/zh-convert')).warmScript('zh-Hant')` on the same module instance, as the existing warmLock helpers do). Seed memStore BEFORE the first dn* call (the zh-Hant map hydrates lazily on first use). Run to see RED.

names.svelte.ts, `resolveTranslated`: keep `void this.rev`, the `!text || off || !browser` guard, the shouldTranslate gate and `const m = this.langCache(target)` in place. Move the zh-Hant block so it runs BEFORE `const hit = m.get(text)`. Inside `if (target === 'zh-Hant' && isChineseLine(text))`: `const conv = s2tConvertLineSync(text)`; when conv is not null — if conv differs from text and `m.get(text) !== conv`, `m.set(text, conv)` and `this.persist(target)`; else if conv equals text and `m.has(text)`, `m.delete(text)` and `this.persist(target)`; then `return conv`. When conv is null (cold), call `this.warmLock('zh-Hant')` and fall through to the existing cache lookup, inflight, attempts and queue code unchanged. Persist only when the map actually changed — resolvers run on every render, so an unconditional persist would write localStorage per row per render.

The latched warm: the decision's `warmHant()` is exactly `warmLock('zh-Hant')` — same `warmScript('zh-Hant')` (both dicts), same `lockWarmed` latch, one `rev++` when the dicts land. Reuse it; do NOT add a second latch field or a wrapper method (a separate latch would build nothing new and bump rev twice). Add to warmLock's doc a quick-260926-kvz line: the zh-Hant translation fast path shares this latch because it needs the same two dicts, and with translation on but the lock off this bump is what repaints a cold first render.

Rewrite the fast-path comment (keep the quick-260712-et3 ref and its no-flash rationale) with a quick-260926-kvz paragraph covering: (1) it now runs before the cache hit because the pre-kvz fast path persisted raw-s2t results (周杰倫 → 周傑倫) and the cache hit would otherwise serve them forever; (2) every Chinese key in the zh-Hant map is a deterministic offline result (this fast path, or resolveZhHant's offline branch on a cold flush), so recomputing and healing it costs no network; (3) that is why STORE_VER stays v2 — a bump would discard every persisted API translation (English → Chinese, e.g. Coral Sea → 珊瑚海) that cost network to build, and non-Chinese keys never reach this block; (4) cost: the merge now runs per render instead of a Map hit — the same per-render cost the lock already pays in applyLock; add a `ponytail:` note that a per-session verified-key Set can restore the Map hit if profiling ever shows it. Keep the existing "identity is left uncached" sentence, extended with "and a poisoned identity entry is deleted".

`warm()`: replace `if (wantsHant) warmS2T();` with `if (wantsHant) this.warmLock('zh-Hant');` and add a quick-260926-kvz comment (both dicts; the merge needs t2s). Remove `warmS2T` from the line-43 import (now unused); keep `s2tConvertLineSync`.

Do not touch the flush handler, attempt logic, applyLock, aliases, artistHref, lockUrl or clearCache.

Run the gate and commit: `fix(quick-260926-kvz): zh-Hant translation cache heals raw-s2t entries on the next warm render` with the trailer line `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`. Stage only these two files.
  </action>
  <verify>
    <automated>cd /Users/laichan/code/tung/openmusic/.claude/worktrees/festive-kapitsa-dac746 && pnpm exec vitest run src/lib/stores/names.test.ts && grep -n "const STORE_VER = 'v2'" src/lib/stores/names.svelte.ts && ! grep -n 'warmS2T' src/lib/stores/names.svelte.ts && pnpm test && pnpm check && pnpm build</automated>
  </verify>
  <done>New kvz names tests pass (RED before), all existing names tests pass, STORE_VER is still v2, names.svelte.ts no longer references warmS2T, full gate green, one commit on the current branch.</done>
</task>

<task type="auto">
  <name>Task 3: Song share page body follows the script lock (client-only)</name>
  <files>src/routes/(app)/song/[artist]/[title]/+page.svelte, src/routes/(app)/song/[artist]/[title]/loader.test.ts</files>
  <action>
Per locked decision 3 (quick-260926-kvz). Keep the SSR-SAFETY (Pitfall 4) invariant: no module-top store import, no store call at module scope.

+page.svelte: below the `title` / `artist` $derived (lines 35-36) add `let lock = $state<((s: string) => string) | null>(null);` and `const shownTitle = $derived(lock ? lock(title) : title);` / `const shownArtist = $derived(lock ? lock(artist) : artist);`, with a quick-260926-kvz comment: SSR and crawlers get the raw route segments; the client locks the VISIBLE text only, reactively (zhLock reads names.rev and settings.zhScript, so a cold dict repaints when warmLock lands and flipping the setting repaints); `title` / `artist` and every raw `data.artist` / `data.name` use (the /api/og coverSrc, arriveShared, replayShared) stay untouched because they are resolution keys, not display. Inside the existing onMount, right after `if (!browser) return;`, add ONE line (single line, so the loader.test.ts onMount-body regex keeps matching the real closing brace) that lazy-imports `$lib/stores/names.svelte` and in `.then` sets `lock = (s) => names.zhLock(s)`, followed by `.catch(() => {})` (a failed chunk keeps the raw text — never-throw). Precede it with a short comment tying it to the SSR-SAFETY header (lazy for the same reason as share-arrival). In the markup, render `{shownTitle}` in the h1 and gate/render the artist line on `shownArtist`. Add one sentence to the SSR-SAFETY header noting the names store is also imported lazily (quick-260926-kvz).

loader.test.ts: in the existing source-guard describe (or a new sibling describe 'song share page — visible text follows the script lock (quick-260926-kvz)'), add source assertions: the markup contains `{shownTitle}` and `{shownArtist}` and no longer contains `<h1 class="title">{title}</h1>`; the source contains `import('$lib/stores/names.svelte')` and `names.zhLock(`; no static store import (`/^\s*import\s[^(]*from '\$lib\/stores\//m` does not match); the raw resolution keys are intact (`encodeURIComponent(data.artist)` present, and `{ artist: data.artist, title: data.name, u: data.u }` appears twice). The existing onMount assertions (playNow exactly once, no `.play(` / `.toggle(`) must still pass unchanged.

Run the gate and commit: `fix(quick-260926-kvz): song share page title and artist follow the script lock` with the trailer line `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`. Stage only these two files. Never push.
  </action>
  <verify>
    <automated>cd /Users/laichan/code/tung/openmusic/.claude/worktrees/festive-kapitsa-dac746 && pnpm exec vitest run "src/routes/(app)/song/[artist]/[title]/loader.test.ts" && pnpm test && pnpm check && pnpm build</automated>
  </verify>
  <done>The share page renders shownTitle / shownArtist through a lazily-bound names.zhLock, SSR output and all raw resolution keys are unchanged, loader.test.ts guards pass (old and new), full gate green, one commit on the current branch.</done>
</task>

</tasks>

<threat_model>
## Trust Boundaries

| Boundary | Description |
|----------|-------------|
| localStorage → names store | persisted `openmusic:name-tr:v2:*` maps are user-writable and may already hold poisoned entries |
| route params → share page | `/song/{artist}/{title}` segments are attacker-controlled text rendered on the page |

## STRIDE Threat Register

| Threat ID | Category | Component | Disposition | Mitigation Plan |
|-----------|----------|-----------|-------------|-----------------|
| T-kvz-01 | Tampering | names.resolveTranslated zh-Hant cache | mitigate | Chinese keys are recomputed offline every render and the cached value is overwritten/deleted when it differs; non-Chinese keys never reach the block; hydration keeps its existing try/catch around JSON.parse |
| T-kvz-02 | Denial of Service | per-render merge in resolveTranslated | accept | 3 short tongwen passes per Chinese name per render, the same cost class applyLock already pays; persist only on actual change so no per-render localStorage writes; `ponytail:` note names the verified-key Set upgrade |
| T-kvz-03 | Denial of Service | cold-dict warm | mitigate | reuse the `lockWarmed` latch: one warmScript('zh-Hant') and one rev bump per session, no retry storm |
| T-kvz-04 | Tampering / XSS | song share page shownTitle / shownArtist | mitigate | rendered via Svelte text interpolation (auto-escaped), no `{@html}`; zhLock only re-scripts Chinese code points; raw segments still drive /api/og and share-arrival as before |
| T-kvz-05 | Information Disclosure | SSR share page | accept | no store graph enters SSR (lazy import in onMount, guarded by loader.test.ts); crawler HTML byte-identical |
</threat_model>

<verification>
- Full gate after each task: `pnpm test && pnpm check && pnpm build` green.
- `git log --oneline -3` shows the three `fix(quick-260926-kvz)` commits on claude/festive-kapitsa-dac746; `git status` clean; nothing pushed.
- Optional live check (dev server 4321 or 5173 — probe, don't assume): Settings → artist translation 繁體中文 (lock off), play a JOOX 周杰倫 track and a CN 周杰伦 track — Now Playing artist link, Up Next rows, Nowbar and /artist h1 all read 周杰倫. Then lock 繁體 and open /song/周杰伦/晴天 — body h1/artist read Traditional while view-source shows the raw segment.
</verification>

<success_criteria>
- 周杰倫 and 周杰伦 render identically (周杰倫) under a zh-Hant translation target on every dnArtist surface
- s2tConvertLineSync / s2tConvertLines / lockScriptSync zh-Hant share one private merge over the raw handles; t2s-cold degrades to direct s2t, s2t-cold to null/identity, never throws
- A pre-existing poisoned zh-Hant name-cache entry heals itself on the first warm render, with no network, no STORE_VER bump, and English-keyed entries untouched
- /song/{artist}/{title} visible text follows the lock client-side; SSR and resolution unchanged
</success_criteria>

<source_coverage>
| Source item | Covered by |
|-------------|-----------|
| GOAL: Now Playing / Up Next / Nowbar / artist h1 show 周傑倫 | Task 1 + Task 2 |
| GOAL: song share page body shows unlocked route artist | Task 3 |
| D1 one idempotent s2t, raw handles, s2tConvertLines both dicts, warmS2T both, lock uses helper, doc + cost comments, tests | Task 1 |
| D2 fast path before cache, heal set/delete, latched cold warm with one rev bump, warm() swap, no STORE_VER bump, comments, tests | Task 2 (latch = existing warmLock('zh-Hant'), documented in the task) |
| D3 lazy zhLock on share page, SSR unchanged, raw data kept for og/arrival | Task 3 |
| D4 gate before each commit, current branch, never push | every task's verify + commit step |
</source_coverage>

<output>
Create `.planning/quick/260926-kvz-zh-hant-translation-path-idempotent-plus/260926-kvz-SUMMARY.md` when done.
</output>
