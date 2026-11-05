---
created: 2026-11-05
area: sources
origin: Phase 43 (deferred)
---

# SoundCloud as a playback source

Deferred from Phase 43 (user decision 2026-11-05). The planned approach — scrape SoundCloud's
internal `client_id` from its web JS and call the unofficial api-v2 — was blocked as bypassing a
third-party access control, and is not to be revived in that form.

Ready to reuse when this is picked up: `src/lib/services/hls.ts` (native-HLS gate + browser stitch
for downloads, 43-04), the `urlExpiresAt` freshness contract and `SOUNDCLOUD_IMAGE_HOSTS` (43-01),
the D-08 `noticeOnAutoPick` notice. Original plans: `.planning/phases/43-*/deferred/43-03-PLAN.md`
(edge) and `43-07-PLAN.md` (adapter) — both assume the scraped client_id and must be re-planned.

Viable route: register an app at developers.soundcloud.com, keep the client credentials as
Cloudflare secrets, use the official API (check app approval + stream permission limits first).
