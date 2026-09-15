---
phase: 37
slug: enrich-imported-device-songs-lyrics-cover-and-up-next-for-lo
status: draft
nyquist_compliant: false
wave_0_complete: false
created: 2026-09-15
---

# Phase 37 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution.
> Derived from `37-RESEARCH.md` §Validation Architecture. The picture-read assertion was
> executed in the research session (scratch Vitest against the repo's own `tiny.{mp3,m4a,flac}`
> fixtures: 3/3 containers returned `pictures[0].mimeType === 'image/png'`, `type === 'FrontCover'`,
> byte-exact data); every other row is a Wave 0 gap this phase's plans create.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | Vitest `^4.1.3` (resolved 4.1.8), single project `server`, `environment: 'node'`, **no jsdom** |
| **Config file** | `vite.config.ts` |
| **Quick run command** | `pnpm vitest --run src/lib/services/audio-tags.test.ts src/lib/services/catalog.test.ts src/lib/services/local-tags.test.ts src/lib/stores/player.svelte.test.ts` |
| **Full suite command** | `pnpm test` (`vitest --run`) + `pnpm check` (`svelte-check`) |
| **Estimated runtime** | quick ~5s (player suite is 6800 lines) · full suite ~30s |

**No infrastructure change required.** `taglib-wasm@2.2.2` is already installed; no new package,
no new test project. The player store is driven headless through the existing `makeFakeAudio()`
harness in `player.svelte.test.ts`.

---

## Sampling Rate

- **After every task commit:** the quick run command above (scoped to the files the task touched)
- **After every plan wave:** `pnpm test && pnpm check`
- **Before `/gsd:verify-work`:** full suite green **AND** the two `[UNVERIFIED-SANDBOX]` items observed on device/emulator (37-04)
- **Max feedback latency:** ~5 seconds (quick), ~30 seconds (full)

---

## Per-Task Verification Map

| Req | Behaviour | Test Type | Automated Command | File Exists |
|-----|-----------|-----------|-------------------|-------------|
| ENRICH-02 | `writeAudioTags(art)` → `readAudioTags` returns `art` (mime + byte-exact) for mp3/m4a/flac, from the SAME `readTags()` pass | unit | `pnpm vitest --run src/lib/services/audio-tags.test.ts` | ❌ W0 (37-01 T1) |
| ENRICH-02 | Picture-less write reads back with `art` absent | unit | same | ❌ W0 (37-01 T1) |
| ENRICH-02 | No `readCoverArt`/`readPictures` second-open call | grep guard | `grep -c "readCoverArt\|readPictures" src/lib/services/audio-tags.ts` → 0 | ❌ W0 (37-01 T1) |
| ENRICH-01 | `lyricByName` walks kuwo for a name-only lookup (device placeholder source is NOT skipped) | unit | `pnpm vitest --run src/lib/services/catalog.test.ts` | ❌ W0 (37-01 T2) |
| ENRICH-01 / ENRICH-04 | `lyricByName` returns `string \| null` — never a Track, so never an `audioUrl` | unit | same | ❌ W0 (37-01 T2) |
| ENRICH-01 | Empty query / aborted signal → `null`, zero searches | unit | same | ❌ W0 (37-01 T2) |
| ENRICH-01 | Existing RESOLVE-02 single-source `crossSourceLyric` test unchanged | unit | same | ✅ exists |
| ENRICH-02 | `isRenderableCover`: https + `data:image/*;base64` true; `data:text/html`, non-base64 data, http, `//`, '', null false | unit | `pnpm vitest --run src/lib/services/url-safety.test.ts` | ❌ W0 (37-01 T3, new file) |
| ENRICH-02 | `buildArtwork('data:image/png;base64,…')` → ONE `sizes:'any'` entry, not `/favicon.svg`; non-image data: → favicon | unit | `pnpm vitest --run src/lib/services/media-session.test.ts` | ❌ W0 (37-01 T3) |
| ENRICH-02 | Existing `buildArtwork` https ladder / http / protocol-relative cases unchanged | unit | same | ✅ exists |
| ENRICH-01 / ENRICH-02 | `localEnrichment` returns embedded LRC + `data:` art for a tagged blob | unit | `pnpm vitest --run src/lib/services/local-tags.test.ts` | ❌ W0 (37-02 T1, new file) |
| ENRICH-01 | Plain-text (unstamped) lyric → `lrc: null` (37-D-07) | unit | same | ❌ W0 (37-02 T1) |
| ENRICH-04 | Non-image MIME picture → `art: null`; picture > `MAX_ART_BYTES` → `art: null` | unit | same | ❌ W0 (37-02 T1) |
| ENRICH-04 | `blob.size > TAG_MAX_BYTES` → empty result, `arrayBuffer()`/`readAudioTags` NOT invoked | unit | same | ❌ W0 (37-02 T1) |
| ENRICH-04 | Unknown container → empty result, never throws | unit | same | ❌ W0 (37-02 T1) |
| ENRICH-04 | Memo: second call same uid decodes zero times — for a hit AND a total miss; hit returns `cached: true` | unit | same | ❌ W0 (37-02 T1) |
| ENRICH-04 | `local-tags.ts` imports no `$lib/stores`, `$lib/i18n`, `$app` | grep-assert | same (purity `it`) | ❌ W0 (37-02 T1) |
| ENRICH-04 | Existing player suite green after the pure `postPlayCover`/`postPlayQueue` extraction (behaviour-identical refactor) | unit | `pnpm vitest --run src/lib/stores/player.svelte.test.ts` | ✅ exists (37-02 T2a gate) |
| ENRICH-04 | **34-D-01 regression:** device play never calls `ensureTrackDetails`; `current.audioUrl` stays `null` | unit | `pnpm vitest --run src/lib/stores/player.svelte.test.ts -t "offline-served enrichment"` | ❌ W0 (37-03 T1 #1) — **highest value** |
| ENRICH-03 | Device fresh play reaches `regenerate` (`buildSimilarQueue` called with the device track); `upNextAnchorUid === device uid` | unit | same | ❌ W0 (37-03 T1 #2) |
| ENRICH-02 | Embedded art → `resolvedCover` starts with `data:`; raw `openmusic:cover-cache:v1` record contains no `data:`; no `resolveCoverForTrack` call | unit | same | ❌ W0 (37-03 T1 #3) |
| ENRICH-01 | Embedded LRC → `current.lrc` patched; `lyricByName` NOT called | unit | same | ❌ W0 (37-03 T1 #3) |
| ENRICH-01 / ENRICH-02 | Tag miss, device → `lyricByName(artist, title, signal)` once + `resolveCoverForTrack` once; `ensureTrackDetails` still never | unit | same | ❌ W0 (37-03 T1 #4) |
| ENRICH-03 / ENRICH-01 | Tag miss, ordinary download → existing `ensureTrackDetails({lrcUnresolved:true})` backfill + `buildSimilarQueue` + cover chain (37-D-01 fall-through) | unit | same | ❌ W0 (37-03 T1 #5) |
| ENRICH-04 | Supersedence: `playGen` bump during the tag read discards stale lrc/cover writes | unit | same | ❌ W0 (37-03 T1 #6) |
| ENRICH-04 | Recovered artist/title used as fallback QUERY only; `current.artist` unchanged (37-D-05) | unit | same | ❌ W0 (37-03 T1 #7) |
| ENRICH-04 | No `audio.src` re-drive, no `playGen` change from any enrichment path (loop classes 1-3) | unit | same | ❌ W0 (37-03 T1 #3, #8) |
| ENRICH-04 | Static audit: no new `writeCoverBoth`/`setCachedCover` site; `healCover` still `hasHttpsScheme`; no `isDeviceUid` around `postPlayQueue` | grep guard | 37-03 T2 greps (pasted in SUMMARY) | ❌ W0 (37-03 T2) |
| ENRICH-02 | Real MediaStore file's embedded FrontCover through `getPictures()` on Android | **manual, device only** | see below | manual |
| ENRICH-02 | `data:` artwork repaints the Android lock screen via `@jofr/capacitor-media-session` | **manual, device only** | see below | manual |

---

## Wave 0 Requirements

- [ ] `src/lib/services/audio-tags.test.ts` — picture round-trip + absent-art assertions (fixtures `__fixtures__/tiny.{mp3,m4a,flac}` already exist)
- [ ] `src/lib/services/catalog.test.ts` — `lyricByName` cases beside the RESOLVE-02 block
- [ ] `src/lib/services/url-safety.test.ts` — new file (module has no test today)
- [ ] `src/lib/services/media-session.test.ts` — `data:` artwork cases
- [ ] `src/lib/services/local-tags.test.ts` — new file, co-located with the new module
- [ ] `src/lib/stores/player.svelte.test.ts` — `describe('player.play — offline-served enrichment (Phase 37, 37-D-01..07)')`, 8 cases; adds `vi.mock('$lib/services/local-tags')` and `lyricByName` to the catalog mock factory
- No framework install, no fixture generation, no dependency add.

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| A real MediaStore-imported file's embedded FrontCover shows in the hero/nowbar and on the lock screen | ENRICH-02 (`[UNVERIFIED-SANDBOX]` #1) | Verified only against synthetic node fixtures; a real ID3v2.3/2.4 APIC with an odd text encoding could differ (RESEARCH A3) | 37-04 checklist step 4; token `ART-MISS <container>` |
| A `data:` artwork actually repaints the Android lock screen | ENRICH-02 (`[UNVERIFIED-SANDBOX]` #2) | The plugin's `;base64,` branch is known from a source quote (`media-artwork.ts:9-13`), never executed here (RESEARCH A2) | 37-04 checklist step 2; token `CARD-ICON` |
| Online similar Up-Next for an imported file with no embedded data | ENRICH-03 | Sandbox blocks netease/qq; Last.fm/Deezer reachable but the end-to-end list is a UI observation | 37-04 checklist step 5; token `UPNEXT-LIST` |
| No WebView kill under a large imported library + rapid play/stop | ENRICH-04 | Emscripten heap growth is device-specific | 37-04 checklist step 7; token `OOM` |

**37-04 on-device checklist** (airplane mode ON for steps 1-4 so any cover seen is provably the
embedded one; the probe file is produced by the repo's own `writeAudioTags` with a magenta PNG):

1. Tap the probe song → magenta cover on nowbar + hero; lyrics "Line one"/"Line two" scroll.
2. Lock the screen → lock-screen card shows the SAME magenta picture (else `CARD-ICON`).
3. Settings → Activity log → `enrich.local … lrc: true, art: true`.
4. Tap a real ripped file with embedded art → its own cover on hero + lock screen (else `ART-MISS`).
5. Airplane mode OFF; tap an untagged import → name-based cover/lyrics arrive; Up-Next fills with online songs (else `UPNEXT-LIST`).
6. Replay the probe → no re-decode delay; Activity log shows a second `enrich.local` with `cached: true`.
7. 100+ file library, rapid scroll + 10 start/stops → no freeze, no kill (else `OOM`).

> **Do not let native's `/api/og` fallback mislead the UAT.** On native, `native-media-session.ts`
> already routes `/favicon.svg` through `resolveArtworkDataUrl` → `/api/og?type=song&…`, so the lock
> screen may show text-resolved art the in-app hero does NOT — that is why steps 1-4 run with
> airplane mode on (RESEARCH Q3 "Also worth knowing").

---

## Validation Sign-Off

- [ ] All tasks have `<automated>` verify or a Wave 0 dependency
- [ ] Sampling continuity: no 3 consecutive tasks without automated verify
- [ ] Wave 0 covers all MISSING references
- [ ] No watch-mode flags
- [ ] Feedback latency < 30s
- [ ] 37-04 device checklist executed and recorded per item (neither `[UNVERIFIED-SANDBOX]` item marked PASS without a human observation)
- [ ] `nyquist_compliant: true` set in frontmatter

**Approval:** pending
