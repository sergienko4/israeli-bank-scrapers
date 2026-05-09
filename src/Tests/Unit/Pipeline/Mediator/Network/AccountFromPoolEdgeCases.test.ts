/**
 * Phase 7d coverage support — exercises tie-break edges of the
 * AccountDiscovery picker:
 *
 *   - `isPopulated` null + undefined branches (richness scoring
 *     skips empty fields).
 *   - `compareCandidates` captureIndex `?? 0` fallback (both
 *     candidates lack captureIndex).
 *   - `asAccountId` numeric branch (POST body carries an integer
 *     accountId field).
 */

import { discoverAccountsInPool } from '../../../../../Scrapers/Pipeline/Mediator/Network/AccountFromPool.js';
import type { IDiscoveredEndpoint } from '../../../../../Scrapers/Pipeline/Mediator/Network/NetworkDiscoveryTypes.js';

/**
 * Build a minimal capture with all metadata defaulted. Phase 7d
 * tests deliberately leave `captureIndex` undefined to exercise
 * the `?? 0` tie-break fallback.
 * @param body - Response body.
 * @returns Capture stub.
 */
function makeCapture(body: unknown): IDiscoveredEndpoint {
  return {
    url: 'https://api.fake.example/x',
    method: 'POST',
    postData: '{}',
    responseBody: body,
    contentType: 'application/json',
    requestHeaders: {},
    responseHeaders: {},
    timestamp: 0,
  };
}

describe('AccountDiscovery — Phase 7d picker tie-break edge cases', () => {
  it('isPopulated treats null + undefined as empty (richness skips them)', () => {
    // Record fields with null + undefined values force isPopulated
    // through both early-return branches; cardSuffix carries the
    // actual id so the record still surfaces in extraction.
    const body = {
      cards: [
        {
          cardSuffix: '1234',
          ownerName: null,
          extraField: undefined,
          enabled: true,
          balance: 0,
        },
      ],
    };
    const capture = makeCapture(body);
    const result = discoverAccountsInPool([capture]);
    expect(result.ids.length).toBe(1);
    expect(result.containers.cards.length).toBe(1);
  });

  it('compareCandidates falls back to 0 when both captures lack captureIndex', () => {
    // Two equal-cardinality captures without captureIndex force
    // the picker into the `?? 0` tie-break twice (a and b).
    const bodyA = { cards: [{ cardSuffix: 'AAAA' }] };
    const bodyB = { cards: [{ cardSuffix: 'BBBB' }] };
    const captureA = makeCapture(bodyA);
    const captureB = makeCapture(bodyB);
    const result = discoverAccountsInPool([captureA, captureB]);
    expect(result.ids.length).toBe(1);
  });

  it('asAccountId converts numeric POST body identifiers to strings', () => {
    // No body container — picker falls to the request-side path,
    // which parses postData and feeds asAccountId. A numeric
    // accountId exercises the typeof === 'number' branch (line 274).
    const captureNoBody: IDiscoveredEndpoint = {
      url: 'https://api.fake.example/y',
      method: 'POST',
      postData: JSON.stringify({ accountId: 5551234 }),
      responseBody: { unrelated: 'value' },
      contentType: 'application/json',
      requestHeaders: {},
      responseHeaders: {},
      timestamp: 0,
    };
    const result = discoverAccountsInPool([captureNoBody]);
    expect(result.ids.length).toBe(1);
    expect(result.ids[0]).toBe('5551234');
  });
});
