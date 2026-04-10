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

    protected drawFrame(): void {
        this.clear();

        const bookRect = this.getRect();
        const pc = this.app.getPageCollection();
        const idx = pc.getCurrentPageIndex();
        const leftIsBlank = pc.isBlankPage(idx);
        const rightIsBlank = pc.isBlankPage(idx + 1);

        // During animation, use full book area so flipping page can
        // render across both sides. When static and a blank page is
        // showing, clip to only the real page half.
        const isAnimating = this.flippingPage !== null;
        this.ctx.save();
        this.ctx.beginPath();
        if (!isAnimating && leftIsBlank && this.orientation !== Orientation.PORTRAIT) {
            this.ctx.rect(
                bookRect.left + bookRect.pageWidth,
                bookRect.top + 1,
                bookRect.pageWidth - 1,
                bookRect.height - 2
            );
        } else if (!isAnimating && rightIsBlank && this.orientation !== Orientation.PORTRAIT) {
            this.ctx.rect(
                bookRect.left + 1,
                bookRect.top + 1,
                bookRect.pageWidth - 1,
                bookRect.height - 2
            );
        } else {
            this.ctx.rect(
                bookRect.left + 1,
                bookRect.top + 1,
                bookRect.width - 2,
                bookRect.height - 2
            );
        }
        this.ctx.clip();

        if (this.orientation !== Orientation.PORTRAIT)
            if (this.leftPage != null && !leftIsBlank) this.leftPage.simpleDraw(PageOrientation.LEFT);

        if (this.rightPage != null && !rightIsBlank) this.rightPage.simpleDraw(PageOrientation.RIGHT);

        if (this.bottomPage != null) this.bottomPage.draw();

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
