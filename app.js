import * as pdfjsLib from 'https://cdn.jsdelivr.net/npm/pdfjs-dist@4.8.69/build/pdf.min.mjs';

// Configure PDF.js worker
pdfjsLib.GlobalWorkerOptions.workerSrc =
  'https://cdn.jsdelivr.net/npm/pdfjs-dist@4.8.69/build/pdf.worker.min.mjs';

const RENDER_SCALE = 1.5;
const PDF_URL = './sample.pdf';

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
  const bookEl = document.getElementById('book');

  try {
    // 1. Load PDF
    const pdf = await pdfjsLib.getDocument(PDF_URL).promise;
    const numPages = pdf.numPages;

    // 2. Render all pages to images
    const pages = [];
    for (let i = 1; i <= numPages; i++) {
      loadingEl.textContent = `Rendering page ${i} of ${numPages}...`;
      const pageData = await renderPageToImage(pdf, i);
      pages.push(pageData);
    }

    // 3. Get page dimensions from first page
    const pageWidth = Math.round(pages[0].width);
    const pageHeight = Math.round(pages[0].height);

    // 4. Create page DOM elements inside #book
    for (const page of pages) {
      const div = document.createElement('div');
      div.className = 'page';

      const img = document.createElement('img');
      img.src = page.dataUrl;
      div.appendChild(img);

      bookEl.appendChild(div);
    }

    // 5. Hide loading indicator
    loadingEl.classList.add('hidden');

    // 6. Initialize StPageFlip
    const pageFlip = new St.PageFlip(bookEl, {
      width: pageWidth,
      height: pageHeight,
      size: 'stretch',
      maxShadowOpacity: 0.5,
      showCover: true,
      mobileScrollSupport: false,
    });

    pageFlip.loadFromHTML(document.querySelectorAll('.page'));
  } catch (err) {
    loadingEl.textContent = `Error: ${err.message}`;
    console.error('Failed to load PDF:', err);
  }
}

init();
