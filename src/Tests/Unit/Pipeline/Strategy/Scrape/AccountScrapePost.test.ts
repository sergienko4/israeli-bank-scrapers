/**
 * Unit tests for Strategy/Scrape/Account/AccountScrapePost — POST context
 * built from the request body captured on the bank's own page.
 */

import { buildPostCtx } from '../../../../../Scrapers/Pipeline/Strategy/Scrape/Account/AccountScrapePost.js';
import type { ITxnEndpoint } from '../../../../../Scrapers/Pipeline/Types/Domain/TxnEndpointTypes.js';
import { EMPTY_TEST_TXN_ENDPOINT } from '../StrategyTestHelpers.js';

/** Card number the captured body carries; must never be echoed. */
const CARD_SENTINEL = '4580123412341234';

/**
 * Run a call that must throw and return the thrown message.
 * @param call - The throwing call.
 * @returns The thrown error's message.
 */
function thrownMessage(call: () => unknown): string {
  try {
    call();
  } catch (error) {
    return (error as Error).message;
  }
  return 'did not throw';
}

describe('buildPostCtx', () => {
  it('rejects a form-encoded captured body without quoting its card number', () => {
    const txnEndpoint: ITxnEndpoint = {
      ...EMPTY_TEST_TXN_ENDPOINT,
      url: 'https://bank.co.il/api/transactions',
      method: 'POST',
      templatePostData: `card=${CARD_SENTINEL}&month=10`,
    };
    const accountRecord = { accountNumber: '12-345-678901' };

    const message = thrownMessage((): unknown => buildPostCtx(accountRecord, txnEndpoint));

    expect(message).toBe('captured POST template: invalid JSON (SyntaxError)');
  });
});
