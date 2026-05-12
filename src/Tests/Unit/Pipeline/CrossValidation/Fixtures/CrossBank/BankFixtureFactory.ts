/**
 * Cross-bank fixture factory — loads the PII-redacted captures shipped
 * under `CrossBank/<bank>/` and shapes them into the typed
 * {@link IBankFixture} used by the Phase-E factory tests.
 *
 * <p>Fixtures originate from real local scrape traces under
 * `C:/tmp/runs/pipeline/<bank>/`. The one-off redaction tool at
 * `c:/tmp/redact-fixtures.cjs` substitutes every PII token
 * (card last4, account numbers, Hebrew merchant strings, GUIDs) with
 * deterministic fakes (`FAKE_C01`, `FAKE_HEB_NN`, …) so the
 * fixtures shipped to git carry zero customer-identifiable content.
 *
 * <p>Phase-E commit 1 builds the factory and the failing-test contract.
 * Commit 4 ships the recognisers that flip the tests RED → GREEN.
 */

import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import type { IPreNavCapture } from '../../../../../../Scrapers/Pipeline/Mediator/AccountResolve/BillingCycleCatalogDetector.js';

const FACTORY_FILE_URL = import.meta.url;
const FACTORY_FILE_PATH = fileURLToPath(FACTORY_FILE_URL);
const FIXTURES_DIR = dirname(FACTORY_FILE_PATH);

/** Cycling-card banks whose pre-nav buffer carries a cycle catalog. */
const CYCLING_BANKS = ['isracard', 'max', 'visacal'] as const;

/** Current-account banks whose pre-nav buffer has no cycle catalog. */
const NON_CYCLING_BANKS = ['discount', 'hapoalim'] as const;

type CyclingBank = (typeof CYCLING_BANKS)[number];
type NonCyclingBank = (typeof NON_CYCLING_BANKS)[number];
type BankName = CyclingBank | NonCyclingBank;

/**
 * Per-bank fixture bundle consumed by the Phase-E factory tests.
 *
 * <p>{@link prenavBuffer} mirrors the runtime contract of
 * `MediatorNetwork.getPreNavCaptures`: an ordered list of
 * `{url, responseBody}` records captured during the LOGIN phase.
 *
 * <p>{@link isCyclingExpected} is `true` when the bank exposes a
 * billing-cycle catalog. The factory tests assert against this flag
 * symmetrically: cycling banks must produce a typed catalog,
 * non-cycling banks must produce {@link none}.
 */
interface IBankFixture {
  readonly bank: BankName;
  readonly prenavBuffer: readonly IPreNavCapture[];
  readonly isCyclingExpected: boolean;
}

/**
 * Strip the leading `//` comment header our captures prefix.
 *
 * @param raw - Raw fixture file contents (UTF-8).
 * @returns The body slice after the comment header.
 */
function stripCommentHeader(raw: string): string {
  const lines = raw.split('\n');
  let start = 0;
  while (start < lines.length && lines[start].startsWith('//')) start += 1;
  return lines.slice(start).join('\n');
}

/**
 * Read one fixture file and parse its JSON body.
 *
 * @param filePath - Absolute path to the fixture JSON file.
 * @returns The parsed body as an unknown value.
 */
function readFixtureBody(filePath: string): unknown {
  const raw = readFileSync(filePath, 'utf8');
  const body = stripCommentHeader(raw);
  return JSON.parse(body) as unknown;
}

/** Regex for the `// METHOD <url>` header prefix our captures use. */
const HEADER_METHOD_RE = /^\/\/\s*(?:POST|GET|PUT|DELETE)\s*/;

/**
 * Read the URL recorded in the leading `// POST <url>` header.
 *
 * @param filePath - Absolute path to the fixture JSON file.
 * @returns The URL string, or an empty string when the header is absent.
 */
function readFixtureUrl(filePath: string): string {
  const raw = readFileSync(filePath, 'utf8');
  const firstLine = raw.split('\n')[0] ?? '';
  const stripped = firstLine.replace(HEADER_METHOD_RE, '');
  return stripped.trim();
}

/**
 * Build a pre-nav capture record from one fixture file.
 *
 * @param bank - Bank fixture directory name.
 * @param fileName - Fixture file name within the bank's directory.
 * @returns Captured `{url, responseBody}` record.
 */
function loadCapture(bank: BankName, fileName: string): IPreNavCapture {
  const filePath = join(FIXTURES_DIR, bank, fileName);
  const url = readFixtureUrl(filePath);
  const responseBody = readFixtureBody(filePath);
  return { url, responseBody };
}

/**
 * Discover all fixture filenames available for a bank.
 *
 * @param bank - Bank fixture directory name.
 * @returns Names of `.json` files inside the bank's fixture directory.
 */
function listBankFixtures(bank: BankName): readonly string[] {
  const dir = join(FIXTURES_DIR, bank);
  const all = readdirSync(dir);
  return all.filter((n): boolean => n.endsWith('.json'));
}

/** Set membership lookup used by {@link makeBankFixture} to set the expectation flag. */
const CYCLING_BANK_SET: ReadonlySet<BankName> = new Set<BankName>(CYCLING_BANKS);

/**
 * Load every fixture file for the given bank as an ordered pre-nav
 * buffer.
 *
 * @param bank - One of the supported bank names.
 * @returns Bank fixture bundle including the assembled buffer and
 *   the {@link isCyclingExpected} expectation flag.
 */
function makeBankFixture(bank: BankName): IBankFixture {
  const fileNames = listBankFixtures(bank);
  const buffer = fileNames.map((n): IPreNavCapture => loadCapture(bank, n));
  const isCyclingExpected = CYCLING_BANK_SET.has(bank);
  return { bank, prenavBuffer: buffer, isCyclingExpected };
}

export type { BankName, CyclingBank, IBankFixture, NonCyclingBank };
export { CYCLING_BANKS, makeBankFixture, NON_CYCLING_BANKS };
