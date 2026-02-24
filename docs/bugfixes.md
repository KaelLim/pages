# PDF Page Flip Demo - 開發紀錄

## 功能新增

### Page Edges（書頁厚度指示器）

模擬實體書本翻閱時，側面可見的頁面厚度效果。左右兩側的 edge 寬度會隨翻頁動態變化，反映閱讀進度。

**實作方式：**

- 建立兩個 `position: fixed` 的 DOM 元素（`book-edge-left`、`book-edge-right`），掛載於 `document.body`
- 使用 `getBoundingClientRect()` 測量 `.stf__block` 的實際位置，動態定位 edges
- 最大厚度 = `min(ceil(totalPages / 5), 14)px`，避免頁數過多時 edge 過寬
- 閱讀進度公式：`readProgress = currentIndex / (totalPages - 1)`
- RTL 模式下進度反轉：`readProgress = 1 - readProgress`
- CSS 使用 `repeating-linear-gradient` 模擬紙張紋理，搭配 `box-shadow` 製造深度感
- `pointer-events: none` 確保不影響翻頁互動

**觸發時機：**

- `flipping` 事件 — 翻頁動畫進行中，使用目標頁碼 `e.data` 即時更新 edge 寬度
- `changeState('read')` — 翻頁完成，用實際頁碼確認 edge 位置
- `requestAnimationFrame`（初始化後等一幀讓 StPageFlip 完成 layout）
- `window.resize`（viewport 變化時重新定位）

**`updatePageEdges(overrideIdx)` 支援目標頁碼覆寫：**

```javascript
function updatePageEdges(overrideIdx) {
  const idx = overrideIdx !== undefined ? overrideIdx : pageFlip.getCurrentPageIndex();
  // 基於 idx 計算 readProgress → edge 寬度
}
```

翻頁時 `flipping` 事件傳入目標頁碼，edge 寬度即時反映目標狀態（如右側減少一頁厚度、左側增加一頁厚度），無需隱藏/顯示整個 edge。

**相關檔案：** `app.js`（`updatePageEdges()`）、`style.css`（`.book-edge` 系列樣式）

---

### RTL 閱讀模式

支援右到左（RTL）閱讀方向，適用於阿拉伯文、希伯來文等書籍。

**實作方式：**

- 頁面順序直接 `entries.reverse()`，將 `[P1, P2, ..., Pn]` 變為 `[Pn, Pn-1, ..., P1]`
- 導航反轉：`flipNext()` 實際呼叫 `pageFlip.flipPrev()`，反之亦然
- 鍵盤方向鍵同步反轉
- 切換 RTL 時保留當前閱讀頁面位置（透過 `currentPageMap.indexOf()`）
- Page edges 進度同步反轉

**相關檔案：** `app.js`（`buildBook(rtl)`、`flipNext()`、`flipPrev()`）

---

### Toolbar（工具列）

底部浮動工具列，提供頁面導航和功能控制。

**功能：**

- 上一頁 / 下一頁按鈕
- 頁碼顯示（`當前頁 / 總頁數`，透過 `currentPageMap` 映射原始頁碼）
- 全螢幕切換
- RTL 模式切換（啟用時按鈕高亮）

**視覺效果：** Glassmorphism 風格（`backdrop-filter: blur(10px)` + 半透明背景 + 圓角）

**相關檔案：** `index.html`（`#toolbar`）、`style.css`（toolbar 樣式）、`app.js`（事件綁定）

---

### 外部 PDF 載入

支援透過 URL 參數載入外部 PDF 檔案。

**使用方式：** `?src=https://example.com/document.pdf`

**實作方式：**

- 優先直接 `fetch()` 載入
- 若遇 CORS 限制，自動 fallback 至 `corsproxy.io` 代理
- 載入過程顯示狀態文字

**相關檔案：** `app.js`（`PDF_URL` 解析、CORS proxy fallback）

---

### 鍵盤導航

- `ArrowRight` → 下一頁（RTL 模式下為上一頁）
- `ArrowLeft` → 上一頁（RTL 模式下為下一頁）

---

## Bug Fixes

### 2026-02-24: StPageFlip 容器與頁面尺寸不一致

#### 問題現象

- `.stf__block` 寬度為 1786px，`#book` 也是 1786px
- 但實際頁面 `div[data-density]` 和 `img` 只有 593px（預期 892px）
- 導致 page edges 無法貼齊實際頁面

#### 根本原因

StPageFlip 的 `calculateBoundsRect()`（`Render.ts`）在 `size: 'stretch'` 模式下：

1. 傳入 `width: 892, maxWidth: 892`（canvas 在 RENDER_SCALE=1.5 下的像素尺寸）
2. StPageFlip 設定容器 `max-width: 892 × 2 = 1784px`（`UI.ts` 中 `maxWidth * k`）
3. `calculateBoundsRect()` 計算：`pageWidth = blockWidth / 2 = 893`，cap 到 `maxWidth = 892`
4. 計算高度：`pageHeight = 892 / ratio ≈ 1263px`
5. **viewport 高度不足**（例如 ~840px），觸發高度約束：
   ```
   pageHeight = blockHeight ≈ 840px
   pageWidth  = 840 × (892/1263) ≈ 593px
   ```
6. 頁面正確縮至 593px，**但容器寬度仍為 1786px**，未跟著縮小

**核心問題：** 傳入的 `maxWidth` 是 canvas 原始像素尺寸，超過了 viewport 高度所能容納的等比寬度。容器基於 `maxWidth` 設定，但頁面被高度約束進一步縮小，造成兩者不一致。

#### 修復方式

在初始化 StPageFlip **之前**，根據實際 viewport 計算合適的頁面尺寸：

```javascript
const aspectRatio = pageWidth / pageHeight;
const viewW = window.innerWidth;
const viewH = window.innerHeight;

let fitW = Math.round(viewH * aspectRatio);
let fitH = viewH;

if (fitW * 2 > viewW) {
  fitW = Math.floor(viewW / 2);
  fitH = Math.round(fitW / aspectRatio);
}

fitW = Math.min(fitW, pageWidth);
fitH = Math.min(fitH, pageHeight);
```

將 `fitW / fitH` 作為 `width`, `height`, `maxWidth`, `maxHeight` 傳入，確保容器 `max-width = fitW * 2` 與頁面尺寸一致。

#### 相關檔案

- `app.js` - `buildBook()` 中的 viewport 適配計算
- StPageFlip 原始碼參考：`UI.ts`（容器 CSS）、`Render.ts`（`calculateBoundsRect()`）

---

### 2026-02-24: Page Edges 翻頁時閃爍

#### 問題現象

翻頁時整個 edge 消失（`opacity: 0`），翻頁完成後 edge 在舊位置閃現再跳到新位置。即使調整為先更新位置再顯示，CSS `transition: width 0.5s` 仍導致寬度過渡動畫產生閃爍。

#### 嘗試過的方案

1. **opacity 隱藏/顯示** — 翻頁中隱藏全部 edges，翻頁完成後顯示 → 整個 edge 消失不自然
2. **先更新位置再顯示** — `updatePageEdges()` 在 `showEdges(true)` 之前 → CSS width transition 仍導致閃爍
3. **移除 CSS transition** — 無過渡動畫 → 閃爍減輕但仍有瞬間跳動
4. **只隱藏翻頁側 edge** — 追蹤翻頁方向，只隱藏翻動那側 → 不自然，整條 edge 消失而非減少一頁厚度

#### 最終修復

完全移除 opacity 機制，改用 `flipping` 事件的目標頁碼即時更新 edge 寬度：

```javascript
// flipping 事件提供目標頁碼 e.data
pageFlip.on('flipping', (e) => {
  updatePageEdges(e.data);  // 用目標頁碼計算 edge 寬度
});

// updatePageEdges 支援覆寫頁碼
function updatePageEdges(overrideIdx) {
  const idx = overrideIdx !== undefined ? overrideIdx : pageFlip.getCurrentPageIndex();
  // 基於 idx 計算 readProgress → edge 寬度
}
```

**效果：** 翻頁時 edge 寬度即時反映目標狀態（翻動側減少一頁厚度，另一側保持不變），模擬實體書本側面厚度的自然變化，無閃爍。

---

### 2026-02-24: 移除 Blank Page，改用 showCover

#### 問題

為讓 P1 正確配對，在頁面列表開頭插入 blank page：`[Blank, P1, P2, ..., Pn]`。RTL 模式需複雜的 spread 級別反轉邏輯。

#### 修復方式

- 移除所有 blank page 插入邏輯
- 改用 `showCover: true`，StPageFlip 自動處理首尾頁獨立顯示
- RTL 簡化為 `entries.reverse()`，不再需要 spread 級別操作
- `getOriginalPage()` 簡化，移除 blank page 的 spread partner fallback

---

### 2026-02-24: RTL 模式封面顯示為 spread 而非單獨頁面

#### 問題現象

切換 RTL 後，P1 無法單獨顯示，直接與 P2 組成 spread。

#### 根本原因

`showCover: true` 永遠將 **index 0** 視為封面（單獨顯示）。RTL 反轉後 index 0 是 Pn（最後一頁），P1 位於陣列末端。P1 能否單獨顯示取決於 StPageFlip 的 `createSpread` 配對邏輯：

- **封面後剩餘頁數為奇數** → 最後一頁獨立為封底 ✓
- **封面後剩餘頁數為偶數** → 全部配對，最後一頁被併入 spread ✗

以 69 頁為例：`showCover: true` → 封面(P69) + 68 頁剩餘（偶數）→ 全配對 → P1 與 P2 併成 spread。

#### 修復方式

根據 RTL 模式和頁數奇偶**動態切換 `showCover`**，確保 P1 在任何頁數下都能單獨顯示，不需要 blank page：

```javascript
const useShowCover = rtl ? (totalBookPages % 2 === 0) : true;
```

| 模式 | 頁數 | showCover | P1 結果 |
|------|------|-----------|---------|
| LTR | 任何 | `true` | index 0 = 封面，單獨顯示 |
| RTL | 偶數 | `true` | 封面(Pn) + 奇數剩餘 → P1 獨立封底 |
| RTL | 奇數 | `false` | 全部配對，末尾落單 → P1 獨立 |

#### 相關檔案

- `app.js` — `buildBook()` 中的 `useShowCover` 計算

---

### 2026-02-23: CDN 路徑錯誤

#### 問題

StPageFlip CDN 路徑缺少 `js/` 子目錄，導致 404。

#### 修復

```diff
- https://unpkg.com/page-flip@2.0.7/dist/page-flip.browser.js
+ https://unpkg.com/page-flip@2.0.7/dist/js/page-flip.browser.js
```
