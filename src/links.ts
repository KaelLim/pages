export interface LinkInfo {
  page: number;
  xRatio: number;
  yRatio: number;
  wRatio: number;
  hRatio: number;
  url?: string;
  dest?: string | unknown[] | null;
}

export async function extractLinks(
  pdf: PDFDocumentProxy,
  pageNum: number
): Promise<LinkInfo[]> {
  const page = await pdf.getPage(pageNum);
  const viewport = page.getViewport({ scale: 1 });
  const vw = viewport.width;
  const vh = viewport.height;
  const annots = await page.getAnnotations();
  const links: LinkInfo[] = [];
  for (const a of annots) {
    if (a.subtype !== 'Link') continue;
    const [x1, y1, x2, y2] = a.rect;
    const xMin = Math.min(x1, x2);
    const xMax = Math.max(x1, x2);
    const yMin = Math.min(y1, y2);
    const yMax = Math.max(y1, y2);
    const info: LinkInfo = {
      page: pageNum,
      xRatio: xMin / vw,
      yRatio: (vh - yMax) / vh,
      wRatio: (xMax - xMin) / vw,
      hRatio: (yMax - yMin) / vh,
    };
    if (a.url) info.url = a.url;
    if (a.dest !== undefined) info.dest = a.dest;
    links.push(info);
  }
  return links;
}

export async function resolveDestPage(
  pdf: PDFDocumentProxy,
  dest: string | unknown[] | null | undefined
): Promise<number | null> {
  if (!dest) return null;
  try {
    const resolved = typeof dest === 'string'
      ? await pdf.getDestination(dest)
      : dest;
    if (!resolved || !Array.isArray(resolved) || resolved.length === 0) return null;
    const ref = resolved[0];
    const idx = await pdf.getPageIndex(ref);
    return idx + 1;
  } catch {
    return null;
  }
}
