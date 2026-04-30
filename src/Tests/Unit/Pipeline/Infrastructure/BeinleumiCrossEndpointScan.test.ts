/**
 * Fixture-based test: load 2 minimal REDACTED responses that represent the
 * two endpoints which actually carry Beinleumi balance + accountNumber:
 *   - /MatafAngularRestApiService/rest/utils/leveragedAccount → accountNumber
 *   - /appsng/bff-balancetransactions/api/v1/transactions/balances/105 → balance
 * Values are placeholders — real captures are obtained via DUMP_NETWORK_DIR
 * during local E2E runs and never committed.
 * A failure here means the scanner logic itself is wrong.
 *
 * Fixture source:
 *   fixtures/beinleumi-dump/NNNN-<shortname>.json  (pure JSON)
 * The `__url` / `__note` fields carry provenance; the scanners ignore them.
 */
import * as fs from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';

import type {
  IDiscoveredEndpoint,
  INetworkDiscovery,
} from '../../../../Scrapers/Pipeline/Mediator/Network/NetworkDiscoveryTypes.js';
import { resolveBalanceFromRecords } from '../../../../Scrapers/Pipeline/Strategy/Scrape/Account/BalanceExtractor.js';
import { resolveDisplayIdFromCapturedEndpoints } from '../../../../Scrapers/Pipeline/Strategy/Scrape/Account/ScrapeIdExtraction.js';
import { isOk } from '../../../../Scrapers/Pipeline/Types/Procedure.js';

type JsonValue = unknown;
type JsonObject = Record<string, JsonValue>;

/** Loaded response captured from a real E2E dump file. */
interface ILoadedResponse {
  readonly url: string;
  readonly body: JsonValue;
}

/**
 * Split a dump file into its leading `//` comment lines and JSON body.
 * Supports zero-or-more comment lines — auto-captured dumps have one,
 * hand-redacted fixtures may have several.
 * @param raw - Full file contents.
 * @returns Tuple of [first URL comment, JSON body text].
 */
function splitCommentsAndBody(raw: string): readonly [string, string] {
  const lines = raw.split(/\r?\n/);
  const firstComment = lines[0] ?? '';
  let idx = 0;
  while (idx < lines.length && lines[idx].trimStart().startsWith('//')) idx += 1;
  const bodyText = lines.slice(idx).join('\n');
  return [firstComment, bodyText];
}

/**
 * Load a single dump file — leading `//` lines then JSON.
 * @param absPath - Absolute path to the dump file.
 * @returns Parsed loaded response.
 */
function loadDumpFile(absPath: string): ILoadedResponse {
  const raw = fs.readFileSync(absPath, 'utf8');
  const [header, bodyText] = splitCommentsAndBody(raw);
  const trimmedHeader = header.trim();
  const urlMatch = /^\/\/\s*\S+\s*(\S+)/.exec(trimmedHeader);
  const url = urlMatch ? urlMatch[1] : '';
  return { url, body: JSON.parse(bodyText) as JsonValue };
}

/**
 * Resolve fixture directory via import.meta.url (ESM-safe).
 * @returns Absolute path to the dump fixtures folder.
 */
function fixtureDir(): string {
  const fileUrl = import.meta.url;
  const thisFile = fileURLToPath(fileUrl);
  const here = path.dirname(thisFile);
  return path.join(here, 'fixtures', 'beinleumi-dump');
}

/**
 * Load all fixture files in capture order (sorted by filename prefix).
 * @returns Captured responses in order.
 */
function loadAllDumps(): readonly ILoadedResponse[] {
  const dir = fixtureDir();
  const names = fs.readdirSync(dir);
  const sorted = names.sort((a, b): number => a.localeCompare(b));
  return sorted.map((n): ILoadedResponse => {
    const filePath = path.join(dir, n);
    return loadDumpFile(filePath);
  });
}

/**
 * Adapt loaded responses into a minimal IDiscoveredEndpoint array.
 * @param dumps - Loaded responses.
 * @returns Endpoint list with only the fields the scanners read.
 */
function adaptEndpoints(dumps: readonly ILoadedResponse[]): readonly IDiscoveredEndpoint[] {
  return dumps.map(
    (d): IDiscoveredEndpoint => ({
      url: d.url,
      method: 'GET',
      postData: '',
      contentType: 'application/json',
      requestHeaders: {},
      responseHeaders: {},
      responseBody: d.body,
      timestamp: 0,
    }),
  );
}

/**
 * Endpoint getter closure — returned from makeNetworkStub.
 * @param endpoints - Endpoints to expose.
 * @returns Getter function matching INetworkDiscovery.getAllEndpoints.
 */
function buildGetter(
  endpoints: readonly IDiscoveredEndpoint[],
): () => readonly IDiscoveredEndpoint[] {
  return (): readonly IDiscoveredEndpoint[] => endpoints;
}

/**
 * Minimal INetworkDiscovery — only getAllEndpoints is implemented.
 * The scanners under test only read that one method.
 * @param endpoints - Endpoints to expose.
 * @returns Partial network discovery cast to INetworkDiscovery.
 */
function makeNetworkStub(endpoints: readonly IDiscoveredEndpoint[]): INetworkDiscovery {
  const stub = { getAllEndpoints: buildGetter(endpoints) };
  return stub as unknown as INetworkDiscovery;
}

/**
 * Pull the expected account from the redacted leveragedAccount fixture.
 * Reading the expectation from the fixture means any future redaction
 * change auto-propagates — no test edit needed.
 * @param dumps - Loaded fixtures.
 * @returns The account string carried by the leveragedAccount fixture.
 */
function expectedAccountFromFixture(dumps: readonly ILoadedResponse[]): string {
  const hit = dumps
    .map((d): JsonValue => d.body)
    .filter((v): v is JsonObject => v !== null && typeof v === 'object' && !Array.isArray(v))
    .map((body): unknown => body.account)
    .find((v): v is string => typeof v === 'string');
  return hit ?? '';
}

/**
 * Pull the expected balance from the redacted balances/105 fixture.
 * @param dumps - Loaded fixtures.
 * @returns The currentBalance number carried by the balances/105 fixture.
 */
function expectedBalanceFromFixture(dumps: readonly ILoadedResponse[]): number {
  const hit = dumps
    .map((d): JsonValue => d.body)
    .filter((v): v is JsonObject => v !== null && typeof v === 'object' && !Array.isArray(v))
    .map((body): unknown => body.currentBalance)
    .find((v): v is number => typeof v === 'number');
  return hit ?? 0;
}

describe('Beinleumi redacted-fixture cross-endpoint scan', () => {
  const dumps = loadAllDumps();
  const expectedBalance = expectedBalanceFromFixture(dumps);
  const expectedAccount = expectedAccountFromFixture(dumps);

  it('fixture loaded 2 redacted endpoints (balance + accountNumber)', () => {
    expect(dumps.length).toBe(2);
  });

  /**
   * Adapter: load response body from a wrapper.
   * @param d - Loaded response wrapper.
   * @returns The parsed body as JsonValue.
   */
  const asBody = (d: ILoadedResponse): JsonValue => d.body;

  /**
   * Type guard: value is a plain record (non-null, non-array object).
   * @param v - Value to test.
   * @returns True if v is a record.
   */
  const isPlainObj = (v: JsonValue): v is JsonObject =>
    v !== null && typeof v === 'object' && !Array.isArray(v);

  it('balance scanner finds the balance value carried by the fixture', () => {
    const allBodies = dumps.map(asBody);
    const plainBodies = allBodies.filter(isPlainObj);
    const result = resolveBalanceFromRecords(plainBodies);
    const isSuccess = isOk(result);
    expect(isSuccess).toBe(true);
    if (isOk(result)) expect(result.value).toBe(expectedBalance);
  });

  it('accountNumber scanner finds the account value carried by the fixture', () => {
    const endpoints = adaptEndpoints(dumps);
    const network = makeNetworkStub(endpoints);
    const result = resolveDisplayIdFromCapturedEndpoints(network);
    const isSuccess = isOk(result);
    expect(isSuccess).toBe(true);
    if (isOk(result)) expect(result.value).toBe(expectedAccount);
  });
});
