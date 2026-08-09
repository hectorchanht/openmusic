---
quick_id: 260808-urx
slug: share-link-carries-display-language-name
status: planned
title: "Share link carries display-language names; playback resolver normalizes zh internally"
files_modified:
  - src/lib/components/TrackMenu.svelte
  - src/routes/(app)/album/[name]/+page.svelte
  - src/routes/(app)/artist/[name]/+page.svelte
  - src/lib/services/share.ts
  - src/lib/stores/names.test.ts
  - src/lib/services/discovery.ts
  - src/lib/services/discovery.test.ts
autonomous: true
must_haves:
  truths:
    - "A zh-Hant user who sees 夢伴 by 李悅君 on screen shares https://…/song/李悅君/夢伴 — the DISPLAY strings, never the raw Simplified catalog metadata"
    - "share.ts stays PURE — it never imports the names store; callers pass already-resolved display strings"
    - "The dn/da QUERY carriers stay dead (OG-ZH-01 not reversed): display text rides the PATH, the single value used for both display and resolution"
    - "resolveStub rescues a Chinese-script miss with exactly ONE t2s-normalized retry; a non-Chinese miss and an already-Simplified miss trigger ZERO extra searchAll calls (enforced by call-count assertions, not prose)"
    - "A superseded playStub resolve is still discarded — the retry lives inside the single awaited resolveStub call, so player.svelte.ts's existing `gen !== this.pendingGen` check after that await covers it"
  artifacts:
    - path: "src/lib/services/discovery.ts"
      provides: "resolveStub t2s rescue-on-miss (quick-260808-urx), gated on isChineseLine + non-identity conversion"
      contains: "t2sConvertLines"
    - path: "src/lib/stores/names.test.ts"
      provides: "composition test: zh-Hant display resolution + songShareUrl → Traditional path segments"
  key_links:
    - from: "src/lib/components/TrackMenu.svelte"
      to: "src/lib/services/share.ts"
      via: "songShareUrl called with names.dnTitle/names.dnArtist output"
      pattern: "songShareUrl\\(\\{ title: names\\.dnTitle"
    - from: "src/lib/services/discovery.ts"
      to: "src/lib/services/zh-convert.ts"
      via: "miss-path retry calls t2sConvertLines([artist, title]) gated on isChineseLine"
      pattern: "t2sConvertLines"
---

<objective>
The user complaint: the artist/song names in a share link must be in the USER'S preferred display
language — "if the user is zht for artist name and song name, it should not show in zhs while
sharing." Simplified is an internal resolution concern, not something the recipient should read.

Two halves, one plan:

- **Half A (user-visible fix):** share URLs are built from the DISPLAY names (`names.dnTitle` /
  `names.dnArtist`) instead of raw source metadata, at the three call sites. `share.ts` stays pure.
- **Half B (make Half A safe by design):** the shared playback resolver (`resolveStub`) gains an
  internal t2s rescue-on-miss, so a Traditional path segment resolving against the
  mostly-Simplified CN catalogs no longer depends on the incidental fact that CN sources happen to
  index Traditional today.

Already done elsewhere — do NOT redo: raw-CJK path encoding (percent-escape removal) shipped in
quick-260807-vl1 (`encodePathSegment`, `share.test.ts:114`). Production still shows `%E6%9D%8E…`
only because that commit is NOT deployed — a deploy gap, not a bug. Do NOT plan or run a deploy:
`pnpm run deploy` currently fails on stale wrangler OAuth and needs an interactive `wrangler
login`; production verification belongs to the user.

Output: two commits (one per task) on the current branch, all gates green.
</objective>

<context>
@.planning/STATE.md
@./CLAUDE.md
@src/lib/components/TrackMenu.svelte            (share call site :174, comment block :160-173)
@src/routes/(app)/album/[name]/+page.svelte     (entityCardUrl :435, comment block above it)
@src/routes/(app)/artist/[name]/+page.svelte    (entityCardUrl :181, comment block above it)
@src/lib/services/share.ts                       (songShareUrl :250, entityCardUrl :275 — PURE, keep it so)
@src/lib/stores/names.svelte.ts                  (resolve :189-232, dnArtist :235, dnTitle :240)
@src/lib/services/zh-convert.ts                  (t2sConvertLines :223, isChineseLine :121 — REUSE, no new converter)
@src/lib/services/discovery.ts                   (resolveStub :32-54 — the shared resolver every play path routes through)
@src/lib/stores/player.svelte.ts                 (playStub :2394-2437 — pendingGen guard at :2421)
@src/lib/services/discovery.test.ts              (existing vi.spyOn(catalog, 'searchAll') pattern)
@src/lib/stores/names.test.ts                    (existing browser/settings/detect mocks; zh-Hant sync-s2t tests)
@.planning/quick/260807-vl1-og-card-fixes-raw-cjk-share-links-title-/260807-vl1-SUMMARY.md
@.claude/skills/spike-findings-openmusic/SKILL.md

<interfaces>
<!-- Verified signatures — use directly, no exploration. -->

From src/lib/services/share.ts (PURE — must NOT import any store):
```typescript
export function songShareUrl(t: { title: string; artist: string }): string;
export function entityCardUrl(opts: { type: 'album' | 'artist'; name: string; artist?: string }): string;
```
Do NOT widen these signatures — callers pass already-resolved display strings.

From src/lib/stores/names.svelte.ts (runes store singleton `names`):
```typescript
dnTitle(text: string): string;   // titleLang + titleSkip; cache hit OR raw-text fallback
dnArtist(text: string): string;  // artistLang + artistSkip; same contract
```
Reliability, ALREADY VERIFIED — state in a comment, don't re-check: `resolve()` returns the cached
display string and falls back to the RAW text on a cache miss, so share time returns exactly what
the UI rendered (if the user SEES 夢伴, dnTitle already returned 夢伴 and returns it again). For
zh-Hant the s2t dict is warmed at boot (quick-260712-et3), so resolution is synchronous.

From src/lib/services/zh-convert.ts:
```typescript
export async function t2sConvertLines(lines: string[]): Promise<string[]>; // positional, identity on failure/non-zh
export function isChineseLine(text: string): boolean;                      // kana/hangul-first — JA/KO return false
```

From src/lib/services/discovery.ts:
```typescript
export async function resolveStub(artist: string, title: string): Promise<Track | null>; // never throws
```

From src/lib/stores/player.svelte.ts playStub (:2412-2421): `tr = await resolveStub(artist, title)`
then `if (gen !== this.pendingGen) return null;` — ONE await, ONE guard check after it.
</interfaces>
</context>

<tasks>

<task type="auto" tdd="true">
  <name>Task 1: Share links carry the DISPLAY-language names (Half A)</name>
  <files>src/lib/components/TrackMenu.svelte, src/routes/(app)/album/[name]/+page.svelte, src/routes/(app)/artist/[name]/+page.svelte, src/lib/services/share.ts, src/lib/stores/names.test.ts</files>
  <behavior>
    Add to src/lib/stores/names.test.ts (composition test, riding the file's existing
    browser:true / settings / detect mocks and its warm-s2t zh-Hant setup):
    - With the zh-Hant sync path warm, `names.dnTitle('梦伴')` returns '夢伴' and
      `names.dnArtist('李悦君')` returns '李悅君' (warm the dict the same way the existing
      zh-Hant tests in this file do — e.g. await an s2t conversion or warmS2T + the load promise).
    - `songShareUrl({ title: names.dnTitle('梦伴'), artist: names.dnArtist('李悦君') })` produces a
      URL whose path is exactly `/song/李悅君/夢伴` — the Traditional (display) segments, proving
      the caller-side composition yields a display-language link. (share.ts itself stays untested
      for language — it is pure passthrough; the test asserts the COMPOSITION.)
  </behavior>
  <action>
    Change the three share call sites to pass DISPLAY strings instead of raw source metadata.
    `names` is ALREADY imported in all three files — no new imports.

    1. src/lib/components/TrackMenu.svelte doShare() (:174): build
       `songShareUrl({ title: names.dnTitle(track.title), artist: names.dnArtist(track.artist) })`.
       Also build the `nav.share` sheet title (:177) from the same two display strings (the OS
       share sheet is user-visible text too). Compute each display string ONCE into a local so
       URL and sheet title agree.
    2. src/routes/(app)/album/[name]/+page.svelte (:435):
       `entityCardUrl({ type: 'album', name: names.dnTitle(name), artist: names.dnArtist(albumArtist) })`
       — mind the existing `albumArtist ?? ''` handling: only convert when albumArtist is truthy
       (dnArtist('') is harmless but keep the existing falsy branch of the share-sheet title
       intact). Share-sheet title uses the same display strings.
    3. src/routes/(app)/artist/[name]/+page.svelte (:181):
       `entityCardUrl({ type: 'artist', name: names.dnArtist(name) })`; share title likewise.

    COMMENTS (house style — high density, quick-260808-urx tag, do NOT delete existing decision
    refs). At each call site AMEND the existing OG-ZH-01 / quick-260723-r4p comment block (keep
    the refs, correct the now-stale prose) with:
    - quick-260808-urx: the link now carries the DISPLAY-language names — the exact text the
      sharer sees on screen — per the user's explicit ask ("zht user must not share zhs").
    - This is NOT a reversal of OG-ZH-01: the `dn`/`da` QUERY CARRIERS stay dead. Display text
      goes in the PATH, which is the single value used for both display and resolution.
    - Reliability (verified, don't re-check): names.resolve() returns the cached display string
      and falls back to the raw text on a miss, so share time returns exactly what the UI
      rendered; the zh-Hant s2t dict is boot-warmed (quick-260712-et3), so it is synchronous.
    - The recipient-side resolution risk this reintroduces (Traditional query vs mostly-Simplified
      CN index) is closed by the resolver's t2s rescue-on-miss (Task 2 / quick-260808-urx).

    src/lib/services/share.ts: CODE UNCHANGED — it must stay pure (no `names` import; CLAUDE.md:
    stores never flow into pure services) and the signatures must not widen. Only AMEND the
    songShareUrl / entityCardUrl doc comments where they assert "the LITERAL (original-script)
    title/artist go in the path" — note that callers now pass DISPLAY-language strings
    (quick-260808-urx) and the resolver normalizes zh internally on miss. Keep OG-ZH-01 refs.

    Style: tabs, single quotes, runes untouched, `import type` where applicable, zero `as any`.

    Commit: `fix(share): carry display-language names in share links (quick-260808-urx)`.
  </action>
  <verify>
    <automated>cd /Users/laichan/code/tung/openmusic && pnpm test -- src/lib/stores/names.test.ts src/lib/services/share.test.ts && pnpm check</automated>
  </verify>
  <done>
    All three call sites pass names.dn* output to songShareUrl/entityCardUrl; share.ts has no
    store import (grep -c "stores/names" src/lib/services/share.ts → 0); the new names.test.ts
    composition test asserts a `/song/李悅君/夢伴` path from Simplified inputs under zh-Hant;
    pnpm check reports 0 errors 0 warnings; existing 55 share.test.ts assertions still green.
  </done>
</task>

<task type="auto" tdd="true">
  <name>Task 2: resolveStub t2s rescue-on-miss (Half B)</name>
  <files>src/lib/services/discovery.ts, src/lib/services/discovery.test.ts</files>
  <behavior>
    Add to src/lib/services/discovery.test.ts, using the file's existing
    `vi.spyOn(catalog, 'searchAll')` pattern and the REAL t2sConvertLines (deterministic offline
    dict; Vitest resolves the dynamic JSON imports natively — see zh-convert.ts header). All
    call-count assertions are exact (`toHaveBeenCalledTimes`), never prose:
    - Traditional miss → Simplified hit: searchAll mocked to return EMPTY for the first call and
      a hit for the second; `resolveStub('周傑倫', '止戰之殤')` returns the hit; searchAll called
      EXACTLY 2×; the second call's query string contains the t2s form ('周杰伦' / '止战之殇' —
      the production-verified pair from quick-260807-vl1).
    - Chinese hit on first try: searchAll returns a hit immediately → EXACTLY 1 call (no retry).
    - Non-Chinese miss: `resolveStub('Adele', 'Hello')` with searchAll returning empty → null and
      searchAll called EXACTLY 1× (isChineseLine gate — a non-Chinese miss must NOT trigger an
      extra search).
    - Already-Simplified Chinese miss: `resolveStub('周杰伦', '止战之殇')` with empty results →
      null and EXACTLY 1 call (identity conversion → retry skipped).
    - Retry miss too: both calls empty for Traditional input → null, EXACTLY 2 calls (retry fires
      once, never loops).
  </behavior>
  <action>
    In src/lib/services/discovery.ts, extend resolveStub with a single t2s-normalized retry on a
    miss. Extract the existing search+score pass (searchAll → dedupeBest → scoreMatch stable-max)
    into a local `async function attempt(artist: string, title: string): Promise<Track | null>`
    so the retry reuses it verbatim instead of duplicating the loop — the retry's scoreMatch
    query uses the CONVERTED {artist, title}, matching what was searched. Then:

    - First attempt with the original strings. On a non-null result, return it (unchanged path).
    - On a miss, gate: `isChineseLine(artist) || isChineseLine(title)` (per-field, so a mixed
      Latin-artist/Chinese-title stub still qualifies; isChineseLine's kana/hangul-first
      classifier keeps JA/KO out). If neither is Chinese → return null, ZERO extra work.
    - `const [a2, t2] = await t2sConvertLines([artist, title])` (REUSE from $lib/services/zh-convert
      — do NOT write a second converter). If `a2 === artist && t2 === title` (identity — input was
      already Simplified, or the converter degraded to identity) → return null, NO second search.
    - Else return `attempt(a2, t2)` — exactly ONE retry, inside the existing try/catch so the
      never-throw contract holds.

    COMMENTS (quick-260808-urx on each non-obvious choice; keep existing D-02/D-03/LFSRC-03 refs):
    - WHY HERE, not in player.playStub: resolveStub is the shared resolver EVERY resolve path
      routes through (playStub taps, song-share page opens, long-press menus, album batch
      resolve, DownloadControl) — one rescue here fixes all of them, where a playStub-only patch
      would leave the sibling callers Traditional-blind. And the pendingGen guard is satisfied
      for free: playStub awaits resolveStub ONCE and re-checks `gen !== this.pendingGen`
      immediately after (player.svelte.ts:2421), so the guard runs after the retry's await too —
      a superseded resolve is discarded regardless of how many internal searches ran. NO
      player.svelte.ts change is needed (also avoids growing the known god object).
    - DELIBERATE ASYMMETRY vs covers: og-cover.ts converts FIRST (Traditional missed all three
      tiers 3/3 deterministically on production, so converting first cost nothing and fixed it);
      playback converts ON MISS only, because Traditional playback currently WORKS (CN sources
      happen to index Traditional) — converting first would change a working path for no reason.
      Rescue-on-miss is the conservative shape. Half A putting Traditional in share URLs BY
      DESIGN is what turns that incidental dependency load-bearing; this retry removes it.
    - Cost: t2s dict is lazy + memoized (~22 KB gzip, quick-260807-vl1) and loads only on the
      first Chinese-script miss — zero cost for the common hit path and for non-Chinese users.

    Style: tabs, single quotes, `import type` for Track (already), zero `as any` in production
    source (test-file `as any` is fine per existing convention).

    Commit: `fix(resolve): t2s rescue-on-miss in resolveStub (quick-260808-urx)`.
  </action>
  <verify>
    <automated>cd /Users/laichan/code/tung/openmusic && pnpm test && pnpm check</automated>
  </verify>
  <done>
    resolveStub retries EXACTLY once with t2s-normalized terms, only after a miss, only for
    Chinese input, only when conversion changed something — each branch enforced by an exact
    searchAll call-count assertion in discovery.test.ts; full suite green (baseline 89 files /
    1515 tests, plus this plan's additions); pnpm check 0 errors 0 warnings; no change to
    player.svelte.ts.
  </done>
</task>

</tasks>

<verification>
Final gates, all must pass from a clean tree after both commits:

1. `pnpm test` — green (baseline 89 test files / 1515 tests + the new assertions; no skips added).
2. `pnpm check` — 0 errors, 0 warnings (baseline 4368 files 0/0).
3. `pnpm build` — exit 0 (adapter-cloudflare).
4. `pnpm build:native` — exit 0 (adapter-static / Capacitor).

Optional live smoke (dev server — resolve the port, DON'T assume; both are real):
`DEV=http://localhost:4321; curl -sf -o /dev/null "$DEV" || DEV=http://localhost:5173` — then with
a zh-Hant display setting, sharing a Simplified-catalog song from the track menu copies a URL whose
path segments are the Traditional on-screen strings. A curl failing on the wrong port is NOT a
failed criterion.

Deploy is explicitly OUT OF SCOPE: `pnpm deploy` hits pnpm's builtin (`ERR_PNPM_CANNOT_DEPLOY`);
the working `pnpm run deploy` currently fails on stale wrangler OAuth (`Authentication error
[code: 10000]`) and needs an interactive `wrangler login`. Production verification (including the
already-committed quick-260807-vl1 raw-CJK links) is the USER'S step after they deploy.
</verification>

<success_criteria>
- A zh-Hant user sharing 夢伴 / 李悅君 gets `/song/李悅君/夢伴` — the exact on-screen text — from
  TrackMenu; album/artist cards likewise carry display-language path segments.
- `dn`/`da` query carriers remain retired; no query string reappears on any share URL.
- share.ts remains pure (no store imports, signatures unwidened).
- resolveStub rescues Chinese-script misses with exactly one t2s retry; non-Chinese and
  already-Simplified misses provably (call-count) trigger no extra search.
- player.svelte.ts untouched; the pendingGen supersedence contract is preserved by construction.
- All four gates green: test, check, build, build:native.
</success_criteria>

<output>
Create `.planning/quick/260808-urx-share-link-carries-display-language-name/260808-urx-SUMMARY.md`
when done (quick-task summary: what changed, per-task commits, gate results, and the explicit note
that deploy + production verification remain with the user).
</output>
