import * as pdfjsLib from 'https://cdn.jsdelivr.net/npm/pdfjs-dist@4.8.69/build/pdf.min.mjs';

// Configure PDF.js worker
pdfjsLib.GlobalWorkerOptions.workerSrc =
  'https://cdn.jsdelivr.net/npm/pdfjs-dist@4.8.69/build/pdf.worker.min.mjs';

const RENDER_SCALE = 1.5;
const PDF_URL = new URLSearchParams(window.location.search).get('src') || './sample.pdf';

// Page flip sound effect
let soundEnabled = true;
const flipSound = (() => {
  const audio = new Audio('./page-flip.mp3');
  audio.volume = 0.5;
  return function play() {
    if (!soundEnabled) return;
    audio.currentTime = 0;
    audio.play().catch(() => {});
  };
})();

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
    // 1. Load PDF document (streaming — only downloads metadata + needed pages)
    loadingEl.textContent = 'Loading PDF...';
    let pdfSource = PDF_URL;
    const isExternal = PDF_URL.startsWith('http');
    if (isExternal) {
      try {
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

    // 2. Render only the first page to get dimensions
    loadingEl.textContent = 'Rendering...';
    const firstPage = await renderPageToImage(pdf, 1);
    const pageWidth = Math.round(firstPage.width);
    const pageHeight = Math.round(firstPage.height);

    // Page render cache: index → dataUrl (1-based)
    const renderedPages = new Map();
    renderedPages.set(1, firstPage.dataUrl);

    let isRtl = false;
    let pageFlip = null;
    let currentPageMap = []; // maps flip index → original page number (0 = blank)
    let currentShowCover = true;
    let lastSoundTime = 0;

    // Render a PDF page and fill it into the corresponding DOM element
    async function renderPageInto(originalPageNum, imgEl) {
      if (renderedPages.has(originalPageNum)) {
        imgEl.src = renderedPages.get(originalPageNum);
        return;
      }
      const pageData = await renderPageToImage(pdf, originalPageNum);
      renderedPages.set(originalPageNum, pageData.dataUrl);
      imgEl.src = pageData.dataUrl;
    }

    // Build page DOM elements and init StPageFlip
    function buildBook(rtl, targetOriginalPage, mouseEvents = true) {
      // Destroy old instance to remove window-level event listeners
      const parentEl = bookEl.parentNode;
      if (pageFlip) {
        try { pageFlip.destroy(); } catch {}
      }

      // Replace the container entirely to avoid stale state
      const newBookEl = document.createElement('div');
      newBookEl.id = 'book';
      if (bookEl.parentNode) {
        bookEl.parentNode.replaceChild(newBookEl, bookEl);
      } else {
        parentEl.appendChild(newBookEl);
      }
      bookEl = newBookEl;

      // Build page order (RTL = reversed)
      const pageNums = [];
      for (let i = 1; i <= numPages; i++) pageNums.push(i);
      if (rtl) pageNums.reverse();

      // Build DOM with placeholder divs (only fill cached pages immediately)
      currentPageMap = [];
      const pageDivs = [];

      // Insert a transparent page at the front so the first spread is
      // [blank | page1] instead of [page1] alone. This avoids the
      // single-page-spread edge case where flippingPage === bottomPage
      // (same DOM element) which breaks the soft flip animation.
      if (!rtl) {
        const blankDiv = document.createElement('div');
        blankDiv.dataset.density = 'soft';
        blankDiv.className = 'page page-blank';
        bookEl.appendChild(blankDiv);
        currentPageMap.push(0);
        pageDivs.push(blankDiv);
      }

      for (const num of pageNums) {
        const div = document.createElement('div');
        div.dataset.density = 'soft';
        div.className = 'page';
        const img = document.createElement('img');
        if (renderedPages.has(num)) {
          img.src = renderedPages.get(num);
        }
        div.appendChild(img);
        bookEl.appendChild(div);
        currentPageMap.push(num);
        pageDivs.push(div);
      }

      if (rtl) {
        const blankDiv = document.createElement('div');
        blankDiv.dataset.density = 'soft';
        blankDiv.className = 'page page-blank';
        bookEl.appendChild(blankDiv);
        currentPageMap.push(0);
        pageDivs.push(blankDiv);
      }

      const totalBookPages = pageDivs.length;

      const useShowCover = false;
      currentShowCover = useShowCover;

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
        showCover: useShowCover,
        mobileScrollSupport: false,
        autoSize: true,
        usePortrait: true,
        useMouseEvents: mouseEvents,
        showEdge: true,
        edgeWidth: Math.min(Math.ceil(numPages / 4), 20),
        edgePageOffset: rtl ? 0 : 1,
        preloadRange: 3,
        startPage: targetOriginalPage !== undefined
          ? currentPageMap.indexOf(targetOriginalPage)
          : (rtl ? totalBookPages - 1 : 0),
      });
      // Lazy render: register BEFORE loadFromHTML so the synchronous
      // emitRenderPages() during init is caught
      pageFlip.on('renderPages', (e) => {
        const indices = e.data;
        for (const idx of indices) {
          const originalPage = currentPageMap[idx];
          const img = pageDivs[idx]?.querySelector('img');
          if (originalPage && img && !img.getAttribute('src')) {
            renderPageInto(originalPage, img);
          }
        }
      });

      pageFlip.loadFromHTML(bookEl.querySelectorAll('.page'));

      pageFlip.on('flip', () => {
        const now = Date.now();
        if (now - lastSoundTime > 500) {
          flipSound();
          lastSoundTime = now;
        }
        updatePageInfo();
      });
    }

    let resizeTimer;
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

    // 4. Build initial book (LTR)
    buildBook(false);

    // 5. Hide loading indicator
    loadingEl.classList.add('hidden');

    // 6. Controls
    const toolbar = document.getElementById('toolbar');
    const pageInfoEl = document.getElementById('page-info');
    const pageSlider = document.getElementById('page-slider');
    const btnPrev = document.getElementById('btn-prev');
    const btnNext = document.getElementById('btn-next');
    const btnFirst = document.getElementById('btn-first');
    const btnLast = document.getElementById('btn-last');
    const btnThumbnail = document.getElementById('btn-thumbnail');

    const btnFullscreen = document.getElementById('btn-fullscreen');
    const btnShare = document.getElementById('btn-share');
    const btnSound = document.getElementById('btn-sound');
    const btnZoomIn = document.getElementById('btn-zoom-in');
    const btnZoomOut = document.getElementById('btn-zoom-out');
    const btnZoomClose = document.getElementById('btn-zoom-close');
    const zoomInfoEl = document.getElementById('zoom-info');
    const bookArea = document.getElementById('book-area');
    const btnRtl = document.getElementById('btn-rtl');

    // Zoom & pan state
    let zoomLevel = 1;
    let panX = 0, panY = 0;
    let isPanning = false;
    let panStartX = 0, panStartY = 0;
    const ZOOM_STEP = 0.1;
    const ZOOM_MIN = 0.5;
    const ZOOM_MAX = 3.0;

    function applyZoom() {
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

    function resetZoom() {
      zoomLevel = 1;
      panX = 0;
      panY = 0;
      applyZoom();
    }

    btnZoomIn.addEventListener('click', () => {
      if (zoomLevel < ZOOM_MAX) {
        zoomLevel = Math.min(ZOOM_MAX, +(zoomLevel + ZOOM_STEP).toFixed(1));
        applyZoom();
      }
    });

    btnZoomOut.addEventListener('click', () => {
      if (zoomLevel > ZOOM_MIN) {
        zoomLevel = Math.max(ZOOM_MIN, +(zoomLevel - ZOOM_STEP).toFixed(1));
        applyZoom();
      }
    });

    btnZoomClose.addEventListener('click', resetZoom);

    // Pan drag (only when zoomed in)
    bookArea.addEventListener('mousedown', (e) => {
      if (zoomLevel <= 1) return;
      isPanning = true;
      panStartX = e.clientX - panX;
      panStartY = e.clientY - panY;
      e.preventDefault();
    });

    document.addEventListener('mousemove', (e) => {
      if (!isPanning) return;
      panX = e.clientX - panStartX;
      panY = e.clientY - panStartY;
      bookEl.style.transform = `translate(${panX}px, ${panY}px) scale(${zoomLevel})`;
    });

    document.addEventListener('mouseup', () => {
      isPanning = false;
    });

    // Page slider setup
    pageSlider.min = 1;
    pageSlider.max = numPages;
    pageSlider.value = 1;

    function getOriginalPage() {
      const idx = pageFlip.getCurrentPageIndex();
      return currentPageMap[idx] || 1;
    }

    function updatePageInfo() {
      const idx = pageFlip.getCurrentPageIndex();
      const total = currentPageMap.length;
      const page1 = currentPageMap[idx] || 1;

      // Portrait mode = single page, never show spread
      const isPortrait = pageFlip.getOrientation() === 'portrait';

      // Check if current view is a spread (two pages visible, landscape only)
      const isSpreadStart = !isPortrait && (currentShowCover
        ? (idx > 0 && idx % 2 === 1)
        : (idx % 2 === 0));

      if (isSpreadStart && idx + 1 < total) {
        const page2 = currentPageMap[idx + 1] || 0;
        if (!page1 || !page2 || page1 === page2) {
          const real = page1 || page2 || 1;
          pageInfoEl.textContent = `${real} / ${numPages}`;
          pageSlider.value = real;
        } else {
          const lo = Math.min(page1, page2);
          const hi = Math.max(page1, page2);
          pageInfoEl.textContent = `${lo}-${hi} / ${numPages}`;
          pageSlider.value = lo;
        }
      } else {
        const displayPage = page1 || 1;
        pageInfoEl.textContent = `${displayPage} / ${numPages}`;
        pageSlider.value = displayPage;
      }
    }

    function flipNext() {
      flipSound();
      lastSoundTime = Date.now();
      isRtl ? pageFlip.flipPrev() : pageFlip.flipNext();
    }

    function flipPrev() {
      flipSound();
      lastSoundTime = Date.now();
      isRtl ? pageFlip.flipNext() : pageFlip.flipPrev();
    }

    function goFirst() {
      const targetIdx = isRtl ? currentPageMap.length - 1 : 0;
      if (pageFlip.getCurrentPageIndex() === targetIdx) return;

      flipSound();
      lastSoundTime = Date.now();
      pageFlip.flip(targetIdx);
    }

    function goLast() {
      const targetIdx = isRtl ? 0 : currentPageMap.length - 1;
      if (pageFlip.getCurrentPageIndex() === targetIdx) return;

      flipSound();
      lastSoundTime = Date.now();
      pageFlip.flip(targetIdx);
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
      const targetIdx = currentPageMap.indexOf(targetPage);
      if (targetIdx >= 0) {
        pageFlip.turnToPage(targetIdx);

        updatePageInfo();
      }
    });
    pageSlider.addEventListener('change', () => {
      flipSound();
      pageSlider.blur();
    });

    btnSound.addEventListener('click', () => {
      soundEnabled = !soundEnabled;
      btnSound.innerHTML = `<span class="material-symbols-rounded">${soundEnabled ? 'volume_up' : 'volume_off'}</span>`;
      btnSound.style.background = soundEnabled ? '' : 'rgba(255,255,255,0.25)';
    });

    btnRtl.addEventListener('click', () => {
      const currentOriginalPage = getOriginalPage();
      isRtl = !isRtl;
      btnRtl.innerHTML = `<span class="material-symbols-rounded">${isRtl ? 'format_textdirection_l_to_r' : 'format_textdirection_r_to_l'}</span>`;
      btnRtl.style.background = isRtl ? 'rgba(255,255,255,0.25)' : '';

      zoomLevel = 1; panX = 0; panY = 0;
      buildBook(isRtl, currentOriginalPage);
      applyZoom();
      buildThumbnails();
      updatePageInfo();
    });


    btnFullscreen.addEventListener('click', () => {
      if (!document.fullscreenElement) {
        document.documentElement.requestFullscreen();
      } else {
        document.exitFullscreen();
      }
    });

    // Thumbnail overlay
    const thumbOverlay = document.getElementById('thumbnail-overlay');
    const thumbGrid = document.getElementById('thumbnail-grid');
    const btnThumbClose = document.getElementById('btn-thumb-close');

    function buildThumbnails() {
      thumbGrid.innerHTML = '';
      const total = currentPageMap.length;
      let i = 0;

      // Cover is single when showCover is true
      if (currentShowCover && total > 0) {
        addThumbItem([currentPageMap[0]], 0);
        i = 1;
      }

      // Pair remaining pages as spreads
      while (i < total) {
        if (i + 1 < total) {
          addThumbItem([currentPageMap[i], currentPageMap[i + 1]], i);
          i += 2;
        } else {
          addThumbItem([currentPageMap[i]], i);
          i++;
        }
      }
    }

    function addThumbItem(pages, flipIdx) {
      const item = document.createElement('div');
      item.className = 'thumb-item';
      item.dataset.pages = pages.join(',');

      const imgWrap = document.createElement('div');
      imgWrap.className = pages.length === 1 ? 'thumb-single' : 'thumb-spread';
      for (const pageNum of pages) {
        if (pageNum === 0) continue;
        const img = document.createElement('img');
        if (renderedPages.has(pageNum)) {
          img.src = renderedPages.get(pageNum);
        } else {
          renderPageInto(pageNum, img);
        }
        imgWrap.appendChild(img);
      }
      item.appendChild(imgWrap);

      const label = document.createElement('div');
      label.className = 'thumb-label';
      const realPages = pages.filter(p => p > 0).sort((a, b) => a - b);
      label.textContent = realPages.length > 1 ? `${realPages[0]}-${realPages[1]}` : (realPages[0] || '');
      item.appendChild(label);

      item.addEventListener('click', () => {
        pageFlip.turnToPage(flipIdx);

        updatePageInfo();
        thumbOverlay.classList.add('hidden');
      });

      thumbGrid.appendChild(item);
    }

    buildThumbnails();

    function updateThumbnailActive() {
      const currentPage = String(getOriginalPage());
      thumbGrid.querySelectorAll('.thumb-item').forEach(el => {
        const pages = el.dataset.pages.split(',');
        el.classList.toggle('active', pages.includes(currentPage));
      });
    }

    btnThumbnail.addEventListener('click', () => {
      updateThumbnailActive();
      thumbOverlay.classList.toggle('hidden');
      // Scroll active thumbnail into view
      const active = thumbGrid.querySelector('.thumb-item.active');
      if (active) active.scrollIntoView({ block: 'center', behavior: 'smooth' });
    });

    btnThumbClose.addEventListener('click', () => {
      thumbOverlay.classList.add('hidden');
    });

    // Share
    btnShare.addEventListener('click', async () => {
      const shareUrl = window.location.href;
      if (navigator.share) {
        try {
          await navigator.share({ title: document.title, url: shareUrl });
        } catch {}
      } else {
        await navigator.clipboard.writeText(shareUrl);
        btnShare.innerHTML = '<span class="material-symbols-rounded">check</span>';
        setTimeout(() => { btnShare.innerHTML = '<span class="material-symbols-rounded">share</span>'; }, 1500);
      }
    });

    // 7. Arrow key navigation
    document.addEventListener('keydown', (e) => {
      // Ignore if thumbnail overlay is open
      if (!thumbOverlay.classList.contains('hidden')) {
        if (e.key === 'Escape') thumbOverlay.classList.add('hidden');
        return;
      }
      // Escape exits zoom mode
      if (e.key === 'Escape' && zoomLevel > 1) {
        resetZoom();
        return;
      }
      // Zoom shortcuts
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
      // Page navigation only when not zoomed in
      if (zoomLevel <= 1) {
        if (e.key === 'ArrowRight') flipNext();
        if (e.key === 'ArrowLeft') flipPrev();
        if (e.key === 'Home') goFirst();
        if (e.key === 'End') goLast();
      }
    });
  } catch (err) {
    loadingEl.textContent = `Error: ${err.message}`;
    console.error('Failed to load PDF:', err);
  }
}

init();
