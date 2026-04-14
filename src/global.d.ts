// Type declarations for external dependencies loaded at runtime

/** PDF.js v5.x CDN module */
declare module 'https://cdn.jsdelivr.net/npm/pdfjs-dist@5.6.205/build/pdf.min.mjs' {
  export const GlobalWorkerOptions: { workerSrc: string };
  export function getDocument(src: string | PDFDocumentSource): {
    promise: Promise<PDFDocumentProxy>;
  };
}

interface PDFDocumentSource {
  data?: ArrayBuffer;
  url?: string;
  password?: string;
  cMapUrl?: string;
  cMapPacked?: boolean;
}

interface PDFDocumentProxy {
  numPages: number;
  getPage(pageNum: number): Promise<PDFPageProxy>;
  getMetadata(): Promise<{ info?: { Title?: string; Author?: string; Subject?: string } }>;
  getOutline(): Promise<PDFOutlineItem[] | null>;
  getDestination(dest: string): Promise<unknown[] | null>;
  getPageIndex(ref: unknown): Promise<number>;
}

interface PDFOutlineItem {
  title: string;
  bold?: boolean;
  italic?: boolean;
  color?: Uint8ClampedArray;
  dest: string | unknown[] | null;
  url?: string | null;
  items: PDFOutlineItem[];
}

interface PDFPageProxy {
  getViewport(params: { scale: number }): { width: number; height: number };
  render(params: { canvasContext: CanvasRenderingContext2D; viewport: { width: number; height: number } }): { promise: Promise<void> };
  getTextContent(): Promise<{ items: Array<{ str: string }> }>;
}

/** StPageFlip loaded as UMD global via <script> tag */
declare namespace St {
  class PageFlip {
    constructor(el: HTMLElement, settings: Record<string, unknown>);
    loadFromImages(hrefs: string[]): void;
    loadFromHTML(items: NodeListOf<HTMLElement> | HTMLElement[]): void;
    on(event: string, callback: (e: { data: unknown }) => void): void;
    destroy(): void;
    flipNext(): void;
    flipPrev(): void;
    turnToPage(idx: number): void;
    getCurrentPageIndex(): number;
    getOrientation(): string;
    setMouseEvents(enabled: boolean): void;
    updatePageImage(idx: number, src: string): void;
  }
}

/** GA4 / GTM global function */
declare function gtag(...args: unknown[]): void;
declare const dataLayer: Record<string, unknown>[];

/** Public viewer API */
interface PDFViewerAPI {
  load(url: string): Promise<void>;
}

interface Window {
  PDFViewer: PDFViewerAPI;
}
