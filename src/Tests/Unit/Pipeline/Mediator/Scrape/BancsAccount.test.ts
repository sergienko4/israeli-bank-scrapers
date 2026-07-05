/**
 * BaNCS (Yahav) account resolution — synthetic, PII-free tests.
 *
 * <p>Proves the two-part shape guard in {@link selectBancsAccountRecords}
 * / {@link selectBancsAccountIds} selects ONLY the single current DDA
 * account (top-level IBAN + a CURRENT BalanceList) and is a provable
 * no-op (default-deny `false`) for:
 * <ul>
 *   <li>the `portfolioBalance` response (18 `.Account`-wrapped,
 *       AVAILABLE-only members) — else the picker would conflate them
 *       into 18 wrong accounts;</li>
 *   <li>transaction rows (top-level IBAN, no BalanceList);</li>
 *   <li>every non-BaNCS body.</li>
 * </ul>
 * The integration cases confirm `extractAccountIds` and
 * `discoverAccountsInPool` surface exactly one BANKACCOUNTID.
 *
 * Every value is fabricated (`FAKE-*`) — no real account data appears.
 */

import { discoverAccountsInPool } from '../../../../../Scrapers/Pipeline/Mediator/AccountResolve/AccountFromPool.js';
import type { IDiscoveredEndpoint } from '../../../../../Scrapers/Pipeline/Mediator/Network/NetworkDiscoveryTypes.js';
import type { ApiRecord } from '../../../../../Scrapers/Pipeline/Mediator/Scrape/AutoMapperFacade/AutoMapperTypes.js';
import {
  selectBancsAccountIds,
  selectBancsAccountRecords,
} from '../../../../../Scrapers/Pipeline/Mediator/Scrape/Bancs/BancsAccount.js';
import { extractAccountIds } from '../../../../../Scrapers/Pipeline/Mediator/Scrape/ScrapeAutoMapper.js';

const FAKE_DDA_ID = 'FAKE-DDA-001';

/**
 * Build one BaNCS BalanceList entry of the given BalType code.
 * @param cde - BalType code (CURRENT / AVAILABLE / DEBITHELD / …).
 * @returns A synthetic BalanceList entry.
 */
function balEntry(cde: string): ApiRecord {
  return { BalType: { CDE: cde }, CurrAmt: { Amt: { Value: '150.00' }, CurrCode: { CDE: 'ILS' } } };
}

/**
 * Build a #0057-shaped current DDA account member — top-level IBAN plus
 * a BalanceList carrying a CURRENT entry.
 * @returns A synthetic account-resolve member.
 */
function ddaAccountMember(): ApiRecord {
  return {
    AccountId: { AcctIds: { BANKACCOUNTID: FAKE_DDA_ID, IBAN: 'IL00-FAKE-0001' } },
    Title: 'FAKE Current Account',
    Type: { CDE: 'DDA' },
    BalanceList: [balEntry('DEBITHELD'), balEntry('CURRENT'), balEntry('AVAILABLE')],
  };
}

/**
 * Build a #0043-shaped portfolio member — `.Account`-wrapped, AVAILABLE
 * only, and NO top-level IBAN (must be rejected by the guard).
 * @param seq - Member sequence number (fabricated id suffix).
 * @returns A synthetic portfolioBalance member.
 */
function portfolioMember(seq: number): ApiRecord {
  return {
    Status: { CDE: 'OK' },
    Account: {
      AccountId: { AcctIds: { BANKACCOUNTID: `FAKE-PF-${String(seq)}` } },
      Type: { CDE: 'DDA' },
      BalanceList: [balEntry('AVAILABLE')],
    },
  };
}

/**
 * Build a #0071-shaped transaction member — top-level IBAN but NO
 * BalanceList (must be rejected by the guard).
 * @returns A synthetic transaction member.
 */
function txnMember(): ApiRecord {
  return {
    AccountId: { AcctIds: { BANKACCOUNTID: FAKE_DDA_ID, IBAN: 'IL00-FAKE-0001' } },
    OrigDt: { Day: 1, Month: 1, Year: 2026 },
    TotalCurAmt: { Amt: { Value: '10.00' } },
    Memo: 'FAKE payment',
  };
}

/**
 * Wrap DataEntity members in the BaNCS `Payload.DataEntity` envelope.
 * @param members - DataEntity members.
 * @returns A synthetic BaNCS response body.
 */
function bancsBody(members: readonly ApiRecord[]): ApiRecord {
  return { Payload: { DataEntity: members } };
}

/**
 * Build a synthetic captured endpoint carrying the given body.
 * @param body - Parsed response body.
 * @param captureIndex - Capture sequence number.
 * @returns Endpoint stub with test defaults.
 */
function makeCapture(body: ApiRecord, captureIndex: number): IDiscoveredEndpoint {
  return {
    url: 'https://digital.yahav.example/BaNCSDigitalApp/account',
    method: 'POST',
    postData: '',
    responseBody: body,
    contentType: 'application/json',
    requestHeaders: {},
    responseHeaders: {},
    timestamp: 100,
    captureIndex,
  };
}

/**
 * Length of a select result, or -1 for the default-deny `false`.
 * @param result - Select-account result.
 * @returns Record count, or -1.
 */
function lenOf(result: readonly unknown[] | false): number {
  if (result === false) return -1;
  return result.length;
}

describe('BancsAccount — shape guard (single current DDA account)', () => {
  it('when_account_resolve_body_should_select_one_record', () => {
    const body = bancsBody([ddaAccountMember()]);
    const recs = selectBancsAccountRecords(body);
    const count = lenOf(recs);
    expect(count).toBe(1);
  });

  it('when_account_resolve_body_should_return_bankaccountid', () => {
    const body = bancsBody([ddaAccountMember()]);
    const ids = selectBancsAccountIds(body);
    expect(ids).toEqual([FAKE_DDA_ID]);
  });

  it('when_portfolio_balance_body_should_default_deny_no_conflation', () => {
    const members = Array.from({ length: 18 }, (_unused, i): ApiRecord => portfolioMember(i));
    const body = bancsBody(members);
    const ids = selectBancsAccountIds(body);
    expect(ids).toBe(false);
  });

  it('when_portfolio_balance_records_should_default_deny_false', () => {
    const members = Array.from({ length: 18 }, (_unused, i): ApiRecord => portfolioMember(i));
    const body = bancsBody(members);
    const recs = selectBancsAccountRecords(body);
    expect(recs).toBe(false);
  });

  it('when_transaction_body_should_default_deny_false', () => {
    const body = bancsBody([txnMember()]);
    const ids = selectBancsAccountIds(body);
    expect(ids).toBe(false);
  });

  it('when_member_has_iban_but_no_current_baltype_should_default_deny', () => {
    const member: ApiRecord = {
      AccountId: { AcctIds: { BANKACCOUNTID: FAKE_DDA_ID, IBAN: 'IL00-FAKE-0002' } },
      BalanceList: [balEntry('AVAILABLE'), balEntry('CREDITLIMIT')],
    };
    const body = bancsBody([member]);
    const ids = selectBancsAccountIds(body);
    expect(ids).toBe(false);
  });

  it('when_non_bancs_flat_body_should_default_deny_false', () => {
    const body: ApiRecord = { accounts: [{ accountNumber: 'FAKE-123' }] };
    const ids = selectBancsAccountIds(body);
    expect(ids).toBe(false);
  });
});

describe('BancsAccount — extractAccountIds integration', () => {
  it('when_bancs_body_should_extract_bankaccountid', () => {
    const body = bancsBody([ddaAccountMember()]);
    const ids = extractAccountIds(body);
    expect(ids).toEqual([FAKE_DDA_ID]);
  });

  it('when_non_bancs_root_array_should_use_generic_path', () => {
    const rootArray = [{ accountId: 'FAKE-A1' }, { accountId: 'FAKE-A2' }];
    const ids = extractAccountIds(rootArray as unknown as ApiRecord);
    expect(ids).toEqual(['FAKE-A1', 'FAKE-A2']);
  });
});

describe('BancsAccount — discoverAccountsInPool no-conflation', () => {
  it('when_pool_has_portfolio_and_account_should_pick_single_account', () => {
    const members = Array.from({ length: 18 }, (_unused, i): ApiRecord => portfolioMember(i));
    const portfolioBody = bancsBody(members);
    const portfolioCap = makeCapture(portfolioBody, 43);
    const accountBody = bancsBody([ddaAccountMember()]);
    const accountCap = makeCapture(accountBody, 57);
    const result = discoverAccountsInPool([portfolioCap, accountCap]);
    expect(result.ids).toEqual([FAKE_DDA_ID]);
  });
});
