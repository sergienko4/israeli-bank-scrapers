#!/usr/bin/env node
/**
 * Daily dev-tooling watch CLI. The logic lives in `scripts/dev-tooling/watch.mjs`.
 *
 * Usage:
 *   node scripts/dev-tooling-watch.mjs [--out <file>] [--verdict <file>]
 *
 * Installs the newest same-major release of each `lint-tooling` package into
 * `node_modules` (package.json and the lockfile stay as they are), runs the
 * static gates on it, prints the markdown body of the watch issue, and writes
 * it to `--out` and the JSON verdict to `--verdict` when given. Run
 * `npm ci` afterwards to restore the locked tree.
 *
 * Exit codes: 0 verdict written · 2 the watch cannot read its inputs. The
 * watch is imported dynamically so that a missing module or any unexpected
 * error also exits 2.
 */
import process from 'node:process';

try {
  const { runWatch } = await import('./dev-tooling/watch.mjs');
  process.exitCode = runWatch(process.argv.slice(2));
} catch (error) {
  process.stderr.write(`INTERNAL ${error instanceof Error ? error.stack : String(error)}\n`);
  process.exitCode = 2;
}
