import { describe, it, expect } from 'vitest';
import { search, type PageIndex } from '../src/search.js';

function mkIndex(pages: Record<number, string>): PageIndex[] {
  return Object.entries(pages).map(([p, text]) => ({
    page: Number(p),
    text,
    lower: text.toLowerCase(),
  }));
}

describe('search()', () => {
  it('returns empty array for empty query', () => {
    const idx = mkIndex({ 1: 'hello world' });
    expect(search(idx, '')).toEqual([]);
    expect(search(idx, '   ')).toEqual([]);
  });

  it('finds case-insensitive matches', () => {
    const idx = mkIndex({ 1: 'Hello World', 2: 'no match here' });
    const r = search(idx, 'hello');
    expect(r.length).toBe(1);
    expect(r[0].page).toBe(1);
  });

  it('returns multiple matches across pages', () => {
    const idx = mkIndex({ 1: 'foo bar', 2: 'foo baz', 3: 'bar baz' });
    const r = search(idx, 'foo');
    expect(r.map(m => m.page)).toEqual([1, 2]);
  });

  it('caps matches per page at maxPerPage', () => {
    const idx = mkIndex({ 1: 'foo foo foo foo foo foo foo' });
    const r = search(idx, 'foo', 3);
    expect(r.length).toBe(3);
    expect(r.every(m => m.page === 1)).toBe(true);
  });

  it('produces snippets with ellipsis for long text', () => {
    const long = 'a'.repeat(200) + ' TARGET ' + 'b'.repeat(200);
    const idx = mkIndex({ 1: long });
    const r = search(idx, 'target');
    expect(r.length).toBe(1);
    expect(r[0].snippet.startsWith('…')).toBe(true);
    expect(r[0].snippet.endsWith('…')).toBe(true);
    expect(r[0].snippet.toLowerCase()).toContain('target');
  });

  it('does not add leading ellipsis when snippet starts at text start', () => {
    const idx = mkIndex({ 1: 'TARGET at the very start of the page' });
    const r = search(idx, 'target');
    expect(r[0].snippet.startsWith('…')).toBe(false);
  });

  it('handles CJK queries', () => {
    const idx = mkIndex({ 1: '慈濟週報第131期', 2: '其他內容' });
    const r = search(idx, '慈濟');
    expect(r.length).toBe(1);
    expect(r[0].page).toBe(1);
  });
});
