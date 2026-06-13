# Deploying openmusic to Cloudflare Pages

This project auto-deploys to **Cloudflare Pages** using Cloudflare's **native Git
integration** — *not* a GitHub Actions workflow. Once the one-time dashboard
connection below is done, **every push to `main` triggers a production build +
deploy** to <https://openmusic.lol> with no manual step.

There is **no** `.github/workflows/deploy.yml`, **no** GitHub-side
`CLOUDFLARE_API_TOKEN` / account-ID secret, and **no** `wrangler deploy` to run by
hand. The Cloudflare dashboard owns the GitHub connection and the build
credentials.

---

## 1. How it works (overview)

- Cloudflare Pages watches the connected GitHub repo
  **`hectorchanht/musicsquare-mobile`**.
- A push to **`main`** triggers a Pages build and a **production** deploy to
  `openmusic.lol`.
- The build runs `pnpm build` (= `vite build`) and serves the
  **`.svelte-kit/cloudflare`** output directory.
- The `/api/*` proxy ships **inside the same Pages build**:
  `@sveltejs/adapter-cloudflare` bundles the SvelteKit server routes into a
  `_worker.js` that Pages runs at the edge. There is **no separate Worker** and
  **no second deploy**.
- Only `main` deploys to production. No PR/preview deployments are configured for
  now (this can be enabled later in the dashboard without touching the repo).

## 2. One-time dashboard setup (the manual part)

The agent / CLI cannot configure the Cloudflare dashboard. Do this once:

1. Open the Cloudflare dashboard for account
   **`f1868a071996e836eae6da2b65f37929`** →
   **Workers & Pages** → **`openmusic`**.
   (Direct link:
   `https://dash.cloudflare.com/f1868a071996e836eae6da2b65f37929/pages/view/openmusic`)
2. **Settings → Build / Git:** connect (or confirm) the GitHub repo
   **`hectorchanht/musicsquare-mobile`**.
3. **Production branch:** `main`.
4. **Build command:** `pnpm build`.
5. **Build output directory:** `.svelte-kit/cloudflare`.
6. **Package manager:** pnpm is **auto-detected** from `pnpm-lock.yaml` (Cloudflare
   runs a frozen install). Nothing to set.
7. **Node version:** handled by the in-repo `.nvmrc` (`22`). As a
   belt-and-suspenders fallback, also set a **build environment variable**
   `NODE_VERSION = 22` (Settings → Variables and Secrets → *Build* variables).

That is the entire connection. Save it, and the next push to `main` deploys.

## 3. In-repo build config (already correct — reference, do not change)

Cloudflare's Git integration reads the build config that already lives in the repo;
you should **not** need to edit any of these:

- **`wrangler.jsonc`** declares:
  - `name: "openmusic"` (matches the Pages project)
  - `compatibility_flags: ["nodejs_compat"]`
  - `pages_build_output_dir: ".svelte-kit/cloudflare"` (the directory Pages serves)
- **`svelte.config.js`** uses **`@sveltejs/adapter-cloudflare`**, which is what
  produces the `.svelte-kit/cloudflare` output (including the `_worker.js` for
  `/api/*`).
- **`.nvmrc`** (`22`) and **`package.json` → `engines.node` (`>=22`)** pin the build
  to Node 22 LTS.

Because all of this is committed, the build configuration travels with the repo —
the dashboard only stores the connection + the build command/output above.

## 4. Production runtime environment variables (REQUIRED — read this)

The `/api/*` routes read their secrets from `platform.env` at runtime. **You must
set these in the Pages project's _Production_ environment** (Settings → Variables
and Secrets → **Production**), or `/api/*` will break in production. These are
configured **only in the dashboard** — never commit their values to the repo.

| Variable        | Required?    | What breaks if missing                                                                 | Set as |
| --------------- | ------------ | -------------------------------------------------------------------------------------- | ------ |
| `JOOX_TOKEN`    | **REQUIRED** | The JOOX proxy **throws** (`src/lib/proxy/joox.ts`) → JOOX search/playback fails in prod. | Secret |
| `LASTFM_KEY`    | optional     | Last.fm read features (`/api/similar`, `/api/lastfm/*`) degrade to empty results; the app still runs. | Secret |
| `LASTFM_SECRET` | optional     | Signed Last.fm calls (auth / scrobble) are unavailable; read-only Last.fm still works. | Secret |

**Do NOT add `LASTFM_ENDPOINT`.** It is **not** an environment variable — it is a
hardcoded constant (`https://ws.audioscrobbler.com/2.0/`) inside the `+server.ts`
route files. Adding it as a dashboard variable does nothing.

> **WARNING:** Never commit any of these secret values to the repository. They are
> set exclusively in the Cloudflare dashboard. (Locally, they go in a gitignored
> `.dev.vars` for `pnpm preview` / `wrangler pages dev`.)

## 5. Verify a deploy

1. Push a trivial commit to `main`.
2. In **Workers & Pages → `openmusic` → Deployments**, watch the new build run
   `pnpm build` and publish to production.
3. Load <https://openmusic.lol> and run a search.
   - If search returns JOOX results, the runtime received `JOOX_TOKEN` correctly.
   - If JOOX results are missing / `/api/*` 5xxs, re-check step 4 (the production
     `JOOX_TOKEN` secret).

## 6. Manual fallback (not the deploy path)

The native Git integration above is the deploy path. If you ever need a one-off
manual publish (e.g. the dashboard connection is temporarily unavailable), you can
still build and push from a machine with `wrangler` authenticated to the account:

```bash
pnpm build
pnpm exec wrangler pages deploy .svelte-kit/cloudflare --project-name openmusic
```

This is a manual escape hatch only — normal deploys happen automatically on push to
`main`.
