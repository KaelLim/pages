/**
 * Book size calculation type
 */
export const enum SizeType {
    /** Dimensions are fixed */
    FIXED = 'fixed',
    /** Dimensions are calculated based on the parent element */
    STRETCH = 'stretch',
}

/**
 * Configuration object
 */
export interface FlipSetting {
    /** Page number from which to start viewing */
    startPage: number;
    /** Whether the book will be stretched under the parent element or not */
    size: SizeType;

    width: number;
    height: number;

    minWidth: number;
    maxWidth: number;
    minHeight: number;
    maxHeight: number;

    /** Draw shadows or not when page flipping */
    drawShadow: boolean;
    /** Flipping animation time */
    flippingTime: number;

    /** Enable switching to portrait mode */
    usePortrait: boolean;
    /** Initial value to z-index */
    startZIndex: number;
    /** If this value is true, the parent element will be equal to the size of the book */
    autoSize: boolean;
    /** Shadow intensity (1: max intensity, 0: hidden shadows) */
    maxShadowOpacity: number;

    /** If this value is true, the first and the last pages will be marked as hard and will be shown in single page mode */
    showCover: boolean;
    /** Disable content scrolling when touching a book on mobile devices */
    mobileScrollSupport: boolean;

    /** Set the forward event of clicking on child elements (buttons, links) */
    clickEventForward: boolean;

    /** Using mouse and touch events to page flipping */
    useMouseEvents: boolean;

    swipeDistance: number;

    /** if this value is true, fold the corners of the book when the mouse pointer is over them. */
    showPageCorners: boolean;

    /** if this value is true, flipping by clicking on the whole book will be locked. Only on corners */
    disableFlipByClick: boolean;

    /** Right-to-left page order */
    rtl: boolean;

    /** Show 3D edge effect on the book spine */
    showEdge: boolean;
    /** Maximum width of the edge in pixels */
    edgeWidth: number;

    /** Number of pages to preload ahead/behind the current view. 0 = preload all at once */
    preloadRange: number;

    /** Number of leading blank pages to exclude from edge progress calculation */
    edgePageOffset: number;

    /** Force single-page (portrait) display regardless of window width */
    forceSinglePage: boolean;

    /** Curl bend intensity (0 = flat flip, 1 = deep curl). Default 0.5 */
    curlIntensity: number;

    /** Number of vertical strips for mesh deformation. Default 20 */
    meshStripCount: number;

    /** Canvas background color. Used by clear() and blank page fill. */
    canvasBgColor: string;
}

export class Settings {
    private _default: FlipSetting = {
        startPage: 0,
        size: SizeType.FIXED,
        width: 0,
        height: 0,
        minWidth: 0,
        maxWidth: 0,
        minHeight: 0,
        maxHeight: 0,
        drawShadow: true,
        flippingTime: 1000,
        usePortrait: true,
        startZIndex: 0,
        autoSize: true,
        maxShadowOpacity: 1,
        showCover: false,
        mobileScrollSupport: true,
        swipeDistance: 30,
        clickEventForward: true,
        useMouseEvents: true,
        showPageCorners: true,
        disableFlipByClick: false,
        rtl: false,
        showEdge: false,
        edgeWidth: 10,
        preloadRange: 3,
        edgePageOffset: 0,
        forceSinglePage: false,
        curlIntensity: 0.5,
        meshStripCount: 20,
        canvasBgColor: '#fff',
    };

    /**
     * Processing parameters received from the user. Substitution default values
     *
     * @param userSetting
     * @returns {FlipSetting} Сonfiguration object
     */
    public getSettings(userSetting: Record<string, number | string | boolean>): FlipSetting {
        const result = this._default;
        // Whitelist merge: only copy known setting keys to prevent prototype pollution
        const allowedKeys = new Set(Object.keys(this._default));
        for (const key of Object.keys(userSetting)) {
            if (allowedKeys.has(key)) {
                (result as any)[key] = userSetting[key];
            }
        }

        if (result.size !== SizeType.STRETCH && result.size !== SizeType.FIXED)
            throw new Error('Invalid size type. Available only "fixed" and "stretch" value');

        if (result.width <= 0 || result.height <= 0) throw new Error('Invalid width or height');

        if (result.flippingTime <= 0) throw new Error('Invalid flipping time');

        if (result.size === SizeType.STRETCH) {
            if (result.minWidth <= 0) result.minWidth = 100;

            if (result.maxWidth < result.minWidth) result.maxWidth = 2000;

            if (result.minHeight <= 0) result.minHeight = 100;

            if (result.maxHeight < result.minHeight) result.maxHeight = 2000;
        } else {
            result.minWidth = result.width;
            result.maxWidth = result.width;
            result.minHeight = result.height;
            result.maxHeight = result.height;
        }

        return result;
    }
}
