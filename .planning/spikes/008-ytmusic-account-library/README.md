---
spike: 008
name: ytmusic-account-library
type: standard
validates: "Given a Google/YT auth (OAuth or cookie), when the user library is queried, then liked songs + recent history + a taste/genre signal are readable — ToS/legal risk flagged, not assumed"
verdict: PARTIAL
related: [005-ytmusic-innertube-search, 006-ytmusic-playable-stream]
tags: [ytmusic, auth, oauth, library, legal]
---

# Spike 008: YouTube Music Account Connection + Library Inheritance

## What This Validates
Whether OpenMusic (a web PWA on the Cloudflare edge, currently storing **zero** user credentials)
can connect a Google/YouTube account and inherit the user's YTMusic library — liked songs, recent
history, favourite genre — and at what mechanism, feasibility, and legal cost.

> **Safety note:** this spike did NOT complete any OAuth flow, authenticate any account, or fetch any
> user data. Granting OAuth/logging in is a user-only action. Findings are mechanism analysis +
> harmless endpoint reachability only.

## Research — how the reference apps authenticate
- **Metrolist / OuterTune / (Inner/Archive)Tune are native Android apps.** They log the user into
  YouTube in an **embedded WebView**, then read that WebView's **cookie jar** (`SAPISID`,
  `__Secure-3PAPISID`, …) and build a `SAPISIDHASH` authorization header (`sha1(ts + SAPISID + origin)`)
  sent with a `Cookie` header to InnerTube. OuterTune additionally offers a **Google OAuth device flow**
  using the YouTube-on-TV OAuth client, yielding `access_token`/`refresh_token` used as
  `Authorization: Bearer` against InnerTube.
- Library data lives behind InnerTube **browse** ids: `FEmusic_liked_playlists`, `FEmusic_history`,
  `VLLM` (Liked Music) — the same endpoints, but returned *personalized* once the request is authed.

## How to Run
Probes were run inline (no auth completed) and captured in `results.json` — the three checks:
device-flow reachability, unauthenticated library-browse gating, and Data-API history/genre absence.

## Investigation Trail
1. **Cookie/SAPISIDHASH path (native apps) — impossible for a web PWA.** A browser cannot read another
   origin's (`google.com`) cookies; only a native WebView owner can. So the primary mechanism the
   reference apps use **does not port to a pure web app**. ✗ for web/PWA.
2. **OAuth device flow — reachable + web-viable.** `POST oauth2.googleapis.com/device/code` (YouTube-TV
   client) → 200 with a `user_code`, `https://www.google.com/device`, 5 s poll interval, 30 min expiry.
   The edge could run this flow: user types a code, the Worker polls for the token, then calls InnerTube
   as the user. Deliberately **not** completed here.
3. **Library endpoints gate correctly.** Unauthenticated browse of `FEmusic_liked_playlists`,
   `FEmusic_history`, `VLLM` → 200 but ~1.6 KB gated/empty. Confirms they're the right targets and that
   real data needs a user token (nothing leaks anonymously).
4. **Official Data API v3 can't fill the gaps.** `myRating=like` needs OAuth, but more importantly
   **watch/search history was removed from Data API v3** and there is **no "favourite genre" field**.
   The legit API cannot deliver "recent history" or "genre" no matter the auth.

## Results
**VERDICT: PARTIAL ⚠ — technically possible, but grey-area, security-heavy, and partly impossible as literally asked. Recommend splitting off behind a legal decision gate.**

**What IS inheritable, and how:**
| Item asked for | Feasible on web? | Mechanism |
|----------------|------------------|-----------|
| Liked songs | ✓ (with auth) | InnerTube browse `VLLM` / `FEmusic_liked_playlists` as the authed user |
| Recent history | ✓ (with auth) | InnerTube browse `FEmusic_history` as the authed user (NOT via Data API) |
| Favourite genre | ✗ as-is → derive | Not a field anywhere; must be **inferred** client-side (aggregate liked/history artist tags — OpenMusic already pulls Last.fm tags, so it can compute this itself) |
| The auth itself | ⚠ only via OAuth device flow | Cookie/SAPISIDHASH is native-only; device flow works but uses the grey-area TV OAuth client |

**The blockers a human must decide before this ships:**
1. **Grey-area credentials.** The only web-viable auth (OAuth device flow) impersonates the YouTube-TV
   OAuth client — against Google's OAuth policy + YouTube ToS. The legit alternative (our own Google Cloud
   project + sensitive-scope app verification) is heavy, months of review, and *still* can't return
   history/genre.
2. **New threat model.** OpenMusic today stores **no user credentials** — every source is anonymous.
   Account-sync means storing per-user `refresh_token`s on the edge (encrypted, rotated, revocable). That
   is a categorically larger security + privacy surface than anything the app currently carries.
3. **ToS/legal + account risk.** Reading a user's library as the user, via an impersonated client, risks
   the user's Google account (bot flags) and OpenMusic's standing. Flagged for a human call — not assumed.

**Signal for the build:** **Split this pillar out.** Pillars 005/006/007 give a fully functional,
anonymous, no-credentials YTMusic *source* (search · play · lyrics · download) that fits the existing
adapter model with zero change to the app's trust posture — ship that as the phase. Treat "connect your
YouTube account + inherit library" as a **separate, later milestone gated on an explicit legal/product
decision**, and reframe "favourite genre" as a *derived* taste signal (inferred from liked/history tags)
rather than an inherited field.
