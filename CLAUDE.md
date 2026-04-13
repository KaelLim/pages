# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

Dual-mode interactive document viewer with page-flip animations:
- **PDF Mode** (`index.html` + `app.js` + `style.css`) — renders PDFs via PDF.js with realistic page-turning
- **HTML Mode** (`html-book.html` + `html-book.js` + `html-book.css`) — reflows HTML content into a paginated flipbook

Both modes share the vendored **StPageFlip** library (`lib/st-page-flip/`, forked v3.0.0) for Canvas 2D page-flip animation with mesh-based page curl.

## Development

No build step required. Serve the root directory with any static HTTP server:

```bash
python3 -m http.server 8000
# or
npx serve .
```

If modifying the StPageFlip library source (`lib/st-page-flip/src/`):

```bash
cd lib/st-page-flip && npm install && npm run build
```

The build uses Rollup + TypeScript 6 and outputs to `dist/js/page-flip.browser.js` (UMD) and `dist/js/page-flip.module.js` (ESM). After building, the dist files must be committed — they are loaded directly by the viewer at runtime.

No test framework, linter, or CI pipeline is configured.

## Architecture

### PDF Mode Flow

1. PDF loaded via **PDF.js** (v4.8.69, CDN) → rendered to canvas → converted to data URL
2. `loadFromImages(imageHrefs)` initializes StPageFlip with placeholder images
3. Pages are **lazy-rendered** on demand via StPageFlip's `renderPages` event, cached in a `Map<pageNum, dataUrl>`, then hot-swapped via `updatePageImage(idx, dataUrl)`
4. `currentPageMap[]` maps StPageFlip indices → original PDF page numbers (essential for RTL where order is reversed)
5. Zoom >1x enables pan mode and disables StPageFlip mouse events via `setMouseEvents(false)` to prevent accidental flips

### HTML Mode Flow

1. Source HTML lives in a hidden `#content-source` div
2. Nodes are cloned and distributed across page-sized divs by measuring `scrollHeight > clientHeight`
3. Font scaling via `--font-scale` CSS custom property triggers full re-pagination and StPageFlip rebuild
4. Interactive elements (buttons, inputs) use `stopPropagation` on mousedown/touchstart to avoid triggering flips

### StPageFlip Fork Architecture (`lib/st-page-flip/src/`)

The fork adds several features on top of the original StPageFlip v2.0.7:

- **Canvas page curl** — `CurlCalculation.ts` computes bezier fold curves and mesh strip geometry from `FlipCalculation`'s angle/position output. `ImagePage.drawCurled()` renders the page as deformed mesh strips with per-strip lighting. `CanvasRender` adds curl-aware shadow gradients.
- **Lazy loading** — `renderPages` event emits page indices that need rendering; consumer provides images asynchronously via `updatePageImage()`. Controlled by `preloadRange` setting.
- **Edge rendering** — 3D book spine effect in `CanvasRender.drawBookEdge()`, width reflects reading progress. Toggled via `showEdge` setting.
- **RTL** — native `rtl` setting reverses page order and navigation at the collection level.
- **Single-page toggle** — `forceSinglePage` setting + `usePortrait` auto-switches in narrow viewports.

Key settings added to the fork: `showEdge`, `edgeWidth`, `preloadRange`, `forceSinglePage`, `curlIntensity`, `meshStripCount`, `canvasBgColor`.

### RTL Support (PDF Mode)

- Page array is reversed: `pageNums.reverse()`
- Navigation is inverted: `flipNext()` calls `pageFlip.flipPrev()`

### External PDF Loading

Query param `?src=<url>` loads remote PDFs. Falls back to CORS proxy (`corsproxy.io`) if direct fetch fails.

## Key Dependencies (all loaded at runtime, no npm install at root)

| Library | Source | Used By |
|---------|--------|---------|
| PDF.js 4.8.69 | jsdelivr CDN | `app.js` |
| StPageFlip 3.0.0 | `lib/st-page-flip/` (vendored fork) | Both modes |
| Material Symbols | Google Fonts CDN | PDF mode icons |

## Notable Design Decisions

- **No bundler** — vanilla JS with ES modules (PDF mode) and UMD (StPageFlip)
- **Page edge visualization** simulates book spine thickness using repeating gradients + box-shadow, width reflects reading progress
- **Zoom architecture** splits into two regimes: <1x scales the book container, >1x enables drag-to-pan
- **Resize handling** recalculates dimensions with 200ms debounce, preserving current page position
- **Page-flip sound** throttled to 500ms minimum interval
- **Canvas-only rendering for PDF mode** — uses `loadFromImages` (not `loadFromHTML`) for better performance with lazy loading
