---
spike: 006
name: ytmusic-playable-stream
type: standard
validates: "Given a videoId, when the player endpoint is queried + the audio stream URL extracted, then the URL plays in a plain <audio> AND stays playable (no cipher-solve, no throttle, no mid-stream 403)"
verdict: VALIDATED
related: [005-ytmusic-innertube-search, 008-ytmusic-account-library]
tags: [ytmusic, stream, cipher, potoken, the-wall]
---

# Spike 006: YouTube Music Playable Stream — THE WALL

## What This Validates
Given a `videoId` (from 005), when we query the InnerTube `player` endpoint from the edge and
extract an audio stream URL, then that URL must actually serve playable audio bytes into a plain
HTML `<audio>` element — without solving a JS signature cipher, without the `n` throttle crippling
throughput, and without a login/PoToken gate. This is the make-or-break pillar: if it fails, a
first-class YTMusic *playback* source is off the table.

## Research
- YouTube tightened extraction hard in 2024–2025: the `WEB`/`WEB_REMIX` clients now gate formats
  behind a **PoToken** (BotGuard attestation) + `visitorData`; the plain `ANDROID` client returns
  `LOGIN_REQUIRED`. yt-dlp / NewPipeExtractor migrated to alternate client contexts.
- The InnerTune-lineage Android apps (Metrolist / OuterTune / ArchiveTune) historically relied on
  the `ANDROID_MUSIC` client + NewPipeExtractor and run on the **user's phone (residential IP) with
  the user's cookies** — a very different trust position from a shared datacenter edge.

## How to Run
```
node .planning/spikes/006-ytmusic-playable-stream/player-harness.mjs   # client matrix (the failures)
node .planning/spikes/006-ytmusic-playable-stream/stream-harness.mjs   # ANDROID_VR+vd deep probe (the win)
```

## Investigation Trail
1. **Client matrix, no visitorData → total wall.** ANDROID_MUSIC=`LOGIN_REQUIRED`,
   ANDROID_VR=`LOGIN_REQUIRED (Sign in to confirm you're not a bot)`, IOS=400,
   TVHTML5_EMBED=`ERROR (no longer supported)`, WEB_REMIX=`UNPLAYABLE`. Zero audio formats anywhere.
2. **Egress IP check.** Sandbox egresses `154.47.23.70` = **Datacamp Ltd, a datacenter**. The "confirm
   you're not a bot" message is IP-reputation driven — datacenter IPs get challenged. **Cloudflare
   Workers also egress from datacenter IPs**, so this is the edge's real trust position, not a sandbox
   artifact. Good that the wall showed up here.
3. **visitorData unlock.** Grabbed a real `visitorData` from a WEB_REMIX search response and attached
   it to the `ANDROID_VR` client context → **`playabilityStatus: OK`, 4 audio formats**, from the same
   datacenter IP. visitorData (a stable "visitor session" token) is what clears the bot gate for
   ANDROID_VR; no Google account, no PoToken, no cookie needed.
4. **Format + byte probe.** All 4 audio formats are **direct `url` (no `signatureCipher`), no `n`
   param**. Ranged GET → **HTTP 206, `Accept-Ranges: bytes`, ~11–26 Mbit/s** (full speed, no throttle).
5. **Generality.** Re-ran for 3 videos incl. CJK (Jay Chou 稻香): all `play=OK`, all expose itag 140,
   all serve 206. `expiresInSeconds ≈ 21540` (~6 h).
6. **IP-lock.** The stream URL bakes in `ip=154.47.23.70` (the requester's IP) + `expire=`. googlevideo
   signs these URLs per-IP (well-documented; confirmed by the `ip=` param matching our egress).

## Results
**VERDICT: VALIDATED ✓ — with a mandatory proxy architecture and a durability caveat.**

**What works (evidence):**
- **Client:** `ANDROID_VR` (clientVersion `1.60.19`) + a `visitorData` token in the client context →
  `playabilityStatus: OK`. No account, no PoToken, no cookie.
- **No cipher.** Formats carry a direct `url`. **We avoid the entire base.js signature-solving problem**
  that makes WEB extraction miserable. This is the single most important finding.
- **No throttle.** No `n` param; ranged fetch runs at full line speed with `206` + range support →
  `<audio>` seeking works.
- **Codec for mobile:** **itag 140 = AAC-LC in mp4, 128 kbps, 44.1 kHz** → plays natively in iOS Safari
  `<audio>` (Opus/webm itag 251 does NOT play in Safari — pick 140 for the PWA; 251 optional for Android).

**The architecture constraint (IP-lock) — decides the build:**
- Stream URLs are signed for the **requester's IP**. If we set `<audio>.src` directly to the
  googlevideo URL, the fetch originates from the **user's browser IP**, which ≠ the edge IP that
  signed it → expect **403**. Therefore streaming MUST be **proxied through the edge**:
  `/api/ytmusic/stream/{videoId}` → the Worker calls `player` (URL signed for the Worker's IP) → the
  Worker fetches googlevideo and **streams the body back** to the browser. This is **exactly the
  existing `audius` pattern** (`/api/audius/stream/{id}` → proxy follows redirect → streams body),
  which already runs in production — so the pattern is proven; only the "call player first" step is new.
- Consequence: `resolve()` cannot cache the URL long (≈6 h expiry) and `<audio>.src` becomes an
  own-origin `/api/ytmusic/stream/{videoId}` path (also keeps it CORS/Capacitor-safe, like audius/netease).

**Open questions for the build (not blockers, but must-verify):**
- **Edge same-IP within one request:** the `player` subrequest and the googlevideo subrequest must
  egress the same Cloudflare IP (or an IP googlevideo accepts). Do BOTH inside one Worker invocation
  and verify on a *deployed* worker (can't prove Cloudflare egress behavior from this node sandbox).
  If a colo splits egress IPs across subrequests, fallback: fetch a small validating range in the same
  invocation before handing off, or pin via a single fetch pipeline.
- **Bot durability at scale:** one datacenter IP (a Cloudflare colo) issuing many `player` calls may
  get rate-limited / re-challenged harder than a single residential phone. Cache + rotate `visitorData`;
  measure challenge rate under load. **This whole path is adversarial and WILL break periodically** —
  YouTube actively fights extractors (CLAUDE.md "upstream can change without notice" applies hardest
  here). Treat as ongoing maintenance cost, not a one-time build.
- **Bandwidth/cost:** proxying audio bytes through Workers consumes egress + CPU time. Fine for the
  free tier at low volume; quantify against Cloudflare limits before wide rollout.
- **Legal/ToS:** serving extracted YouTube audio violates YouTube ToS. Same risk class as the CN
  Meting proxies already shipped, but higher-profile. Flagged for a human decision, not assumed.

**Signal for the build:** playback IS feasible from the Cloudflare edge — `ANDROID_VR + visitorData`,
itag 140, proxied byte-stream (audius pattern). No cipher engine, no PoToken generator. The cost is
**operational fragility**, not implementation complexity.
