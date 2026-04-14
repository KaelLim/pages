# TOC (Table of Contents) Feature Design

**Date:** 2026-04-14
**Status:** Approved, ready for implementation
**Goal:** Extract PDF outline and present as a navigable overlay so readers can jump directly to chapters.

---

## Architecture

### Data Flow

```
PDF loaded
     ↓
pdf.getOutline() → PDFOutlineItem[]
     ↓
  empty or null? ─── yes ─→ Hide TOC button (end)
     ↓ no
  Recursively resolve each item's dest → page index
     ↓
  Build TocItem[] tree with depth
     ↓
  Show TOC button + wire overlay
```

### Source of Truth

Only the PDF's built-in outline (`pdf.getOutline()`). Scanned PDFs or documents without outlines show no TOC button. No text-extraction fallback (YAGNI).

### Module Split

- **`src/toc.ts`** — new file. Pure logic: extract, resolve destinations, flatten tree.
- **`src/app.ts`** — integration only: call `extractToc`, wire UI events, GA4 tracking.
- **`src/global.d.ts`** — add outline-related PDF.js types.
- **`index.html`** — add TOC button and overlay markup.
- **`style.css`** — TOC overlay styles (extends existing `thumbnail-overlay` pattern).

---

## UI / UX

### Toolbar Button

Placed next to `btn-thumbnail`. Hidden by default, revealed only if outline exists:

```html
<button id="btn-toc" class="hidden" title="Table of contents"
        aria-label="Show table of contents">
  <span class="material-symbols-rounded" aria-hidden="true">list</span>
</button>
```

### Overlay Layout

Full-screen overlay, matches existing `thumbnail-overlay` visual style.

```
┌──────────────────────────────────┐
│ Contents                    ✕    │
├──────────────────────────────────┤
│ Preface                  3       │
│ Chapter 1 Charity        5       │
│   1.1 Visits             6       │  ← indented child
│   1.2 Relief             9       │
│ Chapter 2 Environment    15      │  ← current page highlighted
└──────────────────────────────────┘
```

### Interactions

| Event | Action |
|---|---|
| Click TOC button | Open overlay; auto-scroll to current section; focus first item |
| Click chapter | `turnToPage` + close overlay + return focus to TOC button |
| Press Escape | Close overlay + return focus to TOC button |
| Arrow Up/Down | Move focus between items |
| Home / End | Focus first / last item |

### Visual Details

- Semi-transparent dark background (`rgba(10, 10, 20, 0.95)`) matching thumbnail-overlay
- Child items indented `padding-left: 20 + depth * 20`
- Titles truncated with ellipsis; page numbers right-aligned via flex
- Current section highlighted `color: #6c9bff` and light blue background tint

---

## Implementation

### New file: `src/toc.ts`

```typescript
export interface TocItem {
  title: string;
  page: number;            // 1-based real page number
  children: TocItem[];
  depth: number;
}

export async function extractToc(pdf: PDFDocumentProxy): Promise<TocItem[] | null> {
  const outline = await pdf.getOutline();
  if (!outline || outline.length === 0) return null;

  async function walk(items: PDFOutlineItem[], depth: number): Promise<TocItem[]> {
    const result: TocItem[] = [];
    for (const item of items) {
      try {
        const dest = typeof item.dest === 'string'
          ? await pdf.getDestination(item.dest)
          : item.dest;
        if (!dest) continue;

        const pageIndex = await pdf.getPageIndex(dest[0]);
        result.push({
          title: item.title,
          page: pageIndex + 1,
          depth,
          children: item.items ? await walk(item.items, depth + 1) : [],
        });
      } catch {
        /* Skip items with unresolvable destinations */
      }
    }
    return result;
  }

  return walk(outline, 0);
}

export function flattenToc(items: TocItem[]): TocItem[] {
  const result: TocItem[] = [];
  (function visit(list: TocItem[]) {
    for (const item of list) {
      result.push(item);
      visit(item.children);
    }
  })(items);
  return result;
}
```

### `app.ts` integration

After PDF loaded:

```typescript
import { extractToc, flattenToc } from './toc.js';

const tocTree = await extractToc(pdf);
if (tocTree) {
  const btnToc = document.getElementById('btn-toc')!;
  btnToc.classList.remove('hidden');
  buildTocUI(flattenToc(tocTree));
  wireTocEvents();
}
```

`buildTocUI` creates `<button>` rows with title span + page span. `wireTocEvents` sets up open/close, click-to-navigate, keyboard navigation, and GA4 tracking.

### Type additions (`src/global.d.ts`)

```typescript
interface PDFDocumentProxy {
  getOutline(): Promise<PDFOutlineItem[] | null>;
  getDestination(dest: string): Promise<unknown[] | null>;
  getPageIndex(ref: unknown): Promise<number>;
}

interface PDFOutlineItem {
  title: string;
  dest: string | unknown[] | null;
  items: PDFOutlineItem[];
}
```

---

## ISO/IEC 40500 (WCAG 2.1) Compliance

### ARIA Attributes

| Element | Attribute | Value |
|---|---|---|
| `#toc-overlay` | `role` | `dialog` |
| | `aria-modal` | `true` |
| | `aria-labelledby` | `toc-header-title` |
| `#toc-list` | `role` | `tree` |
| `.toc-item` | `role` | `treeitem` |
| | `aria-level` | `depth + 1` |
| | `aria-posinset` | position among siblings |
| | `aria-setsize` | total siblings |
| | `aria-current` | `"page"` on section matching current page |
| `.toc-page` | `aria-label` | `"Page ${page}"` |

### Keyboard Navigation

- **Arrow Up / Down:** move focus between items
- **Home / End:** focus first / last item
- **Enter:** jump to section (native button behavior)
- **Escape:** close overlay, return focus to TOC button

### Screen Reader Support

- Title and page number are separate spans so the reader announces them in order
- `aria-current="page"` marks the current chapter — NVDA/JAWS read "current page"
- Focus trap: Tab cycles within the overlay while open
- Focus returns to the trigger button on close

---

## Edge Cases

| Case | Handling |
|---|---|
| Outline exists but destination fails to resolve | `try/catch` around each item; skip failed ones |
| Outline depth > 3 levels | Render with indent, capped visually to prevent overflow |
| Very long chapter titles | CSS ellipsis; native `title` attribute for full text on hover |
| RTL mode | `currentPageMap.indexOf(page)` already handles reversal |
| Overlay opened mid-flip-animation | `turnToPage` queues correctly after animation |
| Outline is empty array (not null) | `outline.length === 0` check covers this |
| Multiple sections point to same dest | Allowed — render both (legal per PDF spec) |
| Title contains HTML characters | `textContent` used (never `innerHTML`) — auto-escaped |

---

## GA4 Events

Uses existing `trackEvent` helper and `viewerConfig.analytics.trackNavigation` flag:

```typescript
if (viewerConfig.analytics?.trackNavigation) {
  trackEvent('navigate', { action: 'toc_open' });
  trackEvent('navigate', { action: 'toc_jump', page });
}
```

---

## Testing Checklist

| Test | Verification |
|---|---|
| PDF with outline | Button appears, overlay opens |
| PDF without outline | Button hidden |
| Click section | `turnToPage` fires, overlay closes |
| Nested chapters | Visible indentation per depth |
| Escape closes | Focus returns to TOC button |
| Arrow keys navigate | Up/Down moves focus |
| Screen reader (NVDA) | Reads title, page, level correctly |
| Mobile touch | Scrollable, tappable |
| RTL mode | Jumps to correct page |
| GA4 fires | `navigate` events recorded |

---

## Success Criteria

1. TOC button appears only when outline exists
2. Overlay matches visual style of thumbnail-overlay
3. Keyboard-only navigation fully functional
4. Screen reader announces chapter titles, page numbers, and current section
5. Click/tap jumps to correct page (including RTL mode)
6. No layout regression on mobile viewports
7. GA4 `navigate` events recorded when `trackNavigation` is enabled
