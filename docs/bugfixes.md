# Bug Fixes Log

## 2026-02-24: StPageFlip 容器與頁面尺寸不一致

### 問題現象

- `.stf__block` 寬度為 1786px，`#book` 也是 1786px
- 但實際頁面 `div[data-density]` 和 `img` 只有 593px（預期 892px）
- 導致 page edges（書頁厚度效果）無法貼齊實際頁面

### 根本原因

StPageFlip 的 `calculateBoundsRect()`（`Render.ts`）在 `size: 'stretch'` 模式下的計算流程：

1. 我們傳入 `width: 892, maxWidth: 892`（canvas 在 RENDER_SCALE=1.5 下的像素尺寸）
2. StPageFlip 設定容器 `max-width: 892 × 2 = 1784px`（`UI.ts` 中 `maxWidth * k`）
3. `calculateBoundsRect()` 計算：`pageWidth = blockWidth / 2 = 893`，cap 到 `maxWidth = 892`
4. 計算高度：`pageHeight = 892 / ratio ≈ 1263px`
5. **viewport 高度不足**（例如 ~840px），觸發高度約束：
   ```
   pageHeight = blockHeight ≈ 840px
   pageWidth  = 840 × (892/1263) ≈ 593px
   ```
6. 頁面正確縮至 593px，**但容器寬度仍為 1786px**，未跟著縮小

**核心問題：** 傳入的 `maxWidth` 是 canvas 原始像素尺寸，超過了 viewport 高度所能容納的等比寬度。StPageFlip 的容器基於 `maxWidth` 設定，但頁面會被高度約束進一步縮小，造成兩者不一致。

### 修復方式

在初始化 StPageFlip **之前**，根據實際 viewport 計算合適的頁面尺寸：

```javascript
const aspectRatio = pageWidth / pageHeight;
const viewW = window.innerWidth;
const viewH = window.innerHeight;

// 以 viewport 高度為主要約束
let fitW = Math.round(viewH * aspectRatio);
let fitH = viewH;

// 若兩頁超出 viewport 寬度，改以寬度約束
if (fitW * 2 > viewW) {
  fitW = Math.floor(viewW / 2);
  fitH = Math.round(fitW / aspectRatio);
}

// 不超過原始 canvas 解析度（避免放大失真）
fitW = Math.min(fitW, pageWidth);
fitH = Math.min(fitH, pageHeight);
```

然後將 `fitW / fitH` 作為 `width`, `height`, `maxWidth`, `maxHeight` 傳入 StPageFlip，確保容器 `max-width = fitW * 2` 與實際頁面尺寸一致。

### 相關檔案

- `app.js` - `buildBook()` 函數中的 viewport 適配計算
- StPageFlip 原始碼參考：`UI.ts`（容器 CSS 設定）、`Render.ts`（`calculateBoundsRect()` 尺寸計算）

---

## 2026-02-24: 移除 Blank Page，改用 showCover

### 問題

先前為了讓 P1 正確配對，在頁面列表開頭插入 blank page：`[Blank, P1, P2, ..., Pn]`。RTL 模式需要複雜的 spread 級別反轉邏輯。

### 修復方式

- 移除所有 blank page 插入邏輯
- 改用 `showCover: true`，讓 StPageFlip 自動處理首尾頁獨立顯示
- RTL 簡化為直接 `entries.reverse()`，不再需要 spread 級別操作
- `getOriginalPage()` 簡化，移除 blank page 的 spread partner fallback
