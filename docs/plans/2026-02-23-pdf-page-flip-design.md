# PDF Page Flip Demo - Design Document

## Goal

Build a demo showcasing PDF page-flip animation using PDF.js + StPageFlip. Pure HTML + Vanilla JS, no build tools required.

## Tech Stack

- **PDF.js** (CDN) - PDF rendering
- **StPageFlip / page-flip** (CDN via unpkg) - Page flip animation
- **Vanilla JS** - No framework
- **No build tool** - Open in browser or `npx serve`

## Architecture

```
pages/
├── index.html          # Main page, CDN imports for PDF.js + page-flip
├── style.css           # Minimal styling
├── app.js              # Core logic: PDF render + flip integration
└── sample.pdf          # Example PDF file
```

## Flow

1. Page loads -> PDF.js loads sample.pdf
2. Get total page count from PDF
3. Render each page to offscreen Canvas -> convert to image (toDataURL)
4. Feed all page images to StPageFlip
5. User clicks/drags to flip pages

## Technical Details

- **PDF.js**: CDN from mozilla.github.io/pdf.js, use `getPage()` + `render()` to render each page to offscreen canvas
- **StPageFlip**: CDN from unpkg.com/page-flip, HTML mode, page images in div container
- **Render scale**: 1.5x for clarity without being too slow
- **Page sizing**: Auto-calculated from first page aspect ratio

## UI

- Centered book area
- Clean background
- Flip via click (left/right half) or drag
- No navigation buttons, no page numbers - just the flip effect

## Risks

- StPageFlip last updated 5 years ago, but it's pure TypeScript with zero dependencies, so browser compatibility risk is low
- PDF.js is actively maintained by Mozilla
- For a demo, both libraries are stable enough
