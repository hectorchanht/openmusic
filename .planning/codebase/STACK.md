# Technology Stack

**Analysis Date:** 2026-07-03

> NOTE: The root `CLAUDE.md` (and `AGENTS.md`) describe a LEGACY vanilla-JS single-file
> `index.html` desktop player. That file no longer exists at the repo root. The LIVE
> application is a SvelteKit + Vite mobile PWA under `src/`, deployed to Cloudflare
> Pages/Workers, and wrapped as an Android APK via Capacitor. This document maps what is
> ACTUALLY present. Manifest source of truth: `package.json`, `svelte.config.js`,
> `vite.config.ts`, `wrangler.jsonc`, `capacitor.config.ts`, `tsconfig.json`.

## Languages

**Primary:**
- TypeScript `~5.9` - all app logic, source adapters, services, stores, API routes (`src/**/*.ts`). `tsconfig.json` sets `strict: true`, `checkJs: true`, `moduleResolution: "bundler"`.
- Svelte 5 (`5.56.2`) - all UI components + routes (`src/**/*.svelte`, `src/routes/**`). Runes mode is FORCED project-wide via `svelte.config.js` `compilerOptions.runes` (except `node_modules`).

**Secondary:**
- JavaScript (ESM) - config only (`svelte.config.js`, `vite.config.ts`). `"type": "module"` in `package.json`.
- Kotlin - hand-written Android MediaStore bridge (referenced from `src/lib/services/media-store.ts`; native shell under `android/`).
- JSON/JSONC - config (`wrangler.jsonc`, `tsconfig.json`) and test fixtures (`src/lib/sources/__fixtures__/*.json`).

## Runtime

**Environment:**
- Node.js `>=22` (`package.json` `engines.node: ">=22"`, `.nvmrc` = `22`, CI uses `node-version: 22`). `.npmrc` sets `engine-strict=true`.
- Cloudflare Workers runtime (workerd) for the deployed edge — server routes run at the edge. `wrangler.jsonc` sets `compatibility_date: 2026-06-05` and `compatibility_flags: ["nodejs_compat"]`.
- Browser (iOS Safari + Android Chrome) for the client SPA/PWA.
- Android WebView (Capacitor) for the native APK — WebView origin `https://localhost` (androidScheme https, `capacitor.config.ts`).

**Package Manager:**
- pnpm `8.15.5` (pinned via `package.json` `packageManager` field + corepack). CI installs with `pnpm install --frozen-lockfile`.
- Lockfile: PRESENT — `pnpm-lock.yaml` (~83 KB).
- `pnpm.onlyBuiltDependencies`: `esbuild`, `sharp`, `workerd` (native postinstall allow-list).

## Frameworks

**Core:**
- SvelteKit `2.63.0` (`@sveltejs/kit`) - app framework, routing, server endpoints.
- Svelte `5.56.2` - UI framework (runes mode).
- Vite `8.0.16` - dev server + bundler (`@sveltejs/vite-plugin-svelte` `7.1.2`).

**Cloudflare Adapters (dual-target build switch, `svelte.config.js`):**
- `@sveltejs/adapter-cloudflare` `7.2.8` - DEFAULT web build → `.svelte-kit/cloudflare` (Cloudflare Pages). Service worker `register: true`.
- `@sveltejs/adapter-static` `3.0.10` - `BUILD_TARGET=native` build → `build/` SPA (`fallback: 'index.html'`, `strict: false`) wrapped by the Capacitor Android shell. Service worker `register: false` (the native shell serves its own files).

**Native (Capacitor) shell:**
- `@capacitor/core` `8.4.0`, `@capacitor/cli` `8.4.0`, `@capacitor/android` `8.4.0` (devDep).
- App identity LOCKED: `appId: com.openmusic.app`, `appName: OpenMusic`, `webDir: build`, `allowMixedContent: false` (`capacitor.config.ts`).

**Testing:**
- Vitest `^4.1.3` - test runner (`vite.config.ts` defines a single `server`/`node` project; no jsdom client project). `expect.requireAssertions: true`. Includes `src/**/*.{test,spec}.{js,ts}` and `*.svelte.test.ts` under node (the SvelteKit Vite plugin transforms `$state` runes for headless testing).
- 67 test files (`src/**/*.test.ts`), co-located with source.

**Build/Dev:**
- `svelte-check` `^4.4.6` + `typescript ~5.9` - type checking (`pnpm check`).
- `wrangler` `4.98.0` - Cloudflare deploy/preview/types (`pnpm deploy`, `pnpm preview`, `pnpm gen`).
- `@cloudflare/workers-types` `4.20260605.1` - edge runtime typings (`tsconfig.json` `types`).

## Key Dependencies

**Runtime `dependencies` (`package.json`):**
- `@lucide/svelte` `^1.17.0` - icon components (imported in ~23 `.svelte` files). OPTIMIZATION: verify per-icon imports (tree-shaken) rather than a barrel import to avoid pulling the full icon set into the bundle.
- `@capacitor/app` `^8.1.0` - native app lifecycle (background/foreground events).
- `@capacitor/filesystem` `8.1.2` - native file writes for offline downloads (`src/lib/services/blob-store.ts`).
- `@capacitor/splash-screen` `^8.0.1`, `@capacitor/status-bar` `^8.0.2` - native UX chrome.
- `@jofr/capacitor-media-session` `4.0.0` - native lock-screen media controls (`src/lib/services/native-media-session.ts`, `media-session.ts`).
- `capacitor-blob-writer` `1.1.20` - streams audio Blob to disk WITHOUT base64 round-trip (avoids +33% bloat / memory spike for lossless files; `src/lib/services/blob-store.ts`).

**Note:** ALL runtime dependencies are Capacitor plugins or the icon lib. The web app itself has NO third-party runtime npm dependencies — source adapters, proxy, and services are hand-written over the platform `fetch`/`URL`/`IndexedDB`/Cloudflare Cache APIs. Capacitor code is SSR/web-guarded (`Capacitor.isNativePlatform()` / `browser`) so it is a no-op on the web build.

## Configuration

**Environment / secrets:**
- Server secrets live in Cloudflare (`wrangler pages secret put …`), typed in `src/lib/proxy/proxy-types.ts` `Env`: `JOOX_TOKEN` (required for JOOX), `LASTFM_KEY` (optional), `LASTFM_SECRET` (optional). Local dev values in `.dev.vars` (present; keys: `JOOX_TOKEN`, `LASTFM_KEY`, `LASTFM_SECRET`). See INTEGRATIONS.md.
- Public var baked into Pages config: `JAMENDO_CLIENT_ID = "1df0a42f"` (`wrangler.jsonc` `vars`).
- Build-time var: `VITE_API_BASE` — unset on web (same-origin relative `/api/*`); set to `https://openmusic.lol` for the native build so the APK WebView (origin `https://localhost`) resolves `/api/*` to the deployed proxy (`src/lib/services/api-base.ts`).

**Build config files:**
- `svelte.config.js` - dual adapter switch + forced runes + conditional service worker.
- `vite.config.ts` - Vite + Vitest config (single node test project).
- `tsconfig.json` - extends `.svelte-kit/tsconfig.json`; strict, bundler resolution, CF workers types.
- `wrangler.jsonc` - Pages output dir `.svelte-kit/cloudflare`, compat date/flags, public vars.
- `capacitor.config.ts` - Android app identity + WebView security.

## Platform Requirements

**Development:**
- Node `>=22`, corepack-managed pnpm `8.15.5`.
- `pnpm dev` (Vite dev server; note MEMORY: strictPort 4321). `pnpm preview` runs `wrangler pages dev` on port 4173.
- Android build needs JDK (CI: `setup-java@v4`) + Gradle wrapper (`android/gradlew`) + `npx cap sync android`.

**Production:**
- Web: Cloudflare Pages (`pnpm deploy` → `wrangler pages deploy .svelte-kit/cloudflare --project-name openmusic`). Primary domain `openmusic.lol`; legacy `openmusic.pages.dev` (allowed during cutover, `src/lib/proxy/http.ts`).
- Android APK: two GitHub Actions workflows — `.github/workflows/android-main.yml` (rolling prerelease on push to main) and `.github/workflows/android-release.yml` (signed `assembleRelease`; keystore + passwords injected via repo secrets `RELEASE_KEYSTORE`/`KEY_ALIAS`/`KEYSTORE_PASSWORD`/`KEY_PASSWORD`; `release.jks` present at repo root). Build step: `BUILD_TARGET=native VITE_API_BASE=https://openmusic.lol pnpm build` → `npx cap sync android` → `./gradlew assembleRelease`.

## Build & Test Commands

```bash
pnpm dev            # Vite dev server (strictPort 4321)
pnpm build          # web build → .svelte-kit/cloudflare (adapter-cloudflare)
pnpm build:native   # BUILD_TARGET=native VITE_API_BASE=https://openmusic.lol → build/ SPA
pnpm preview        # wrangler pages dev .svelte-kit/cloudflare --port 4173
pnpm check          # svelte-kit sync + svelte-check (typecheck)
pnpm test           # vitest --run
pnpm test:unit      # vitest (watch)
pnpm gen            # wrangler types
pnpm cap:sync       # npx cap sync android
pnpm apk            # build:native + cap sync + gradle assembleDebug
pnpm deploy         # build + wrangler pages deploy
```

## Optimization Opportunities (tech-stack level)

- **No web runtime deps to prune** — the web bundle carries only `@lucide/svelte`; the other `dependencies` are Capacitor plugins guarded out of the web build. Confirm the Capacitor plugin code is actually tree-shaken from the Cloudflare bundle (they are imported in `src/lib/services/blob-store.ts`, `native-media-session.ts`; imports are behind `browser`/`isNativePlatform` runtime guards, not static conditions — dead-code elimination may NOT drop them from the web bundle).
- **`@lucide/svelte` import shape** — 23 `.svelte` files import from it; ensure named per-icon imports so Vite tree-shakes unused icons (a barrel/default import would inflate the bundle).
- **Edge caching coverage** — most dedicated proxy routes use `caches.default` (Deezer, Jamendo, Audius-search, 5sing, Last.fm discovery). The catch-all CN metadata route (`src/routes/api/[source]/[...path]/+server.ts`) and the `/api/lastfm/info` + `/api/similar` routes do NOT use `caches.default` and set no `Cache-Control`; repeated CN search/detail + Last.fm info calls hit upstream every time. See INTEGRATIONS.md for the per-route caching matrix.
- **`sharp` in `onlyBuiltDependencies`** — `sharp` is allow-listed for build but no `sharp` import appears in `src/`; confirm whether it is still used (icon generation?) or removable from the allow-list.

---

*Stack analysis: 2026-07-03*
