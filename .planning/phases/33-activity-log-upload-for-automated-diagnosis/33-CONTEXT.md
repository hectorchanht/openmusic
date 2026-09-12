# Phase 33 — Activity-log upload for automated diagnosis

## Goal

Let a user upload their on-device Activity log from the app so it can be analysed directly,
replacing the manual reproduce → export → paste-a-huge-JSON-blob-into-chat loop.

## Why this is worth building — evidence, not speculation

The Activity log was the ONLY thing that cracked bugs which had defeated **seven prior debug
sessions over three months**. Four separate root causes came out of it on 2026-09-12 alone:

| root cause | commit |
|---|---|
| `tryFallback` had no deadline — 6s watchdog handed off to an unbounded 19–29s walk | `acf96c0` |
| readiness guard trusted a url with no age check (5 copies, 4 stale-blind) | `3382300` / `0971a00` |
| a dry grow dead-ended playback silently | `6b5980a` |
| foreground `stalled` (~3.2s) executing healthy tracks | `cd9be10` |

Every one of those rounds cost a manual phone capture and paste. **Several shipped fixes are still
UNVERIFIED on device purely because capture is expensive** — `cda5220` (kuwo gate + preconnect) and
`6b5980a` (dry-grow) among them. This phase removes the project's actual debugging bottleneck.

## Reuse — do NOT rebuild

- `logAction()` / `src/lib/stores/actionLog.svelte.ts` — the log already exists, is viewable at
  Settings → Activity log, and is already exportable by the user.
- Instrumentation added 2026-09-12: `src.set`, `media.loadstart/progress/loadedmetadata/canplay/
  stalled/suspend/waiting` (ms-since-src-set + `readyState`/`networkState`/`bufferedEnd`),
  `playing.ms`, `fallback.budget`, `grow.dry-retry`, `grow.dry-stop`.
- Cloudflare Pages + Workers is already the deploy target; `wrangler.jsonc` exists.
- `src/lib/proxy/` is the server-side layer; `hooks.server.ts` is the single CORS seam.
- `proxy/http.ts` exports the shared `jsonResponse()`; **`proxy/safe-image-url.ts` is the precedent
  for a validated server-side input guard** (character screen → parse → allowlist, with tests).
- See CLAUDE.md "Shared Primitives" — import, never re-inline.

## The hard part is NOT the endpoint

These are the real decisions. An endpoint without them is the easy half.

### 1. Privacy — the primary question

An activity log is a **full listening history**: song titles, artists, uids, timestamps, and the
user's behaviour over a session. "All users can upload" makes this personal-data collection.

Needs an explicit decision on:
- **Consent** — opt-in, never silent. The user presses a button, having been told what is sent.
- **Retention** — how long, and what deletes it.
- **A delete path** — can a user remove what they uploaded?
- **Pseudonymity** — is an upload tied to any identity at all, and does it need to be?

### 2. Storage on the Cloudflare free tier

A documented project constraint (`CLAUDE.md`: "must fit the Cloudflare free/edge model"). Choose
between R2 / KV / D1 / Durable Objects for payloads of roughly **1,500 entries / several hundred
KB** (the captures in this session ran ~1,500 lines). Free-tier limits, not elegance, decide this.

### 3. Abuse

A public unauthenticated write endpoint is a spam/DoS target. Needs size caps, rate limiting, and a
decision on whether uploads are authenticated at all.

### 4. Retrieval

The entire point is that the log can be read WITHOUT copy-paste — so listing and fetching must
exist, and that is itself an access-control question.

### 5. No background uploading

The project has **three recorded fetch-flood freeze incidents** (see the `api-fetch-flood-freeze`
memory and `resolved/` sessions). Upload must be an explicit user action — never automatic, never
on a timer, never on app start.

## Scope recommendation — put this to the user in planning

The user framed it as *"all user can upload their activity logs for analysis"*. Strongly consider a
**v1 that is SINGLE-USER** (just them):

- It unblocks the debugging loop **immediately**, which is the actual goal.
- It defers most of the privacy and abuse surface to a later milestone.
- Multi-user adds consent UX, retention policy, per-user access control and rate limiting — all real
  work that delivers nothing the single-user version does not already deliver for the stated need.

Do not assume the full multi-user build. Ask.

## Constraints

- SvelteKit + **Svelte 5 runes (forced)**, TypeScript strict, **tabs**, single quotes — EXCEPT
  `src/lib/i18n/*.ts` which uses **double quotes** across **16 locales with identical key sets**
  (`en` is the reference; a missing key is a compile error, so every new UI string needs all 16).
- Stores are runes singletons in `*.svelte.ts`; pure logic stays `.ts` so it is node-testable under
  the single Vitest project (**no jsdom**).
- Gates: `pnpm check` + `pnpm test` (no linter). Baseline **2023** tests green.
- **Pushing to main AUTO-DEPLOYS to production** (openmusic.lol) — never push without asking.
- Secrets live only in Cloudflare `platform.env`, injected edge-side — never in the client bundle.

<decisions>
## Implementation Decisions (locked 2026-09-12, planning gate)

These answer the two questions this document flagged as "put this to the user in planning".

- **D-01 — v1 is SINGLE-USER.** Only the maintainer can upload. Upload is gated by a secret
  the maintainer holds; there is no public unauthenticated write path. Explicitly OUT of scope
  for this phase: multi-user consent UX, a retention policy, a user-facing delete path,
  pseudonymous per-user identity, and per-user rate limiting. Rationale: single-user unblocks
  the debugging loop immediately — the actual goal — and defers the entire privacy and abuse
  surface to a later milestone without losing anything the stated need requires.

- **D-02 — Retrieval is TOKEN-GATED list + fetch endpoints.** A list endpoint and a
  fetch-one endpoint under `/api/`, both requiring a bearer token. Copy-paste is removed:
  the log is fetched directly. No unguessable-share-URL scheme, no wrangler-CLI-only path.

- **D-03 — The upload token and any read token live ONLY in Cloudflare `platform.env`,**
  injected edge-side, never in the client bundle. Same rule as `JOOX_TOKEN` / `LASTFM_SECRET`.

- **D-04 — Upload is an EXPLICIT user action.** Never automatic, never on a timer, never on
  app start, never retried in the background. Guards against the three recorded fetch-flood
  freeze incidents (`api-fetch-flood-freeze`).

- **D-05 — Size cap and input validation are server-side,** following the
  `proxy/safe-image-url.ts` precedent (screen → parse → validate, with tests). A malformed or
  oversized body is rejected at the edge before storage. Applies even under D-01 — an
  authenticated endpoint is still a validated one.

- **D-06 — No UI-SPEC.** The client surface is a single control on the existing Settings →
  Activity log screen, reusing established Settings component and `use:tapBounce` patterns.
  Every new user-facing string MUST be added to all 16 `src/lib/i18n/*.ts` dictionaries with
  DOUBLE quotes — a missing key is a compile error.

- **D-07 — Storage backend is Claude's discretion,** to be chosen in RESEARCH.md from
  R2 / KV / D1 / Durable Objects against Cloudflare **free-tier** limits for payloads of
  ~1,500 entries / several hundred KB. Free-tier fit decides it, not elegance.

</decisions>
