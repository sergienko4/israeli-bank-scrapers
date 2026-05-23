/**
 * Unit tests for the dead-code canary's import-specifier parser.
 *
 * FINDING-2 (8b RabbitAI review) flagged that the original regex
 * captured only static `from '...'` / `import '...'` forms — dynamic
 * `import('...')` calls slipped past unnoticed, so a Pipeline file
 * reachable only via a dynamic import would be falsely reported as
 * dead. The regex has been widened to accept the optional `(` of the
 * dynamic form; these tests pin that behavior so a future tightening
 * cannot regress silently.
 */

import { parseImportSpecifiers } from '../../../Tests/Tools/detect-dead-code.js';

/**
 * Mixed source — every variant the canary must recognise:
 *   - default import
 *   - named import
 *   - bare side-effect import
 *   - dynamic import expression
 *   - double-quoted specifier
 */
const MIXED_IMPORT_SOURCE = [
  "import defaultExport from './module-a.js';",
  "import { named } from './module-b.js';",
  "import './side-effect.js';",
  'const lazy = await import("./module-c.js");',
  "const dyn = import('./module-d.js');",
].join('\n');

describe('parseImportSpecifiers — FINDING-2 dynamic-import coverage', () => {
  it('captures both static and dynamic import specifiers', () => {
    const specs = parseImportSpecifiers(MIXED_IMPORT_SOURCE);
    expect(specs).toEqual([
      './module-a.js',
      './module-b.js',
      './side-effect.js',
      './module-c.js',
      './module-d.js',
    ]);
  });

  it('captures a dynamic import in isolation', () => {
    const src = "const x = await import('./only-dynamic.js');";
    const specs = parseImportSpecifiers(src);
    expect(specs).toEqual(['./only-dynamic.js']);
  });

  it('captures a static import in isolation', () => {
    const src = "import { x } from './only-static.js';";
    const specs = parseImportSpecifiers(src);
    expect(specs).toEqual(['./only-static.js']);
  });

  it('returns an empty list when no imports are present', () => {
    const specs = parseImportSpecifiers('export const x = 1;\nfunction y() { return x; }');
    expect(specs).toEqual([]);
  });
});
