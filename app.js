import * as pdfjsLib from 'https://cdn.jsdelivr.net/npm/pdfjs-dist@4.8.69/build/pdf.min.mjs';

// Configure PDF.js worker
pdfjsLib.GlobalWorkerOptions.workerSrc =
  'https://cdn.jsdelivr.net/npm/pdfjs-dist@4.8.69/build/pdf.worker.min.mjs';

const RENDER_SCALE = 1.5;
const PDF_URL = new URLSearchParams(window.location.search).get('src') || './sample.pdf';

async function renderPageToImage(pdf, pageNum) {
  const page = await pdf.getPage(pageNum);
  const viewport = page.getViewport({ scale: RENDER_SCALE });

  const canvas = document.createElement('canvas');
  canvas.width = viewport.width;
  canvas.height = viewport.height;

  const ctx = canvas.getContext('2d');
  await page.render({ canvasContext: ctx, viewport }).promise;

  return {
    dataUrl: canvas.toDataURL(),
    width: viewport.width,
    height: viewport.height,
  };
}

async function init() {
  const loadingEl = document.getElementById('loading');
  let bookEl = document.getElementById('book');

  try {
    // 1. Load PDF (with CORS proxy fallback for external URLs)
    let pdfSource = PDF_URL;
    const isExternal = PDF_URL.startsWith('http');
    if (isExternal) {
      try {
        loadingEl.textContent = 'Loading PDF...';
        const res = await fetch(PDF_URL);
        pdfSource = { data: await res.arrayBuffer() };
      } catch {
        loadingEl.textContent = 'Retrying via CORS proxy...';
        const proxyUrl = `https://corsproxy.io/?url=${encodeURIComponent(PDF_URL)}`;
        const res = await fetch(proxyUrl);
        if (!res.ok) throw new Error('Failed to load PDF via proxy');
        pdfSource = { data: await res.arrayBuffer() };
      }
    }
    const pdf = await pdfjsLib.getDocument(pdfSource).promise;
    const numPages = pdf.numPages;

    // 2. Render all pages to images
    const pageImages = [];
    for (let i = 1; i <= numPages; i++) {
      loadingEl.textContent = `Rendering page ${i} of ${numPages}...`;
      const pageData = await renderPageToImage(pdf, i);
      pageImages.push(pageData);
    }

    // 3. Get page dimensions from first page
    const pageWidth = Math.round(pageImages[0].width);
    const pageHeight = Math.round(pageImages[0].height);

    let isRtl = false;
    let pageFlip = null;
    let currentPageMap = []; // maps flip index → original page number (0 = blank)

    // Build page DOM elements and init StPageFlip
    function buildBook(rtl) {
      // Replace the container entirely to avoid stale state
      const newBookEl = document.createElement('div');
      newBookEl.id = 'book';
      bookEl.parentNode.replaceChild(newBookEl, bookEl);
      bookEl = newBookEl;

      // Build page list: [P1, P2, ..., Pn]
      const entries = [];
      for (let i = 0; i < pageImages.length; i++) {
        entries.push({ img: pageImages[i], num: i + 1 });
      }

      // For RTL: reverse entire page order
      if (rtl) {
        entries.reverse();
      }

      // Build DOM and page map
      currentPageMap = [];
      for (const entry of entries) {
        const div = document.createElement('div');
        div.dataset.density = 'soft';
        div.className = 'page';
        const img = document.createElement('img');
        img.src = entry.img.dataUrl;
        div.appendChild(img);
        bookEl.appendChild(div);
        currentPageMap.push(entry.num);
      }

      const totalBookPages = entries.length;

      // Calculate page dimensions that fit the actual viewport
      // (prevents StPageFlip container vs page size mismatch)
      const aspectRatio = pageWidth / pageHeight;
      const viewW = window.innerWidth;
      const viewH = window.innerHeight;

      let fitW = Math.round(viewH * aspectRatio);
      let fitH = viewH;

      // If two pages exceed viewport width, constrain by width instead
      if (fitW * 2 > viewW) {
        fitW = Math.floor(viewW / 2);
        fitH = Math.round(fitW / aspectRatio);
      }

      // Never exceed original canvas resolution (no upscaling)
      fitW = Math.min(fitW, pageWidth);
      fitH = Math.min(fitH, pageHeight);

      pageFlip = new St.PageFlip(bookEl, {
        width: fitW,
        height: fitH,
        size: 'stretch',
        maxWidth: fitW,
        maxHeight: fitH,
        flippingTime: 450,
        maxShadowOpacity: 0.3,
        showCover: true,
        mobileScrollSupport: false,
        autoSize: true,
        startPage: rtl ? totalBookPages - 1 : 0,
      });
      pageFlip.loadFromHTML(bookEl.querySelectorAll('.page'));
      pageFlip.on('flip', () => {
        updatePageInfo();
      });
      // Update edges to target position as soon as flip starts
      pageFlip.on('flipping', (e) => {
        updatePageEdges(e.data);
      });
      pageFlip.on('changeState', (e) => {
        if (e.data === 'read') {
          updatePageEdges();
        }
      });

      // Wait one frame for StPageFlip to finish layout
      requestAnimationFrame(() => updatePageEdges());
    }

    // Page-edge elements (position: fixed, won't affect #book layout)
    const edgeLeft = document.createElement('div');
    edgeLeft.className = 'book-edge book-edge-left';
    document.body.appendChild(edgeLeft);
    const edgeRight = document.createElement('div');
    edgeRight.className = 'book-edge book-edge-right';
    document.body.appendChild(edgeRight);

    function updatePageEdges(overrideIdx) {
      const block = document.querySelector('.stf__block');
      if (!block || !pageFlip) return;

      const rect = block.getBoundingClientRect();
      const idx = overrideIdx !== undefined ? overrideIdx : pageFlip.getCurrentPageIndex();
      const total = currentPageMap.length;
      const maxEdge = Math.min(Math.ceil(numPages / 5), 14);

      let readProgress = idx / Math.max(total - 1, 1);
      if (isRtl) readProgress = 1 - readProgress;

      const readW = Math.round(readProgress * maxEdge);
      const unreadW = maxEdge - readW;
      const lw = isRtl ? unreadW : readW;
      const rw = isRtl ? readW : unreadW;

      const inset = 3;
      const top = rect.top + inset;
      const h = rect.height - inset * 2;

      edgeLeft.style.cssText = `position:fixed;top:${top}px;height:${h}px;left:${rect.left - lw}px;width:${lw}px`;
      edgeRight.style.cssText = `position:fixed;top:${top}px;height:${h}px;left:${rect.right}px;width:${rw}px`;
    }

    window.addEventListener('resize', () => requestAnimationFrame(updatePageEdges));

    // 4. Build initial book (LTR)
    buildBook(false);

    // 5. Hide loading indicator
    loadingEl.classList.add('hidden');

    // 6. Toolbar controls
    const toolbar = document.getElementById('toolbar');
    const pageInfoEl = document.getElementById('page-info');
    const btnPrev = document.getElementById('btn-prev');
    const btnNext = document.getElementById('btn-next');
    const btnFullscreen = document.getElementById('btn-fullscreen');
    const btnRtl = document.getElementById('btn-rtl');

    function getOriginalPage() {
      const idx = pageFlip.getCurrentPageIndex();
      return currentPageMap[idx] || 1;
    }

    function updatePageInfo() {
      pageInfoEl.textContent = `${getOriginalPage()} / ${numPages}`;
    }

    function flipNext() {
      isRtl ? pageFlip.flipPrev() : pageFlip.flipNext();
    }

    function flipPrev() {
      isRtl ? pageFlip.flipNext() : pageFlip.flipPrev();
    }

    updatePageInfo();
    toolbar.classList.add('visible');

    btnPrev.addEventListener('click', () => flipPrev());
    btnNext.addEventListener('click', () => flipNext());

    btnRtl.addEventListener('click', () => {
      const currentOriginalPage = getOriginalPage();
      isRtl = !isRtl;
      btnRtl.style.background = isRtl ? 'rgba(255,255,255,0.25)' : '';

      buildBook(isRtl);

      // Navigate to the same original page in the new layout
      let newIndex = currentPageMap.indexOf(currentOriginalPage);
      if (newIndex < 0) newIndex = 0;
      pageFlip.turnToPage(newIndex);
      updatePageInfo();
    });

    btnFullscreen.addEventListener('click', () => {
      if (!document.fullscreenElement) {
        document.documentElement.requestFullscreen();
      } else {
        document.exitFullscreen();
      }
    });

    // 7. Arrow key navigation
    document.addEventListener('keydown', (e) => {
      if (e.key === 'ArrowRight') flipNext();
      if (e.key === 'ArrowLeft') flipPrev();
    });
  } catch (err) {
    loadingEl.textContent = `Error: ${err.message}`;
    console.error('Failed to load PDF:', err);
  }
}

init();
