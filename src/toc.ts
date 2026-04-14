/**
 * Table of contents extraction from PDF outline.
 * Uses PDF.js pdf.getOutline() + getDestination() + getPageIndex()
 * to produce a tree of navigable chapter entries.
 */

export interface TocItem {
  title: string;
  page: number;           // 1-based real page number
  depth: number;          // 0 = top level
  children: TocItem[];
}

/**
 * Extract and resolve the full TOC from a PDF document.
 * @returns null if the PDF has no outline (scanned docs, simple reports)
 */
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
        if (!dest || !Array.isArray(dest) || dest.length === 0) continue;

        const pageIndex = await pdf.getPageIndex(dest[0]);
        result.push({
          title: item.title,
          page: pageIndex + 1,
          depth,
          children: item.items ? await walk(item.items, depth + 1) : [],
        });
      } catch {
        // Unresolvable destination — skip this item, continue with siblings
      }
    }
    return result;
  }

  const tree = await walk(outline, 0);
  return tree.length > 0 ? tree : null;
}

/**
 * Flatten a TOC tree into a depth-first list, preserving depth metadata
 * so the renderer can apply correct indentation and aria-level.
 */
export function flattenToc(items: TocItem[]): TocItem[] {
  const result: TocItem[] = [];
  (function visit(list: TocItem[]): void {
    for (const item of list) {
      result.push(item);
      visit(item.children);
    }
  })(items);
  return result;
}

/**
 * Compute sibling positions for ARIA aria-posinset / aria-setsize.
 * Returns a map from TocItem → { posInSet, setSize }.
 */
export function computeSiblingIndex(items: TocItem[]): Map<TocItem, { pos: number; size: number }> {
  const map = new Map<TocItem, { pos: number; size: number }>();
  (function visit(list: TocItem[]): void {
    list.forEach((item, i) => {
      map.set(item, { pos: i + 1, size: list.length });
      visit(item.children);
    });
  })(items);
  return map;
}
