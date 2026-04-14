import { describe, it, expect } from 'vitest';
import { flattenToc, computeSiblingIndex, type TocItem } from '../src/toc.js';

function mkTree(): TocItem[] {
  return [
    {
      title: 'Chapter 1', page: 1, depth: 0, children: [
        { title: '1.1', page: 2, depth: 1, children: [] },
        { title: '1.2', page: 5, depth: 1, children: [
          { title: '1.2.1', page: 6, depth: 2, children: [] },
        ] },
      ],
    },
    { title: 'Chapter 2', page: 10, depth: 0, children: [] },
  ];
}

describe('flattenToc()', () => {
  it('flattens depth-first with preserved order', () => {
    const flat = flattenToc(mkTree());
    expect(flat.map(i => i.title)).toEqual([
      'Chapter 1', '1.1', '1.2', '1.2.1', 'Chapter 2',
    ]);
  });

  it('preserves depth metadata', () => {
    const flat = flattenToc(mkTree());
    expect(flat.map(i => i.depth)).toEqual([0, 1, 1, 2, 0]);
  });

  it('returns [] for empty input', () => {
    expect(flattenToc([])).toEqual([]);
  });
});

describe('computeSiblingIndex()', () => {
  it('sets correct pos and size for top level', () => {
    const tree = mkTree();
    const map = computeSiblingIndex(tree);
    expect(map.get(tree[0])).toEqual({ pos: 1, size: 2 });
    expect(map.get(tree[1])).toEqual({ pos: 2, size: 2 });
  });

  it('sets correct pos and size for nested children', () => {
    const tree = mkTree();
    const map = computeSiblingIndex(tree);
    const ch1 = tree[0].children;
    expect(map.get(ch1[0])).toEqual({ pos: 1, size: 2 });
    expect(map.get(ch1[1])).toEqual({ pos: 2, size: 2 });
    expect(map.get(ch1[1].children[0])).toEqual({ pos: 1, size: 1 });
  });
});
