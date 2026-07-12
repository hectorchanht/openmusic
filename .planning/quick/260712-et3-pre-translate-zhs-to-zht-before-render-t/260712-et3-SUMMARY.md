---
quick_id: 260712-et3
title: Pre-translate zhs→zht before render (kill the Simplified→Traditional flash)
date: 2026-07-12
status: complete
---

# Quick Task 260712-et3 — Summary

## What shipped

Killed the Simplified→Traditional **flash** on display names for users whose Chinese
content target is Traditional (`zh-Hant`). Names (the now-playing marquee title/artist
especially) used to paint Simplified, then flip to Traditional ~160ms later once the
async translate batch resolved. They now convert **synchronously on the first render**
via the offline tongwen s2t converter, so the name appears Traditional immediately —
no flip.

## How

zh-Hans→zh-Hant is deterministic and offline (tongwen `zh-convert.ts`). Once the ~72 KB
dict is warm, conversion is a synchronous call — but the store always forced it through
the async debounce+queue. Fix: convert synchronously when the dict is warm, and warm the
dict at boot so it's ready before the first render.

- **`src/lib/services/zh-convert.ts`** — publish a synchronous converter handle
  (`convertLineSync`) when the lazy build resolves; add `warmS2T()` (fire-and-forget
  dict preload) and `s2tConvertLineSync(text)` (returns Traditional if warm, else `null`;
  never throws).
- **`src/lib/stores/names.svelte.ts`** — in `resolve()`, a `zh-Hant` + `isChineseLine`
  fast path: `s2tConvertLineSync` → return Traditional immediately + cache it (no queue,
  no flash). If the dict isn't warm yet, `warmS2T()` and fall through to the async queue
  for that one render (single cold-start conversion). Added a public `warm()` that preloads
  the dict iff an active content target (`title/artist/lastfm/bioLang` via `effectiveTarget`)
  resolves to `zh-Hant` — keeps the dict out of non-Hant paths (D-03).
- **`src/routes/(app)/+layout.svelte`** — call `names.warm()` in `onMount` after
  `settings.load()` so the dict loads at boot for Traditional users.

## Verification

- **Unit tests: 36 passed** (`zh-convert.test.ts` + `names.test.ts` + `translate.test.ts`).
  - New: `s2tConvertLineSync`/`warmS2T` sync-path tests (cold→null, warm→converted,
    phrase-level `头发→頭髮`, identity `台灣`, empty→null).
  - Retargeted the `names.test.ts` async queue/flush/attempt-machinery tests from `zh-Hant`
    to `ja` (a non-offline API target) — the zh-Hant path now short-circuits to the sync
    converter, so routing the machinery assertions through it would skip the machinery /
    race the lazy load. The zh-Hant sync path is covered in `zh-convert.test.ts`.
- **`pnpm check`: 0 errors, 0 warnings.**
- **Browser (dev @4321):** clean boot, no console errors with the new import wiring +
  `names.warm()`. Exercised the real bundle module graph: cold `s2tConvertLineSync`→`null`;
  after `warmS2T()`, `简体中文→簡體中文`, `头发→頭髮`, `台灣→台灣`, ``→`null`. The no-flash
  mechanism is proven in-browser.

## Not verified here / follow-ups

- The **visual** flash on a real Chinese song name needs live CN upstream search results,
  which the sandbox can't reach (see memory: sandbox-no-cn-upstream-network) → **device UAT**.
- **Cold-start residual:** names visible in the first fraction of a second on a truly cold
  load (before the 72 KB dict finishes its dynamic import) can still convert one render late.
  Removing that entirely means bundling the dict, which violates D-03 bundle discipline —
  left as-is (deferred).
- **Lyrics-pane flash** is out of scope (lyrics are fetch-then-show; a different, larger
  surface) — same offline s2t path already applies there via `translateLinesEx`.
