# Viewer 效能優化紀錄（2026-04-24）

本文件記錄 `books/` PDF Viewer 在整合進 library 專案後，針對大型 PDF（300+ 頁）出現的翻頁卡頓問題所做的一連串除錯與優化。

## 問題現象

使用者在閱讀 580 頁的 RTL（中文右翻左）PDF 時回報：

- 翻頁動畫嚴重卡頓，整個 viewer 看起來像掛掉
- 只有第 1、3、5、7⋯⋯頁會 render，第 2、4、6⋯⋯頁永遠停在佔位圖
- 首次開書後主執行緒被背景工作霸佔數秒，無法即時互動

## 調查過程

### A/B 測試 1：`showEdge: false`

懷疑 `CanvasRender.drawSingleEdge` 的逐像素迴圈（每 1.2px 畫一條垂直線模擬紙張層次）是瓶頸。關掉後使用者回報「沒感覺」。排除 edge 渲染。

### Timing 診斷

在 `app.ts` 加入 `[perf]` console logs 測量：
- `app.ts entered`
- `pdf.js loaded`
- `pdf parsed (N pages)`
- `metadata done`
- `toc done`
- `first page rendered`
- `buildBook (StPageFlip) done`
- `READY — loading hidden`
- 每一頁 `render pN` 的 `getPage` / `render` / `encode` 時間
- 每次 `flip → page N`

實測 log 顯示：

```
[perf] READY — loading hidden      (total 1999ms)
[perf] render p328: ... total=129ms
[perf] render p325: ... total=150ms
[perf] render p324: ... total=172ms
...
[perf] render p319: ... total=2750ms    ← 累積延遲
```

從 READY 後瞬間湧出 100+ 頁 render 請求，每個在 PDF.js 內部 queue 中排隊、累積延遲。

### Debug log for `renderPages` 事件

加了 `renderPages #N: indices=[...] current=X visible=[...]` 診斷後發現：

```
[perf] renderPages #1: indices=[0,1] current=-1 visible=[-1,0] portrait=false
[perf] renderPages #2: indices=[318,319,320,321] current=319 visible=[319,320] portrait=false
```

**只觸發 2 次**。filter 邏輯正確，視覺指標只有 3 個 index，但後面卻有 25+ 頁在 render。證明有**其他路徑**在呼叫 `renderPageCached`，繞過 filter。

### 真兇：`buildThumbnails()`

`grep renderPageCached` 找到縮圖建構函數在 init 時對所有 N 頁**逐一**呼叫 `renderPageCached`，一次塞 328（或 592）個 render 進 PDF.js 佇列。

## 根本原因總結

### 1. 縮圖預載爆量（主因）

`buildThumbnails()` 每頁都發一個 `renderPageCached` request：

```js
for (const pageNum of pages) {
  renderPageCached(pdf, pageNum, pdfUrl).then(...);  // ← 一次 N 個並發
}
```

PDF.js 將它們序列化到內部 queue，每個耗 ~200ms 主執行緒時間 → 累積卡數秒 ~ 數十秒。

### 2. StPageFlip fork 的 `requestedPages` dedup bug

在 `lib/st-page-flip/src/PageFlip.ts::emitRenderPages`：

```ts
const realIdx = this.pages.internalToReal(i);
if (!this.requestedPages.has(realIdx)) {
  needed.push(realIdx);
  this.requestedPages.add(realIdx);  // ← 永久記住
}
```

最初試過「在 `renderPages` 事件 handler 內 filter 掉非可見頁」，但 fork 會把**已 emit 過的 index 永久加入 requestedPages**，下次不再 emit。結果：被 filter 跳過的頁永遠不會被 render。

實際症狀：初始 cover spread 的 event 帶 `[326, 327]`（page 2、page 1），filter 只放 page 1 過；`requestedPages` 卻把 326 也加進去。之後使用者翻到該頁，`emitRenderPages` 不會再 emit 326 → **偶數頁永遠是佔位圖**。

### 3. RTL 初始化時 StPageFlip 的多次 show 呼叫

`loadFromImages` → `pages.show(startPage)` → `showSpread` → `updatePageIndex` → `emitRenderPages`。
`turnToPage(savedIdx)` → `pages.show(savedIdx)` → `showSpread` → ... 再 emit 一次。

加上 resize handler 的 debounced buildBook 重建，也會再 emit。累積造成 `requestedPages` 持續增長。

## 最終架構

### 渲染策略：完全忽略 `renderPages`，改由 `flip` 事件驅動

```
┌──────────────────────────────────────────┐
│  StPageFlip renderPages 事件（忽略）    │
└──────────────────────────────────────────┘
                    ✗

┌──────────────────────────────────────────┐
│  buildBook() 結束                          │
│       ↓                                    │
│  renderCurrentVisible()  ── 初始可見       │
└──────────────────────────────────────────┘
                    ↓
┌──────────────────────────────────────────┐
│  使用者翻頁 → flip event                  │
│       ↓                                    │
│  renderCurrentVisible()  ── 翻完新頁       │
└──────────────────────────────────────────┘
                    ↓
┌──────────────────────────────────────────┐
│  activeRender (Promise chain)             │
│   - 串行執行，一次只跑一個 PDF.render     │
│   - 渲染 current spread                   │
│   - preload 下一 spread（方向感知）        │
│   - render 前後都 re-check visibility      │
└──────────────────────────────────────────┘
```

### `renderCurrentVisible()` 函數

```ts
function renderCurrentVisible(): void {
  activeRender = activeRender.then(async () => {
    if (!pageFlip) return;
    const currentIdx = pageFlip.getCurrentPageIndex();
    const isPortrait = pageFlip.getOrientation() === 'portrait';

    // 1. 當前 spread（必 render）
    const visible: number[] = [currentIdx];
    if (!isPortrait) visible.push(currentIdx + 1);

    // 2. 下一 spread（preload，方向感知）
    const direction = isRtl ? -1 : 1;   // RTL: idx 往小走
    const stride = isPortrait ? 1 : 2;
    const preload: number[] = [currentIdx + direction * stride];
    if (!isPortrait) preload.push(currentIdx + direction * stride + 1);

    const targets = [...visible, ...preload];

    for (const idx of targets) {
      if (idx < 0 || idx >= currentPageMap.length) continue;
      const originalPage = currentPageMap[idx];
      if (!originalPage) continue;
      if (renderedPages.has(originalPage)) {
        pageFlip.updatePageImage(idx, renderedPages.get(originalPage)!);
        continue;
      }
      try {
        const data = await renderPageCached(pdf, originalPage, pdfUrl);
        renderedPages.set(originalPage, data.dataUrl);
        // 再 check：使用者可能翻走了
        const nowIdx = pageFlip.getCurrentPageIndex();
        const nowIsPortrait = pageFlip.getOrientation() === 'portrait';
        if (nowIdx === idx || (!nowIsPortrait && nowIdx + 1 === idx)) {
          pageFlip.updatePageImage(idx, data.dataUrl);
        }
      } catch { /* non-fatal */ }
    }
  }).catch(() => {});
}
```

### 縮圖懶載入（Lazy thumbnails）

從 eager 全量 render 改成 `IntersectionObserver`：

```ts
const thumbObserver = new IntersectionObserver((entries) => {
  for (const entry of entries) {
    if (!entry.isIntersecting) continue;
    const img = entry.target as HTMLImageElement;
    const pageNum = Number(img.dataset.pageNum);
    if (!pageNum) continue;
    thumbObserver.unobserve(img);
    // 進入視窗才 render，串行執行
    thumbRenderQueue = thumbRenderQueue.then(async () => {
      const data = await renderPageCached(pdf, pageNum, pdfUrl);
      renderedPages.set(pageNum, data.dataUrl);
      img.src = data.dataUrl;
    }).catch(() => {});
  }
}, {
  root: thumbOverlay,
  rootMargin: '200px',  // 提前一點 preload
});
```

縮圖 overlay 預設 `hidden`，observer 不會觸發。使用者點縮圖按鈕 overlay 顯示時，進入視窗的才開始 render，並用獨立的 `thumbRenderQueue` 串行化。

### 起始 3 頁 preload

READY 後 500ms 自動預載原稿 page 1、2、3（不管 RTL 或 LTR，都是書的開頭）：

```ts
setTimeout(() => {
  void (async () => {
    for (const pageNum of [1, 2, 3]) {
      if (pageNum > numPages) break;
      if (renderedPages.has(pageNum)) continue;
      try {
        const data = await renderPageCached(pdf, pageNum, pdfUrl);
        renderedPages.set(pageNum, data.dataUrl);
        // 若正好是當前可見頁，立即 update viewer
        const realIdx = currentPageMap.indexOf(pageNum);
        if (realIdx < 0 || !pageFlip) continue;
        const currentIdx = pageFlip.getCurrentPageIndex();
        const isPortrait = pageFlip.getOrientation() === 'portrait';
        if (realIdx === currentIdx || (!isPortrait && realIdx === currentIdx + 1)) {
          pageFlip.updatePageImage(realIdx, data.dataUrl);
        }
      } catch { /* non-fatal */ }
    }
  })();
}, 500);
```

### Loading Placeholder 視覺設計

從「灰白底 + Loading 字 + 脈動灰圓點」改成「紙張漸層 + 環形 spinner」：

```
┌────────────────────────────┐
│                            │
│      淡米白漸層紙張         │
│                            │
│          ╭──╮              │
│         ( ◎ )  ← 轉動弧    │
│          ╰──╯              │
│                            │
│                            │
└────────────────────────────┘
```

| 元素 | 規格 |
|---|---|
| 背景 | `linearGradient` `#faf6ec` → `#ece4d2` |
| 頁框 | 內縮 20px 半透明咖啡色線 `rgba(120,100,70,0.08)` |
| Spinner 底環 | `stroke rgba(100,85,60,0.12)` `stroke-width 3.5` |
| Spinner 弧 | `stroke rgba(90,75,50,0.55)` `stroke-dasharray "41 122"` 四分之一圓 |
| 動畫 | `animateTransform rotate 0→360 1.1s infinite` |
| preserveAspectRatio | `xMidYMid slice`（撐滿，邊緣溢出無妨） |

## 具體改動清單

| Commit | 內容 |
|---|---|
| `f8b5354` | 加 `ViewerConfig.turnPage` 支援初始 RTL；移除 html-book 模式 |
| `b5708c5` | 移除 `#book-area` 開發用的 picsum.photos 測試背景 |
| `834781c` | StPageFlip 設定 `preloadRange: 3 → 1` |
| `29f3022` | `RENDER_SCALE: 3 → 2`；加 Loading SVG 佔位圖；`requestIdleCallback` 延後 render |
| `ff9d64f` | renderPages handler 加入「只放行 visible」filter（後來被完全棄用） |
| `3bb75ac` | 縮圖改成 IntersectionObserver 懶載入 |
| `e800ada` | READY 後 500ms 預載原稿 page 1, 2, 3 |
| `f4b991e` | 渲染改由 `flip` 事件驅動，放棄 `renderPages` handler |
| `2d3e7e8` | `renderCurrentVisible` 加入「下一 spread preload」（方向感知） |
| `c254f5c` | Loading placeholder 重新設計（紙張漸層 + 環形 spinner） |

## 關鍵設定值

```ts
// src/app.ts
const RENDER_SCALE = 2;              // Retina 級清晰度，比 3 省一半 CPU / 記憶體

// StPageFlip options
{
  flippingTime: 450,
  preloadRange: 1,                   // 我們忽略它的 renderPages event，此值其實不重要
  showEdge: true,
  curlIntensity: 0,                  // Mesh curl 關閉（Canvas 2D 畫面有接縫）
  canvasBgColor: 'transparent',
  usePortrait: true,
}

// WebP quality
canvas.toDataURL('image/webp', 0.92) // 視覺等同 lossless，~30-50% 省空間
```

## 最終預期行為

**開書瞬間（0 ~ 500ms）**：
- 初始化 PDF.js、解析 PDF、render first page（拿 dimensions）
- `buildBook` 建立 StPageFlip
- `renderCurrentVisible()` 把當前 spread 和下一 spread render 出來
- READY，loading indicator 消失

**開書後 500ms**：
- 背景啟動原稿 page 1, 2, 3 預載（若已 cache 則 skip）

**使用者翻頁**：
- 動畫 450ms 流暢跑完（主執行緒無背景工作）
- flip 事件觸發 → `renderCurrentVisible()` → 當前 spread cache hit，下一 spread 背景 render
- 翻到沒看過的頁最多看到 Loading placeholder ~500ms
- 翻回看過的頁 → cache hit → 瞬間顯示

**縮圖 overlay**：
- 關閉時不 render 任何縮圖
- 打開後 IntersectionObserver 觸發 → 進入視窗的縮圖才開始 render
- 滾動時漸進出現，不會一次凍結主執行緒

## 未來可考慮的優化

- **OffscreenCanvas + Web Worker** — 把 PDF.render 和 `canvas.toDataURL` 搬到背景執行緒，主執行緒完全不參與。Safari 17+ 支援，舊版需 fallback。
- **後端預渲染** — 上傳書時在 worker 端把每頁轉成 WebP 存 Storage，viewer 直接 fetch 圖。適合 library 的「一次出版、多人閱讀」場景。
- **修 StPageFlip fork 的 `requestedPages` 行為** — 讓它支援 unrequest，或改成 WeakSet 自動回收。目前被我們完全繞過，但根本缺陷還在。
- **縮圖分層式預載** — 靠近當前頁的縮圖優先，遠處的延後。

## 為什麼沒做

- **Service Worker 離線 cache** — 已有 IndexedDB page cache，效益重複。
- **降低 WebP quality** — 0.92 視覺幾乎無損，降了反而破壞閱讀品質。
- **`showEdge: false`** — A/B 測試證實非瓶頸，保留 3D 書脊效果。
- **Mesh curl** — Canvas 2D 的接縫問題還未解，等 WebGL 路線。
