---
phase: quick-261004-n1i
plan: 01
subsystem: api
tags: [kuwo, edge-proxy, cloudflare, resolver-chain, health-check, github-actions]

requires:
  - phase: debug kuwo-upstream-dead-gate-never-trips
    provides: client kuwoJson seam that counts any non-200 / non-JSON against the kuwo health gate
provides:
  - /api/kuwo/search (official search.kuwo.cn r.s, legacy row shape, 300 s edge cache)
  - /api/kuwo/detail (full-length audio via haitangw -> nxinxz, m.kuwo.cn lyrics, 502 on exhaustion, no-store)
  - client level tokens 128k | 320k | zp
  - upstream-health probes on search.kuwo.cn + musicapi.haitangw.net
  - weekly musicdl kuwo host watcher that opens a review PR
affects: [kuwo source, og share-card kuwo tier, upstream-health job, resolve floor]

tech-stack:
  added: []
  patterns:
    - "Dedicated edge route pair + pure fetch-injectable $lib/proxy module when an upstream needs a fallback chain the [source] catch-all cannot express"
    - "Untrusted resolver url gated by isAllowedKuwoAudioUrl (https + dot-anchored .kuwo.cn) before reaching the client"

key-files:
  created:
    - src/lib/proxy/kuwo.test.ts
    - src/routes/api/kuwo/search/+server.ts
    - src/routes/api/kuwo/detail/+server.ts
    - scripts/musicdl-watch.mjs
    - scripts/musicdl-kuwo-hosts.json
    - src/lib/health/musicdl-watch.test.ts
    - .github/workflows/musicdl-watch.yml
  modified:
    - src/lib/proxy/kuwo.ts
    - src/lib/proxy/proxy-registry.ts
    - src/routes/api/[source]/[...path]/+server.ts
    - src/routes/api/proxy.test.ts
    - src/lib/proxy/og-cover.ts
    - src/routes/api/og/og-endpoint.test.ts
    - src/lib/sources/kuwo.ts
    - src/lib/sources/kuwo.test.ts
    - src/lib/services/kuwo-health.ts
    - scripts/upstream-health.mjs
    - src/lib/health/upstream-health.test.ts

key-decisions:
  - "kuwo leaves the catch-all PROXIES registry for a dedicated /api/kuwo/{search,detail} route pair; all logic in pure $lib/proxy/kuwo.ts"
  - "Audio resolvers walked SEQUENTIALLY (haitangw then nxinxz), 6 s per attempt; any url not https *.kuwo.cn counts as that resolver failing"
  - "Exhausted resolver chain answers 502 on purpose so the client kuwoJson seam feeds the health gate"
  - "A '320' (and cellular 'auto') pref now gets a real 320k mp3 (level=exhigh) instead of lossless FLAC"
  - "musicdl watcher compares hostnames only (PolyForm Noncommercial: no code copied); PR on a musicdl-watch/<date> branch, never main"

patterns-established:
  - "Edge chain module: pure helpers + fetchImpl injection, routes are verb-only thin callers"

requirements-completed: [QUICK-261004-N1I]

duration: 22min
completed: 2026-10-04
---

# Quick 261004-n1i: Restore kuwo via search.kuwo.cn + musicdl resolver chain Summary

**kuwo plays again: official search.kuwo.cn search plus full-length 128k/320k/FLAC audio through a sequential haitangw → nxinxz resolver chain on a dedicated edge route. Every resolver url is gated to https `*.kuwo.cn`, the client contract and `kuwo:<rid>` ids are unchanged, health probes watch the new hosts, and a weekly musicdl watcher opens a review PR.**

## Performance

- **Duration:** ~22 min
- **Started:** 2026-10-04T08:47Z
- **Completed:** 2026-10-04T09:10Z
- **Tasks:** 3/3 (plus one comment-only follow-up commit)
- **Files:** 18 (7 created, 11 modified)

## Commits

| Task | Commit | Message |
|------|--------|---------|
| 1 | `76f393e9` | feat(quick-261004-n1i): kuwo via search.kuwo.cn + musicdl resolver chain on a dedicated edge route |
| 2 | `33de1799` | fix(quick-261004-n1i): kuwo 320k level token + health probes on the new kuwo hosts |
| 3 | `d533f7db` | ci(quick-261004-n1i): weekly musicdl kuwo resolver watcher opens a review PR |
| follow-up | `e975fa00` | docs(quick-261004-n1i): drop stale kuwoProxy / kw-api names from two new header comments |

All four are on `claude/intelligent-hawking-fdbb8a`, staged by explicit path. Nothing pushed, main not touched.

## Verification (observed output)

**Task 1 live E2E** (dev server on :4321, started from this worktree because nothing was listening on 4321 or 5173):
- `search ok 228908 晴天 周杰伦 https://img2.kuwo.cn/star/albumcover/500/s3s94/93/211513640.jpg`
- detail `level=320k` → `https://car-er.kuwo.cn/.../M800000bYDlc2XxKLs.mp3`, HEAD **content-length 10,792,943 B** (full-length 320k for 269 s, not an 11 s clip)
- detail `level=128k` → **4,317,292 B** mp3; lyric = 63 LRC lines (`[00:02.25]词：周杰伦`), name `晴天`
- `zp → flac ok`; `bad id → 400 ok`
- Extra checks: cover url → 200 image/jpeg (108,066 B); detail `cache-control: no-store`; search `public, max-age=300`; `/api/kuwo/foo` → 404 (kuwo is out of the catch-all).
- `src/lib/proxy/kuwo.test.ts`: RED 29/29 failing before the implementation, GREEN 29/29 after.

**Task 2:** `node scripts/upstream-health.mjs --origin http://localhost:4321` → `kuwo/search payload ok`, `kuwo/resolve payload ok` (count = 2); certs ok for `search.kuwo.cn` (30 d left) and `musicapi.haitangw.net` (82 d). `grep kw-api` in the script and its test returns nothing. `sources/kuwo.test.ts` + `upstream-health.test.ts`: 35/35 pass.

**Task 3:** watcher test RED (module missing) → GREEN 8/8. `node scripts/musicdl-watch.mjs` against the committed snapshot → `unchanged`, exit 0; snapshot check `snapshot ok 11 hosts`, no `checkedAt`; `git diff --quiet` on the snapshot is clean after the commit. Every workflow grep guard passes (`gh pr create`, `pull-requests: write`, no `git add -A/.`, no push to main). The YAML parses with python `yaml.safe_load`. js-yaml is not installed, and no package was added.

**Repo gates:** `pnpm check` → 0 errors (13 pre-existing CSS warnings) after every task. `pnpm test` → 3968/3971 pass. The 3 failures are load-induced timing tests outside this change (see Deferred Issues).

**Plan verification greps:** `grep -rn kw-api scripts src/lib/health` → nothing; `grep -rn kuwoProxy src` → nothing.

## Seeded host snapshot (live from raw.githubusercontent.com)

`scripts/musicdl-kuwo-hosts.json`: apione.apibyte.cn, kw.006lp.ccwu.cc, lxmusicapi.onrender.com, m.kuwo.cn, mobi.kuwo.cn, music-api.gdstudio.xyz, music.nxinxz.com, music.xcloudv.top, musicapi.haitangw.net, newlyric.kuwo.cn, www.kuwo.cn (11 hosts). This is the true list, not the hand-seeded fallback.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Test assertion contradicted the plan's own 502 message**
- **Found during:** Task 1 (GREEN)
- **Issue:** My first test asserted the 502 body contains no `url` substring, but the plan-mandated msg `'kuwo: no playable url from any resolver'` contains the word "url".
- **Fix:** The test now asserts the body has no `data` and no `"url"` key, which is the actual intent ("body carries no url").
- **Commit:** 76f393e9

**2. [Rule 3 - Blocking] upstream-health header mentioned `kw-api` and failed the Task 2 grep guard**
- **Found during:** Task 2 verify
- **Fix:** Reworded the historical header lines to "the cenguigui kuwo API". The decision history is kept and the string is gone.
- **Commit:** 33de1799

**3. [Rule 3] Two of my own new header comments named `kuwoProxy` / `kw-api`**
- **Found during:** final plan-verification greps
- **Fix:** Comment-only follow-up commit, so the plan's verification greps return empty. This makes 4 commits instead of the planned 3.
- **Commit:** e975fa00

**4. [CLAUDE.md - keep decision refs] D-03 ref preserved**
- The plan said to replace the D-03 / A1 comment block. CLAUDE.md forbids removing decision-ref comments, so the new block opens with "D-03, revised by quick-261004-n1i: ..." and keeps 32-D-02 and WR-07 verbatim.

**5. Extra stale comment fixed in sources/kuwo.ts**
- The interface comment "Kuwo search row shape from the kw-api endpoint" now reads "from /api/kuwo/search". The kuwoJson seam is byte-identical.

### TDD gate note
The plan's `<done>` asks for ONE commit per task, so the RED and GREEN phases were not split into separate `test(...)`/`feat(...)` commits. RED was observed and recorded above for both TDD tasks (Task 1: 29/29 failing; Task 3: module-not-found) before any implementation was written.

## Assumption Drift (advisory)

- **Found during:** Task 1 (live probe). **Planned:** `songinfo` from m.kuwo.cn supplies name/artist/album/pic. **Actual:** it is sparse and flaky. For 228908, `artist` and `pic` are `""`, and about 1 in 3 calls answers `{"data":null,"status":301,"msg":"音乐查询失败"}`. **Why it matters:** detail `pic` will almost always be `null`. That is harmless for search-originated tracks, because the client keeps `track.cover` (`d.pic || track.cover`), and the never-throw design already handled the failure. A `kuwo:<rid>` stub with no cover gets its cover from the normal Deezer/iTunes chain, not from detail.

## Deferred Issues

- **Load-induced test flakes (not caused by this change).** The machine's load average was 108–188 throughout. Two tests failed under load:
  - `device-filename.test.ts` "probe stays bounded": a `<2000ms` wall-clock assertion. It ALSO fails on the base commit `aa8356ff`, run from a `git archive` export.
  - `names.test.ts`: two tests. The first hit a 5 s timeout on a dynamic import, and the second failed as a cascade from it. They pass 53/53 in this tree when run on their own.
  - `lyric-script` and `cover-cache` failed once in a full run and passed on their own.
  - None of these files imports anything changed here.
- **search.kuwo.cn cert has 30 days left**, which is exactly the `--warn-days 30` threshold. The daily job will show a degraded `warn` for that host until kuwo renews, and it will not fail the job.
- **Stale comment left as-is:** `sources/kuwo.ts` `search()` still says the upstream "serves a broken TLS cert, so Cloudflare 526s". It is outside the lines the plan allowed to change in that file.

## Threat Flags

None beyond the plan's threat model. T-n1i-01 through T-n1i-07 are implemented as registered: the url gate, per-attempt timeouts, shape-gated parsing, the cover path regex plus safeImageUrl, single-pass entity decode, limit/page clamp with id validation before any fetch, and job-scoped CI perms.

## Known Stubs

None.

## Self-Check: PASSED

- FOUND: src/lib/proxy/kuwo.test.ts, src/routes/api/kuwo/search/+server.ts, src/routes/api/kuwo/detail/+server.ts, scripts/musicdl-watch.mjs, scripts/musicdl-kuwo-hosts.json, src/lib/health/musicdl-watch.test.ts, .github/workflows/musicdl-watch.yml
- FOUND commits: 76f393e9, 33de1799, d533f7db, e975fa00
