---
phase: quick-260808-vkd
plan: 01
subsystem: share
tags: [share, web-share-api, cjk, og]
requires: [quick-260807-vl1, quick-260808-urx]
provides: ["raw-CJK share links survive the OS share sheet"]
affects: [src/lib/components/TrackMenu.svelte, "src/routes/(app)/album/[name]/+page.svelte", "src/routes/(app)/artist/[name]/+page.svelte"]
tech-stack:
  added: []
  patterns: ["structural source assertion for un-importable .svelte handlers (names.test.ts:206-233 technique)"]
key-files:
  created: []
  modified:
    - src/lib/components/TrackMenu.svelte
    - src/routes/(app)/album/[name]/+page.svelte
    - src/routes/(app)/artist/[name]/+page.svelte
    - src/lib/services/share.test.ts
decisions:
  - "Share link rides ShareData.text, not ShareData.url — the spec URL-parses and re-serializes url, percent-encoding all non-ASCII path chars"
  - "Drop the url member entirely rather than sending both — targets that concatenate text+url would show the link twice, once readable and once encoded"
metrics:
  duration: 9 min
  completed: 2026-08-08
requirements: [QUICK-260808-VKD]
---

# Quick 260808-vkd: Share raw URL via the Web Share `text` member — Summary

Moved the share link from `ShareData.url` to `ShareData.text` at all three `navigator.share` call
sites, so `encodePathSegment`'s raw-CJK path (quick-260807-vl1) is not percent-encoded back into
`%E5%96%BA…` by the Web Share API's URL re-serialization at the last step.

## What Changed

| File | Before | After |
|------|--------|-------|
| `TrackMenu.svelte:204` | `{ title: \`${dTitle} • ${dArtist}\`, url }` | `{ title: \`${dTitle} • ${dArtist}\`, text: url }` |
| `album/[name]/+page.svelte:460` | `{ title: dArtist ? … : dName, url }` | `{ title: dArtist ? … : dName, text: url }` |
| `artist/[name]/+page.svelte:203` | `{ title, text: title, url }` | `{ title, text: url }` |

The artist site's `text: title` was redundant with `title`; the link takes that slot. Each site
carries a new `quick-260808-vkd` comment block explaining WHY (spec URL-parses `url`, WHATWG
serializer percent-encodes above U+007E, `text` passes through verbatim, WhatsApp/iMessage/Slack
auto-linkify a bare URL in text and still fetch its OG card, and sending both duplicates the link).

`src/lib/services/share.test.ts` gained one `describe` with a 3-case `it.each` asserting, per file:
`toMatch(/nav\.share\(\{[^)]*text: url/)` and `not.toMatch(/nav\.share\(\{[^)]*[,{]\s*url\s*[})]/)`.

## RED Gate — Observed, Verbatim

Run against the UNMODIFIED `.svelte` sources, before any edit
(`pnpm vitest --run src/lib/services/share.test.ts`):

```
 × src/lib/components/TrackMenu.svelte hands the link to nav.share as `text`, with no `url` member 4ms
 × src/routes/(app)/album/[name]/+page.svelte hands the link to nav.share as `text`, with no `url` member 1ms
 × src/routes/(app)/artist/[name]/+page.svelte hands the link to nav.share as `text`, with no `url` member 1ms
 FAIL  |server| src/lib/services/share.test.ts > nav.share carries the link in text, not url (quick-260808-vkd) > …

 Test Files  1 failed (1)
      Tests  3 failed | 55 passed (58)
```

Failing assertion, as reported: `share.test.ts:561` `expect(src).toMatch(/nav\.share\(\{[^)]*text: url/)`.
After the three edits: `Test Files 1 passed (1) / Tests 58 passed (58)`. The test was red on arrival
on the first run — no mid-execution replacement was needed (the failure mode of quick-260808-urx).

## Gates — Observed Numbers

| Gate | Baseline (observed this session, pre-change) | After |
|------|--------------------------------------------|-------|
| `pnpm test` | 89 files / **1528** passed, exit 0 | 89 files / **1531** passed (+3 structural cases), 0 failures |
| `pnpm check` | — | **4368 FILES 0 ERRORS 0 WARNINGS 0 FILES_WITH_PROBLEMS** |
| `pnpm build` | — | **exit 0** (adapter-cloudflare) |
| `pnpm build:native` | — | **exit 0** (adapter-static, wrote `build`) |

Baseline was measured, not assumed: a `pnpm test` run started before the test edit reported
`89 passed (89) / 1528 passed (1528)`, matching the stated baseline exactly.

## Constraint Compliance (verified via `git diff -U0`)

- **Zero `clipboard.writeText` lines changed** — the diff's removed-line set inside these three files
  is exactly the three old `nav.share` lines and nothing else.
- **Zero comment lines deleted** — SHARE-02, OG-ZH-01, OG-EP-01, OG-PATH-02, quick-260723-r4p/ry1 and
  quick-260808-urx blocks all survive intact; the new block was appended below them.
- **No `url` member survives anywhere** — `grep -n 'nav.share({'` returns 3 lines, all `text: url`.
- No production `share.ts` / `encodePathSegment` code was touched.
- No deploy was run.

## HONEST LIMIT — This Is Not Device-Verified

**Real share-sheet behavior cannot be verified in this environment.** There is no OS share sheet
here, and neither a curl nor a unit test can exercise one. The change rests on two things:

1. The Web Share API spec, which URL-parses and re-serializes `data.url` (and does not parse `data.text`).
2. The proved WHATWG serializer behavior — `new URL('…/喺呢到大').href` returns the percent-encoded form.

The structural test proves only the *call shape*, i.e. that a revert gets caught. It does not prove
the recipient sees readable text.

**Required device UAT (yours):** share a Chinese-titled song from a real phone to WhatsApp and
confirm the link in the message reads `…/song/PetPetShawn/喺呢到大`, not `…/%E5%96%BA%E5%91%A2…`.
Also worth eyeballing in the same test: the OG card still renders (the bare URL should auto-linkify
and unfurl). Not deployed — `pnpm run deploy` is the working form (`pnpm deploy` hits pnpm's builtin
`ERR_PNPM_CANNOT_DEPLOY`); production state and its verification remain yours.

## Deviations from Plan

None — plan executed as written. The plan sketched Test 1 and Test 2 as separate per-file cases
(6 total); they were written as two assertions inside one 3-case `it.each`, which is what the plan's
own done-criterion ("3 structural failures") describes, and matches the `names.test.ts` precedent.

## Commits

- `2a928a9` — `fix(share): carry the link in ShareData.text so raw CJK survives the share sheet (quick-260808-vkd)`

## Self-Check: PASSED

- `src/lib/components/TrackMenu.svelte` — FOUND, `text: url` at line 204
- `src/routes/(app)/album/[name]/+page.svelte` — FOUND, `text: url` at line 460
- `src/routes/(app)/artist/[name]/+page.svelte` — FOUND, `text: url` at line 203
- `src/lib/services/share.test.ts` — FOUND, `nav.share` describe present, 58 tests pass
- Commit `2a928a9` — FOUND in `git log`
