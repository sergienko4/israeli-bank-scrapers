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

import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';

const rootRequire = createRequire(import.meta.url);
const typedocRequire = createRequire(rootRequire.resolve('typedoc/package.json'));

/**
 * Resolves a specifier from TypeDoc's package context as a file URL string.
 *
 * @param {string} specifier - Module specifier relative to `typedoc`.
 * @returns {string} File URL string for dynamic `import()`.
 */
export function resolveFromTypedoc(specifier) {
  return pathToFileURL(typedocRequire.resolve(specifier)).href;
}

/**
 * Compatibility shim for `Minimatch.prototype.matchOne` removed in `minimatch@11`.
 *
 * @this {{ match: (path: string, partial?: boolean) => boolean }}
 * @param {string | readonly string[]} file - Path segments or slash-delimited path.
 * @param {unknown} _pattern - Pattern row passed by TypeDoc (`this.set[0]`).
 * @param {boolean} [partial] - Whether partial prefix matching is enabled.
 * @returns {boolean} True when the target path matches.
 */
export function matchOne(file, _pattern, partial) {
  const target = Array.isArray(file) ? file.join('/') : String(file);
  return this.match(target, Boolean(partial));
}

/**
 * Installs `matchOne` onto a `Minimatch` constructor prototype when missing.
 *
 * @param {{ prototype: { matchOne?: typeof matchOne } }} MinimatchClass - Minimatch constructor.
 * @returns {boolean} True when the shim was installed, false if already present.
 */
export function installMinimatchShim(MinimatchClass) {
  if (typeof MinimatchClass.prototype.matchOne === 'function') {
    return false;
  }
  MinimatchClass.prototype.matchOne = matchOne;
  return true;
}

/**
 * Checks whether this module was invoked directly as the Node entry script.
 *
 * @param {string} metaUrl - The module's `import.meta.url`.
 * @param {string} [entryArg] - `process.argv[1]`.
 * @returns {boolean} True when executed directly as a CLI entry point.
 */
export function isEntryPoint(metaUrl, entryArg = '') {
  return Boolean(entryArg) && metaUrl === pathToFileURL(entryArg).href;
}

const { Minimatch } = await import(resolveFromTypedoc('minimatch'));
installMinimatchShim(Minimatch);

if (isEntryPoint(import.meta.url, process.argv[1])) {
  await import(resolveFromTypedoc('./dist/cli.js'));
}
