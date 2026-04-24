// Feature-detect browser capability, pick the newest PDF.js line it can run,
// and load the library + worker at runtime. Falls back v5 → v4 → v3 → v3 legacy.

export type PdfJsLine = 'v5' | 'v4' | 'v3' | 'v3-legacy';

export interface PdfJsSelection {
  line: PdfJsLine;
  version: string;
  libUrl: string;
  workerUrl: string;
  cMapUrl: string;
  /** true = ES module (use `import()`); false = UMD (use `<script>` + global). */
  esm: boolean;
}

export interface PdfJsApi {
  GlobalWorkerOptions: { workerSrc: string };
  getDocument(src: string | PDFDocumentSource): { promise: Promise<PDFDocumentProxy> };
}

export interface PdfJsHandle {
  lib: PdfJsApi;
  cMapUrl: string;
  version: string;
  line: PdfJsLine;
}

const CDN = 'https://cdn.jsdelivr.net/npm/pdfjs-dist';

const V5 = '5.6.205';
const V4 = '4.10.38';
const V3 = '3.11.174';

export function pickPdfJsVersion(): PdfJsSelection {
  if ('setFromBase64' in Uint8Array.prototype) {
    return esm(V5, 'v5');
  }
  if (
    typeof structuredClone === 'function'
    && 'findLast' in Array.prototype
    && typeof Object.hasOwn === 'function'
  ) {
    return esm(V4, 'v4');
  }
  if ('at' in Array.prototype && typeof Promise.allSettled === 'function') {
    return umd(V3, 'v3', false);
  }
  return umd(V3, 'v3-legacy', true);
}

function esm(version: string, line: PdfJsLine): PdfJsSelection {
  return {
    line,
    version,
    libUrl: `${CDN}@${version}/build/pdf.min.mjs`,
    workerUrl: `${CDN}@${version}/build/pdf.worker.min.mjs`,
    cMapUrl: `${CDN}@${version}/cmaps/`,
    esm: true,
  };
}

function umd(version: string, line: PdfJsLine, legacy: boolean): PdfJsSelection {
  const prefix = legacy ? 'legacy/build' : 'build';
  return {
    line,
    version,
    libUrl: `${CDN}@${version}/${prefix}/pdf.min.js`,
    workerUrl: `${CDN}@${version}/${prefix}/pdf.worker.min.js`,
    cMapUrl: `${CDN}@${version}/cmaps/`,
    esm: false,
  };
}

function loadScript(url: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const s = document.createElement('script');
    s.src = url;
    s.onload = () => resolve();
    s.onerror = () => reject(new Error(`failed to load ${url}`));
    document.head.appendChild(s);
  });
}

export async function loadPdfJs(): Promise<PdfJsHandle> {
  const sel = pickPdfJsVersion();
  let lib: PdfJsApi;

  if (sel.esm) {
    const mod = await import(/* @vite-ignore */ sel.libUrl);
    lib = mod as unknown as PdfJsApi;
  } else {
    await loadScript(sel.libUrl);
    const g = (globalThis as unknown as { pdfjsLib?: PdfJsApi }).pdfjsLib;
    if (!g) throw new Error(`pdfjsLib global missing after loading ${sel.libUrl}`);
    lib = g;
  }

  lib.GlobalWorkerOptions.workerSrc = sel.workerUrl;
  return { lib, cMapUrl: sel.cMapUrl, version: sel.version, line: sel.line };
}
