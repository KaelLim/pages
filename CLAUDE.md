# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

Dual-mode interactive document viewer with page-flip animations:
- **PDF Mode** (`index.html` + `app.js` + `style.css`) — renders PDFs via PDF.js with realistic page-turning
- **HTML Mode** (`html-book.html` + `html-book.js` + `html-book.css`) — reflows HTML content into a paginated flipbook

Both modes share the vendored **StPageFlip** library (`lib/st-page-flip/`, v2.0.7) for 3D page-flip animation.

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

No test framework, linter, or CI pipeline is configured.

## Architecture

### PDF Mode Flow

1. PDF loaded via **PDF.js** (v4.8.69, CDN) → rendered to canvas → converted to data URL
2. Pages are **lazy-rendered** on demand via StPageFlip's `renderPages` event, cached in a `Map<pageNum, dataUrl>`
3. `currentPageMap[]` maps StPageFlip indices → original PDF page numbers (essential for RTL where order is reversed)
4. Zoom >1x enables pan mode and disables StPageFlip mouse events to prevent accidental flips

### HTML Mode Flow

1. Source HTML lives in a hidden `#content-source` div
2. Nodes are cloned and distributed across page-sized divs by measuring `scrollHeight > clientHeight`
3. Font scaling via `--font-scale` CSS custom property triggers full re-pagination and StPageFlip rebuild
4. Interactive elements (buttons, inputs) use `stopPropagation` on mousedown/touchstart to avoid triggering flips

### RTL Support (PDF Mode)

- Page array is reversed: `pageNums.reverse()`
- Navigation is inverted: `flipNext()` calls `pageFlip.flipPrev()`
- Dynamic `showCover`: `rtl ? (totalPages % 2 === 0) : true` — ensures P1 always displays alone

### External PDF Loading

Query param `?src=<url>` loads remote PDFs. Falls back to CORS proxy (`corsproxy.io`) if direct fetch fails.

## Key Dependencies (all loaded at runtime, no npm install at root)

| Library | Source | Used By |
|---------|--------|---------|
| PDF.js 4.8.69 | jsdelivr CDN | `app.js` |
| StPageFlip 2.0.7 | `lib/st-page-flip/` (vendored) | Both modes |
| Material Symbols | Google Fonts CDN | PDF mode icons |

## Notable Design Decisions

- **No bundler** — vanilla JS with ES modules (PDF mode) and UMD (StPageFlip)
- **Page edge visualization** simulates book spine thickness using repeating gradients + box-shadow, width reflects reading progress
- **Zoom architecture** splits into two regimes: <1x scales the book container, >1x enables drag-to-pan
- **Resize handling** recalculates dimensions with 200ms debounce, preserving current page position
- **Page-flip sound** throttled to 500ms minimum interval
