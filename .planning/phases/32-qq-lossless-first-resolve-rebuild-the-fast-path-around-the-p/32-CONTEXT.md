# Phase 32: QQ-lossless-first resolve — rebuild the fast path around the permanent `song_mid` - Context

**Gathered:** 2026-08-31
**Status:** Ready for planning

<domain>
## Phase Boundary

How a tap becomes audio: which quality tier is served, which network hop the resolve takes, what is
cached and for how long, and what the next track costs. Two goals, both required — **play ASAP** and
**the next song advances successfully and seamlessly**.

NOT in scope: new sources, new surfaces, new UI, changing the search fan-out, or re-architecting the
post-resolve tail (measured and cleared — see D-16).
</domain>

<decisions>
## Implementation Decisions

### Resolve source and quality tier
- **D-01:** QQ (the `tang.api.s01s.cn/music_open_api.php` endpoint behind `sources/qq.ts`) becomes the
  PRIMARY resolve for playback. The existing kuwo/netease/joox cross-source ladder stays intact as the
  FAILURE path — a tang outage must degrade quality, never break playback.
- **D-02:** `PLAYBACK_DEFAULTS.defaultQuality` changes from `'128'` to `'auto'`. `'auto'` gains a real
  meaning for the first time: **lossless on wifi, `'320'` on cellular.** The rung already exists in the
  `DefaultQuality` union (`settings.svelte.ts:50`) and is already persisted — today it means nothing
  (`joox.ts:145` treats it identically to `'lossless'`; QQ's ladder just falls through).
- **D-03:** **With no connection signal, `'auto'` resolves to `'320'`.** iOS Safari ships no Network
  Information API, so `navigator.connection` is `undefined` there and every iPhone gets 320 under the
  default setting. This is a DELIBERATE, accepted consequence, chosen with the tradeoff on the table:
  iOS — the platform `CLAUDE.md` names first — does NOT get lossless by default. Android Chrome and
  users who pick `'lossless'` by hand do. **Do not "fix" this as a bug**; a verifier finding it should
  read this decision and stop.
- **D-04:** Correct the stale claim while changing the default: `defaults.ts:82` says
  `'128' // D-03 — 128–160k band`, but `'128'` selects `song_play_url_standard`, measured at
  **98 kbps**. Fix the comment; do not silently leave a wrong decision record in place.
- **D-05:** Upgrade returned QQ audio URLs `http:` → `https:`. The upstream returns
  `http://isure6.stream.qqmusic.qq.com/...`, which is mixed-content-blocked on our https origin; the
  same host serves https correctly (verified: `206`, `audio/x-flac`, first bytes in 0.31s).

### First play and mid acquisition
- **D-06:** **Never block the first note.** If the tapped track has no QQ `song_mid`, play whatever URL
  is already resolvable IMMEDIATELY and resolve the QQ mid in the background.
- **D-07:** **Never swap `audio.src` mid-song for a quality upgrade.** The background mid resolve writes
  to cache only; lossless applies from the NEXT play of that song. No swap machinery, no audible seam,
  no extra `driveSrc` re-drive. (Context: one deliberate swap would not trip the brake —
  `SRC_REDRIVE_CAP=4` in `SRC_REDRIVE_WINDOW_MS=1500` — but the seam was judged not worth the code.)
- **D-08:** Promote `qq` to the top of dedupe's `SOURCE_RANK` (`dedupe.ts:25`, currently
  `netease: 4, qq: 3`). netease winning the tie is WHY mid-less stubs are the common case rather than
  the rare one. With qq winning, the surviving deduped row already carries `song_mid`, so most FIRST
  plays are lossless with no wait and D-06/D-07 become the uncommon path. Accepted side effect: qq's
  title/album metadata wins where the two sources disagree. Cross-reference: the roadmap's pending
  "netease upstream health-gate" item already suspects that rank-4.
- **D-09:** Strip the `msg`/`qqSearchKey`/`keyword` threading from the QQ DETAIL call. Verified: the
  endpoint **ignores `msg`** — `mid` alone returns the full ladder, and a deliberately WRONG `msg` with
  the right `mid` still returns the correct song. QQ resolve is exactly ONE call given a mid.

### Cache shape
- **D-10:** Cache **`matchKey → song_mid`** edge-side, shared across all users per Phase 31 D-10.
- **D-10a (AMENDED 2026-08-31, post-research — supersedes D-10's "no TTL, no bust"):** permanence is a
  property of the **payload**, not the entry.
  - **Positive** entry (`songid` present) → `Cache-Control: public, max-age=31536000` — permanent, which
    is what D-10 was reaching for.
  - **Negative / `DRY`** entry → **keep the existing `RESOLVE_TTL_S = 900`.**
  - **KEEP the POST bust handler.** Do NOT delete it.

  **Why D-10 as originally written was unsafe:** it was decided on the premise that `song_mid` never
  expires. True for a positive entry, false for a negative one — and Phase 31 writes negatives
  deliberately (`resolve-cache.ts:89-100`). `Skill("spike-findings-openmusic")` records from a 38-song
  spike that **qq search returns 0 rows intermittently under load, with no throw** — a flaky empty body
  is byte-indistinguishable from "this song genuinely has no QQ version", which `resolve-edge.ts`
  classifies as `DRY` and caches. Under 900s a false negative self-heals in 15 minutes; under "no TTL,
  no bust" it pins that song to a lossy source **for every user in the PoP, permanently and
  unrepairably** — the precise inverse of the phase goal, silently. The bust handler is also the only
  repair path for a `matchKey` collision, and D-11 explicitly requires that repairs be possible
  (there is deliberately no client write path — `resolve-edge.ts:9`).
- **D-10b (research finding, 2026-08-31):** **D-10 saves a CALL, not the round trip — D-08 is the
  latency lever.** A mid is not playable; resolving it still costs a tang RTT. Measured: a Phase-31 url
  cache HIT was 0.44s to a playable URL, whereas a mid HIT is 0.4s **plus 2.0–3.8s serially**. The
  ROADMAP's "tap→audio in under a second" is therefore NOT reachable via D-10; it is reachable via D-08,
  because a QQ-sourced deduped row already carries `song_mid` in the search body and needs no lookup at
  all. Plan and verify accordingly: D-08 owns the latency goal, D-10/D-10a own the call-count goal.
  Corollary flagged by research: `catalog.ts:323-326` reads the cache unconditionally at up to 400ms,
  which post-D-08 is pure waste on the common path — one guard clause there is the single largest
  remaining win.
- **D-11:** Phase 31 D-08 / D-09 / D-11 carry forward unchanged: the cache is **advisory, never
  authoritative**. A miss or a stale hit falls through to the client resolver silently and repairs the
  entry. The failure path remains load-bearing, not an edge case.

### Hop routing
- **D-12:** **Split by what each call needs.** The `matchKey → song_mid` lookup stays on `/api` (it is
  cacheable forever and shared, so the hop pays for itself). The hot audio-URL DETAIL call goes
  **direct to the upstream**, saving the measured ~1s. The proxy route is RETAINED as a fallback for the
  day the upstream drops its `access-control-allow-origin: *`.
- **D-13:** Direct calls go through **`apiFetch`, not raw `fetch`** — the governor's dedupe,
  `MAX_CONCURRENT_REQUESTS`, timeout and circuit breaker are URL-agnostic, so none of the
  `api-fetch-flood-freeze` protections are lost by going direct. `apiUrl` (`api-base.ts:26`) is a bare
  `BASE + path` concat, so it needs an "already absolute" guard for the NATIVE build where
  `VITE_API_BASE` is set. Media bytes keep using raw `fetch` as they do today.
- **D-14:** IP exposure was weighed and accepted: `<audio src>` already points straight at
  `isure6.stream.qqmusic.qq.com`, so Tencent's CDN already sees every listener's real IP on every play.
  A direct metadata call adds a hostname, not a new category of exposure.

### Next-track cost
- **D-15:** `prebufferNext` keeps running and **inherits whatever tier `'auto'` picked** — so cellular
  is already ~10MB rather than ~50MB. Add ONE guard: check `Content-Length` and skip the blob (stream
  instead) above a ceiling, so a low-end phone never holds a huge Blob per advance. This preserves the
  `bg-lockscreen-stall-noskip` fix wherever it is affordable. That prebuffer is a STABILITY mechanism,
  not a gapless nicety — dropping it for FLAC would trade the "next song plays" goal for the "plays
  fast" goal.
- **D-16:** **Do NOT re-architect the post-resolve tail.** Measured and cleared:
  `player.svelte.ts:2892-3033` already sets `audio.src` + `play()` immediately after the resolve, with
  only synchronous localStorage/MediaSession work between; covers, lyrics, prefetch and `ensureAhead`
  all run AFTER playback starts. "Play the instant it resolves, parallelize the rest" is already the
  implemented behavior. The spinner is `ensureTrackDetails` and nothing else.
- **D-17:** Phase 31 D-19 carries forward: lookahead stays **next-1 only**. Do not deepen the walk.

### Folded pre-existing bugs (added 2026-08-31 after research; user approved the scope)

Both live inside functions this phase already edits, both inherited verbatim from
`upstream/main:index.html`, and both actively corrupt what this phase promises.

- **D-18:** **Demote the `accom` rung below `hq` in the QQ ladder.** `pickBestPlayUrl` currently ranks
  `song_play_url_accom` ABOVE `song_play_url_hq` (`qq.ts`, inherited from `index.html:2373`). `accom` is
  **伴奏 — the accompaniment / instrumental track**, so a lossless-first resolve can hand back a karaoke
  version instead of the song. It also serves `.ogg`, which **iOS Safari does not decode** — that half is
  confirmed and is sufficient justification on its own; the 伴奏 reading is a strong inference flagged
  `checkpoint:human-verify`. One-line change.
- **D-19:** **Stop `inferQualityFromUrl` overwriting the QQ tier.** It relabels every non-FLAC QQ URL as
  `320K`, including the measured **97 kbps** standard tier and the **48 kbps** fq tier, so the quality
  pill reports a tier the user is not receiving. Measured: `'320'` selects `song_play_url_hq` at **193
  kbps on 3/3 tracks**, not 320. The adapter already knows the true tier from which ladder rung it
  picked — that value must win over the URL sniff.

### Folded Todos
- `.planning/todos/pending/edge-resolve-cache-returns-miss.md` — `/api/resolve` returned
  `{"hit":false}` for `周杰伦 / 稻香`. Folded because D-10 replaces that entry's shape anyway; confirm
  whether the Phase-31 mechanism ever filled before assuming it as a baseline. Rule out PoP locality
  first (same device, same network) — that is the likeliest benign explanation.

### Claude's Discretion
- The exact `Content-Length` ceiling value for D-15.
- The wifi-vs-cellular detection shape for D-02/D-03 (`navigator.connection.type` /
  `effectiveType` / `saveData`), and where it lives — no connection-awareness code exists anywhere in
  `src/` today, so this is net-new.
- Where the D-05 https upgrade belongs (client adapter vs proxy adapter).
- Cache-key normalization for D-10 — `matchKey` already exists (`services/match-key.ts`) and is what
  Phase 31's entry keyed on; reuse it unless there is a reason not to.
- Whether a tier downgrade under `'auto'` is surfaced to the user at all, and if so how.
- The new numeric value for qq in `SOURCE_RANK` (D-08).
</decisions>

<specifics>
## Specific Ideas

- User's framing of the goal, verbatim: *"the goal is play music asap with stability to play next song
  successfully and seamlessly"* — both halves are requirements, and D-15 is where they pull against
  each other.
- On the resolve tail: *"as soon the song resolve, it have to be played asap, parallel all other stuff
  which can be started after music playing"* — which is what D-16 records as ALREADY TRUE. The
  observed delay is entirely pre-resolve.
- The reference implementation is our own upstream: `CharlesPikachu/musicsquare` (the `upstream` git
  remote), still a single `index.html`. Its `fetchQQDetails` / `pickBestPlayUrl` are the direct
  ancestors of `sources/qq.ts`. It is faster because it makes ONE direct call, not because it is
  architecturally better — and it is lossless because it has no `defaultQuality` pref to short-circuit
  the ladder.
</specifics>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### This phase's measurements and decision record
- `.planning/notes/qq-lossless-first-resolve.md` — the full measurement table (every hop timed), the
  five findings, and the open risks. **Read this first**; every decision above traces to it.
- `.planning/ROADMAP.md` § "Phase 32" — scope bullets, including the explicit anti-scope bullet.

### Carried-forward locked decisions
- `.planning/phases/31-faster-smoother-playback-cut-click-to-play-latency-and-stop-/31-CONTEXT.md` —
  Phase 31's D-01..D-19. Specifically binding here: **D-02** (no hedged/parallel source racing),
  **D-04** (never gate the now-playing swap on the `playing` event — tried, froze mobile, reverted),
  **D-05** (call-count floor is a waste target, not a cap), **D-08/D-09/D-11** (cache advisory,
  failure path load-bearing), **D-19** (lookahead next-1 only).
- `.planning/phases/31-faster-smoother-playback-cut-click-to-play-latency-and-stop-/31-VALIDATION.md` —
  what Phase 31 actually verified, so D-15 changes can be checked against the same freeze classes.

### Open risk tracked outside this phase
- `.planning/research/questions.md` § Q1 — second lossless provider. Phase 32 ships on tang ALONE by
  decision; the redundancy hunt is a separate spike. Do not fold it in.

### Folded todo
- `.planning/todos/pending/edge-resolve-cache-returns-miss.md` — folded into scope, see D-10.

### Project constraints
- `CLAUDE.md` — stack, conventions (runes, tabs, i18n double quotes, comment tagging), and the
  "Mobile browsers first (iOS Safari + Android Chrome)" constraint that D-03 knowingly trades against.
- `Skill("spike-findings-openmusic")` — kuwo-first resolution, `track.getSimilar` up-next, and the
  API-call-reduction patterns this phase partially supersedes. Read before changing resolve order so
  the supersession is deliberate rather than accidental.
</canonical_refs>

<code_context>
## Existing Code Insights

### Reusable Assets
- `sources/qq.ts` `pickBestPlayUrl` (line 98) — the full lossless ladder is ALREADY ported verbatim
  from the monolith. D-02 only changes which rung the pref selects; the ladder itself needs no work.
- `services/api-base.ts` `apiFetch` / `governedFetch` — dedupe + `MAX_CONCURRENT_REQUESTS=8` +
  25s timeout + circuit breaker (`CIRCUIT_FAILURE_THRESHOLD=30`). URL-agnostic, so it wraps direct
  cross-origin calls unchanged (D-13).
- `services/match-key.ts` `matchKey` — the normalization Phase 31's cache entry already keys on; D-10
  reuses it.
- `proxy/resolve-cache.ts` + `proxy/resolve-edge.ts` — the Phase-31 edge-cache machinery. D-10 changes
  what is STORED (permanent mid vs expiring URL), which should let the TTL/bust code shrink.
- `services/dedupe.ts` `SOURCE_RANK` (line 25) + `qualityRank` (line 28) — `qualityRank` already scores
  `flac|lossless|atmos|sq` highest, so it needs no change; only the source rank moves (D-08).
- `settings.svelte.ts:50` `DefaultQuality = 'auto' | 'lossless' | '320' | '128'` — the `'auto'` rung is
  already typed, already persisted, and currently inert.

### Established Patterns
- **Generation guards** (`playGen`, `queueGen`, `pendingGen`, `fallbackGen`) — every async resolve
  re-reads its counter after each await and bails when superseded. Any new background mid-resolve
  (D-06) must follow this, or must be explicitly fire-and-forget with no write-back to `current`.
- **Single `audio.src` authority** — `driveSrc()` is the ONE place src is set for playback, with the
  rapid-fire brake. D-07 avoids adding a second attach path entirely, which is why it was chosen.
- **Never-throw services** — data/enrichment services map any rejection to a null/empty sentinel at the
  exported boundary. A direct-fetch resolve must keep this contract.
- **`browser` guards** — anything touching `navigator`, `localStorage`, `window` early-returns under
  SSR. The D-02/D-03 connection detection needs one.

### Integration Points
- `sources/qq.ts` — quality pref selection (D-02/D-04), `msg` removal (D-09), https upgrade (D-05),
  direct-vs-proxy call routing (D-12).
- `config/defaults.ts:82` — the default change and the corrected comment (D-02/D-04).
- `services/api-base.ts` `apiUrl` — the "already absolute" guard for the native build (D-13).
- `services/dedupe.ts:25` — one line (D-08).
- `stores/player.svelte.ts` `prebufferNext` (line ~2583) — the Content-Length ceiling (D-15).
- `proxy/resolve-cache.ts` / `resolve-edge.ts` / `routes/api/resolve` — the entry-shape change (D-10).
</code_context>

<deferred>
## Deferred Ideas

- **Second lossless provider / tang redundancy** — tracked as Q1 in `.planning/research/questions.md`,
  to be handled as its own `/gsd:spike`. Explicitly NOT folded into this phase; Phase 32 ships on tang
  alone with the existing ladder as the safety net.
- **Mid-song quality hot-swap** — rejected by D-07, not merely postponed. If it is ever revisited it
  needs its own decision record, because it adds a second `audio.src` attach path.
- **A user-facing data-saver toggle** — considered for D-02 and not taken; `'auto'` plus the existing
  manual `'320'`/`'128'` pickers cover it without new settings or 16 dictionary updates.

### Reviewed Todos (not folded)
- `artist-page-hyphenated-lookup-key.md`, `og-artist-tier-picture-xl-oversize.md`,
  `pageog-hardcoded-site-origin.md`, `song-share-stale-cover-comment.md` — all four matched on keyword
  noise only (`api`, `src`, `svelte`, `never`). They are Phase-30 share-link / `/api/og` leftovers with
  no relationship to playback resolve. Left pending.
</deferred>

---

*Phase: 32-qq-lossless-first-resolve-rebuild-the-fast-path-around-the-p*
*Context gathered: 2026-08-31*
