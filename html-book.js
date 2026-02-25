const bookArea = document.getElementById('book-area');
const pageInfoEl = document.getElementById('page-info');
const fontInfoEl = document.getElementById('font-info');
const contentSource = document.getElementById('content-source');

const PAGE_ASPECT = 3 / 4;
const params = new URLSearchParams(window.location.search);
let currentPageIdx = params.has('p') ? Math.max(0, parseInt(params.get('p')) - 1) : 0;

let bookEl = document.getElementById('book');
let pageFlip = null;
let fontScale = 1.0;
const FONT_STEP = 0.1;
const FONT_MIN = 0.5;
const FONT_MAX = 2.5;

// Offscreen measuring container
const measureContainer = document.createElement('div');
measureContainer.id = 'measure-container';
document.body.appendChild(measureContainer);

function getPageDimensions() {
  const areaStyle = getComputedStyle(bookArea);
  const viewW = bookArea.clientWidth - parseFloat(areaStyle.paddingLeft) - parseFloat(areaStyle.paddingRight);
  const viewH = bookArea.clientHeight - parseFloat(areaStyle.paddingTop) - parseFloat(areaStyle.paddingBottom);

  let fitW = Math.round(viewH * PAGE_ASPECT);
  let fitH = viewH;

  if (fitW * 2 > viewW) {
    fitW = Math.floor(viewW / 2);
    fitH = Math.round(fitW / PAGE_ASPECT);
  }

  return { fitW, fitH };
}

// Paginate: split source content into pages that fit
function paginate(fitW, fitH) {
  measureContainer.innerHTML = '';
  measureContainer.style.width = fitW + 'px';

  const sourceNodes = Array.from(contentSource.children);
  const pages = [];
  let currentPageContent = createMeasurePage(fitH);

  for (const node of sourceNodes) {
    const clone = node.cloneNode(true);
    currentPageContent.appendChild(clone);

    if (currentPageContent.scrollHeight > currentPageContent.clientHeight) {
      currentPageContent.removeChild(clone);
      pages.push(extractPageNodes(currentPageContent));

      currentPageContent = createMeasurePage(fitH);
      currentPageContent.appendChild(clone);

      if (currentPageContent.scrollHeight > currentPageContent.clientHeight) {
        pages.push(extractPageNodes(currentPageContent));
        currentPageContent = createMeasurePage(fitH);
      }
    }
  }

  if (currentPageContent.children.length > 0) {
    pages.push(extractPageNodes(currentPageContent));
  }

  return pages;
}

function createMeasurePage(fitH) {
  const pageContent = document.createElement('div');
  pageContent.className = 'page-content';
  pageContent.style.height = fitH + 'px';
  pageContent.style.overflow = 'hidden';
  measureContainer.innerHTML = '';
  measureContainer.appendChild(pageContent);
  return pageContent;
}

function extractPageNodes(pageContent) {
  const nodes = [];
  while (pageContent.firstChild) {
    nodes.push(pageContent.removeChild(pageContent.firstChild));
  }
  return nodes;
}

function buildBook() {
  const { fitW, fitH } = getPageDimensions();
  const pages = paginate(fitW, fitH);

  // Save current page before destroy
  if (pageFlip) {
    currentPageIdx = pageFlip.getCurrentPageIndex();
  }

  // Destroy old instance
  if (pageFlip) {
    try { pageFlip.destroy(); } catch {}
  }

  // Create new book container
  const newBookEl = document.createElement('div');
  newBookEl.id = 'book';
  const oldBook = document.getElementById('book');
  if (oldBook && oldBook.parentNode) {
    oldBook.parentNode.replaceChild(newBookEl, oldBook);
  } else {
    bookArea.appendChild(newBookEl);
  }
  bookEl = newBookEl;

  // Cover page
  const coverDiv = document.createElement('div');
  coverDiv.className = 'page page-cover';
  coverDiv.innerHTML = `<div class="page-content">
    <h1>HTML Flipbook</h1>
    <p class="subtitle">${pages.length} pages at ${Math.round(fontScale * 100)}% font</p>
  </div>`;
  bookEl.appendChild(coverDiv);

  // Content pages
  for (const pageNodes of pages) {
    const pageDiv = document.createElement('div');
    pageDiv.className = 'page';
    const contentDiv = document.createElement('div');
    contentDiv.className = 'page-content';
    for (const node of pageNodes) {
      contentDiv.appendChild(node);
    }
    pageDiv.appendChild(contentDiv);
    bookEl.appendChild(pageDiv);
  }

  // Back cover
  const backDiv = document.createElement('div');
  backDiv.className = 'page page-cover page-back';
  backDiv.innerHTML = `<div class="page-content"><h1>The End</h1></div>`;
  bookEl.appendChild(backDiv);

  // Init StPageFlip
  const totalPages = bookEl.querySelectorAll('.page').length;
  const targetPage = Math.min(currentPageIdx, totalPages - 1);

  pageFlip = new St.PageFlip(bookEl, {
    width: fitW,
    height: fitH,
    size: 'stretch',
    maxWidth: fitW,
    maxHeight: fitH,
    autoSize: true,
    showCover: true,
    usePortrait: true,
    maxShadowOpacity: 0.5,
    mobileScrollSupport: false,
    flippingTime: 800,
    startPage: targetPage,
  });

  pageFlip.loadFromHTML(bookEl.querySelectorAll('.page'));
  pageFlip.on('flip', () => updatePageInfo());
  updatePageInfo();

  // Make interactive elements clickable
  bookEl.querySelectorAll('button, a, input, select, textarea, [data-interactive]').forEach(el => {
    el.addEventListener('mousedown', (e) => e.stopPropagation());
    el.addEventListener('touchstart', (e) => e.stopPropagation());
  });
}

function updatePageInfo() {
  if (!pageFlip) return;
  const idx = pageFlip.getCurrentPageIndex();
  const total = bookEl.querySelectorAll('.page').length;
  pageInfoEl.textContent = `${idx + 1} / ${total}`;

  // Update URL parameter without reload
  const url = new URL(window.location);
  url.searchParams.set('p', idx + 1);
  history.replaceState(null, '', url);
}

function applyFontScale() {
  document.documentElement.style.setProperty('--font-scale', fontScale);
  fontInfoEl.textContent = `${Math.round(fontScale * 100)}%`;
  buildBook();
}

// Ensure CSS is ready before first pagination
document.documentElement.style.setProperty('--font-scale', fontScale);
// Wait for images and layout to settle before paginating
window.addEventListener('load', () => buildBook());
buildBook();

// Resize
let resizeTimer;
window.addEventListener('resize', () => {
  clearTimeout(resizeTimer);
  resizeTimer = setTimeout(() => buildBook(), 200);
});

// Navigation
document.getElementById('btn-prev').addEventListener('click', () => pageFlip.flipPrev());
document.getElementById('btn-next').addEventListener('click', () => pageFlip.flipNext());

// Font size controls
document.getElementById('btn-font-up').addEventListener('click', () => {
  if (fontScale < FONT_MAX) {
    fontScale = Math.min(FONT_MAX, +(fontScale + FONT_STEP).toFixed(1));
    applyFontScale();
  }
});

document.getElementById('btn-font-down').addEventListener('click', () => {
  if (fontScale > FONT_MIN) {
    fontScale = Math.max(FONT_MIN, +(fontScale - FONT_STEP).toFixed(1));
    applyFontScale();
  }
});

// Keyboard
document.addEventListener('keydown', (e) => {
  if (e.key === 'ArrowLeft') pageFlip.flipPrev();
  if (e.key === 'ArrowRight') pageFlip.flipNext();
});
