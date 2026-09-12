---
phase: 33
slug: activity-log-upload-for-automated-diagnosis
status: draft
nyquist_compliant: false
wave_0_complete: false
created: 2026-09-12
---

# Phase 33 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution.
> Derived from `33-RESEARCH.md` § Validation Architecture.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | Vitest `^4.1.3` — a single project named `server`, `environment: 'node'`, **no jsdom** |
| **Config file** | `vite.config.ts` |
| **Quick run command** | `pnpm test -- <pattern>` (e.g. `pnpm test -- diag-payload`) |
| **Full suite command** | `pnpm test` (`vitest --run`) |
| **Type gate** | `pnpm check` (`svelte-kit sync && svelte-check`) |
| **Estimated runtime** | ~9 seconds full suite |
| **Verified baseline** | **110 test files / 2023 tests passing / 8.97s** — ran this session |

> `expect: { requireAssertions: true }` is set — **a test with no assertion FAILS.** Every test
> must assert something.

---

## Sampling Rate

- **After every task commit:** Run `pnpm test -- <pattern for the touched module>`
- **After every plan wave:** Run `pnpm test` (full suite) + `pnpm check`
- **Before `/gsd:verify-work`:** Full suite green at **≥ 2023 tests**, plus all new tests
- **Max feedback latency:** ~9 seconds (full suite)

---

## Per-Task Verification Map

| Behaviour | Test Type | Automated Command | File Exists | Status |
|-----------|-----------|-------------------|-------------|--------|
| `screenLogPayload` rejects oversize / empty / non-array / all-malformed; accepts a real log (D-05) | unit | `pnpm test -- diag-payload` | ❌ W0 — new `src/lib/proxy/diag-payload.test.ts` | ⬜ pending |
| `diagKey` is sortable and collision-resistant | unit | `pnpm test -- diag-payload` | ❌ W0 — same file | ⬜ pending |
| `bearerMatches` rejects missing header / wrong scheme / wrong token / **undefined expected value (fail closed)**; accepts the right one (D-03) | unit | `pnpm test -- diag-auth` | ❌ W0 — new `src/lib/proxy/diag-auth.test.ts` | ⬜ pending |
| `corsHeaders` includes `Authorization` in Allow-Headers | unit | `pnpm test -- http` | ⚠️ extend existing `src/lib/proxy/http.test.ts` | ⬜ pending |
| POST → 401 no/bad token · 503 no binding · 413 oversize · 400 malformed · 200 + key on success; **nothing written to the bucket on any reject path** | endpoint | `pnpm test -- diag-endpoint` | ❌ W0 — new, harness copied from `og-endpoint.test.ts:764-782` | ⬜ pending |
| GET list returns keys; GET `?key=` returns the body; both 401 without the read token (D-02) | endpoint | `pnpm test -- diag-endpoint` | ❌ W0 — same file | ⬜ pending |
| **Upload token never appears in any response body** | endpoint | `pnpm test -- diag-endpoint` | ❌ W0 — parity with `translate/server.test.ts` T-25c-01 | ⬜ pending |
| All 15 locales carry every new key (D-06) | unit | `pnpm test -- i18n` | ✅ `i18n.test.ts:51-56` enforces automatically | ⬜ pending |
| Types compile (`R2Bucket` in `Env`, new `TranslationKey`s) | typecheck | `pnpm check` | ✅ existing gate | ⬜ pending |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

---

## Wave 0 Requirements

- [ ] `src/lib/proxy/diag-auth.test.ts` — including the **fail-closed on undefined secret** case
- [ ] `src/lib/proxy/diag-payload.test.ts` — size cap, shape screen, key generation
- [ ] `src/lib/proxy/diag-endpoint.test.ts` — harness pattern copied from `og-endpoint.test.ts:764-782`
- [ ] Extend `src/lib/proxy/http.test.ts` with the `Authorization` Allow-Headers assertion

No framework install needed — existing Vitest infrastructure covers everything automatable.

---

## Manual-Only Verifications

Unit tests **structurally cannot** prove the following. This is not pessimism: this project already
documents the same limit at `resolve-endpoint.test.ts:8-11`, where `edgeCache()` returns null under
Vitest by design.

| Behaviour | Why Manual | Tier | Test Instructions |
|-----------|-----------|------|-------------------|
| The `+server.ts` exports only legal route members | Tests import the module directly and bypass SvelteKit route-module validation. **This 500'd production once (`29c1c7d`)** | 2 — deployed edge | First successful `curl` POST against the deploy. A 500 "Invalid export" here is the landmine, not a logic bug |
| R2 binding resolves via `platform.env` | `platform` is `undefined` under both Vitest and `vite dev` | 2 — deployed edge | `curl` POST returns `{"ok":true,"key":…}` rather than 503 |
| R2 read-after-write / list-after-write consistency | The test harness's in-memory Map is trivially consistent | 2 — deployed edge | Upload, then immediately `curl` the list and the fetch-one endpoints |
| Secrets reach `platform.env` from `wrangler pages secret put` | Not a local mechanism | 2 — deployed edge | 401 with a wrong token, 200 with the right one |
| The Workers Free 10ms CPU budget holds for a full 512 KiB payload | No CPU metering in node | 2 — deployed edge | Oversize POST must return **413, not a 5xx** |
| **APK CORS preflight carrying `Authorization`** | No browser, no WebView, no cross-origin in the node project | 3 — **device only** | Upload from the installed APK; a CORS failure here is the missing Allow-Header |
| `prompt()` works in the Capacitor Android WebView | No DOM under Vitest | 3 — **device only** | If no prompt appears, fall back to a text input |

### Tier 2 commands (require a user-approved push — see Risks)

```bash
curl -sS -X POST https://openmusic.lol/api/diag \
  -H "Authorization: Bearer $DIAG_UPLOAD_TOKEN" -H 'content-type: application/json' \
  --data-binary @sample-log.json -i          # expect 200 + {"ok":true,"key":"log/…"}

curl -sS https://openmusic.lol/api/diag -H "Authorization: Bearer $DIAG_READ_TOKEN"
curl -sS "https://openmusic.lol/api/diag?key=log/…" -H "Authorization: Bearer $DIAG_READ_TOKEN"

curl -sS -X POST https://openmusic.lol/api/diag -d '[]' -i          # expect 401
curl -sS -X POST https://openmusic.lol/api/diag \
  -H "Authorization: Bearer wrong" -d '[]' -i                       # expect 401
head -c 600000 /dev/urandom | base64 | curl -sS -X POST https://openmusic.lol/api/diag \
  -H "Authorization: Bearer $DIAG_UPLOAD_TOKEN" --data-binary @- -i # expect 413, NOT a 5xx
```

### Tier 3 — the phase's actual success criterion

`pnpm apk` (set `JAVA_HOME=/opt/homebrew/opt/openjdk@21/libexec/openjdk.jdk/Contents/Home` — see
STATE.md:45), install, then on the phone: **Settings → Activity log → Upload log.** Then fetch that
same log from the laptop within ~10s. That round trip — phone upload, laptop read, no copy-paste —
is what this phase exists to deliver.

---

## Blocking Environment Prerequisite

`wrangler whoami` on this machine is authenticated to two accounts, **neither of which hosts
`openmusic`** (the project lives on account `f1868a071996e836eae6da2b65f37929`;
`wrangler pages ... ` returns `Authentication error [code: 10000]`). **No executor can create a
binding or set a secret from this machine, for any storage backend.** Tier 2 and Tier 3 are blocked
until a human re-authenticates, enables R2, creates the bucket, and sets both secrets.

Also: `pnpm deploy` is shadowed by a pnpm builtin — use **`pnpm run deploy`**.

---

## Validation Sign-Off

- [ ] All tasks have an automated verify or a Wave 0 dependency
- [ ] Sampling continuity: no 3 consecutive tasks without an automated verify
- [ ] Wave 0 covers all four MISSING test files
- [ ] No watch-mode flags (`vitest --run` only)
- [ ] Feedback latency < 10s
- [ ] `nyquist_compliant: true` set in frontmatter

**Approval:** pending
