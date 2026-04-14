import { describe, it, expect } from 'vitest';
import { CurlCalculation } from '../lib/st-page-flip/src/Flip/CurlCalculation.js';

const PAGE_W = 400;
const PAGE_H = 600;

describe('CurlCalculation.calc()', () => {
  it('returns zero intensity at progress=0', () => {
    const r = CurlCalculation.calc(
      { x: 0, y: 0 }, { x: 0, y: PAGE_H },
      0, PAGE_W, PAGE_H, 1.0, 20, false
    );
    expect(r.intensity).toBeCloseTo(0, 5);
  });

  it('peaks intensity around progress=50', () => {
    const mid = CurlCalculation.calc(
      { x: 0, y: 0 }, { x: 0, y: PAGE_H },
      50, PAGE_W, PAGE_H, 1.0, 20, false
    );
    const early = CurlCalculation.calc(
      { x: 0, y: 0 }, { x: 0, y: PAGE_H },
      10, PAGE_W, PAGE_H, 1.0, 20, false
    );
    expect(mid.intensity).toBeGreaterThan(early.intensity);
  });

  it('produces stripCount strips', () => {
    const r = CurlCalculation.calc(
      { x: 0, y: 0 }, { x: 0, y: PAGE_H },
      50, PAGE_W, PAGE_H, 1.0, 30, false
    );
    expect(r.strips.length).toBe(30);
  });

  it('strip t values progress 0 → ~1', () => {
    const r = CurlCalculation.calc(
      { x: 0, y: 0 }, { x: 0, y: PAGE_H },
      50, PAGE_W, PAGE_H, 1.0, 10, false
    );
    expect(r.strips[0].t).toBe(0);
    expect(r.strips[r.strips.length - 1].t).toBeLessThan(1);
  });

  it('isForward flips curl direction (last strip curls instead of first)', () => {
    const fwd = CurlCalculation.calc(
      { x: 0, y: 0 }, { x: 0, y: PAGE_H },
      50, PAGE_W, PAGE_H, 1.0, 10, true
    );
    const bwd = CurlCalculation.calc(
      { x: 0, y: 0 }, { x: 0, y: PAGE_H },
      50, PAGE_W, PAGE_H, 1.0, 10, false
    );
    // Forward (fold on left): strip 0 is fold edge, max curl; last strip is spine, min curl
    // Backward: opposite
    expect(fwd.strips[0].angle).toBeGreaterThan(fwd.strips[fwd.strips.length - 1].angle);
    expect(bwd.strips[0].angle).toBeLessThan(bwd.strips[bwd.strips.length - 1].angle);
  });

  it('returns a 4-point bezier fold curve', () => {
    const r = CurlCalculation.calc(
      { x: 100, y: 0 }, { x: 100, y: PAGE_H },
      50, PAGE_W, PAGE_H, 1.0, 10, false
    );
    expect(r.foldCurve.length).toBe(4);
    expect(r.foldCurve[0]).toEqual({ x: 100, y: 0 });
    expect(r.foldCurve[3]).toEqual({ x: 100, y: PAGE_H });
  });

  it('lighting values are finite and positive', () => {
    const r = CurlCalculation.calc(
      { x: 0, y: 0 }, { x: 0, y: PAGE_H },
      50, PAGE_W, PAGE_H, 1.0, 10, false
    );
    for (const s of r.strips) {
      expect(Number.isFinite(s.light)).toBe(true);
      expect(s.light).toBeGreaterThan(0);
    }
  });
});
