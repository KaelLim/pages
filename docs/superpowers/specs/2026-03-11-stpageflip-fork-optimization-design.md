# StPageFlip Fork Optimization Design

## Overview

Fork StPageFlip v2.0.7 TypeScript source into `lib/st-page-flip/`, integrate 7 externally-built workarounds directly into the library, and compile locally via webpack. This eliminates costly destroy+rebuild cycles and provides native support for RTL, book edges, and dynamic option toggling.

## Current Pain Points

| # | Problem | Impact | Root Cause |
|---|---------|--------|------------|
| 1 | `destroy()` doesn't clean window listeners | Memory leaks, ghost listeners | `UI.setHandlers()` attaches to `window`, no matching cleanup |
| 2 | `useMouseEvents` constructor-only | Full rebuild on zoom toggle | `passive` option set once in `setHandlers()` |
| 3 | `showCover` constructor-only | Full rebuild on RTL toggle | PageCollection reads once at init |
| 4 | `size`/`autoSize` constructor-only | Full rebuild on single/spread toggle | Render calculates once at init |
| 5 | No native RTL | Manual page reversal + pageMap | No RTL concept in codebase |
| 6 | No native edge rendering | External DOM + position:fixed | No render hook for edges |
| 7 | Container sizing ignores padding | External pre-calculation needed | `calculateBoundsRect()` doesn't subtract padding |

## Project Structure

```
pages/
├── lib/
│   └── st-page-flip/           # Forked TypeScript source
│       ├── src/                 # Modified TS files
│       ├── dist/                # Compiled output
│       ├── webpack.config.js    # Original webpack config
│       ├── package.json
│       └── tsconfig.json
├── index.html                   # References lib/ build
├── html-book.html
├── app.js
└── ...
```

Build: `cd lib/st-page-flip && npm run build-global` outputs `dist/js/pageFlip.browser.js`.

## Modification Details

### Mod 1: Fix `destroy()` Cleanup

**Files:** `UI.ts`, `HTMLUI.ts`, `CanvasUI.ts`, `Render.ts`

- `UI.ts`: Track all window-level listener references in `setHandlers()`. Add `removeHandlers()` that calls `window.removeEventListener()` for each.
- `HTMLUI.ts` / `CanvasUI.ts`: `destroy()` calls `removeHandlers()` before DOM cleanup.
- `Render.ts`: Add `cancelAnimationFrame()` in cleanup to prevent orphaned RAF callbacks.

### Mod 2: Runtime `useMouseEvents` Toggle

**Files:** `Settings.ts`, `UI.ts`, `PageFlip.ts`

- `Settings.ts`: Add `setOption(key, value)` method for mutable settings.
- `UI.ts`: Add `updateMouseEvents(enabled)` — removes old handlers, reattaches with correct `passive` option.
- `PageFlip.ts`: Expose `setMouseEvents(enabled: boolean)` public API.

### Mod 3: Runtime `showCover` Toggle

**Files:** `PageFlip.ts`, PageCollection (inferred), `Render.ts`

- `PageFlip.ts`: Add `setShowCover(enabled: boolean)` API.
- PageCollection: Recalculate page pairing/spread logic.
- `Render.ts`: Call `reload()` to redraw with new cover state.

### Mod 4: Runtime `size` / `autoSize` Toggle

**Files:** `PageFlip.ts`, `Render.ts`, `CanvasUI.ts`, `HTMLUI.ts`

- `PageFlip.ts`: Add `setSizeMode(size, autoSize)` API.
- `Render.ts`: `reload()` reads latest settings for recalculation.
- UI classes: `update()` triggers resize.

### Mod 5: Native RTL Support

**Files:** `Settings.ts`, `PageFlip.ts`, PageCollection, `Flip.ts`

- `Settings.ts`: Add `rtl: boolean` option (default `false`).
- `PageFlip.ts`: `flipNext()`/`flipPrev()` reverse direction when RTL. Add `setRtl(enabled)` API.
- PageCollection: Reverse internal page order when RTL. Auto-calculate `showCover` based on page count parity.
- `Flip.ts`: Flip animation direction follows RTL setting.

### Mod 6: Native Edge Rendering

**Files:** `Settings.ts`, `Render.ts`, `HTMLRender.ts`, `CanvasRender.ts`

- `Settings.ts`: Add `showEdge: boolean`, `maxEdgeWidth: number` options.
- `Render.ts`: Add `drawEdges()` hook called after page rendering.
- `HTMLRender.ts`: Implement `drawEdges()` — create edge DOM elements, update width based on flip progress, apply clip-path taper and gradient texture.
- `CanvasRender.ts`: Implement `drawEdges()` — draw edges on canvas.

### Mod 7: Fix Container Sizing

**Files:** `Render.ts`, `Settings.ts`

- `Render.ts`: Subtract computed padding from `clientWidth`/`clientHeight` in bounds calculation.
- `Settings.ts`: Validate width/maxWidth consistency with container.

## Implementation Order

1. Download source, set up webpack, verify vanilla build matches CDN
2. Mod 1 (destroy cleanup) — foundation for all subsequent work
3. Mod 2 (useMouseEvents toggle) — highest rebuild cost savings
4. Mod 3 (showCover toggle)
5. Mod 4 (size/autoSize toggle)
6. Mod 7 (container sizing) — small fix, do before bigger features
7. Mod 5 (RTL) — largest scope, depends on mods 2-4 working
8. Mod 6 (edge rendering) — depends on render pipeline understanding from earlier mods
9. Update `app.js` and `html-book.js` to use new APIs, remove workarounds

## Success Criteria

- Zero `pageFlip.destroy()` + rebuild calls for zoom, RTL, single/spread toggles
- No external DOM elements for book edges
- No manual page order reversal for RTL
- No window-level listener leaks after destroy
- All existing functionality preserved (flip animation, thumbnails, sound, URL params, reflow)

## Out of Scope (for now)

- Native zoom/pan support
- Native reflow pagination
- Enhanced event API
- Mobile pinch-to-zoom
- Text selection support
