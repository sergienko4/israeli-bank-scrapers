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
    // R-ACCOUNT (Phase 7d).
    wk: 'PIPELINE_WELL_KNOWN_ACCOUNT_FIELDS',
    owners: [
      path.join('Mediator', 'AccountResolve'),
      path.join('Phases', 'AccountResolve'),
      path.join('Mediator', 'Auth', 'AccountDiscovery.ts'),
      // Phase 7e (Revision 2): the TXN parser stays at
      // Mediator/Scrape/ScrapeAutoMapper.ts (rename reverted to keep
      // the eslint Section 12 allowlist working). Allowlisted because
      // the parser surfaces account ids while resolving the TXN-shape
      // (the same way {@link AccountDiscovery} surfaces them while
      // picking the ACCOUNT endpoint).
      path.join('Mediator', 'Scrape', 'ScrapeAutoMapper.ts'),
      // Strategy/Scrape/Account/* still surface account ids to display
      // alongside transactions — bounded scope, kept under R-ACCOUNT.
      path.join('Strategy', 'Scrape', 'Account', 'ScrapeIdExtraction.ts'),
      path.join('Strategy', 'Scrape', 'Account', 'AccountScrapeStrategy.ts'),
      path.join('Strategy', 'Scrape', 'Account', 'FilterDataStrategy.ts'),
      path.join('Strategy', 'Scrape', 'Account', 'PendingStrategy.ts'),
    ],
    forbidden: [path.join('Mediator', 'Dashboard'), path.join('Phases', 'Dashboard')],
  },
  {
    // R-API (Phase 7e). DASHBOARD owns TXN-side WK_API; SCRAPE consumes
    // resolved values via ctx.txnEndpoint. The parser file is allowlisted
    // because Phase 7e (Revision 2) kept it at Mediator/Scrape/.
    wk: 'PIPELINE_WELL_KNOWN_API',
    owners: [
      path.join('Mediator', 'Dashboard'),
      path.join('Phases', 'Dashboard'),
      path.join('Mediator', 'Network'),
      path.join('Mediator', 'Scrape', 'ScrapeAutoMapper.ts'),
      // Auth post-login probe still consumes WK_API.accounts as the
      // landing-traffic gate (R-AUTH-CLEANUP only forbids transactions).
      path.join('Mediator', 'Auth', 'PostLoginTrafficProbe.ts'),
    ],
    forbidden: [
      path.join('Strategy', 'Scrape'),
      path.join('Phases', 'Scrape'),
      path.join('Mediator', 'AccountResolve'),
      path.join('Phases', 'AccountResolve'),
    ],
  },
  {
    // R-BILLING (Phase 7e). The billing URL is pre-resolved by
    // DASHBOARD.FINAL into ctx.txnEndpoint.billingUrl; SCRAPE consumes.
    wk: 'PIPELINE_WELL_KNOWN_BILLING',
    owners: [
      path.join('Mediator', 'Dashboard'),
      path.join('Phases', 'Dashboard'),
      path.join('Mediator', 'Network'),
      path.join('Mediator', 'Scrape', 'ScrapeAutoMapper.ts'),
    ],
    forbidden: [
      path.join('Strategy', 'Scrape'),
      path.join('Phases', 'Scrape'),
      path.join('Mediator', 'AccountResolve'),
      path.join('Phases', 'AccountResolve'),
      path.join('Mediator', 'Auth'),
    ],
  },
  {
    // R-TXN (Phase 7e). WK_TXN field aliases live in the parser only.
    wk: 'PIPELINE_WELL_KNOWN_TXN_FIELDS',
    owners: [
      path.join('Mediator', 'Scrape', 'ScrapeAutoMapper.ts'),
      // Strategy/Scrape/Account/BalanceExtractor.ts and
      // Strategy/Scrape/ScrapeChunking.ts/UrlDateRange.ts still touch
      // WK_TXN for monthly chunking + balance extraction; allowlisted as
      // a Phase-7f follow-up trim once parseFreshResponse lands.
      path.join('Strategy', 'Scrape', 'Account', 'BalanceExtractor.ts'),
      path.join('Strategy', 'Scrape', 'ScrapeChunking.ts'),
      path.join('Mediator', 'Scrape', 'UrlDateRange.ts'),
      path.join('Mediator', 'Scrape', 'TxnShape.ts'),
    ],
    forbidden: [
      path.join('Mediator', 'Dashboard'),
      path.join('Phases', 'Dashboard'),
      path.join('Mediator', 'AccountResolve'),
      path.join('Phases', 'AccountResolve'),
      path.join('Mediator', 'Auth'),
    ],
  },
];

/** A single forbidden-call detection — file path + grep'd line numbers. */
interface IForbiddenCall {
  readonly callee: string;
  readonly relPath: string;
  readonly lines: readonly number[];
}

/**
 * Phase 7e F-ARCH-4: SCRAPE-side code MUST NOT call
 * `network.discoverTransactionsEndpoint()` directly. The single legitimate
 * call site is `Mediator/Scrape/TxnEndpointBridge.ts` — the adapter that
 * fronts `ctx.txnEndpoint` (committed by DASHBOARD.FINAL) for the
 * mock-mode bypass case.
 */
const SCRAPE_ZONES: readonly string[] = [
  path.join('Strategy', 'Scrape'),
  path.join('Phases', 'Scrape'),
  path.join('Mediator', 'Scrape'),
];

/**
 * Files inside SCRAPE_ZONES that are exempt from the F-ARCH-4 grep.
 * Only the parser (which DASHBOARD.FINAL calls into via
 * `resolveTxnEndpoint`) is allowed to touch
 * `INetworkDiscovery.discoverTransactionsEndpoint`. The bridge does
 * NOT call discovery — it reads `ctx.txnEndpoint` only. TxnShape
 * imports the type for its own helpers; no runtime call.
 */
const SCRAPE_DISCOVERY_ALLOWLIST: readonly string[] = [
  path.join('Mediator', 'Scrape', 'ScrapeAutoMapper.ts'),
  path.join('Mediator', 'Scrape', 'TxnShape.ts'),
];

/**
 * Returns true when the file lives in a SCRAPE zone AND is NOT on the
 * F-ARCH-4 allowlist.
 * @param relPath - Path relative to PIPELINE_ROOT.
 * @returns True when the file is subject to the F-ARCH-4 grep.
 */
function isScrapeZoneEnforced(relPath: string): boolean {
  const isInZone = SCRAPE_ZONES.some((zone): boolean => relPathMatches(relPath, zone));
  if (!isInZone) return false;
  const isAllowlisted = SCRAPE_DISCOVERY_ALLOWLIST.some((entry): boolean =>
    relPathMatches(relPath, entry),
  );
  return !isAllowlisted;
}

/**
 * Find every line that calls `discoverTransactionsEndpoint(...)` (the
 * call form, not type or comment references). Skips line-leading `//`
 * comments and lines that begin with `*` (JSDoc continuation lines).
 * @param text - Source file text.
 * @returns Line numbers (1-based) carrying the call.
 */
function findDiscoverTxnCallLines(text: string): readonly number[] {
  const callPattern = /\.discoverTransactionsEndpoint\s*\(/;
  const lines = text.split('\n');
  const hits: number[] = [];
  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i];
    const trimmed = line.trimStart();
    if (trimmed.startsWith('//')) continue;
    if (trimmed.startsWith('*')) continue;
    if (callPattern.test(line)) hits.push(i + 1);
  }
  return hits;
}

/**
 * Scan SCRAPE-zone files for forbidden discoverTransactionsEndpoint() calls.
 * @returns Forbidden hits, empty when the boundary holds.
 */
function findForbiddenDiscoverTxnCalls(): readonly IForbiddenCall[] {
  const files = listTsFiles(PIPELINE_ROOT);
  const hits: IForbiddenCall[] = [];
  for (const full of files) {
    const rel = path.relative(PIPELINE_ROOT, full);
    if (!isScrapeZoneEnforced(rel)) continue;
    const text = fs.readFileSync(full, 'utf-8');
    const lines = findDiscoverTxnCallLines(text);
    if (lines.length > 0) {
      hits.push({ callee: 'discoverTransactionsEndpoint', relPath: rel, lines });
    }
  }
  return hits;
}

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
        const summary = hits.map((h): string => `${h.relPath} @ lines ${h.lines.join(',')}`);
        expect(summary).toEqual([]);
      });
    });
  }
});

describe('Phase 7e — F-ARCH-4: SCRAPE never calls discoverTransactionsEndpoint', () => {
  it('no SCRAPE-zone file outside the bridge calls discoverTransactionsEndpoint()', () => {
    const hits = findForbiddenDiscoverTxnCalls();
    const summary = hits.map((h): string => `${h.relPath} @ lines ${h.lines.join(',')}`);
    expect(summary).toEqual([]);
  });
});
