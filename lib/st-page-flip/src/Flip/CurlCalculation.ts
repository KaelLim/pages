import { Point, CurlStrip, CurlData } from '../BasicTypes';

/**
 * Calculates page curl geometry: bezier fold curve and mesh strip positions.
 *
 * The curl model works by:
 * 1. Taking the straight fold line (from FlipCalculation's intersection points)
 * 2. Bowing it into a bezier curve to simulate paper bending
 * 3. Dividing the page into vertical strips
 * 4. Computing each strip's rotation angle and position along the curl
 */
export class CurlCalculation {
    /**
     * Compute full curl geometry for one animation frame.
     *
     * @param foldTop - Top point where fold line meets page boundary
     * @param foldBottom - Bottom point where fold line meets page boundary
     * @param progress - Flip progress 0-100
     * @param pageWidth - Current page width in pixels
     * @param pageHeight - Current page height in pixels
     * @param intensity - Curl bend intensity (0-1, from settings)
     * @param stripCount - Number of mesh strips (from settings)
     * @param isForward - true if flipping forward (right→left)
     */
    public static calc(
        foldTop: Point,
        foldBottom: Point,
        progress: number,
        pageWidth: number,
        pageHeight: number,
        intensity: number,
        stripCount: number,
        isForward: boolean = false
    ): CurlData {
        const foldCurve = CurlCalculation.calcFoldCurve(
            foldTop, foldBottom, progress, pageWidth, intensity
        );

        const strips = CurlCalculation.calcStrips(
            progress, pageWidth, pageHeight, intensity, stripCount, isForward
        );

        return {
            strips,
            foldCurve,
            intensity: intensity * CurlCalculation.progressToIntensity(progress),
        };
    }

    /**
     * Convert flip progress to curl intensity curve.
     * Curl is strongest in the middle of the flip, weakest at start/end.
     */
    private static progressToIntensity(progress: number): number {
        const t = progress / 100;
        return Math.sin(t * Math.PI);
    }

    /**
     * Calculate bezier control points for the curved fold edge.
     * The fold line bows outward to simulate paper rigidity.
     */
    private static calcFoldCurve(
        foldTop: Point,
        foldBottom: Point,
        progress: number,
        pageWidth: number,
        intensity: number
    ): [Point, Point, Point, Point] {
        const bowAmount = pageWidth * 0.15 * intensity * CurlCalculation.progressToIntensity(progress);

        const midY1 = foldTop.y + (foldBottom.y - foldTop.y) * 0.33;
        const midY2 = foldTop.y + (foldBottom.y - foldTop.y) * 0.66;

        const cp1: Point = {
            x: foldTop.x + bowAmount,
            y: midY1,
        };
        const cp2: Point = {
            x: foldBottom.x + bowAmount,
            y: midY2,
        };

        return [foldTop, cp1, cp2, foldBottom];
    }

    /**
     * Calculate mesh strip positions and rotations.
     * Strips near the fold edge rotate more (page curls away from surface).
     *
     * @param isForward - When true (right→left flip), curl increases from
     *   strip 0 (fold edge, left) to strip N (spine, right). When false
     *   (left→right flip), curl increases from strip N to strip 0.
     */
    private static calcStrips(
        progress: number,
        pageWidth: number,
        pageHeight: number,
        intensity: number,
        stripCount: number,
        isForward: boolean
    ): CurlStrip[] {
        const strips: CurlStrip[] = [];
        const stripWidth = pageWidth / stripCount;
        const curlFactor = intensity * CurlCalculation.progressToIntensity(progress);
        const maxAngle = (Math.PI / 6) * curlFactor;

        // Accumulate cursor position along the curled curve so each strip's
        // left edge meets the previous strip's (rotated) right edge — no seams.
        // For FORWARD (fold on left), we walk RIGHT→LEFT and store negative
        // offsets, then normalize below so strip positions remain in [0, pageWidth].
        let cursorX = 0;
        let cursorY = 0;

        for (let i = 0; i < stripCount; i++) {
            const t = i / stripCount;

            // curlT: 0 at spine side, 1 at fold edge
            const curlT = isForward
                ? Math.pow(1 - t, 2)
                : Math.pow(t, 2);

            const angle = curlT * maxAngle;

            // Lighting: facing up = highlight, facing away = shadow (on crease)
            const light = 1.0
                + (curlT * 0.15 * curlFactor)
                - (Math.pow(curlT, 3) * 0.45 * curlFactor);

            strips.push({
                t,
                x: cursorX,
                width: stripWidth + 0.5, // +0.5 overlap prevents sub-pixel gaps
                angle,
                yOffset: cursorY,
                light,
            });

            // Advance cursor by the rotated step so the next strip's left edge
            // meets this strip's right edge. Use pure stripWidth (no overlap
            // here — overlap is for drawing, not positioning).
            cursorX += stripWidth * Math.cos(angle);
            cursorY -= stripWidth * Math.sin(angle);
        }

        return strips;
    }
}
