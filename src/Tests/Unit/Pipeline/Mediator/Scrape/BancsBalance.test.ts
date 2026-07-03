/**
 * BaNCS (Yahav) balance selection — synthetic, PII-free tests.
 *
 * <p>Proves {@link selectBancsBalance} picks the `BalType.CDE === CURRENT`
 * amount out of a TCS BaNCS `BalanceList[]` (decision C), and that it is
 * a provable no-op (default-deny `false`) for every non-BaNCS body — so
 * {@link runBalanceExtractor}'s generic flat-alias BFS stays unchanged
 * for the other pipeline banks.
 *
 * Every value is fabricated — no real account balance appears.
 */

import { runBalanceExtractor } from '../../../../../Scrapers/Pipeline/Mediator/BalanceResolve/BalanceExtractor.js';
import selectBancsBalance from '../../../../../Scrapers/Pipeline/Mediator/Scrape/Bancs/BancsBalance.js';
import type { JsonValue } from '../../../../../Scrapers/Pipeline/Types/JsonValue.js';

/**
 * Build one BaNCS `BalanceList[]` entry (BalType.CDE + CurrAmt magnitude).
 * @param cde - BalType code (CURRENT / AVAILABLE / DEBITHELD / …).
 * @param value - Amount magnitude (BaNCS emits it as a string).
 * @returns A synthetic BalanceList entry.
 */
function balEntry(cde: string, value: JsonValue): JsonValue {
  return {
    BalType: { CDE: cde },
    CurrAmt: { Amt: { Value: value }, CurrCode: { CDE: 'ILS' } },
  };
}

/**
 * Wrap a BalanceList in the #0057 account-resolve envelope
 * (`Payload.DataEntity[0].BalanceList`).
 * @param list - BalanceList entries.
 * @returns A synthetic account-resolve response body.
 */
function accountBody(list: readonly JsonValue[]): JsonValue {
  const account = {
    AccountId: { AcctIds: { BANKACCOUNTID: 'FAKE-ACCT', IBAN: 'FAKE-IBAN' } },
    BalanceList: list,
  };
  return { Payload: { DataEntity: [account] } };
}

describe('BancsBalance — selectBancsBalance (decision C = CURRENT)', () => {
  it('when_balancelist_has_current_should_select_current_amount', () => {
    const body = accountBody([
      balEntry('DEBITHELD', '30.00'),
      balEntry('CURRENT', '150.50'),
      balEntry('AVAILABLE', '120.25'),
    ]);
    const got = selectBancsBalance(body);
    expect(got).toBe(150.5);
  });

  it('when_current_is_numeric_value_should_return_finite_number', () => {
    const body = accountBody([balEntry('CURRENT', 200)]);
    const got = selectBancsBalance(body);
    expect(got).toBe(200);
  });

  it('when_current_nested_under_account_should_be_found_by_recursion', () => {
    const member = { Account: { BalanceList: [balEntry('CURRENT', '88.00')] } };
    const body = { Payload: { DataEntity: [member] } };
    const got = selectBancsBalance(body);
    expect(got).toBe(88);
  });

  it('when_current_absent_should_default_deny_false', () => {
    const body = accountBody([balEntry('AVAILABLE', '75.00'), balEntry('CREDITLIMIT', '1000.00')]);
    const got = selectBancsBalance(body);
    expect(got).toBe(false);
  });

  it('when_current_value_non_numeric_should_default_deny_false', () => {
    const body = accountBody([balEntry('CURRENT', 'N/A')]);
    const got = selectBancsBalance(body);
    expect(got).toBe(false);
  });

  it('when_non_bancs_flat_body_should_default_deny_false', () => {
    const body: JsonValue = { balance: 100, currency: 'ILS' };
    const got = selectBancsBalance(body);
    expect(got).toBe(false);
  });
});

describe('BancsBalance — runBalanceExtractor integration', () => {
  it('when_bancs_body_should_return_current_balance', () => {
    const body = accountBody([balEntry('CURRENT', '150.00'), balEntry('CREDITLIMIT', '1000.00')]);
    const got = runBalanceExtractor(body);
    expect(got).toBe(150);
  });

  it('when_non_bancs_flat_body_should_use_generic_bfs_unchanged', () => {
    const body: JsonValue = { currentBalance: 999.99 };
    const got = runBalanceExtractor(body);
    expect(got).toBe(999.99);
  });
});
