# quick-261103-pga — app-wide impeccable audit + auto-fix

Detector: `impeccable detect src` (static) + URL scans of every (app) route at 390x844 against the dev server.

## Fixed
- **P1 song share pages** (`song/[slug]`, `song/[artist]/[title]`): CTA read undefined `--accent` → always purple #6c5ce7 + #fff (second accent, ignored user accent). Now `--color-primary` / `--color-on-primary` + `--color-focus` ring. Error text #ff7a7a → `--color-danger-text` (light-theme contrast). Placeholder cover → `--color-surface-2`; page-level cover shadow removed (Flat-Until-It-Floats); opacity-dimmed artist/status → `--color-text-muted`; off-ramp sizes → 0.9375rem.
- **P1 placeholder contrast**: UA placeholder grey was 3.6:1 on surface-2 (search input). Global `::placeholder` → muted token.
- **P2 NpComments** error/armed-report #f66 → `--color-danger-text`.
- **P2 Activity log** `.n` read undefined `--color-accent` → orange second accent; now `--color-text`.
- **P2 Appearance light-theme preview** border #c5c5cf was stale (app.css raised it to #80808a in rrb).
- **P3 Tabbar labels** 10px → 0.6875rem; DESIGN.md updated. Dropped dead `#7c5cff` fallbacks in layout.

## Verified false positives / left as-is
- `overused-font` Inter, `side-tab` on SettingToggle: documented in DESIGN.md.
- Appearance "purple gradient / cyan neon": accent-preset swatches + RowActionsConfig sample cover.
- `auth-core.ts` literal colours/fonts: email HTML cannot use CSS vars.
- SponsoredStrip 9px disclosure, uppercase section labels: deliberate house style.

## Open
- Song share page status strings ("Finding a playable version…", "Now playing on openmusic.", "Play on openmusic") are English-only — needs i18n keys ×16 locales (`/impeccable harden`).

Checks: `pnpm check` 0 errors (19 warnings = baseline), `pnpm test` 5212/5212, re-scan clean on fixed pages.
