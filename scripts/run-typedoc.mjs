#!/usr/bin/env node
/**
 * Runs the TypeDoc CLI under `minimatch@11+`.
 *
 * `typedoc@0.28.20` (`dist/node-utils.js:328`) calls `mini.matchOne(childPath, row, true)`
 * during `expandGlobs()`, which `minimatch@11` made a private `#matchOne` method in favor
 * of `mini.match(path, partial)`. Defining `Minimatch.prototype.matchOne` before loading
 * TypeDoc keeps `npm run docs` working while preserving `minimatch@11.0.5` across the
 * lockfile for Dependabot alert #62 (`GHSA-g3hv-75wg-m249`).
 */

import { Minimatch } from 'minimatch';

if (typeof Minimatch.prototype.matchOne !== 'function') {
  Minimatch.prototype.matchOne = function matchOne(file, _pattern, partial) {
    const target = Array.isArray(file) ? file.join('/') : String(file);
    return this.match(target, Boolean(partial));
  };
}

await import('../node_modules/typedoc/dist/cli.js');
