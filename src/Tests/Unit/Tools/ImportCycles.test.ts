/**
 * Unit tests for the acyclic-dependencies gate's pure detection logic.
 *
 * These pin two behaviours so a future refactor cannot silently weaken the
 * gate:
 *   1. {@link extractCycles} finds true cycles (Tarjan SCCs of size ≥ 2,
 *      plus single-node self-loops) and ignores acyclic chains.
 *   2. {@link findRegressions} treats a cycle as a regression unless the
 *      committed baseline already contains a SUPERSET of it — so new and
 *      grown cycles fail while burn-down (subset) shrinks pass.
 *
 * Importing the tool is side-effect-free: its `isMainModule()` guard keeps
 * the filesystem scan and `process.exit` from firing under Jest.
 */

import { extractCycles, findRegressions } from '../../../Tests/Tools/lint-import-cycles.js';

/**
 * Build an in-memory import graph from node→imports pairs.
 * @param entries - Adjacency pairs.
 * @returns A graph accepted by {@link extractCycles}.
 */
function makeGraph(
  entries: readonly (readonly [string, readonly string[]])[],
): Map<string, readonly string[]> {
  return new Map(entries);
}

describe('extractCycles — Tarjan SCC detection', () => {
  it('detects a two-node cycle and ignores acyclic siblings', () => {
    const graph = makeGraph([
      ['a', ['b']],
      ['b', ['a']],
      ['c', ['a']],
    ]);
    const cycles = extractCycles(graph);
    expect(cycles).toEqual([['a', 'b']]);
  });

  it('detects a three-node cycle as one SCC', () => {
    const graph = makeGraph([
      ['a', ['b']],
      ['b', ['c']],
      ['c', ['a']],
    ]);
    const cycles = extractCycles(graph);
    expect(cycles).toEqual([['a', 'b', 'c']]);
  });

  it('reports no cycles for an acyclic chain', () => {
    const graph = makeGraph([
      ['a', ['b']],
      ['b', ['c']],
      ['c', []],
    ]);
    const cycles = extractCycles(graph);
    expect(cycles).toEqual([]);
  });

  it('detects a single-node self-loop as a cycle', () => {
    const graph = makeGraph([['a', ['a']]]);
    const cycles = extractCycles(graph);
    expect(cycles).toEqual([['a']]);
  });
});

describe('findRegressions — baseline ratchet', () => {
  const baseline = [['a', 'b', 'c']];

  it('passes when a current cycle is a subset of a baseline cycle (burn-down)', () => {
    const current = [['a', 'b']];
    const regressions = findRegressions(current, baseline);
    expect(regressions).toEqual([]);
  });

  it('fails on a brand-new cycle outside the baseline', () => {
    const current = [['x', 'y']];
    const regressions = findRegressions(current, baseline);
    expect(regressions).toEqual([['x', 'y']]);
  });

  it('fails when a baseline cycle grows beyond its frozen members', () => {
    const current = [['a', 'b', 'c', 'd']];
    const regressions = findRegressions(current, baseline);
    expect(regressions).toEqual([['a', 'b', 'c', 'd']]);
  });

  it('fails when two separate baseline cycles merge into one bigger SCC', () => {
    const splitBaseline = [
      ['a', 'b'],
      ['c', 'd'],
    ];
    const merged = [['a', 'b', 'c', 'd']];
    const regressions = findRegressions(merged, splitBaseline);
    expect(regressions).toEqual([['a', 'b', 'c', 'd']]);
  });

  it('passes cleanly when the baseline is empty and there are no cycles', () => {
    const regressions = findRegressions([], []);
    expect(regressions).toEqual([]);
  });
});
