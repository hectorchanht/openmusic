---
phase: quick-260926-bxg
plan: 01
type: execute
wave: 1
depends_on: []
files_modified:
  - src/lib/services/zh-convert.ts
  - src/lib/services/zh-convert.test.ts
  - src/lib/stores/names.svelte.ts
  - src/lib/stores/names.test.ts
autonomous: true
requirements: [quick-260926-bxg]

must_haves:
  truths:
    - "With Chinese script = zh-Hant, an upstream row whose artist arrives already-Traditional as 周杰倫 renders 周杰倫 (not 周傑倫), and a row arriving Simplified as 周杰伦 also renders 周杰倫, so the same artist has one spelling across sources"
    - "Under the zh-Hant lock, already-Traditional names that a pure t2s→s2t round trip would corrupt stay intact: 鍾鎮濤, 髮如雪, 臺灣, 麵"
    - "Applying the zh-Hant lock twice gives the same result as applying it once"
    - "Simplified input still converts phrase-aware under zh-Hant (头发 → 頭髮, 邓紫棋 → 鄧紫棋), and still converts when only the s2t dict is warm (t2s cold falls back to direct s2t)"
    - "Rescued aliases under zh-Hant still display 周杰倫 / 珊瑚海 with no alias-only code path in names.svelte.ts"
    - "zh-Hans lock, 'off', and non-Chinese / kana / hangul passthrough are byte-for-byte unchanged; lyric lines under the lock keep their current output"
  artifacts:
    - path: "src/lib/services/zh-convert.ts"
      provides: "per-code-point merge in the zh-Hant branch of lockScriptSync; warmScript('zh-Hant') awaits both dict builds"
      contains: "Promise.allSettled"
    - path: "src/lib/services/zh-convert.test.ts"
      provides: "quick-260926-bxg regression describe (bug, idempotence, round-trip-corruption guard, mixed passthrough, zh-Hans round trip, partial warm, warmScript('zh-Hant') warms the merge alone)"
      contains: "quick-260926-bxg"
    - path: "src/lib/stores/names.svelte.ts"
      provides: "dnArtist/dnTitle alias branch calls applyLock directly; lockAlias deleted"
    - path: "src/lib/stores/names.test.ts"
      provides: "alias describe warms via warmScript(target) only; comment no longer references lockAlias"
  key_links:
    - from: "src/lib/services/zh-convert.ts lockScriptSync (zh-Hant branch)"
      to: "t2sConvertLineSync + s2tConvertLineSync"
      via: "private merge helper: fold to Simplified, s2t the fold, keep source chars that t2s changed"
      pattern: "Array\\.from"
    - from: "src/lib/stores/names.svelte.ts warmLock('zh-Hant')"
      to: "zh-convert.ts loadConvertLine + loadT2sConvertLine"
      via: "warmScript('zh-Hant') awaits both, so the single rev bump fires after the merge is fully warm"
      pattern: "Promise\\.allSettled\\(\\[loadConvertLine\\(\\), loadT2sConvertLine\\(\\)\\]\\)"
    - from: "src/lib/stores/names.svelte.ts dnArtist / dnTitle"
      to: "applyLock"
      via: "alias branch: a !== null ? this.applyLock(a) : this.resolve(...)"
      pattern: "this\\.applyLock\\(a\\)"
---

<objective>
Make `lockScriptSync(text, 'zh-Hant')` idempotent for already-Traditional input, in the ONE shared seam every locked surface routes through (names.svelte.ts applyLock → rows, Now Playing, OS media card, document title, download tags; lyric-script.svelte.ts per lyric line). Then delete the alias-only workaround `lockAlias()` in names.svelte.ts, which quick-260925-x8o added and which carries a latent corruption bug (its pure t2s→s2t round trip turns 鍾鎮濤 into 鐘鎮濤 and 髮如雪 into 發如雪).

Purpose: tongwen's s2t phrase table is keyed on Simplified, so a Traditional input like 周杰倫 misses the phrase 周杰伦 → 周杰倫, falls through to per-char mapping, and comes out as 周傑倫 (杰 → 傑). The same artist renders two ways depending on which source returned it. This closes the "Deferred Issues" entry in 260925-x8o-SUMMARY.md.

Output: merge helper + dual warm in zh-convert.ts with regression tests; lockAlias removed from names.svelte.ts; test comment/helper updated. One commit per task, both on the current branch.
</objective>

<execution_context>
@/Users/laichan/.claude/plugins/cache/gsd-plugin/gsd/4.5.3/workflows/execute-plan.md
@/Users/laichan/.claude/plugins/cache/gsd-plugin/gsd/4.5.3/templates/summary.md
</execution_context>

<context>
@./CLAUDE.md
@src/lib/services/zh-convert.ts
@src/lib/services/zh-convert.test.ts
@.planning/quick/260925-x8o-show-rescued-chinese-names-in-rows-when-/260925-x8o-SUMMARY.md

<interfaces>
<!-- Extracted from the codebase. Use directly, no exploration needed. -->

From src/lib/services/zh-convert.ts (all exist today):
- `type ConvertLine = (line: string) => string;` (private)
- `function loadConvertLine(): Promise<ConvertLine>` (private, memoized s2t build, publishes `convertLineSync`)
- `function loadT2sConvertLine(): Promise<ConvertLine>` (private, memoized t2s build, publishes `t2sLineSync`)
- `export function warmS2T(): void` / `export function warmT2S(): void` (fire-and-forget)
- `export function s2tConvertLineSync(text: string): string | null` (null = cold, or empty input)
- `export function t2sConvertLineSync(text: string): string | null` (null = cold, or empty input)
- `export function s2tConvertLines(lines: string[]): Promise<string[]>`
- `export function isChineseLine(text: string): boolean`
- `export type ZhScript = 'zh-Hant' | 'zh-Hans';`
- `export function lockScriptSync(text: string, target: ZhScript): string` (lines ~277-302; today: `const converted = target === 'zh-Hant' ? s2tConvertLineSync(text) : t2sConvertLineSync(text); return converted ?? text;`)
- `export async function warmScript(target: ZhScript): Promise<void>` (lines ~304-316; today awaits ONE build inside try/catch)

From src/lib/stores/names.svelte.ts (lines ~321-405):
- `private applyLock(text: string): string` (reads `this.rev` + `settings.zhScript`, calls `this.warmLock(target)` then `lockScriptSync(text, target)`)
- `private warmLock(target: ZhScript): void` (latched per direction; `void warmScript(target).then(() => { this.rev++; })`)
- `private lockAlias(a: string): string` (lines ~373-386, TO DELETE: under zh-Hant does `this.warmLock('zh-Hans'); a = lockScriptSync(a, 'zh-Hans');` then `return this.applyLock(a)`)
- `dnArtist(text)` / `dnTitle(text, artist?)`: `a !== null ? this.lockAlias(a) : this.resolve(...)`
- `warm(): void` (lines ~420-438; boot warm; `if (lock === 'zh-Hant' || lock === 'zh-Hans') this.warmLock(lock);`)

Test conventions (zh-convert.test.ts): tests share ONE module instance via the top-level named imports, so dict warm state leaks between tests. Anything that needs a cold or partially-warm converter MUST use `vi.resetModules(); const m = await import('./zh-convert');` then `vi.resetModules()` again at the end (see the existing 'COLD (converter not warm)' test at ~line 199).
</interfaces>
</context>

<tasks>

<task type="auto" tdd="true">
  <name>Task 1: Per-code-point merge in lockScriptSync's zh-Hant branch + dual warm + regression tests</name>
  <files>src/lib/services/zh-convert.ts, src/lib/services/zh-convert.test.ts</files>
  <behavior>
    New describe in zh-convert.test.ts titled with quick-260926-bxg (e.g. "lockScriptSync zh-Hant — idempotent on already-Traditional input (quick-260926-bxg)"). Each shared-instance test starts with `await warmScript('zh-Hant')`.
    - Bug: lockScriptSync('周杰倫', 'zh-Hant') === '周杰倫' (fails today: returns 周傑倫)
    - Simplified still converts: lockScriptSync('周杰伦', 'zh-Hant') === '周杰倫'; '头发' → '頭髮'; '邓紫棋' → '鄧紫棋'
    - Mixed-script line improves on direct s2t: '頭发' → '頭髮' (direct s2t gives 頭發)
    - Source spelling kept (the lock is a script control, not a spelling normaliser): '周傑倫' → '周傑倫'
    - Round-trip-corruption guard, already-Traditional names stay intact: '鍾鎮濤', '髮如雪', '臺灣', '麵' each map to themselves
    - Mixed / non-CJK passthrough: 'Jay 周杰倫' → 'Jay 周杰倫'; '周杰倫 - 晴天' → '周杰倫 - 晴天'; '𠮷野家' → '𠮷野家' (astral code point, proves the code-point alignment)
    - Idempotence: for each of ['周杰倫', '周杰伦', '周傑倫', '头发', '頭发', '鍾鎮濤', '钟镇涛', '髮如雪', '发如雪', '臺灣', '邓紫棋', '周杰倫 - 晴天'], once = lockScriptSync(x, 'zh-Hant') and lockScriptSync(once, 'zh-Hant') === once
    - zh-Hans round trip: lockScriptSync(lockScriptSync('周杰伦', 'zh-Hant'), 'zh-Hans') === '周杰伦' and lockScriptSync(lockScriptSync('周杰倫', 'zh-Hans'), 'zh-Hant') === '周杰倫'
    - Partial warm (fresh module via vi.resetModules + dynamic import): call m.warmS2T() then await m.s2tConvertLines(['x']); assert m.t2sConvertLineSync('繁體') is null (proves t2s is still cold) AND m.lockScriptSync('周杰伦', 'zh-Hant') === '周杰倫' (direct-s2t fallback, never worse than before); vi.resetModules() at the end
    - warmScript('zh-Hant') alone warms the whole merge (fresh module): await m.warmScript('zh-Hant'); assert m.t2sConvertLineSync('繁體') === '繁体' and m.lockScriptSync('周杰倫', 'zh-Hant') === '周杰倫'; vi.resetModules() at the end. This pins the contract names.warmLock relies on for its single rev bump.
    All existing tests in the file stay green unchanged (including the COLD test: with both dicts cold, lockScriptSync('简体', 'zh-Hant') still returns '简体').
  </behavior>
  <action>
    RED first: add the describe above to src/lib/services/zh-convert.test.ts (tabs, single quotes, a short header comment tagged quick-260926-bxg naming the bug: tongwen s2t phrase table is keyed on Simplified, so Traditional input falls to per-char mapping, 杰 → 傑). Run it and confirm the bug test and the partial-warm/dual-warm tests fail for the expected reason. Then implement in src/lib/services/zh-convert.ts.

    Merge helper (per locked decision 2): add a PRIVATE (not exported) function, e.g. `hantLockSync(text: string): string | null`, placed just above lockScriptSync, with a doc comment tagged quick-260926-bxg. Logic, in this order:
    (1) direct = s2tConvertLineSync(text); if direct is null return null (cold: lockScriptSync's existing `?? text` keeps the identity contract).
    (2) folded = t2sConvertLineSync(text); round = folded === null ? null : s2tConvertLineSync(folded); if folded or round is null return direct (t2s not warm yet: exactly today's behaviour, never worse).
    (3) Split into CODE POINTS with Array.from (not string indexing / .split(''), which break astral chars like 𠮷): a = Array.from(text), f = Array.from(folded), r = Array.from(round). If f.length or r.length differs from a.length, return direct (alignment guard; tongwen phrase maps are length-preserving in practice, this is the never-worse fallback).
    (4) Return a.map((c, i) => (c !== f[i] ? c : r[i])).join(''). A char that t2s changed is already a Traditional form, so keep the source's spelling; every other char takes the phrase-aware s2t-of-the-fold result.
    The doc comment must record WHY this is not a pure t2s→s2t round trip: the round trip is lossy on many-to-one chars and corrupts real Traditional names (鍾鎮濤 → 鐘鎮濤, 髮如雪 → 發如雪, 臺灣 → 台灣, lone 髮/乾/麵/隻/鬆 → 發/干/面/只/松). Also note the probed outcomes briefly (周杰倫 stays, 周杰伦 → 周杰倫, 頭发 → 頭髮 where direct s2t gave 頭發) and that on every probed input the merge equals direct s2t or strictly improves it.

    lockScriptSync: change only the dispatch line so the zh-Hant branch calls the helper instead of s2tConvertLineSync; zh-Hans branch (t2sConvertLineSync) unchanged; keep `return converted ?? text`. It stays synchronous, never-throw, never-null, network-free. Update its doc comment step 3 to say zh-Hant goes through the merge helper (quick-260926-bxg) and zh-Hans through t2s.

    warmScript (locked decision 3): for 'zh-Hant' await both builds; for 'zh-Hans' keep awaiting only loadT2sConvertLine(). Use Promise.allSettled([loadConvertLine(), loadT2sConvertLine()]), not Promise.all. Reason, to put in the comment: Promise.all rejects on the FIRST failure while the other build is still in flight, so a fast t2s chunk failure would resolve warmScript early, names.warmLock would bump rev before s2t landed, and the lock would stay cold until some unrelated re-render. allSettled waits for BOTH, which is the locked intent ("rev bump fires only after the merge is fully warm"). Keep the existing try/catch around the whole thing so warmScript still resolves void and never rejects. Both dicts stay behind their existing dynamic import() calls (lazy, D-03); do not add any static tongwen import. Update the warmScript doc comment (it currently says "for ONE direction").

    Stale doc comments to fix (locked decision 3), each with a quick-260926-bxg note:
    - s2tConvertLineSync doc (~line 99-101): the claim "Already-Traditional input passes through unchanged (s2t leaves 台灣 as 台灣)" is false in general. Say it holds for 台灣 but NOT for every Traditional string (周杰倫 → 周傑倫, because the phrase table is keyed on Simplified), and that the script lock therefore goes through the merge in lockScriptSync rather than calling this directly.
    - s2tConvertLines doc (~line 131-132, "Already-Traditional input is a no-op"): same correction, one sentence.
    - The t2s COST block (~line 162-171): add that a zh-Hant LOCK user now also downloads the ~22 KB gzip t2s dict, because warmScript('zh-Hant') builds both directions for the merge.
    Keep every existing decision-ref comment (D-01, D-03, D-04, quick-250711-zh, quick-260712-et3, quick-260807-vl1, quick-260919-2jo). Tabs, single quotes.

    GREEN: run the file's tests until all pass. Then run the full gate and commit.
  </action>
  <verify>
    <automated>pnpm exec vitest --run src/lib/services/zh-convert.test.ts src/lib/stores/lyric-script.svelte.test.ts src/lib/stores/names.test.ts && grep -n 'Promise.allSettled(\[loadConvertLine(), loadT2sConvertLine()\])' src/lib/services/zh-convert.ts && grep -c 'quick-260926-bxg' src/lib/services/zh-convert.test.ts && pnpm test && pnpm check && pnpm build</automated>
  </verify>
  <done>
    lockScriptSync('周杰倫', 'zh-Hant') returns 周杰倫; all new quick-260926-bxg tests pass; existing zh-convert, lyric-script and names tests stay green; `pnpm test && pnpm check && pnpm build` green. Committed on the current branch (claude/festive-kapitsa-dac746) as `fix(quick-260926-bxg): make the zh-Hant script lock idempotent on already-Traditional text`, with the message ending in `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`. Not pushed.
  </done>
</task>

<task type="auto">
  <name>Task 2: Delete lockAlias() — aliases route straight through applyLock</name>
  <files>src/lib/stores/names.svelte.ts, src/lib/stores/names.test.ts</files>
  <action>
    Per locked decision 4, in src/lib/stores/names.svelte.ts:
    - Delete the `lockAlias(a: string)` method and its doc comment (~lines 373-386) entirely.
    - dnArtist and dnTitle: change the alias branch from `this.lockAlias(a)` to `this.applyLock(a)`. Nothing else in those methods changes.
    - Rewrite the quick-260925-x8o block comment just above (~lines 364-371). Keep the quick-260925-x8o ref and its reasoning (aliased text bypasses resolveTranslated and goes to applyLock only; titleLang 'en' would undo 珊瑚海; no network on the render path; the translation cache is never written with alias text; applyLock renders the selected script). Replace any wording that describes an alias-specific Simplified round trip with a quick-260926-bxg note: the fold that keeps an already-Traditional alias like 周杰倫 from over-converting to 周傑倫 now lives in the shared seam (zh-convert.ts lockScriptSync's zh-Hant merge), so aliases and upstream names get identical treatment, and the old alias-only pure round trip, which corrupted names like 鍾鎮濤 → 鐘鎮濤, is gone. Do not write the literal token `lockAlias(` anywhere (the verify gate greps for it).
    - warm() comment (~lines 433-435): add one short quick-260926-bxg clause noting that under the zh-Hant lock warmLock now builds BOTH dicts (warmScript('zh-Hant') awaits s2t and t2s for the merge). No logic change.
    - Leave `lockScriptSync`, `warmScript`, `ZhScript` imports as they are (still used by applyLock/warmLock). Keep every other decision-ref comment.

    In src/lib/stores/names.test.ts (alias describe, quick-260925-x8o):
    - Simplify its local warmLock helper (~lines 339-344) to a single `await zh.warmScript(target)`, and change its doc comment to say warmScript('zh-Hant') now warms both dicts itself (quick-260926-bxg). This is behaviour-equivalent and it makes the alias test prove that one warm call is enough.
    - Replace the ~line 374 comment "(see lockAlias)" with a reference to the shared lock, e.g. that a raw s2t of the Traditional alias over-converts 杰, and the zh-Hant merge in lockScriptSync keeps it (quick-260926-bxg). The assertion `names.dnArtist('Jay Chou')` === '周杰倫' stays exactly as is.
    Tabs, single quotes (names.test.ts is not an i18n file).
  </action>
  <verify>
    <automated>! grep -n 'lockAlias(' src/lib/stores/names.svelte.ts src/lib/stores/names.test.ts && grep -c 'this.applyLock(a)' src/lib/stores/names.svelte.ts && pnpm exec vitest --run src/lib/stores/names.test.ts src/lib/stores/lyric-script.svelte.test.ts src/lib/services/zh-convert.test.ts && pnpm test && pnpm check && pnpm build</automated>
  </verify>
  <done>
    No `lockAlias(` definition or call remains; `this.applyLock(a)` appears twice (dnArtist, dnTitle); the alias tests still assert 周杰倫 / 珊瑚海 under zh-Hant and 周杰伦 under zh-Hans using a single warmScript(target) call; `pnpm test && pnpm check && pnpm build` green. Committed on the current branch as `refactor(quick-260926-bxg): drop lockAlias now that the shared lock folds Traditional input`, message ending in `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`. Not pushed, main untouched.
  </done>
</task>

</tasks>

<threat_model>
## Trust Boundaries

| Boundary | Description |
|----------|-------------|
| upstream catalog → display | Artist/title strings from CN sources are untrusted text, but they are only script-converted and rendered as text (Svelte escapes). No new boundary is crossed. |

## STRIDE Threat Register

| Threat ID | Category | Component | Disposition | Mitigation Plan |
|-----------|----------|-----------|-------------|-----------------|
| T-bxg-01 | Denial of Service | lockScriptSync zh-Hant merge (runs per render, per lyric line) | accept | Three linear tongwen passes plus Array.from over a short name/line. Same order of work as today's single pass, with no network and no allocation beyond the line. |
| T-bxg-02 | Denial of Service | warmScript('zh-Hant') dual build | mitigate | Promise.allSettled + the existing try/catch keep it never-rejecting; each loader already un-caches a rejected build, and names.warmLock stays latched per direction, so there is no retry storm (T-2jo-03 unchanged). |
| T-bxg-03 | Tampering | persisted `settings.zhScript` | accept | Unchanged: applyLock still returns input byte-for-byte for any value other than the two scripts (T-2jo-02). |
</threat_model>

<verification>
- `pnpm test && pnpm check && pnpm build` all green after each task.
- lockScriptSync('周杰倫', 'zh-Hant') === '周杰倫' and lockScriptSync('周杰伦', 'zh-Hant') === '周杰倫' (zh-convert.test.ts).
- 鍾鎮濤 / 髮如雪 / 臺灣 / 麵 unchanged under zh-Hant, and the lock is idempotent on the listed inputs.
- names.test.ts alias tests pass with warmScript(target) alone; lyric-script.svelte.test.ts unchanged and green.
- `git log --oneline -2` shows the two quick-260926-bxg commits on claude/festive-kapitsa-dac746; `git status` clean; nothing pushed.
</verification>

<success_criteria>
- The zh-Hant script lock renders one spelling per artist whichever script the source returned, and never rewrites an already-Traditional character into a different Traditional form.
- The only alias-specific lock code is gone; aliases, rows, Now Playing, media card, document title, download tags and lyrics all share one lock implementation.
- The t2s-cold and fully-cold degrade paths are no worse than before (direct s2t, then identity).
</success_criteria>

<output>
Create `.planning/quick/260926-bxg-zh-hant-lockscriptsync-idempotent-for-al/260926-bxg-SUMMARY.md` when done.
</output>
