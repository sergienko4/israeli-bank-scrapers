#!/usr/bin/env node
/**
 * Weekly browser-stack watch CLI. The logic lives in `scripts/browser-stack/watch.mjs`.
 *
 * Usage:
 *   node scripts/browser-stack-watch.mjs [--out <file>]
 *
 * Prints the markdown body of the watch issue, and writes it to `--out` when
 * given. `GITHUB_TOKEN`, when set, raises the GitHub API rate limit;
 * `GITHUB_REPOSITORY` adds a link to open playwright-core update PRs.
 *
 * Exit codes: 0 report written · 2 the watch cannot read its inputs. The
 * watch is imported dynamically so that a missing module or any unexpected
 * error also exits 2.
 */
import process from 'node:process';

try {
  const { runWatch } = await import('./browser-stack/watch.mjs');
  process.exitCode = await runWatch(process.argv.slice(2));
} catch (error) {
  process.stderr.write(`INTERNAL ${error instanceof Error ? error.stack : String(error)}\n`);
  process.exitCode = 2;
}
