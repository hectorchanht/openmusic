# Project Retrospective

Living retrospective for MusicSquare Mobile. One section per milestone.

## Milestone: v1.2 — Resilient Playback & UX Polish

**Shipped:** 2026-06-15
**Phases:** 9 (16–24) + Phase 999.1 (v2.0 backlog, executed early) | **Plans:** 43
**Timeline:** 2026-06-10 → 2026-06-14

### What Was Built

A never-stop playback engine (cross-source failover → skip-and-toast, next-track prefetch, queue auto-regenerate, loop-guard), per-context up-next sourcing, sleep timer, instant track menu with Remix, native-feel now-playing gestures, search/cover scoring + lazy cover cache, lyrics polish (tap-seek, suspend-resume, CN ordering), a broad YT-Music/Spotify-grade UX audit (skeletons, haptics, a11y, swipe rows), and net-new offline app-shell + readable share links with per-entity OG/SEO. Phase 999.1 additionally delivered a Capacitor Android APK pipeline on a dual-build single codebase without regressing the web target.

### What Worked

- **Dependency-ordered phase chain.** Phase 16 (resilience core: `queueContext`, 2-state repeat, skip-loop guard) as the explicit dependency root meant 17–24 layered policy/wiring onto a stable engine with near-zero net-new runtime deps.
- **Pure-core extraction.** Lyrics (`lrc.ts`), sleep-timer decision logic, search scoring, SW cache contract, and online-signal were all extracted as DOM-free / SSR-importable units and unit-tested before wiring — kept the ~626-test suite green throughout.
- **Net-new infra isolated last.** Phase 24 (service worker + per-entity SSR) deliberately sequenced at milestone end to contain Cloudflare deploy blast radius.

### What Was Inefficient

- **Worktree executors hit stale-base / missing-deps repeatedly.** Several phase summaries lead with "restored dependencies in the worktree" / "node_modules missing" — worktree isolation forked stale state and lost `node_modules`. (Already captured in memory: run quick executors non-worktree.)
- **Auto-extracted milestone accomplishments were noise.** `milestone.complete` pulled code-review finding lines ("[Rule 3 - Blocking]…") as accomplishments; had to hand-rewrite MILESTONES.md.
- **Quick-task status tracking drifted.** 75 quick-tasks showed `missing` at close — completion markers the scanner couldn't match. Hard to tell shipped-vs-open at milestone boundary.

### Patterns Established

- Device-only behaviors (iOS audio fade, touch gesture feel, APK background audio) are split into `*-HUMAN-UAT.md` and explicitly deferred rather than blocking close.
- i18n keys added across all 15 locales within the same task (not deferred), enforced by a parity test widened from 3 → 15 dicts.
- Atomic single-commit for mutually-dependent component rewrites (e.g. TrackMenu) that won't compile in partial states.

### Key Lessons

- Make the resilience/queue engine the dependency root and everything downstream is wiring — high leverage.
- Don't run GSD executors in worktree isolation for this repo (stale base + dep loss). 
- Triage quick-tasks before milestone close so the open-artifact audit is meaningful.

### Cost Observations

- Model mix: 100% opus (quality profile, executor + planner).
- Notable: most v1.2 work was policy + UI wiring on existing engine — cheap relative to the 999.1 native spike.

## Cross-Milestone Trends

| Milestone | Phases | Plans | Shipped | Theme |
|-----------|--------|-------|---------|-------|
| v1.0 Foundation | 1–7 (+14) | — | — | SvelteKit rebuild of desktop player |
| v1.1 Last.fm Read | 8–10 | 5 | 2026-06-06 | Enrichment + discovery + LF-searchable source |
| v1.2 Resilient Playback & UX Polish | 16–24 | 43 | 2026-06-15 | Never-stop engine + native-feel polish + offline/SEO |

**Recurring:** worktree dependency/base issues; device-only UAT deferral; quick-task tracking drift.
