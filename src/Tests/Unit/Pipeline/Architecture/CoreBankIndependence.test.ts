/**
 * OCP regression gate — no `Core/**` pipeline file may DIRECTLY import a
 * concrete bank module.
 *
 * <p>Banks are wired in exclusively through the Banks-layer registry
 * (`Banks/PipelineRegistry.ts`), which merges the alphabetical-half
 * sub-registries that map each bank to its pipeline factory. If a future
 * change re-introduces a direct `Core/** -> Banks/**` import (for example by
 * enumerating banks back inside any `Core/**` module), this test fails —
 * keeping the rule "adding a bank touches only Banks/**" true. (It guards the
 * direct import edge only, not transitive reachability — the dependency-cycle
 * gate covers structural back-edges.)
 *
 * <p>Reuses the shared import-graph scanner (`Tools/ImportGraphScan.ts`) so the
 * notion of "production source" + TS/ESM specifier resolution stays in
 * lock-step with the dead-code and acyclic-dependencies gates.
 */

import * as path from 'node:path';
import { fileURLToPath } from 'node:url';

import { parseImports, resolveImport, walkProdFiles } from '../../../Tools/ImportGraphScan.js';

const HERE_URL = fileURLToPath(import.meta.url);
const HERE = path.dirname(HERE_URL);
const PIPELINE_ROOT = path.join(HERE, '..', '..', '..', '..', 'Scrapers', 'Pipeline');
const CORE_ROOT = path.join(PIPELINE_ROOT, 'Core');
const BANKS_ROOT = path.join(PIPELINE_ROOT, 'Banks');
const BANKS_PREFIX = `${BANKS_ROOT}${path.sep}`;

/** One Core -> Banks violation: the importer file plus the bank specifier. */
interface ICoreBankImport {
  readonly importer: string;
  readonly bankSpecifier: string;
}

/**
 * Append every Banks-resolving import of `importer` to `out`.
 * @param importer - Absolute path of a Core source file.
 * @param out - Accumulator, mutated in place.
 * @returns The same accumulator, so callers may chain.
 */
function collectBankEdges(importer: string, out: ICoreBankImport[]): readonly ICoreBankImport[] {
  for (const spec of parseImports(importer)) {
    const resolved = resolveImport(importer, spec);
    if (!resolved.startsWith(BANKS_PREFIX)) continue;
    const importerRel = path.relative(PIPELINE_ROOT, importer);
    out.push({ importer: importerRel, bankSpecifier: spec });
  }
  return out;
}

/**
 * List every production source file under `Core/**`.
 * @returns Absolute paths of Core production source files.
 */
function listCoreFiles(): readonly string[] {
  const coreFiles: string[] = [];
  walkProdFiles(CORE_ROOT, coreFiles);
  return coreFiles;
}

/**
 * Collect every direct import edge that leaves a `Core/**` file and lands
 * inside `Banks/**`.
 * @param coreFiles - Production source files under `Core/**`.
 * @returns Violations, empty when Core directly imports no bank module.
 */
function findCoreToBankImports(coreFiles: readonly string[]): readonly ICoreBankImport[] {
  const violations: ICoreBankImport[] = [];
  for (const importer of coreFiles) collectBankEdges(importer, violations);
  return violations;
}

describe('Core <-> Banks independence (OCP)', () => {
  const coreFiles = listCoreFiles();

  it('actually scans the Core pipeline tree (guards against a vacuous pass)', () => {
    expect(coreFiles.length).toBeGreaterThan(0);
  });

  it('no Core pipeline file directly imports a concrete bank module', () => {
    const violations = findCoreToBankImports(coreFiles);
    const summary = violations.map((v): string => `${v.importer} -> ${v.bankSpecifier}`);
    expect(summary).toEqual([]);
  });
});
