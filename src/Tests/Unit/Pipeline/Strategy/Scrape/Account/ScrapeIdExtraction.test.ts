/**
 * Unit tests for ScrapeIdExtraction — display / query ID resolution.
 */

import type {
  IDiscoveredEndpoint,
  INetworkDiscovery,
} from '../../../../../../Scrapers/Pipeline/Mediator/Network/NetworkDiscovery.js';
import {
  extractCardId,
  extractIds,
  resolveDisplayIdFromCapturedEndpoints,
} from '../../../../../../Scrapers/Pipeline/Strategy/Scrape/Account/ScrapeIdExtraction.js';
import { isOk } from '../../../../../../Scrapers/Pipeline/Types/Procedure.js';

/**
 * Build a stub INetworkDiscovery returning the supplied endpoints.
 * @param eps - Endpoints to expose via getAllEndpoints.
 * @returns Stub network discovery.
 */
function makeNetwork(eps: readonly IDiscoveredEndpoint[]): INetworkDiscovery {
  return {
    /**
     * Test helper.
     *
     * @returns Result.
     */
    getAllEndpoints: (): readonly IDiscoveredEndpoint[] => eps,
  } as INetworkDiscovery;
}

describe('extractIds', () => {
  it('returns displayId + accountId when record has fields', () => {
    const record = { last4Digits: '1234', cardUniqueId: 'abc-123' };
    const ids = extractIds(record);
    expect(ids.displayId).toBe('1234');
    expect(ids.accountId).toBe('abc-123');
  });

  it('falls back to displayId for accountId when no queryId', () => {
    const record = { last4Digits: '9876' };
    const ids = extractIds(record);
    expect(ids.displayId).toBe('9876');
    expect(ids.accountId).toBe('9876');
  });

  it('returns empty strings when no fields match', () => {
    const record = { foo: 'bar' };
    const ids = extractIds(record);
    expect(ids.displayId).toBe('');
  });

  it('populates queryIdentifier + displayIdentifier receipts', () => {
    const record = { last4Digits: '1234', cardUniqueId: 'abc-123' };
    const ids = extractIds(record);
    expect(ids.queryIdentifier).toBeDefined();
    expect(ids.displayIdentifier).toBeDefined();
  });
});

describe('extractCardId', () => {
  it('returns first card id from cards[] array', () => {
    const record = { cards: [{ cardUniqueId: 'card-1' }] };
    const extractCardIdResult1 = extractCardId(record);
    expect(extractCardIdResult1).toBe('card-1');
  });

  it('returns false when cards[] is missing', () => {
    const extractCardIdResult2 = extractCardId({ name: 'x' });
    expect(extractCardIdResult2).toBe(false);
  });

  it('returns false when cards[] is empty', () => {
    const extractCardIdResult3 = extractCardId({ cards: [] });
    expect(extractCardIdResult3).toBe(false);
  });

  it('returns false when first card has no queryId field', () => {
    const extractCardIdResult4 = extractCardId({ cards: [{ foo: 'bar' }] });
    expect(extractCardIdResult4).toBe(false);
  });

  it('supports capitalised Cards key', () => {
    const record = { Cards: [{ cardUniqueId: 'upper-1' }] };
    const extractCardIdResult5 = extractCardId(record);
    expect(extractCardIdResult5).toBe('upper-1');
  });
});

describe('resolveDisplayIdFromCapturedEndpoints', () => {
  it('returns succeed when any endpoint body carries displayId', () => {
    const eps: IDiscoveredEndpoint[] = [
      { url: 'a', method: 'GET', postData: '', responseBody: { last4Digits: '4242' } },
    ] as unknown as IDiscoveredEndpoint[];
    const makeNetworkResult6 = makeNetwork(eps);
    const result = resolveDisplayIdFromCapturedEndpoints(makeNetworkResult6);
    const isOkResult7 = isOk(result);
    expect(isOkResult7).toBe(true);
    if (isOk(result)) expect(result.value).toBe('4242');
  });

  it('returns failure when no endpoint carries a displayId', () => {
    const eps: IDiscoveredEndpoint[] = [
      { url: 'a', method: 'GET', postData: '', responseBody: { other: 'x' } },
    ] as unknown as IDiscoveredEndpoint[];
    const makeNetworkResult8 = makeNetwork(eps);
    const result = resolveDisplayIdFromCapturedEndpoints(makeNetworkResult8);
    const isOkResult9 = isOk(result);
    expect(isOkResult9).toBe(false);
  });

  it('returns failure for empty endpoints', () => {
    const makeNetworkResult10 = makeNetwork([]);
    const result = resolveDisplayIdFromCapturedEndpoints(makeNetworkResult10);
    const isOkResult11 = isOk(result);
    expect(isOkResult11).toBe(false);
  });

  it('skips null responseBody without throwing', () => {
    const eps: IDiscoveredEndpoint[] = [
      { url: 'a', method: 'GET', postData: '', responseBody: null },
      { url: 'b', method: 'GET', postData: '', responseBody: { last4Digits: '0000' } },
    ] as unknown as IDiscoveredEndpoint[];
    const makeNetworkResult12 = makeNetwork(eps);
    const result = resolveDisplayIdFromCapturedEndpoints(makeNetworkResult12);
    const isOkResult13 = isOk(result);
    expect(isOkResult13).toBe(true);
  });
});
