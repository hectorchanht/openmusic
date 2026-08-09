---
quick_id: 260808-urx
slug: share-link-carries-display-language-name
status: complete
title: "Share link carries display-language names; playback resolver normalizes zh internally"
completed: 2026-08-08
tasks: 2
commits:
  - 2734543: "fix(share): carry display-language names in share links (quick-260808-urx)"
  - e9229da: "fix(resolve): t2s rescue-on-miss in resolveStub (quick-260808-urx)"
key-files:
  created: []
  modified:
    - src/lib/components/TrackMenu.svelte
    - src/routes/(app)/album/[name]/+page.svelte
    - src/routes/(app)/artist/[name]/+page.svelte
    - src/lib/services/share.ts
    - src/lib/stores/names.test.ts
    - src/lib/services/discovery.ts
    - src/lib/services/discovery.test.ts
metrics:
  tests_before: 1515
  tests_after: 1528
  check: "4368 files, 0 errors, 0 warnings"
---

# Quick Task 260808-urx — Display-language share links Summary

A zh-Hant user sharing 夢伴 / 李悅君 now gets `/song/李悅君/夢伴` — the exact on-screen text — instead
of the Simplified catalog metadata; and the shared resolver rescues a Traditional miss with one
t2s-normalized retry, so putting Traditional in a share URL by design no longer depends on the
incidental fact that CN sources currently index Traditional.

## What shipped

### Task 1 — display-language share links (`2734543`)

The three share call sites now pass `names.dnTitle` / `names.dnArtist` output instead of raw source
metadata. Each computes its display strings ONCE into locals so the URL and the OS share-sheet title
(also user-visible text) cannot disagree.

| Call site | Before | After |
|---|---|---|
| `TrackMenu.svelte` `doShare()` | `songShareUrl({ title: track.title, artist: track.artist })` | `dTitle = names.dnTitle(track.title)`, `dArtist = names.dnArtist(track.artist)` → URL + `${dTitle} • ${dArtist}` sheet title |
| `album/[name]/+page.svelte` `shareAlbum()` | `entityCardUrl({ type:'album', name, artist: albumArtist })` | `dName = names.dnTitle(name)`, `dArtist = names.dnArtist(albumArtist)`; the `albumArtist`-falsy branch of the sheet title is preserved (`dArtist ? … : dName`) |
| `artist/[name]/+page.svelte` `shareArtist()` | `entityCardUrl({ type:'artist', name })` | `dName = names.dnArtist(name)`, used for both URL and title |

- **`share.ts` CODE IS UNCHANGED.** `grep -c "stores/names" src/lib/services/share.ts` → **0**; the
  `songShareUrl` / `entityCardUrl` signatures are not widened. Only the doc comments were amended:
  the now-stale "the LITERAL (original-script) title/artist go in the path" claim, and the
  album/artist "accepted regression — the sharer's card shows the catalog's original script" note,
  which no longer applies to the sharer's own link.
- **OG-ZH-01 is NOT reversed.** The `dn`/`da` QUERY carriers stay dead — asserted in the new test
  (`expect(url).not.toContain('?')`). Display text rides the PATH, which is the *single* value used
  for both display and resolution, so there is no carrier left to diverge from the round-trip key.
  That divergence, not Traditional text itself, is what OG-ZH-01 killed. All existing decision-ref
  comments (OG-ZH-01, OG-EP-01, OG-PATH-01/02, D-04, D-06, quick-260723-r4p/ry1) were kept and only
  their stale prose corrected.
- Tests added to `names.test.ts`: the settings mock became a `vi.hoisted` MUTABLE fixture (restored
  to `'ja'` in `beforeEach`, so every pre-existing machinery assertion runs against the exact old
  fixture) and the `$lib/i18n/detect` mock now spreads `importOriginal` — a bare
  `{ shouldTranslate }` factory left `detectLang` undefined, which the zh-Hant sync path needs.

### Task 2 — `resolveStub` t2s rescue-on-miss (`e9229da`)

The search+score pass (`searchAll` → `dedupeBest` → `scoreMatch` stable-max) was extracted verbatim
into a private `attempt(artist, title)`; `resolveStub` is now first-attempt → two gates → one retry.

- **Gate 1 (script):** `isChineseLine(artist) || isChineseLine(title)` — per-field, so a mixed
  Latin-artist / Chinese-title stub still qualifies; the kana/hangul-first classifier keeps JA/KO out.
- **Gate 2 (identity):** if `t2sConvertLines` returned the input unchanged (already Simplified, or the
  converter degraded to its never-throw identity fallback) → return null, no second search.
- Retry scores against the CONVERTED query, matching what it actually searched. The single try/catch
  still wraps everything, so the never-throw contract holds through the retry.
- `t2sConvertLines` is **reused** from `zh-convert.ts` (quick-260807-vl1) — no second converter.
- **`player.svelte.ts` is untouched** (`git diff --name-only` across both commits confirms). The
  supersedence contract holds by construction: `playStub` awaits `resolveStub` once and re-checks
  `gen !== this.pendingGen` immediately after that await (`:2421`), which necessarily runs after the
  retry's await too. No second generation guard was added.
- Placement rationale recorded in code: `resolveStub` is the shared resolver every resolve path
  routes through (~15 call sites — playStub, home, charts tags/countries, album, DownloadControl), so
  a `playStub`-only patch would leave every sibling caller Traditional-blind.
- The deliberate asymmetry vs covers is recorded in code and tagged `quick-260808-urx`: `og-cover.ts`
  converts FIRST (Traditional missed all three tiers 3/3 on production, so converting first cost
  nothing); playback converts ON MISS only, because Traditional playback currently works and
  converting first would change a working path for no reason.

## Verification (observed, not inferred)

| Gate | Baseline | Observed |
|------|----------|----------|
| `pnpm test` | 89 files / **1515** tests | **89 files / 1528 tests passed** (+13: 6 names, 7 discovery) |
| `pnpm check` | 4368 files 0/0 | **4368 files, 0 ERRORS, 0 WARNINGS, 0 files with problems** |
| `pnpm build` | exit 0 | **exit 0** (`Using @sveltejs/adapter-cloudflare … ✔ done`) |
| `pnpm build:native` | exit 0 | **exit 0** (`Using @sveltejs/adapter-static … Wrote site to "build"`) |

Per-task gates were run and observed before each commit (Task 1: `names.test.ts` + `share.test.ts`
66/66 + `pnpm check` 0/0; Task 2: full suite + check).

**RED was observed for both tasks before implementing:**
- Task 1: 3 failing (`TrackMenu` / album / artist "builds its share URL from names.dn* display
  strings") against the un-changed call sites.
- Task 2: 3 failing (Traditional-miss retry, retry-miss call count, converted-query scoring) — while
  the two zero-cost gates (non-Chinese, already-Simplified) already passed, correctly, since a
  no-retry resolver trivially satisfies "exactly 1 call".

**Zero-cost guarantee is enforced by exact call counts, not prose** — `toHaveBeenCalledTimes(1)` for
a non-Chinese miss (`Adele`/`Hello`) and for an already-Simplified miss (`周杰伦`/`止战之殇`);
`toHaveBeenCalledTimes(2)` for the Traditional hit and the Traditional double-miss (never loops).

### Dev smoke — port RESOLVED, not assumed

`:4321` did not answer; `:5173` did (a `pnpm dev` started for this check, `Local: http://localhost:5173/`),
so every curl below ran against `http://localhost:5173` and the server was stopped afterwards.

```
/                        → 200
/song/李悅君/夢伴  (Traditional — what Half A now emits)  → 200
/song/李悦君/梦伴  (Simplified — the pre-change form)     → 200
/artist/李悅君                                            → 200
/album/李悅君/夢伴                                        → 200

og:title on /song/李悅君/夢伴 → "夢伴 • 李悅君"
og:title on /artist/李悅君     → "李悅君"
```

So the Traditional display-language paths this change emits are routable and their OG head reads
back the Traditional text.

**Not verified — the user's step.** No browser UAT of the actual share gesture (the share sheet /
clipboard needs a real device + a zh-Hant display setting), and **no deploy**: `pnpm deploy` hits
pnpm's builtin (`ERR_PNPM_CANNOT_DEPLOY`) and the working `pnpm run deploy` currently fails on stale
wrangler OAuth (`Authentication error [code: 10000]`), needing an interactive `wrangler login`.
Production verification — of this change AND of the still-undeployed quick-260807-vl1 raw-CJK links,
which is why production still shows `%E6%9D%8E…` — remains with the user.

Half B also has no live evidence by construction: `resolveStub` is client-side (it reads the
`settings` store), so there is no endpoint to curl. Its evidence is the exact-call-count unit tests.

## TDD Gate Compliance

RED was run and observed for both tasks (counts above), but **each task is ONE commit**, not a
`test(...)` → `feat(...)` pair, because the plan prescribes exactly one commit per task with a named
message. So `git log` shows two `fix(...)` commits, each containing its tests and its implementation,
rather than separate RED/GREEN gate commits.

## Deviations from Plan

### Auto-fixed

**1. [Rule 3 - Blocking] `names.test.ts`'s `$lib/i18n/detect` mock hid `detectLang`**

- **Found during:** Task 1, writing the zh-Hant composition test.
- **Issue:** the file mocked the whole module as `{ shouldTranslate: () => true }`. `zh-convert.ts`'s
  `isChineseLine` — which `names.svelte.ts` calls on the zh-Hant sync path — imports `detectLang`
  from that same module, so under the mock it was `undefined` and the path threw.
- **Fix:** `vi.mock('$lib/i18n/detect', async (importOriginal) => ({ ...(await importOriginal()), shouldTranslate: () => true }))`
  — keeps the real classifier, still forces the decision layer to `true`, so the pre-existing 'ja'
  machinery tests are behaviourally unchanged (all 5 still pass).
- **Files:** `src/lib/stores/names.test.ts`. **Commit:** `2734543`.

**2. [Rule 2 - Missing critical] The plan's composition test could not fail**

- **Found during:** Task 1, at the RED step.
- **Issue:** the plan's specified test (`songShareUrl({ title: names.dnTitle('梦伴'), … })` → `/song/李悅君/夢伴`)
  **passed before any production change** — it asserts a composition that `share.ts` (pure
  passthrough) already supports. It proves the composition is correct but cannot catch a call site
  that never adopts it, so the plan's must-have truth #1 would have been untested.
- **Fix:** added a structural `it.each` over the three call-site files asserting BOTH that the
  `names.dn*` form is present AND that the raw-metadata form (`songShareUrl({ title: track.title`,
  `entityCardUrl({ type: 'album', name, artist: albumArtist })`, `entityCardUrl({ type: 'artist', name })`)
  is GONE. This is the same guard the plan encodes as `key_links.pattern`, and it is the half that
  fails on a revert. A `.svelte` component's `doShare()` is not exported and the project has no jsdom
  project, so importing the real function is not available; the plan's own composition test is kept
  alongside it. Reason recorded in a comment above the block.
- **Files:** `src/lib/stores/names.test.ts`. **Commit:** `2734543`.

**3. [Rule 3 - Blocking] `names.test.ts`'s settings mock was immutable**

- **Found during:** Task 1.
- **Issue:** the mock hardcoded `artistLang: 'ja'` at module scope, so a zh-Hant test could not be
  added to the file the plan names.
- **Fix:** moved it to a `vi.hoisted` object and reset the four `*Lang` fields to `'ja'` in
  `beforeEach`, so the existing tests keep their exact fixture and only the new block flips to
  `'zh-Hant'`.
- **Files:** `src/lib/stores/names.test.ts`. **Commit:** `2734543`.

### Assumption Drift (advisory)

**1. Task 1's specified test is green-on-arrival, so its RED came from an added assertion**

- **Found during:** Task 1, RED step.
- **Planned:** `tdd="true"` on Task 1, implying the plan's composition test fails first.
- **Actual:** it passes against unmodified `share.ts` + unmodified call sites (see Deviation 2). The
  observed RED (3 failures) came from the added structural call-site guard.
- **Why it matters:** the RED/GREEN transition recorded above is real, but it is the guard's, not the
  composition test's. Nothing about the plan's design changed.

**2. Task 2's plan text says "extract into a local `async function attempt`"; it is module-scope**

- **Planned:** "Extract … into a local `async function attempt(...)`".
- **Actual:** `attempt` is a module-scoped non-exported function, not nested inside `resolveStub`.
  Nesting it would re-create the closure on every call for no benefit and would not be reachable for
  the retry any more cleanly.
- **Why it matters:** purely a placement detail; the call shape, reuse and privacy the plan asked for
  are unchanged (it is not exported, so nothing outside the module can reach it).

## Threat Flags

None. No new network surface, auth path, file access, or schema change. Half A moves already-rendered
in-app text into a path segment the app already emits (`encodePathSegment`'s escape set is unchanged,
so nothing new travels raw). Half B adds at most ONE extra call to the EXISTING `searchAll` with terms
derived by a pure in-process transform — the query is still built from the same two user-supplied
fields, and both gates strictly reduce when it fires.

## Known Stubs

None.

## Self-Check: PASSED

- `src/lib/services/discovery.ts` contains `t2sConvertLines` (Task 2 artifact `contains` check) —
  present.
- `src/lib/stores/names.test.ts` contains the zh-Hant → `/song/李悅君/夢伴` composition test — present.
- Commits `2734543` and `e9229da` both resolve in `git log`.
- `git diff --diff-filter=D --name-only` across both commits: **empty** — no file deletions.
- No untracked files left under `src/`; the working tree's remaining modifications
  (`.gitignore`, `.planning/HANDOFF.json`, `CLAUDE.md`, `docs/agents/`) pre-date this task and were
  not touched.
