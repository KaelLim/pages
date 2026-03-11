import { PageFlip } from '../PageFlip';
import { Point } from '../BasicTypes';
import { FlipSetting, SizeType } from '../Settings';
import { FlipCorner, FlippingState } from '../Flip/Flip';
import { Orientation } from '../Render/Render';

type SwipeData = {
    point: Point;
    time: number;
};

/**
 * UI Class, represents work with DOM
 */
export abstract class UI {
    protected readonly parentElement: HTMLElement;

    protected readonly app: PageFlip;
    protected readonly wrapper: HTMLElement;
    protected distElement: HTMLElement;

    private touchPoint: SwipeData = null;
    private readonly swipeTimeout = 250;
    private readonly swipeDistance: number;

    private onResize = (): void => {
        this.update();
    };

    /**
     * @constructor
     *
     * @param {HTMLElement} inBlock - Root HTML Element
     * @param {PageFlip} app - PageFlip instanse
     * @param {FlipSetting} setting - Configuration object
     */
    protected constructor(inBlock: HTMLElement, app: PageFlip, setting: FlipSetting) {
        this.parentElement = inBlock;

        inBlock.classList.add('stf__parent');
        // Add first wrapper
        inBlock.insertAdjacentHTML('afterbegin', '<div class="stf__wrapper"></div>');

        this.wrapper = inBlock.querySelector('.stf__wrapper');

        this.app = app;

        this.applySizing();

        window.addEventListener('resize', this.onResize, false);
        this.swipeDistance = setting.swipeDistance;
    }

    /**
     * Destructor. Remove all HTML elements and all event handlers
     */
    public destroy(): void {
        window.removeEventListener('resize', this.onResize);

        if (this.app.getSettings().useMouseEvents) this.removeHandlers();

        this.distElement.remove();
        this.wrapper.remove();
    }

    /**
     * Apply sizing styles to parent element based on current settings
     */
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
            this.parentElement.style.maxHeight = '100%';
        } else {
            this.parentElement.style.width = '';
            this.parentElement.style.maxWidth = '';
            this.parentElement.style.maxHeight = '';
        }

        this.parentElement.style.display = 'block';
    }

    /**
     * Updating child components when resizing
     */
    public abstract update(): void;

    /**
     * Get parent element for book
     *
     * @returns {HTMLElement}
     */
    public getDistElement(): HTMLElement {
        return this.distElement;
    }

    /**
     * Get wrapper element
     *
     * @returns {HTMLElement}
     */
    public getWrapper(): HTMLElement {
        return this.wrapper;
    }

    /**
     * Updates styles and sizes based on book orientation
     *
     * @param {Orientation} orientation - New book orientation
     */
    public setOrientationStyle(orientation: Orientation): void {
        this.wrapper.classList.remove('--portrait', '--landscape');

        if (orientation === Orientation.PORTRAIT) {
            if (this.app.getSettings().autoSize) {
                this.wrapper.style.paddingBottom =
                    (this.app.getSettings().height / this.app.getSettings().width) * 100 + '%';
                this.wrapper.style.maxHeight = '100%';
            }

            this.wrapper.classList.add('--portrait');
        } else {
            if (this.app.getSettings().autoSize) {
                this.wrapper.style.paddingBottom =
                    (this.app.getSettings().height / (this.app.getSettings().width * 2)) * 100 +
                    '%';
                this.wrapper.style.maxHeight = '100%';
            }

            this.wrapper.classList.add('--landscape');
        }

        this.update();
    }

    protected removeHandlers(): void {
        window.removeEventListener('resize', this.onResize);

        this.distElement.removeEventListener('mousedown', this.onMouseDown);
        this.distElement.removeEventListener('touchstart', this.onTouchStart);
        window.removeEventListener('mousemove', this.onMouseMove);
        window.removeEventListener('touchmove', this.onTouchMove);
        window.removeEventListener('mouseup', this.onMouseUp);
        window.removeEventListener('touchend', this.onTouchEnd);
    }

    protected setHandlers(): void {
        window.addEventListener('resize', this.onResize, false);
        if (!this.app.getSettings().useMouseEvents) return;

        this.distElement.addEventListener('mousedown', this.onMouseDown);
        this.distElement.addEventListener('touchstart', this.onTouchStart);
        window.addEventListener('mousemove', this.onMouseMove);
        window.addEventListener('touchmove', this.onTouchMove, {
            passive: !this.app.getSettings().mobileScrollSupport,
        });
        window.addEventListener('mouseup', this.onMouseUp);
        window.addEventListener('touchend', this.onTouchEnd);
    }

    public setUseMouseEvents(enabled: boolean): void {
        this.removeHandlers();
        if (enabled) {
            this.setHandlers();
        }
    }

    /**
     * Convert global coordinates to relative book coordinates
     *
     * @param x
     * @param y
     */
    private getMousePos(x: number, y: number): Point {
        const rect = this.distElement.getBoundingClientRect();

        return {
            x: x - rect.left,
            y: y - rect.top,
        };
    }

    private checkTarget(targer: EventTarget): boolean {
        if (!this.app.getSettings().clickEventForward) return true;

        if (['a', 'button'].includes((targer as HTMLElement).tagName.toLowerCase())) {
            return false;
        }

        return true;
    }

    private onMouseDown = (e: MouseEvent): void => {
        if (this.checkTarget(e.target)) {
            const pos = this.getMousePos(e.clientX, e.clientY);

            this.app.startUserTouch(pos);

            e.preventDefault();
        }
    };

    private onTouchStart = (e: TouchEvent): void => {
        if (this.checkTarget(e.target)) {
            if (e.changedTouches.length > 0) {
                const t = e.changedTouches[0];
                const pos = this.getMousePos(t.clientX, t.clientY);

                this.touchPoint = {
                    point: pos,
                    time: Date.now(),
                };

                // part of swipe detection
                setTimeout(() => {
                    if (this.touchPoint !== null) {
                        this.app.startUserTouch(pos);
                    }
                }, this.swipeTimeout);

                if (!this.app.getSettings().mobileScrollSupport) e.preventDefault();
            }
        }
    };

    private onMouseUp = (e: MouseEvent): void => {
        const pos = this.getMousePos(e.clientX, e.clientY);

        this.app.userStop(pos);
    };

    private onMouseMove = (e: MouseEvent): void => {
        const pos = this.getMousePos(e.clientX, e.clientY);

        this.app.userMove(pos, false);
    };

    private onTouchMove = (e: TouchEvent): void => {
        if (e.changedTouches.length > 0) {
            const t = e.changedTouches[0];
            const pos = this.getMousePos(t.clientX, t.clientY);

            if (this.app.getSettings().mobileScrollSupport) {
                if (this.touchPoint !== null) {
                    if (
                        Math.abs(this.touchPoint.point.x - pos.x) > 10 ||
                        this.app.getState() !== FlippingState.READ
                    ) {
                        if (e.cancelable) this.app.userMove(pos, true);
                    }
                }

                if (this.app.getState() !== FlippingState.READ) {
                    e.preventDefault();
                }
            } else {
                this.app.userMove(pos, true);
            }
        }
    };

    private onTouchEnd = (e: TouchEvent): void => {
        if (e.changedTouches.length > 0) {
            const t = e.changedTouches[0];
            const pos = this.getMousePos(t.clientX, t.clientY);
            let isSwipe = false;

            // swipe detection
            if (this.touchPoint !== null) {
                const dx = pos.x - this.touchPoint.point.x;
                const distY = Math.abs(pos.y - this.touchPoint.point.y);

                if (
                    Math.abs(dx) > this.swipeDistance &&
                    distY < this.swipeDistance * 2 &&
                    Date.now() - this.touchPoint.time < this.swipeTimeout
                ) {
                    const rtl = this.app.getSettings().rtl;
                    const corner = this.touchPoint.point.y < this.app.getRender().getRect().height / 2
                        ? FlipCorner.TOP
                        : FlipCorner.BOTTOM;

                    if (dx > 0) {
                        rtl ? this.app.flipNext(corner) : this.app.flipPrev(corner);
                    } else {
                        rtl ? this.app.flipPrev(corner) : this.app.flipNext(corner);
                    }
                    isSwipe = true;
                }

                this.touchPoint = null;
            }

            this.app.userStop(pos, isSwipe);
        }
    };
}
