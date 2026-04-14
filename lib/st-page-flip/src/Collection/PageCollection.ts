import { Orientation, Render } from '../Render/Render';
import { Page, PageDensity } from '../Page/Page';
import { PageFlip } from '../PageFlip';
import { FlipDirection } from '../Flip/Flip';

type NumberArray = number[];

/**
 * Сlass representing a collection of pages
 */
export abstract class PageCollection {
    protected readonly app: PageFlip;
    protected readonly render: Render;
    /** Pages List */
    protected pages: Page[] = [];
    /** Index of the current page in list */
    protected currentPageIndex = 0;

    /** Number of the current spread in book */
    protected currentSpreadIndex = 0;
    /**  Two-page spread in landscape mode */
    protected landscapeSpread: NumberArray[] = [];
    /**  One-page spread in portrait mode */
    protected portraitSpread: NumberArray[] = [];

    /** Blank pages inserted for spread padding */
    protected blankPages: Page[] = [];

    /** Number of blank pages before the first real page */
    protected blankStartCount = 0;

    protected constructor(app: PageFlip, render: Render) {
        this.render = render;
        this.app = app;

        this.currentPageIndex = 0;
    }

    /**
     * Load pages
     */
    public abstract load(): void;

    /**
     * Create a blank page element for spread padding
     */
    protected abstract createBlankPage(): Page;

    /**
     * Clear pages list
     */
    public destroy(): void {
        this.pages = [];
        this.blankPages = [];
    }

    /**
     * Insert blank pages so every landscape spread has exactly 2 pages.
     * Blank at the front (LTR) or end (RTL) prevents the single-page-spread
     * DOM conflict where flippingPage === bottomPage.
     */
    protected addBlankPages(): void {
        const rtl = this.app.getSettings().rtl;

        if (rtl) {
            const blank = this.createBlankPage();
            this.pages.push(blank);
            this.blankPages.push(blank);
        } else {
            const blank = this.createBlankPage();
            this.pages.unshift(blank);
            this.blankPages.push(blank);
            this.blankStartCount++;
        }

        // If still odd, add another blank at the opposite end
        if (this.pages.length % 2 !== 0) {
            const blank = this.createBlankPage();
            if (rtl) {
                this.pages.unshift(blank);
                this.blankStartCount++;
            } else {
                this.pages.push(blank);
            }
            this.blankPages.push(blank);
        }
    }

    /**
     * Check if a page index refers to a blank page
     */
    public isBlankPage(pageIndex: number): boolean {
        return pageIndex >= 0 && pageIndex < this.pages.length &&
            this.blankPages.indexOf(this.pages[pageIndex]!) >= 0;
    }

    /**
     * Get the number of blank pages
     */
    public getBlankCount(): number {
        return this.blankPages.length;
    }

    /**
     * Get the number of real (non-blank) pages
     */
    public getRealPageCount(): number {
        return this.pages.length - this.blankPages.length;
    }

    /**
     * Convert internal page index to real (non-blank) page index.
     * Returns -1 if the internal index refers to a blank page.
     */
    public internalToReal(internalIdx: number): number {
        if (this.isBlankPage(internalIdx)) return -1;
        return internalIdx - this.blankStartCount;
    }

    /**
     * Convert real (non-blank) page index to internal page index.
     */
    public realToInternal(realIdx: number): number {
        return realIdx + this.blankStartCount;
    }

    /**
     * Split the book on the two-page spread in landscape mode and one-page spread in portrait mode
     */
    protected createSpread(): void {
        this.landscapeSpread = [];
        this.portraitSpread = [];

        // Portrait: each non-blank page is its own spread
        for (let i = 0; i < this.pages.length; i++) {
            if (!this.isBlankPage(i)) {
                this.portraitSpread.push([i]);
            }
        }

        // Landscape: always pair pages (blanks included for padding)
        for (let i = 0; i < this.pages.length; i += 2) {
            if (i < this.pages.length - 1) this.landscapeSpread.push([i, i + 1]);
            else {
                this.landscapeSpread.push([i]);
            }
        }
    }

    /**
     * Recalculate spread layout (e.g. after showCover change)
     */
    public recreateSpread(): void {
        this.createSpread();
    }

    /**
     * Get spread by mode (portrait or landscape)
     */
    protected getSpread(): NumberArray[] {
        return this.render.getOrientation() === Orientation.LANDSCAPE
            ? this.landscapeSpread
            : this.portraitSpread;
    }

    /**
     * Get spread index by page number
     *
     * @param {number} pageNum - page index
     */
    public getSpreadIndexByPage(pageNum: number): number | null {
        const spread = this.getSpread();

        for (let i = 0; i < spread.length; i++) {
            const s = spread[i]!;
            if (pageNum === s[0] || pageNum === s[1]) return i;
        }

        return null;
    }

    /**
     * Get the total number of pages
     */
    public getPageCount(): number {
        return this.pages.length;
    }

    /**
     * Get the pages list
     */
    public getPages(): Page[] {
        return this.pages;
    }

    /**
     * Get page by index
     *
     * @param {number} pageIndex
     */
    public getPage(pageIndex: number): Page {
        if (pageIndex >= 0 && pageIndex < this.pages.length) {
            return this.pages[pageIndex]!;
        }

        throw new Error('Invalid page number');
    }

    /**
     * Get the next page from the specified
     *
     * @param {Page} current
     */
    public nextBy(current: Page): Page | null {
        const idx = this.pages.indexOf(current);

        if (idx < this.pages.length - 1) return this.pages[idx + 1]!;

        return null;
    }

    /**
     * Get previous page from specified
     *
     * @param {Page} current
     */
    public prevBy(current: Page): Page | null {
        const idx = this.pages.indexOf(current);

        if (idx > 0) return this.pages[idx - 1]!;

        return null;
    }

    /**
     * Get flipping page depending on the direction
     *
     * @param {FlipDirection} direction
     */
    public getFlippingPage(direction: FlipDirection): Page {
        const current = this.currentSpreadIndex;
        const spreads = this.getSpread();

        if (this.render.getOrientation() === Orientation.PORTRAIT) {
            const curPageIdx = spreads[current]![0]!;
            if (direction === FlipDirection.FORWARD) {
                return this.pages[curPageIdx]!.newTemporaryCopy();
            } else {
                const prevPageIdx = spreads[current - 1]![0]!;
                return this.pages[prevPageIdx]!;
            }
        } else {
            const spread =
                direction === FlipDirection.FORWARD
                    ? spreads[current + 1]!
                    : spreads[current - 1]!;

            if (spread.length === 1) return this.pages[spread[0]!]!;

            return direction === FlipDirection.FORWARD
                ? this.pages[spread[0]!]!
                : this.pages[spread[1]!]!;
        }
    }

    /**
     * Get Next page at the time of flipping
     *
     * @param {FlipDirection}  direction
     */
    public getBottomPage(direction: FlipDirection): Page {
        const current = this.currentSpreadIndex;
        const spreads = this.getSpread();

        if (this.render.getOrientation() === Orientation.PORTRAIT) {
            const targetSpread = direction === FlipDirection.FORWARD
                ? spreads[current + 1]!
                : spreads[current - 1]!;
            return this.pages[targetSpread[0]!]!;
        } else {
            const spread =
                direction === FlipDirection.FORWARD
                    ? spreads[current + 1]!
                    : spreads[current - 1]!;

            if (spread.length === 1) return this.pages[spread[0]!]!;

            return direction === FlipDirection.FORWARD
                ? this.pages[spread[1]!]!
                : this.pages[spread[0]!]!;
        }
    }

    /**
     * Show next spread
     */
    public showNext(): void {
        if (this.currentSpreadIndex < this.getSpread().length) {
            this.currentSpreadIndex++;
            this.showSpread();
        }
    }

    /**
     * Show prev spread
     */
    public showPrev(): void {
        if (this.currentSpreadIndex > 0) {
            this.currentSpreadIndex--;
            this.showSpread();
        }
    }

    /**
     * Get the number of the current spread in book
     */
    public getCurrentPageIndex(): number {
        return this.currentPageIndex;
    }

    /**
     * Show specified page
     * @param {number} pageNum - Page index (from 0s)
     */
    public show(pageNum: number | null = null): void {
        if (pageNum === null) pageNum = this.currentPageIndex;

        if (pageNum < 0 || pageNum >= this.pages.length) return;

        let spreadIndex = this.getSpreadIndexByPage(pageNum);

        // If page not in current spreads (e.g. blank page in portrait mode),
        // find the nearest valid spread by scanning forward then backward.
        if (spreadIndex === null) {
            for (let i = pageNum + 1; i < this.pages.length; i++) {
                spreadIndex = this.getSpreadIndexByPage(i);
                if (spreadIndex !== null) break;
            }
            if (spreadIndex === null) {
                for (let i = pageNum - 1; i >= 0; i--) {
                    spreadIndex = this.getSpreadIndexByPage(i);
                    if (spreadIndex !== null) break;
                }
            }
        }

        if (spreadIndex !== null) {
            this.currentSpreadIndex = spreadIndex;
            this.showSpread();
        }
    }

    /**
     * Index of the current page in list
     */
    public getCurrentSpreadIndex(): number {
        return this.currentSpreadIndex;
    }

    /**
     * Set new spread index as current
     *
     * @param {number} newIndex - new spread index
     */
    public setCurrentSpreadIndex(newIndex: number): void {
        if (newIndex >= 0 && newIndex < this.getSpread().length) {
            this.currentSpreadIndex = newIndex;
        } else {
            throw new Error('Invalid page');
        }
    }

    /**
     * Show current spread
     */
    private showSpread(): void {
        const spread = this.getSpread()[this.currentSpreadIndex]!;

        if (spread.length === 2) {
            this.render.setLeftPage(this.pages[spread[0]!]!);
            this.render.setRightPage(this.pages[spread[1]!]!);
        } else {
            const pageIdx = spread[0]!;
            if (this.render.getOrientation() === Orientation.LANDSCAPE) {
                if (pageIdx === this.pages.length - 1) {
                    this.render.setLeftPage(this.pages[pageIdx]!);
                    this.render.setRightPage(null);
                } else {
                    this.render.setLeftPage(null);
                    this.render.setRightPage(this.pages[pageIdx]!);
                }
            } else {
                this.render.setLeftPage(null);
                this.render.setRightPage(this.pages[pageIdx]!);
            }
        }

        this.currentPageIndex = spread[0]!;
        this.app.updatePageIndex(this.currentPageIndex);
    }
}
