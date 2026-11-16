/**
 * Layer-direction scan coverage — the policy scanner must not leave a file
 * extension or module specifier outside its reach.
 *
 * <p>`walkProdFiles` deliberately covers production `.ts` files only. If a
 * `.d.ts`, `.mts` or `.cts` module ever appears under `Pipeline/`, or a
 * production import targets `.mjs`/`.cjs`, the layer policy would not see that
 * edge. This test fails on the first such file instead of silently skipping it.
 */

import * as fs from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';

import { walkProdFiles } from '../../../Tools/ImportGraphScan.js';
import { importSpecifiers, specifiersOf } from '../../../Tools/LayerEnumReferences.js';

const HERE_URL = fileURLToPath(import.meta.url);
const HERE = path.dirname(HERE_URL);
const PIPELINE_ROOT = path.join(HERE, '..', '..', '..', '..', 'Scrapers', 'Pipeline');

/**
 * List every file under a directory, regardless of extension.
 * @param directory - Directory to walk.
 * @param out - Accumulator, mutated in place.
 * @returns The same accumulator.
 */
function listAllFiles(directory: string, out: string[]): readonly string[] {
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    const full = path.join(directory, entry.name);
    if (entry.isDirectory()) listAllFiles(full, out);
    else out.push(full);
  }
  return out;
}

/**
 * Render a path relative to the Pipeline root with forward slashes.
 * @param file - Absolute file path.
 * @returns Pipeline-relative POSIX path.
 */
function relativeToPipeline(file: string): string {
  return path.relative(PIPELINE_ROOT, file).split(path.sep).join('/');
}

describe('layer-direction scan coverage', () => {
  it('has no declaration-only or alternate-extension production modules', () => {
    const allFiles = listAllFiles(PIPELINE_ROOT, []);
    const unsupported = allFiles
      .filter((file): boolean => /\.(?:d\.ts|mts|cts|js|jsx)$/u.test(file))
      .map(relativeToPipeline);
    expect(unsupported).toStrictEqual([]);
  });

  it('reads imports from the AST, ignoring comments and finding template paths', () => {
    const source = ["// import '../legacy.cjs'", 'const real = import(`../real.cjs`);'].join('\n');
    const specs = specifiersOf(source);
    expect(specs).toStrictEqual(['../real.cjs']);
  });

  it('has no production import targeting .mjs or .cjs', () => {
    const files: string[] = [];
    walkProdFiles(PIPELINE_ROOT, files);
    const extensionImports = files.flatMap((file): string[] =>
      importSpecifiers(file)
        .filter((specifier): boolean => /\.(?:mjs|cjs)$/u.test(specifier))
        .map((specifier): string => `${relativeToPipeline(file)} -> ${specifier}`),
    );
    expect(extensionImports).toStrictEqual([]);
  });
});
