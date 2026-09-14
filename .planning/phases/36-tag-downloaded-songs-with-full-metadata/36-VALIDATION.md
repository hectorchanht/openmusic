---
phase: 36
slug: tag-downloaded-songs-with-full-metadata
status: draft
nyquist_compliant: false
wave_0_complete: false
created: 2026-09-13
---

# Phase 36 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution.
> Derived from `36-RESEARCH.md` §Validation Architecture, whose numbers were empirically
> verified in-session (taglib-wasm round-tripped real mp3/m4a/flac fixtures under Vitest 4.1.3,
> `environment: 'node'`, 3 cases in 33 ms — no jsdom, no FileReader, no DOM).

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | Vitest `^4.1.3`, single project `server`, `environment: 'node'`, **no jsdom** |
| **Config file** | `vite.config.ts` (`test.projects[0]`), include `src/**/*.{test,spec}.{js,ts}` |
| **Quick run command** | `pnpm vitest --run src/lib/services/audio-tags.test.ts src/lib/services/download-track.test.ts` |
| **Full suite command** | `pnpm test` (`vitest --run`, ~67 test files) + `pnpm check` |
| **Estimated runtime** | quick ~2s · full suite ~30s |

**No infrastructure change required.** The existing single node project runs the chosen dependency
unmodified. This was verified, not assumed.

---

## Sampling Rate

- **After every task commit:** `pnpm vitest --run src/lib/services/audio-tags.test.ts src/lib/services/download-track.test.ts`
- **After every plan wave:** `pnpm test && pnpm check`
- **Before `/gsd:verify-work`:** full suite green **AND** the on-device D-15 checklist passed
- **Max feedback latency:** ~2 seconds (quick), ~30 seconds (full)

---

## Per-Task Verification Map

| Req | Behaviour | Test Type | Automated Command | File Exists |
|-----|-----------|-----------|-------------------|-------------|
| — | Node 24 toolchain: install + check + test + build all green | build gate | `pnpm install && pnpm check && pnpm test && pnpm build` | ❌ W0 |
| D-02 | mp3 round-trips title/artist/album/albumArtist/track/cover | unit | `pnpm vitest --run -t "mp3 round-trip"` | ❌ W0 |
| D-02 | m4a writes `©nam`/`©ART`/`©alb`/`aART`/`trkn`/`covr` and still parses | unit | `… -t "m4a round-trip"` | ❌ W0 |
| D-02 | flac writes VORBIS_COMMENT + PICTURE with a correct last-block flag | unit | `… -t "flac round-trip"` | ❌ W0 |
| D-02 | **non-faststart (`mdat`-first) m4a tags without corruption** | unit | `… -t "non-faststart"` | ❌ W0 |
| D-03 | `readAudioTags(writeAudioTags(x))` returns the written fields, all 3 containers | unit | `… -t "round-trip"` | ❌ W0 |
| D-06 | a garbage/unknown buffer returns the original, never throws | unit | `… -t "unknown container"` | ❌ W0 |
| D-06 | `downloadTrack` returns `'saved'` when the tagger declines to tag | unit | `pnpm vitest --run src/lib/services/download-track.test.ts` | ✅ extend |
| D-07/D-08 | output contains **no** year, genre, comment or encoder field | unit | `… -t "omits"` (assert keys absent via read-back) | ❌ W0 |
| D-10 | an empty `album` produces no ALBUM tag (not `""`, not a placeholder) | unit | `… -t "omits album"` | ❌ W0 |
| D-11 | no `opts` track number → no track-number tag; `displayIndex` never reaches the tagger | unit + grep guard | `… -t "no track number"` | ❌ W0 |
| D-12 | album loop passes the album-page artist as albumArtist | unit | album-context opts test | ❌ W0 |
| D-13 | cover bytes come from `resolveArtworkDataUrl`; no second fetch path introduced | grep guard | `… -t "single artwork path"` | ❌ W0 |
| D-14 | an art miss/timeout still writes every other tag | unit | `… -t "art miss"` | ❌ W0 |
| D-17 | tagger never rejects (throwing lib → original blob) | unit | `… -t "never throws"` | ❌ W0 |
| D-18 | tagging touches no player state | grep-assert (existing pattern) | `download-track.test.ts` isolation block | ✅ extend |
| D-19 | one failing file in a retag batch does not abort or corrupt the rest | unit | `src/lib/services/retag.test.ts` | ❌ W0 |
| — | the tagged blob keeps its MIME type | unit | `… -t "preserves mime"` | ❌ W0 |
| — | a blob over `TAG_MAX_BYTES` is returned untagged (memory ceiling) | unit | `… -t "size ceiling"` | ❌ W0 |
| — | container chosen by **magic bytes**, not the URL extension | unit | `… -t "sniffs container"` | ❌ W0 |
| D-15 | device player shows title/artist/album grouping/track order/cover | **manual, device only** | see below | manual |

---

## Wave 0 Requirements

- [ ] `.nvmrc`, `package.json` `engines`, and the 3 GitHub workflows → **Node 24**; gate on a full
      `pnpm install && pnpm check && pnpm test && pnpm build`. **Blocks everything else** —
      `engine-strict=true` + `engines.node >= 24` on the dependency makes `pnpm add` fail on Node 22.
      (The package *runs* fine on 22 — the field gates an unused WASI backend — but `packageExtensions`
      cannot override `engines`; both verified.)
- [ ] `pnpm add taglib-wasm@2.2.2` — exact pin
- [ ] `src/lib/services/audio-tags.ts` — the read+write codec module (D-03: both directions)
- [ ] `src/lib/services/audio-tags.test.ts` — round-trip suite
- [ ] `tests/fixtures/tiny.{mp3,m4a,flac}` + `tests/fixtures/tiny-nonfaststart.m4a` (~39 kB total)
- [ ] `tests/fixtures/README.md` — regeneration recipe (see below)
- [ ] `src/service-worker.ts` — verify, and if needed exclude `.wasm` from `ASSETS` precache

### Test fixtures — recipe, sizes, licensing

Synthetic and licensing-clean (TTS / hand-built frames, no third-party recording). All generated and
verified in the research session — each parses, tags, and still decodes afterwards (`afinfo`).

```bash
# m4a — ~8.3 kB (macOS `say` + `afconvert`, both preinstalled)
say -o src.aiff "test tone"
afconvert -f m4af -d aac -b 32000 src.aiff tiny.m4a

# flac — ~22 kB
afconvert -f flac -d flac src.aiff tiny.flac

# mp3 — ~8.3 kB (hand-built silent MPEG-1 Layer III frames; no encoder needed, works anywhere)
python3 -c "open('tiny.mp3','wb').write((bytes([0xFF,0xFB,0x90,0x00])+b'\x00'*413)*20)"
```

Commit the binaries; the recipe lives in `tests/fixtures/README.md` so a Linux contributor can
regenerate. The **non-faststart m4a** (relocate `moov` after `mdat`, add the byte delta to every
`stco` entry) is the highest-value fixture in the suite: a failure there is silent file corruption,
not a visible error.

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| Device music player reads the tags we wrote | D-15 | Android's media scanner and the stock player are device-side; no emulator substitute is trustworthy for OEM scanner behaviour | Steps 1–6 below |

**D-15 on-device checklist** (the phase gate — research marks scanner OEM variation as `[ASSUMED]`):

1. Build + install: `JAVA_HOME=/opt/homebrew/opt/openjdk@21/libexec/openjdk.jdk/Contents/Home pnpm apk`
   (per the existing `apk-build-needs-jdk21` note).
2. Download **one m4a and one FLAC** from an **album page**, so track number and album artist are both populated.
3. Stock **Files** app → `Music/OpenMusic/` → files exist with the human filename.
4. Device's **own music player** (not OpenMusic), per file: title, artist, album, **album grouping**
   (both tracks under ONE album, not two one-song albums), track-number ordering, cover-art thumbnail.
5. **Refutation signal is specific:** album showing as **"OpenMusic"** and artist as **`<unknown>`**
   means the scanner read nothing. Album correct but art missing is a *different* failure
   (cover resolution, not scanning) — do not conflate them.
6. Repeat once after a reboot, to rule out a stale MediaProvider cache.

> **D-15's named fallback is refuted by research and must not be attempted blind.** AOSP's
> `ModernMediaScanner.scanItemAudio` upsert pre-sets `ARTIST = "<unknown>"` and
> `ALBUM = <parent folder>`, so app-supplied `ContentValues` are overwritten by any later scan.
> If step 4 fails, the remedy needs re-research — it is not "add the columns".

---

## Validation Sign-Off

- [ ] All tasks have `<automated>` verify or a Wave 0 dependency
- [ ] Sampling continuity: no 3 consecutive tasks without automated verify
- [ ] Wave 0 covers all MISSING references (Node 24 bump first — it blocks the dependency install)
- [ ] No watch-mode flags
- [ ] Feedback latency < 30s
- [ ] D-15 device checklist executed and recorded
- [ ] `nyquist_compliant: true` set in frontmatter

**Approval:** pending
