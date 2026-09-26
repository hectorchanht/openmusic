---
phase: quick-260926-nsz
plan: 01
status: complete
subsystem: comments (edge API + Now Playing pane)
tags: [comments, ugc, r2, edge, moderation, turnstile, nowplaying, i18n]
requires:
  - DIAG R2 binding (existing)
  - DIAG_READ_TOKEN (existing, maintainer moderation)
  - TurnstileSecret (Pages secret; set locally in .dev.vars, production needs a human `wrangler pages secret put`)
provides:
  - /api/comments GET (public + all=1 maintainer) / POST (post | report) / DELETE (maintainer)
  - songKey(artist, title) export from services/dedupe.ts
  - NpComments.svelte pane (narrow 3rd tab, wide third-column toggle)
affects:
  - src/lib/components/NowPlaying.svelte (Tab union, subnav, wide heads, selectTab)
  - wrangler.jsonc vars (TURNSTILE_HOSTNAMES)
tech-stack:
  added: []
  patterns:
    - Cloudflare Turnstile siteverify (token + action + hostname) before any R2 op
    - R2 conditional-put RMW (lyric-offset template), per-IP throttle object
    - native Intl.RelativeTimeFormat, crypto.subtle SHA-256 thread key
key-files:
  created:
    - src/lib/proxy/comments.ts
    - src/lib/proxy/comments.test.ts
    - src/lib/proxy/turnstile.ts
    - src/lib/proxy/turnstile.test.ts
    - src/routes/api/comments/+server.ts
    - src/routes/api/comments/comments-endpoint.test.ts
    - src/lib/services/comments.ts
    - src/lib/services/comments.test.ts
    - src/lib/services/turnstile-widget.ts
    - src/lib/components/NpComments.svelte
  modified:
    - src/lib/proxy/proxy-types.ts
    - wrangler.jsonc
    - src/lib/services/dedupe.ts
    - src/lib/components/NowPlaying.svelte
    - src/lib/i18n/{en,ar,de,es,fr,hi,id,it,pt,ru,th,tr,vi,zh-Hans,zh-Hant}.ts
decisions:
  - Turnstile gates POST action "post" only, BEFORE the throttle and any R2 access; reports stay un-gated; DELETE stays bearer-gated
  - MAX_COMMENT_BODY_BYTES raised 2048 -> 4096 to fit a <=2048-char Turnstile token plus the text
  - Posting is web-only; the Capacitor app reads and reports but shows a "post at openmusic.lol" note (prod hostname allowlist excludes localhost)
  - Wide third column defaults to Related; `tab` doubles as its Comments | Related selector
metrics:
  duration: ~14 min
  completed: 2026-09-26
  tasks: 3
  commits: 3
---

# Quick 260926-nsz: Per-song comment section (moderated MVP) Summary

Anyone can now comment on a song. There is one thread per song, keyed by the SHA-256 of dedupe's script-folded `songKey`, so the qq, kuwo, netease and joox copies share it, and so do the Simplified and Traditional spellings. Posting is gated by Cloudflare Turnstile and a per-IP throttle (30 s gap, 30 per UTC day). Three distinct reports hide a comment. The maintainer can list hidden comments and delete any comment with `DIAG_READ_TOKEN`. Storage is the existing DIAG R2 bucket under `comments/` and `comments-throttle/`.

## Commits

| Task | Commit | What |
|------|--------|------|
| 1 | `4b03e563` | Pure helpers, Turnstile verifier, `/api/comments` GET/POST/DELETE, fake-R2 + stubbed-siteverify tests, `Env` + wrangler var |
| 2 | `7ba3199e` | `songKey` extraction in dedupe (key() delegates), never-throw client service + tests |
| 3 | `22d71829` | `NpComments.svelte`, Turnstile loader, Now Playing tab/toggle wiring, 16 i18n keys x 15 locales |

## Verification (observed output)

- `pnpm test`: **162 files, 3609 tests passed**.
- `pnpm check`: **0 errors, 0 warnings** (the old `.subnav.heads span` unused-selector warning is gone).
- Task 1 gates: 0 non-verb exports; `threadObjectKey(` x3, `throttleObjectKey(` x1; `bucket.list` 0; `reporters` in non-comment route lines 0; `bearerMatches(` in non-comment lines exactly 2; `Allow-Methods` unchanged (`'GET, POST, OPTIONS'`).
- Task 2 gates: `export function songKey(` 1; `return songKey(t.artist, t.title)` 1; raw `fetch(` 0; `apiFetch(` 3; `warmScript(` 1. The existing dedupe suite passes unchanged.
- Task 3 gates: all 15 locales carry the new keys (checked `nowplaying.comments`, `comments.reportConfirm`, `comments.errVerify`, `comments.postOnWeb`); `@html` in NpComments 0; `data-tab="comments"` exactly 2; `<NpComments` 1; `openmusic:comment-name:v1` 1; `.subnav.heads span` 0.

### Live probe (curl on the dev server — proves SvelteKit loads the route module)

Local-miniflare key used: `k=7ab3e88b3d1a72fcdc62e1489d824d1a` (fresh). **No R2 writes were made.** Every probe was a read or a request rejected before any write.

On the ALREADY-RUNNING dev servers (4321 and 5173, same results on both):

| Request | Result |
|---------|--------|
| `GET ?k=<fresh>` | 200 `{"ok":true,"items":[]}` |
| `GET ?k=bad` | 400 `invalid-key` |
| `GET ?k=..&all=1` (no bearer) | 401 `unauthorized` |
| `DELETE ?k=..&id=..` (no bearer) | 401 `unauthorized` |
| `POST` foreign Origin | 403 `forbidden-origin` |
| `POST` text/plain | 415 `unsupported-type` |
| `POST` dummy token | **503 `unconfigured`**: these servers do not see the Turnstile vars in `platform.env` (see drift below) |

On a FRESH `vite dev --port 4399` (started for this probe and then stopped):

| Request | Result |
|---------|--------|
| `GET ?k=<fresh>` | 200 `{"ok":true,"items":[]}` |
| `POST` dummy token | **403 `turnstile`**: the secret and hostnames load, siteverify is reachable, and it rejects the dummy token |
| `POST` report, unknown id | 404 `not-found` (read only, no put) |

**Not verified live:**
- A successful post (200), then 429 on a repeat. Both need a real browser-solved Turnstile token, which curl cannot mint.
- Hide-at-3 across multiple IPs.
- The wide toggle and the 4-tab layout, visually.
- The native "post at openmusic.lol" note on the APK.
- Production secret provisioning.

These are left for the orchestrator's E2E (the Task 3 `<human-check>`). The unit tests cover every one of these paths against the fake R2 and the stubbed siteverify.

## Deviations from Plan

### Addendum-driven (orchestrator ADDENDUM A/B overrides)

1. **Tab order.** Narrow is Up Next | Lyrics | Comments | Related. The wide pair reads Comments | Related, with Related still the default (`class:active={tab !== 'comments'}`).
2. **Turnstile on posting**, folded into the existing tasks:
   - Server: new `src/lib/proxy/turnstile.ts` (`verifyTurnstile`, `parseHostnames`, `SITEVERIFY_URL`) with an injected-fetch test.
   - Body: the post body needs `token` (1..2048 chars).
   - Route order: binding 503 → origin 403 → JSON 415 → size 413 → parse 400 → address 400 → Turnstile (`unconfigured` → 503, `rejected` → 403 `turnstile`) → throttle → thread write.
   - Config: `Env.TurnstileSecret` / `Env.TURNSTILE_HOSTNAMES`, and `"TURNSTILE_HOSTNAMES": "openmusic.lol"` in `wrangler.jsonc` vars.
   - Client: `src/lib/services/turnstile-widget.ts` holds the public site key plus a module-level lazy loader. The site key lives here, not in `src/lib/config/turnstile.ts`, so there is one file instead of two. The loader injects `api.js?render=explicit` once (async/defer) and forgets a failed attempt.
   - Pane: NpComments renders the widget explicitly (`action: 'comment'`, `theme: 'auto'`, `size: 'flexible'`, callback / expired / error callbacks). It removes the widget on unmount and resets it after every submit. Post stays disabled until a token exists.
   - Native: the composer is hidden and the `comments.postOnWeb` note shows instead (documented in a `ponytail:` comment).
3. **`MAX_COMMENT_BODY_BYTES` 2048 → 4096.** A Turnstile token alone can be 2048 chars. The 413 tests now use `content-length: 5000` and a 4200-char body, instead of the plan's 3000 / 2100.
4. **`CommentErr` gained `'verify'`.** A 403 whose body err is `turnstile` maps to `verify` (shown as `comments.errVerify`). Any other 403 maps to `invalid`. There are 16 new i18n keys (the plan's 14 plus `comments.errVerify` and `comments.postOnWeb`).

### Auto-fixed issues

1. **[Rule 1 - Bug] `posting` stuck true after a mid-post song change.** In the plan's `submit()`, `if (commentsFor !== uid) return` came before `posting = false`, which would disable Post for the rest of the pane's life. `posting = false` (and the token reset) now run before the supersede check.
2. **[Rule 2 - Missing] `isCommentId` exported from `proxy/comments.ts`.** DELETE's `id` query needs the same UUID screen `parseCommentBody` uses. One regex, two callers.
3. **[Rule 1 - a11y warning] `role="group"` on the wide heads row.** Removing the row-level `aria-hidden` (as the plan requires) surfaced svelte-check `a11y_no_static_element_interactions` on the pointer handlers. An ARIA role clears it (check is back to 0 warnings).
4. **Counter uses `text.length`, not `[...text].length`.** It now counts what `maxlength="280"` counts, so it reaches 0 exactly when the textarea stops accepting input. The server still enforces 280 code points, and the client is never looser than that.
5. **Small additions:** `aria-label`s on the name input and the textarea (placeholders alone are not labels); `use:tapBounce` on the Report button (app-wide rollout); a Turnstile script that fails to load shows `comments.errVerify` so a disabled Post is explained.
6. **relativeTime at 40 days** renders "last month" under `numeric: 'auto'` (no digit), so the assertion is `/1|last month/` instead of "contains '1'".

## Assumption Drift (advisory)

- **Found during:** live probe.
- **Planned:** the running dev server's `platform.env` carries the Turnstile vars the orchestrator added to `.dev.vars`.
- **Actual:** servers already up on 4321/5173 answer POST with 503 `unconfigured`. A freshly started `vite dev` loads them and answers 403 `turnstile` for a dummy token.
- **Why:** the platform proxy reads `.dev.vars` at startup. **Restart the dev server before the browser E2E**, otherwise every post shows "Comments are unavailable".

## TDD Gate Compliance

The tasks were `tdd="true"`, but commits follow the quick-task convention of one `feat` commit per task, with tests and implementation together. There are no separate `test(...)` RED commits.
- **RED observed:** `turnstile.test.ts` and `services/comments.test.ts` both failed with module-not-found before their implementations existed.
- **RED not observed:** `proxy/comments.ts` was written before its test's first run, so no RED was seen there.

## Threat register update (per ADDENDUM B)

| Threat | New disposition |
|--------|-----------------|
| T-nsz-04 (spam flood) / T-nsz-05 (sybil) | **Mitigated for posting.** Turnstile token + action `comment` + hostname allowlist, checked before the throttle and any R2 op, so a tokenless bot costs 0 R2 ops and cannot burn a shared address's throttle slot. Residual: human farms and solver services. |
| Reports | Still un-gated. 3 distinct IPs hide a comment; maintainer DELETE and the `all=1` view are the backstop (T-nsz-10 unchanged). |
| Turnstile secret | Only in the siteverify form body, never logged or returned. Missing secret or empty allowlist → 503, fail closed. A network error, timeout or non-JSON reply from siteverify → 403 (unverifiable is not a pass). |
| New outbound surface | Edge → `challenges.cloudflare.com/turnstile/v0/siteverify` (10 s `AbortSignal.timeout`). Client → `challenges.cloudflare.com/turnstile/v0/api.js`, loaded only when the Comments pane mounts. The repo has no CSP, so nothing else needed changing. |

## Operational notes for the orchestrator/human

- **Production Turnstile secret must be set by a human:** `wrangler pages secret put TurnstileSecret --project-name openmusic` (the local wrangler auth cannot reach the account). Until then production POSTs answer 503. Reading and reporting still work, and the pane shows "Comments are unavailable right now." after a post attempt.
- `TURNSTILE_HOSTNAMES=openmusic.lol` ships in `wrangler.jsonc`. Preview deploys (`*.openmusic.lol` / `*.pages.dev`) are NOT on the allowlist, so posting fails verification there by design.
- Maintainer curl: `GET /api/comments?k=<k>&all=1` and `DELETE /api/comments?k=<k>&id=<id>`, both with `Authorization: Bearer $DIAG_READ_TOKEN`.
- Nothing was pushed. STATE.md, ROADMAP.md and PLAN.md were not touched. This SUMMARY is uncommitted.

## Known Stubs

None.

## Self-Check: PASSED

- All 10 created files exist on disk; the modified files are in commits `4b03e563`, `7ba3199e`, `22d71829` (all present in `git log`).
- No unexpected deletions in any of the three commits. The working tree holds only the pre-existing `PLAN.md` modification and the untracked `.planning/debug/page-switch-lag-tap-dead.md` (both left alone).
