# Deferred items — quick-260930-x3q

Found during the Task C album E2E. Out of scope (pre-existing, not caused by this task).

## 1. A HEAD probe of `/api/netease/url` runs into the 8 s probe timeout

- In the E2E, each netease donor probe's first request (`download-probe.ts` HEAD) ended
  `net::ERR_ABORTED` after exactly 8.0 s, which is `PROBE_TIMEOUT_MS`. The Range fallback then answered
  200 in 0.7-3.4 s. Every netease donor probe lost about 8 s this way.
- Likely cause: the catch-all route has no HEAD handler, so SvelteKit runs GET for HEAD. That fetches
  the whole upstream audio body before the headers go out. This happened before this task too, when
  the proxy deadline cut the body at 8 s.
- Fix direction: answer HEAD on the catch-all with an upstream HEAD (or `Range: bytes=0-0`) and no body,
  or have the probe skip HEAD for same-origin `/api/*/url` media.
