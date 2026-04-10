import { CanvasRender } from '../Render/CanvasRender';
import { Page, PageDensity, PageOrientation } from './Page';
import { Render } from '../Render/Render';
import { CurlData, Point } from '../BasicTypes';

/**
 * Class representing a book page as an image on Canvas
 */
export class ImagePage extends Page {
    private readonly image: HTMLImageElement = null;
    private isLoad = false;

    private loadingAngle = 0;

    constructor(render: Render, href: string, density: PageDensity) {
        super(render, density);

        this.image = new Image();
        this.image.src = href;
    }

    public draw(tempDensity?: PageDensity): void {
        // Use curl rendering when curl data is available
        if (this.state.curlData !== null && this.state.curlData.intensity > 0) {
            this.drawCurled(this.state.curlData);
            return;
        }

        const ctx = (this.render as CanvasRender).getContext();

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
            // Only fill background for unloaded/blank pages to mask static pages.
            // Loaded images fully cover the clip area — filling first would
            // erase static page pixels and cause subpixel gaps at fold lines.
            const bg = this.render.getSettings().canvasBgColor;
            if (bg === 'transparent') {
                ctx.clearRect(0, 0, pageWidth, pageHeight);
            } else {
                ctx.fillStyle = bg;
                ctx.fillRect(0, 0, pageWidth, pageHeight);
            }
            this.drawLoader(ctx, { x: 0, y: 0 }, pageWidth, pageHeight);
        } else {
            ctx.drawImage(this.image, 0, 0, pageWidth, pageHeight);
        }

        ctx.restore();
    }

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

        // Build clip path BEFORE rotating (must match original draw() order)
        ctx.beginPath();
        for (let p of this.state.area) {
            if (p !== null) {
                p = this.render.convertToGlobal(p);
                ctx.lineTo(p.x - pagePos.x, p.y - pagePos.y);
            }
        }

        ctx.rotate(this.state.angle);
        ctx.clip();

        const imgW = this.image.naturalWidth;
        const imgH = this.image.naturalHeight;

        // Draw each mesh strip with its own transform
        for (const strip of curlData.strips) {
            const srcX = strip.t * imgW;
            const srcW = (strip.width / pageWidth) * imgW;

            ctx.save();

            // Position at strip's x location with curl lift
            ctx.translate(strip.x, strip.yOffset);

            // Rotate strip around its left edge to simulate curl
            if (strip.angle !== 0) {
                ctx.rotate(strip.angle);
            }

            // Compensate height for rotation — rotated strips are shorter
            // at the bottom, so extend to prevent gaps at fold line
            const h = strip.angle !== 0
                ? pageHeight / Math.cos(Math.abs(strip.angle)) + 1
                : pageHeight;

            // Draw the strip slice of the source image
            ctx.drawImage(
                this.image,
                srcX, 0, srcW, imgH,      // source rect
                0, 0, strip.width, h       // dest rect (extended)
            );

            // Apply lighting overlay
            if (strip.light !== 1.0) {
                if (strip.light > 1.0) {
                    const alpha = Math.min((strip.light - 1.0) * 0.5, 0.15);
                    ctx.fillStyle = `rgba(255, 255, 255, ${alpha})`;
                    ctx.fillRect(0, 0, strip.width, h);
                } else {
                    const alpha = 1.0 - strip.light;
                    ctx.fillStyle = `rgba(0, 0, 0, ${alpha})`;
                    ctx.fillRect(0, 0, strip.width, h);
                }
            }

            ctx.restore();
        }

        ctx.restore();
    }

    public simpleDraw(orient: PageOrientation): void {
        const rect = this.render.getRect();
        const ctx = (this.render as CanvasRender).getContext();

        const pageWidth = rect.pageWidth;
        const pageHeight = rect.height;

        const x = orient === PageOrientation.RIGHT ? rect.left + rect.pageWidth : rect.left;

        const y = rect.top;

        if (!this.isLoad) {
            this.drawLoader(ctx, { x, y }, pageWidth, pageHeight);
        } else {
            ctx.drawImage(this.image, x, y, pageWidth, pageHeight);
        }
    }

    private drawLoader(
        ctx: CanvasRenderingContext2D,
        shiftPos: Point,
        pageWidth: number,
        pageHeight: number
    ): void {
        ctx.beginPath();
        ctx.strokeStyle = 'rgb(200, 200, 200)';
        ctx.fillStyle = 'rgb(255, 255, 255)';
        ctx.lineWidth = 1;
        ctx.rect(shiftPos.x + 1, shiftPos.y + 1, pageWidth - 1, pageHeight - 1);
        ctx.stroke();
        ctx.fill();

        const middlePoint: Point = {
            x: shiftPos.x + pageWidth / 2,
            y: shiftPos.y + pageHeight / 2,
        };

        ctx.beginPath();
        ctx.lineWidth = 10;
        ctx.arc(
            middlePoint.x,
            middlePoint.y,
            20,
            this.loadingAngle,
            (3 * Math.PI) / 2 + this.loadingAngle
        );
        ctx.stroke();
        ctx.closePath();

        this.loadingAngle += 0.07;
        if (this.loadingAngle >= 2 * Math.PI) {
            this.loadingAngle = 0;
        }
    }

    public load(): void {
        if (!this.isLoad)
            this.image.onload = (): void => {
                this.isLoad = true;
            };
    }

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

    public newTemporaryCopy(): Page {
        return this;
    }

    public getTemporaryCopy(): Page {
        return this;
    }

    public hideTemporaryCopy(): void {
        return;
    }
}
