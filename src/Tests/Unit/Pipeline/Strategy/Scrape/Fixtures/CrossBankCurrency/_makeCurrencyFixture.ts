/**
 * Factory for loading the synthetic DigitalV3 foreign-currency fixtures.
 *
 * <p>Each bank has one fixture under `./<bank>/<file>.json` whose key
 * structure mirrors a real DigitalV3 `GetTransactionsList` response
 * (statement vouchers, out-of-statement vouchers, null `approvals`)
 * while every value is invented. Each voucher carries the numeric
 * `originalCurrency` enum next to the ISO-4217 `originalCurrencyIso`
 * string — the shape behind issue #614.
 *
 * <p>Kept separate from the Phase G dedup fixtures so adding currency
 * coverage never shifts the pinned dedup baselines; file reading and
 * the empty-captures guard are shared via `readFixtureEnvelope`.
 */

import * as path from 'node:path';
import { fileURLToPath } from 'node:url';

import { type ILoadedFixture, readFixtureEnvelope } from '../_readFixtureEnvelope.js';

const FIXTURE_FILE_PATH = fileURLToPath(import.meta.url);
const FIXTURES_DIR = path.dirname(FIXTURE_FILE_PATH);
const FIXTURE_FILENAME = 'GetTransactionsList_foreignCurrency.json';

/** DigitalV3 banks with a foreign-currency fixture under this directory. */
export const CURRENCY_BANKS = ['amex', 'isracard'] as const;

export type CurrencyBank = (typeof CURRENCY_BANKS)[number];

/** Currency projection of one expected mapped transaction. */
export interface IExpectedCurrencyTxn {
  readonly originalAmount: number;
  readonly originalCurrency: string;
  readonly chargedCurrency: string;
}

/** The fixture's `_fixture` metadata block. */
export interface ICurrencyFixtureMeta {
  readonly bank: CurrencyBank;
  readonly shape: string;
  readonly expectedMethod: 'POST';
  readonly expectedRecords: number;
  readonly expectedTxns: readonly IExpectedCurrencyTxn[];
  readonly rationale: string;
}

/** Full loaded fixture shape. */
export type ICurrencyFixture = ILoadedFixture<ICurrencyFixtureMeta>;

/**
 * Load one bank's synthetic foreign-currency fixture.
 *
 * @param bank - Bank name (CURRENCY_BANKS).
 * @returns Parsed fixture with metadata and its first capture entry.
 * @throws {ScraperError} When the fixture's `captures` array is empty.
 */
export function makeCurrencyFixture(bank: CurrencyBank): ICurrencyFixture {
  const filePath = path.join(FIXTURES_DIR, bank, FIXTURE_FILENAME);
  return readFixtureEnvelope<ICurrencyFixtureMeta>(filePath, 'CURRENCY_FIXTURE_EMPTY_CAPTURES');
}
