---
quick_id: 260807-vl1
slug: og-card-fixes-raw-cjk-share-links-title-
status: complete
title: "OG card fixes: raw-CJK share links, convert-first t2s cover search, raster OG fallback"
completed: 2026-08-07
tasks: 3
commits:
  - 180630a: "fix(share): keep raw CJK in share path segments, escape only path-unsafe chars"
  - 16141c7: "fix(og): convert-first t2s cover query, two Deezer fallbacks, 5s resolve deadline"
  - 68f9857: "fix(og): serve a raster branded card and retire every SVG og:image"
key-files:
  created:
    - src/lib/proxy/og-fallback.ts
    - static/og.jpg
  modified:
    - src/lib/services/share.ts
    - src/lib/services/share.test.ts
    - src/lib/services/zh-convert.ts
    - src/lib/services/zh-convert.test.ts
    - src/lib/proxy/og-cover.ts
    - src/routes/api/og/+server.ts
    - src/routes/api/og/og-endpoint.test.ts
    - src/routes/+layout.svelte
    - src/lib/components/PageOg.svelte
  deleted:
    - .planning/todos/pending/og-png-raster-fallback.md
metrics:
  tests_before: 1500
  tests_after: 1515
  check: "4368 files, 0 errors, 0 warnings"
---

# Quick Task 260807-vl1 — OG card fixes Summary

Three Phase-30 crawler defects fixed: share links now carry raw CJK, the /api/og cover search
converts Traditional→Simplified **before** its first upstream query, and the branded fallback card
is a raster instead of an SVG no messenger renders.

## What shipped

### Task 1 — raw-CJK path segments (`180630a`)

`encodePathSegment` no longer runs `encodeURIComponent`. A single-pass replace escapes only
`% / \ ? #` and control chars (U+0000–U+001F, U+007F); all raw UTF-8 (CJK, emoji, Arabic) goes into
the path untouched. `songShareUrl({title:'止戰之殤',artist:'周傑倫'})` now ends with
`/song/周傑倫/止戰之殤` with zero percent-escapes.

- All three guards survive, test-asserted unchanged: `\s+`→`-`, `''`→`'-'`, `'..'`→`'..-'`.
- `decodePathSegment` diff is **empty** (verified: `git diff` touches no line of it) — adding a
  decode there is exactly the double-decode 500 Phase 30 fixed.
- Backslash is in the escape set with the reason recorded: WHATWG parsers normalize `\`→`/` in a
  special-scheme path, so a raw one splits the segment like `/`.
- Legal sub-delims (`& + : ; =`) now stay literal; every §B.7 round-trip case still round-trips
  through the `decodeSeg` helper that mirrors SvelteKit's single decode.

### Task 2 — convert-first t2s cover query (`16141c7`)

- **`zh-convert.ts`** gained `t2sConvertLines(lines)`: its own module-scoped memoized promise and
  its own `createConverterMap({ s2t: [], t2s: [char, phrase] })` build — deliberately NOT merged
  with the s2t map, so a t2s-only caller never drags s2t's 148,406-byte phrase dict into the edge
  bundle. Deep-imports `tongwen-core/esm/converter` + `/esm/dictionary` per the quick-250711-zh
  walker-free idiom. Never-throw identity fallback, no cached rejection. No sync/warm variant.
- **`og-cover.ts` `resolveCoverTiered`** now picks its search terms before the chain: gated on
  `isChineseLine`, it t2s-normalizes `[artist, title]`; if anything changed, the **Simplified forms
  are the primary query** and `substituted` is set. Then the unchanged Deezer→iTunes→kuwo chain, then
  **Fallback A** (original terms, Deezer only, only when substituted) and **Fallback B** (original
  title alone, Deezer only, non-artist cards with both fields non-empty). Worst case 5 resolves + 1
  image = 6.
- **`OG_RESOLVE_MS` 2500 → 5000**, with the derivation in its comment (measured 4.12 s CJK cold
  resolve vs 0.66–0.84 s Latin; 3–10 s crawler budget per 30-RESEARCH §D). `TIER_MS` and the route's
  `IMAGE_MS` left untouched.
- The convert-first ordering rationale (a retry-after design would stack a second round trip onto
  the slowest query class and, under the old budget, usually be skipped for lack of time — never
  firing on the case it exists for) is recorded in the code, as is the explicit note that this does
  **not** reverse OG-ZH-01 (that removed *share-time s2t*; this is *server-side t2s*, cover-search
  only).

### Task 3 — raster fallback (`68f9857`)

- `static/og.jpg` — 1200×630, 48,744 bytes, rasterized from `static/og.svg` (kept as source art).
- New `src/lib/proxy/og-fallback.ts` exports `OG_FALLBACK_TYPE = 'image/jpeg'` and
  `OG_FALLBACK_BYTES`, decoded once at module scope from an embedded base64 constant via
  `atob` + charCode loop (no `Buffer`, no `fetch`, no 302 — the §C.11/§D.15 zero-subrequest posture
  moved here verbatim and rewritten for the raster).
- `OG_FALLBACK_SVG` and its `OG_FALLBACK_TYPE` deleted from `og-cover.ts` (now resolve-chain only);
  `grep -rn "OG_FALLBACK_SVG" src` = **0**.
- `ogFallback()` serves the bytes with `Content-Length`, unchanged `Cache-Control` + CORS, unchanged
  never-500 contract. `+layout.svelte` `og:image`/`twitter:image` and `PageOg`'s fallback now point
  at `/og.jpg`; `grep -c 'og\.svg'` in those two files = 0 (only the new explanatory comment
  mentions the source artwork).
- Pending todo `og-png-raster-fallback.md` removed — this task is the fix it describes.

## Verification (observed, not inferred)

| Gate | Result |
|------|--------|
| `pnpm test` | **89 files / 1515 tests passed** (baseline 89/1500 — the plan's 1494 predates commit `83dfd70`) |
| `pnpm check` | **4368 files, 0 errors, 0 warnings** |
| `pnpm build` | exit **0** (adapter-cloudflare) |
| `pnpm build:native` | exit **0** (adapter-static); `build/og.jpg` = 48,744 B |
| `sips -g pixelWidth -g pixelHeight static/og.jpg` | **1200 / 630** |
| Raster eyeballed | gradient bg, purple logo tile + play mark, `openmusic` wordmark, `music streaming for earth` tagline all render (viewed the file before committing) |

Dev smoke — **port RESOLVED, not assumed**: `:4321` did not answer, `:5173` did (a bare `pnpm dev`
in this shell), so all curls below ran against `http://localhost:5173`.

```
/api/og?type=song                             → 200 image/jpeg 48744  (magic ff d8, body
                                                 byte-identical to static/og.jpg via cmp)
/og.jpg                                       → 200 image/jpeg 48744
/song/周傑倫/止戰之殤   (raw CJK path)          → 200
/album/周傑倫/范特西    (raw CJK path)          → 200
/artist/周傑倫          (raw CJK path)          → 200
/api/og?type=song&artist=周傑倫&title=止戰之殤  → 200 image/jpeg 142864  → NOT the fallback
/api/og?type=song&artist=周傑倫&title=稻香      → 200 image/jpeg 112307  → NOT the fallback
```

The last two are the plan's live acceptance cases and they pass **against live Deezer from this
sandbox**: Traditional input now yields a real cover raster where it previously returned the branded
card. (`cmp` against `static/og.jpg` is what distinguishes "real cover" from "fallback".)

**Not verified — the user's step.** No deploy was attempted, per the plan: `pnpm deploy` is shadowed
by pnpm's builtin (`ERR_PNPM_CANNOT_DEPLOY`) and `pnpm run deploy` fails on stale wrangler OAuth
(`Authentication error [code: 10000]`). So the real WhatsApp/iMessage card for
`/song/周傑倫/止戰之殤` and `/song/周傑倫/稻香`, the raw-CJK link preview as a recipient sees it, and
the raster fallback on a garbage title all remain **unobserved in production**. They need
`wrangler login` + `pnpm run deploy` first.

## Deviations from Plan

### Auto-fixed

**1. [Rule 3 - Blocking] `qlmanage` rasterization was unusable; `sips` reads SVG directly**

- **Found during:** Task 3, step 1.
- **Issue:** RESEARCH risk A9 ("`qlmanage -t` produces an acceptable 1200×630 PNG", Low
  confidence, untried) is **false on this machine**. `qlmanage -t -s 1200 -o …` emitted a 1200×1200
  PNG in which the card was rendered at ~1.6× scale anchored top-left: the wordmark was cropped to
  `openm` and the bottom ~18% was white padding. `sips -c 630 1200` cannot recover it — cropping a
  zoomed, clipped render just yields a zoomed, clipped card (verified by viewing both).
- **Fix:** the plan's own escape hatch ("any one-off local rasterizer is fine; the deliverable is a
  committed PNG, not a pipeline") — `sips -s format jpeg static/og.svg` reads the SVG **directly**
  and emits an exact 1200×630 raster with the full card correct. No new npm dependency; no
  Chrome-headless fallback needed.
- **Also corrects a stated fact:** the plan and the todo both assert "`sips` cannot read SVG". On
  this macOS it does (ImageIO gained SVG support), and that is what made this the one-command fix.
- **Files:** `static/og.jpg`.
- **Commit:** `68f9857`.

**2. [Rule 1 - Bug] `new Response(Uint8Array)` failed to typecheck**

- **Found during:** Task 3, at the `pnpm check` gate (1 error).
- **Issue:** `decodeBase64` returning a bare `Uint8Array` infers `Uint8Array<ArrayBufferLike>`,
  which is not assignable to `BodyInit` (its BufferSource arm is `ArrayBufferView<ArrayBuffer>`;
  `ArrayBufferLike` admits `SharedArrayBuffer`). TS 5.9's typed-array generics make this a hard
  error, not a warning.
- **Fix:** annotate the return as `Uint8Array<ArrayBuffer>` — keeps the route cast-free, honoring
  the zero-`as any` rule. Reason recorded in the function's JSDoc so nobody "simplifies" the
  generic away.
- **Files:** `src/lib/proxy/og-fallback.ts`.
- **Commit:** `68f9857`.

**3. [Rule 2 - Missing critical] Ship JPEG, not PNG, and assert magic bytes**

- **Found during:** Task 3.
- **Issue:** the PNG raster is 735,780 bytes — a full-bleed gradient compresses badly in PNG-24.
  Embedded as base64 that is a ~980 KB literal in an edge module.
- **Fix:** the plan's documented branch (">~150 KB → JPEG q80"): `sips -s formatOptions 80` gives
  48,744 bytes (~65 KB base64). `OG_FALLBACK_TYPE = 'image/jpeg'` and the meta tags point at
  `/og.jpg` to match. Tests assert the format from the **body's magic bytes** (`FF D8` / `89 50 4E
  47`), not just the header, so a stale or mis-decoded base64 constant fails loudly.
- **Files:** `static/og.jpg`, `src/lib/proxy/og-fallback.ts`, `src/routes/api/og/og-endpoint.test.ts`.
- **Commit:** `68f9857`.

### Assumption Drift (advisory)

**1. The prior title-only retry was already committed as the earlier (retry-after) design**

- **Found during:** Task 2, reading the tree.
- **Planned:** the plan describes Task 2 as introducing the convert-first flow.
- **Actual:** commit `83dfd70` (`fix(og): rescue artist-poisoned cover misses with a title-only
  Deezer retry`, already on `main` and already tagged `quick-260807-vl1`) had shipped the
  retry-after design the plan explicitly supersedes, plus 6 tests asserting a 4-subrequest worst
  case and a 2.5 s budget.
- **Why it matters:** those 6 tests and their comments were the "stale text" the constraints warned
  about. They were rewritten rather than extended — the retry-after describe block is gone and the
  old "3 tiers + the title-only retry" comments now name Fallback A/B and say why A is skipped for
  a non-substituted query. Baseline test count is therefore 1500, not the plan's 1494.
- Advisory only; nothing about the plan's design changed.

**2. Measured t2s dict bytes differ slightly from the plan's figures**

- **Planned:** "t2s-char.min.json 36 KB raw / 14,753 B gzip + t2s-phrase.min.json 20 KB raw /
  7,569 B gzip ≈ 56 KB raw / ~22 KB gzip".
- **Actual (measured on the installed package):** char 34,273 raw / 14,728 gzip; phrase 16,394 raw
  / 7,560 gzip → **50,667 raw / 22,288 gzip**. The gzip figures effectively match; the raw KB were
  slightly high (the plan's numbers look taken from the non-`.min` files).
- **Why it matters:** the code comment records the measured bytes, so a future reader checking the
  claim against `wc -c` finds agreement. The conclusion is unchanged and stronger: t2s-phrase is
  ~9× smaller than s2t-phrase's 148,406, so §E's both-directions cost objection still does not
  transfer.

## Threat Flags

None. No new network surface, auth path, file access or schema change: the escape set in
`encodePathSegment` is strictly a *narrowing* of what travels raw (all path-splitting and
control characters remain escaped), `t2sConvertLines` is a pure in-process transform, and the new
`og-fallback.ts` performs **zero** I/O — it decodes a compile-time constant. `/api/og` still accepts
no URL parameter, and every cover URL still passes its own tier's host allow-list before being
fetched.

## Known Stubs

None.

## Self-Check: PASSED

- `src/lib/proxy/og-fallback.ts`, `static/og.jpg`, this SUMMARY — all present on disk.
- Commits `180630a`, `16141c7`, `68f9857` all resolve in `git log`.
- Only deletion across the three commits is the intentional
  `.planning/todos/pending/og-png-raster-fallback.md` (Task 3, step 6).
- No untracked files left under `src/` or `static/`.
