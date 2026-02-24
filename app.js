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
    let currentShowCover = true;
    let lastSoundTime = 0;

    // Build page DOM elements and init StPageFlip
    function buildBook(rtl, targetOriginalPage) {
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

      // Calculate page dimensions that fit the book area
      // (prevents StPageFlip container vs page size mismatch)
      const bookArea = document.getElementById('book-area');
      const aspectRatio = pageWidth / pageHeight;
      const viewW = bookArea.clientWidth;
      const viewH = bookArea.clientHeight;

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

      // RTL: P1 is at the end of reversed entries and must display alone.
      // showCover always treats index 0 as cover. For RTL, P1 is alone when:
      //   even total → showCover: true  → cover(Pn) + odd remaining → P1 = back cover
      //   odd total  → showCover: false → all paired, last odd page alone = P1
      const useShowCover = rtl ? (totalBookPages % 2 === 0) : true;
      currentShowCover = useShowCover;

      pageFlip = new St.PageFlip(bookEl, {
        width: fitW,
        height: fitH,
        size: 'stretch',
        maxWidth: fitW,
        maxHeight: fitH,
        flippingTime: 450,
        maxShadowOpacity: 0.3,
        showCover: useShowCover,
        mobileScrollSupport: false,
        autoSize: true,
        startPage: targetOriginalPage !== undefined
          ? currentPageMap.indexOf(targetOriginalPage)
          : (rtl ? totalBookPages - 1 : 0),
      });
      pageFlip.loadFromHTML(bookEl.querySelectorAll('.page'));
      pageFlip.on('flip', () => {
        // Play sound for drag flips (debounced to avoid double with button flips)
        const now = Date.now();
        if (now - lastSoundTime > 500) {
          flipSound();
          lastSoundTime = now;
        }
        updatePageInfo();
      });
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
      const maxEdge = Math.min(Math.ceil(numPages / 4), 20);

      let readProgress = idx / Math.max(total - 1, 1);
      if (isRtl) readProgress = 1 - readProgress;

      const readW = Math.round(readProgress * maxEdge);
      const unreadW = maxEdge - readW;
      const lw = isRtl ? unreadW : readW;
      const rw = isRtl ? readW : unreadW;

      const h = rect.height;
      const top = rect.top;

      edgeLeft.style.cssText = `position:fixed;top:${top}px;height:${h}px;left:${rect.left - lw}px;width:${lw}px`;
      edgeRight.style.cssText = `position:fixed;top:${top}px;height:${h}px;left:${rect.right}px;width:${rw}px`;
    }

    let resizeTimer;
    window.addEventListener('resize', () => {
      loadingEl.textContent = 'Resizing...';
      loadingEl.classList.remove('hidden');
      clearTimeout(resizeTimer);
      resizeTimer = setTimeout(() => {
        const currentOriginalPage = getOriginalPage();
        buildBook(isRtl, currentOriginalPage);
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
    const btnRtl = document.getElementById('btn-rtl');

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

      // Check if current view is a spread (two pages visible)
      const isSpreadStart = currentShowCover
        ? (idx > 0 && idx % 2 === 1)
        : (idx % 2 === 0);

      if (isSpreadStart && idx + 1 < total) {
        const page2 = currentPageMap[idx + 1];
        const lo = Math.min(page1, page2);
        const hi = Math.max(page1, page2);
        pageInfoEl.textContent = `${lo}-${hi} / ${numPages}`;
        pageSlider.value = lo;
      } else {
        pageInfoEl.textContent = `${page1} / ${numPages}`;
        pageSlider.value = page1;
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
      const current = pageFlip.getCurrentPageIndex();
      if (current === targetIdx) return;

      if (Math.abs(current - targetIdx) <= 2) {
        flipPrev();
        return;
      }

      // Jump to one spread before target, then immediately flip
      const nearIdx = isRtl
        ? Math.max(0, targetIdx - 2)
        : Math.min(currentPageMap.length - 1, targetIdx + 2);
      pageFlip.turnToPage(nearIdx);
      flipPrev();
      updatePageEdges(targetIdx);
    }

    function goLast() {
      const targetIdx = isRtl ? 0 : currentPageMap.length - 1;
      const current = pageFlip.getCurrentPageIndex();
      if (current === targetIdx) return;

      if (Math.abs(current - targetIdx) <= 2) {
        flipNext();
        return;
      }

      const nearIdx = isRtl
        ? Math.min(currentPageMap.length - 1, targetIdx + 2)
        : Math.max(0, targetIdx - 2);
      pageFlip.turnToPage(nearIdx);
      flipNext();
      updatePageEdges(targetIdx);
    }

    updatePageInfo();
    toolbar.classList.add('visible');

    btnPrev.addEventListener('click', () => flipPrev());
    btnNext.addEventListener('click', () => flipNext());
    btnFirst.addEventListener('click', () => goFirst());
    btnLast.addEventListener('click', () => goLast());

    // Page slider: jump to page on input
    pageSlider.addEventListener('input', () => {
      const targetPage = parseInt(pageSlider.value);
      const targetIdx = currentPageMap.indexOf(targetPage);
      if (targetIdx >= 0) {
        pageFlip.turnToPage(targetIdx);
        updatePageEdges(targetIdx);
        updatePageInfo();
      }
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

      buildBook(isRtl, currentOriginalPage);
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

    // Build thumbnail grid once
    for (let i = 0; i < pageImages.length; i++) {
      const item = document.createElement('div');
      item.className = 'thumb-item';
      item.dataset.page = i + 1;

      const img = document.createElement('img');
      img.src = pageImages[i].dataUrl;
      item.appendChild(img);

      const label = document.createElement('div');
      label.className = 'thumb-label';
      label.textContent = i + 1;
      item.appendChild(label);

      item.addEventListener('click', () => {
        const targetIdx = currentPageMap.indexOf(i + 1);
        if (targetIdx >= 0) {
          pageFlip.turnToPage(targetIdx);
          updatePageEdges(targetIdx);
          updatePageInfo();
        }
        thumbOverlay.classList.add('hidden');
      });

      thumbGrid.appendChild(item);
    }

    function updateThumbnailActive() {
      const current = getOriginalPage();
      thumbGrid.querySelectorAll('.thumb-item').forEach(el => {
        el.classList.toggle('active', parseInt(el.dataset.page) === current);
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
      if (e.key === 'ArrowRight') flipNext();
      if (e.key === 'ArrowLeft') flipPrev();
      if (e.key === 'Home') goFirst();
      if (e.key === 'End') goLast();
    });
  } catch (err) {
    loadingEl.textContent = `Error: ${err.message}`;
    console.error('Failed to load PDF:', err);
  }
}

init();
