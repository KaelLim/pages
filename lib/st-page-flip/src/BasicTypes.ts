/**
 * Type representing a point on a plane
 */
export interface Point {
    x: number;
    y: number;
}

/**
 * Type representing a coordinates of the rectangle on the plane
 */
export interface RectPoints {
    /** Coordinates of the top left corner */
    topLeft: Point;
    /** Coordinates of the top right corner */
    topRight: Point;
    /** Coordinates of the bottom left corner */
    bottomLeft: Point;
    /** Coordinates of the bottom right corner */
    bottomRight: Point;
}

/**
 * Type representing a rectangle
 */
export interface Rect {
    left: number;
    top: number;
    width: number;
    height: number;
}

/**
 * Type representing a book area
 */
export interface PageRect {
    left: number;
    top: number;
    width: number;
    height: number;
    /** Page width. If portrait mode is equal to the width of the book. In landscape mode - half of the total width. */
    pageWidth: number;
}

/**
 * Type representing a line segment contains two points: start and end
 */
export type Segment = [Point, Point];

/**
 * A single vertical strip of a curled page mesh
 */
export interface CurlStrip {
    /** Normalized position along page width (0 = spine, 1 = edge) */
    t: number;
    /** X offset of this strip in page-local coordinates */
    x: number;
    /** Width of this strip in pixels */
    width: number;
    /** Rotation angle of this strip (radians) — simulates page bend */
    angle: number;
    /** Y offset caused by the curl lifting the strip */
    yOffset: number;
    /** Lighting multiplier (0 = dark, 1 = normal, >1 = highlight) */
    light: number;
}

/**
 * Complete curl geometry for one animation frame
 */
export interface CurlData {
    /** Ordered mesh strips from spine to fold edge */
    strips: CurlStrip[];
    /** Bezier control points for the curved fold edge [start, cp1, cp2, end] */
    foldCurve: [Point, Point, Point, Point];
    /** Overall curl intensity (0 = flat, 1 = max curl) */
    intensity: number;
}
