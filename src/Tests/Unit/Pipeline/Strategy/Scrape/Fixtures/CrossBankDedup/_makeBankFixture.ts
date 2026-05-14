/**
 * Factory for loading PII-redacted Phase G cross-bank dedup fixtures.
 *
 * <p>Each bank has one fixture file under `./<bank>/<file>.json` capturing
 * the production txn-list response shape (clones of real captures with
 * Hebrew descriptions, customer names, and account numbers redacted).
 * The fixture's `_fixture` block declares the expected dedup-key tuple
 * and expected unique-count baseline — both regression-pinned in the
 * factory-test assertions.
 *
 * <p>Per `testing-organization-guidlines.md`: single source of truth for
 * fixture loading; tests consume via `makeBankFixture(bank)` builder.
 */

import * as fs from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';

const FIXTURE_FILE_PATH = fileURLToPath(import.meta.url);
const FIXTURES_DIR = path.dirname(FIXTURE_FILE_PATH);

/** Banks with a Phase G fixture committed under this directory. */
export const PHASE_G_BANKS = [
  'beinleumi',
  'hapoalim',
  'isracard',
  'amex',
  'visacal',
  'max',
  'discount',
] as const;

export type PhaseGBank = (typeof PHASE_G_BANKS)[number];

/**
 * Each fixture's `_fixture` metadata block — captures the test
 * baseline that GREEN-asserts after Phase G ships.
 */
export interface IPhaseGFixtureMeta {
  readonly bank: PhaseGBank;
  readonly shape: string;
  readonly expectedMethod: 'POST' | 'GET';
  readonly expectedRecords: number;
  readonly expectedDedupKeyFields: readonly string[];
  readonly expectedUniqueCount: number;
  /** Earliest YYYYMMDD window-start that covers every captured txn date. */
  readonly startDate: string;
  readonly rationale: string;
}

/** One capture entry inside the fixture's `captures` array. */
export interface IPhaseGFixtureCapture {
  readonly url: string;
  readonly method: 'POST' | 'GET';
  readonly captureIndex: number;
  readonly postData?: string;
  readonly responseBody: Record<string, unknown>;
}

/** Full loaded fixture shape. */
export interface IPhaseGFixture {
  readonly meta: IPhaseGFixtureMeta;
  readonly capture: IPhaseGFixtureCapture;
}

/** Hard-coded per-bank filename lookup — single source of truth. */
const FIXTURE_FILENAME: Readonly<Record<PhaseGBank, string>> = {
  beinleumi: 'transactions_list_full.json',
  hapoalim: 'transactions_current_account.json',
  isracard: 'GetTransactionsList_card5290.json',
  amex: 'GetTransactionsList_card5290.json',
  visacal: 'getCardTransactionsDetails_card1.json',
  max: 'getTransactionsAndGraphs_full.json',
  discount: 'lastTransactions_homePage.json',
};

interface IRawFixture {
  readonly _fixture: IPhaseGFixtureMeta;
  readonly captures: readonly IPhaseGFixtureCapture[];
}

/**
 * Load and validate one bank's Phase G fixture.
 * @param bank - Bank name (PHASE_G_BANKS).
 * @returns Parsed fixture with metadata + first capture entry.
 */
export function makeBankFixture(bank: PhaseGBank): IPhaseGFixture {
  const filePath = path.join(FIXTURES_DIR, bank, FIXTURE_FILENAME[bank]);
  const raw = fs.readFileSync(filePath, 'utf8');
  const parsed: IRawFixture = JSON.parse(raw) as IRawFixture;
  return { meta: parsed._fixture, capture: parsed.captures[0] };
}
