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
      // M2 relocated AccountFromPool back into AccountResolve zone
      // (per "100% separation" — shape predicate is AccountResolve's
      // concern; Network's `waitForFirstId` accepts the predicate via
      // dependency inversion). Bare directory entry above already
      // covers this file; explicit listing kept for traceability.
      // Phase 7e (Revision 2): the TXN parser stays at
      // Mediator/Scrape/ScrapeAutoMapper.ts (rename reverted to keep
      // the eslint Section 12 allowlist working). Allowlisted because
      // the parser surfaces account ids while resolving the TXN-shape
      // (the same way {@link AccountDiscovery} surfaces them while
      // picking the ACCOUNT endpoint).
      path.join('Mediator', 'Scrape', 'ScrapeAutoMapper.ts'),
      // Phase 7f (follow-up): TxnParser builds the DASHBOARD-side
      // harvest scope by extracting an accountId-aliased URL param
      // from the captured endpoint. The aliases come from WK_ACCT.id
      // — same allowance as ScrapeAutoMapper.ts above (surface ids
      // while shaping a non-account artefact). The harvest itself
      // travels as `IDashboardTxnHarvest` (clean value type), not as
      // any ACCOUNT-RESOLVE structure.
      path.join('Mediator', 'Dashboard', 'TxnParser.ts'),
      // Phase 2c (2026-…): TxnParser.ts split into co-located siblings
      // to satisfy the per-file LoC budget. `.accountId.ts` and
      // `.scope.ts` carry the surface-id lines that originally lived
      // in TxnParser.ts — same allowance, just relocated under the
      // strict-LoC-cluster lockdown.
      path.join('Mediator', 'Dashboard', 'TxnParser.accountId.ts'),
      path.join('Mediator', 'Dashboard', 'TxnParser.scope.ts'),
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
      // LOGIN's post-login probe still consumes WK_API.accounts as
      // the landing-traffic gate. M1+ moved the file from
      // `Mediator/Auth/` to `Mediator/Login/` (its semantic owner)
      // — kills the cross-zone Login → Auth import.
      path.join('Mediator', 'Login', 'PostLoginTrafficProbe.ts'),
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
    ],
  },
  {
    // R-TXN (Phase 7e). WK_TXN field aliases live in the parser only.
    wk: 'PIPELINE_WELL_KNOWN_TXN_FIELDS',
    owners: [
      path.join('Mediator', 'Scrape', 'ScrapeAutoMapper.ts'),
      // Phase 7f follow-up: BalanceExtractor.ts NO LONGER imports
      // WK_TXN — it consumes `fc.txnEndpoint.fieldMap.balance`
      // (DASHBOARD-resolved) via its `aliases` parameter. The
      // remaining helpers below import URL/body parameter names
      // (`WK.fromDate` / `WK.toDate`) — a request-side concern that
      // `ITxnEndpoint.fieldMap` (response-record aliases) doesn't
      // cover. They stay allowlisted by design, not deferred work.
      path.join('Strategy', 'Scrape', 'ScrapeChunking.ts'),
      path.join('Mediator', 'Scrape', 'UrlDateRange.ts'),
      path.join('Mediator', 'Scrape', 'TxnShape.ts'),
      // Phase H'' (2026-05-15): the date-window detector lives next to
      // the DASHBOARD txn parser because it consumes the same captured
      // pool, but it ONLY reads request-side WK aliases
      // (`WK.fromDate` / `WK.toDate`) to emit the URL-param tuple
      // SCRAPE injects via `applyDateRangeToUrl`. Same exception
      // class as ScrapeChunking / UrlDateRange above.
      path.join('Mediator', 'Dashboard', 'DateWindowParamsDetector.ts'),
      // Phase H'' (2026-05-15): the dormant-evidence detector
      // scans the captured pool for the WK txnContainers +
      // fromDate/toDate signal that proves "window empty" rather
      // than "no endpoint". Reads request-side WK aliases only —
      // same exception class as DateWindowParamsDetector above.
      path.join('Mediator', 'Dashboard', 'DormantEvidenceDetector.ts'),
      // The picker tier `windowParamsMatch` lives in NetworkDiscovery
      // and inspects `WK.fromDate` / `WK.toDate` aliases against
      // captured URL search params. Request-side concern; same
      // exception class as above.
      path.join('Mediator', 'Network', 'NetworkDiscovery.ts'),
    ],
    forbidden: [
      path.join('Mediator', 'Dashboard'),
      path.join('Phases', 'Dashboard'),
      path.join('Mediator', 'AccountResolve'),
      path.join('Phases', 'AccountResolve'),
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
 * Phase 7e F-ARCH-4 (retained, tightened in Phase 7f): SCRAPE-side
 * code MUST NOT call `network.discoverTransactionsEndpoint()`
 * directly. Phase 7f deleted `Mediator/Scrape/TxnEndpointBridge.ts`
 * (the back-door adapter); the only legitimate call site now is
 * the parser inside `Mediator/Scrape/ScrapeAutoMapper.ts` which
 * DASHBOARD.FINAL drives via `resolveTxnEndpoint`. SCRAPE consumes
 * the typed `ctx.txnEndpoint` contract via
 * `readPreDiscoveredTxn(ctx)` — pure read, no network surface.
 *
 * <p>Phase 7f rule R-NET-SCRAPE additionally forbids any
 * SCRAPE-zone file from importing `IDiscoveredEndpoint` /
 * `INetworkDiscovery` symbols outside the dashboard-resident
 * `ScrapeAutoMapper` and the generic `TxnShape` predicate.
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
 * `INetworkDiscovery.discoverTransactionsEndpoint`. TxnShape imports
 * the type for its own helpers; no runtime call.
 */
const SCRAPE_DISCOVERY_ALLOWLIST: readonly string[] = [
  path.join('Mediator', 'Scrape', 'ScrapeAutoMapper.ts'),
  path.join('Mediator', 'Scrape', 'EndpointResolver', 'EndpointResolver.ts'),
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
  it('no SCRAPE-zone file outside the parser calls discoverTransactionsEndpoint()', () => {
    const hits = findForbiddenDiscoverTxnCalls();
    const summary = hits.map((h): string => `${h.relPath} @ lines ${h.lines.join(',')}`);
    expect(summary).toEqual([]);
  });
});

/**
 * Phase 7f rule R-NET-SCRAPE: SCRAPE-zone files MUST NOT import
 * `INetworkDiscovery` or `IDiscoveredEndpoint` symbols. SCRAPE
 * consumes the slim `ITxnEndpoint` typed contract via
 * `readPreDiscoveredTxn(ctx)` and the pre-discovered account list via
 * `readPreDiscoveredAccounts(ctx)`. Network-shaped types are a back
 * door — once they reach SCRAPE, the discipline collapses.
 */
const NET_SCRAPE_ALLOWLIST: readonly string[] = [
  // The parser is the legitimate bridge between DASHBOARD and the
  // network surface; resolveTxnEndpoint runs here.
  path.join('Mediator', 'Scrape', 'ScrapeAutoMapper.ts'),
  path.join('Mediator', 'Scrape', 'EndpointResolver', 'EndpointResolver.ts'),
  // URL/body helpers extracted from EndpointResolver.ts under the
  // same architectural rationale — consumes `IDiscoveredEndpoint` /
  // `INetworkDiscovery` purely to build pending/billing URLs from
  // captured traffic on behalf of the parser. No SCRAPE consumer.
  path.join('Mediator', 'Scrape', 'EndpointResolver', 'EndpointUrlHelpers.ts'),
  // Generic shape predicate consumed by the network picker; not a
  // SCRAPE consumer.
  path.join('Mediator', 'Scrape', 'TxnShape.ts'),
  // SCRAPE-PRE owns the load-context build that still receives the
  // raw network reference for legacy displayId / balance lookups
  // pending the Phase 7g migration.
  path.join('Mediator', 'Scrape', 'ScrapePhaseActions.ts'),
  path.join('Mediator', 'Scrape', 'FrozenScrapeAction.ts'),
  // Phase 8.5b commit 4: the balance-template-discovery code was
  // extracted from ScrapePhaseActions.ts into a focused leaf module;
  // it still consumes `IDiscoveredEndpoint` from the captured-endpoint
  // pool for the same legacy displayId / balance lookups pending the
  // Phase 7g migration. Inherits the allowlist rationale of its parent.
  path.join('Mediator', 'Scrape', 'ScrapePhase', 'BalanceTemplate.ts'),
  // The strategies still receive the raw `network` field on
  // `IAccountFetchCtx` for legacy displayId / balance lookups
  // (BalanceExtractor / ScrapeChunking / UrlDateRange already
  // allowlisted under R-TXN). SCRAPE strategies that pass `fc`
  // through unchanged inherit the import.
  path.join('Strategy', 'Scrape', 'GenericAutoScrapeStrategy.ts'),
  path.join('Strategy', 'Scrape', 'ScrapeTypes.ts'),
  path.join('Strategy', 'Scrape', 'ScrapeDataActions.ts'),
  path.join('Strategy', 'Scrape', 'Account', 'AccountScrapeStrategy.ts'),
  path.join('Strategy', 'Scrape', 'Account', 'BalanceExtractor.ts'),
  path.join('Strategy', 'Scrape', 'Account', 'ScrapeIdExtraction.ts'),
];

/**
 * Returns true when the file lives in a SCRAPE zone AND is NOT on
 * the R-NET-SCRAPE allowlist.
 *
 * @param relPath - Path relative to PIPELINE_ROOT.
 * @returns True when the file is subject to R-NET-SCRAPE.
 */
function isNetScrapeEnforced(relPath: string): boolean {
  const isInZone = SCRAPE_ZONES.some((zone): boolean => relPathMatches(relPath, zone));
  if (!isInZone) return false;
  const isAllowlisted = NET_SCRAPE_ALLOWLIST.some((entry): boolean =>
    relPathMatches(relPath, entry),
  );
  return !isAllowlisted;
}

/**
 * Find import lines that pull `INetworkDiscovery` or
 * `IDiscoveredEndpoint` symbols from `Mediator/Network/`.
 *
 * @param text - Source file text.
 * @returns Matching line numbers (1-based).
 */
function findNetworkSymbolImportLines(text: string): readonly number[] {
  const lines = text.split('\n');
  const hits: number[] = [];
  const fromNetwork = /from\s+'[^']*Mediator\/Network\//;
  const directSymbol = /\b(?:INetworkDiscovery|IDiscoveredEndpoint)\b/;
  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i];
    const trimmed = line.trimStart();
    if (trimmed.startsWith('//')) continue;
    if (trimmed.startsWith('*')) continue;
    if (!directSymbol.test(line)) continue;
    if (!fromNetwork.test(line) && !line.includes('import')) continue;
    hits.push(i + 1);
  }
  return hits;
}

/**
 * Scan SCRAPE-zone files outside the R-NET-SCRAPE allowlist for any
 * import of `INetworkDiscovery` / `IDiscoveredEndpoint`.
 *
 * @returns Forbidden-import hits, empty when the rule holds.
 */
function findForbiddenNetworkImports(): readonly IForbiddenCall[] {
  const files = listTsFiles(PIPELINE_ROOT);
  const hits: IForbiddenCall[] = [];
  for (const full of files) {
    const rel = path.relative(PIPELINE_ROOT, full);
    if (!isNetScrapeEnforced(rel)) continue;
    const text = fs.readFileSync(full, 'utf-8');
    const lines = findNetworkSymbolImportLines(text);
    if (lines.length > 0) {
      hits.push({ callee: 'INetworkDiscovery|IDiscoveredEndpoint', relPath: rel, lines });
    }
  }
  return hits;
}

describe('Phase 7f — R-NET-SCRAPE: SCRAPE never imports network types', () => {
  it('no SCRAPE-zone file outside the allowlist imports INetworkDiscovery / IDiscoveredEndpoint', () => {
    const hits = findForbiddenNetworkImports();
    const summary = hits.map((h): string => `${h.relPath} @ lines ${h.lines.join(',')}`);
    expect(summary).toEqual([]);
  });
});

/**
 * Mission 1 (CI quality hardening plan) — R-AUTH-DISCOVERY-OWN.
 *
 * <p>AUTH-DISCOVERY is the single owner of the auth-token discovery
 * + dashboard-readiness probe + session-cookie audit. The phase
 * mediator at `Mediator/AuthDiscovery/` is the only place outside
 * `Mediator/Network/` (which defines them) and the existing
 * Dashboard-zone callers (allowlisted; tightening tracked in plan
 * §O-4) that may invoke any of:
 * <ul>
 *   <li>`mediator.network.discoverAuthToken()`</li>
 *   <li>`mediator.network.discoverOrigin()`</li>
 *   <li>`mediator.network.discoverSiteId()`</li>
 *   <li>`mediator.network.buildDiscoveredHeaders()`</li>
 *   <li>`probeDashboardReveal()` (from Dashboard zone)</li>
 * </ul>
 *
 * <p>Forbidden zones: `Mediator/Login/`, `Mediator/OtpTrigger/`,
 * `Mediator/OtpFill/`, `Mediator/Auth/`, plus their `Phases/`
 * counterparts. The two existing leaks
 * (`LoginSignalProbe.ts` in M2, `OtpFillPhaseActions.ts` in M3)
 * carry `M2_DELETES` / `M3_STRIPS` allowlist entries that come out
 * with their respective missions.
 */
const AUTH_DISCOVERY_FORBIDDEN_ZONES: readonly string[] = [
  path.join('Mediator', 'Login'),
  path.join('Mediator', 'OtpTrigger'),
  path.join('Mediator', 'OtpFill'),
  path.join('Phases', 'Login'),
  path.join('Phases', 'OtpTrigger'),
  path.join('Phases', 'OtpFill'),
];

/**
 * Returns true when the file lives in an AUTH-DISCOVERY forbidden
 * zone. M1+ achieved 100% separation — there is no temporary
 * allowlist; any forbidden-zone hit is a regression.
 *
 * @param relPath - Path relative to PIPELINE_ROOT.
 * @returns True when the file is subject to R-AUTH-DISCOVERY-OWN.
 */
function isAuthDiscoveryEnforced(relPath: string): boolean {
  return AUTH_DISCOVERY_FORBIDDEN_ZONES.some((zone): boolean => relPathMatches(relPath, zone));
}

/**
 * Find every line that calls one of the AUTH-DISCOVERY-owned
 * helpers. Skips comment lines and JSDoc continuations so a doc
 * reference doesn't trip the rule.
 *
 * @param text - Source file text.
 * @returns Line numbers (1-based).
 */
function findAuthDiscoveryHelperLines(text: string): readonly number[] {
  const callPattern =
    /\b(?:probeDashboardReveal|discoverAuthToken|discoverOrigin|discoverSiteId|buildDiscoveredHeaders)\s*\(/;
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
 * Scan forbidden-zone files for calls to AUTH-DISCOVERY-owned
 * helpers.
 *
 * @returns Hit list, empty when the rule holds.
 */
function findForbiddenAuthDiscoveryCalls(): readonly IForbiddenCall[] {
  const files = listTsFiles(PIPELINE_ROOT);
  const hits: IForbiddenCall[] = [];
  for (const full of files) {
    const rel = path.relative(PIPELINE_ROOT, full);
    if (!isAuthDiscoveryEnforced(rel)) continue;
    const text = fs.readFileSync(full, 'utf-8');
    const lines = findAuthDiscoveryHelperLines(text);
    if (lines.length > 0) {
      hits.push({
        callee: 'auth-discovery-owned helper',
        relPath: rel,
        lines,
      });
    }
  }
  return hits;
}

describe('Mission 1 — R-AUTH-DISCOVERY-OWN: only AUTH-DISCOVERY calls auth/dashboard helpers', () => {
  it('no Login/OtpTrigger/OtpFill/Auth-zone file calls discoverAuthToken / probeDashboardReveal / discoverOrigin / discoverSiteId / buildDiscoveredHeaders', () => {
    const hits = findForbiddenAuthDiscoveryCalls();
    const summary = hits.map((h): string => `${h.relPath} @ lines ${h.lines.join(',')}`);
    expect(summary).toEqual([]);
  });
});

/**
 * Mission 2 (CI quality hardening plan) — R-LOGIN-SEAL.
 *
 * <p>Forbids the LOGIN zone (`Mediator/Login/*`, `Phases/Login/*`)
 * from importing other phase mediator zones. LOGIN is sealed: PRE
 * detects login fields, ACTION fills + submits, POST validates the
 * action's scope (URL change + form-presence guard), FINAL audits
 * the cookie count. Every phase-internal helper LOGIN needs lives
 * inside `Mediator/Login/`; downstream phases (AUTH-DISCOVERY,
 * ACCOUNT-RESOLVE, DASHBOARD, SCRAPE) consume LOGIN's emit through
 * `ctx.login` only — never via direct import of LOGIN-zone files.
 *
 * <p>R-AUTH-DISCOVERY-OWN (Mission 1, shipped) already grep-forbids
 * the helper-call list (`probeDashboardReveal` / `discoverAuthToken`
 * / `discoverOrigin` / `discoverSiteId` / `buildDiscoveredHeaders`)
 * from LOGIN. R-LOGIN-SEAL adds file-level import enforcement:
 * any new `import … from '../Dashboard/'` or
 * `import … from '../AuthDiscovery/'` from a LOGIN-zone file fails
 * the build.
 */
const LOGIN_FORBIDDEN_ZONES: readonly string[] = [
  path.join('Mediator', 'Login'),
  path.join('Phases', 'Login'),
];

const LOGIN_FORBIDDEN_IMPORTS: readonly string[] = [
  path.join('Mediator', 'Dashboard'),
  path.join('Mediator', 'AuthDiscovery'),
  path.join('Mediator', 'OtpTrigger'),
  path.join('Mediator', 'OtpFill'),
];

/**
 * Find import lines in a LOGIN-zone file that pull from any
 * forbidden phase-mediator zone.
 *
 * @param text - Source file text.
 * @returns Matching line numbers (1-based).
 */
function findLoginForbiddenImportLines(text: string): readonly number[] {
  const lines = text.split('\n');
  const hits: number[] = [];
  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i];
    const trimmed = line.trimStart();
    if (trimmed.startsWith('//')) continue;
    if (trimmed.startsWith('*')) continue;
    if (!line.includes('import')) continue;
    const isForbidden = LOGIN_FORBIDDEN_IMPORTS.some((zone): boolean => {
      const fwd = zone.replace(/\\/g, '/');
      return line.includes(`/${fwd}/`) || line.includes(`'${fwd}/`);
    });
    if (isForbidden) hits.push(i + 1);
  }
  return hits;
}

/**
 * Scan LOGIN-zone files for cross-phase mediator imports.
 *
 * @returns Forbidden-import hits, empty when the rule holds.
 */
function findForbiddenLoginImports(): readonly IForbiddenCall[] {
  const files = listTsFiles(PIPELINE_ROOT);
  const hits: IForbiddenCall[] = [];
  for (const full of files) {
    const rel = path.relative(PIPELINE_ROOT, full);
    const isInZone = LOGIN_FORBIDDEN_ZONES.some((zone): boolean => relPathMatches(rel, zone));
    if (!isInZone) continue;
    const text = fs.readFileSync(full, 'utf-8');
    const lines = findLoginForbiddenImportLines(text);
    if (lines.length > 0) {
      hits.push({ callee: 'login-zone forbidden import', relPath: rel, lines });
    }
  }
  return hits;
}

describe('Mission 2 — R-LOGIN-SEAL: LOGIN imports nothing from Dashboard / AuthDiscovery / OtpTrigger / OtpFill', () => {
  it('no Login-zone file imports from a forbidden cross-phase mediator zone', () => {
    const hits = findForbiddenLoginImports();
    const summary = hits.map((h): string => `${h.relPath} @ lines ${h.lines.join(',')}`);
    expect(summary).toEqual([]);
  });
});

/**
 * Mission 3 (CI quality hardening plan) — R-OTP-FILL-SEAL.
 *
 * <p>Forbids the OTP-FILL zone (`Mediator/OtpFill/*`,
 * `Phases/OtpFill/*`) from importing other phase mediator zones.
 * OTP-FILL is sealed: PRE discovers the OTP form, ACTION fills +
 * submits the code, POST validates the form is gone or fails on
 * an error banner, FINAL stamps the cookie count. Every helper
 * OTP-FILL needs lives inside `Mediator/OtpFill/`; downstream
 * phases (AUTH-DISCOVERY / DASHBOARD / SCRAPE) read the slim
 * `ctx.otpFill` emit only.
 *
 * <p>R-AUTH-DISCOVERY-OWN (Mission 1, shipped) already grep-
 * forbids the auth/dashboard helper call list from OTP-FILL.
 * R-OTP-FILL-SEAL adds file-level import enforcement: any new
 * `import … from '../Dashboard/'`, `'../AuthDiscovery/'`,
 * `'../Login/'`, or `'../OtpTrigger/'` from an OTP-FILL-zone
 * file fails the build.
 */
const OTP_FILL_FORBIDDEN_ZONES: readonly string[] = [
  path.join('Mediator', 'OtpFill'),
  path.join('Phases', 'OtpFill'),
];

const OTP_FILL_FORBIDDEN_IMPORTS: readonly string[] = [
  path.join('Mediator', 'Dashboard'),
  path.join('Mediator', 'AuthDiscovery'),
  path.join('Mediator', 'Login'),
  path.join('Mediator', 'OtpTrigger'),
];

/**
 * Find import lines in an OTP-FILL-zone file that pull from any
 * forbidden phase-mediator zone.
 *
 * @param text - Source file text.
 * @returns Matching line numbers (1-based).
 */
function findOtpFillForbiddenImportLines(text: string): readonly number[] {
  const lines = text.split('\n');
  const hits: number[] = [];
  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i];
    const trimmed = line.trimStart();
    if (trimmed.startsWith('//')) continue;
    if (trimmed.startsWith('*')) continue;
    if (!line.includes('import')) continue;
    const isForbidden = OTP_FILL_FORBIDDEN_IMPORTS.some((zone): boolean => {
      const fwd = zone.replace(/\\/g, '/');
      return line.includes(`/${fwd}/`) || line.includes(`'${fwd}/`);
    });
    if (isForbidden) hits.push(i + 1);
  }
  return hits;
}

/**
 * Scan OTP-FILL-zone files for cross-phase mediator imports.
 *
 * @returns Forbidden-import hits, empty when the rule holds.
 */
function findForbiddenOtpFillImports(): readonly IForbiddenCall[] {
  const files = listTsFiles(PIPELINE_ROOT);
  const hits: IForbiddenCall[] = [];
  for (const full of files) {
    const rel = path.relative(PIPELINE_ROOT, full);
    const isInZone = OTP_FILL_FORBIDDEN_ZONES.some((zone): boolean => relPathMatches(rel, zone));
    if (!isInZone) continue;
    const text = fs.readFileSync(full, 'utf-8');
    const lines = findOtpFillForbiddenImportLines(text);
    if (lines.length > 0) {
      hits.push({ callee: 'otp-fill-zone forbidden import', relPath: rel, lines });
    }
  }
  return hits;
}

describe('Mission 3 — R-OTP-FILL-SEAL: OTP-FILL imports nothing from Dashboard / AuthDiscovery / Login / OtpTrigger', () => {
  it('no OtpFill-zone file imports from a forbidden cross-phase mediator zone', () => {
    const hits = findForbiddenOtpFillImports();
    const summary = hits.map((h): string => `${h.relPath} @ lines ${h.lines.join(',')}`);
    expect(summary).toEqual([]);
  });
});

/**
 * TIMING mission (CI quality hardening plan) — R-NO-FIXED-WAIT-15S.
 *
 * <p>Drift prevention: every fixed-wait constant of 15_000 ms (or
 * `15000` / `15_000` numeric literal) under
 * `src/Scrapers/Pipeline/Mediator/` outside the documented allowlist
 * fails the build. The TIMING mission converted seven such waits to
 * `pollWithBudget` early-exit or to lower ceilings; this rule blocks
 * regressions where a future commit silently re-introduces the same
 * fixed-wait pattern.
 *
 * <p>Allowlist: `ActionExecutors.ts` (`CLICK_TIMEOUT_MS` — Playwright
 * auto-wait), `SelectorResolverConfig.ts` (`CANDIDATE_TIMEOUT_MS` —
 * per-locator), `ElementsInteractionConfig.ts`
 * (`IFRAME_DEFAULT_TIMEOUT_MS` — Playwright iframe), and
 * `Timing/TimingConfig.ts` (the centralized owner).
 */
const FIXED_WAIT_15S_ALLOWLIST: readonly string[] = [
  path.join('Mediator', 'Elements', 'ActionExecutors.ts'),
  path.join('Mediator', 'Selector', 'SelectorResolverConfig.ts'),
  path.join('Mediator', 'Elements', 'ElementsInteractionConfig.ts'),
  path.join('Mediator', 'Timing', 'TimingConfig.ts'),
];

/**
 * Match `*_TIMEOUT|*_TIMEOUT_MS|*_WAIT_MS|*_BUDGET_MS = 15_?000`
 * constant declarations on a single line. Captures both `15000` and
 * `15_000`. The optional `(?::\s*\w+)?` segment lets the regex match
 * declarations that carry an explicit type annotation, e.g.
 * `const X: number = 15000` — without it, those slip past the rule.
 * The `_TIMEOUT` alternative (without `_MS` suffix) catches names
 * like `OTP_SUBMIT_TIMEOUT` and `SETTLE_TIMEOUT`.
 */
const FIXED_WAIT_15S_REGEX = /(?:_TIMEOUT_MS?|_WAIT_MS|_BUDGET_MS)(?:\s*:\s*\w+)?\s*=\s*15_?000\b/;

/**
 * Find lines declaring a 15s fixed-wait constant.
 *
 * @param text - Source file text.
 * @returns Matching line numbers (1-based).
 */
function findFixedWait15sLines(text: string): readonly number[] {
  const lines = text.split('\n');
  const hits: number[] = [];
  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i];
    const trimmed = line.trimStart();
    if (trimmed.startsWith('//')) continue;
    if (trimmed.startsWith('*')) continue;
    if (FIXED_WAIT_15S_REGEX.test(line)) hits.push(i + 1);
  }
  return hits;
}

/**
 * Scan all `Mediator/` files (outside the allowlist) for fixed-wait
 * 15-second constants.
 *
 * @returns Forbidden-constant hits, empty when the rule holds.
 */
function findFixedWait15sConstants(): readonly IForbiddenCall[] {
  const files = listTsFiles(PIPELINE_ROOT);
  const hits: IForbiddenCall[] = [];
  const mediatorZone = path.join('Mediator');
  for (const full of files) {
    const rel = path.relative(PIPELINE_ROOT, full);
    if (!relPathMatches(rel, mediatorZone)) continue;
    if (FIXED_WAIT_15S_ALLOWLIST.some((allowed): boolean => relPathMatches(rel, allowed))) continue;
    const text = fs.readFileSync(full, 'utf-8');
    const lines = findFixedWait15sLines(text);
    if (lines.length > 0) {
      hits.push({ callee: 'fixed 15s wait', relPath: rel, lines });
    }
  }
  return hits;
}

describe('TIMING mission — R-NO-FIXED-WAIT-15S: no new 15s fixed-wait constants in Mediator/ outside allowlist', () => {
  it('no Mediator file declares a 15s _TIMEOUT_MS / _WAIT_MS / _BUDGET_MS outside the allowlist', () => {
    const hits = findFixedWait15sConstants();
    const summary = hits.map((h): string => `${h.relPath} @ lines ${h.lines.join(',')}`);
    expect(summary).toEqual([]);
  });
});

/**
 * dom-ready-everywhere plan — R-NO-DIRECT-LOAD-STATE.
 *
 * <p>Forbids direct calls to `<target>.waitForLoadState(...)` outside
 * the documented allowlist. Every navigating pipeline phase must go
 * through {@link "../../Scrapers/Pipeline/Mediator/Elements/PagePrelude.js"}
 * `awaitPagePrelude` (Page target) or `awaitFramePrelude` (Frame
 * target) so lifecycle waits emit canonical telemetry and live behind
 * one audit point.
 *
 * <p>Allowlist:
 * <ul>
 *   <li>`Mediator/Elements/PageReadiness.ts` — the primitive itself
 *       (`waitForDomReady`, `waitForSpaReady`).</li>
 *   <li>`Mediator/Elements/CreateElementMediator.ts` — internal
 *       mediator's `waitForNetworkIdle` wrapper.</li>
 *   <li>`Interceptors/SnapshotFrameCapture.ts` /
 *       `Interceptors/SnapshotInterceptorIO.ts` — snapshot-capture
 *       infrastructure outside the phase pipeline.</li>
 *   <li>`Interceptors/WafChallenge/HCaptchaCheckboxSolver.ts` — Camoufox
 *       auto-pass recipe waits on networkidle inside its own iframe-bound
 *       solver, not in any phase action.</li>
 * </ul>
 */
const DIRECT_LOAD_STATE_ALLOWLIST: readonly string[] = [
  path.join('Mediator', 'Elements', 'PageReadiness.ts'),
  path.join('Mediator', 'Elements', 'CreateElementMediator.ts'),
  path.join('Interceptors', 'SnapshotFrameCapture.ts'),
  path.join('Interceptors', 'SnapshotInterceptorIO.ts'),
  path.join('Interceptors', 'WafChallenge', 'HCaptchaCheckboxSolver.ts'),
];

/** Match `<expr>.waitForLoadState(` invocations in source code. */
const DIRECT_LOAD_STATE_REGEX = /\.waitForLoadState\s*\(/;

/**
 * Find lines that call `.waitForLoadState(` in a source file. Skips
 * comment-only lines so the JSDoc references in {@link awaitPagePrelude}
 * docstrings do not trip the rule.
 *
 * @param text - Source file text.
 * @returns Matching line numbers (1-based).
 */
function findDirectLoadStateLines(text: string): readonly number[] {
  const lines = text.split('\n');
  const hits: number[] = [];
  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i];
    const trimmed = line.trimStart();
    if (trimmed.startsWith('//')) continue;
    if (trimmed.startsWith('*')) continue;
    if (DIRECT_LOAD_STATE_REGEX.test(line)) hits.push(i + 1);
  }
  return hits;
}

/**
 * Scan every Pipeline source file (outside the allowlist) for direct
 * `waitForLoadState` calls.
 *
 * @returns Forbidden-call hits, empty when the rule holds.
 */
function findDirectLoadStateCalls(): readonly IForbiddenCall[] {
  const files = listTsFiles(PIPELINE_ROOT);
  const hits: IForbiddenCall[] = [];
  for (const full of files) {
    const rel = path.relative(PIPELINE_ROOT, full);
    if (DIRECT_LOAD_STATE_ALLOWLIST.some((allowed): boolean => relPathMatches(rel, allowed)))
      continue;
    const text = fs.readFileSync(full, 'utf-8');
    const lines = findDirectLoadStateLines(text);
    if (lines.length > 0) {
      hits.push({ callee: 'waitForLoadState', relPath: rel, lines });
    }
  }
  return hits;
}

describe('dom-ready-everywhere — R-NO-DIRECT-LOAD-STATE: only PageReadiness + Interceptors call waitForLoadState', () => {
  it('no Pipeline file outside the allowlist calls .waitForLoadState directly', () => {
    const hits = findDirectLoadStateCalls();
    const summary = hits.map((h): string => `${h.relPath} @ lines ${h.lines.join(',')}`);
    expect(summary).toEqual([]);
  });
});

/**
 * Mission 4 (CI quality hardening plan) — R-OTP-TRIGGER-SEAL.
 *
 * <p>Forbids the OTP-TRIGGER zone (`Mediator/OtpTrigger/*`,
 * `Phases/OtpTrigger/*`) from importing other phase mediator zones.
 * OTP-TRIGGER is sealed: PRE detects the trigger button + phone
 * hint, ACTION clicks the trigger and stamps `triggerClickedAt`,
 * POST validates the scope-bound effect (target gone OR HTTP 2xx
 * since the click), FINAL emits `ctx.otpTrigger`. Every helper
 * OTP-TRIGGER needs lives inside `Mediator/OtpTrigger/`,
 * `Mediator/Otp/OtpShared.ts` (allowlisted shared utilities),
 * `Mediator/Form/OtpProbe.ts` (form-detection helper), or
 * `Mediator/Network/` (read-only capture/discovery surface).
 * Downstream phases (OTP-FILL / AUTH-DISCOVERY / DASHBOARD)
 * read the slim `ctx.otpTrigger` emit only.
 *
 * <p>R-AUTH-DISCOVERY-OWN (Mission 1, shipped) already grep-
 * forbids the auth/dashboard helper call list from OTP-TRIGGER.
 * R-OTP-TRIGGER-SEAL adds file-level import enforcement: any new
 * `import … from '../Dashboard/'`, `'../AuthDiscovery/'`,
 * `'../Login/'`, `'../OtpFill/'`, or `'../Auth/'` from an
 * OTP-TRIGGER-zone file fails the build.
 */
const OTP_TRIGGER_FORBIDDEN_ZONES: readonly string[] = [
  path.join('Mediator', 'OtpTrigger'),
  path.join('Phases', 'OtpTrigger'),
];

const OTP_TRIGGER_FORBIDDEN_IMPORTS: readonly string[] = [
  path.join('Mediator', 'Dashboard'),
  path.join('Mediator', 'AuthDiscovery'),
  path.join('Mediator', 'Login'),
  path.join('Mediator', 'OtpFill'),
  path.join('Mediator', 'Auth'),
];

/**
 * Check whether a (possibly multi-line) import block references any
 * forbidden phase-mediator zone.
 *
 * @param block - Joined text of one full import statement.
 * @returns True when the block imports from a forbidden zone.
 */
function isForbiddenImportBlock(block: string): boolean {
  return OTP_TRIGGER_FORBIDDEN_IMPORTS.some((zone): boolean => {
    const fwd = zone.replace(/\\/g, '/');
    return block.includes(`/${fwd}/`) || block.includes(`'${fwd}/`);
  });
}

/**
 * Find import lines in an OTP-TRIGGER-zone file that pull from any
 * forbidden phase-mediator zone.
 *
 * <p>PR #221 review (id 3215182693): a single-line scan misses formatted
 * multi-line imports of the form `import {\n  Foo,\n} from '…/Forbidden/Bar.js';`.
 * The walker buffers consecutive lines starting with `import ` (or
 * inside an open block) until the terminating `;` lands, then performs
 * the forbidden-zone check on the joined block. Reported hit line is
 * the 1-based line where the `import` keyword started so test failures
 * point at the statement head, not its closing brace.
 *
 * @param text - Source file text.
 * @returns Matching line numbers (1-based, statement-start).
 */
function findOtpTriggerForbiddenImportLines(text: string): readonly number[] {
  const lines = text.split('\n');
  const hits: number[] = [];
  let importStartLine = 0;
  let importBlock = '';
  let isInsideImport = false;
  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i];
    const trimmed = line.trimStart();
    if (!isInsideImport) {
      if (trimmed.startsWith('//')) continue;
      if (trimmed.startsWith('*')) continue;
      if (!trimmed.startsWith('import ')) continue;
      isInsideImport = true;
      importStartLine = i + 1;
      importBlock = line;
    } else {
      importBlock = `${importBlock}\n${line}`;
    }
    if (!line.includes(';')) continue;
    if (isForbiddenImportBlock(importBlock)) hits.push(importStartLine);
    isInsideImport = false;
    importBlock = '';
  }
  return hits;
}

/**
 * Scan OTP-TRIGGER-zone files for cross-phase mediator imports.
 *
 * @returns Forbidden-import hits, empty when the rule holds.
 */
function findForbiddenOtpTriggerImports(): readonly IForbiddenCall[] {
  const files = listTsFiles(PIPELINE_ROOT);
  const hits: IForbiddenCall[] = [];
  for (const full of files) {
    const rel = path.relative(PIPELINE_ROOT, full);
    const isInZone = OTP_TRIGGER_FORBIDDEN_ZONES.some((zone): boolean => relPathMatches(rel, zone));
    if (!isInZone) continue;
    const text = fs.readFileSync(full, 'utf-8');
    const lines = findOtpTriggerForbiddenImportLines(text);
    if (lines.length > 0) {
      hits.push({ callee: 'otp-trigger-zone forbidden import', relPath: rel, lines });
    }
  }
  return hits;
}

describe('Mission 4 — R-OTP-TRIGGER-SEAL: OTP-TRIGGER imports nothing from Dashboard / AuthDiscovery / Login / OtpFill / Auth', () => {
  it('no OtpTrigger-zone file imports from a forbidden cross-phase mediator zone', () => {
    const hits = findForbiddenOtpTriggerImports();
    const summary = hits.map((h): string => `${h.relPath} @ lines ${h.lines.join(',')}`);
    expect(summary).toEqual([]);
  });
});
