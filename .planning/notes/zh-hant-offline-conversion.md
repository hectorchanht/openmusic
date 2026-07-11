---
title: zh-Hant offline conversion + reliable translation fallback
date: 2026-07-11
context: Exploration of fixing intermittent /api/translate failures; deciding whether to integrate TongWenTang for Simplified→Traditional
---

# zh-Hant offline conversion + reliable translation fallback

## Problem

`/api/translate` (`src/routes/api/translate/+server.ts`) calls the **unofficial free
Google Translate endpoint** (`translate.googleapis.com/translate_a/single`, no key). Under
load it rate-limits and silently **echoes the originals** back as an HTTP-200 "success"
(already hardened against with per-line `flags` + `complete` gate + retry in
`src/lib/services/translate.ts`, but the root cause — an unreliable free upstream — remains).

## Key insight

The user's **only real translation need is Simplified → Traditional Chinese (zh-Hans →
zh-Hant)**. Other target languages are "fine as-is." zh-Hans→zh-Hant is a **deterministic
offline char/phrase conversion** (OpenCC / TongWenTang class) — it needs **no API at all**.
The two translate call-sites are song/artist **names** (`stores/names.svelte.ts`) and
**lyrics** (`NowPlaying.svelte`), both dominated by Chinese content.

## Decision — hybrid

- **Primary (offline s2t):** when target = `zh-Hant` and source is Chinese, convert
  client-side with a bundled s2t dictionary. Instant, no network, no rate limit, **works
  offline / on lockscreen** (matches the app's PWA/background-audio priority). Lazy-loaded
  via dynamic import so it stays out of the initial bundle.
- **Fallback (provider cascade):** for genuinely cross-language content (EN→zh, JA→zh) or
  non-zh targets, keep an API but make it a **cascade: Azure Translator → DeepL Free →
  unofficial-Google**, advancing to the next provider on failure / rate-limit / echo. Keeps
  service working even when one provider is down. Reuse the existing `flags`/`complete`
  soft-fail detection to decide when to fall through.

## Offline s2t library comparison (measured gzipped, s2t only)

| Library | s2t gzip | Level | Edge+Capacitor safe | Verdict |
|---|---|---|---|---|
| **tongwen-core + tongwen-dict** | **~72 KB** (engine 1.3 + s2t-char 12.5 + s2t-phrase 55.6) | phrase | ✅ pure JS/JSON, MIT | **CHOSEN** — small + phrase-quality |
| opencc-js | ~425 KB phrase (or ~25–32 KB char-only) | phrase | ✅ pure JS, MIT/Apache | too big for the marginal coverage gain |
| chinese-conv | ~30 KB | **char-only** | ✅ MIT | reject — mis-converts context (头发→頭髮, 里→裡/裏) |
| opencc (native) | — | phrase | ❌ node-gyp | breaks Workers + Capacitor |

**"Would it make the app too big?" → No.** ~72 KB gzipped, lazy-loaded only when target is
zh-Hant. Phrase-level quality (disambiguates 头发→頭髮, 里→裡/裏).

## API fallback providers

| Service | Free quota | Key? | zh-Hant? | Notes |
|---|---|---|---|---|
| **Azure Translator** | 2M chars/mo | yes (+region header) | ✅ | primary fallback — best quota + official reliability |
| **DeepL Free** | 500k chars/mo | yes | ✅ (since Nov 2024) | 2nd — best quality; `api-free.deepl.com`, `DeepL-Auth-Key` |
| unofficial-Google | — | no | ✅ (echoes under load) | last resort (current behaviour) |
| MyMemory | 5k/day anon (per-IP) | optional email | ✅ | drains fast on shared CF egress IPs — skip |
| Lingva | free public | no | ✅ | same Google echo/429 problem — skip |

Secrets follow the existing edge-only pattern (`JOOX_TOKEN`, `LASTFM_*` in Cloudflare
`platform.env` / `.dev.vars`).

## Known edge case

Japanese kanji shares glyphs with Han — blindly running s2t over JA lyrics could wrongly
convert. Route by CJK-source detection (only offline-convert lines detected as Chinese;
send others to the API cascade).

## Sources

- tongwen: github.com/tongwentang · npm `tongwen-core` + `tongwen-dict`
- Azure Translator pricing + language support (2M/mo free tier, native `zh-Hant`)
- DeepL supported languages + Traditional Chinese announcement (Nov 2024)
