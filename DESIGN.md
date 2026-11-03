---
name: openmusic
description: A pocket jukebox for every catalog — tap it, it plays, it never stops.
colors:
  tiffany-signal: "#0abab5"
  tiffany-signal-pressed: "#09a49f"
  night-floor: "#0b0b0f"
  lifted-slate: "#16161d"
  raised-slate: "#1d1d27"
  hairline-grey: "#888888"
  chalk-text: "#f4f4f6"
  dusk-text: "#a0a0ad"
  alarm-coral: "#ff5a76"
  alarm-coral-text: "#ff7a90"
  pure-white: "#ffffff"
  on-primary: "#0b0b0f"
typography:
  display:
    fontFamily: "Inter, system-ui, -apple-system, sans-serif"
    fontSize: "1.5rem"
    fontWeight: 800
    lineHeight: 1.2
  headline:
    fontFamily: "Inter, system-ui, -apple-system, sans-serif"
    fontSize: "1.4rem"
    fontWeight: 700
  title:
    fontFamily: "Inter, system-ui, -apple-system, sans-serif"
    fontSize: "0.875rem"
    fontWeight: 600
    lineHeight: 1.3
  body:
    fontFamily: "Inter, system-ui, -apple-system, sans-serif"
    fontSize: "0.9rem"
    fontWeight: 400
    lineHeight: 1.5
  label:
    fontFamily: "Inter, system-ui, -apple-system, sans-serif"
    fontSize: "0.75rem"
    fontWeight: 400
    lineHeight: 1.3
  micro:
    fontFamily: "Inter, system-ui, -apple-system, sans-serif"
    fontSize: "0.625rem"
    fontWeight: 400
rounded:
  sm: "6px"
  row: "8px"
  md: "12px"
  sheet: "16px"
  lg: "18px"
  full: "9999px"
spacing:
  xs: "4px"
  sm: "8px"
  md: "12px"
  lg: "16px"
  hit: "44px"
components:
  button-primary-round:
    backgroundColor: "{colors.tiffany-signal}"
    textColor: "{colors.on-primary}"
    rounded: "{rounded.full}"
    size: "40px"
  button-play-hero:
    backgroundColor: "{colors.pure-white}"
    textColor: "{colors.night-floor}"
    rounded: "{rounded.full}"
    size: "62px"
  button-sheet:
    backgroundColor: "{colors.lifted-slate}"
    textColor: "{colors.chalk-text}"
    rounded: "{rounded.md}"
    height: "48px"
  button-sheet-danger:
    backgroundColor: "{colors.alarm-coral}"
    textColor: "{colors.pure-white}"
    rounded: "{rounded.md}"
    height: "48px"
  input-search:
    backgroundColor: "{colors.raised-slate}"
    textColor: "{colors.chalk-text}"
    rounded: "{rounded.full}"
    padding: "12px"
    height: "44px"
  chip-tag:
    backgroundColor: "{colors.raised-slate}"
    textColor: "{colors.dusk-text}"
    typography: "{typography.label}"
    rounded: "{rounded.full}"
    padding: "6px 10px"
  list-row:
    backgroundColor: "transparent"
    textColor: "{colors.chalk-text}"
    typography: "{typography.title}"
    rounded: "{rounded.row}"
    height: "44px"
  list-row-active:
    backgroundColor: "{colors.lifted-slate}"
  setting-toggle:
    backgroundColor: "{colors.night-floor}"
    textColor: "{colors.chalk-text}"
    rounded: "{rounded.md}"
    padding: "13px 14px"
  nowbar:
    backgroundColor: "{colors.night-floor}"
    textColor: "{colors.chalk-text}"
    height: "64px"
    padding: "8px 12px"
  tabbar:
    backgroundColor: "{colors.night-floor}"
    textColor: "{colors.dusk-text}"
    typography: "{typography.micro}"
    height: "56px"
---

# Design System: openmusic

## Overview

**Creative North Star: "The Pocket Jukebox"**

openmusic is a jukebox that fits in a thumb's reach: you drop a coin (a tap) and the record plays. The chrome is a dark cabinet, near-black and almost silent, so the only things that glow are the album art, the lyrics and one signal colour. At rest, every control is flat and quiet: thin hairline borders, tonal slate layers, no ornament. When you touch a control it responds physically, with a press-in bounce, a spring settle, or a scrub knob that swells under your finger. Restraint at rest and give under the thumb are the two halves of the same machine.

Density follows the jukebox list. Rows are compact (44px hit height, 40px art), and shelves are dense grids of covers, so a phone screen holds a lot of music without feeling packed. The interface never competes with the cover. Where a cover is missing, a generated gradient stands in so no tile is ever a broken image.

Theming is part of the cabinet, not a skin on top. Dark is the default. A light theme and two supporter-exclusive dark themes (gold, sakura) swap only the surface, text and border tokens, so layouts never change. The accent is user-pickable at runtime (`settings.applyTheme()`), and every component reads `--color-primary` rather than a literal.

**Key Characteristics:**
- Near-black cabinet, one signal accent, covers and lyrics as the only light sources.
- Flat at rest, tactile on touch: `tapBounce` press, spring settles, a swelling scrub knob.
- Depth through tonal slate steps and 1px hairlines; shadows only on things that float.
- Pills and circles for anything you press; gentle 6–12px corners for anything you read.
- Everything scales: text via root `rem` × `--fs-app`, covers via `--cover-scale`, home grid via `--home-grid-cols`.

## Colors

A dark, near-neutral cabinet lit by a single cool teal signal, with per-source brand colours kept to small chips.

### Primary
- **Tiffany Signal** (`tiffany-signal`): the one accent. It marks the live state: the playing progress fill, the scrubber fill, the Nowbar play button, the search submit, a toggle that is on, a selected chip's text and border, and the left edge of an enabled setting. It is the default of six runtime accent presets (`ACCENT_PRESETS`), so treat it as a role, not a fixed hue: always reference `var(--color-primary)`.
- **Tiffany Signal, pressed** (`tiffany-signal-pressed`): the hover and pressed state of primary fills (the accent darkened by 12%).
- **On-Primary** (`on-primary`): text and icons on a primary fill. `applyTheme()` sets `--color-on-primary` to `#0b0b0f` or `#ffffff`, whichever has higher WCAG contrast against the effective primary (`onColor` in `services/color.ts`). Dark on Tiffany is 8.14:1; white was 2.41:1.
- **Focus** (`--color-focus`): focus rings, outlines and focus border-colour. `applyTheme()` sets it to the primary when that clears 3:1 (WCAG 1.4.11) against the theme's bg and surface-2, otherwise to the primary stepped darker (light surfaces) or lighter (dark surfaces) until it does (`focusColor` in `services/color.ts`). Tiffany on the light theme was 2.05–2.26:1, so light-theme focus is a deeper teal.

### Neutral
- **Night Floor** (`night-floor`): the page, Nowbar and tabbar background. It is also the manifest `theme_color`, so the OS chrome melts into the app.
- **Lifted Slate** (`lifted-slate`): first surface step. Used for row hover, active row, sheet buttons and cards.
- **Raised Slate** (`raised-slate`): second surface step. Used for inputs, chips, modals, tooltips and cover placeholders.
- **Hairline Grey** (`hairline-grey`): every 1px border and the off state of switches. It is deliberately bright against the dark floor, so edges read as drawn lines rather than shadows.
- **Chalk Text** (`chalk-text`): primary text, the scrub knob and the active tab.
- **Dusk Text** (`dusk-text`): secondary text (artist lines, sub-labels, idle tabs, idle icon buttons) and, at 30% opacity, the empty scrubber track.

### Semantic
- **Alarm Coral** (`alarm-coral`): destructive confirm buttons only.
- **Alarm Coral Text** (`alarm-coral-text`, CSS token `--color-danger-text`): inline error text, such as a Nowbar playback error. Light theme overrides it to #c62a47 for 4.5:1.

### Source brand chips
Source colours (`--src-netease` #c20c0c, `--src-qq` #1db954, `--src-kuwo` #ffcb1f, `--src-joox` #07827e, `--src-fivesing` #ff5959, `--src-jamendo` #ff7700) appear only as small source badges. JOOX is deliberately darkened so it never reads as the Tiffany accent.

### Theme variants
`:root[data-theme]` overrides surfaces, text and border only:
- **light**: `#f7f7fa` floor, `#ffffff` / `#ececf2` surfaces, `#80808a` hairline (3.32:1 against `#ececf2`), `#1a1a22` / `#5a5a66` text.
- **gold** (supporter): warm-black `#100c06` floor and amber `#6b5a2e` hairline, with signature primary `#d9a821`.
- **sakura** (supporter): plum-black `#120b10` floor and rose `#6e4a5a` hairline, with signature primary `#ef7fb4`.

### Named Rules
**The One Signal Rule.** Only one accent exists on a screen, and it always means "live, on, or go". Never use the accent for decoration, headings or illustration.

**The Role-Not-Hex Rule.** Components read `var(--color-primary)` and the surface tokens, never a literal colour. The user can repaint the cabinet at runtime, and a hard-coded hex is the one thing that won't follow.

## Typography

**Display Font:** Inter (falling back to system-ui / -apple-system)
**Body Font:** Inter (same stack)

**Character:** A single neutral grotesque that sets everything, so hierarchy comes only from weight and size. Inter is named first but is not bundled, so most devices render the system UI font. That is acceptable because the stack has to carry CJK, Arabic, Devanagari and Thai, and system fonts already do.

### Hierarchy
- **Display** (800, 1.5rem × `--fs-np-title`, 1.2): the Now Playing song title. Single line with ellipsis or marquee.
- **Headline** (700, 1.4rem × `--fs-title`): page titles in `PageHeader` and the search page.
- **Title** (600, 0.875rem × `--fs-title`, 1.3): list-row song titles. The Nowbar title is the same role at 700 and 0.8125rem.
- **Body** (400, 0.9rem, 1.5): modal and confirm copy, setting descriptions.
- **Label** (400, 0.75rem × `--fs-artist`, 1.3): artist sub-lines, chips, tooltips.
- **Micro** (400, 0.625rem): tabbar labels under icons.

### Named Rules
**The rem-Only Rule.** Every `font-size` is in `rem`, multiplied by its `--fs-*` variable. A px font size ignores the user's text-size setting, so never add one.

**The Clipped-Title-Moves Rule.** A title too long for its box scrolls (`use:marquee`) instead of truncating into nothing. This motion carries information, so it survives reduce-motion.

## Layout

Mobile-first single column inside a fixed shell: content scrolls between the top and a bottom stack made of the **Nowbar** (64px) on top of the **tabbar** (56px), which owns the safe-area inset. Breakpoints sit on one sm/md/lg scale: **640px** for content-width adjustments and **1024px**, where the same tabbar becomes an **88px left rail** (YouTube Music's mini-guide width). Landscape phones and iPad portrait stay on the bottom bar.

Spacing runs on a 4px base, with 8px and 12px as the working steps (row gaps, Nowbar padding 8px 12px, sheet padding 12px). **44px is the minimum touch target** for every row, icon button and input. Home shelves are cover grids with `--home-grid-cols` (default 3) columns, which the user can change.

Text size, cover size and grid column count are user-scaled (`--fs-app`, `--cover-scale`, `--home-grid-cols`), so layouts must flex rather than assume fixed dimensions.

## Elevation & Depth

Flat by default. Depth comes from three tonal steps (Night Floor, Lifted Slate, Raised Slate) and 1px Hairline Grey borders. Shadows are reserved for elements that float above the page.

### Shadow Vocabulary
- **Floating sheet** (`box-shadow: 0 -10px 40px rgba(0,0,0,0.5)`): confirm modals and bottom sheets, cast upward from the bottom edge.
- **Tooltip** (`box-shadow: 0 8px 24px rgba(0,0,0,0.35)`): the keyboard-shortcut `KeyTip` bubble.
- **Knob** (`box-shadow: 0 1px 4px rgba(0,0,0,0.4)`): the scrubber knob, so it reads as a physical bead.

The Nowbar uses a `blur(14px)` backdrop filter, and modals sit on a `rgba(0,0,0,0.45)` scrim.

### Named Rules
**The Flat-Until-It-Floats Rule.** Surfaces on the page never cast shadows. Only something that sits above the page (a sheet, tooltip or knob) gets one.

## Shapes

There are two shape families. **Things you press are round**: pill inputs, pill chips, circular play buttons, circular icon buttons (`9999px`), and round artist avatars. **Things you read are gently squared**: song covers (6px in rows, 8px in the Nowbar), rows (8px), setting cards and sheet buttons (12px), modals (16px). Album and song art is never circular; only artists are.

### Named Rules
**The Round-Means-Press Rule.** If a shape is fully round, it can be tapped. Readable content never uses a pill or a circle, except artist avatars, which are round to tell people apart from records.

## Components

Quiet at rest and springy on touch. Every pressable surface gets `use:tapBounce`, a single 0.94 press-in that springs back over 220ms. It cannot latch under a held finger and follows only the app's own Reduce Motion setting.

### Buttons
- **Shape:** circles and pills (`9999px`), or 12px for full-width sheet buttons.
- **Primary round:** a 40–44px Tiffany Signal circle with an On-Primary glyph (Nowbar play, search submit).
- **Hero play:** a 62px white circle with a black glyph, used only in Now Playing. It inverts the scheme so the main action is the brightest thing on screen.
- **Sheet buttons:** 48px tall on Lifted Slate, with a Hairline border, 600 weight and 0.95rem. The destructive variant is filled Alarm Coral.
- **Icon buttons:** 44px transparent circles in Dusk Text. On hover (hover-capable pointers only) they get Lifted Slate and Chalk Text.
- **Play/pause:** both glyphs are always rendered and stacked, then cross-dissolve and scale (0.6 to 1) over 160ms, so the button never shifts layout.

### Chips
- **Style:** pill, Raised Slate fill, Hairline border, Dusk Text, 0.75rem, 6px × 10px padding.
- **Selected:** text and border switch to Tiffany Signal while the fill stays slate.

### Cards / Containers
- **Corner Style:** 12px for setting cards and 16px for modals.
- **Background:** setting cards sit on Night Floor with a hairline, so they read as outlined. Modals use Raised Slate.
- **Shadow Strategy:** only modals and sheets get one (see the Floating sheet shadow).
- **Internal Padding:** 12–14px.

### Inputs / Fields
- **Style:** 44px pill on Raised Slate with a Hairline border, 0.9375rem text and 12px padding. A clear (×) button sits inside the right edge.
- **Focus:** the border shifts to Tiffany Signal on focus, plus a 2px Tiffany ring on `:focus-visible`.

### Navigation
- **Tabbar:** 56px on Night Floor with a hairline top. Icon over a 0.625rem label in Dusk Text, Chalk Text when active, with a 150ms colour fade. It is hidden while Now Playing is open. At 1024px and up it becomes an 88px left rail with the same markup.
- **Nowbar:** 64px bar on Night Floor above the tabbar. It shows 44px art, a title and artist (or the current lyric line), a primary round play button, and a 3px Tiffany progress line along its edge. Tapping it opens Now Playing.

### Signature components
- **Scrubber:** a 4px track (Dusk Text at 30%) with a Tiffany fill and a 12px Chalk knob. During a drag the knob grows to 1.7× and follows the finger 1:1. At rest it glides over 240ms between time updates.
- **List row (`CompactRow`):** a 44px row with 40px art (× `--cover-scale`), a 600-weight title, a muted artist line, and a trailing 44px ⋮ button. The active track gets a Lifted Slate fill.
- **Skeleton (`.sk`):** a white-at-11% block with a 1.1s shimmer sweep. The sweep survives reduce-motion because a frozen grey block looks like failed content.

## Do's and Don'ts

### Do:
- **Do** reference `var(--color-primary)` and the surface tokens. Accent and theme change at runtime.
- **Do** put text and icons on a primary fill in `var(--color-on-primary)`, never a literal `#fff`.
- **Do** draw focus indicators in `var(--color-focus)`, never `--color-primary`.
- **Do** keep 44px minimum hit targets on rows, icon buttons and inputs.
- **Do** add `use:tapBounce` to every new pressable surface.
- **Do** use the motion tokens: `--dur-quick` (160ms), `--dur-base` (240ms), `--dur-slow` (320ms), with `--ease-out-quint` for settles and `--ease-spring` for tactile snaps.
- **Do** write font sizes in `rem` multiplied by the matching `--fs-*` variable.
- **Do** gate hover styles behind `@media (hover: hover)` so touch never gets stuck hover states.
- **Do** give every cover slot a gradient fallback (`coverGradient`). A missing cover must never show a broken image.

### Don't:
- **Don't** use a second accent colour or use the accent decoratively. Source brand colours stay inside source badges.
- **Don't** put shadows on page-level surfaces. Use a tonal step or a hairline.
- **Don't** make album or song art circular. Round is for buttons, chips and artist avatars.
- **Don't** write a px font size.
- **Don't** let motion that carries information (marquee, skeleton shimmer, loading spinners) stop under reduce-motion. Everything else must stop.
