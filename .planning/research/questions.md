# Open Research Questions

Questions surfaced during exploration that need their own investigation. Each entry records who
raised it, why it matters, and what would close it.

---

## Q1 — Is there a second lossless-capable CN source, so QQ/tang is not a single point of failure?

**Raised:** 2026-08-31, `/gsd:explore` (see `.planning/notes/qq-lossless-first-resolve.md`)
**Blocks:** nothing today — Phase 32 ships on tang alone, with the existing kuwo/netease 320k
ladder catching failures and lossless silently degrading.

**Why it matters.** Phase 32 makes `tang.api.s01s.cn/music_open_api.php` the primary resolve for
every song. It is one unmaintained free API. The precedent is concrete: upstream musicsquare's
latest commit is `fix kuwo music api as kw-api.cenguigui.cn is not maintained now` — a provider in
this exact class dying and forcing a rewrite. When tang dies, lossless disappears entirely and
every resolve falls back a tier.

**What would close it.** A throwaway `/gsd:spike` that finds and probes candidate providers
exposing a lossless tier (FLAC/APE/SQ), scored against the four constraints already used to pick
5sing in `quick-260607-hvu`:

1. edge-reachable (or CORS-open, which is what makes the direct-fetch fast path possible at all)
2. direct progressive stream, no MSE/HLS
3. no signed-state auth (or a secret that can live in `platform.env`)
4. small enough to land as one adapter + one proxy + one registry line

Also worth probing: does JOOX's Atmos/SQ tier qualify? Upstream has a commit
`use Atmos by default for joox music`, and we already hold `JOOX_TOKEN` — it may be the cheapest
second provider rather than a new source. `sources/joox.ts` already has a `pickByQualityPref`.

**Answer:** _open_
