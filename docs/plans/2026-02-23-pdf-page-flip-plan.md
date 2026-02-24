# PDF Page Flip Demo - Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Build a demo that renders a PDF with realistic page-flip animation using PDF.js + StPageFlip, pure HTML + Vanilla JS, no build tools.

**Architecture:** Single HTML page loads two CDN libraries: PDF.js (renders each PDF page to canvas/image) and StPageFlip (provides flip animation). `app.js` orchestrates: load PDF -> render all pages as images -> feed images to StPageFlip -> user flips pages.

**Tech Stack:** PDF.js v4.8.69 (ES module via jsdelivr CDN), page-flip v2.0.7 (UMD via unpkg CDN), Vanilla JS with `<script type="module">`, no build tool.

**CDN URLs:**
- PDF.js: `https://cdn.jsdelivr.net/npm/pdfjs-dist@4.8.69/build/pdf.min.mjs`
- PDF.js Worker: `https://cdn.jsdelivr.net/npm/pdfjs-dist@4.8.69/build/pdf.worker.min.mjs`
- page-flip: `https://unpkg.com/page-flip@2.0.7/dist/page-flip.browser.js`

---

### Task 1: Create index.html with CDN imports

**Files:**
- Create: `index.html`

**Step 1: Create the HTML file**

```html
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>PDF Page Flip Demo</title>
  <link rel="stylesheet" href="style.css">
</head>
<body>
  <div id="book"></div>
  <div id="loading">Loading PDF...</div>

  <!-- StPageFlip (UMD, exposes St.PageFlip globally) -->
  <script src="https://unpkg.com/page-flip@2.0.7/dist/page-flip.browser.js"></script>

  <!-- App (ES module, imports PDF.js) -->
  <script type="module" src="app.js"></script>
</body>
</html>
```

**Step 2: Verify file exists**

Run: `cat index.html | head -5`
Expected: Shows the DOCTYPE and opening tags.

**Step 3: Commit**

```bash
git add index.html
git commit -m "feat: add index.html with CDN imports for PDF.js and StPageFlip"
```

---

### Task 2: Create style.css

**Files:**
- Create: `style.css`

**Step 1: Create the CSS file**

```css
* {
  margin: 0;
  padding: 0;
  box-sizing: border-box;
}

body {
  display: flex;
  justify-content: center;
  align-items: center;
  min-height: 100vh;
  background: #1a1a2e;
  overflow: hidden;
}

#book {
  position: relative;
}

#loading {
  position: fixed;
  top: 50%;
  left: 50%;
  transform: translate(-50%, -50%);
  color: #e0e0e0;
  font-family: system-ui, sans-serif;
  font-size: 1.2rem;
}

#loading.hidden {
  display: none;
}

.page {
  background: white;
  display: flex;
  justify-content: center;
  align-items: center;
}

.page img {
  width: 100%;
  height: 100%;
  object-fit: contain;
}
```

**Step 2: Commit**

```bash
git add style.css
git commit -m "feat: add minimal styling for page-flip demo"
```

---

### Task 3: Create app.js - PDF rendering + StPageFlip integration

**Files:**
- Create: `app.js`

**Step 1: Create app.js with the complete logic**

This is the core file. It does three things:
1. Uses PDF.js to load the PDF and render each page to an offscreen canvas
2. Converts each canvas to an image data URL
3. Dynamically creates page divs and initializes StPageFlip

```javascript
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
```

**Key implementation notes for the implementing engineer:**
- `renderPageToImage` creates an offscreen canvas per page, renders the PDF page to it, then extracts a data URL. This avoids needing to manage canvas elements in the DOM.
- Pages are rendered sequentially (not in parallel) because PDF.js has constraints on simultaneous renders.
- `St.PageFlip` is available globally because `page-flip.browser.js` is loaded as a regular script before our module.
- `showCover: true` makes the first and last pages act as hard covers.
- `size: 'stretch'` makes the book responsive to its container.

**Step 2: Commit**

```bash
git add app.js
git commit -m "feat: add core PDF rendering and page-flip logic"
```

---

### Task 4: Add a sample PDF and test the demo

**Files:**
- Create: `sample.pdf` (a small test PDF)

**Step 1: Generate a sample PDF**

We need a small multi-page PDF for testing. Create one using Python (available on macOS):

```bash
python3 -c "
from reportlab.lib.pagesizes import A4
from reportlab.pdfgen import canvas as cv

c = cv.Canvas('sample.pdf', pagesize=A4)
w, h = A4
colors = ['#FF6B6B', '#4ECDC4', '#45B7D1', '#96CEB4', '#FFEAA7', '#DDA0DD']
for i, color in enumerate(colors):
    r = int(color[1:3], 16) / 255
    g = int(color[3:5], 16) / 255
    b = int(color[5:7], 16) / 255
    c.setFillColorRGB(r, g, b)
    c.rect(0, 0, w, h, fill=1)
    c.setFillColorRGB(1, 1, 1)
    c.setFont('Helvetica-Bold', 48)
    c.drawCentredString(w/2, h/2, f'Page {i+1}')
    c.showPage()
c.save()
print('Created sample.pdf with 6 pages')
"
```

If `reportlab` is not installed, install it first: `pip3 install reportlab`

Alternative (if reportlab is unavailable): Download any small public-domain PDF from the internet, or use a blank PDF generator.

**Step 2: Start a local server and test in browser**

Run: `npx serve .`

Then open `http://localhost:3000` in a browser.

**Expected result:**
- Loading text appears briefly ("Rendering page 1 of 6...")
- Book appears centered on dark background
- Click right side to flip forward, left side to flip back
- Drag from corner for manual flip animation
- Pages show colored backgrounds with "Page 1", "Page 2", etc.

**Step 3: Commit**

```bash
git add sample.pdf
git commit -m "feat: add sample PDF and complete demo"
```

---

### Task 5: Troubleshoot and fix any issues

This task is a buffer for common issues that may arise:

**Issue: CORS error when loading PDF**
- Fix: Must use a local server (`npx serve .`), not `file://` protocol
- PDF.js requires HTTP(S) to load files

**Issue: `St is not defined`**
- Fix: Ensure `page-flip.browser.js` script tag comes BEFORE the module script tag
- Check browser console for 404 on the unpkg URL

**Issue: PDF.js worker error**
- Fix: Check that the worker URL version matches the main library version
- Try opening the worker URL directly in browser to verify it loads

**Issue: StPageFlip doesn't animate / pages are invisible**
- Fix: Ensure `.page` divs have explicit dimensions from CSS
- Check that `width` and `height` passed to PageFlip match the rendered page size
- Try `size: 'fixed'` instead of `'stretch'` to debug sizing issues

**Issue: pdfjs-dist v4 import fails**
- Fallback: Try pdfjs-dist v3.11.174 with regular script tag:
  ```html
  <script src="https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.min.js"></script>
  <script src="https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js"></script>
  ```
  Then change `app.js` to a regular script (remove `import`, use global `pdfjsLib`).

**No commit for this task unless changes are made.**
