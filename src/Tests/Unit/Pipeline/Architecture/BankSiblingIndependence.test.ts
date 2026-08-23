/**
 * OCP regression gate — no `Banks/<X>/**` file may import `Banks/<Y>/**`.
 *
 * <p>Brands that share a wire contract (the FIBI group: Massad, Pagi, Otsar
 * Hahayal, Beinleumi) share it through a neutral factory under
 * `Phases/ApiDirectScrape/**`, never by one bank reaching into another. That
 * direction matters: a bank-to-bank import makes one brand's outage or edit a
 * silent regression in its sibling, and it re-creates the coupling the shared
 * factory was extracted to remove. The convention was documented in bank
 * headers long before it was enforced — this gate closes that gap.
 *
 * <p>`Banks/_Shared/**` is exempt by design: it is the sanctioned home for
 * code common to all banks, so importing it is not a sibling edge. So is the
 * Banks-layer registry that sits directly under `Banks/` — enumerating every
 * bank is exactly what it exists to do (see `CoreBankIndependence.test.ts`).
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
const BANKS_ROOT = path.join(PIPELINE_ROOT, 'Banks');
const BANKS_PREFIX = `${BANKS_ROOT}${path.sep}`;
const SHARED_DIR = '_Shared';

/** One sibling violation: the importing file plus the specifier that crossed. */
interface ISiblingImport {
  readonly importer: string;
  readonly specifier: string;
}

/**
 * Names the bank a file belongs to.
 *
 * <p>Files sitting directly under `Banks/` belong to no bank: that is the
 * registry layer (`PipelineRegistry.ts` and its alphabetical halves) whose
 * designated job is to enumerate every bank. Same for `_Shared`.
 * @param file - Absolute path of a production source file.
 * @returns The bank folder name, or `''` when the file is in no bank folder.
 */
function bankOf(file: string): string {
  if (!file.startsWith(BANKS_PREFIX)) return '';
  const rest = file.slice(BANKS_PREFIX.length);
  if (!rest.includes(path.sep)) return '';
  const first = rest.split(path.sep)[0] ?? '';
  return first === SHARED_DIR ? '' : first;
}

/**
 * Decides whether an import edge crosses from one bank into a different one.
 * @param importer - Absolute path of the importing file.
 * @param target - Absolute path the specifier resolved to (`''` when external).
 * @returns True only when both ends sit in different concrete bank folders.
 */
function isCrossBankEdge(importer: string, target: string): boolean {
  const from = bankOf(importer);
  const to = bankOf(target);
  return from !== '' && to !== '' && from !== to;
}

/**
 * Append every sibling-crossing import of `importer` to `out`.
 * @param importer - Absolute path of a bank source file.
 * @param out - Accumulator, mutated in place.
 * @returns The same accumulator, so callers may chain.
 */
function collectSiblingEdges(importer: string, out: ISiblingImport[]): readonly ISiblingImport[] {
  for (const spec of parseImports(importer)) {
    const resolved = resolveImport(importer, spec);
    if (!isCrossBankEdge(importer, resolved)) continue;
    out.push({ importer: path.relative(BANKS_ROOT, importer), specifier: spec });
  }
  return out;
}

/**
 * List every production source file under `Banks/**`.
 * @returns Absolute paths of bank production source files.
 */
function listBankFiles(): readonly string[] {
  const bankFiles: string[] = [];
  walkProdFiles(BANKS_ROOT, bankFiles);
  return bankFiles;
}

/**
 * Collect every direct import edge that leaves one bank and lands in another.
 * @param bankFiles - Production source files under `Banks/**`.
 * @returns Violations, empty when no bank imports a sibling.
 */
function findSiblingImports(bankFiles: readonly string[]): readonly ISiblingImport[] {
  const violations: ISiblingImport[] = [];
  for (const importer of bankFiles) collectSiblingEdges(importer, violations);
  return violations;
}

const PAGI_FILE = path.join(BANKS_PREFIX, 'Pagi', 'scrape', 'PagiShape.ts');
const MASSAD_FILE = path.join(BANKS_PREFIX, 'Massad', 'scrape', 'MassadShape.ts');
const PAGI_OTHER = path.join(BANKS_PREFIX, 'Pagi', 'scrape', 'PagiShapeTxns.ts');
const SHARED_FILE = path.join(BANKS_PREFIX, SHARED_DIR, 'Anything.ts');
const FACTORY_FILE = path.join(PIPELINE_ROOT, 'Phases', 'ApiDirectScrape', 'FibiGroup', 'X.ts');
const REGISTRY_FILE = path.join(BANKS_PREFIX, 'PipelineRegistry.ts');

describe('Banks <-> Banks sibling independence (OCP)', () => {
  const bankFiles = listBankFiles();

  it('actually scans the Banks pipeline tree (guards against a vacuous pass)', () => {
    expect(bankFiles.length).toBeGreaterThan(0);
  });

  it('rejects a sibling edge — the detector is not vacuously true', () => {
    const isCrossed = isCrossBankEdge(PAGI_FILE, MASSAD_FILE);
    expect(isCrossed).toBe(true);
  });

  it.each([
    ['same bank', PAGI_FILE, PAGI_OTHER],
    ['sanctioned _Shared', PAGI_FILE, SHARED_FILE],
    ['the neutral shared factory', PAGI_FILE, FACTORY_FILE],
    ['the Banks-layer registry enumerating banks', REGISTRY_FILE, MASSAD_FILE],
    ['an unresolved external specifier', PAGI_FILE, ''],
  ])('allows %s', (_label, importer, target) => {
    const isCrossed = isCrossBankEdge(importer, target);
    expect(isCrossed).toBe(false);
  });

  it('no bank imports a sibling bank', () => {
    const violations = findSiblingImports(bankFiles);
    const summary = violations.map((v): string => `${v.importer} -> ${v.specifier}`);
    expect(summary).toEqual([]);
  });
});
