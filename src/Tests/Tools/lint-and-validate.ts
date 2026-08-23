/**
 * ARCHITECTURE GATEWAY — entrypoint.
 * Thin wrapper around `LintValidator.ts`. Walks argv paths (files and/or
 * directories), runs rule checks, writes `.architecture-violations.log`,
 * and exits 1 when any issue survives the allowlist.
 *
 * Called by:
 *   - `npm run lint:architecture` (usually with a directory argument)
 *   - the pre-commit hook (with individual staged file paths via xargs)
 *
 * Both call paths resolve through the same walker so results match.
 */

import * as fs from 'node:fs';

import {
  analyzeFile,
  expandToFiles,
  isExcluded,
  loadAllowlist,
  parseOnlyArgs,
  RULE_KEYS,
} from './LintValidator.js';

/** Output log filename (consumed by the pre-commit hook for diagnostics). */
const LOG_FILE = '.architecture-violations.log';

/** Shape of a per-file report written to the log. */
interface IFileReport {
  readonly file: string;
  readonly violations: string[];
}

/** Exit code for a malformed invocation, kept distinct from a violation (1). */
const USAGE_EXIT = 2;

const RAW_ARGV = process.argv.slice(2);
const PARSED = parseOnlyArgs(RAW_ARGV);

if (PARSED.error !== '') {
  process.stderr.write(`❌ ${PARSED.error}\n   known rules: ${RULE_KEYS.join(', ')}\n`);
  process.exit(USAGE_EXIT);
}

const ONLY_RULE = PARSED.rule;
const ARGV_PATHS = PARSED.paths;
const ALLOWLIST = loadAllowlist();
const FILES = expandToFiles(ARGV_PATHS);
const REPORTS: IFileReport[] = [];

for (const filePath of FILES) {
  if (isExcluded(filePath)) continue;
  const found = analyzeFile(filePath, ALLOWLIST);
  const issues = ONLY_RULE === '' ? found : found.filter((i): boolean => i.rule === ONLY_RULE);
  if (issues.length === 0) continue;
  const messages = issues.map((i): string => i.message);
  REPORTS.push({ file: filePath, violations: messages });
}

if (REPORTS.length === 0) {
  // Scrub any stale log file from a previous failed run.
  try {
    if (fs.existsSync(LOG_FILE)) fs.unlinkSync(LOG_FILE);
  } catch {
    /* best effort */
  }
  process.exit(0);
}

const TOTAL_VIOLATIONS = REPORTS.reduce(
  (acc: number, r: IFileReport): number => acc + r.violations.length,
  0,
);
const LOG_JSON = JSON.stringify(REPORTS, null, 2);
fs.writeFileSync(LOG_FILE, LOG_JSON, 'utf8');
process.stderr.write(`❌ Architecture Check: ${String(TOTAL_VIOLATIONS)} violations.\n`);
process.exit(1);
