# Canvas 2D Page Curl Engine Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace flat CSS clip-path flip animation with Canvas 2D page curl engine featuring bezier curve fold edges, mesh deformation (page bending), and realistic per-strip lighting — approaching FlipHTML5-level visual quality.

**Architecture:** The existing `CanvasRender` / `ImagePage` / `FlipCalculation` pipeline remains intact. We add a `CurlCalculation` module that computes bezier fold curves and mesh strip geometry from FlipCalculation's existing angle/position output. `ImagePage.draw()` is upgraded to render the page as deformed mesh strips with per-strip lighting. Shadows in `CanvasRender` are enhanced with curl-aware gradients. Finally, `app.js` switches from `loadFromHTML` to `loadFromImages` with lazy-loading support via the existing `renderPages` event.

**Tech Stack:** TypeScript, Canvas 2D API (`bezierCurveTo`, `drawImage` with source/dest rects, `createLinearGradient`), Rollup build

---

## File Structure

| File | Action | Responsibility |
|------|--------|---------------|
| `src/Flip/CurlCalculation.ts` | **Create** | Bezier curl curve math: takes fold line → outputs control points, mesh strip positions, per-strip angles |
| `src/BasicTypes.ts` | **Modify** | Add `CurlStrip` and `CurlData` type definitions |
| `src/Page/Page.ts` | **Modify** | Add `curlData` to `PageState` interface |
| `src/Page/ImagePage.ts` | **Modify** | Add `drawCurled()` method using mesh strip rendering |
| `src/Flip/FlipCalculation.ts` | **Modify** | Expose fold line endpoints for CurlCalculation consumption |
| `src/Flip/Flip.ts` | **Modify** | Compute curl data via CurlCalculation and pass to page state |
| `src/Render/CanvasRender.ts` | **Modify** | Enhanced shadow system: curl-aware outer/inner shadows, book spine |
| `src/Settings.ts` | **Modify** | Add `curlIntensity` and `meshStripCount` settings |
| `app.js` | **Modify** | Switch from `loadFromHTML` to `loadFromImages` with lazy loading |

---

### Task 1: Add Types and Settings

**Files:**
- Modify: `src/BasicTypes.ts`
- Modify: `src/Settings.ts`

- [ ] **Step 1: Add CurlStrip and CurlData types to BasicTypes.ts**

Add after the `Segment` type at the end of the file:

```typescript
/**
 * A single vertical strip of a curled page mesh
 */
export interface CurlStrip {
    /** Normalized position along page width (0 = spine, 1 = edge) */
    t: number;
    /** X offset of this strip in page-local coordinates */
    x: number;
    /** Width of this strip in pixels */
    width: number;
    /** Rotation angle of this strip (radians) — simulates page bend */
    angle: number;
    /** Y offset caused by the curl lifting the strip */
    yOffset: number;
    /** Lighting multiplier (0 = dark, 1 = normal, >1 = highlight) */
    light: number;
}

/**
 * Complete curl geometry for one animation frame
 */
export interface CurlData {
    /** Ordered mesh strips from spine to fold edge */
    strips: CurlStrip[];
    /** Bezier control points for the curved fold edge [start, cp1, cp2, end] */
    foldCurve: [Point, Point, Point, Point];
    /** Overall curl intensity (0 = flat, 1 = max curl) */
    intensity: number;
}
```

- [ ] **Step 2: Add curl settings to Settings.ts**

Add to `FlipSetting` interface before the closing brace:

```typescript
    /** Curl bend intensity (0 = flat flip, 1 = deep curl). Default 0.5 */
    curlIntensity: number;

    /** Number of vertical strips for mesh deformation. Default 20 */
    meshStripCount: number;
```

Add defaults in `Settings._default`:

```typescript
        curlIntensity: 0.5,
        meshStripCount: 20,
```

- [ ] **Step 3: Build to verify no errors**

Run: `cd lib/st-page-flip && npm run build`
Expected: Clean build, no errors

- [ ] **Step 4: Commit**

```bash
git add lib/st-page-flip/src/BasicTypes.ts lib/st-page-flip/src/Settings.ts
git commit -m "feat(curl): add CurlStrip, CurlData types and curl settings"
```

---

### Task 2: Create CurlCalculation Module

**Files:**
- Create: `src/Flip/CurlCalculation.ts`

This is the core math engine. It takes the fold line position (from FlipCalculation) and produces bezier curve control points and mesh strip geometry.

- [ ] **Step 1: Create CurlCalculation.ts**

```typescript
import { Point, CurlStrip, CurlData } from '../BasicTypes';

/**
 * Calculates page curl geometry: bezier fold curve and mesh strip positions.
 *
 * The curl model works by:
 * 1. Taking the straight fold line (from FlipCalculation's intersection points)
 * 2. Bowing it into a bezier curve to simulate paper bending
 * 3. Dividing the page into vertical strips
 * 4. Computing each strip's rotation angle and position along the curl
 */
export class CurlCalculation {
    /**
     * Compute full curl geometry for one animation frame.
     *
     * @param foldTop - Top point where fold line meets page boundary
     * @param foldBottom - Bottom point where fold line meets page boundary
     * @param progress - Flip progress 0-100
     * @param pageWidth - Current page width in pixels
     * @param pageHeight - Current page height in pixels
     * @param intensity - Curl bend intensity (0-1, from settings)
     * @param stripCount - Number of mesh strips (from settings)
     */
    public static calc(
        foldTop: Point,
        foldBottom: Point,
        progress: number,
        pageWidth: number,
        pageHeight: number,
        intensity: number,
        stripCount: number
    ): CurlData {
        const foldCurve = CurlCalculation.calcFoldCurve(
            foldTop, foldBottom, progress, pageWidth, intensity
        );

        const strips = CurlCalculation.calcStrips(
            progress, pageWidth, pageHeight, intensity, stripCount
        );

        return {
            strips,
            foldCurve,
            intensity: intensity * CurlCalculation.progressToIntensity(progress),
        };
    }

    /**
     * Convert flip progress to curl intensity curve.
     * Curl is strongest in the middle of the flip, weakest at start/end.
     */
    private static progressToIntensity(progress: number): number {
        // Bell curve: peaks at 50% progress
        const t = progress / 100;
        return Math.sin(t * Math.PI);
    }

    /**
     * Calculate bezier control points for the curved fold edge.
     * The fold line bows outward to simulate paper rigidity.
     */
    private static calcFoldCurve(
        foldTop: Point,
        foldBottom: Point,
        progress: number,
        pageWidth: number,
        intensity: number
    ): [Point, Point, Point, Point] {
        // How much the fold bows outward (peaks mid-flip)
        const bowAmount = pageWidth * 0.15 * intensity * CurlCalculation.progressToIntensity(progress);

        const midY1 = foldTop.y + (foldBottom.y - foldTop.y) * 0.33;
        const midY2 = foldTop.y + (foldBottom.y - foldTop.y) * 0.66;

        // Bow the control points toward the page edge (away from spine)
        const cp1: Point = {
            x: foldTop.x + bowAmount,
            y: midY1,
        };
        const cp2: Point = {
            x: foldBottom.x + bowAmount,
            y: midY2,
        };

        return [foldTop, cp1, cp2, foldBottom];
    }

    /**
     * Calculate mesh strip positions and rotations.
     * Strips near the fold edge rotate more (page curls away from surface).
     */
    private static calcStrips(
        progress: number,
        pageWidth: number,
        pageHeight: number,
        intensity: number,
        stripCount: number
    ): CurlStrip[] {
        const strips: CurlStrip[] = [];
        const stripWidth = pageWidth / stripCount;
        const curlFactor = intensity * CurlCalculation.progressToIntensity(progress);

        for (let i = 0; i < stripCount; i++) {
            const t = i / stripCount; // 0 = spine side, 1 = fold edge side

            // Strips near the fold edge curl more
            // Use a power curve: strips close to fold get most rotation
            const curlT = Math.pow(t, 2);

            // Max rotation angle for outermost strip (in radians)
            // ~30 degrees at max curl
            const maxAngle = (Math.PI / 6) * curlFactor;
            const angle = curlT * maxAngle;

            // Y offset: page lifts off the surface as it curls
            const maxLift = pageHeight * 0.02 * curlFactor;
            const yOffset = -curlT * maxLift;

            // Lighting: strips facing up get highlight, facing away get shadow
            // Normal page = 1.0, curled highlight = 1.15, curled shadow = 0.7
            const light = 1.0 + (curlT * 0.15 * curlFactor) - (Math.pow(curlT, 3) * 0.45 * curlFactor);

            strips.push({
                t,
                x: i * stripWidth,
                width: stripWidth + 0.5, // +0.5 prevents sub-pixel gaps
                angle,
                yOffset,
                light,
            });
        }

        return strips;
    }
}
```

- [ ] **Step 2: Build to verify**

Run: `cd lib/st-page-flip && npm run build`
Expected: Clean build

- [ ] **Step 3: Commit**

```bash
git add lib/st-page-flip/src/Flip/CurlCalculation.ts
git commit -m "feat(curl): add CurlCalculation module with bezier fold curve and mesh strip math"
```

---

### Task 3: Add Curl Data to Page State and FlipCalculation

**Files:**
- Modify: `src/Page/Page.ts` — add `curlData` to PageState
- Modify: `src/Flip/FlipCalculation.ts` — expose fold line endpoints
- Modify: `src/Flip/Flip.ts` — compute and pass curl data

- [ ] **Step 1: Add curlData to PageState in Page.ts**

Import `CurlData` and add to the interface:

```typescript
import { Point, CurlData } from '../BasicTypes';
```

Add field to `PageState` interface after `hardDrawingAngle`:

```typescript
    /** Curl deformation data for Canvas rendering */
    curlData: CurlData | null;
```

Add default in the constructor's state initialization:

```typescript
        this.state = {
            angle: 0,
            area: [],
            position: { x: 0, y: 0 },
            hardAngle: 0,
            hardDrawingAngle: 0,
            curlData: null,
        };
```

Add setter method after `setArea()`:

```typescript
    /**
     * Set curl deformation data
     */
    public setCurlData(curlData: CurlData | null): void {
        this.state.curlData = curlData;
    }
```

- [ ] **Step 2: Expose fold line in FlipCalculation.ts**

Add public method after `getShadowAngle()`:

```typescript
    /**
     * Get the fold line endpoints (top and bottom intersection points).
     * Used by CurlCalculation to compute the bezier fold curve.
     */
    public getFoldLine(): [Point, Point] {
        return [
            this.topIntersectPoint || { x: this.pageWidth, y: 0 },
            this.bottomIntersectPoint || { x: this.pageWidth, y: this.pageHeight },
        ];
    }
```

- [ ] **Step 3: Compute curl data in Flip.ts**

Add import at top of Flip.ts:

```typescript
import { CurlCalculation } from './CurlCalculation';
```

In the `do()` method, after `this.render.setShadowData(...)` (around line 210), add:

```typescript
            // Compute curl data for Canvas rendering
            const settings = this.app.getSettings();
            if (settings.curlIntensity > 0) {
                const [foldTop, foldBottom] = this.calc.getFoldLine();
                const curlData = CurlCalculation.calc(
                    foldTop,
                    foldBottom,
                    progress,
                    rect.pageWidth,
                    rect.height,
                    settings.curlIntensity,
                    settings.meshStripCount
                );
                this.flippingPage.setCurlData(curlData);
            }
```

- [ ] **Step 4: Build and verify**

Run: `cd lib/st-page-flip && npm run build`
Expected: Clean build

- [ ] **Step 5: Commit**

```bash
git add lib/st-page-flip/src/Page/Page.ts lib/st-page-flip/src/Flip/FlipCalculation.ts lib/st-page-flip/src/Flip/Flip.ts
git commit -m "feat(curl): wire curl data from FlipCalculation through Flip to PageState"
```

---

### Task 4: Implement Mesh Strip Rendering in ImagePage

**Files:**
- Modify: `src/Page/ImagePage.ts`

This is the visual core — drawing the page image as deformed mesh strips with per-strip lighting.

- [ ] **Step 1: Add drawCurled method to ImagePage.ts**

Add import at top:

```typescript
import { CurlData } from '../BasicTypes';
```

Add the `drawCurled` method after the existing `draw()` method:

```typescript
    /**
     * Draw the page with curl deformation using mesh strips.
     * Each strip is a vertical slice of the page image, drawn with
     * rotation and lighting to simulate paper bending.
     */
    public drawCurled(curlData: CurlData): void {
        const ctx = (this.render as CanvasRender).getContext();
        const pageWidth = this.render.getRect().pageWidth;
        const pageHeight = this.render.getRect().height;
        const pagePos = this.render.convertToGlobal(this.state.position);

        if (!this.isLoad) {
            this.drawLoader(ctx, { x: pagePos.x, y: pagePos.y }, pageWidth, pageHeight);
            return;
        }

        ctx.save();
        ctx.translate(pagePos.x, pagePos.y);
        ctx.rotate(this.state.angle);

        // Clip to the page polygon first (same as flat rendering)
        ctx.beginPath();
        for (let p of this.state.area) {
            if (p !== null) {
                p = this.render.convertToGlobal(p);
                ctx.lineTo(p.x - pagePos.x, p.y - pagePos.y);
            }
        }
        ctx.clip();

        const imgW = this.image.naturalWidth;
        const imgH = this.image.naturalHeight;

        // Draw each mesh strip with its own transform
        for (const strip of curlData.strips) {
            const srcX = (strip.t) * imgW;
            const srcW = (strip.width / pageWidth) * imgW;

            ctx.save();

            // Position at strip's x location
            ctx.translate(strip.x, strip.yOffset);

            // Rotate strip around its left edge to simulate curl
            if (strip.angle !== 0) {
                ctx.rotate(strip.angle);
            }

            // Draw the strip slice of the source image
            ctx.drawImage(
                this.image,
                srcX, 0, srcW, imgH,        // source rect
                0, 0, strip.width, pageHeight // dest rect
            );

            // Apply lighting overlay
            if (strip.light !== 1.0) {
                ctx.globalCompositeOperation = strip.light > 1.0
                    ? 'lighter'
                    : 'multiply';

                const brightness = strip.light > 1.0
                    ? Math.min((strip.light - 1.0) * 0.5, 0.15)
                    : strip.light;

                if (strip.light > 1.0) {
                    // Highlight
                    ctx.fillStyle = `rgba(255, 255, 255, ${brightness})`;
                } else {
                    // Shadow — use semi-transparent black overlay
                    ctx.globalCompositeOperation = 'source-atop';
                    ctx.fillStyle = `rgba(0, 0, 0, ${1.0 - brightness})`;
                }
                ctx.fillRect(0, 0, strip.width, pageHeight);
                ctx.globalCompositeOperation = 'source-over';
            }

            ctx.restore();
        }

        ctx.restore();
    }
```

- [ ] **Step 2: Update draw() to use curl when available**

Replace the existing `draw()` method:

```typescript
    public draw(tempDensity?: PageDensity): void {
        const ctx = (this.render as CanvasRender).getContext();

        // Use curl rendering when curl data is available
        if (this.state.curlData !== null && this.state.curlData.intensity > 0) {
            this.drawCurled(this.state.curlData);
            return;
        }

        // Original flat rendering
        const pagePos = this.render.convertToGlobal(this.state.position);
        const pageWidth = this.render.getRect().pageWidth;
        const pageHeight = this.render.getRect().height;

        ctx.save();
        ctx.translate(pagePos.x, pagePos.y);
        ctx.beginPath();

        for (let p of this.state.area) {
            if (p !== null) {
                p = this.render.convertToGlobal(p);
                ctx.lineTo(p.x - pagePos.x, p.y - pagePos.y);
            }
        }

        ctx.rotate(this.state.angle);

        ctx.clip();

        if (!this.isLoad) {
            this.drawLoader(ctx, { x: 0, y: 0 }, pageWidth, pageHeight);
        } else {
            ctx.drawImage(this.image, 0, 0, pageWidth, pageHeight);
        }

        ctx.restore();
    }
```

- [ ] **Step 3: Build and verify**

Run: `cd lib/st-page-flip && npm run build`
Expected: Clean build

- [ ] **Step 4: Commit**

```bash
git add lib/st-page-flip/src/Page/ImagePage.ts
git commit -m "feat(curl): implement mesh strip rendering with per-strip lighting in ImagePage"
```

---

### Task 5: Enhance CanvasRender Shadows

**Files:**
- Modify: `src/Render/CanvasRender.ts`

Upgrade the shadow system to work with curved page edges and produce more realistic depth.

- [ ] **Step 1: Enhance drawBookShadow with depth gradient**

Replace the `drawBookShadow` method:

```typescript
    private drawBookShadow(): void {
        const rect = this.getRect();

        this.ctx.save();
        this.ctx.beginPath();

        const shadowSize = rect.width / 20;
        this.ctx.rect(rect.left, rect.top, rect.width, rect.height);

        const shadowPos = { x: rect.left + rect.width / 2 - shadowSize / 2, y: 0 };
        this.ctx.translate(shadowPos.x, shadowPos.y);

        const outerGradient = this.ctx.createLinearGradient(0, 0, shadowSize, 0);

        outerGradient.addColorStop(0, 'rgba(0, 0, 0, 0)');
        outerGradient.addColorStop(0.3, 'rgba(0, 0, 0, 0.15)');
        outerGradient.addColorStop(0.45, 'rgba(0, 0, 0, 0.25)');
        outerGradient.addColorStop(0.5, 'rgba(0, 0, 0, 0.6)');
        outerGradient.addColorStop(0.55, 'rgba(0, 0, 0, 0.25)');
        outerGradient.addColorStop(0.7, 'rgba(0, 0, 0, 0.15)');
        outerGradient.addColorStop(1, 'rgba(0, 0, 0, 0)');

        this.ctx.clip();

        this.ctx.fillStyle = outerGradient;
        this.ctx.fillRect(0, 0, shadowSize, rect.height * 2);

        this.ctx.restore();
    }
```

- [ ] **Step 2: Add curl-aware page shadow**

Add a new method after `drawInnerShadow`:

```typescript
    /**
     * Draw a soft shadow under the curling page to simulate it lifting
     * off the surface. Only drawn when curl data is available.
     */
    private drawCurlShadow(): void {
        if (this.flippingPage === null) return;

        const state = (this.flippingPage as any).state;
        if (!state?.curlData || state.curlData.intensity < 0.05) return;

        const rect = this.getRect();
        const curlData = state.curlData;
        const shadowPos = this.convertToGlobal(this.shadow.pos);

        this.ctx.save();

        // Clip to book area
        this.ctx.beginPath();
        this.ctx.rect(rect.left, rect.top, rect.width, rect.height);
        this.ctx.clip();

        // Soft shadow under the lifted page
        const shadowBlur = 8 * curlData.intensity;
        const shadowAlpha = 0.3 * curlData.intensity;

        this.ctx.shadowColor = `rgba(0, 0, 0, ${shadowAlpha})`;
        this.ctx.shadowBlur = shadowBlur;
        this.ctx.shadowOffsetX = 2 * curlData.intensity;
        this.ctx.shadowOffsetY = 4 * curlData.intensity;

        // Draw a filled path matching the flipping page shape
        this.ctx.beginPath();
        const pageRect = this.convertRectToGlobal(this.pageRect);
        this.ctx.moveTo(pageRect.topLeft.x, pageRect.topLeft.y);
        this.ctx.lineTo(pageRect.topRight.x, pageRect.topRight.y);
        this.ctx.lineTo(pageRect.bottomRight.x, pageRect.bottomRight.y);
        this.ctx.lineTo(pageRect.bottomLeft.x, pageRect.bottomLeft.y);
        this.ctx.closePath();

        this.ctx.fillStyle = 'rgba(0, 0, 0, 0)';
        this.ctx.fill();

        this.ctx.restore();
    }
```

- [ ] **Step 3: Update drawFrame to include curl shadow**

Replace `drawFrame()`:

```typescript
    protected drawFrame(): void {
        this.clear();

        if (this.orientation !== Orientation.PORTRAIT)
            if (this.leftPage != null) this.leftPage.simpleDraw(PageOrientation.LEFT);

        if (this.rightPage != null) this.rightPage.simpleDraw(PageOrientation.RIGHT);

        if (this.bottomPage != null) this.bottomPage.draw();

        this.drawBookShadow();

        // Draw curl lift shadow before the flipping page
        if (this.shadow != null) {
            this.drawCurlShadow();
        }

        if (this.flippingPage != null) this.flippingPage.draw();

        if (this.shadow != null) {
            this.drawOuterShadow();
            this.drawInnerShadow();
        }

        const rect = this.getRect();

        if (this.orientation === Orientation.PORTRAIT) {
            this.ctx.beginPath();
            this.ctx.rect(rect.left + rect.pageWidth, rect.top, rect.width, rect.height);
            this.ctx.clip();
        }
    }
```

- [ ] **Step 4: Build and verify**

Run: `cd lib/st-page-flip && npm run build`
Expected: Clean build

- [ ] **Step 5: Commit**

```bash
git add lib/st-page-flip/src/Render/CanvasRender.ts
git commit -m "feat(curl): enhance CanvasRender shadows with curl-aware depth and spine gradient"
```

---

### Task 6: Add Lazy Loading to loadFromImages

**Files:**
- Modify: `src/Page/ImagePage.ts` — support deferred image URL setting
- Modify: `src/PageFlip.ts` — emit renderPages in canvas mode

The current `loadFromImages` requires all image URLs upfront. We need to support placeholder images that get updated later via the `renderPages` event, matching the lazy loading pattern already used in HTML mode.

- [ ] **Step 1: Add setImageSrc method to ImagePage**

Add method after `load()` in ImagePage.ts:

```typescript
    /**
     * Update the image source (for lazy loading).
     * If the page was loaded with a placeholder, this replaces it.
     */
    public setImageSrc(src: string): void {
        this.isLoad = false;
        this.image.src = src;
        this.image.onload = (): void => {
            this.isLoad = true;
        };
    }
```

- [ ] **Step 2: Add updatePageImage to PageFlip**

Add public method in PageFlip.ts after `getPage()`:

```typescript
    /**
     * Update the image source for a page (lazy loading for canvas mode).
     * Accepts a real (non-blank) page index.
     *
     * @param {number} realPageIndex - Real page index (excluding blanks)
     * @param {string} src - Image URL or data URL
     */
    public updatePageImage(realPageIndex: number, src: string): void {
        const internalIdx = this.pages.realToInternal(realPageIndex);
        const page = this.pages.getPage(internalIdx);
        if (page && 'setImageSrc' in page) {
            (page as any).setImageSrc(src);
        }
    }
```

- [ ] **Step 3: Build and verify**

Run: `cd lib/st-page-flip && npm run build`
Expected: Clean build

- [ ] **Step 4: Commit**

```bash
git add lib/st-page-flip/src/Page/ImagePage.ts lib/st-page-flip/src/PageFlip.ts
git commit -m "feat(curl): add lazy loading support for canvas mode via updatePageImage"
```

---

### Task 7: Migrate app.js to Canvas Mode

**Files:**
- Modify: `app.js`

Switch from `loadFromHTML` (HTMLRender) to `loadFromImages` (CanvasRender). The page DOM elements are no longer needed — images go directly to canvas.

- [ ] **Step 1: Replace buildBook function**

In the `buildBook` function inside `init()`, replace the page DOM creation and loadFromHTML section. The key changes:

1. Remove all DOM div/img creation for pages
2. Create a placeholder image array (one transparent pixel per page)
3. Use `loadFromImages()` instead of `loadFromHTML()`
4. Use `renderPages` event + `updatePageImage()` for lazy loading

Replace the `buildBook` function body (from `currentPageMap = []` through `pageFlip.on('flip', ...)`) with:

```javascript
      currentPageMap = [];
      for (const num of pageNums) {
        currentPageMap.push(num);
      }
      const totalBookPages = currentPageMap.length;

      // Create placeholder array — one transparent pixel per page
      const placeholder = 'data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7';
      const imageHrefs = currentPageMap.map(num =>
        renderedPages.has(num) ? renderedPages.get(num) : placeholder
      );

      pageFlip = window.__pageFlip = new St.PageFlip(bookEl, {
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
        showEdge: false,
        preloadRange: 3,
        startPage: 0,
        curlIntensity: 0.5,
        meshStripCount: 20,
      });

      // Lazy render: render PDF pages on demand
      pageFlip.on('renderPages', async (e) => {
        const indices = e.data;
        for (const idx of indices) {
          if (idx < 0 || idx >= currentPageMap.length) continue;
          const originalPage = currentPageMap[idx];
          if (!originalPage || renderedPages.has(originalPage)) {
            // Already rendered — update if loaded after placeholder
            if (renderedPages.has(originalPage)) {
              pageFlip.updatePageImage(idx, renderedPages.get(originalPage));
            }
            continue;
          }
          const pageData = await renderPageToImage(pdf, originalPage);
          renderedPages.set(originalPage, pageData.dataUrl);
          pageFlip.updatePageImage(idx, pageData.dataUrl);
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
      });
```

- [ ] **Step 2: Remove pageDivs references**

Search for all `pageDivs` references in app.js and remove them. The variable declaration `const pageDivs = []` and any usage should be removed since Canvas mode doesn't use DOM elements for pages.

- [ ] **Step 3: Disable edge rendering in settings**

Edge rendering (`showEdge`) is an HTMLRender feature. Set `showEdge: false` in the PageFlip constructor options (already done in the code above).

- [ ] **Step 4: Update thumbnail builder**

The `buildThumbnails` function currently references `pageDivs`. Update it to use `renderedPages` map directly:

In `addThumbItem`, the img src logic should use:

```javascript
      for (const pageNum of pages) {
        const img = document.createElement('img');
        if (renderedPages.has(pageNum)) {
          img.src = renderedPages.get(pageNum);
        } else {
          renderPageToImage(pdf, pageNum).then(data => {
            renderedPages.set(pageNum, data.dataUrl);
            img.src = data.dataUrl;
          });
        }
        imgWrap.appendChild(img);
      }
```

- [ ] **Step 5: Build library and test**

Run: `cd lib/st-page-flip && npm run build`

Then open `http://localhost:3333` in browser and verify:
- PDF pages render on canvas
- Page flip animation shows curved page curl
- Lazy loading works (pages render as you flip)
- Page info / slider / thumbnails work

- [ ] **Step 6: Commit**

```bash
git add app.js
git commit -m "feat(curl): migrate app.js from HTML to Canvas mode with lazy loading"
```

---

### Task 8: Visual Tuning and Polish

**Files:**
- Modify: `src/Flip/CurlCalculation.ts` — tune curl parameters
- Modify: `src/Render/CanvasRender.ts` — adjust shadow parameters
- Modify: `style.css` — canvas styling

This task is for visual tuning after the core rendering works. Adjust parameters based on visual testing.

- [ ] **Step 1: Tune curl parameters**

In `CurlCalculation.ts`, adjust these values based on visual testing:

- `bowAmount` (line with `pageWidth * 0.15`) — controls how much the fold edge bows outward
- `maxAngle` (line with `Math.PI / 6`) — max strip rotation (~30 degrees)
- `maxLift` (line with `pageHeight * 0.02`) — how much page lifts off surface
- Light calculation coefficients — highlight/shadow balance

- [ ] **Step 2: Adjust canvas background**

In `CanvasRender.clear()`, change the background to match the app's dark theme:

```typescript
    private clear(): void {
        this.ctx.fillStyle = '#1a1a2e';
        this.ctx.fillRect(0, 0, this.canvas.width, this.canvas.height);
    }
```

- [ ] **Step 3: Ensure canvas fills the book area**

In `style.css`, add/update:

```css
.stf__canvas {
  width: 100%;
  height: 100%;
}
```

- [ ] **Step 4: Build, test, and commit**

Run: `cd lib/st-page-flip && npm run build`
Test visually in browser.

```bash
git add lib/st-page-flip/src/Flip/CurlCalculation.ts lib/st-page-flip/src/Render/CanvasRender.ts style.css
git commit -m "feat(curl): visual tuning — curl parameters, dark theme, canvas styling"
```

---

## Summary

| Task | Focus | Key File |
|------|-------|----------|
| 1 | Types & settings | `BasicTypes.ts`, `Settings.ts` |
| 2 | Curl math engine | `CurlCalculation.ts` (new) |
| 3 | Wire curl into pipeline | `Page.ts`, `FlipCalculation.ts`, `Flip.ts` |
| 4 | Mesh strip rendering | `ImagePage.ts` |
| 5 | Enhanced shadows | `CanvasRender.ts` |
| 6 | Lazy loading API | `ImagePage.ts`, `PageFlip.ts` |
| 7 | App migration | `app.js` |
| 8 | Visual polish | Tuning parameters |
