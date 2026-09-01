---
quick_id: 260831-sh9
title: Scheduled upstream health check — TLS expiry plus functional payload assertions
date: 2026-09-01
status: complete
commit: 7d27053
---

# What shipped

A daily GitHub Action that checks certificate expiry and asserts a real response body for all
seven upstreams, plus `pnpm health` for local runs.

# Why

kuwo's upstream served an expired TLS certificate from **2026-04-14**, Cloudflare answered 526 for
every `/api/kuwo/*` request, and because kuwo was the registry's primary source that silently
emptied the similar-song fallbacks. It ran that way for **four and a half months** and only
surfaced because a user reported a symptom three steps downstream.

The certificate was never the bug. The bug was that an upstream could die and stay dead without
producing a signal.

# Design decisions

**Two kinds of check, because the two failures we hit look different.** Cert expiry catches the
kuwo class *before* it breaks. Payload assertions catch the other class: a 200 is not proof of
health — `/api/translate` is documented in CLAUDE.md as returning 200 with the originals echoed
back. Every probe asserts something only a working upstream can produce.

**The Deezer probe requires a >1M-fan artist**, not merely "rows came back". The namesake-shell
bug fixed earlier the same day returned perfectly valid-looking rows that were useless; a naive
probe would have stayed green through it.

**Severity maps to real user impact**, so the job fails only when users are actually affected:

| | upstreams | on failure |
|---|---|---|
| `critical` | api.deezer.com · tang.api.s01s.cn (qq) · api.qijieya.cn (netease) | job fails |
| `degraded` | musicbrainz.org → Deezer · coverartarchive.org → gradient · ws.audioscrobbler.com → Deezer · kw-api.cenguigui.cn (already dead + demoted) | reported, job passes |

kuwo is deliberately `degraded`: it is already dead and off the resolve floor, and a permanently
red badge is how people learn to ignore a check — which is how this whole situation started.

**Retries 503/429 twice.** MusicBrainz throttles at ~1 req/s. The first live run went red on
timing alone; a check that cries wolf is the failure mode this exists to prevent.

**No install step, no dependencies** — `node:tls` + global `fetch`, so the job is fast and immune
to an unrelated lockfile break.

# First real run (2026-09-01) — it immediately earned its place

```
api.deezer.com        36d left   ← critical upstream, expiring soonest
musicbrainz.org       39d left   ← the item that prompted this task
api.qijieya.cn        53d · tang.api.s01s.cn 85d
coverartarchive.org   82d · ws.audioscrobbler.com 79d
kw-api.cenguigui.cn   EXPIRED 140d ago   ← caught, correctly degraded
payloads: 6/7 ok — kuwo the only failure
```

`api.deezer.com` at 36 days is a genuinely useful find: it is a `critical` upstream and the
nearest expiry of the lot, and nobody was watching it.

# Verification

- Exit code both ways: `--warn-days 45` makes Deezer critical → **exit 1**; default 30 → **exit 0**.
- 18 unit tests on the pure parts — exit-code policy, path resolution, arg parsing, table
  coverage, and that each payload assertion genuinely **discriminates** (fed the real shell-profile
  and low-score bodies that would otherwise slip through).
- `pnpm test` 100 files / **1862 tests**; `pnpm check` 4404 files, 0 errors 0 warnings.

# Follow-up

The workflow only fails the job; it does not notify. If a failing scheduled run is easy to miss,
wire the `critical` branch to a notification channel.
