export interface SearchMatch {
  page: number;
  snippet: string;
  matchStart: number;
  matchEnd: number;
}

export interface PageIndex {
  page: number;
  text: string;
  lower: string;
}

const SNIPPET_RADIUS = 40;

export async function buildIndex(
  pdf: PDFDocumentProxy,
  cache: Map<number, string>,
  onProgress?: (done: number, total: number) => void
): Promise<PageIndex[]> {
  const index: PageIndex[] = [];
  const total = pdf.numPages;
  for (let p = 1; p <= total; p++) {
    let text: string | undefined = cache.get(p);
    if (text === undefined) {
      try {
        const page = await pdf.getPage(p);
        const content = await page.getTextContent();
        text = content.items.map((i: { str: string }) => i.str).join(' ');
        cache.set(p, text);
      } catch {
        text = '';
      }
    }
    const safe = text ?? '';
    index.push({ page: p, text: safe, lower: safe.toLowerCase() });
    onProgress?.(p, total);
  }
  return index;
}

export function search(index: PageIndex[], query: string, maxPerPage = 5): SearchMatch[] {
  const q = query.trim().toLowerCase();
  if (!q) return [];
  const results: SearchMatch[] = [];
  for (const entry of index) {
    let from = 0;
    let count = 0;
    while (count < maxPerPage) {
      const hit = entry.lower.indexOf(q, from);
      if (hit === -1) break;
      const start = Math.max(0, hit - SNIPPET_RADIUS);
      const end = Math.min(entry.text.length, hit + q.length + SNIPPET_RADIUS);
      results.push({
        page: entry.page,
        snippet: (start > 0 ? '…' : '') + entry.text.slice(start, end) + (end < entry.text.length ? '…' : ''),
        matchStart: hit - start + (start > 0 ? 1 : 0),
        matchEnd: hit - start + q.length + (start > 0 ? 1 : 0),
      });
      from = hit + q.length;
      count++;
    }
  }
  return results;
}
