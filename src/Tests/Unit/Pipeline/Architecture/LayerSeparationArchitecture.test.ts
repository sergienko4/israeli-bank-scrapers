/**
 * Phase 7d — enforces the layered ownership rule for the WK
 * dictionaries.
 *
 * <p>`PIPELINE_WELL_KNOWN_ACCOUNT_FIELDS` belongs to the
 * ACCOUNT-RESOLVE producers (the new dedicated phase + its
 * discovery helpers + the shared parser). DASHBOARD must have ZERO
 * knowledge of account info; SCRAPE will lose its account-WK
 * imports iteratively in Phase 7e+.
 *
 * <p>The test scans every `.ts` file under
 * `src/Scrapers/Pipeline/`, classifies each WK import as owner /
 * forbidden / neither, and fails when any forbidden hit surfaces.
 * Re-export sites in the WK barrel are allowlisted explicitly so
 * the dictionary itself can still be re-exported.
 */

import * as fs from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE_URL = fileURLToPath(import.meta.url);
const HERE = path.dirname(HERE_URL);
const PIPELINE_ROOT = path.join(HERE, '..', '..', '..', '..', 'Scrapers', 'Pipeline');
const WK_BARREL_REL = path.join('Registry', 'WK', 'ScrapeWK.ts');
const FIELD_MAPPINGS_REL = path.join('Registry', 'WK', 'ScrapeFieldMappings.ts');

/** One layer-ownership rule — pairs a WK constant with its zones. */
interface ILayerRule {
  readonly wk: string;
  readonly owners: readonly string[];
  readonly forbidden: readonly string[];
}

const RULES: readonly ILayerRule[] = [
  {
    wk: 'PIPELINE_WELL_KNOWN_ACCOUNT_FIELDS',
    owners: [
      path.join('Mediator', 'AccountResolve'),
      path.join('Phases', 'AccountResolve'),
      path.join('Mediator', 'Auth', 'AccountDiscovery.ts'),
      path.join('Mediator', 'Scrape', 'ScrapeAutoMapper.ts'),
    ],
    forbidden: [path.join('Mediator', 'Dashboard'), path.join('Phases', 'Dashboard')],
  },
];

/**
 * Walk a directory recursively and yield every TypeScript source
 * file. Excludes `.d.ts` declarations.
 * @param dir - Directory to walk.
 * @returns Absolute paths to .ts files.
 */
function listTsFiles(dir: string): readonly string[] {
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  const results: string[] = [];
  for (const entry of entries) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      const nested = listTsFiles(full);
      results.push(...nested);
      continue;
    }
    if (!entry.isFile()) continue;
    if (!entry.name.endsWith('.ts')) continue;
    if (entry.name.endsWith('.d.ts')) continue;
    results.push(full);
  }
  return results;
}

/**
 * Returns true when the relative path matches the supplied
 * directory or file allowlist entry. Directory entries match any
 * descendant; file entries match exact equality.
 * @param relPath - Path relative to PIPELINE_ROOT.
 * @param allowEntry - Allowlist entry (directory or file).
 * @returns True when the file falls within the allowlist entry.
 */
function relPathMatches(relPath: string, allowEntry: string): boolean {
  if (relPath === allowEntry) return true;
  const dirPrefix = `${allowEntry}${path.sep}`;
  return relPath.startsWith(dirPrefix);
}

/**
 * Tracks whether the regex scan is currently inside an `import`
 * statement (multi-line imports stay flagged across lines until the
 * trailing semicolon closes the statement).
 */
interface IScanState {
  isInsideImport: boolean;
  readonly hits: number[];
}

/** Bundled args for {@link processImportScanLine} so signature stays ≤3. */
interface IScanLineArgs {
  readonly line: string;
  readonly lineNumber: number;
  readonly wkPattern: RegExp;
  readonly state: IScanState;
}

/**
 * Process one source line for an import of the WK constant.
 * Mutates `args.state` in place to track multi-line import
 * continuation and accumulate hit line numbers.
 * @param args - Bundled scan args.
 * @returns The same state (chain-friendly).
 */
function processImportScanLine(args: IScanLineArgs): IScanState {
  const isImportStart = args.line.trimStart().startsWith('import ');
  const wasInside = args.state.isInsideImport;
  const isInside = wasInside || isImportStart;
  if (isInside && args.wkPattern.test(args.line)) args.state.hits.push(args.lineNumber);
  args.state.isInsideImport = isInside && !args.line.includes(';');
  return args.state;
}

/**
 * Scan one file's text for an import of the supplied WK constant
 * and return matching line numbers (1-based). Catches both
 * `import { WK as alias }` and `import { WK }` shapes via a single
 * word-boundary regex.
 * @param text - Source file text.
 * @param wk - WK constant name.
 * @returns Line numbers carrying the import.
 */
function findImportLines(text: string, wk: string): readonly number[] {
  const lines = text.split('\n');
  const wkPattern = new RegExp(String.raw`\b${wk}\b`);
  const state: IScanState = { isInsideImport: false, hits: [] };
  for (let i = 0; i < lines.length; i += 1) {
    processImportScanLine({ line: lines[i], lineNumber: i + 1, wkPattern, state });
  }
  return state.hits;
}

/** A single forbidden import detection — file path + line numbers. */
interface IForbiddenHit {
  readonly relPath: string;
  readonly lines: readonly number[];
}

/** Result of {@link assertAllowlistPathsExist}. */
interface IAllowlistVerdict {
  readonly missing: readonly string[];
}

/**
 * Verify each allowlist entry references an actual file or
 * directory. A stale allowlist would silently let regressions
 * through.
 * @param rule - Layer rule under test.
 * @returns Verdict listing missing paths (empty when all exist).
 */
function assertAllowlistPathsExist(rule: ILayerRule): IAllowlistVerdict {
  const missing: string[] = [];
  for (const entry of rule.owners) {
    const full = path.join(PIPELINE_ROOT, entry);
    if (!fs.existsSync(full)) missing.push(entry);
  }
  for (const entry of rule.forbidden) {
    const full = path.join(PIPELINE_ROOT, entry);
    if (!fs.existsSync(full)) missing.push(entry);
  }
  return { missing };
}

/**
 * Classify one file relative to a rule. Returns true when the file
 * lives in the rule's forbidden zone.
 * @param relPath - Path relative to PIPELINE_ROOT.
 * @param rule - Layer rule under test.
 * @returns True when forbidden.
 */
function isForbiddenFile(relPath: string, rule: ILayerRule): boolean {
  if (relPath === WK_BARREL_REL) return false;
  if (relPath === FIELD_MAPPINGS_REL) return false;
  const isOwner = rule.owners.some((entry): boolean => relPathMatches(relPath, entry));
  if (isOwner) return false;
  return rule.forbidden.some((entry): boolean => relPathMatches(relPath, entry));
}

/**
 * Scan every `.ts` file under PIPELINE_ROOT for forbidden imports
 * of the rule's WK constant.
 * @param rule - Layer rule under test.
 * @returns Forbidden hits, empty when the boundary holds.
 */
function findForbiddenImports(rule: ILayerRule): readonly IForbiddenHit[] {
  const files = listTsFiles(PIPELINE_ROOT);
  const hits: IForbiddenHit[] = [];
  for (const full of files) {
    const rel = path.relative(PIPELINE_ROOT, full);
    if (!isForbiddenFile(rel, rule)) continue;
    const text = fs.readFileSync(full, 'utf-8');
    const lines = findImportLines(text, rule.wk);
    if (lines.length > 0) hits.push({ relPath: rel, lines });
  }
  return hits;
}

describe('Phase 7d — layer-separation architecture validation', () => {
  for (const rule of RULES) {
    describe(`WK ${rule.wk}`, () => {
      it('every allowlist path exists on disk', () => {
        const verdict = assertAllowlistPathsExist(rule);
        expect(verdict.missing).toEqual([]);
      });

      it('no forbidden zone imports the WK', () => {
        const hits = findForbiddenImports(rule);
        const summary = hits.map(
          (h): string => `${h.relPath} @ lines ${h.lines.join(',')}`,
        );
        expect(summary).toEqual([]);
      });
    });
  }
});
