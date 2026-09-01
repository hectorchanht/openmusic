---
phase: 32-qq-lossless-first-resolve-rebuild-the-fast-path-around-the-p
plan: 05
subsystem: sources / qq-resolve-hot-path
tags: [qq, resolve, latency, cors, quality-tier, https-upgrade, accom, circuit-breaker]
requires:
  - "32-01's effectiveQuality() — the 'auto' → concrete-tier seam qq now calls"
  - "32-02's apiUrl absolute-url passthrough — without it the direct call is a hard TypeError on the native build"
provides:
  - "qq detail = ONE direct simple-request GET to tang given a mid, with a one-shot /api/qq/detail fallback"
  - "https-only qq audio urls (one upgrade at the single ladder return boundary)"
  - "accom demoted below every real-song rung; honest ACCOM label"
  - "the ladder's own tier tag survives — inferQualityFromUrl is a fallback, not an overwrite"
affects:
  - "every qq play — this is the click-to-play path now that 32-D-08 makes qq win the dedupe tie"
  - "plan 32-08's listening check for the 伴奏 reading (the .ogg/iOS half is already sufficient)"
  - "the shared api-base circuit breaker now also sees tang failures (accepted, 32-D-12)"
tech-stack:
  added: []
  patterns:
    - "one transform at the single return boundary instead of at seven rung returns"
    - "never-throw internal helper under an unchanged public throw contract (joox self-heal shape)"
    - "client builds the upstream url via the PROXY adapter's buildUrl so the host is defined once"
key-files:
  created: []
  modified:
    - src/lib/sources/__fixtures__/qq.detail.json
    - src/lib/sources/qq.ts
    - src/lib/sources/qq.test.ts
decisions:
  - "32-D-05: the https upgrade wraps the ONE return of pickBestPlayUrl (pickTier holds the ladder), so no future rung can be added past the guard"
  - "32-D-18: accom is ranked last among the named tiers and re-labelled low/ACCOM — it was presented as an HQ quality tier while being a different MIX in a container iOS cannot decode"
  - "32-D-19: inferQualityFromUrl became an `else` branch, not an overwrite; the shared helper itself is untouched because other sources depend on its guess"
  - "32-D-12: the direct/proxy split lives in one never-throw helper (tryQqDetail) so the public resolve keeps its byte-identical throw contract"
  - "a caller-abort still rejects as AbortError rather than falling out as 'invalid response' — a superseded resolve must not look like a dead source to the never-stop ladder"
  - "the accom fixture rung landed in task 2 (with its demotion) rather than task 1, because adding it in task 1 would have broken the existing hq-fallthrough test at that commit"
metrics:
  duration: ~11 min
  completed: 2026-08-31
requirements: [D-01, D-04, D-05, D-09, D-12, D-13, D-14, D-18, D-19]
---

# Phase 32 Plan 05: The QQ resolve hot path Summary

A qq resolve is now one direct simple-request GET to `tang.api.s01s.cn` with `mid` alone —
proxy hop gone, `msg` gone, `/api/qq/detail` retained as a one-shot fallback — and the ladder it
feeds returns https-only urls, ranks the 伴奏 rung below every real-song tier, and reports the tier
it actually picked instead of letting a file-extension sniff relabel everything `320K`.

## What Was Built

**The fixture became the real upstream** (`__fixtures__/qq.detail.json`). Every `song_play_url_*` is
now `http://isure6.stream.qqmusic.qq.com/...` instead of the invented `https://dl.stream…`, with the
live-probe kbps values (`sq 1647`, `pq 926`, `accom 689`, `hq 193`, `standard 97`, `fq 48`) and the
`song_size_*_str` byte counts. This is VALIDATION gate #1: while the fixture was already https, an
https-upgrade assertion passed *without the upgrade existing*. It now cannot.

**`pickBestPlayUrl` split into a boundary + a ladder.** `pickTier` holds the (reordered) if-chain and
returns the raw upstream url; `pickBestPlayUrl` is the single return through which every rung is
https-upgraded. One call site, not seven chances to miss one — the same placement logic `blob-store`
records for `MIN_BLOB_BYTES`.

**The 32-01 debt closed.** `pickTier` opens with
`const pref = effectiveQuality(quality ?? settings.defaultQuality)`. Before this commit, with the
project default already flipped to `'auto'` by 32-01, qq fell straight through both promotions into
the lossless-first ladder **on cellular** — the live regression gate #2 exists to prevent. The
cellular case now reuses the existing WR-03 `'320'`→hq promotion with zero new branches.

**`accom` demoted and re-labelled.** It moved from above `hq` (inherited verbatim from
`upstream/main:index.html:2373`) to last among the named tiers, and its tag/label changed from
`hq`/`HQ` to `low`/`ACCOM` so the pill never claims a quality tier for what is a different mix. The
`.ogg`/iOS-Safari half of the justification is confirmed and sufficient on its own; the 伴奏 reading
is recorded in the comment as a strong inference with the 32-08 listening check named.

**`inferQualityFromUrl` no longer clobbers a known tier.** It was an unconditional second write over
`best.tag`; it is now the `else` of it. The shared helper is untouched (other sources depend on its
guess) — only the call is gated, per the research's ponytail note.

**Detail resolve rebuilt** into `fetchQqDetail` (direct → one proxy fallback) over `tryQqDetail` (one
never-throw attempt). The direct url is built by `qqProxy.buildUrl('detail', …)` so the tang host
stays defined in exactly one file. Both hops go through `apiFetch`, so the governor's dedupe, cap-8,
25s timeout and circuit breaker cover the new host; the accepted consequence — tang failures counting
toward the ONE shared breaker — is written into the doc-block with an explicit "do NOT add a second
per-host breaker, that composition is the api-fetch-flood-freeze root cause" and a note aimed at the
future debugger who sees covers stop loading during a tang outage. The init stays `{ signal }`: the
comment names both traps (a custom header both triggers and fails tang's `Content-Type`-only
preflight; `credentials:'include'` hard-fails against `ACAO: *`, and tang's `Set-Cookie` is what
invites that "fix").

`msg` is gone from the detail call, and the `legacy:2312-2315` ref it came from was **replaced** by a
32-D-09 ref recording the reversal and its verification, not deleted. The search path keeps `msg`;
`track.qqSearchKey` is still written at search time.

## Verification Evidence

Every command below was run and its real output observed.

| Gate | Command | Observed |
|---|---|---|
| Baseline | `pnpm vitest --run src/lib/sources/qq.test.ts` | 13 passed |
| Task 1 | same, fixture flipped, tests unmodified | 13 passed |
| RED (task 2) | same, new tests before the adapter change | **6 failed / 11 passed** — https, accom, tag-clobber and `'auto'` cases all failing |
| GREEN (task 2) | same | 17 passed |
| RED (task 3) | same, direct-call tests added | **2 failed / 18 passed** — the proxy-prefix assertion and the fallback-order case |
| GREEN (task 3) | same | 20 passed |
| Full suite | `pnpm test` | **100 files / 1879 tests passed, 0 failed** |
| Typecheck | `pnpm check` | **4404 files, 0 ERRORS 0 WARNINGS** |

The stated post-32-04 baseline was 95 files / 1764; the tree is at 100/1879 because 32-02/32-04 landed
their own tests in between. No pre-existing failures were seen at any point.

Acceptance greps, all observed:
- `grep -n "msg=" src/lib/sources/qq.ts` → **one line, the SEARCH path** (`:258`)
- `grep -n "if (!d || typeof d !== 'object' || !d.song_mid)"` → present byte-identical (`:339`)
- `grep -c "32-D-05\|32-D-18\|32-D-19" src/lib/sources/qq.ts` → `5` (≥3 required)
- `grep -n "effectiveQuality" src/lib/sources/qq.ts` → the import + the single call site
- fixture: 6 `http://isure6…` urls at the task-1 commit (7 with accom), `0` https `song_play_url_*`

### Live upstream probe (optional gate, run anyway)

`GET https://tang.api.s01s.cn/music_open_api.php?type=json&mid=0039MnYb0qxYhV` — **200 in 2.005s**,
no `msg` param. Independently confirms three of this plan's premises against the live upstream, not
just against the fixture:

- **32-D-09** — `mid` alone returns `song_mid`, `song_title` 晴天, and the complete six-rung ladder.
- **32-D-05** — every returned url is `http://isure6.stream.qqmusic.qq.com/…` (with a `?vkey=…`
  signed query), i.e. mixed-content-blocked on our origin exactly as the decision says.
- **32-D-04 / 32-D-18** — `kbps_sq 1647`, `kbps_pq 926`, `kbps_accom 689` on an `O801….ogg`,
  `kbps_hq 193`, `kbps_standard 97`, `kbps_fq 48`. The measured numbers the comments now state.

What this probe did NOT verify: that a browser's CORS layer accepts the call from our origin
(`curl` does not enforce CORS), and that the https variant of the returned url serves bytes. Both
were verified in research; neither is re-proven here.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] The accom fixture rung moved from task 1 to task 2**
- **Found during:** Task 1
- **Issue:** Task 1 asked for `song_play_url_accom` in the fixture *and* for `qq.test.ts` to still
  pass unmodified at that commit. Those are mutually exclusive: with accom present and still ranked
  above `hq`, the existing `falls through to hq when sq and pq are absent` case returns the accom url
  and fails. Task 1's `<files>` is the fixture alone, so the test could not be adjusted there either.
- **Fix:** Task 1 flipped the scheme, filenames, kbps and sizes and added the real `song_play_url_fq`
  rung (which keeps the `≥6 isure6 urls` criterion satisfied without disturbing the ladder, since fq
  already sits below hq). `song_play_url_accom` + `kbps_accom` landed in task 2's commit, alongside
  the demotion that makes them safe. Gate #1 is unaffected — the fixture was http *before* the D-05
  upgrade existed, which is the whole point of the gate.
- **Files modified:** `src/lib/sources/__fixtures__/qq.detail.json`
- **Commits:** `9699b09`, `849b461`

**2. [Rule 1 - Bug] A superseded resolve would have stopped rejecting as an AbortError**
- **Found during:** Task 3
- **Issue:** With `tryQqDetail` mapping every rejection to `null`, an aborted (superseded) resolve
  would have fallen out of `fetchQqDetail` as `null` and been re-thrown by the public boundary as
  `qq detail error (invalid response)`. Today an abort propagates as an `AbortError`. The never-stop
  ladder treats a resolve failure as a dead source, so a healthy cancel would have burned a
  cross-source fallback cycle and could have skipped past a perfectly good track.
- **Fix:** `fetchQqDetail` does not spend the fallback hop when `signal.aborted`, and `resolve`
  re-throws a `DOMException('Aborted','AbortError')` when the helper returned `null` on an aborted
  signal. Two lines, commented.
- **Files modified:** `src/lib/sources/qq.ts`
- **Commit:** `97e4504`

**3. [Rule 2 - Correctness] `mid` is encoded by `URLSearchParams` on the direct path, not by hand**
- **Found during:** Task 3
- **Issue:** The plan (and T-32-15) asks for `encodeURIComponent(mid)` on both paths. On the direct
  path the url is built by `qqProxy.buildUrl` → `URL.searchParams.set`, which already percent-encodes;
  passing a pre-encoded value there would double-encode and produce a wrong `mid`.
- **Fix:** The proxy-fallback path keeps `encodeURIComponent(mid)` verbatim; the direct path relies on
  `URLSearchParams`, with a comment stating that this is the same T-32-15 guarantee without the
  double-encoding risk. The mitigation holds on both paths; only the mechanism differs on one.
- **Files modified:** `src/lib/sources/qq.ts`
- **Commit:** `97e4504`

### Criterion read, not met literally

`grep -c "~320k" src/lib/sources/qq.ts` returns **2**, not 0. Both occurrences are inside 32-D-04
corrections that quote the wrong claim in order to name it (`…NOT the "~320k" this comment used to
claim`). There is no live `~320k` claim left in the file. This is the same shape 32-01 hit with its
surviving `128–160k` strings, and its acceptance criterion explicitly allowed quoted supersession
notes; recorded here rather than silently reworded, since the grep is mechanical and a later verifier
will run it.

## Assumption Drift (advisory)

**The fixture's per-tier filename prefixes are not the live ones**
- **Found during:** the post-implementation live probe
- **Planned:** task 1 specified `hq M800….m4a`, `standard M500….m4a`, bare `C400….m4a`.
- **Actual:** live tang returns `hq C600….m4a`, `standard C400….m4a`, `fq C200….m4a`,
  `pq Q000….flac` — and `song_play_url_hq` is **byte-identical to the bare `song_play_url`**.
- **Why:** the fixture keeps the plan's distinct-per-tier names deliberately, because a test that
  cannot tell the hq rung from the bare fallback cannot pin the ladder. Only the scheme and the tier
  structure are load-bearing here, and both match reality. Flagged so nobody reads the fixture as a
  byte-accurate capture.

**Signed `?vkey=…` query strings on every returned url**
- **Found during:** the live probe
- **Planned:** the plan and fixture treat the tier urls as plain paths.
- **Actual:** every live url carries `?guid=&vkey=&uin=&fromtag=&trace=`.
- **Why:** harmless for everything this plan does (`^http://` replacement is query-agnostic, and the
  extension sniff is now gated off the qq path entirely), but it is the concrete reason 32-D-20 calls
  the cached `url` layer short-TTL while the `mid` is permanent. Relevant to plan 32-09, not here.

## Known Stubs

None. No placeholder values and no unwired paths — every changed branch is exercised by a test.

## Threat Flags

None beyond the plan's register. The one new surface (the direct tang hop) is T-32-11/12/13/14/15,
all dispositioned in the plan: IP exposure accepted (32-D-14, commented), plaintext audio mitigated by
the single-boundary https upgrade, `credentials` never set (commented + asserted by the
no-credentials test), shared-breaker DoS accepted and commented, and `mid` encoded on both paths.
Zero packages installed.

## Self-Check: PASSED

- `src/lib/sources/qq.ts` — FOUND
- `src/lib/sources/qq.test.ts` — FOUND
- `src/lib/sources/__fixtures__/qq.detail.json` — FOUND
- `.planning/phases/32-…/32-05-SUMMARY.md` — FOUND
- Commits `9699b09`, `849b461`, `97e4504` — all FOUND in `git log`
- `git diff --diff-filter=D` on all three commits — **no file deletions**
- Pre-existing dirty files (`.gitignore`, `CLAUDE.md`, `HANDOFF.json`, `docs/agents/`, the 31-phase
  `.gitkeep`) — absent from all three commits; `git status --short` inspected before every `git add`,
  and every path was staged explicitly
