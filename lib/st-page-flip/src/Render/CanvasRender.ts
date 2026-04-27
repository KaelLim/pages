import { Orientation, Render } from './Render';
import { PageFlip } from '../PageFlip';
import { FlipDirection } from '../Flip/Flip';
import { PageOrientation } from '../Page/Page';
import { FlipSetting } from '../Settings';

/**
 * Class responsible for rendering the Canvas book
 */
export class CanvasRender extends Render {
    private readonly canvas: HTMLCanvasElement;
    private readonly ctx: CanvasRenderingContext2D;

    /** Smoothed edge reading progress (0-1), lerps toward target each frame */
    private edgeProgress: number = 0;

    constructor(app: PageFlip, setting: FlipSetting, inCanvas: HTMLCanvasElement) {
        super(app, setting);

        this.canvas = inCanvas;
        this.ctx = inCanvas.getContext('2d');
    }

    public getContext(): CanvasRenderingContext2D {
        return this.ctx;
    }

    public reload(): void {
        //
    }

    /** Snap edge progress to current reading position (skip lerp) */
    public snapEdgeProgress(): void {
        const offset = this.getSettings().edgePageOffset || 0;
        const pageCount = Math.max(this.app.getPageCount() - offset, 1);
        const currentPage = Math.max(this.app.getCurrentPageIndex() - offset, 0);
        this.edgeProgress = currentPage / Math.max(pageCount - 1, 1);
    }

    protected drawFrame(): void {
        this.clear();

        // Match canvas buffer scale (2x minimum for crisp text)
        const dpr = Math.max(2, window.devicePixelRatio || 1);
        this.ctx.save();
        this.ctx.scale(dpr, dpr);

        const bookRect = this.getRect();
        const pc = this.app.getPageCollection();
        const idx = pc.getCurrentPageIndex();
        const leftIsBlank = pc.isBlankPage(idx);
        // In portrait, rightPage is set explicitly to the visible real page —
        // idx+1 might be a blank padding from the next spread but is irrelevant.
        const rightIsBlank = this.orientation === Orientation.PORTRAIT
            ? false
            : pc.isBlankPage(idx + 1);

        const isAnimating = this.flippingPage !== null;
        this.ctx.save();
        this.ctx.beginPath();

        // Logical canvas height (CSS pixels, not physical)
        const logicalH = this.canvas.height / Math.max(2, window.devicePixelRatio || 1);

        if (!isAnimating && this.orientation !== Orientation.PORTRAIT
            && (leftIsBlank || rightIsBlank)) {
            // Static blank spread: clip to real page half only
            const clipX = leftIsBlank
                ? bookRect.left + bookRect.pageWidth
                : bookRect.left + 1;
            this.ctx.rect(clipX, 0, bookRect.pageWidth - 1, logicalH);
        } else {
            // Clip left/right to prevent spine subpixel artifact,
            // but extend top/bottom to full canvas for curl room.
            this.ctx.rect(
                bookRect.left + 1, 0,
                bookRect.width - 2, logicalH
            );
        }
        this.ctx.clip();

        if (this.orientation !== Orientation.PORTRAIT)
            if (this.leftPage != null && !leftIsBlank) this.leftPage.simpleDraw(PageOrientation.LEFT);

        if (this.rightPage != null && !rightIsBlank) this.rightPage.simpleDraw(PageOrientation.RIGHT);

        if (this.bottomPage != null) this.bottomPage.draw();

        // Spine shadow: behind flipping page (normal depth)
        this.drawBookShadow();

        if (this.shadow != null) {
            this.drawCurlShadow();
        }

        if (this.flippingPage != null) this.flippingPage.draw();

        if (this.shadow != null) {
            this.drawOuterShadow();
            this.drawInnerShadow();
        }


        if (this.orientation === Orientation.PORTRAIT) {
            this.ctx.beginPath();
            this.ctx.rect(bookRect.left + bookRect.pageWidth, bookRect.top, bookRect.width, bookRect.height);
            this.ctx.clip();
        }

        this.ctx.restore();

        // Edges drawn outside main clip so they appear at book fore-edges
        this.drawEdges();

        this.ctx.restore(); // HiDPI dpr scale
    }

    /**
     * Draw page-thickness edges at the left and right fore-edges of the book
     */
    private drawEdges(): void {
        if (!this.getSettings().showEdge) return;
        if (this.orientation === Orientation.PORTRAIT) return;

        const rect = this.getRect();
        const offset = this.getSettings().edgePageOffset || 0;
        const pageCount = Math.max(this.app.getPageCount() - offset, 1);
        const currentPage = Math.max(this.app.getCurrentPageIndex() - offset, 0);
        // Scale edge thickness by page count — thin books get thin edges.
        // edgeWidth is the max for a ~200+ page book; fewer pages = proportionally thinner.
        const configMax = this.getSettings().edgeWidth;
        const maxWidth = Math.max(2, Math.min(configMax, configMax * (pageCount / 200)));
        const rtl = this.getSettings().rtl;

        const targetProgress = Math.max(0, Math.min(1,
            currentPage / Math.max(pageCount - 1, 1)
        ));

        // Snap edge immediately — real books transfer one page of
        // thickness from one side to the other in one discrete step.
        this.edgeProgress = targetProgress;

        let readProgress = rtl ? 1 - this.edgeProgress : this.edgeProgress;

        const readW = Math.round(readProgress * maxWidth);
        const unreadW = Math.round((1 - readProgress) * maxWidth);

        const leftWidth = rtl ? unreadW : readW;
        const rightWidth = rtl ? readW : unreadW;

        if (leftWidth >= 2) {
            this.drawSingleEdge(
                rect.left - leftWidth + 1, rect.top,
                leftWidth, rect.height, 'left'
            );
        }
        if (rightWidth >= 2) {
            this.drawSingleEdge(
                rect.left + rect.width - 1, rect.top,
                rightWidth, rect.height, 'right'
            );
        }
    }

    /**
     * Draw one fore-edge with realistic page-layer texture and 3D depth
     */
    private drawSingleEdge(
        x: number, y: number,
        w: number, h: number,
        side: 'left' | 'right'
    ): void {
        const ctx = this.ctx;
        const isLeft = side === 'left';

        ctx.save();
        ctx.translate(x, y);

        // ── Curved edge clip path ──
        ctx.beginPath();
        if (isLeft) {
            ctx.moveTo(w, 0);
            ctx.bezierCurveTo(w * 0.25, h * 0.015, 0, h * 0.035, 0, h * 0.05);
            ctx.lineTo(0, h * 0.95);
            ctx.bezierCurveTo(0, h * 0.965, w * 0.25, h * 0.985, w, h);
            ctx.lineTo(w, 0);
        } else {
            ctx.moveTo(0, 0);
            ctx.bezierCurveTo(w * 0.75, h * 0.015, w, h * 0.035, w, h * 0.05);
            ctx.lineTo(w, h * 0.95);
            ctx.bezierCurveTo(w, h * 0.965, w * 0.75, h * 0.985, 0, h);
            ctx.lineTo(0, 0);
        }
        ctx.clip();

        // ── Base paper fill ──
        const baseGrad = ctx.createLinearGradient(
            isLeft ? w : 0, 0, isLeft ? 0 : w, 0
        );
        baseGrad.addColorStop(0, '#f0ece4');
        baseGrad.addColorStop(0.3, '#e8e3d8');
        baseGrad.addColorStop(0.7, '#ddd8cc');
        baseGrad.addColorStop(1, '#d0cabe');
        ctx.fillStyle = baseGrad;
        ctx.fillRect(0, 0, w, h);

        // ── Page layer lines (varying opacity for realism) ──
        const lineSpacing = Math.max(1.2, w / Math.max(w * 2.5, 1));
        for (let lx = 0; lx < w; lx += lineSpacing) {
            const depthT = isLeft ? lx / w : 1 - lx / w;
            const alpha = 0.08 + depthT * 0.18;
            ctx.strokeStyle = `rgba(120, 110, 95, ${alpha})`;
            ctx.lineWidth = 0.4 + depthT * 0.3;
            ctx.beginPath();
            ctx.moveTo(lx, 0);
            ctx.lineTo(lx, h);
            ctx.stroke();
        }

        // ── Horizontal depth gradient (inner=light, outer=darker) ──
        const depthGrad = ctx.createLinearGradient(
            isLeft ? w : 0, 0, isLeft ? 0 : w, 0
        );
        depthGrad.addColorStop(0, 'rgba(255,255,255,0.15)');
        depthGrad.addColorStop(0.2, 'rgba(255,255,255,0.05)');
        depthGrad.addColorStop(0.6, 'rgba(0,0,0,0.04)');
        depthGrad.addColorStop(1, 'rgba(0,0,0,0.15)');
        ctx.fillStyle = depthGrad;
        ctx.fillRect(0, 0, w, h);

        // ── Vertical lighting gradient (top/bottom darker) ──
        const vGrad = ctx.createLinearGradient(0, 0, 0, h);
        vGrad.addColorStop(0, 'rgba(0,0,0,0.25)');
        vGrad.addColorStop(0.06, 'rgba(0,0,0,0.12)');
        vGrad.addColorStop(0.15, 'rgba(0,0,0,0.03)');
        vGrad.addColorStop(0.5, 'rgba(255,255,255,0.06)');
        vGrad.addColorStop(0.85, 'rgba(0,0,0,0.03)');
        vGrad.addColorStop(0.94, 'rgba(0,0,0,0.12)');
        vGrad.addColorStop(1, 'rgba(0,0,0,0.25)');
        ctx.fillStyle = vGrad;
        ctx.fillRect(0, 0, w, h);

        // ── Inner highlight line near spine ──
        const hlX = isLeft ? w - 0.5 : 0.5;
        const hlGrad = ctx.createLinearGradient(0, 0, 0, h);
        hlGrad.addColorStop(0, 'rgba(255,255,255,0)');
        hlGrad.addColorStop(0.1, 'rgba(255,255,255,0.3)');
        hlGrad.addColorStop(0.5, 'rgba(255,255,255,0.4)');
        hlGrad.addColorStop(0.9, 'rgba(255,255,255,0.3)');
        hlGrad.addColorStop(1, 'rgba(255,255,255,0)');
        ctx.strokeStyle = hlGrad;
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.moveTo(hlX, h * 0.05);
        ctx.lineTo(hlX, h * 0.95);
        ctx.stroke();

        ctx.restore();

        // ── Outer shadow along the fore-edge ──
        ctx.save();
        ctx.translate(x, y);
        ctx.shadowColor = 'rgba(0,0,0,0.25)';
        ctx.shadowBlur = 3;
        ctx.shadowOffsetX = isLeft ? -1.5 : 1.5;
        ctx.shadowOffsetY = 0;

        ctx.beginPath();
        const outerX = isLeft ? 0 : w;
        ctx.moveTo(outerX, h * 0.05);
        ctx.bezierCurveTo(
            outerX, h * 0.3,
            outerX, h * 0.7,
            outerX, h * 0.95
        );
        ctx.strokeStyle = 'rgba(0,0,0,0.1)';
        ctx.lineWidth = 0.8;
        ctx.stroke();
        ctx.restore();
    }

    private drawBookShadow(): void {
        // Skip spine shadow when either side is a blank page
        // (first/last spread has only one real page)
        const pc = this.app.getPageCollection();
        const idx = pc.getCurrentPageIndex();
        if (pc.isBlankPage(idx) || pc.isBlankPage(idx + 1)) return;

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

    private drawOuterShadow(): void {
        const rect = this.getRect();

        this.ctx.save();
        this.ctx.beginPath();

        this.ctx.rect(rect.left, rect.top, rect.width, rect.height);

        const shadowPos = this.convertToGlobal({ x: this.shadow.pos.x, y: this.shadow.pos.y });
        this.ctx.translate(shadowPos.x, shadowPos.y);

        this.ctx.rotate(Math.PI + this.shadow.angle + Math.PI / 2);

        const outerGradient = this.ctx.createLinearGradient(0, 0, this.shadow.width, 0);

        if (this.shadow.direction === FlipDirection.FORWARD) {
            this.ctx.translate(0, -100);
            outerGradient.addColorStop(0, 'rgba(0, 0, 0, ' + this.shadow.opacity + ')');
            outerGradient.addColorStop(1, 'rgba(0, 0, 0, 0)');
        } else {
            this.ctx.translate(-this.shadow.width, -100);
            outerGradient.addColorStop(0, 'rgba(0, 0, 0, 0)');
            outerGradient.addColorStop(1, 'rgba(0, 0, 0, ' + this.shadow.opacity + ')');
        }

        this.ctx.clip();

        this.ctx.fillStyle = outerGradient;
        this.ctx.fillRect(0, 0, this.shadow.width, rect.height * 2);

        this.ctx.restore();
    }

    private drawInnerShadow(): void {
        const rect = this.getRect();

        this.ctx.save();
        this.ctx.beginPath();

        const shadowPos = this.convertToGlobal({ x: this.shadow.pos.x, y: this.shadow.pos.y });

        const pageRect = this.convertRectToGlobal(this.pageRect);
        this.ctx.moveTo(pageRect.topLeft.x, pageRect.topLeft.y);
        this.ctx.lineTo(pageRect.topRight.x, pageRect.topRight.y);
        this.ctx.lineTo(pageRect.bottomRight.x, pageRect.bottomRight.y);
        this.ctx.lineTo(pageRect.bottomLeft.x, pageRect.bottomLeft.y);
        this.ctx.translate(shadowPos.x, shadowPos.y);

        this.ctx.rotate(Math.PI + this.shadow.angle + Math.PI / 2);

        const isw = (this.shadow.width * 3) / 4;
        const innerGradient = this.ctx.createLinearGradient(0, 0, isw, 0);

        if (this.shadow.direction === FlipDirection.FORWARD) {
            this.ctx.translate(-isw, -100);

            innerGradient.addColorStop(1, 'rgba(0, 0, 0, ' + this.shadow.opacity + ')');
            innerGradient.addColorStop(0.9, 'rgba(0, 0, 0, 0.05)');
            innerGradient.addColorStop(0.7, 'rgba(0, 0, 0, ' + this.shadow.opacity + ')');
            innerGradient.addColorStop(0, 'rgba(0, 0, 0, 0)');
        } else {
            this.ctx.translate(0, -100);

            innerGradient.addColorStop(0, 'rgba(0, 0, 0, ' + this.shadow.opacity + ')');
            innerGradient.addColorStop(0.1, 'rgba(0, 0, 0, 0.05)');
            innerGradient.addColorStop(0.3, 'rgba(0, 0, 0, ' + this.shadow.opacity + ')');
            innerGradient.addColorStop(1, 'rgba(0, 0, 0, 0)');
        }

        this.ctx.clip();

        this.ctx.fillStyle = innerGradient;
        this.ctx.fillRect(0, 0, isw, rect.height * 2);

        this.ctx.restore();
    }

    /**
     * Draw a soft shadow under the curling page to simulate it lifting
     * off the surface. Only drawn when curl data is available.
     */
    private drawCurlShadow(): void {
        if (this.flippingPage === null || this.pageRect === null) return;

        const state = (this.flippingPage as any).state;
        if (!state?.curlData || state.curlData.intensity < 0.05) return;

        const rect = this.getRect();
        const curlData = state.curlData;

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
        const pageRect = this.convertRectToGlobal(this.pageRect);
        this.ctx.beginPath();
        this.ctx.moveTo(pageRect.topLeft.x, pageRect.topLeft.y);
        this.ctx.lineTo(pageRect.topRight.x, pageRect.topRight.y);
        this.ctx.lineTo(pageRect.bottomRight.x, pageRect.bottomRight.y);
        this.ctx.lineTo(pageRect.bottomLeft.x, pageRect.bottomLeft.y);
        this.ctx.closePath();

        this.ctx.fillStyle = 'rgba(0, 0, 0, 0)';
        this.ctx.fill();

        this.ctx.restore();
    }

    private clear(): void {
        const bg = this.getSettings().canvasBgColor;
        if (bg === 'transparent') {
            this.ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
        } else {
            this.ctx.fillStyle = bg;
            this.ctx.fillRect(0, 0, this.canvas.width, this.canvas.height);
        }
    }
}
