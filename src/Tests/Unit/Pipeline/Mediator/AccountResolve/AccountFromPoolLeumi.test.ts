/**
 * Leumi ACCOUNT-RESOLVE — WCF `UC_SO_GetAccounts` pool-picker contract.
 *
 * <p>Isolated from the shared cross-bank `AccountFromPool.test.ts`
 * driver (which sits at its 600-line cap) so the Leumi-specific
 * WellKnown additions get a dedicated, Leumi-only proof:
 * <ul>
 *   <li>`AccountsItems` is recognised as an account container
 *       ({@link DISPLAY_ID_FIELDS}/{@link QUERY_ID_FIELDS} +
 *       the `accountsItems` WK container name);</li>
 *   <li>the numeric `AccountIndex` (1, a single digit) is rejected by
 *       `isUsableIdentifier` (len &lt; 2) so the human-visible
 *       `MaskedNumber` is surfaced as the account id.</li>
 * </ul>
 *
 * <p>The picker only ever sees the body AFTER the WCF envelope unwrap
 * (proven separately in `ResponseEnvelope.test.ts`), so the fixture
 * declares the already-decoded inner payload. All data is fabricated;
 * the container/field names mirror the real Leumi shape.
 */

import {
  discoverAccountsInPool,
  poolMaxContainer,
} from '../../../../../Scrapers/Pipeline/Mediator/AccountResolve/AccountFromPool.js';
import type { IDiscoveredEndpoint } from '../../../../../Scrapers/Pipeline/Mediator/Network/NetworkDiscoveryTypes.js';

/**
 * Build a synthetic `UC_SO_GetAccounts` capture carrying the
 * already-unwrapped Leumi inner payload.
 * @param responseBody - Decoded inner payload the picker inspects.
 * @returns Discovered-endpoint stub.
 */
function makeLeumiCapture(responseBody: unknown): IDiscoveredEndpoint {
  return {
    url: 'https://hb2.bankleumi.example/ChannelWCF/Broker.svc/ProcessRequest?moduleName=UC_SO_GetAccounts',
    method: 'POST',
    postData: '',
    responseBody,
    contentType: 'application/json',
    requestHeaders: {},
    responseHeaders: {},
    timestamp: 100,
    captureIndex: 43,
  };
}

// FAKE data; real container (`AccountsItems`) + field names.
const LEUMI_POOL: readonly IDiscoveredEndpoint[] = [
  makeLeumiCapture({
    AccountsItems: [{ AccountIndex: 1, MaskedNumber: 'FAKE-LEUMI-88' }],
    SOStatus: { Status: true },
  }),
];

describe('Leumi ACCOUNT-RESOLVE — AccountsItems WK contract', () => {
  it('LEUMI-AR-001 picks the UC_SO_GetAccounts endpoint', (): void => {
    const result = discoverAccountsInPool(LEUMI_POOL);

    expect(result.endpoint).not.toBe(false);
    if (result.endpoint !== false) {
      expect(result.endpoint.url).toContain('UC_SO_GetAccounts');
    }
  });

  it('LEUMI-AR-002 surfaces exactly one account id', (): void => {
    const result = discoverAccountsInPool(LEUMI_POOL);

    expect(result.ids.length).toBe(1);
  });

  it('LEUMI-AR-003 surfaces the MaskedNumber (AccountIndex rejected as too short)', (): void => {
    const result = discoverAccountsInPool(LEUMI_POOL);

    expect(result.ids).toContain('FAKE-LEUMI-88');
  });

  it('LEUMI-AR-004 scores the AccountsItems container size', (): void => {
    const max = poolMaxContainer(LEUMI_POOL);

    expect(max).toBe(1);
  });
});
