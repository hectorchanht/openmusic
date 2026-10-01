---
phase: 40
slug: album-download-all-cover-re-rank-cloud-shared-cover-pick-1-a
status: draft
nyquist_compliant: false
wave_0_complete: false
created: 2026-09-30
---

# Phase 40 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution.
> Source: 40-RESEARCH.md `## Validation Architecture`, AMENDED by the post-research decisions in 40-CONTEXT.md
> (D-08 iTunes → QQ order, D-11a HQ upgrade removed, D-11b YTM uid-only cache, D-18a per-IP throttle).

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | Vitest 4.x, single node project (no jsdom) |
| **Config file** | `vite.config.ts` |
| **Quick run command** | `pnpm exec vitest --run <touched test files>` |
| **Full suite command** | `pnpm test && pnpm check` |
| **Estimated runtime** | ~60 seconds full suite |

---

## Sampling Rate

- **After every task commit:** quick command for the touched test files
- **After every plan wave:** `pnpm test && pnpm check`
- **Before `/gsd:verify-work`:** full suite green + `pnpm build` + `pnpm build:native` exit 0 + manual rows below
- **Max feedback latency:** 60 seconds

---

## Per-Task Verification Map

Task IDs are assigned by the planner; this map is keyed by decision.

| Decision | Behavior | Threat Ref | Test Type | Automated Command | File Exists | Status |
|----------|----------|------------|-----------|-------------------|-------------|--------|
| D-03 | crc32 `cbf43926`; buildZip round-trip (headers, sizes, UTF-8 flag 0x0800, offsets, EOCD); zip filename names the album | — | unit | `pnpm exec vitest --run src/lib/services/zip-store.test.ts` | ❌ W0 | ⬜ |
| D-01 | `sanitizePathSegment` (`..`, `/`, control chars, trailing dots, byte cap, empty) + album dir / zip name builders | ZIP slip / RELATIVE_PATH escape | unit | `pnpm exec vitest --run src/lib/services/download-filename.test.ts` | ✅ extend | ⬜ |
| D-01/D-02 | `put(..., {dir})` passes subPath; sticky dir survives re-put; single put has no subPath; del clears dir; moveToDir updates URI, refuses device uids | — | unit | `pnpm exec vitest --run src/lib/services/blob-store.test.ts` | ✅ extend | ⬜ |
| D-04 | album path persists (blobStore.put) and `save:false` skips anchor; onSaved fires | — | unit | `pnpm exec vitest --run src/lib/services/download-track.test.ts` | ✅ extend | ⬜ |
| D-05/D-06 | held single (sameSongKey, other uid) moved not re-downloaded (native) / reused (web); failures skipped; onProgress n/total; web saves exactly ONE zip; saved count | — | unit | `pnpm exec vitest --run src/lib/services/download-album.test.ts` | ❌ W0 | ⬜ |
| D-06 | i18n key parity for new toast keys in all 15 locales | — | unit | `pnpm exec vitest --run src/lib/i18n/i18n.test.ts` | ✅ | ⬜ |
| D-08 | chain order iTunes → QQ (search + detail) → Deezer → CN `{qq:false, ytmusic:false}` → YTM; stops at first hit | — | unit | `pnpm exec vitest --run src/lib/services/cover-backfill.test.ts` | ✅ extend | ⬜ |
| D-10 | picker order own, qq, itunes, deezer, cn, ytm; each source once | — | unit | same | ✅ extend | ⬜ |
| D-11b | YTM covers written to uid layer only, never name layer | — | unit | same + `src/lib/stores/cover-version.svelte.test.ts` | ✅ extend | ⬜ |
| D-12 | `resolveShareCover` makes zero searchAll/qq calls; `coverToken` grammar unchanged | — | unit | `pnpm exec vitest --run src/lib/services/cover-backfill.test.ts src/lib/services/share.test.ts` | ✅ | ⬜ |
| D-09/D-11a | HQ upgrade gone: inline cover (incl. ytmusic) never replaced automatically; crowd beats inline in adoptCover; healCover evicts dead crowd entry | — | unit | `pnpm exec vitest --run src/lib/stores/player.svelte.test.ts` | ✅ extend | ⬜ |
| D-14/D-14a | `readChosenCover` pin > crowd uid > crowd name; crowd beats album-attached cover in play seed; crowd keys disjoint | — | unit | `pnpm exec vitest --run src/lib/stores/cover-version.svelte.test.ts src/lib/services/cover-cache.test.ts` | ✅ extend | ⬜ |
| D-17/D-19 | consensus most votes, tie → recent, re-vote replaces, cap; parseVoteBody screens | Sybil | unit | `pnpm exec vitest --run src/lib/proxy/cover-pick.test.ts` | ❌ W0 | ⬜ |
| D-18 | allowlist accepts y.gtimg.cn / *.kuwo.cn / *.music.126.net; rejects suffix-spoof, http, quotes | URL injection | unit | `pnpm exec vitest --run src/lib/proxy/safe-image-url.test.ts` | ✅ extend | ⬜ |
| D-13/D-16/D-18/D-18a | route matrix: 400 key, 503 no DIAG, 403 origin, 415 type, 413 size, 400 non-allowlisted, GET cache hit, POST busts key, throttle 429, no voter id/IP in bodies, never touches `log/` | CSRF, R2 key injection, write flood | unit | `pnpm exec vitest --run src/routes/api/cover-pick/cover-pick-endpoint.test.ts` | ❌ W0 | ⬜ |
| D-13 | `coverPickKeys` domain-separated; fetch/submit never throw | — | unit | `pnpm exec vitest --run src/lib/services/cover-pick-shared.test.ts` | ❌ W0 | ⬜ |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

---

## Wave 0 Requirements

- [ ] `src/lib/services/zip-store.test.ts` — D-03
- [ ] `src/lib/services/download-album.test.ts` — D-05/D-06 (copy hoisted `vi.mock` block from `download-track.test.ts`)
- [ ] `src/lib/proxy/cover-pick.test.ts` — D-17/D-19
- [ ] `src/routes/api/cover-pick/cover-pick-endpoint.test.ts` — route matrix (copy `fakeBucket` from `lyric-offset-endpoint.test.ts`)
- [ ] `src/lib/services/cover-pick-shared.test.ts` — client keys + never-throw

---

## Manual-Only Verifications

| Behavior | Decision | Why Manual | Test Instructions |
|----------|----------|------------|-------------------|
| Route actually loads (verb-only exports) | D-13 | unit tests import the module directly | `pnpm dev` → `curl -s localhost:<port>/api/cover-pick?u=<32hex>` returns JSON |
| Multi-voter winner / tie → recent | D-17 | needs distinct client IPs | `pnpm build && wrangler pages dev .svelte-kit/cloudflare --port 8799 --persist-to <scratch>/wr`, curl with spoofed `cf-connecting-ip` |
| Album lands in `Music/OpenMusic/<Artist>/<Album>/`; held single moves; retag keeps folder; delete removes | D-01/D-05 | native MediaStore | `pnpm apk` (JAVA_HOME=openjdk@21) → Pixel_3a_API_34 emulator → `adb shell content query --uri content://media/external/audio/media --projection _id:relative_path:_display_name` |
| One zip, named after the album, unzips to tagged files | D-03 | browser download | Chrome on dev server + `unzip -t`; iOS Safari manual |

---

## Validation Sign-Off

- [ ] All tasks have `<automated>` verify or Wave 0 dependencies
- [ ] Sampling continuity: no 3 consecutive tasks without automated verify
- [ ] Wave 0 covers all MISSING references
- [ ] No watch-mode flags
- [ ] Feedback latency < 60s
- [ ] `nyquist_compliant: true` set in frontmatter

**Approval:** pending
