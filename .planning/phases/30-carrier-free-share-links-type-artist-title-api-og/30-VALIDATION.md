---
phase: 30
slug: carrier-free-share-links-type-artist-title-api-og
status: draft
nyquist_compliant: false
wave_0_complete: false
created: 2026-08-07
---

# Phase 30 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution.
> Derived from `30-RESEARCH.md` § Validation Architecture (line 1114).

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | Vitest `^4.1.3`, single `server` (node) project — **no jsdom** |
| **Config file** | `vite.config.ts` (`include: ['src/**/*.{test,spec}.{js,ts}']`) |
| **Quick run command** | `pnpm vitest --run <path>` |
| **Full suite command** | `pnpm test` (`vitest --run`) |
| **Type gate** | `pnpm check` (`svelte-kit sync && svelte-check`) — the only other gate |
| **Build gates** | `pnpm build` (adapter-cloudflare) **and** `pnpm build:native` (adapter-static) |
| **Estimated runtime** | ~30 s full suite (~67 test files) |

**No framework install needed.** No new npm dependency is permitted (CLAUDE.md).

---

## Sampling Rate

- **After every task commit:** `pnpm vitest --run <touched test files>` + `pnpm check`
- **After every plan wave:** `pnpm test` (full) + `pnpm build` + `pnpm build:native` + the `curl` matrix against `pnpm dev`
- **Before `/gsd:verify-work`:** full suite green, both builds green, then the deployed-URL crawler checkpoint
- **Max feedback latency:** ~30 s (full suite); ~3 s for a single touched test file

---

## Per-Requirement Verification Map

Task IDs are filled in by the planner; every task must map to one of these rows.

| Requirement | Observable signal that proves it works | Sampling point | Test Type | Automated Command | File Exists |
|---|---|---|---|---|---|
| **OG-PATH-01** | `/song/{a}/{t}` and `/album/{a}/{n}` return 200 with the OG head in the **server** HTML; `svelte-kit sync` + both builds exit 0 | per task commit; per wave | unit + build + preview | `pnpm check` && `curl -s $DEV/song/Nirvana/Come-As-You-Are \| grep 'og:'` | ❌ W0 — `src/routes/(app)/song/[artist]/[title]/loader.test.ts` |
| **OG-PATH-02** | `songShareUrl` / `entityCardUrl` output contains **no `?`**; every §B.7 stress case round-trips; the `matchKey` invariant holds under hyphen→space loss | per task commit | unit | `pnpm vitest --run src/lib/services/share.test.ts` | ⚠️ exists — needs the §F.20 rewrite |
| **OG-EP-01** | tier order Deezer→iTunes→kuwo; a miss falls through; the overall deadline aborts in-flight tiers; a tier error never 500s; a `type` outside the closed set coerces | per task commit | unit (stubbed `fetch` per tier) + live corroboration | `pnpm vitest --run src/routes/api/og/og-endpoint.test.ts`; `curl -sI "$DEV/api/og?type=song&artist=Nirvana&title=Come+As+You+Are"` | ❌ W0 |
| **OG-EP-02** | `200` (never `30x`), `Content-Type: image/*`, `Cache-Control: public, max-age=86400, immutable`; a 2nd identical request served from `caches.default` with **no** second upstream fetch; cached copy is CORS-free; **no** cache write on error | per task commit; per wave | unit (in-memory `caches.default`, pattern from `deezer-endpoint.test.ts:279-347`) + `pnpm preview` for real workerd `clone()` / `waitUntil` | `pnpm vitest --run src/routes/api/og/og-endpoint.test.ts` | ❌ W0 |
| **OG-EP-03** | **`deezer-endpoint.test.ts` passes with ZERO edits** (the regression harness proving behavior is unchanged); new `deezer-cover.test.ts` covers the extracted helpers directly; `/api/deezer/search` response bytes unchanged | per task commit | unit | `pnpm vitest --run src/routes/api/deezer/search/deezer-endpoint.test.ts src/lib/proxy/deezer-cover.test.ts` | ⚠️ harness exists — **do not modify**; helper test ❌ W0 |
| **OG-ZH-01** | **Decision artifact, not code.** If the research recommendation is taken: no `dn`/`da` in any emitted URL, and `grep -r "zh-convert" src/routes src/lib/components` shows no share-path caller | per task commit | unit + grep | `expect(url).not.toContain('dn=')` in `share.test.ts` | ⚠️ in the rewritten `share.test.ts` |
| **OG-COMPAT-01** | legacy `/song/{slug}?n=&a=&c=` and `/album/{name}?artist=&c=&dn=&da=` still 200 with a correct card; **a `%`-bearing name no longer 500s**; both route shapes coexist | per task commit; per wave | unit loader tests + `curl` matrix | `pnpm vitest --run` loader tests; `curl -sI "$DEV/album/50%25%20Off"` → 200 (today: 500) | ❌ W0 — no loader test exists for any of the three legacy loaders |
| **OG-VERIFY-01** | `pnpm test` green, `pnpm check` clean, both builds green; **plus** a real card rendered in ≥3 messengers | phase gate | full suite + **`checkpoint:human-verify`** | `pnpm test && pnpm check && pnpm build && pnpm build:native`; then deploy + Facebook Sharing Debugger + Twitter Card Validator + `curl -A 'facebookexternalhit/1.1' <url>` + paste into WhatsApp / iMessage / Slack | ⚠️ suite exists; the human checkpoint must be an explicit `autonomous: false` task |
| **OG-PAGE-01** | song page renders `<img>` (not `.cover--placeholder`); `og:url` origin matches the **requested** origin; `og:type` is `music.song` / `music.album` / `profile` per route; exactly ONE `og:type` per page; **APK image not broken** (must route through `apiUrl()`) | per task commit; device UAT | unit/head assertions + browser preview + **`checkpoint:human-verify`** for the APK | `curl -s $DEV/song/A/B \| grep -c 'og:type'` → `1`; `grep 'og:url'` shows the dev origin | ❌ W0 — no `PageOg` test exists |

---

## Wave 0 Requirements

- [ ] `src/routes/api/og/og-endpoint.test.ts` — OG-EP-01, OG-EP-02
- [ ] `src/lib/proxy/deezer-cover.test.ts` — OG-EP-03 (extracted-helper coverage)
- [ ] Loader tests for the two new routes **and** the three legacy loaders — OG-PATH-01, OG-COMPAT-01 (none exist today for any entity loader)
- [ ] Rewrite of the `songShareUrl` / `entityCardUrl` blocks in `src/lib/services/share.test.ts` (§F.20) — OG-PATH-02, OG-ZH-01
- [ ] A `PageOg` assertion path — component-level, or via the `curl` head check since there is no jsdom project — OG-PAGE-01
- [ ] `src/app.d.ts` — uncomment `ctx?: ExecutionContext` (`:21`) and add `ASSETS` if that binding is used
- [ ] Framework install: **none needed**

**Regression harness that must NOT be touched:** `src/routes/api/deezer/search/deezer-endpoint.test.ts`. Passing it unmodified is the proof that OG-EP-03's extraction is behavior-preserving. An executor editing this file to make it pass has invalidated the requirement.

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| Real messenger link cards | OG-VERIFY-01 | Needs a public deploy; crawlers cannot reach localhost and there is no proxy for this | Deploy, then: Facebook Sharing Debugger, Twitter Card Validator, `curl -A 'facebookexternalhit/1.1'`, and paste the link into WhatsApp, iMessage, Slack. Confirm the album art renders, not `/og.svg` |
| APK `<img>` on the song share page | OG-PAGE-01 | Capacitor WebView resolves a bare `/api/og` to `https://localhost/api/og` — only reproducible on device | `pnpm apk`, install, open a shared song link, confirm the cover image renders (not broken) |
| Real `caches.default` TTL / eviction / edge hit-rate | OG-EP-02 | `pnpm preview` simulates the Cache API, not edge cache lifetime or hit-rate | After deploy, request the same `/api/og` URL twice and confirm `cf-cache-status` / no second upstream hit in Workers logs |
| Edge CPU on a cold isolate | OG-ZH-01 | Limits are not enforced locally | Only needed if OG-ZH-01 is decided **against** the research recommendation. **Account is on a paid plan** (30 s CPU limit, 30 ms default billed), so the measured 8.90 ms `createConverterMap()` is not a hard blocker — but the recommendation stands on its other four reasons |

---

## Environment Notes

- **kuwo IS reachable in this sandbox** (`kw-api.cenguigui.cn` + `img4.kuwo.cn`). The
  `sandbox-no-cn-upstream-network` finding applies only to the netease/qq **Meting** hosts. All three
  `/api/og` tiers are therefore E2E-verifiable locally — OG-VERIFY-01's caveat is narrower than
  originally assumed.
- **Deezer is reachable** (confirms the existing `deezer-reachable-in-sandbox` finding).
- **Dev-server port depends on HOW it is started — BOTH are real. Resolve it, never assume:**
  - `.claude/launch.json` (what `preview_start` and the user's own running server use) passes
    `--port 4321 --strictPort` → **`:4321`**.
  - A bare `pnpm dev` (`"dev": "vite dev"`, no `server.port` in `vite.config.ts`) → Vite's default
    **`:5173`**.

  Every `curl` criterion in the plans is written against `:5173` because it assumes the executor
  starts its own `pnpm dev`. **Before running any curl, resolve the live port** — e.g.
  `DEV=http://localhost:4321; curl -sf -o /dev/null "$DEV" || DEV=http://localhost:5173` — and
  substitute it. A failed curl against the wrong port is not a failed acceptance criterion.
  CLAUDE.md's "strictPort 4321" is correct for the launch.json path, not stale.
- **Cloudflare plan: PAID.** CPU ceiling is 30 s (30 ms default billed), not the free tier's 10 ms.

---

## Validation Sign-Off

- [ ] All tasks have `<automated>` verify or a Wave 0 dependency
- [ ] Sampling continuity: no 3 consecutive tasks without automated verify
- [ ] Wave 0 covers all MISSING references above
- [ ] No watch-mode flags (`vitest --run` only, never `pnpm test:unit`)
- [ ] Feedback latency < 30 s
- [ ] `nyquist_compliant: true` set in frontmatter

**Approval:** pending
