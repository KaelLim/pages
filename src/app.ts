import * as pdfjsLib from 'https://cdn.jsdelivr.net/npm/pdfjs-dist@5.6.205/build/pdf.min.mjs';
import { extractToc, flattenToc, computeSiblingIndex, type TocItem } from './toc.js';
import { getCachedPage, setCachedPage, buildCacheKey, evictStaleCache } from './cache.js';

// Configure PDF.js worker
pdfjsLib.GlobalWorkerOptions.workerSrc =
  'https://cdn.jsdelivr.net/npm/pdfjs-dist@5.6.205/build/pdf.worker.min.mjs';

// PDF render scale: must be >= canvas buffer DPR (2x) to avoid upscaling blur.
// 3x ensures source image covers 2x canvas buffer at typical page widths.
const RENDER_SCALE = 3;

// Feature-detect WebP support once at startup.
// WebP saves ~30-50% bandwidth/memory vs PNG with same visual quality.
const SUPPORTS_WEBP: boolean = (() => {
  try {
    const c = document.createElement('canvas');
    c.width = c.height = 1;
    return c.toDataURL('image/webp').startsWith('data:image/webp');
  } catch {
    return false;
  }
})();
const DEFAULT_PDF = './sample.pdf';
const CORS_PROXY = 'https://corsproxy.io/?url=';

// ── GA4 / GTM Analytics ──

interface ViewerAnalyticsConfig {
  trackPageFlip?: boolean;
  trackZoom?: boolean;
  trackNavigation?: boolean;
  trackShare?: boolean;
  trackFullscreen?: boolean;
  trackReadingTime?: boolean;
}

interface ViewerConfig {
  pdf?: string;
  analytics?: ViewerAnalyticsConfig;
}

function loadViewerConfig(): ViewerConfig {
  const el = document.getElementById('viewer-config');
  if (el?.textContent) {
    try { return JSON.parse(el.textContent) as ViewerConfig; }
    catch { /* invalid JSON, use defaults */ }
  }
  return {};
}

const viewerConfig = loadViewerConfig();

/** Send GA4 event (no-op if gtag not loaded) */
function trackEvent(name: string, params?: Record<string, unknown>): void {
  if (typeof gtag === 'function') {
    gtag('event', name, params);
  }
}

// Page flip sound effect
let soundEnabled = true;
const flipSound = (() => {
  const audio = new Audio('./page-flip.mp3');
  audio.volume = 0.5;
  return function play(): void {
    if (!soundEnabled) return;
    audio.currentTime = 0;
    audio.play().catch(() => {});
  };
})();

/** Safely update a Material Symbols icon button (avoids innerHTML for CSP/XSS safety) */
function setIconText(btn: Element, iconName: string): void {
  const span = btn.querySelector('.material-symbols-rounded');
  if (span) {
    span.textContent = iconName;
  }
}

interface PageRenderResult {
  dataUrl: string;
  width: number;
  height: number;
}

async function renderPageToImage(pdf: PDFDocumentProxy, pageNum: number): Promise<PageRenderResult> {
  const page = await pdf.getPage(pageNum);
  const viewport = page.getViewport({ scale: RENDER_SCALE });

  const canvas = document.createElement('canvas');
  canvas.width = viewport.width;
  canvas.height = viewport.height;

  // Use Display P3 color space when available (ISO 12639 color management)
  const ctx = (canvas.getContext('2d', { colorSpace: 'display-p3' } as CanvasRenderingContext2DSettings)
    || canvas.getContext('2d'))!;
  await page.render({ canvasContext: ctx, viewport }).promise;

  return {
    // Use WebP at 92% quality when supported — visually identical, ~30-50% smaller.
    dataUrl: SUPPORTS_WEBP
      ? canvas.toDataURL('image/webp', 0.92)
      : canvas.toDataURL('image/png'),
    width: viewport.width,
    height: viewport.height,
  };
}

/**
 * Render a page with IndexedDB cache lookup.
 * Falls through to renderPageToImage on miss and stores result.
 */
async function renderPageCached(
  pdf: PDFDocumentProxy,
  pageNum: number,
  pdfUrl: string
): Promise<PageRenderResult> {
  const key = buildCacheKey(pdfUrl, pageNum, RENDER_SCALE);
  const cached = await getCachedPage(key);
  if (cached) {
    // Derive dimensions from the PDF page without full render
    const page = await pdf.getPage(pageNum);
    const vp = page.getViewport({ scale: RENDER_SCALE });
    return { dataUrl: cached, width: vp.width, height: vp.height };
  }
  const result = await renderPageToImage(pdf, pageNum);
  void setCachedPage(key, result.dataUrl);
  return result;
}

// Prompt user for PDF password (ISO 32000 encryption support)
function promptPdfPassword(): Promise<string> {
  return new Promise((resolve, reject) => {
    const overlay = document.getElementById('password-overlay')!;
    const input = document.getElementById('pdf-password') as HTMLInputElement;
    const errorEl = document.getElementById('password-error')!;
    const btnOk = document.getElementById('btn-password-ok')!;
    const btnCancel = document.getElementById('btn-password-cancel')!;

    overlay.classList.remove('hidden');
    errorEl.classList.add('hidden');
    input.value = '';
    input.focus();

    function cleanup(): void {
      overlay.classList.add('hidden');
      btnOk.removeEventListener('click', onOk);
      btnCancel.removeEventListener('click', onCancel);
      input.removeEventListener('keydown', onKey);
    }
    function onOk(): void { const pw = input.value; input.value = ''; cleanup(); resolve(pw); }
    function onCancel(): void { input.value = ''; cleanup(); reject(new Error('Password entry cancelled')); }
    function onKey(e: KeyboardEvent): void { if (e.key === 'Enter') onOk(); else if (e.key === 'Escape') onCancel(); }

    btnOk.addEventListener('click', onOk);
    btnCancel.addEventListener('click', onCancel);
    input.addEventListener('keydown', onKey);
  });
}

async function init(pdfUrl: string = DEFAULT_PDF): Promise<void> {
  const loadingEl = document.getElementById('loading')!;
  let bookEl = document.getElementById('book')!;

  // Background cache housekeeping (non-blocking)
  void evictStaleCache();

  try {
    // 1. Load PDF. PDF.js streams via HTTP range requests (only downloads
    //    what each page needs). CORS-blocked URLs fall back to proxy fetch.
    loadingEl.textContent = 'Loading PDF...';

    const commonParams = {
      cMapUrl: 'https://cdn.jsdelivr.net/npm/pdfjs-dist@5.6.205/cmaps/',
      cMapPacked: true,
      rangeChunkSize: 65536,
      disableStream: false,
      disableAutoFetch: false,
      disableRange: false,
    };

    // Load PDF with password prompt loop on PasswordException.
    // `loader` is called each time (allows retrying with a password).
    async function loadPdfWithPassword(
      loader: (password?: string) => PDFDocumentSource
    ): Promise<PDFDocumentProxy> {
      let password: string | undefined;
      let shownPasswordUi = false;
      while (true) {
        try {
          const result = await pdfjsLib.getDocument(loader(password)).promise;
          if (shownPasswordUi) {
            trackEvent('pdf_password_entered', { success: true });
            loadingEl.classList.remove('hidden');
          }
          return result;
        } catch (err: unknown) {
          if (err instanceof Error && err.name === 'PasswordException') {
            if (!shownPasswordUi) {
              loadingEl.classList.add('hidden');
              shownPasswordUi = true;
            } else {
              document.getElementById('password-error')!.classList.remove('hidden');
              trackEvent('pdf_password_entered', { success: false });
            }
            password = await promptPdfPassword();
          } else {
            if (shownPasswordUi) loadingEl.classList.remove('hidden');
            throw err;
          }
        }
      }
    }

    let pdf: PDFDocumentProxy;
    try {
      // Try streaming load with range requests
      pdf = await loadPdfWithPassword((password) => ({
        url: pdfUrl,
        password,
        ...commonParams,
      }));
    } catch (directErr) {
      if (!pdfUrl.startsWith('http')) throw directErr;

      // CORS fallback: full download via third-party proxy (range requests lost)
      const proxyHost = new URL(CORS_PROXY).hostname;
      const consent = confirm(
        `Cannot load PDF directly (blocked by CORS).\n\n` +
        `Retry through a third-party proxy (${proxyHost})?\n` +
        `The PDF URL will be sent to this service.`
      );
      if (!consent) throw new Error('PDF loading cancelled by user');

      loadingEl.textContent = 'Loading via CORS proxy...';
      const proxyUrl = `${CORS_PROXY}${encodeURIComponent(pdfUrl)}`;
      const res = await fetch(proxyUrl);
      if (!res.ok) throw new Error('Failed to load PDF via proxy');
      const data = await res.arrayBuffer();
      pdf = await loadPdfWithPassword((password) => ({
        data,
        password,
        ...commonParams,
      }));
    }
    const numPages = pdf.numPages;

    // 1b. Extract PDF metadata (ISO 32000 — XMP/Document Info)
    try {
      const meta = await pdf.getMetadata();
      if (meta?.info?.Title) {
        document.title = meta.info.Title;
        document.querySelector('#book')?.setAttribute('aria-label',
          `PDF document: ${meta.info.Title}, use arrow keys to navigate pages`);
      }
    } catch { /* metadata optional */ }

    // 1c. Extract table of contents (PDF outline)
    const tocTree = await extractToc(pdf).catch(() => null);

    // 2. Render only the first page to get dimensions
    loadingEl.textContent = 'Rendering...';
    const firstPage = await renderPageCached(pdf, 1, pdfUrl);
    const pageWidth = Math.round(firstPage.width);
    const pageHeight = Math.round(firstPage.height);

    // Page render cache: index → dataUrl (1-based)
    const renderedPages = new Map<number, string>();
    renderedPages.set(1, firstPage.dataUrl);

    let isRtl = false;
    let pageFlip: St.PageFlip | null = null;
    let currentPageMap: number[] = [];
    let lastSoundTime = 0;

    // Reading time tracking: accumulate dwell time per page
    let currentPageEnterTime = Date.now();
    let currentPageForTiming = 0;

    function flushReadingTime(): void {
      if (!viewerConfig.analytics?.trackReadingTime) return;
      if (!currentPageForTiming) return;
      const dwellMs = Date.now() - currentPageEnterTime;
      // Only send if dwell > 1 second (ignore rapid flipping)
      if (dwellMs >= 1000) {
        trackEvent('page_view_time', {
          page: currentPageForTiming,
          dwell_ms: dwellMs,
          dwell_sec: Math.round(dwellMs / 1000),
        });
      }
    }

    // Flush on page hide (user switches tab / closes)
    document.addEventListener('visibilitychange', () => {
      if (document.hidden) flushReadingTime();
    });
    window.addEventListener('pagehide', flushReadingTime);

    // Accessible text layer (ISO 32000 text extraction + WCAG screen reader support)
    const textLayerEl = document.getElementById('pdf-text-layer')!;
    const textCache = new Map<number, string>();

    async function extractPageText(pageNum: number): Promise<string> {
      const cached = textCache.get(pageNum);
      if (cached !== undefined) return cached;
      try {
        const page = await pdf.getPage(pageNum);
        const content = await page.getTextContent();
        const text = content.items.map((item) => item.str).join(' ');
        textCache.set(pageNum, text);
        return text;
      } catch {
        return '';
      }
    }

    async function updateTextLayer(): Promise<void> {
      if (!pageFlip) return;
      const idx = pageFlip.getCurrentPageIndex();
      const visiblePages: number[] = [currentPageMap[idx]!];
      const isPortrait = pageFlip.getOrientation() === 'portrait';
      if (!isPortrait && idx + 1 < currentPageMap.length) {
        visiblePages.push(currentPageMap[idx + 1]!);
      }

      const texts = await Promise.all(
        visiblePages.filter(Boolean).map(async (num) => {
          const t = await extractPageText(num);
          return t ? `Page ${num}: ${t}` : '';
        })
      );
      textLayerEl.textContent = texts.filter(Boolean).join(' | ');
    }

    // Build page image array and init StPageFlip (Canvas mode)
    function buildBook(rtl: boolean, targetOriginalPage?: number, mouseEvents = true): void {
      // Destroy old instance to remove window-level event listeners
      const parentEl = bookEl.parentNode;
      if (pageFlip) {
        try { pageFlip.destroy(); } catch { /* ignore */ }
      }

      // Replace the container entirely to avoid stale state
      const newBookEl = document.createElement('div');
      newBookEl.id = 'book';
      if (bookEl.parentNode) {
        bookEl.parentNode.replaceChild(newBookEl, bookEl);
      } else {
        parentEl!.appendChild(newBookEl);
      }
      bookEl = newBookEl;

      // Build page order (RTL = reversed)
      const pageNums: number[] = [];
      for (let i = 1; i <= numPages; i++) pageNums.push(i);
      if (rtl) pageNums.reverse();

      currentPageMap = [...pageNums];
      const totalBookPages = currentPageMap.length;

      // Create image URL array — use cached renders or transparent placeholder
      const placeholder = 'data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7';
      const imageHrefs = currentPageMap.map(num =>
        renderedPages.get(num) ?? placeholder
      );

      pageFlip = new St.PageFlip(bookEl, {
        width: pageWidth,
        height: pageHeight,
        size: 'stretch',
        minWidth: 250,
        maxWidth: pageWidth,
        minHeight: Math.round(250 * (pageHeight / pageWidth)),
        maxHeight: pageHeight,
        flippingTime: 450,
        maxShadowOpacity: 0.3,
        showCover: false,
        mobileScrollSupport: false,
        autoSize: true,
        usePortrait: true,
        useMouseEvents: mouseEvents,
        showEdge: true,
        preloadRange: 3,
        startPage: 0,
        curlIntensity: 0.5,
        meshStripCount: 150,
        canvasBgColor: 'transparent',
      });

      // Lazy render: load PDF pages on demand via canvas API
      pageFlip.on('renderPages', async (e) => {
        const indices = e.data as number[];
        for (const idx of indices) {
          if (idx < 0 || idx >= currentPageMap.length) continue;
          const originalPage = currentPageMap[idx]!;
          if (!originalPage) continue;
          if (renderedPages.has(originalPage)) {
            pageFlip!.updatePageImage(idx, renderedPages.get(originalPage)!);
            continue;
          }
          const pageData = await renderPageCached(pdf, originalPage, pdfUrl);
          renderedPages.set(originalPage, pageData.dataUrl);
          pageFlip!.updatePageImage(idx, pageData.dataUrl);
        }
      });

      pageFlip.loadFromImages(imageHrefs);

      if (targetOriginalPage !== undefined) {
        const realIdx = currentPageMap.indexOf(targetOriginalPage);
        if (realIdx >= 0) pageFlip.turnToPage(realIdx);
      } else {
        pageFlip.turnToPage(rtl ? totalBookPages - 1 : 0);
      }

      pageFlip.on('flip', () => {
        const now = Date.now();
        if (now - lastSoundTime > 500) {
          flipSound();
          lastSoundTime = now;
        }
        updatePageInfo();
        updateTextLayer();

        // Persist last reading position per PDF URL
        try { localStorage.setItem(lastPageKey, String(getOriginalPage())); }
        catch { /* storage quota / private mode — non-fatal */ }

        // Reading time: flush previous page dwell, start timer for new page
        flushReadingTime();
        currentPageForTiming = getOriginalPage();
        currentPageEnterTime = Date.now();

        // GA4: page flip
        if (viewerConfig.analytics?.trackPageFlip) {
          trackEvent('page_flip', { page: getOriginalPage(), total: numPages });
        }
      });

      // Initialize timer for starting page
      currentPageForTiming = getOriginalPage();
      currentPageEnterTime = Date.now();
    }

    let resizeTimer: ReturnType<typeof setTimeout>;
    window.addEventListener('resize', () => {
      loadingEl.textContent = 'Resizing...';
      loadingEl.classList.remove('hidden');
      clearTimeout(resizeTimer);
      resizeTimer = setTimeout(() => {
        const currentOriginalPage = getOriginalPage();
        zoomLevel = 1; panX = 0; panY = 0;
        buildBook(isRtl, currentOriginalPage);
        applyZoom();
        updatePageInfo();
        loadingEl.classList.add('hidden');
      }, 200);
    });

    // 4. Build initial book (LTR), optionally restoring last read page
    const lastPageKey = `pdfviewer:lastpage:${pdfUrl}`;
    const savedPage = Number(localStorage.getItem(lastPageKey));
    const initialPage = Number.isFinite(savedPage) && savedPage > 0 && savedPage <= numPages
      ? savedPage
      : undefined;
    buildBook(false, initialPage);
    updateTextLayer();

    // 5. Hide loading indicator
    loadingEl.classList.add('hidden');

    // GA4: PDF loaded
    trackEvent('pdf_loaded', { pages: numPages, title: document.title });

    // 6. Controls
    const toolbar = document.getElementById('toolbar')!;
    const pageInfoEl = document.getElementById('page-info')!;
    const pageSlider = document.getElementById('page-slider') as HTMLInputElement;
    const btnPrev = document.getElementById('btn-prev') as HTMLButtonElement;
    const btnNext = document.getElementById('btn-next') as HTMLButtonElement;
    const btnFirst = document.getElementById('btn-first') as HTMLButtonElement;
    const btnLast = document.getElementById('btn-last') as HTMLButtonElement;
    const btnThumbnail = document.getElementById('btn-thumbnail')!;

    const btnFullscreen = document.getElementById('btn-fullscreen')!;
    const btnShare = document.getElementById('btn-share')!;
    const btnSound = document.getElementById('btn-sound')!;
    const btnZoomIn = document.getElementById('btn-zoom-in')!;
    const btnZoomOut = document.getElementById('btn-zoom-out')!;
    const btnZoomClose = document.getElementById('btn-zoom-close')!;
    const zoomInfoEl = document.getElementById('zoom-info')!;
    const bookArea = document.getElementById('book-area')!;
    const btnRtl = document.getElementById('btn-rtl')!;

    // Zoom & pan state
    let zoomLevel = 1;
    let panX = 0, panY = 0;
    let isPanning = false;
    let panStartX = 0, panStartY = 0;
    const ZOOM_STEP = 0.1;
    const ZOOM_MIN = 0.5;
    const ZOOM_MAX = 3.0;

    function applyZoom(): void {
      const isZoomed = zoomLevel > 1;
      const wasZoomed = bookArea.classList.contains('zoom-mode');

      // Toggle mouse events when crossing the 100% threshold (no rebuild needed)
      if (isZoomed !== wasZoomed && pageFlip) {
        pageFlip.setMouseEvents(!isZoomed);
      }

      // Reset pan when not zoomed in
      if (!isZoomed) { panX = 0; panY = 0; }

      // Apply transform
      if (isZoomed) {
        bookEl.style.transform = `translate(${panX}px, ${panY}px) scale(${zoomLevel})`;
      } else if (zoomLevel < 1) {
        bookEl.style.transform = `scale(${zoomLevel})`;
      } else {
        bookEl.style.transform = '';
      }

      zoomInfoEl.textContent = `${Math.round(zoomLevel * 100)}%`;

      bookArea.classList.toggle('zoom-mode', isZoomed);
      btnZoomClose.classList.toggle('hidden', !isZoomed);

      // Hide nav when zoomed in
      const navDisplay = isZoomed ? 'none' : '';
      btnPrev.style.display = navDisplay;
      btnNext.style.display = navDisplay;
      btnFirst.style.display = navDisplay;
      btnLast.style.display = navDisplay;
    }

    function resetZoom(): void {
      zoomLevel = 1;
      panX = 0;
      panY = 0;
      applyZoom();
    }

    btnZoomIn.addEventListener('click', () => {
      if (zoomLevel < ZOOM_MAX) {
        zoomLevel = Math.min(ZOOM_MAX, +(zoomLevel + ZOOM_STEP).toFixed(1));
        applyZoom();
        if (viewerConfig.analytics?.trackZoom) {
          trackEvent('zoom_change', { direction: 'in', level: zoomLevel });
        }
      }
    });

    btnZoomOut.addEventListener('click', () => {
      if (zoomLevel > ZOOM_MIN) {
        zoomLevel = Math.max(ZOOM_MIN, +(zoomLevel - ZOOM_STEP).toFixed(1));
        applyZoom();
        if (viewerConfig.analytics?.trackZoom) {
          trackEvent('zoom_change', { direction: 'out', level: zoomLevel });
        }
      }
    });

    btnZoomClose.addEventListener('click', resetZoom);

    // Pan drag (only when zoomed in)
    bookArea.addEventListener('mousedown', (e: MouseEvent) => {
      if (zoomLevel <= 1) return;
      isPanning = true;
      panStartX = e.clientX - panX;
      panStartY = e.clientY - panY;
      e.preventDefault();
    });

    document.addEventListener('mousemove', (e: MouseEvent) => {
      if (!isPanning) return;
      panX = e.clientX - panStartX;
      panY = e.clientY - panStartY;
      bookEl.style.transform = `translate(${panX}px, ${panY}px) scale(${zoomLevel})`;
    });

    document.addEventListener('mouseup', () => {
      isPanning = false;
    });

    // Page slider setup
    pageSlider.min = '1';
    pageSlider.max = String(numPages);
    pageSlider.value = '1';

    function getOriginalPage(): number {
      const idx = pageFlip!.getCurrentPageIndex();
      return currentPageMap[idx] || 1;
    }

    function updatePageInfo(): void {
      const idx = pageFlip!.getCurrentPageIndex();
      const page1 = currentPageMap[idx] || 1;

      const isPortrait = pageFlip!.getOrientation() === 'portrait';

      if (!isPortrait && idx + 1 < currentPageMap.length) {
        const page2 = currentPageMap[idx + 1];
        if (page2 && page1 !== page2) {
          const lo = Math.min(page1, page2);
          const hi = Math.max(page1, page2);
          pageInfoEl.textContent = `${lo}-${hi} / ${numPages}`;
          pageSlider.value = String(lo);
          pageSlider.setAttribute('aria-valuetext', `Pages ${lo} to ${hi} of ${numPages}`);
          return;
        }
      }

      pageInfoEl.textContent = `${page1} / ${numPages}`;
      pageSlider.value = String(page1);
      pageSlider.setAttribute('aria-valuetext', `Page ${page1} of ${numPages}`);
    }

    function flipNext(): void {
      flipSound();
      lastSoundTime = Date.now();
      isRtl ? pageFlip!.flipPrev() : pageFlip!.flipNext();
    }

    function flipPrev(): void {
      flipSound();
      lastSoundTime = Date.now();
      isRtl ? pageFlip!.flipNext() : pageFlip!.flipPrev();
    }

    function goFirst(): void {
      const targetIdx = isRtl ? currentPageMap.length - 1 : 0;
      if (pageFlip!.getCurrentPageIndex() === targetIdx) return;

      flipSound();
      lastSoundTime = Date.now();
      pageFlip!.turnToPage(targetIdx);
      updatePageInfo();
      if (viewerConfig.analytics?.trackNavigation) {
        trackEvent('navigate', { action: 'first_page' });
      }
    }

    function goLast(): void {
      const targetIdx = isRtl ? 0 : currentPageMap.length - 1;
      if (pageFlip!.getCurrentPageIndex() === targetIdx) return;

      flipSound();
      lastSoundTime = Date.now();
      pageFlip!.turnToPage(targetIdx);
      updatePageInfo();
      if (viewerConfig.analytics?.trackNavigation) {
        trackEvent('navigate', { action: 'last_page' });
      }
    }

    updatePageInfo();
    toolbar.classList.add('visible');

    btnPrev.addEventListener('click', () => flipPrev());
    btnNext.addEventListener('click', () => flipNext());
    btnFirst.addEventListener('click', () => goFirst());
    btnLast.addEventListener('click', () => goLast());

    // Page slider: instant jump while dragging, sound on release
    pageSlider.addEventListener('input', () => {
      const targetPage = parseInt(pageSlider.value);
      const realIdx = currentPageMap.indexOf(targetPage);
      if (realIdx >= 0) {
        pageFlip!.turnToPage(realIdx);
        updatePageInfo();
      }
    });
    pageSlider.addEventListener('change', () => {
      flipSound();
      pageSlider.blur();
      if (viewerConfig.analytics?.trackNavigation) {
        trackEvent('navigate', { action: 'slider_jump', page: parseInt(pageSlider.value) });
      }
    });

    btnSound.addEventListener('click', () => {
      soundEnabled = !soundEnabled;
      setIconText(btnSound, soundEnabled ? 'volume_up' : 'volume_off');
      btnSound.style.background = soundEnabled ? '' : 'rgba(255,255,255,0.25)';
      trackEvent('sound_toggle', { enabled: soundEnabled });
    });

    btnRtl.addEventListener('click', () => {
      const currentOriginalPage = getOriginalPage();
      isRtl = !isRtl;
      setIconText(btnRtl, isRtl ? 'format_textdirection_l_to_r' : 'format_textdirection_r_to_l');
      btnRtl.style.background = isRtl ? 'rgba(255,255,255,0.25)' : '';

      zoomLevel = 1; panX = 0; panY = 0;
      buildBook(isRtl, currentOriginalPage);
      applyZoom();
      buildThumbnails();
      updatePageInfo();
      trackEvent('toggle_rtl', { rtl: isRtl });
    });

    btnFullscreen.addEventListener('click', () => {
      const entering = !document.fullscreenElement;
      if (entering) {
        document.documentElement.requestFullscreen();
      } else {
        document.exitFullscreen();
      }
      if (viewerConfig.analytics?.trackFullscreen) {
        trackEvent('fullscreen', { active: entering });
      }
    });

    // Thumbnail overlay
    const thumbOverlay = document.getElementById('thumbnail-overlay')!;
    const thumbGrid = document.getElementById('thumbnail-grid')!;
    const btnThumbClose = document.getElementById('btn-thumb-close')!;

    function buildThumbnails(): void {
      thumbGrid.innerHTML = '';
      const total = currentPageMap.length;

      for (let i = 0; i < total; i += 2) {
        if (i + 1 < total) {
          addThumbItem([currentPageMap[i]!, currentPageMap[i + 1]!], i);
        } else {
          addThumbItem([currentPageMap[i]!], i);
        }
      }
    }

    function addThumbItem(pages: number[], flipIdx: number): void {
      const item = document.createElement('div');
      item.className = 'thumb-item';
      item.dataset.pages = pages.join(',');

      const imgWrap = document.createElement('div');
      imgWrap.className = pages.length === 1 ? 'thumb-single' : 'thumb-spread';
      for (const pageNum of pages) {
        const img = document.createElement('img');
        const cached = renderedPages.get(pageNum);
        if (cached) {
          img.src = cached;
        } else {
          renderPageCached(pdf, pageNum, pdfUrl).then(data => {
            renderedPages.set(pageNum, data.dataUrl);
            img.src = data.dataUrl;
          });
        }
        imgWrap.appendChild(img);
      }
      item.appendChild(imgWrap);

      const label = document.createElement('div');
      label.className = 'thumb-label';
      const sorted = [...pages].sort((a, b) => a - b);
      label.textContent = sorted.length > 1 ? `${sorted[0]}-${sorted[1]}` : String(sorted[0]);
      item.appendChild(label);

      item.addEventListener('click', () => {
        pageFlip!.turnToPage(flipIdx);
        updatePageInfo();
        thumbOverlay.classList.add('hidden');
      });

      thumbGrid.appendChild(item);
    }

    buildThumbnails();

    function updateThumbnailActive(): void {
      const currentPage = String(getOriginalPage());
      thumbGrid.querySelectorAll('.thumb-item').forEach((el) => {
        const pages = (el as HTMLElement).dataset.pages?.split(',') ?? [];
        el.classList.toggle('active', pages.includes(currentPage));
      });
    }

    btnThumbnail.addEventListener('click', () => {
      updateThumbnailActive();
      thumbOverlay.classList.toggle('hidden');
      const opened = !thumbOverlay.classList.contains('hidden');
      if (opened) {
        (btnThumbClose as HTMLElement).focus();
        const active = thumbGrid.querySelector('.thumb-item.active');
        if (active) active.scrollIntoView({ block: 'center', behavior: 'smooth' });
      }
      if (viewerConfig.analytics?.trackNavigation) {
        trackEvent('thumbnails', { action: opened ? 'open' : 'close' });
      }
    });

    btnThumbClose.addEventListener('click', () => {
      thumbOverlay.classList.add('hidden');
      (btnThumbnail as HTMLElement).focus();
    });

    // ── Table of contents ──
    if (tocTree) {
      setupToc(tocTree);
    }

    function setupToc(tree: TocItem[]): void {
      const btnToc = document.getElementById('btn-toc')!;
      const tocOverlay = document.getElementById('toc-overlay')!;
      const tocList = document.getElementById('toc-list')!;
      const btnTocClose = document.getElementById('btn-toc-close')!;

      const flat = flattenToc(tree);
      const siblingIdx = computeSiblingIndex(tree);
      const rows: HTMLButtonElement[] = [];

      // Build TOC rows
      for (const item of flat) {
        const row = document.createElement('button');
        row.type = 'button';
        row.className = 'toc-item';
        row.setAttribute('role', 'treeitem');
        row.setAttribute('aria-level', String(item.depth + 1));
        const sib = siblingIdx.get(item);
        if (sib) {
          row.setAttribute('aria-posinset', String(sib.pos));
          row.setAttribute('aria-setsize', String(sib.size));
        }
        row.style.paddingLeft = `${12 + item.depth * 20}px`;
        row.dataset.page = String(item.page);
        row.title = item.title;

        const titleEl = document.createElement('span');
        titleEl.className = 'toc-title';
        titleEl.textContent = item.title;

        const pageEl = document.createElement('span');
        pageEl.className = 'toc-page';
        pageEl.textContent = String(item.page);
        pageEl.setAttribute('aria-label', `Page ${item.page}`);

        row.append(titleEl, pageEl);
        row.addEventListener('click', () => jumpToTocItem(item));
        tocList.appendChild(row);
        rows.push(row);
      }

      btnToc.classList.remove('hidden');

      function jumpToTocItem(item: TocItem): void {
        const realIdx = currentPageMap.indexOf(item.page);
        if (realIdx >= 0) {
          pageFlip!.turnToPage(realIdx);
          updatePageInfo();
        }
        tocOverlay.classList.add('hidden');
        (btnToc as HTMLElement).focus();
        if (viewerConfig.analytics?.trackNavigation) {
          trackEvent('navigate', { action: 'toc_jump', page: item.page });
        }
      }

      function updateCurrent(): void {
        const currentPage = getOriginalPage();
        // Find the deepest item whose page <= currentPage
        let activeRow: HTMLButtonElement | null = null;
        for (const row of rows) {
          const page = parseInt(row.dataset.page!, 10);
          if (page <= currentPage) activeRow = row;
          else break;
        }
        rows.forEach(r => r.removeAttribute('aria-current'));
        activeRow?.setAttribute('aria-current', 'page');
      }

      // Open TOC
      btnToc.addEventListener('click', () => {
        updateCurrent();
        tocOverlay.classList.remove('hidden');
        const active = tocList.querySelector<HTMLButtonElement>('.toc-item[aria-current="page"]');
        (active ?? rows[0])?.focus();
        active?.scrollIntoView({ block: 'center' });
        if (viewerConfig.analytics?.trackNavigation) {
          trackEvent('navigate', { action: 'toc_open' });
        }
      });

      btnTocClose.addEventListener('click', () => {
        tocOverlay.classList.add('hidden');
        (btnToc as HTMLElement).focus();
      });

      // Keyboard navigation within the overlay
      tocOverlay.addEventListener('keydown', (e: KeyboardEvent) => {
        const idx = rows.indexOf(document.activeElement as HTMLButtonElement);
        if (e.key === 'ArrowDown') {
          e.preventDefault();
          rows[Math.min(idx + 1, rows.length - 1)]?.focus();
        } else if (e.key === 'ArrowUp') {
          e.preventDefault();
          rows[Math.max(idx - 1, 0)]?.focus();
        } else if (e.key === 'Home') {
          e.preventDefault();
          rows[0]?.focus();
        } else if (e.key === 'End') {
          e.preventDefault();
          rows[rows.length - 1]?.focus();
        } else if (e.key === 'Escape') {
          e.preventDefault();
          tocOverlay.classList.add('hidden');
          (btnToc as HTMLElement).focus();
        }
      });

      // Update current chapter highlight on every flip
      pageFlip?.on('flip', updateCurrent);
    }

    // Share
    btnShare.addEventListener('click', async () => {
      // Share clean URL without potentially sensitive query params
      const shareUrl = window.location.origin + window.location.pathname;
      const method = ('share' in navigator) ? 'native_share' : 'clipboard';
      if (navigator.share) {
        try {
          await navigator.share({ title: document.title, url: shareUrl });
        } catch { /* user cancelled */ }
      } else {
        await navigator.clipboard.writeText(shareUrl);
        setIconText(btnShare, 'check');
        setTimeout(() => { setIconText(btnShare, 'share'); }, 1500);
      }
      if (viewerConfig.analytics?.trackShare) {
        trackEvent('share', { method, page: getOriginalPage() });
      }
    });

    // 7. Arrow key navigation
    document.addEventListener('keydown', (e: KeyboardEvent) => {
      const tocOverlay = document.getElementById('toc-overlay');
      if (tocOverlay && !tocOverlay.classList.contains('hidden')) {
        // TOC overlay handles its own keydown (arrows, Escape). Skip page nav here.
        return;
      }
      if (!thumbOverlay.classList.contains('hidden')) {
        if (e.key === 'Escape') thumbOverlay.classList.add('hidden');
        return;
      }
      if (e.key === 'Escape' && zoomLevel > 1) {
        resetZoom();
        return;
      }
      if ((e.key === '=' || e.key === '+') && (e.ctrlKey || e.metaKey)) {
        e.preventDefault();
        btnZoomIn.click();
      }
      if (e.key === '-' && (e.ctrlKey || e.metaKey)) {
        e.preventDefault();
        btnZoomOut.click();
      }
      if (e.key === '0' && (e.ctrlKey || e.metaKey)) {
        e.preventDefault();
        resetZoom();
      }
      if (zoomLevel <= 1) {
        if (e.key === 'ArrowRight') flipNext();
        if (e.key === 'ArrowLeft') flipPrev();
        if (e.key === 'Home') goFirst();
        if (e.key === 'End') goLast();
      }
    });
  } catch (err: unknown) {
    console.error('Failed to load PDF:', err);
    loadingEl.textContent = 'Error: Failed to load PDF. Please check the file and try again.';
  }
}

/** Public API for programmatic PDF loading */
(window as any).PDFViewer = {
  load(url: string): Promise<void> {
    return init(url);
  },
};

// Auto-load from config or default
init(viewerConfig.pdf || DEFAULT_PDF);
