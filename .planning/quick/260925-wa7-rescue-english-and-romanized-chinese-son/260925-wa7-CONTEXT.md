# Quick Task 260925-wa7: Rescue English / romanized names of Chinese songs in resolveStub - Context

**Gathered:** 2026-09-26
**Status:** Ready for planning
**Source:** user request + orchestrator's live probes on the dev proxies (no separate discuss step)

<domain>
## Task Boundary

Songs on shelves, radio, and search-row fallbacks can carry an English or pinyin name for a Chinese
song (Last.fm / Deezer / YouTube Charts / Apple US use label-provided English names): "Coral Sea — Jay
Chou" is 珊瑚海 — 周杰倫, "Zai Ai Ni — Eric Chou" is 再愛你 — 周興哲, "Graduation ("Mom, Don't Do That!" TV
Series Theme Song) — Eric Chou" is 最後一堂課 — 周興哲. The CN resolvers index the Chinese name, so these
resolve to the WRONG song. Fix it inside the shared name resolver `resolveStub`
(`src/lib/services/discovery.ts`), which ~15 call sites route through (playStub taps, radio, share pages,
long-press menus, album batch resolve, DownloadControl, cross-source fallback) — same insertion point and
reasoning as the existing t2s rescue-on-miss (quick-260808-urx).

User constraint: the extra lookup applies ONLY to songs that fail at first — a good first resolve must cost
zero extra calls.
</domain>

<decisions>
## Implementation Decisions

### The failure mode (measured 2026-09-26 on the live dev proxies)
- English queries do NOT miss. QQ returns 20 rows for "Jay Chou Coral Sea" — 珊瑚海(钢琴曲)/酷客音乐, a DJ
  remix, "Coral Sea/ooillk77"; Netease returns "Coral Sea (Chillout Mix)/Black Pearl". "Eric Chou Graduation"
  → "Graduation/NCT DREAM". "Eric Chou Zai Ai Ni" → 左转灯/汪苏泷, 怎么了/Eric周兴哲. `resolveStub` only gives
  up on ZERO results (D-03), so it plays the best of the junk.
- With Chinese names the CN sources are right first time: QQ "周杰伦 珊瑚海" → 珊瑚海/周杰伦; "周兴哲 再爱你" →
  再爱你/Eric周兴哲. (Traditional "周杰倫 珊瑚海" returned [] on QQ — the existing t2s retry covers that.)
- Kuwo was down (500 "Internal Error") during probing; QQ + Netease were up.

### Trigger (only on failure)
- Run the rescue ONLY when (a) artist AND title contain no CJK (reuse `isChineseLine` / the existing script
  classifier), AND (b) the existing attempt (+ existing t2s retry) produced no candidate OR a WEAK best
  candidate. Planner defines "weak" concretely from existing primitives (scoreMatch / matchKey) — e.g. the
  best candidate's normalized title does not contain / equal the query's normalized title, or the artist does
  not match. It must classify "Graduation/NCT DREAM" and "珊瑚海(钢琴曲)/酷客音乐" as weak for the queries
  above, and must NOT fire for a normal English hit like "someone like u / lullaboy" (Netease returned that
  exact row) or "Good In Me / Bones & The Boy".
- Pin the no-extra-calls guarantee with call-count tests (the t2s rescue already does this in
  discovery.test.ts — follow that pattern).

### Rescue: English → Chinese name lookup, two stages, first VERIFIED hit wins
**Stage 1 — YouTube Music via the existing EDGE ytmusic search proxy.** `src/lib/proxy/ytmusic-innertube.ts`
hardcodes `hl: 'en'`; add an allowlisted `hl` param (`en` | `zh-TW` only; `gl` follows: US / TW). Run the
songs-filtered search (existing params) for "artist title" with hl=en and hl=zh-TW in parallel; join rows by
videoId. Accept a row ONLY with English evidence: its hl=en title contains the normalized query title. YTM
labels often ship bilingual titles, verified live:
- "Eric Chou Zai Ai Ni": en `再愛你 - Zai Ai Ni` / Eric Chou ↔ zh-TW `再愛你` / 周興哲
- "Eric Chou Graduation": en `最後一堂課 (《媽，別鬧了！》影集片尾曲) - Graduation ("Mom, Don't Do That!" TV Series
  Theme Song)` / Eric Chou ↔ zh-TW `最後一堂課 (《媽，別鬧了！》影集片尾曲)` / 周興哲
- "Jay Chou Coral Sea": en `珊瑚海` / 周杰倫 (NO English in the title → stage 1 does not accept; stage 2 does)
- "Jay Chou Mojito": en `Mojito` / 周杰倫 ↔ zh-TW `Mojito` / 周杰倫 (accepted — title contains query title)
Take the zh-TW title + zh-TW artist.

**Stage 2 — iTunes cross-store, CLIENT-SIDE ONLY.** itunes.apple.com rate-limits the shared Cloudflare
Workers egress IP (spike 012: 403 on RSS, 429 on search from the edge) — never call it from the edge. It is
CORS `*`; `src/lib/services/itunes-cover.ts` is the client-side precedent; go through the `apiFetch`
governor. Search `country=hk` and `country=us` for "artist title" (entity=song, limit 3), union trackIds, look
up those ids in the other store (`/lookup?id=a,b,c&country=us|hk`), accept a pair only if the US trackName
(parenthetical / feat. stripped, normalized) matches the query title AND the US artistName matches the query
artist; take the HK trackName (strip ` - EP`, `(feat. …)`, parentheticals for the CN search) + HK artistName.
Verified live:
- HK search "Jay Chou Coral Sea" → id 1721454126 `珊瑚海 (feat. 梁心頤)` / 周杰倫; lookup US → `Coral Sea (feat.
  Lara Veronin)` / Jay Chou → ACCEPT → search "周杰倫 珊瑚海".
- US search "Eric Chou Graduation" → id 1634754406 `Graduation ("Mom, Don't Do That!" TV Series Theme Song)` /
  Eric Chou; lookup HK → `最後一堂課 (《媽,別鬧了!》影集片尾曲)` / 周興哲 → ACCEPT.
- US search "Joker Xue The Actor" → `Actor (Live)` → HK `演員(Live)` / 薛之謙.
- MUST REJECT: "Eric Chou Zai Ai Ni" → US top `Unbreakable Love` (HK 永不失聯的愛); "Jay Chou Mojito" → US top
  `屋頂` / Landy Wen & Jay Chou (title mismatch).

### After a verified lookup
- Re-run the existing `attempt()` (and the existing t2s retry — CN catalogs index Simplified) with the
  Chinese names. Use that result only if it matches the Chinese title (per the same weak/strong test);
  otherwise return today's result (best weak match or null). The rescue must never make a resolve worse.
- **Accepted deviation (orchestrator, 2026-09-26, plan-check iteration 1):** the re-search converts the
  Chinese names to Simplified FIRST and runs ONE `attempt()` (not attempt + t2s retry). Evidence: the probe
  above showed Traditional "周杰倫 珊瑚海" → [] on QQ while Simplified hit; this path is new, so the on-miss
  asymmetry argument in resolveStub's doc comment does not apply; one search instead of two. Candidates are
  folded to Simplified before the strong-match test so a Traditional row still matches. Not to be
  re-litigated at verification.

### Caching
- Cache rescue outcomes (hits AND misses, bounded TTL — e.g. hit 30 d, miss 1 d) per normalized
  `artist|title` in localStorage under a namespaced key (`openmusic:name-rescue:v1`), browser-guarded,
  try/catch, size-capped. A shelf re-tap or a replay costs zero lookups.

### Contracts to keep
- Never-throw at the `resolveStub` boundary (its single try/catch). AbortSignal + timeout on every lookup.
- playStub's supersedence contract: resolveStub is awaited once and playStub re-checks `pendingGen` after it
  — do NOT add a second generation guard inside resolveStub (see its doc comment).
- Pure parsing/matching (bilingual-title split, normalization + title/artist match, YTM en↔zh join, iTunes
  pairing, the weak-match predicate) in a pure node-testable module with fixture tests built from the real
  responses above. Edge helpers in `$lib/proxy/*` (a `+server.ts` may only export HTTP verbs).
- House style: decision-ref comments tagged `quick-260925-wa7`; Shared Primitives table in CLAUDE.md (import,
  never re-inline: `url-safety`, `abort-signal` `combinedSignal`, etc.); spike-findings skill landmines.

### Claude's Discretion
- Exact weak-match predicate and thresholds (must satisfy the examples above).
- Whether stage 1 and stage 2 run in parallel or sequentially (sequential is fine; stage 2 only when stage 1
  gives no verified hit).
- Whether to also expose the Chinese name to display surfaces — NOT required; the resolved CN Track already
  carries Chinese names.
</decisions>

<specifics>
## Specific Ideas

- YTM InnerTube search body: `{context:{client:{clientName:'WEB_REMIX',clientVersion:'1.20240101.01.00',
  hl,gl}},query,params:'EgWKAQIIAWoKEAkQBRAKEAMQBA=='}` + public WEB_REMIX key (already in the proxy). Row
  videoId at `playlistItemData.videoId`; title = flexColumns[0] runs; artist = flexColumns[1] runs[0].
- Test fixture pairs come straight from the probe outputs recorded above.
</specifics>

<canonical_refs>
## Canonical References

- `src/lib/services/discovery.ts` — resolveStub + attempt() + the t2s rescue precedent (doc comment explains
  why the fix belongs here and the supersedence contract)
- `src/lib/services/discovery.test.ts` — call-count assertions to extend
- `src/lib/services/score-match.ts`, `src/lib/services/match-key.ts` — normalization + scoring
- `src/lib/services/zh-convert.ts` — `isChineseLine`, `t2sConvertLines`
- `src/lib/proxy/ytmusic-innertube.ts`, `src/routes/api/ytmusic/search/+server.ts` — edge YTM search
- `src/lib/services/itunes-cover.ts` — client-side iTunes precedent; `src/lib/services/api-base.ts` (`apiFetch`)
- `.claude/skills/spike-findings-openmusic/references/home-charts.md` + `ytmusic-source.md` — landmines
</canonical_refs>
