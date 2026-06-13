---
phase: 24
slug: offline-app-shell-sharing-seo
status: draft
nyquist_compliant: false
wave_0_complete: false
created: 2026-06-14
---

# Phase 24 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | Vitest 4.1.3 |
| **Config file** | `vite.config.*` / vitest config (tests colocated `*.test.ts`) |
| **Quick run command** | `pnpm test:unit` (watch) — use `pnpm test src/<path>.test.ts` for single-file `--run` |
| **Full suite command** | `pnpm test` (`vitest --run`) |
| **Estimated runtime** | ~30 seconds (full suite) |

---

## Sampling Rate

- **After every task commit:** Run `pnpm test src/lib/services/<changed>.test.ts`
- **After every plan wave:** Run `pnpm test` (full) + `pnpm build && pnpm build:native`
- **Before `/gsd:verify-work`:** Full suite green + both builds green + manual crawler curl + manual iOS offline smoke
- **Max feedback latency:** ~30 seconds (unit); builds ~minutes at wave merge

---

## Per-Task Verification Map

| Task ID | Plan | Wave | Requirement | Threat Ref | Secure Behavior | Test Type | Automated Command | File Exists | Status |
|---------|------|------|-------------|------------|-----------------|-----------|-------------------|-------------|--------|
| W0 | — | 0 | OFFL-01 | — | SW never serves cached `/api/*` or audio (no stale-auth/data leak) | unit | `pnpm test src/lib/services/sw-cache.test.ts` | ❌ W0 | ⬜ pending |
| W0 | — | 0 | OFFL-03 | — | online/offline store flips on events; surfaces short-circuit | unit | `pnpm test src/lib/services/online.test.ts` | ❌ W0 | ⬜ pending |
| W0 | — | 0 | SHARE-02 | — | ASCII slugify (CJK→ascii/strip); `entityShareUrl`/`parseEntityParam` round-trip; id authoritative | unit | `pnpm test src/lib/services/share.test.ts` | ⚠️ exists — MUST update (CJK reversed) | ⬜ pending |
| — | — | * | OFFL-02 | — | downloaded blob plays offline | unit (existing) | `pnpm test src/lib/.../player.svelte.test.ts` | ✅ verify green w/ SW | ⬜ pending |
| — | — | * | OFFL-03 | — | offline up-next builder | unit (existing) | `pnpm test` (downloads-queue `buildOfflineQueue`) | ✅ | ⬜ pending |
| — | — | * | SHARE-01 | — | `buildOg` https-guard + null→fallback | unit (existing, extend) | `pnpm test src/lib/services/share.test.ts` | ✅ extend for entity | ⬜ pending |
| Gate | — | merge | Both halves | — | D-03 dual-adapter constraint holds | build smoke | `pnpm build && pnpm build:native` | ❌ W0 gate task | ⬜ pending |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

---

## Wave 0 Requirements

- [ ] Extract SW bypass + cache-name logic into a pure importable helper (`src/lib/services/sw-cache.ts`: `shouldBypass(url, request)` + `cacheNameFor(version)`) so OFFL-01 is unit-testable without a SW runtime; `service-worker.ts` becomes a thin caller. → `sw-cache.test.ts`
- [ ] `src/lib/services/online.svelte.ts` (pure part `.ts`) for OFFL-03 → `online.test.ts`
- [ ] Update `src/lib/services/share.test.ts` for reversed CJK→ASCII slug behavior + add `entityShareUrl`/`parseEntityParam` tests
- [ ] Add a build-smoke gate task: `pnpm build && pnpm build:native` (D-03 dual-adapter hard constraint)
- [ ] SSR-safety audit task for album/artist `+page.svelte` BEFORE flipping `ssr=true` (or sidestep with a fresh minimal `/song` route)

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| Crawler sees per-entity OG in SSR HTML | SHARE-01 | Requires real edge SSR render + crawler UA | `curl -A facebookexternalhit <entity-url>` via `pnpm preview` / `wrangler pages dev`; assert `<meta property="og:*">` describes the entity |
| Static site-default meta + per-entity SSR meta present | SHARE-03 | Edge-rendered HTML inspection | `curl` shell page (static default in `app.html`) and entity route (per-entity SSR meta); assert title/description/canonical |
| App shell loads offline; downloaded song plays offline; surfaces degrade gracefully | OFFL-01/02/03 | iOS Safari PWA + SW + background-audio quirks need a real device | Install PWA, go offline, reload shell, play a downloaded song end-to-end, visit online-only surfaces → inline offline state (no stuck loaders) |

---

## Validation Sign-Off

- [ ] All tasks have `<automated>` verify or Wave 0 dependencies
- [ ] Sampling continuity: no 3 consecutive tasks without automated verify
- [ ] Wave 0 covers all MISSING references
- [ ] No watch-mode flags
- [ ] Feedback latency < 30s
- [ ] `nyquist_compliant: true` set in frontmatter

**Approval:** pending
