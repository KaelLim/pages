# StPageFlip Fork Optimization Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fork StPageFlip v2.0.7 TypeScript source into `lib/st-page-flip/` and implement 7 modifications to eliminate external workarounds.

**Architecture:** Incremental modifications to the existing StPageFlip class hierarchy. Each mod touches 2-4 files with minimal cross-cutting concerns. Settings become mutable via a new `updateSetting()` method; UI/Render/PageCollection gain corresponding `reload` paths.

**Tech Stack:** TypeScript, webpack 4, ts-loader

**Task Dependencies:**
- Task 1 (build setup) → all subsequent tasks
- Task 2 (destroy cleanup) → Tasks 3-13
- Task 3 (updateSetting) → Tasks 4, 5, 6, 8, 9
- Task 8 (RTL setting) → Task 9 (RTL implementation)
- Task 10 (edge settings) → Task 11 (edge rendering)
- Tasks 2-11 → Task 12 (integration)

---

## Chunk 1: Setup & Foundation

### Task 1: Verify Vanilla Build

The source is already cloned at `lib/st-page-flip/`. Install deps and verify the webpack build produces a working `pageFlip.browser.js`.

**Files:**
- Verify: `lib/st-page-flip/package.json`
- Verify: `lib/st-page-flip/webpack.config.js`
- Output: `lib/st-page-flip/dist/js/pageFlip.browser.js`

- [ ] **Step 1: Install dependencies**

Run: `cd lib/st-page-flip && npm install`
Expected: `node_modules` created, no errors

- [ ] **Step 2: Disable webpack watch mode for single build**

In `webpack.config.js`, change `watch: true` to `watch: false` so the build exits after completion.

```js
// webpack.config.js line 27
watch: false
```

- [ ] **Step 3: Run webpack build**

Run: `cd lib/st-page-flip && npm run build-global`
Expected: `dist/js/pageFlip.browser.js` created without errors

- [ ] **Step 4: Switch html-book.html to use local build**

In `html-book.html`, change the StPageFlip `<script>` source from unpkg CDN to:
```html
<script src="lib/st-page-flip/dist/js/pageFlip.browser.js"></script>
```

- [ ] **Step 5: Manual verification in browser**

Open `html-book.html` in browser, verify page flipping works identically to CDN version.

- [ ] **Step 6: Commit**

```bash
git add lib/st-page-flip/ html-book.html
git commit -m "feat: set up local StPageFlip fork build from TypeScript source"
```

---

### Task 2: Fix `destroy()` Cleanup (Mod 1)

**Problem:** `destroy()` in `UI.ts` only calls `removeHandlers()` if `useMouseEvents` is true, but the `resize` listener is always attached. The RAF loop in `Render.ts` has no cancellation — it runs forever even after destroy.

**Files:**
- Modify: `lib/st-page-flip/src/UI/UI.ts:26-28,66,73-78`
- Modify: `lib/st-page-flip/src/Render/Render.ts:139-148`
- Modify: `lib/st-page-flip/src/PageFlip.ts:55-58`

- [ ] **Step 1: Store RAF ID in Render.ts**

In `Render.ts`, add a private field to store the animation frame ID:

```typescript
// After line 84: protected timer = 0;
private rafId: number = null;
```

- [ ] **Step 2: Update `start()` to store RAF ID**

Replace the `start()` method (lines 139-148) to capture the RAF ID:

```typescript
public start(): void {
    this.update();

    const loop = (timer: number): void => {
        this.render(timer);
        this.rafId = requestAnimationFrame(loop);
    };

    this.rafId = requestAnimationFrame(loop);
}
```

- [ ] **Step 3: Add `stopLoop()` method to Render.ts**

Add after `start()`:

```typescript
public stopLoop(): void {
    if (this.rafId !== null) {
        cancelAnimationFrame(this.rafId);
        this.rafId = null;
    }
}
```

- [ ] **Step 4: Fix `destroy()` in UI.ts to always remove resize listener**

Replace `destroy()` (lines 73-78):

```typescript
public destroy(): void {
    window.removeEventListener('resize', this.onResize);

    if (this.app.getSettings().useMouseEvents) this.removeHandlers();

    this.distElement.remove();
    this.wrapper.remove();
}
```

- [ ] **Step 5: Update `destroy()` in PageFlip.ts to cancel RAF**

Replace `destroy()` (lines 55-58):

```typescript
public destroy(): void {
    this.render.stopLoop();
    this.ui.destroy();
    this.block.remove();
}
```

- [ ] **Step 6: Rebuild and verify**

Run: `cd lib/st-page-flip && npm run build-global`
Expected: Build succeeds. Open browser, verify destroy/rebuild cycle doesn't accumulate listeners.

- [ ] **Step 7: Commit**

```bash
git add lib/st-page-flip/src/UI/UI.ts lib/st-page-flip/src/Render/Render.ts lib/st-page-flip/src/PageFlip.ts
git commit -m "fix: destroy() properly cleans up resize listener and RAF loop"
```

---

## Chunk 2: Runtime Toggles (Mods 2-4)

### Task 3: Add `updateSetting()` to Settings.ts

Create a method to update individual settings at runtime, used by all subsequent mods.

**Files:**
- Modify: `lib/st-page-flip/src/Settings.ts:62-121`

- [ ] **Step 1: Remove `readonly` from setting in PageFlip.ts**

In `PageFlip.ts` line 29, change:
```typescript
// From:
private readonly setting: FlipSetting = null;
// To:
private setting: FlipSetting = null;
```

- [ ] **Step 2: Add `updateSetting()` method to PageFlip.ts**

Add after `getSettings()` (line 326):

```typescript
public updateSetting<K extends keyof FlipSetting>(key: K, value: FlipSetting[K]): void {
    this.setting[key] = value;
}
```

- [ ] **Step 3: Rebuild and verify**

Run: `cd lib/st-page-flip && npm run build-global`
Expected: Build succeeds, no runtime changes yet.

- [ ] **Step 4: Commit**

```bash
git add lib/st-page-flip/src/PageFlip.ts
git commit -m "feat: add updateSetting() for runtime option changes"
```

---

### Task 4: Runtime `useMouseEvents` Toggle (Mod 2)

**Problem:** `useMouseEvents` is read once in the constructor. Toggling requires destroy+rebuild.

**Files:**
- Modify: `lib/st-page-flip/src/UI/UI.ts:129-152`
- Modify: `lib/st-page-flip/src/PageFlip.ts`

- [ ] **Step 1: Add `setUseMouseEvents()` to UI.ts**

Add after `setHandlers()` (line 152):

```typescript
public setUseMouseEvents(enabled: boolean): void {
    this.removeHandlers();
    if (enabled) {
        this.setHandlers();
    }
}
```

Note: `removeHandlers()` already safely removes all listeners. `setHandlers()` re-adds them only when `useMouseEvents` is true (line 142 check). We need to bypass that check for this method.

Actually, looking at `setHandlers()` line 142: `if (!this.app.getSettings().useMouseEvents) return;` — we need to update the setting *before* calling `setHandlers()`.

- [ ] **Step 2: Add `setMouseEvents()` API to PageFlip.ts**

Add public API method:

```typescript
public setMouseEvents(enabled: boolean): void {
    if (this.setting.useMouseEvents === enabled) return;
    this.updateSetting('useMouseEvents', enabled);
    this.ui.setUseMouseEvents(enabled);
}
```

- [ ] **Step 3: Rebuild and verify**

Run: `cd lib/st-page-flip && npm run build-global`
Expected: Build succeeds.

- [ ] **Step 4: Commit**

```bash
git add lib/st-page-flip/src/UI/UI.ts lib/st-page-flip/src/PageFlip.ts
git commit -m "feat: runtime useMouseEvents toggle without destroy/rebuild"
```

---

### Task 5: Runtime `showCover` Toggle (Mod 3)

**Problem:** `showCover` is read once in `PageCollection` constructor (line 33: `this.isShowCover = this.app.getSettings().showCover`). Toggling requires full rebuild.

**Files:**
- Modify: `lib/st-page-flip/src/Collection/PageCollection.ts:14,33,51-73`
- Modify: `lib/st-page-flip/src/PageFlip.ts`

- [ ] **Step 1: Make `isShowCover` dynamic in PageCollection.ts**

Change `isShowCover` from reading once at constructor to reading from settings each time:

```typescript
// Remove line 14: protected readonly isShowCover: boolean;

// Remove line 33: this.isShowCover = this.app.getSettings().showCover;

// In createSpread() (line 60), change:
//   if (this.isShowCover) {
// To:
//   if (this.app.getSettings().showCover) {
```

- [ ] **Step 2: Add `recreateSpread()` public method to PageCollection.ts**

Add after `createSpread()`:

```typescript
public recreateSpread(): void {
    this.createSpread();
}
```

- [ ] **Step 3: Add `setShowCover()` API to PageFlip.ts**

```typescript
public setShowCover(enabled: boolean): void {
    if (this.setting.showCover === enabled) return;
    this.updateSetting('showCover', enabled);
    this.pages.recreateSpread();
    this.pages.show(this.pages.getCurrentPageIndex());
    this.render.update();
}
```

- [ ] **Step 4: Rebuild and verify**

Run: `cd lib/st-page-flip && npm run build-global`
Expected: Build succeeds.

- [ ] **Step 5: Commit**

```bash
git add lib/st-page-flip/src/Collection/PageCollection.ts lib/st-page-flip/src/PageFlip.ts
git commit -m "feat: runtime showCover toggle with spread recalculation"
```

---

### Task 6: Runtime `size`/`autoSize` Toggle (Mod 4)

**Problem:** Container sizing is set once in `UI` constructor (lines 50-64). Can't switch between fixed/stretch at runtime.

**Files:**
- Modify: `lib/st-page-flip/src/UI/UI.ts:48-64`
- Modify: `lib/st-page-flip/src/PageFlip.ts`

- [ ] **Step 1: Extract sizing logic into `applySizing()` method in UI.ts**

Extract lines 48-64 into a reusable method:

```typescript
public applySizing(): void {
    const setting = this.app.getSettings();
    const k = setting.usePortrait ? 1 : 2;

    this.parentElement.style.minWidth = setting.minWidth * k + 'px';
    this.parentElement.style.minHeight = setting.minHeight + 'px';

    if (setting.size === SizeType.FIXED) {
        this.parentElement.style.minWidth = setting.width * k + 'px';
        this.parentElement.style.minHeight = setting.height + 'px';
    }

    if (setting.autoSize) {
        this.parentElement.style.width = '100%';
        this.parentElement.style.maxWidth = setting.maxWidth * 2 + 'px';
    } else {
        this.parentElement.style.width = '';
        this.parentElement.style.maxWidth = '';
    }

    this.parentElement.style.display = 'block';
}
```

Replace lines 48-64 in the constructor with: `this.applySizing();`

- [ ] **Step 2: Add `setSizeMode()` API to PageFlip.ts**

```typescript
public setSizeMode(size: string, autoSize: boolean): void {
    this.updateSetting('size', size as any);
    this.updateSetting('autoSize', autoSize);
    this.ui.applySizing();
    this.update();
}
```

- [ ] **Step 3: Rebuild and verify**

Run: `cd lib/st-page-flip && npm run build-global`
Expected: Build succeeds.

- [ ] **Step 4: Commit**

```bash
git add lib/st-page-flip/src/UI/UI.ts lib/st-page-flip/src/PageFlip.ts
git commit -m "feat: runtime size/autoSize toggle without destroy/rebuild"
```

---

## Chunk 3: Container Sizing Fix (Mod 7)

### Task 7: Fix Container Sizing to Account for Padding

**Problem:** `calculateBoundsRect()` in `Render.ts` uses `offsetWidth`/`offsetHeight` via `getBlockWidth()`/`getBlockHeight()`, which includes padding. This causes incorrect sizing when the container has padding.

**Files:**
- Modify: `lib/st-page-flip/src/Render/Render.ts:299-308`

- [ ] **Step 1: Update `getBlockWidth()` to use clientWidth and subtract padding**

Replace `getBlockWidth()` and `getBlockHeight()` (lines 299-308):

```typescript
public getBlockWidth(): number {
    const el = this.app.getUI().getDistElement();
    const style = getComputedStyle(el);
    return el.clientWidth - parseFloat(style.paddingLeft) - parseFloat(style.paddingRight);
}

public getBlockHeight(): number {
    const el = this.app.getUI().getDistElement();
    const style = getComputedStyle(el);
    return el.clientHeight - parseFloat(style.paddingTop) - parseFloat(style.paddingBottom);
}
```

Note: `clientWidth` already excludes borders but includes padding. We subtract padding to get pure content area.

- [ ] **Step 2: Rebuild and verify**

Run: `cd lib/st-page-flip && npm run build-global`
Expected: Build succeeds. Book with padded container renders at correct size.

- [ ] **Step 3: Commit**

```bash
git add lib/st-page-flip/src/Render/Render.ts
git commit -m "fix: container sizing accounts for padding in bounds calculation"
```

---

## Chunk 4: Native RTL Support (Mod 5)

### Task 8: Add RTL Setting

**Files:**
- Modify: `lib/st-page-flip/src/Settings.ts:14-60,63-85`

- [ ] **Step 1: Add `rtl` to FlipSetting interface**

After line 59 (`disableFlipByClick: boolean;`), add:

```typescript
/** Right-to-left page order */
rtl: boolean;
```

- [ ] **Step 2: Add default value**

In the `_default` object (line 84), add before the closing brace:

```typescript
rtl: false,
```

- [ ] **Step 3: Rebuild and verify**

Run: `cd lib/st-page-flip && npm run build-global`
Expected: Build succeeds.

- [ ] **Step 4: Commit**

```bash
git add lib/st-page-flip/src/Settings.ts
git commit -m "feat: add rtl option to FlipSetting interface"
```

---

### Task 9: Implement RTL Flip Direction Reversal

When RTL is enabled, `flipNext()` should flip backward (right-to-left becomes left-to-right visually) and `flipPrev()` should flip forward. The direction detection in `Flip.ts` also needs reversal.

**Files:**
- Modify: `lib/st-page-flip/src/Flip/Flip.ts:243-259,385-397`
- Modify: `lib/st-page-flip/src/PageFlip.ts`

- [ ] **Step 1: Reverse `flipNext()`/`flipPrev()` coordinates in Flip.ts**

Replace `flipNext()` (lines 243-248):

```typescript
public flipNext(corner: FlipCorner): void {
    const rect = this.render.getRect();
    const x = this.app.getSettings().rtl
        ? rect.left + 10
        : rect.left + rect.pageWidth * 2 - 10;
    this.flip({
        x,
        y: corner === FlipCorner.TOP ? 1 : rect.height - 2,
    });
}
```

Replace `flipPrev()` (lines 255-259):

```typescript
public flipPrev(corner: FlipCorner): void {
    const rect = this.render.getRect();
    const x = this.app.getSettings().rtl
        ? rect.left + rect.pageWidth * 2 - 10
        : 10;
    this.flip({
        x,
        y: corner === FlipCorner.TOP ? 1 : rect.height - 2,
    });
}
```

- [ ] **Step 2: Reverse direction detection in `getDirectionByPoint()`**

Replace `getDirectionByPoint()` (lines 385-397):

```typescript
private getDirectionByPoint(touchPos: Point): FlipDirection {
    const rect = this.getBoundsRect();
    const rtl = this.app.getSettings().rtl;

    if (this.render.getOrientation() === Orientation.PORTRAIT) {
        const threshold = rect.pageWidth + rect.width / 5;
        if (rtl) {
            if (touchPos.x - rect.pageWidth > rect.width / 5) {
                return FlipDirection.BACK;
            }
        } else {
            if (touchPos.x - rect.pageWidth <= rect.width / 5) {
                return FlipDirection.BACK;
            }
        }
    } else {
        if (rtl) {
            if (touchPos.x >= rect.width / 2) {
                return FlipDirection.BACK;
            }
        } else {
            if (touchPos.x < rect.width / 2) {
                return FlipDirection.BACK;
            }
        }
    }

    return FlipDirection.FORWARD;
}
```

- [ ] **Step 3: Reverse swipe direction in UI.ts**

In `UI.ts` `onTouchEnd` (lines 264-276), the swipe detection uses `dx > 0` for prev and `dx < 0` for next. Add RTL reversal:

```typescript
// Replace lines 264-276 in onTouchEnd:
if (dx > 0) {
    if (this.app.getSettings().rtl) {
        this.app.flipNext(
            this.touchPoint.point.y < this.app.getRender().getRect().height / 2
                ? FlipCorner.TOP
                : FlipCorner.BOTTOM
        );
    } else {
        this.app.flipPrev(
            this.touchPoint.point.y < this.app.getRender().getRect().height / 2
                ? FlipCorner.TOP
                : FlipCorner.BOTTOM
        );
    }
} else {
    if (this.app.getSettings().rtl) {
        this.app.flipPrev(
            this.touchPoint.point.y < this.app.getRender().getRect().height / 2
                ? FlipCorner.TOP
                : FlipCorner.BOTTOM
        );
    } else {
        this.app.flipNext(
            this.touchPoint.point.y < this.app.getRender().getRect().height / 2
                ? FlipCorner.TOP
                : FlipCorner.BOTTOM
        );
    }
}
```

- [ ] **Step 4: Add `setRtl()` API to PageFlip.ts**

```typescript
public setRtl(enabled: boolean): void {
    if (this.setting.rtl === enabled) return;
    this.updateSetting('rtl', enabled);
}
```

- [ ] **Step 5: Rebuild and verify**

Run: `cd lib/st-page-flip && npm run build-global`
Expected: Build succeeds. With `rtl: true`, clicking right side goes to previous page, left side goes to next page.

- [ ] **Step 6: Commit**

```bash
git add lib/st-page-flip/src/Flip/Flip.ts lib/st-page-flip/src/UI/UI.ts lib/st-page-flip/src/PageFlip.ts
git commit -m "feat: native RTL support with direction reversal for flip, swipe, and click"
```

---

## Chunk 5: Native Edge Rendering (Mod 6)

### Task 10: Add Edge Settings

**Files:**
- Modify: `lib/st-page-flip/src/Settings.ts`

- [ ] **Step 1: Add edge options to FlipSetting interface**

After `rtl: boolean;`, add:

```typescript
/** Show 3D edge effect on the book spine */
showEdge: boolean;
/** Maximum width of the edge in pixels */
edgeWidth: number;
```

- [ ] **Step 2: Add defaults**

In the `_default` object, add:

```typescript
showEdge: false,
edgeWidth: 10,
```

- [ ] **Step 3: Commit**

```bash
git add lib/st-page-flip/src/Settings.ts
git commit -m "feat: add showEdge and edgeWidth settings"
```

---

### Task 11: Implement Edge Rendering in HTMLRender

Edge rendering creates DOM elements along the book spine that simulate 3D page stack thickness. The edge width varies based on current page position (thicker on the side with more pages).

**Files:**
- Modify: `lib/st-page-flip/src/Render/HTMLRender.ts`
- Modify: `lib/st-page-flip/src/Render/Render.ts`

- [ ] **Step 1: Add edge DOM elements in HTMLRender.ts**

Add edge element fields after `hardInnerShadow` (line 22):

```typescript
private leftEdge: HTMLElement = null;
private rightEdge: HTMLElement = null;
```

- [ ] **Step 2: Create edge elements in `createShadows()` or a new `createEdges()` method**

Add a `createEdges()` method:

```typescript
private createEdges(): void {
    if (!this.getSettings().showEdge) return;

    this.element.insertAdjacentHTML(
        'beforeend',
        `<div class="stf__edge stf__edgeLeft"></div>
         <div class="stf__edge stf__edgeRight"></div>`
    );

    this.leftEdge = this.element.querySelector('.stf__edgeLeft');
    this.rightEdge = this.element.querySelector('.stf__edgeRight');
}
```

Call `this.createEdges()` after `this.createShadows()` in the constructor.

- [ ] **Step 3: Add `drawEdges()` method to HTMLRender.ts**

```typescript
private drawEdges(): void {
    if (!this.getSettings().showEdge || !this.leftEdge || !this.rightEdge) return;

    const rect = this.getRect();
    const pageCount = this.app.getPageCount();
    const currentPage = this.app.getCurrentPageIndex();
    const maxWidth = this.getSettings().edgeWidth;

    const leftRatio = currentPage / Math.max(pageCount - 1, 1);
    const rightRatio = 1 - leftRatio;

    const leftWidth = Math.max(1, Math.round(maxWidth * leftRatio));
    const rightWidth = Math.max(1, Math.round(maxWidth * rightRatio));

    const centerX = rect.left + rect.width / 2;
    const zIndex = this.getSettings().startZIndex + 2;

    this.leftEdge.style.cssText = `
        display: block;
        position: absolute;
        z-index: ${zIndex};
        left: ${centerX - leftWidth}px;
        top: ${rect.top}px;
        width: ${leftWidth}px;
        height: ${rect.height}px;
        background: linear-gradient(to left, #b8b5ae, #d4d0c8 40%, #b8b5ae);
        border-right: 1px solid rgba(0,0,0,0.15);
    `;

    this.rightEdge.style.cssText = `
        display: block;
        position: absolute;
        z-index: ${zIndex};
        left: ${centerX}px;
        top: ${rect.top}px;
        width: ${rightWidth}px;
        height: ${rect.height}px;
        background: linear-gradient(to right, #b8b5ae, #d4d0c8 40%, #b8b5ae);
        border-left: 1px solid rgba(0,0,0,0.15);
    `;
}
```

- [ ] **Step 4: Call `drawEdges()` in `drawFrame()`**

In `drawFrame()` (line 326), add at the end before the closing brace:

```typescript
this.drawEdges();
```

- [ ] **Step 5: Add edge hide in portrait mode**

In `drawEdges()`, add at the start:

```typescript
if (this.orientation === Orientation.PORTRAIT) {
    if (this.leftEdge) this.leftEdge.style.display = 'none';
    if (this.rightEdge) this.rightEdge.style.display = 'none';
    return;
}
```

- [ ] **Step 6: Rebuild and verify**

Run: `cd lib/st-page-flip && npm run build-global`
Expected: Build succeeds. With `showEdge: true`, book spine shows gradient edges.

- [ ] **Step 7: Commit**

```bash
git add lib/st-page-flip/src/Render/HTMLRender.ts lib/st-page-flip/src/Render/Render.ts
git commit -m "feat: native edge rendering along book spine"
```

---

## Chunk 6: Integration

### Task 12: Update Consumer Code

Remove external workarounds from `app.js` and `html-book.js`, replace with new native APIs.

**Files:**
- Modify: `html-book.js`
- Modify: `html-book.html`
- Potentially modify: `app.js`, `index.html`

- [ ] **Step 1: Identify all external workarounds in html-book.js**

Read `html-book.js` and `app.js` to find:
- Manual RTL page reversal
- External edge DOM elements
- Destroy+rebuild cycles for option changes
- Container padding pre-calculation

- [ ] **Step 2: Replace workarounds with new APIs**

Replace destroy+rebuild patterns with:
- `pageFlip.setMouseEvents(false/true)` for zoom toggle
- `pageFlip.setShowCover(true/false)` for cover toggle
- `pageFlip.setRtl(true/false)` for RTL toggle
- `pageFlip.setSizeMode('fixed'/'stretch', true/false)` for size toggle
- Add `showEdge: true, edgeWidth: 10` to StPageFlip constructor options
- Remove external edge DOM creation code

- [ ] **Step 3: Remove external edge CSS**

Remove any CSS rules for manually created edge elements (`.book-edge-left`, `.book-edge-right`, etc.)

- [ ] **Step 4: Test all features**

Manually verify in browser:
- Page flipping works
- RTL mode works (if applicable)
- Edge rendering shows along spine
- Font size change preserves page position
- URL parameter works

- [ ] **Step 5: Commit**

```bash
git add html-book.js html-book.html html-book.css app.js index.html
git commit -m "refactor: replace external StPageFlip workarounds with native fork APIs"
```

---

### Task 13: Final Verification & Cleanup

- [ ] **Step 1: Clean rebuild**

```bash
cd lib/st-page-flip && rm -rf dist && npm run build-global
```

- [ ] **Step 2: Full manual test**

Test in browser:
- ✅ Page flip animation smooth
- ✅ Destroy/rebuild has no listener leaks
- ✅ Edge rendering correct
- ✅ RTL flip direction correct (if used)
- ✅ Container with padding renders correctly
- ✅ Font scaling and reflow work
- ✅ URL page parameter preserved

- [ ] **Step 3: Commit any final fixes**

```bash
git add -A
git commit -m "chore: final cleanup for StPageFlip fork optimization"
```
