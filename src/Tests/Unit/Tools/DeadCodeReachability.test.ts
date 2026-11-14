/**
 * Symbol-level dead-code reachability. The gate must follow re-exports from
 * the real entry points and treat a barrel as a path, not as proof that every
 * symbol behind it is used.
 */

import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import * as path from 'node:path';

import type {
  IDeadCodeBaseline,
  IModuleSource,
} from '../../../Tests/Tools/DeadCodeReachability.js';
import {
  analyze,
  findRegressions,
  parseModuleSource,
} from '../../../Tests/Tools/DeadCodeReachability.js';

/**
 * Build one synthetic module source.
 * @param file - Repo-relative path.
 * @param overrides - Fields to replace.
 * @returns Complete module source.
 */
function moduleOf(file: string, overrides: Partial<IModuleSource> = {}): IModuleSource {
  return { file, local: [], named: [], stars: [], namespaces: [], imports: [], ...overrides };
}

/**
 * Build a graph from modules.
 * @param modules - Synthetic modules.
 * @returns Parsed-module map.
 */
function graphOf(modules: readonly IModuleSource[]): Map<string, IModuleSource> {
  return new Map(modules.map(module => [module.file, module]));
}

/** A baseline with no frozen items. */
const EMPTY_BASELINE: IDeadCodeBaseline = {
  note: 'synthetic',
  unreachableFiles: [],
  unusedExports: [],
};

describe('symbol-level dead-code reachability', () => {
  it('flags a file reachable only through an unreachable barrel re-export', () => {
    const graph = graphOf([
      moduleOf('entry.ts'),
      moduleOf('barrel.ts', { stars: ['hidden.ts'] }),
      moduleOf('hidden.ts', { local: ['value'] }),
    ]);
    const report = analyze(graph, ['entry.ts']);
    expect(report.files).toEqual(['barrel.ts', 'hidden.ts']);
  });

  it('resolves a named import through a reachable export-star barrel', () => {
    const graph = graphOf([
      moduleOf('entry.ts', { imports: [{ target: 'barrel.ts', names: ['value'] }] }),
      moduleOf('barrel.ts', { stars: ['impl.ts'] }),
      moduleOf('impl.ts', { local: ['value'] }),
    ]);
    const report = analyze(graph, ['entry.ts']);
    expect(report).toEqual({ files: [], exports: [] });
  });

  it('reports an unused local export in a reachable module', () => {
    const graph = graphOf([
      moduleOf('entry.ts', { imports: [{ target: 'impl.ts', names: ['used'] }] }),
      moduleOf('impl.ts', { local: ['used', 'unused'] }),
    ]);
    const report = analyze(graph, ['entry.ts']);
    expect(report).toEqual({ files: [], exports: ['impl.ts#unused'] });
  });

  it('fails only for items added outside the frozen baseline', () => {
    const current = { files: ['a.ts', 'b.ts'], exports: ['a.ts#x', 'b.ts#y'] };
    const baseline: IDeadCodeBaseline = {
      ...EMPTY_BASELINE,
      unreachableFiles: ['a.ts'],
      unusedExports: ['a.ts#x'],
    };
    const regressions = findRegressions(current, baseline);
    expect(regressions).toEqual({ files: ['b.ts'], exports: ['b.ts#y'] });
    const shrunk = findRegressions({ files: ['a.ts'], exports: ['a.ts#x'] }, baseline);
    expect(shrunk).toEqual({ files: [], exports: [] });
  });

  it('finds dynamic imports in initializers and function bodies', () => {
    const base = tmpdir();
    const prefix = path.join(base, 'dead-code-');
    const root = mkdtempSync(prefix);
    try {
      const aPath = path.join(root, 'a.ts');
      const bPath = path.join(root, 'b.ts');
      const entryPath = path.join(root, 'entry.ts');
      writeFileSync(aPath, 'export const a = 1;');
      writeFileSync(bPath, 'export const b = 1;');
      const text = "const lazy = import('./a.js');\nfunction load() { return import('./b.js'); }";
      const source = parseModuleSource(root, entryPath, text);
      const targets = source.imports.map(edge => edge.target);
      expect(targets).toEqual(['a.ts', 'b.ts']);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('does not re-export or resolve a default through export star', () => {
    const graph = graphOf([
      moduleOf('entry.ts', { stars: ['impl.ts'] }),
      moduleOf('impl.ts', { local: ['default', 'named'] }),
    ]);
    const report = analyze(graph, ['entry.ts']);
    expect(report.exports).toEqual(['impl.ts#default']);
  });

  it('reports unused exports from a frozen unreachable file', () => {
    const graph = graphOf([moduleOf('entry.ts'), moduleOf('dead.ts', { local: ['old', 'new'] })]);
    const report = analyze(graph, ['entry.ts']);
    expect(report).toEqual({ files: ['dead.ts'], exports: ['dead.ts#new', 'dead.ts#old'] });
  });

  it('parses local, default and local-clause exports', () => {
    const root = process.cwd();
    const file = path.join(root, 'src', 'fixture.ts');
    const source = parseModuleSource(
      root,
      file,
      'export const a = 1; export default function f() { return a; } export { a as b };',
    );
    expect(source.local).toEqual(['a', 'default', 'b']);
  });
});
