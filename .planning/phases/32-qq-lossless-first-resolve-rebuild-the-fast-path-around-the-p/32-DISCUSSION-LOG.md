# Phase 32: QQ-lossless-first resolve — Discussion Log

> **Audit trail only.** Do not use as input to planning, research, or execution agents.
> Decisions are captured in 32-CONTEXT.md — this log preserves the alternatives considered.

**Date:** 2026-08-31
**Phase:** 32-qq-lossless-first-resolve-rebuild-the-fast-path-around-the-p
**Areas discussed:** First play (cross-source stub), Lossless on cellular, Next-track cost, Hop routing
**Mode:** discuss (default, interactive)

---

## First play, cross-source stub

### Q1 — When the tapped track has no QQ mid yet, what should the first play do?

| Option | Description | Selected |
|--------|-------------|----------|
| Promote qq in dedupe first | Make qq top `SOURCE_RANK` so the surviving row already carries `song_mid` | |
| Hot-swap: play lossy, upgrade after | Start on whatever resolves, fetch QQ lossless in parallel | ✓ |
| Always wait for the pair | Extra QQ search on first play; lossless from note one | |

**User's choice:** Hot-swap — play lossy, upgrade after.
**Notes:** Chose the latency-aggressive option, consistent with the stated goal ("play music asap").
Made the swap MECHANICS the risky part, which Q2 then constrained.

### Q2 — When the lossless URL lands mid-playback, when does the swap happen?

| Option | Description | Selected |
|--------|-------------|----------|
| Only if still early, else next play | Swap with `currentTime` preserved under a few seconds elapsed | |
| Swap whenever it arrives | Any point in the song, `currentTime` preserved | |
| Never swap mid-song | Cache the mid; lossless applies from the next play of that song | ✓ |

**User's choice:** Never swap mid-song.
**Notes:** Combined with Q1 this resolves to: never block the first note, resolve the mid in the
background, cache it, lossless from the next play. Zero swap machinery — no second `audio.src` attach
path, no seam. Brake context offered during the discussion: `SRC_REDRIVE_CAP=4` /
`SRC_REDRIVE_WINDOW_MS=1500` means one deliberate swap would NOT have tripped the brake, so this was a
seam-quality call rather than a freeze-risk call.

### Q3 — Promote qq above netease in dedupe's SOURCE_RANK as well?

| Option | Description | Selected |
|--------|-------------|----------|
| Yes, promote qq | Complement, not competitor — surviving row carries the mid so most FIRST plays are lossless | ✓ |
| No, leave netease at rank 4 | Mid-less stubs stay the common case | |
| You decide | Planner picks after reading dedupe.ts | |

**User's choice:** Yes, promote qq.
**Notes:** Scout finding that drove the question — `dedupe.ts:25` ranks `netease: 4, qq: 3`, so netease
wins the tie and the surviving row has no `song_mid`. That is the CAUSE of mid-less stubs being common.
With qq promoted, the Q1/Q2 lossy-first path becomes the uncommon case rather than the default one.
Accepted side effect: qq metadata wins ties. Cross-referenced against the roadmap's pending "netease
upstream health-gate" item, which already suspects that rank-4.

---

## Lossless on cellular

### Q4 — 933kbps FLAC is ~7MB/min. Should playback tier by connection?

| Option | Description | Selected |
|--------|-------------|----------|
| Always lossless, no tiering | Simplest; manual `320`/`128` pickers already exist | |
| Make 'auto' the new default | lossless on wifi, 320 on cellular | ✓ |
| Always lossless + data-saver toggle | Explicit switch, new setting + 16 dictionaries | |

**User's choice:** Make `'auto'` the new default.
**Notes:** Scout findings offered: `'auto'` is ALREADY in the `DefaultQuality` union and already
persisted but means nothing today (`joox.ts:145` treats it as lossless); and there is ZERO
connection-awareness code anywhere in `src/` (no `saveData`, `effectiveType`, or `navigator.connection`),
so tiering is net-new code rather than a flag flip.

### Q5 — Under 'auto', what does a device with no connection signal get (iOS Safari)?

| Option | Description | Selected |
|--------|-------------|----------|
| Unknown → lossless | Optimistic; iPhone gets the headline feature by default | |
| Unknown → 320 | Conservative on data; iOS never reports a connection so every iPhone gets 320 | ✓ |
| Unknown → lossless + manual override | New setting, new i18n keys | |

**User's choice:** Unknown → 320.
**Notes:** The consequence was stated in the option text before the choice and restated after: under the
default `'auto'`, **iOS Safari — the platform `CLAUDE.md` names first — does not get lossless.** Chosen
knowingly. Recorded as D-03 with an explicit "do not fix this as a bug" note so a later verifier or
auditor does not silently reverse it.

---

## Next-track cost (seamless)

### Q6 — How should the next-track blob prebuffer behave at lossless weight?

| Option | Description | Selected |
|--------|-------------|----------|
| Inherit tier + byte ceiling | Prebuffer inherits `'auto'`'s tier; skip the blob above a `Content-Length` ceiling | ✓ |
| Inherit tier, no ceiling | Change nothing; smallest diff, risks memory pressure on low-end Android | |
| Skip prebuffer when lossless | Lightest, but reintroduces the background/lock-screen stall | |

**User's choice:** Inherit tier + byte ceiling.
**Notes:** Key context surfaced from the code before the question — `prebufferNext`
(`player.svelte.ts:2570`) exists to fix `bg-lockscreen-stall-noskip`, i.e. it is a STABILITY mechanism
for the backgrounded src-swap, not a gapless nicety. Dropping it for FLAC would have traded the user's
own "next song plays successfully" goal for the "plays fast" goal. Weights given: ~28MB per 4-min FLAC
vs ~10MB at 320 vs ~3MB at today's 98k.

---

## Hop routing

### Q7 — Which calls go direct to the upstream, and which keep the proxy?

| Option | Description | Selected |
|--------|-------------|----------|
| Split: mid via proxy, detail direct | Permanent mid stays cacheable + shared; hot detail call saves ~1s | ✓ |
| Everything direct | Fastest, simplest client — abandons the shared cache, one CORS change breaks playback | |
| Keep everything proxied | One seam, upstreams see Cloudflare — gives up the measured ~1s | |

**User's choice:** Split — mid via proxy, detail direct.
**Notes:** Two scout findings reframed this before the question. (1) `apiUrl` is a bare `BASE + path`
concat (`api-base.ts:26`), so the governor is URL-agnostic and going direct does NOT forfeit the
`api-fetch-flood-freeze` protections — only the native build needs an "already absolute" guard.
(2) `<audio src>` already points straight at `isure6.stream.qqmusic.qq.com`, so Tencent's CDN already
sees every listener's real IP on every play — the IP-exposure objection to a direct metadata call is
much weaker than it first appears. Both are recorded as D-13 and D-14.

---

## Claude's Discretion

- Exact `Content-Length` ceiling value (D-15).
- Connection-detection shape and location for `'auto'` (D-02/D-03) — net-new, nothing exists in `src/`.
- Where the `http:`→`https:` upgrade lives: client adapter vs proxy adapter (D-05).
- Cache-key normalization for the permanent mid entry (D-10) — `matchKey` already exists.
- Whether an `'auto'` tier downgrade is surfaced to the user at all.
- The new numeric `SOURCE_RANK` value for qq (D-08).

## Deferred Ideas

- **Second lossless provider / tang redundancy** — Q1 in `.planning/research/questions.md`, its own
  spike. Decided in the prior `/gsd:explore` session, not re-litigated here.
- **Mid-song quality hot-swap** — REJECTED by D-07, not postponed. Revisiting it needs its own decision
  record because it adds a second `audio.src` attach path.
- **User-facing data-saver toggle** — considered at Q4, not taken.

## Todos Reviewed

- **Folded:** `edge-resolve-cache-returns-miss.md` (authored for this phase during the prior explore).
- **Not folded:** `artist-page-hyphenated-lookup-key.md`, `og-artist-tier-picture-xl-oversize.md`,
  `pageog-hardcoded-site-origin.md`, `song-share-stale-cover-comment.md` — all matched on keyword noise
  (`api`, `src`, `svelte`, `never`); Phase-30 share-link leftovers, unrelated to playback resolve.
  Decided without gating the user, per universal anti-pattern 15.
