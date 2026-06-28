/**
 * Yahav — contract extraction binding (Mode A/B value proof).
 *
 * <p>Mode A (static HTML) and Mode B (simulator) prove the committed
 * Yahav fixtures match the DOM + manifest contract, but stop at the
 * transport layer. This suite closes the loop: it drives the SAME
 * committed `account-transactions.json` response fixture through the
 * REAL extraction code so the WK transaction/balance mappings are
 * proven end-to-end against the on-disk fixture, not a hand-built
 * object.
 *
 * <ul>
 *   <li><b>Transactions (SCRAPE)</b> — `extractTransactions` maps every
 *   `transactions[]` row via the generic WK dictionary
 *   (`transactionDate` → date, `referenceNumber` → identifier). Both
 *   rows are collected in the account's single fetch window.</li>
 *   <li><b>Balance (BALANCE-RESOLVE)</b> — `runBalanceExtractor` reads
 *   the folded `currentBalance`, and `buildCapturedFromPool` seeds it
 *   under {@link BULK_KEY} — the exact value/path BALANCE-RESOLVE
 *   consumes.</li>
 * </ul>
 *
 * <p>Yahav is account-kind (`balanceKind: 'account'`); its single
 * checking endpoint degenerates the N accounts × M windows matrix to
 * 1×1. Fixture values are synthetic + PII-safe (zero amounts, redacted
 * descriptions, short non-ID reference numbers).
 */

import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import ScraperError from '../../../../../Scrapers/Base/ScraperError.js';
import { runBalanceExtractor } from '../../../../../Scrapers/Pipeline/Mediator/BalanceResolve/BalanceExtractor.js';
import { BULK_KEY } from '../../../../../Scrapers/Pipeline/Mediator/BalanceResolve/BalanceFetchPlanner.js';
import { buildCapturedFromPool } from '../../../../../Scrapers/Pipeline/Mediator/BalanceResolve/BalanceResolveActions.Captured.js';
import type { IDiscoveredEndpoint } from '../../../../../Scrapers/Pipeline/Mediator/Network/Types/Endpoint.js';
import type { ApiRecord } from '../../../../../Scrapers/Pipeline/Mediator/Scrape/AutoMapperFacade/AutoMapperTypes.js';
import { extractTransactions } from '../../../../../Scrapers/Pipeline/Mediator/Scrape/ContainerPicker/ContainerPicker.js';

const HERE_URL = fileURLToPath(import.meta.url);
const HERE = dirname(HERE_URL);
const REPO_ROOT = join(HERE, '..', '..', '..', '..', '..', '..');
const FIXTURE = join(
  REPO_ROOT,
  'src',
  'Tests',
  'Integration',
  'fixtures',
  'banks',
  'yahav',
  'responses',
  'account-transactions.json',
);

/** Both synthetic transaction rows are expected to survive extraction. */
const EXPECTED_TXN_COUNT = 2;
/** Folded `currentBalance` in the fixture (synthetic zero). */
const EXPECTED_BALANCE = 0;
/** Synthetic reference numbers (short — not Israeli-ID shaped). */
const REF_FIRST = 1000001;
const REF_SECOND = 1000002;

/**
 * Load the committed Yahav transactions response fixture.
 * @returns Parsed `{ transactions, currentBalance }` body.
 */
function loadBody(): ApiRecord {
  const raw = readFileSync(FIXTURE, 'utf8');
  return JSON.parse(raw) as ApiRecord;
}

/**
 * Build a one-entry captured endpoint pool holding the given body.
 * @param body - Inner response body.
 * @returns Captured endpoint pool.
 */
function poolOf(body: unknown): readonly IDiscoveredEndpoint[] {
  const ep = { responseBody: body } as unknown as IDiscoveredEndpoint;
  return [ep];
}

describe('Yahav contract extraction — txns + balance on the committed fixture', () => {
  it('extracts every transactions[] row (collect-all in the single window)', () => {
    const body = loadBody();
    const txns = extractTransactions(body);
    expect(txns).toHaveLength(EXPECTED_TXN_COUNT);
    const ids = txns.map((t): unknown => t.identifier);
    expect(ids).toContain(REF_FIRST);
    expect(ids).toContain(REF_SECOND);
  });

  it('resolves the folded currentBalance (the value BALANCE-RESOLVE reads)', () => {
    const body = loadBody();
    const balance = runBalanceExtractor(body);
    expect(balance).toBe(EXPECTED_BALANCE);
  });

  it('seeds the captured-pool balance under BULK_KEY', () => {
    const body = loadBody();
    const pool = poolOf(body);
    const captured = buildCapturedFromPool(pool);
    const bulk = captured.get(BULK_KEY);
    if (bulk === undefined) throw new ScraperError('captured pool must seed the balance body');
    const balance = runBalanceExtractor(bulk);
    expect(balance).toBe(EXPECTED_BALANCE);
  });
});
