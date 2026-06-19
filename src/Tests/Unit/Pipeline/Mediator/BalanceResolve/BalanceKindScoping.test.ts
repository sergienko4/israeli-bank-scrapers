/**
 * R1 hardening — `BalanceKind` family-scoping fire-tests.
 *
 * Proves the two balance paths resolve the bank's DECLARED family and
 * never bleed across families:
 *  - PRIMARY (BALANCE-RESOLVE): `runBalanceExtractorWith` scoped by
 *    {@link scopedResolveBalanceAliases}.
 *  - LEGACY (SCRAPE fieldMap): `resolveFieldMapOrEmpty` scoped by
 *    {@link scopedTxnBalanceAliases}.
 *
 * Each discrimination test FIRES (fails) against the pre-fix unscoped
 * code (which always resolved the account-first `balance` alias) and
 * passes only once scoping restricts the scan to the declared family.
 *
 * Also guards the invariants the design relies on: the two families
 * partition the alias surface, and every migrated bank declares a kind.
 */

import { CompanyTypes } from '../../../../../Definitions.js';
import {
  runBalanceExtractor,
  runBalanceExtractorWith,
} from '../../../../../Scrapers/Pipeline/Mediator/BalanceResolve/BalanceExtractor.js';
import resolveFieldMapOrEmpty, {
  scopedTxnBalanceAliases,
} from '../../../../../Scrapers/Pipeline/Mediator/Scrape/EndpointResolver/EndpointFieldMap.js';
import {
  ACCOUNT_BALANCE_FAMILY,
  ACCOUNT_KIND,
  type BalanceKind,
  CARD_CYCLE_BALANCE_FAMILY,
  CARD_CYCLE_KIND,
} from '../../../../../Scrapers/Pipeline/Registry/WK/BalanceKind.js';
import {
  PIPELINE_BALANCE_ALIASES,
  scopedResolveBalanceAliases,
} from '../../../../../Scrapers/Pipeline/Registry/WK/BalanceResolveWK.js';
import { PIPELINE_WELL_KNOWN_TXN_FIELDS as WK } from '../../../../../Scrapers/Pipeline/Registry/WK/ScrapeWK.js';
import type { JsonValue } from '../../../../../Scrapers/Pipeline/Types/JsonValue.js';

/** Account value carried by the discriminating fixtures. */
const ACCOUNT_VALUE = 999;

/** Card-cycle debit value carried by the discriminating fixtures. */
const CARD_CYCLE_VALUE = 1800;

/**
 * Record carrying BOTH an account-ish (`balance`) and a card-cycle
 * (`nextTotalDebit`) field. Without scoping the account-first lists
 * always win `balance`; scoping flips a card bank onto its debit.
 */
const MIXED_BODY: JsonValue = { balance: ACCOUNT_VALUE, nextTotalDebit: CARD_CYCLE_VALUE };

/** Banks whose balance is a credit-card billing-cycle debit total. */
const EXPECTED_CARD_CYCLE_BANKS: readonly CompanyTypes[] = [
  CompanyTypes.VisaCal,
  CompanyTypes.Amex,
  CompanyTypes.Max,
  CompanyTypes.Isracard,
];

describe('BalanceKind — family classification invariants', () => {
  const unionAliases = [...new Set([...PIPELINE_BALANCE_ALIASES, ...WK.balance])];

  it('declares exactly 9 account + 7 card-cycle aliases', () => {
    expect(ACCOUNT_BALANCE_FAMILY.size).toBe(9);
    expect(CARD_CYCLE_BALANCE_FAMILY.size).toBe(7);
  });

  it.each(unionAliases)('classifies %s into exactly one family', alias => {
    const isInAccount = ACCOUNT_BALANCE_FAMILY.has(alias);
    const isInCardCycle = CARD_CYCLE_BALANCE_FAMILY.has(alias);
    expect(Number(isInAccount) + Number(isInCardCycle)).toBe(1);
  });
});

describe('PRIMARY balance extractor — BalanceKind scoping', () => {
  it('resolves the card-cycle debit when scoped to card-cycle', () => {
    const aliases = scopedResolveBalanceAliases(CARD_CYCLE_KIND);
    const resolved = runBalanceExtractorWith(MIXED_BODY, aliases);
    expect(resolved).toBe(CARD_CYCLE_VALUE);
  });

  it('resolves the running balance when scoped to account', () => {
    const aliases = scopedResolveBalanceAliases(ACCOUNT_KIND);
    const resolved = runBalanceExtractorWith(MIXED_BODY, aliases);
    expect(resolved).toBe(ACCOUNT_VALUE);
  });

  it('documents the latent bleed of the unscoped entry point', () => {
    const resolved = runBalanceExtractor(MIXED_BODY);
    expect(resolved).toBe(ACCOUNT_VALUE);
  });
});

describe('LEGACY fieldMap balance — BalanceKind scoping', () => {
  const sample = { OperationDate: '2026-01-01', OperationAmount: 10, ...MIXED_BODY };

  it('selects the card-cycle alias when scoped to card-cycle', () => {
    const aliases = scopedTxnBalanceAliases(CARD_CYCLE_KIND);
    expect(resolveFieldMapOrEmpty([sample], aliases).balance).toBe('nextTotalDebit');
  });

  it('selects the account alias when scoped to account', () => {
    const aliases = scopedTxnBalanceAliases(ACCOUNT_KIND);
    expect(resolveFieldMapOrEmpty([sample], aliases).balance).toBe('balance');
  });

  it('falls back to the account-first alias when unscoped', () => {
    expect(resolveFieldMapOrEmpty([sample]).balance).toBe('balance');
  });
});

describe('Per-bank balanceKind declaration', () => {
  /**
   * Dynamically loads the bank-config registry entries.
   *
   * Pipeline tests may not statically import `Registry/Config`; the
   * dynamic form is the sanctioned escape for registry invariants.
   *
   * @returns every company-id → config entry (all non-nullish).
   */
  async function loadEntries(): Promise<[string, { readonly balanceKind: BalanceKind }][]> {
    const mod =
      await import('../../../../../Scrapers/Pipeline/Registry/Config/PipelineBankConfig.js');
    return Object.entries(mod.PIPELINE_BANK_CONFIG);
  }

  it('registers all 14 migrated banks', async () => {
    const entries = await loadEntries();
    expect(entries).toHaveLength(14);
  });

  it('declares a valid balanceKind for every bank', async () => {
    const entries = await loadEntries();
    const validKinds: BalanceKind[] = [ACCOUNT_KIND, CARD_CYCLE_KIND];
    const isEveryKindValid = entries.every(entry => validKinds.includes(entry[1].balanceKind));
    expect(isEveryKindValid).toBe(true);
  });

  it('marks exactly the four card-cycle banks', async () => {
    const entries = await loadEntries();
    const cardCycleBanks = entries
      .filter(entry => entry[1].balanceKind === CARD_CYCLE_KIND)
      .map(entry => entry[0]);
    const got = [...cardCycleBanks].sort();
    const want = [...EXPECTED_CARD_CYCLE_BANKS].sort();
    expect(got).toEqual(want);
  });
});
