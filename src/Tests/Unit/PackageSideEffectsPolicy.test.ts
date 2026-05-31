/**
 * Drift pin for package.json `sideEffects` allowlist.
 *
 * Two surfaces must move together or the published npm bundle silently
 * loses critical side-effect work:
 *
 *   1. **Source side-effect imports** — bank pipelines bootstrap their
 *      GraphQL queries via bare `import './graphql/<Bank>Queries.js'`
 *      side-effect imports that fire `registerWkQuery(...)` at module
 *      load time. The well-known query registry (`WK`) is populated this
 *      way and is read by the API-DIRECT-CALL phase.
 *
 *   2. **package.json `sideEffects`** — declares which files actually
 *      have side effects so the bundler (tsup/esbuild with treeshake)
 *      and downstream consumers (Webpack/Vite) do NOT tree-shake them
 *      away.
 *
 * A blanket `"sideEffects": false` (as briefly shipped in PR #280)
 * silently drops every bare side-effect import → published bundle has
 * ZERO `registerWkQuery` calls → OneZero & Pepper scrapes fail at
 * runtime with empty WK registry.
 *
 * This pin asserts:
 *   - `sideEffects` is an array allowlist (not `false`, not `true`)
 *   - The allowlist matches every `*Queries.ts` file in the source tree
 *   - The published bundle paths (`lib/index.cjs` and `lib/index.mjs`)
 *     are included so downstream bundlers do not tree-shake the inlined
 *     `registerWkQuery` calls after our build.
 */
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { globSync } from 'glob';

const SELF_URL = import.meta.url;
const SELF_PATH = fileURLToPath(SELF_URL);
const SELF_DIR = path.dirname(SELF_PATH);
const REPO_ROOT = path.join(SELF_DIR, '..', '..', '..');
const PACKAGE_JSON_PATH = path.join(REPO_ROOT, 'package.json');

const SOURCE_QUERIES_GLOB = 'src/**/graphql/*Queries.ts';
const PUBLISHED_BUNDLE_PATHS = ['lib/index.cjs', 'lib/index.mjs'];

/**
 * Read and parse the root package.json.
 * @returns Parsed package.json content as a plain object.
 */
function loadPackageJson(): Record<string, unknown> {
  const raw = readFileSync(PACKAGE_JSON_PATH, 'utf8');
  return JSON.parse(raw) as Record<string, unknown>;
}

describe('package.json sideEffects allowlist drift pin', () => {
  it('sideEffects is an array allowlist (not a blanket boolean)', () => {
    const pkg = loadPackageJson();
    const sideEffects = pkg.sideEffects;
    const isAllowlist = Array.isArray(sideEffects);
    expect(isAllowlist).toBe(true);
  });

  it('declares the source query side-effect file glob', () => {
    const pkg = loadPackageJson();
    const sideEffects = pkg.sideEffects as string[];
    expect(sideEffects).toContain(SOURCE_QUERIES_GLOB);
  });

  it('declares both published bundle entry points', () => {
    const pkg = loadPackageJson();
    const sideEffects = pkg.sideEffects as string[];
    for (const bundlePath of PUBLISHED_BUNDLE_PATHS) {
      expect(sideEffects).toContain(bundlePath);
    }
  });

  it('allowlist glob matches every *Queries.ts side-effect source file', () => {
    const globOptions = { cwd: REPO_ROOT };
    const found = globSync(SOURCE_QUERIES_GLOB, globOptions);
    expect(found.length).toBeGreaterThanOrEqual(2);
    for (const file of found) {
      const absolutePath = path.join(REPO_ROOT, file);
      const body = readFileSync(absolutePath, 'utf8');
      expect(body).toMatch(/^registerWkQuery\(/m);
    }
  });
});
