const bookArea = document.getElementById('book-area');
let bookEl = document.getElementById('book');
const pageInfoEl = document.getElementById('page-info');
const totalPages = bookEl.querySelectorAll('.page').length;

// Design aspect ratio for pages (A4-ish: 3:4)
const PAGE_ASPECT = 3 / 4;

let pageFlip = null;

function buildBook() {
  // Save current page before rebuild
  let startPage = 0;
  if (pageFlip) {
    startPage = pageFlip.getCurrentPageIndex();
    try { pageFlip.destroy(); } catch {}
  }

  // Recreate book container (destroy removes DOM)
  const parentEl = bookArea;
  const newBookEl = document.createElement('div');
  newBookEl.id = 'book';

  // Move all page divs from old (or template) to new container
  const oldBook = document.getElementById('book');
  if (oldBook) {
    while (oldBook.firstChild) {
      newBookEl.appendChild(oldBook.firstChild);
    }
    oldBook.parentNode.replaceChild(newBookEl, oldBook);
  } else {
    parentEl.appendChild(newBookEl);
  }
  bookEl = newBookEl;

  // Calculate viewport-fitting dimensions (same logic as PDF viewer)
  const areaStyle = getComputedStyle(bookArea);
  const viewW = bookArea.clientWidth - parseFloat(areaStyle.paddingLeft) - parseFloat(areaStyle.paddingRight);
  const viewH = bookArea.clientHeight - parseFloat(areaStyle.paddingTop) - parseFloat(areaStyle.paddingBottom);

  let fitW = Math.round(viewH * PAGE_ASPECT);
  let fitH = viewH;

  // Double page: fit two pages side by side
  if (fitW * 2 > viewW) {
    fitW = Math.floor(viewW / 2);
    fitH = Math.round(fitW / PAGE_ASPECT);
  }

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
    startPage: startPage,
  });

  pageFlip.loadFromHTML(bookEl.querySelectorAll('.page'));
  pageFlip.on('flip', () => updatePageInfo());
  updatePageInfo();

  // Make interactive elements clickable by stopping event propagation
  // so StPageFlip doesn't interpret clicks as flip gestures
  bookEl.querySelectorAll('button, a, input, select, textarea, [data-interactive]').forEach(el => {
    el.addEventListener('mousedown', (e) => e.stopPropagation());
    el.addEventListener('touchstart', (e) => e.stopPropagation());
  });
}

function updatePageInfo() {
  if (!pageFlip) return;
  const idx = pageFlip.getCurrentPageIndex();
  pageInfoEl.textContent = `${idx + 1} / ${totalPages}`;
}

// Build initial book
buildBook();

// Rebuild on resize
let resizeTimer;
window.addEventListener('resize', () => {
  clearTimeout(resizeTimer);
  resizeTimer = setTimeout(() => buildBook(), 200);
});

// Navigation
document.getElementById('btn-prev').addEventListener('click', () => pageFlip.flipPrev());
document.getElementById('btn-next').addEventListener('click', () => pageFlip.flipNext());

document.addEventListener('keydown', (e) => {
  if (e.key === 'ArrowLeft') pageFlip.flipPrev();
  if (e.key === 'ArrowRight') pageFlip.flipNext();
});
