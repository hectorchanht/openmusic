---
phase: 32-qq-lossless-first-resolve-rebuild-the-fast-path-around-the-p
plan: 07
status: complete-with-blockers
subsystem: phase-gate / verification
tags: [gate, verification, workerd, edge-cache, apk, d-16-audit, live-probe, blocked]
requires:
  - "32-01, 32-02, 32-04, 32-05, 32-06, 32-09 — every wave merged and on main; this plan verifies the assembled result"
  - "32-09's SUMMARY 'Handoff to 32-07' — the two NEW live-workerd walks the v3 url layer owes"
provides:
  - "full suite + typecheck green on the assembled phase: 101 files / 1916 passed, 0 failed; 0 ERRORS 0 WARNINGS"
  - "32-D-16 evidence: actual hunk ranges for every phase commit touching player.svelte.ts, none intersecting the protected tail"
  - "LIVE workerd proof of the 32-D-10/D-10a permanent-mid cache and its bust-repair path, from the deployed edge across two PoPs"
  - "root cause + discharge of the folded todo edge-resolve-cache-returns-miss.md (wrong query-param names, cache never consulted)"
  - "a fresh post-guard debug APK (5,555,022 B, 2026-08-31 22:38) with the 32-D-13 absolute-url guard verified present in the shipped bundle"
  - "an explicit BLOCKED list routed to 32-08's device checkpoints"
affects:
  - "plan 32-08 — inherits the two v3 live-workerd walks as blocked items, plus the existing device checkpoints"
  - "/gsd:verify-work for Phase 32 — VALIDATION gates #3 and #6 are CLOSED for v2 / PARTIAL for v3; read 'Gate Status' below before judging"
tech-stack:
  added: []
  patterns:
    - "audit a no-touch constraint per-commit in each commit's OWN base numbering, not against a whole-range diff that interleaves unrelated work"
    - "distinguish deployed-code evidence from working-tree code by the response SHAPE (explicit nulls vs absent keys), not by assumption"
key-files:
  created:
    - .planning/phases/32-qq-lossless-first-resolve-rebuild-the-fast-path-around-the-p/32-07-SUMMARY.md
  modified:
    - .planning/todos/completed/2026-08-31-edge-resolve-cache-returns-miss.md
    - android/app/build/outputs/apk/debug/app-debug.apk
decisions:
  - "the D-16 audit was scoped to PHASE commits only, evaluated in each commit's own base line-numbering; the whole-range diff 6189b87~1..HEAD is NOT a valid instrument here because three interleaved quick/debug commits sit inside the range and one of them does touch the protected tail"
  - "no production deploy was performed. The plan sanctioned `pnpm run deploy` as a fallback, but the deployed edge already carries 32-04, which made the v2 walks observable read-only; deploying to ship v3 for a gate probe was not taken on a gate agent's own initiative"
  - "the v3 (32-09) walks are reported BLOCKED rather than substituted with `pnpm dev` — edgeCache() returns null there, so a dev run would be a false pass, which is the exact trap VALIDATION gate #3 names"
  - "the POST bust WAS exercised against production. T-32-19 accepts it explicitly ('worst case = a cold re-fill'), it is idempotent, and the re-fill was observed completing in seconds — so the only live proof of the D-10a repair path was worth one song's cold walk"
metrics:
  duration: ~22 min
  completed: 2026-08-31
requirements: [D-10, D-13, D-16]
---

# Phase 32 Plan 07: The phase gate Summary

The assembled phase is green (1916/1916, 0/0), the 32-D-16 no-touch constraint is evidenced by actual
hunk ranges rather than asserted, a post-guard APK exists with the guard verified in the shipped
bundle, and the 32-D-10/D-10a permanent-mid cache — including its bust-repair path — is proven on a
REAL workerd Cache API. **Two v3-specific walks (32-D-20's url layer) are BLOCKED and routed to
32-08**, because the code carrying them is on `main` but not deployed, and no preview server could be
started here.

---

## Gate Status at a glance

| Check | Status | Evidence |
|-------|--------|----------|
| `pnpm test` | **PASS** | 101 files / 1916 passed / 0 failed |
| `pnpm check` | **PASS** | 4406 files, 0 ERRORS 0 WARNINGS 0 FILES_WITH_PROBLEMS |
| 32-D-16 no-touch audit | **PASS** | hunk ranges below; max line touched 2688 vs region starting 2892 |
| `RESOLVE_CACHE_VERSION === '3'` | **PASS** | `resolve-cache.ts:32` |
| VALIDATION #3 — D-10 live on workerd | **PASS (v2 shape)** | deployed-edge transcripts, two PoPs |
| VALIDATION #3 — D-10a bust repair live | **PASS** | `{"busted":true}` → miss → re-fill → hit |
| 32-09 walk 1 — stale-url → refresh | **BLOCKED** | v3 not deployed; no preview server available |
| 32-09 walk 2 — bust → miss → mid-only → url-warm | **BLOCKED** | same |
| VALIDATION #6 — APK rebuild | **PASS** | BUILD SUCCESSFUL, guard present in bundle |
| Folded todo `edge-resolve-cache-returns-miss` | **RESOLVED** | root-caused; moved to `completed/` |

---

## Task 1 — Full gate + the 32-D-16 diff audit

### Suite and typecheck (run, output observed)

```
$ pnpm test
 Test Files  101 passed (101)
      Tests  1916 passed (1916)
   Duration  8.97s

$ pnpm check
1788237418648 COMPLETED 4406 FILES 0 ERRORS 0 WARNINGS 0 FILES_WITH_PROBLEMS
```

Matches 32-09's recorded baseline exactly (101 / 1916, 0/0). No drift from assembling the waves.

### 32-D-16 audit — the instrument matters

The plan says to inspect `git log -p -- player.svelte.ts` across the phase. **Run naively that gives
a wrong answer**, so the method is stated before the result:

The phase's commit RANGE (`6189b87~1..HEAD`, 59 commits) is not the phase's commit SET. Three
unrelated commits are interleaved inside it — `ade3ec7` (`quick-260831-t2g`), `6c457fa`
(`quick-260831-sp9`) and `032b6c2` (`debug/upnext-diverse`) — all of which touch
`player.svelte.ts`, and one of which **does** land inside the protected tail. A whole-range diff
would therefore report a D-16 violation that phase 32 did not commit. Each commit is consequently
audited **in its own base line-numbering**, which is the only numbering its hunk headers are stated in.

**Phase-32 commits touching `src/lib/stores/player.svelte.ts`: exactly one.**

```
$ git log --oneline 6189b87~1..HEAD -- src/lib/stores/player.svelte.ts
323669a feat(32-06): skip the prebuffer blob above the 24MB ceiling (32-D-15, 32-D-17)
ade3ec7 feat(quick-260831-t2g): …          <- NOT phase 32
6c457fa fix(quick-260831-sp9): …           <- NOT phase 32
032b6c2 fix(debug/upnext-diverse): …       <- NOT phase 32

$ git show 323669a --unified=0 -- src/lib/stores/player.svelte.ts | grep '^@@'
@@ -21,0 +22 @@       import { dedupeBest, sameSongKey } from '$lib/services/dedupe';
@@ -2645,0 +2647,5 @@ class Player {
@@ -2663,0 +2670,19 @@ class Player {
```

Three hunks: one import line (22), a five-line doc block (2647–2651), and the ceiling guard itself
(2670–2688). **Highest line touched: 2688.**

**Numbering used, stated explicitly:** the protected region is `2892–3033` in the numbering in force
at `323669a`'s base — which is the same numbering D-16 was recorded in, because no phase commit
before it edited this file. Post-32-06 the region shifts +25 to `2917–3058`; that shift does not
matter here, since 2688 is below the region's start under **either** numbering, by 204 lines. No
hunk intersects it, and no line inside it was edited.

Cross-checks:
- `git diff dc63b19~4..HEAD -- src/lib/stores/player.svelte.ts` is empty — 32-09 made zero player
  edits (recorded independently in its own SUMMARY).
- No other phase plan (32-01/02/03/04/05/09) appears in the file's log at all.
- 32-06's own SUMMARY performed this same audit at the time and reached the same three hunks.

### Honest note on the interleaved commit

`ade3ec7` (`quick-260831-t2g`, a cover-attachment fix, committed between plans 32-04 and 32-05)
carries `@@ -2977,2 +3009,12 @@` and `@@ -3124,3 +3166,8 @@` — hunks that **do** sit inside the
post-resolve tail. This is recorded, not hidden. It is out of D-16 scope because D-16 constrains
what *this phase* re-architects, and that commit is a separate quick task with its own record; but a
verifier diffing the whole range will see it, and this paragraph is why it is there.

---

## Task 2 — D-10 against a real Cache API (VALIDATION gate #3)

### What could and could not be run here

`pnpm preview` (`wrangler pages dev`) could **not** be started in this environment: this executor has
no browser-pane tooling available and is instructed not to start servers from Bash. `pnpm dev` was
**not** substituted — `edgeCache()` returns `null` when `caches` is undefined, so every cache path
silently no-ops there and "works" would be a false pass. That is precisely VALIDATION gate #3's trap.

What *was* available is better than a preview server for the v2 layer: **the deployed edge at
`https://openmusic.lol` is already running phase-32 code.** All transcripts below are from real
Cloudflare workerd with a real `caches.default`.

**How the deployed build was identified** (inference from observed shape, stated as such): the
returned entry is `{"source":"qq","songid":…,"avail":{"qq":"ok"}}` — qq-sourced with a mid and **no**
`url` key. Phase 31's entry filled kuwo-first and carried a `url`. 32-09's v3 fill returns explicit
`url: null, urlExp: null, urlQuality: null` (`resolve-edge.ts:51-53`), which `JSON.stringify` would
emit as keys. The observed body matches **neither** — it matches the 32-04 **v2** shape exactly.
Deployed ⊇ 32-04, ⊅ 32-09.

### Walk 1 — cold → warm (the D-10 permanent mid)

```
GET 1  22:38:34  -> HTTP/2 200, cache-control: no-store, cf-cache-status: DYNAMIC
                    {"hit":false}
GET 2  22:39:02  -> {"hit":true,"entry":{"source":"qq","songid":"0039MnYb0qxYhV","avail":{"qq":"ok"}}}
GET 3  22:39:07  -> {"hit":true,"entry":{"source":"qq","songid":"0039MnYb0qxYhV","avail":{"qq":"ok"}}}
GET 4  22:39:11  -> {"hit":false}          <- a DIFFERENT PoP, cold (see below)
```
(`?a=周杰伦&t=晴天`, url-encoded.)

Every acceptance criterion for this walk is met on the recorded transcript: the second GET is
`hit:true`, `source:"qq"`, a non-empty `songid` (the permanent mid), **no `url` property**, and
`avail.qq === "ok"`. The out-of-band `waitUntil` fill demonstrably lands in workerd — the single
thing unit tests structurally cannot show.

### The `hit:false` at GET 4 is PoP locality, and it is provable

Capturing `cf-ray` per request shows this sandbox's egress alternating between two colos, so a
"regression" was actually two independent caches warming at different times. Once both were warm:

```
稻香 #1  cf-ray a341985a5e912384-YVR  -> hit  songid 003aAYrm3GE0Ac
稻香 #2  cf-ray a34198706f143c29-SEA  -> hit  songid 003aAYrm3GE0Ac
稻香 #3  cf-ray a341988769dcec98-SEA  -> hit
稻香 #4  cf-ray a341989dcc37ef12-YVR  -> hit
稻香 #5  cf-ray a34198b32abc75a2-SEA  -> hit
稻香 #6  cf-ray a34198c9580f0c8d-YVR  -> hit
晴天 #1  cf-ray a34198dd88acd452-SEA  -> hit  songid 0039MnYb0qxYhV
晴天 #2  cf-ray a34198f1cabf1a75-YVR  -> hit
晴天 #3  cf-ray a3419905ebc121ab-SEA  -> hit
```

9/9 hits, two PoPs, two songs, stable mids. `caches.default` being per-data-center (31-D-10) is
confirmed behaviour rather than a hypothesis.

### Walk 2 — POST bust → miss → re-fill (the D-10a repair path)

```
POST {"a":"周杰伦","t":"稻香"}   -> {"busted":true}    (cache-control: no-store)
GET #1  cf-ray a3419a76fc9c2c2e-YVR  -> {"hit":false}
GET #2  cf-ray a3419a8d5c48753f-SEA  -> {"hit":false}
GET #3  cf-ray a3419aa3aed8a1a5-SEA  -> {"hit":true,"entry":{"source":"qq","songid":"003aAYrm3GE0Ac","avail":{"qq":"ok"}}}
GET #4  cf-ray a3419ab989d1a34d-SEA  -> hit
GET #5  cf-ray a3419acefae1b872-YVR  -> hit
GET #6  cf-ray a3419ae43d87764b-SEA  -> hit
```

The full contract end to end: delete works, the key genuinely returns to a miss, and the fill
re-warms it unattended. This is the live proof that **D-10a's decision to keep the bust handler was
not merely safe but functional** — the repair path 32-CONTEXT calls load-bearing actually repairs.

### `Cache-Control: no-store` on the ROUTE response

Present on **every** response captured above — the cold GET, all warm GETs, and all three POSTs.
The 31-D-09 bug-prevention (an intermediary caching the `{hit:true}` view would defeat the bust for
up to a year under the new permanent max-age) survives the phase in production.

### BLOCKED — the two v3 walks handed over by 32-09

Neither can be run here, and neither is faked:

**1. stale-url → refresh.** Needs the v3 entry so a second GET returns a populated https
`entry.url` with `urlQuality: "lossless"`.
**2. bust → miss → mid-only → url-warm.** Needs the same.

**Reason, precisely:** the code is on `main` but not deployed (shown above), and `pnpm preview`
cannot be started from this executor. Not blocked by network — `tang.api.s01s.cn` and Deezer are
reachable from this sandbox; only the qijieya Meting hosts are not.

**Exact commands a human must run:**
```bash
pnpm build && pnpm preview          # wrangler pages dev on :4173 — NOT pnpm dev
#   then, against http://localhost:4173 :
curl -s '…/api/resolve?a=%E5%91%A8%E6%9D%B0%E4%BC%A6&t=%E6%99%B4%E5%A4%A9'   # miss
curl -s '…/api/resolve?a=…&t=…'      # hit, songid set, url:null   (refresh scheduled)
curl -s '…/api/resolve?a=…&t=…'      # hit, url populated https, urlQuality:"lossless"
curl -s -X POST '…/api/resolve' -H 'content-type: application/json' \
     --data '{"a":"周杰伦","t":"晴天"}'                                       # {"busted":true}
#   then GET x3: miss -> hit+url:null -> hit+fresh url
```
Or, equivalently, `pnpm run deploy` (**never** bare `pnpm deploy` — a pnpm builtin shadows it) and
re-run the transcripts above against `https://openmusic.lol`. **Also confirm while there:** the key
namespace is `v=3`, and the rewritten entry still returns `public, max-age=31536000, immutable` on
the STORED response.

**Expected on first post-deploy request:** every currently-warm entry misses once. That is the
designed v2→v3 key rollover, not a regression.

### `RESOLVE_CACHE_VERSION` — the plan's criterion was stale

```
$ grep -n "RESOLVE_CACHE_VERSION\s*=" src/lib/proxy/resolve-cache.ts
32:export const RESOLVE_CACHE_VERSION = '3';
```

Verified `'3'`. VALIDATION gate #4 says `'1' → '2'` and this plan's frontmatter key-link says "a
songid mid and NO url field" — both were written before 32-09 existed and are superseded by D-20.
Recorded under Assumption Drift below rather than silently corrected.

---

## Task 3 — APK rebuild (VALIDATION gate #6)

```
$ JAVA_HOME=/opt/homebrew/opt/openjdk@21/libexec/openjdk.jdk/Contents/Home pnpm apk
> Task :app:assembleDebug
BUILD SUCCESSFUL in 10s
276 actionable tasks: 27 executed, 249 up-to-date

$ ls -la android/app/build/outputs/apk/debug/app-debug.apk
-rw-r--r--@ 1 laichan staff 5555022 Aug 31 22:38 android/app/build/outputs/apk/debug/app-debug.apk
```

**PASS, not blocked.** Both prerequisites were present: `~/Library/Android/sdk` and Homebrew's
`openjdk@21`. The STATE.md gotcha reproduced exactly — the ambient `JAVA_HOME` is empty and Gradle's
toolchain detection misses the Homebrew JDK, so the prefix is required. It remains uncommitted
(developer-machine concern).

**mtime 22:38** vs the last phase commit `a7b0dc4` at **22:34:58** — newer, as the criterion requires.

**The 32-D-13 guard is verified present in the shipped bundle, not assumed.** The source comment is
stripped by minification, so the minified function was grepped directly out of
`build/_app/immutable/`:

```js
function e(e){return/^https?:\/\//i.test(e)?e:`https://openmusic.lol`+e}
```

That is `apiUrl` with **both** halves in one line: the absolute-url early return (the guard —
without it the native build concatenates `https://openmusic.lolhttps://tang…` and `TypeError`s at
fetch) and the baked `VITE_API_BASE`. The tang host is also present in the bundle
(`build/_app/immutable/chunks/BGyovxuL.js`), confirming the direct-call code shipped. Android is the
one platform that reports `NetworkInformation.type`, so this binary is where `'auto'` → lossless
actually exercises.

---

## The folded todo — RESOLVED, with a root cause

`.planning/todos/pending/edge-resolve-cache-returns-miss.md` →
`.planning/todos/completed/2026-08-31-edge-resolve-cache-returns-miss.md`, with the resolution
appended in full.

**Root cause: the original probe used the wrong query-parameter names.** It curled
`?artist=…&title=…`; `/api/resolve` has only ever read `a` and `t` (verified back to `a3d40ea`,
phase 31-03), and:

```ts
if (!a && !t) return jsonResult({ hit: false }, origin);   // zero cache touches, zero subrequests
```

So the reported `{"hit":false}` was a constant short-circuit with the **cache never consulted at
all** — not a cold entry, not a failed fill, not PoP locality. The 13-byte response length in the
original transcript is exactly `{"hit":false}`. Every hypothesis in the todo's "not yet ruled out"
list was investigating a mechanism the request never reached.

**And the worry is retired on its own terms:** with the correct parameters, 稻香 — the exact song in
the report — hits 6/6 across two PoPs (transcript above). The comparability caveat the phase asked
for is recorded in the todo file: those transcripts are the **v2** shape, and `main` is `v3`, so the
original symptom is not directly comparable and the entries will roll over once on deploy.

---

## Assumption Drift (advisory)

**1. `RESOLVE_CACHE_VERSION` — planned `'2'`, actual `'3'`**
- **Found during:** Task 2.
- **Planned:** this plan's frontmatter key-link and VALIDATION gate #4 both describe the v2 entry
  ("a songid mid and NO url field", "`'1'` → `'2'`").
- **Actual:** `'3'`, with `url`/`urlExp`/`urlQuality` beside the mid.
- **Why:** plan 32-09 was added mid-phase under D-20 (user-approved), restoring a short-TTL url
  layer beside the permanent mid. 32-07 was written when the phase had 8 plans. The v2 criteria are
  still *satisfied* by what is deployed; they are simply no longer what `main` ships.

**2. The plan assumed the live check would need a preview server or a deploy; the deployed edge was
already carrying phase-32 code**
- **Found during:** Task 2.
- **Planned:** "verify against `pnpm preview`, or deploy first and verify against the URL."
- **Actual:** production already served the 32-04 v2 entry shape, so the v2 half of gate #3 was
  observable read-only, with no deploy and no preview server.
- **Why:** the phase was deployed at some point mid-execution. It changes the gate's outcome
  materially — most of gate #3 is closed by observation rather than deferred — so it is recorded
  rather than glossed.

**3. The whole-range diff is not a valid D-16 instrument**
- **Found during:** Task 1.
- **Planned:** `git log -p --follow -- player.svelte.ts` since the phase's first commit.
- **Actual:** three unrelated quick/debug commits are interleaved in that range and one touches the
  protected tail, so the naive instrument reports a violation phase 32 did not commit.
- **Why:** quick tasks were executed between phase plans on the same branch. The audit was
  re-scoped to phase commits in their own base numbering.

---

## Deviations from Plan

**None requiring a fix.** No source file was modified by this plan — it is a verification gate. The
two scope judgements made (audit instrument; not deploying to production on a gate agent's own
initiative) are recorded as decisions in the frontmatter, and the plan's own sanctioned deploy
fallback was deliberately not taken because the v2 evidence was obtainable without it and shipping
v3 is a phase-completion decision, not a gate one.

---

## What plan 32-08's device checkpoints must now cover

**Newly blocked by this gate (carry these into 32-08):**

1. **v3 walk — stale-url → refresh.** GET twice against a v3 runtime; the second GET must return a
   populated https `entry.url` with `urlQuality: "lossless"`. Exact commands in Task 2 above.
2. **v3 walk — bust → miss → mid-only → url-warm.** POST the bust, then GET three times.
3. **v3 key rollover.** Confirm `v=3` is the namespace written, and that the rewritten entry still
   carries `public, max-age=31536000, immutable` on the STORED response.
4. **The poisoned-hit fall-through, live.** 32-09 pinned it at three unit layers; a 403 on a shared
   signed CN url reaching a *different* user's device is the case only a device can produce. It must
   be invisible from the user's seat (31-D-11).

**Already owed, unchanged, confirmed still outstanding:**

5. **Real-device tang RTT** (32-03 DEFERRED). Read 32-03's restated criterion — Phase 32 is judged on
   "no ADDED latency versus Phase 31", not the ROADMAP's absolute sub-second number.
6. **Install this APK and play.** `android/app/build/outputs/apk/debug/app-debug.apk` (22:38,
   5,555,022 B). The guard is verified in the bundle statically; only a device proves the direct
   tang call does not `TypeError`.
7. **VALIDATION #8 — the three freeze classes.** `nowbar-freeze-reresolve-loop`,
   `api-fetch-flood-freeze`, `restore-effect-self-invalidation-loop`, via Settings → Activity log
   under churn. Unit tests do not exercise churn.
8. **VALIDATION human-verify list, unchanged:** iOS Safari FLAC decode; `accom` = 伴奏 confirmation;
   Android lock-screen advance under D-15's 24 MB ceiling.
9. **Phase 30 leftover** (from STATE.md, unrelated to this phase but sharing the APK):
   `/song/Olivia-Dean/Man-I-Need` cover render + offline gradient fallback.

---

## Known Stubs

None. This plan wrote no source code.

## Threat Flags

None new. `T-32-19` (POST bust abuse) was exercised deliberately and behaved exactly as its accepted
disposition predicts — the bust deletes, and the worst case is one cold re-fill, observed completing
within seconds. `T-32-SC` holds: zero packages installed this phase.

## Self-Check: PASSED

- `.planning/phases/32-…/32-07-SUMMARY.md` — this file, exists.
- `.planning/todos/completed/2026-08-31-edge-resolve-cache-returns-miss.md` — exists;
  `.planning/todos/pending/edge-resolve-cache-returns-miss.md` — gone, as intended.
- `android/app/build/outputs/apk/debug/app-debug.apk` — exists, 5,555,022 B, mtime 2026-08-31 22:38.
- Commits cited in the D-16 audit resolve in `git log`: `323669a`, `ade3ec7`, `6c457fa`, `032b6c2`,
  `6189b87`, `a7b0dc4`, `a3d40ea`, `dc63b19`.
- `RESOLVE_CACHE_VERSION = '3'` confirmed at `src/lib/proxy/resolve-cache.ts:32`.
- This plan produced no source-code commit by design; its only commit is this metadata commit.
