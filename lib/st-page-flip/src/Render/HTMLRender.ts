import { Orientation, Render } from './Render';
import { PageFlip } from '../PageFlip';
import { FlipDirection } from '../Flip/Flip';
import { PageDensity, PageOrientation } from '../Page/Page';
import { HTMLPage } from '../Page/HTMLPage';
import { Helper } from '../Helper';
import { FlipSetting } from '../Settings';

/**
 * Class responsible for rendering the HTML book
 */
export class HTMLRender extends Render {
    /** Parent HTML Element */
    private readonly element: HTMLElement;

    /** Pages List as HTMLElements */
    private readonly items: NodeListOf<HTMLElement> | HTMLElement[];

    private outerShadow: HTMLElement = null;
    private innerShadow: HTMLElement = null;
    private hardShadow: HTMLElement = null;
    private hardInnerShadow: HTMLElement = null;

    private leftEdge: HTMLElement = null;
    private rightEdge: HTMLElement = null;

    /**
     * @constructor
     *
     * @param {PageFlip} app - PageFlip object
     * @param {FlipSetting} setting - Configuration object
     * @param {HTMLElement} element - Parent HTML Element
     */
    constructor(app: PageFlip, setting: FlipSetting, element: HTMLElement) {
        super(app, setting);

        this.element = element;

        this.createShadows();
        this.createEdges();
    }

    private createShadows(): void {
        this.element.insertAdjacentHTML(
            'beforeend',
            `<div class="stf__outerShadow"></div>
             <div class="stf__innerShadow"></div>
             <div class="stf__hardShadow"></div>
             <div class="stf__hardInnerShadow"></div>`
        );

        this.outerShadow = this.element.querySelector('.stf__outerShadow');
        this.innerShadow = this.element.querySelector('.stf__innerShadow');
        this.hardShadow = this.element.querySelector('.stf__hardShadow');
        this.hardInnerShadow = this.element.querySelector('.stf__hardInnerShadow');
    }

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

    private drawEdges(): void {
        if (!this.getSettings().showEdge || !this.leftEdge || !this.rightEdge) return;

        if (this.orientation === Orientation.PORTRAIT) {
            this.leftEdge.style.display = 'none';
            this.rightEdge.style.display = 'none';
            return;
        }

        const rect = this.getRect();
        const offset = this.getSettings().edgePageOffset || 0;
        const pageCount = Math.max(this.app.getPageCount() - offset, 1);
        const currentPage = Math.max(this.app.getCurrentPageIndex() - offset, 0);
        const maxWidth = this.getSettings().edgeWidth;
        const rtl = this.getSettings().rtl;

        let readProgress = currentPage / Math.max(pageCount - 1, 1);

        // During flip animation, interpolate edge width toward destination
        if (this.flippingPage !== null && this.shadow !== null) {
            const flipT = Math.min(this.shadow.progress / 2, 100) / 100; // 0→1
            // Each flip moves 2 page indices (one spread)
            const step = 2 / Math.max(pageCount - 1, 1);

            if (this.direction === FlipDirection.FORWARD) {
                readProgress += step * flipT;
            } else {
                readProgress -= step * flipT;
            }
            readProgress = Math.max(0, Math.min(1, readProgress));
        }

        if (rtl) readProgress = 1 - readProgress;

        const readW = Math.round(readProgress * maxWidth);
        const unreadW = Math.round((1 - readProgress) * maxWidth);

        const leftWidth = rtl ? unreadW : readW;
        const rightWidth = rtl ? readW : unreadW;

        const zIndex = this.getSettings().startZIndex + 2;
        const bgLayers = `
            background:
                linear-gradient(to bottom,
                    rgba(0,0,0,0.3) 0%,
                    rgba(0,0,0,0.06) 20%,
                    rgba(255,255,255,0.1) 50%,
                    rgba(0,0,0,0.06) 80%,
                    rgba(0,0,0,0.3) 100%
                ),
                repeating-linear-gradient(
                    90deg,
                    #e8e3d8 0px,
                    #e8e3d8 1.5px,
                    #9a9488 1.5px,
                    #9a9488 2px
                );`;

        // Position at outer edges of the book (fore-edges)
        // Hide edge when no pages on that side
        if (leftWidth < 2) {
            this.leftEdge.style.cssText = 'display: none';
        } else {
            this.leftEdge.style.cssText = `
                display: block;
                position: absolute;
                z-index: ${zIndex};
                left: ${rect.left - leftWidth}px;
                top: ${rect.top}px;
                width: ${leftWidth}px;
                height: ${rect.height}px;
                pointer-events: none;
                ${bgLayers}
                clip-path: polygon(
                    100% 0%, 90% 0%, 60% 1%, 30% 2.5%,
                    10% 4%, 0% 6%, 0% 94%, 10% 96%,
                    30% 97.5%, 60% 99%, 90% 100%, 100% 100%
                );
                filter: drop-shadow(-1px 0 1px rgba(0,0,0,0.2));
            `;
        }

        if (rightWidth < 2) {
            this.rightEdge.style.cssText = 'display: none';
        } else {
            this.rightEdge.style.cssText = `
                display: block;
                position: absolute;
                z-index: ${zIndex};
                left: ${rect.left + rect.width}px;
                top: ${rect.top}px;
                width: ${rightWidth}px;
                height: ${rect.height}px;
                pointer-events: none;
                ${bgLayers}
                clip-path: polygon(
                    0% 0%, 10% 0%, 40% 1%, 70% 2.5%,
                    90% 4%, 100% 6%, 100% 94%, 90% 96%,
                    70% 97.5%, 40% 99%, 10% 100%, 0% 100%
                );
                filter: drop-shadow(1px 0 1px rgba(0,0,0,0.2));
            `;
        }
    }

    public clearShadow(): void {
        super.clearShadow();

        this.outerShadow.style.cssText = 'display: none';
        this.innerShadow.style.cssText = 'display: none';
        this.hardShadow.style.cssText = 'display: none';
        this.hardInnerShadow.style.cssText = 'display: none';
    }

    public reload(): void {
        const testShadow = this.element.querySelector('.stf__outerShadow');

        if (!testShadow) {
            this.createShadows();
        }
    }

    /**
     * Draw inner shadow to the hard page
     */
    private drawHardInnerShadow(): void {
        const rect = this.getRect();

        const progress =
            this.shadow.progress > 100 ? 200 - this.shadow.progress : this.shadow.progress;

        let innerShadowSize = ((100 - progress) * (2.5 * rect.pageWidth)) / 100 + 20;
        if (innerShadowSize > rect.pageWidth) innerShadowSize = rect.pageWidth;

        let newStyle = `
            display: block;
            z-index: ${(this.getSettings().startZIndex + 5).toString(10)};
            width: ${innerShadowSize}px;
            height: ${rect.height}px;
            background: linear-gradient(to right,
                rgba(0, 0, 0, ${(this.shadow.opacity * progress) / 100}) 5%,
                rgba(0, 0, 0, 0) 100%);
            left: ${rect.left + rect.width / 2}px;
            transform-origin: 0 0;
        `;

        newStyle +=
            (this.getDirection() === FlipDirection.FORWARD && this.shadow.progress > 100) ||
            (this.getDirection() === FlipDirection.BACK && this.shadow.progress <= 100)
                ? `transform: translate3d(0, 0, 0);`
                : `transform: translate3d(0, 0, 0) rotateY(180deg);`;

        this.hardInnerShadow.style.cssText = newStyle;
    }

    /**
     * Draw outer shadow to the hard page
     */
    private drawHardOuterShadow(): void {
        const rect = this.getRect();

        const progress =
            this.shadow.progress > 100 ? 200 - this.shadow.progress : this.shadow.progress;

        let shadowSize = ((100 - progress) * (2.5 * rect.pageWidth)) / 100 + 20;
        if (shadowSize > rect.pageWidth) shadowSize = rect.pageWidth;

        let newStyle = `
            display: block;
            z-index: ${(this.getSettings().startZIndex + 4).toString(10)};
            width: ${shadowSize}px;
            height: ${rect.height}px;
            background: linear-gradient(to left, rgba(0, 0, 0, ${
                this.shadow.opacity
            }) 5%, rgba(0, 0, 0, 0) 100%);
            left: ${rect.left + rect.width / 2}px;
            transform-origin: 0 0;
        `;

        newStyle +=
            (this.getDirection() === FlipDirection.FORWARD && this.shadow.progress > 100) ||
            (this.getDirection() === FlipDirection.BACK && this.shadow.progress <= 100)
                ? `transform: translate3d(0, 0, 0) rotateY(180deg);`
                : `transform: translate3d(0, 0, 0);`;

        this.hardShadow.style.cssText = newStyle;
    }

    /**
     * Draw inner shadow to the soft page
     */
    private drawInnerShadow(): void {
        if (this.shadow.width < 2 || this.shadow.opacity < 0.01) {
            this.innerShadow.style.cssText = 'display: none';
            return;
        }

        const rect = this.getRect();

        const innerShadowSize = (this.shadow.width * 3) / 4;
        const shadowTranslate = this.getDirection() === FlipDirection.FORWARD ? innerShadowSize : 0;

        const shadowDirection =
            this.getDirection() === FlipDirection.FORWARD ? 'to left' : 'to right';

        const shadowPos = this.convertToGlobal(this.shadow.pos);

        const angle = this.shadow.angle + (3 * Math.PI) / 2;

        const clip = [
            this.pageRect.topLeft,
            this.pageRect.topRight,
            this.pageRect.bottomRight,
            this.pageRect.bottomLeft,
        ];

        let polygon = 'polygon( ';
        for (const p of clip) {
            let g =
                this.getDirection() === FlipDirection.BACK
                    ? {
                          x: -p.x + this.shadow.pos.x,
                          y: p.y - this.shadow.pos.y,
                      }
                    : {
                          x: p.x - this.shadow.pos.x,
                          y: p.y - this.shadow.pos.y,
                      };

            g = Helper.GetRotatedPoint(g, { x: shadowTranslate, y: 100 }, angle);

            polygon += g.x + 'px ' + g.y + 'px, ';
        }
        polygon = polygon.slice(0, -2);
        polygon += ')';

        const newStyle = `
            display: block;
            z-index: ${(this.getSettings().startZIndex + 10).toString(10)};
            width: ${innerShadowSize}px;
            height: ${rect.height * 2}px;
            background: linear-gradient(${shadowDirection},
                rgba(0, 0, 0, ${this.shadow.opacity}) 5%,
                rgba(0, 0, 0, 0.05) 15%,
                rgba(0, 0, 0, ${this.shadow.opacity}) 35%,
                rgba(0, 0, 0, 0) 100%);
            transform-origin: ${shadowTranslate}px 100px;
            transform: translate3d(${shadowPos.x - shadowTranslate}px, ${
            shadowPos.y - 100
        }px, 0) rotate(${angle}rad);
            clip-path: ${polygon};
            -webkit-clip-path: ${polygon};
        `;

        this.innerShadow.style.cssText = newStyle;
    }

    /**
     * Draw outer shadow to the soft page
     */
    private drawOuterShadow(): void {
        if (this.shadow.width < 2 || this.shadow.opacity < 0.01) {
            this.outerShadow.style.cssText = 'display: none';
            return;
        }

        const rect = this.getRect();

        const shadowPos = this.convertToGlobal({ x: this.shadow.pos.x, y: this.shadow.pos.y });

        const angle = this.shadow.angle + (3 * Math.PI) / 2;
        const shadowTranslate = this.getDirection() === FlipDirection.BACK ? this.shadow.width : 0;

        const shadowDirection =
            this.getDirection() === FlipDirection.FORWARD ? 'to right' : 'to left';

        const clip = [
            { x: 0, y: 0 },
            { x: rect.pageWidth, y: 0 },
            { x: rect.pageWidth, y: rect.height },
            { x: 0, y: rect.height },
        ];

        let polygon = 'polygon( ';
        for (const p of clip) {
            if (p !== null) {
                let g =
                    this.getDirection() === FlipDirection.BACK
                        ? {
                              x: -p.x + this.shadow.pos.x,
                              y: p.y - this.shadow.pos.y,
                          }
                        : {
                              x: p.x - this.shadow.pos.x,
                              y: p.y - this.shadow.pos.y,
                          };

                g = Helper.GetRotatedPoint(g, { x: shadowTranslate, y: 100 }, angle);

                polygon += g.x + 'px ' + g.y + 'px, ';
            }
        }

        polygon = polygon.slice(0, -2);
        polygon += ')';

        const newStyle = `
            display: block;
            z-index: ${(this.getSettings().startZIndex + 10).toString(10)};
            width: ${this.shadow.width}px;
            height: ${rect.height * 2}px;
            background: linear-gradient(${shadowDirection}, rgba(0, 0, 0, ${
            this.shadow.opacity
        }), rgba(0, 0, 0, 0));
            transform-origin: ${shadowTranslate}px 100px;
            transform: translate3d(${shadowPos.x - shadowTranslate}px, ${
            shadowPos.y - 100
        }px, 0) rotate(${angle}rad);
            clip-path: ${polygon};
            -webkit-clip-path: ${polygon};
        `;

        this.outerShadow.style.cssText = newStyle;
    }

    /**
     * Draw left static page
     */
    private drawLeftPage(): void {
        if (this.orientation === Orientation.PORTRAIT || this.leftPage === null) return;

        if (
            this.direction === FlipDirection.BACK &&
            this.flippingPage !== null &&
            this.flippingPage.getDrawingDensity() === PageDensity.HARD
        ) {
            (this.leftPage as HTMLPage).getElement().style.zIndex = (
                this.getSettings().startZIndex + 5
            ).toString(10);

            this.leftPage.setHardDrawingAngle(180 + this.flippingPage.getHardAngle());
            this.leftPage.draw(this.flippingPage.getDrawingDensity());
        } else {
            this.leftPage.simpleDraw(PageOrientation.LEFT);
        }
    }

    /**
     * Draw right static page
     */
    private drawRightPage(): void {
        if (this.rightPage === null) return;

        if (
            this.direction === FlipDirection.FORWARD &&
            this.flippingPage !== null &&
            this.flippingPage.getDrawingDensity() === PageDensity.HARD
        ) {
            (this.rightPage as HTMLPage).getElement().style.zIndex = (
                this.getSettings().startZIndex + 5
            ).toString(10);

            this.rightPage.setHardDrawingAngle(180 + this.flippingPage.getHardAngle());
            this.rightPage.draw(this.flippingPage.getDrawingDensity());
        } else {
            this.rightPage.simpleDraw(PageOrientation.RIGHT);
        }
    }

    /**
     * Draw the next page at the time of flipping
     */
    private drawBottomPage(): void {
        if (this.bottomPage === null) return;

        const tempDensity =
            this.flippingPage != null ? this.flippingPage.getDrawingDensity() : null;

        if (!(this.orientation === Orientation.PORTRAIT && this.direction === FlipDirection.BACK)) {
            (this.bottomPage as HTMLPage).getElement().style.zIndex = (
                this.getSettings().startZIndex + 3
            ).toString(10);

            this.bottomPage.draw(tempDensity);
        }
    }

    protected drawFrame(): void {
        this.clear();

        this.drawLeftPage();

        this.drawRightPage();

        this.drawBottomPage();

        // Near the end of flip animation, the clip-path becomes an extremely
        // narrow sliver (1-2px) due to the expanded boundRect in
        // FlipCalculation. Hide the flipping page and its shadows once
        // progress exceeds 98% to prevent the thin line artifact.
        const nearEnd = this.shadow !== null && this.shadow.progress > 196;

        if (this.flippingPage != null) {
            if (nearEnd) {
                (this.flippingPage as HTMLPage).getElement().style.cssText = 'display: none';
            } else {
                (this.flippingPage as HTMLPage).getElement().style.zIndex = (
                    this.getSettings().startZIndex + 5
                ).toString(10);

                this.flippingPage.draw();
            }
        }

        if (this.shadow != null && this.flippingPage !== null && !nearEnd) {
            if (this.flippingPage.getDrawingDensity() === PageDensity.SOFT) {
                this.drawOuterShadow();
                this.drawInnerShadow();
            } else {
                this.drawHardOuterShadow();
                this.drawHardInnerShadow();
            }
        }

        this.drawEdges();
    }

    private clear(): void {
        for (const page of this.app.getPageCollection().getPages()) {
            if (
                page !== this.leftPage &&
                page !== this.rightPage &&
                page !== this.flippingPage &&
                page !== this.bottomPage
            ) {
                (page as HTMLPage).getElement().style.cssText = 'display: none';
            }

            if (page.getTemporaryCopy() !== this.flippingPage) {
                page.hideTemporaryCopy();
            }
        }
    }

    public update(): void {
        super.update();

        if (this.rightPage !== null) {
            this.rightPage.setOrientation(PageOrientation.RIGHT);
        }

        if (this.leftPage !== null) {
            this.leftPage.setOrientation(PageOrientation.LEFT);
        }
    }
}
