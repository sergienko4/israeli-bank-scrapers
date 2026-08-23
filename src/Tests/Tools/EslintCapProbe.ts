/**
 * ESLINT CAP PROBE — audits EVERY production file against the cap table.
 *
 * <p>Discovers the production file set, resolves each file's caps through
 * ESLint's own flat-config resolver, and compares the answer against the cap
 * table — the canonical caps in `CapRegimeTable.ts` plus the deliberate
 * deviations in `CapOverrides.ts`. A deleted grandfather-then-tighten block
 * therefore fails by name instead of silently relaxing shipped code.
 *
 * <p>Auditing per FILE rather than per directory is load-bearing. Several
 * blocks scope a cap to a single filename beside a differently-capped
 * directory — `Phases/Base/BasePhase.ts`, `Strategy/Scrape/ScrapeExecutor.ts`,
 * `Strategy/Scrape/ScrapeDataActions.ts` and
 * `Mediator/Init/NavigationTransportProbe.ts`. A one-probe-per-directory walk
 * cannot see those, so deleting such a scope stayed green.
 *
 * <p>Single-file resolution lives in `CapResolution.ts`; the table's own
 * self-consistency checks live in `CapTableValidation.ts`.
 */

import * as fs from 'node:fs';

import type { ESLint } from 'eslint';

import {
  CANONICAL_CAPS,
  NON_PRODUCTION_DIRS,
  NON_PRODUCTION_SUFFIXES,
  PRODUCTION_ROOTS,
} from './CapRegimeTable.js';
import { type ICapRegimeFailure, regimeFailure, resolveRulesForFile } from './CapResolution.js';
import tableFailures from './CapTableValidation.js';

/** Outcome of a full regime audit: what failed, and how much was covered. */
export interface ICapRegimeResult {
  readonly failures: readonly ICapRegimeFailure[];
  readonly fileCount: number;
}

/**
 * Whether a filename is production TypeScript rather than a test file, which
 * carries its own regime.
 * @param name - Bare filename.
 * @returns True when the file belongs in the production audit.
 */
function isProductionSource(name: string): boolean {
  const isTs = name.endsWith('.ts');
  const isExcluded = NON_PRODUCTION_SUFFIXES.some((suffix): boolean => name.endsWith(suffix));
  return isTs && !isExcluded;
}

/**
 * Collect EVERY production `.ts` file under a root.
 * @param root - Directory to walk, repo-relative with forward slashes.
 * @param into - Accumulator of repo-relative file paths.
 * @returns The accumulator, so callers can chain roots.
 */
function collectProductionFiles(root: string, into: string[]): string[] {
  const entries = fs.readdirSync(root, { withFileTypes: true });
  for (const entry of entries) {
    const full = `${root}/${entry.name}`;
    const isWalkable = entry.isDirectory() && !NON_PRODUCTION_DIRS.includes(entry.name);
    if (isWalkable) collectProductionFiles(full, into);
    else if (!entry.isDirectory() && isProductionSource(entry.name)) into.push(full);
  }
  return into;
}

/**
 * Audit every canonical rule for ONE production file.
 * @param eslint - ESLint instance loading `eslint.config.mjs`.
 * @param path - Repo-relative file being audited.
 * @returns Failure records (empty when the file matches the table).
 */
async function auditFile(eslint: ESLint, path: string): Promise<readonly ICapRegimeFailure[]> {
  const resolved = await resolveRulesForFile(eslint, path);
  const ruleIds = Object.keys(CANONICAL_CAPS);
  return ruleIds.flatMap((ruleId): readonly ICapRegimeFailure[] =>
    regimeFailure(resolved[ruleId], path, ruleId),
  );
}

/**
 * Audit EVERY production file against the cap table.
 * @param eslint - ESLint instance loading `eslint.config.mjs`.
 * @returns Failures plus the number of files covered.
 */
export async function auditCapRegimes(eslint: ESLint): Promise<ICapRegimeResult> {
  const paths: string[] = [];
  for (const root of PRODUCTION_ROOTS) collectProductionFiles(root, paths);
  const probes = paths.map((p): Promise<readonly ICapRegimeFailure[]> => auditFile(eslint, p));
  const results = await Promise.all(probes);
  const tableIssues = tableFailures(paths);
  const failures: readonly ICapRegimeFailure[] = [...results.flat(), ...tableIssues];
  return { failures, fileCount: paths.length };
}
