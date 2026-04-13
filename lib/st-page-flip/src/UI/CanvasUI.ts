import {UI} from "./UI";
import {PageFlip} from "../PageFlip";
import {FlipSetting} from "../Settings";

/**
 * UI for canvas mode
 */
export class CanvasUI extends UI {
    private readonly canvas: HTMLCanvasElement;

    constructor(inBlock: HTMLElement, app: PageFlip, setting: FlipSetting) {
        super(inBlock, app, setting);

        this.wrapper.innerHTML = '<canvas class="stf__canvas" role="img" aria-label="Interactive page flip viewer"></canvas>';

        this.canvas = inBlock.querySelectorAll('canvas')[0]!;

        this.distElement = this.canvas;

        this.resizeCanvas();
        this.setHandlers();
    }

    private resizeCanvas(): void {
        // Reset inline height to read wrapper's CSS-determined size
        this.canvas.style.height = '100%';
        this.canvas.style.marginTop = '';

        const cs = getComputedStyle(this.canvas);
        const width = parseInt(cs.getPropertyValue('width'), 10);
        const height = parseInt(cs.getPropertyValue('height'), 10);

        // Store original height so Render can size the book correctly
        this.canvas.dataset.bookHeight = String(height);

        // Extend canvas for curl room (both pixel buffer and CSS display)
        const curlPad = Math.round(height * 0.08);
        const totalHeight = height + curlPad * 2;

        // Render at 2x minimum for crisp text, or higher if screen demands it
        const dpr = Math.max(2, window.devicePixelRatio || 1);
        this.canvas.width = Math.round(width * dpr);
        this.canvas.height = Math.round(totalHeight * dpr);

        // CSS keeps the canvas at its logical size
        this.canvas.style.width = `${width}px`;
        this.canvas.style.height = `${totalHeight}px`;
        this.canvas.style.marginTop = `-${curlPad}px`;
    }

    /**
     * Get canvas element
     */
    public getCanvas(): HTMLCanvasElement {
        return this.canvas;
    }

    public update(): void {
        this.resizeCanvas();
        this.app.getRender().update();
    }
}