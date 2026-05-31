/**
 * Failing-first contract test per debugging-guidlines.md §1.2.
 *
 * <p>User direction 15-05-2026 (Amex live run `15-05-2026_15022915`):
 * we removed `.ashx` support long ago — every migrated bank goes
 * through modern POST/GET endpoints. Amex's `ProxyRequestHandler.ashx`
 * legacy auth tier MUST NOT enter the captured pool so no downstream
 * picker / probe / extractor can ever use it.
 *
 * <p>RED on prior code: `.ashx` URLs were recorded into the captured
 * pool just like any other JSON/204 response.
 *
 * <p>GREEN after fix: `parseResponse` drops `.ashx` URLs at entry
 * with `event:'parseResponse.drop' reason:'unsupportedUrl'`.
 */

import {
  isUnsupportedUrl,
  parseResponse,
} from '../../../../../Scrapers/Pipeline/Mediator/Network/NetworkDiscovery.js';
import { makeMockResponse } from './_makeMockResponse.js';

const ASHX_URL =
  'https://he.americanexpress.co.il/services/ProxyRequestHandler.ashx?reqName=ValidateIdDataNoReg';
const MODERN_URL =
  'https://web.americanexpress.co.il/ocp/transactions/DigitalV3.Transactions/GetTransactionsList';

describe('isUnsupportedUrl — WK `.ashx` block list', () => {
  it('UU-ASHX-001 matches Amex ProxyRequestHandler.ashx with reqName query', (): void => {
    const isMatch = isUnsupportedUrl(ASHX_URL);
    expect(isMatch).toBe(true);
  });

  it('UU-ASHX-002 matches a bare `.ashx` path with no query string', (): void => {
    const isMatch = isUnsupportedUrl('https://example.com/foo.ashx');
    expect(isMatch).toBe(true);
  });

  it('UU-ASHX-003 is case-insensitive (`.ASHX`)', (): void => {
    const isMatch = isUnsupportedUrl('https://example.com/Handler.ASHX?x=1');
    expect(isMatch).toBe(true);
  });

  it('UU-MODERN-001 does NOT match Amex modern ocp/transactions endpoint', (): void => {
    const isMatch = isUnsupportedUrl(MODERN_URL);
    expect(isMatch).toBe(false);
  });

  it('UU-MODERN-002 does NOT match a path that merely contains "ashx" as a substring', (): void => {
    const isMatch = isUnsupportedUrl('https://example.com/cashbacks');
    expect(isMatch).toBe(false);
  });
});

describe('parseResponse — `.ashx` enforcement gate', () => {
  it('PR-ASHX-001 drops Amex ProxyRequestHandler.ashx response BEFORE shouldRecordResponse', async (): Promise<void> => {
    const mock = makeMockResponse({
      status: 200,
      contentType: 'application/json',
      text: '{"Header":{"Status":"1"}}',
      url: ASHX_URL,
      method: 'POST',
      postData: '{"id":"X","sisma":"Y"}',
    });

    const endpoint = await parseResponse(mock);

    expect(endpoint).toBe(false);
  });

  it('PR-ASHX-002 drops `.ashx` even on status=204 (which would otherwise be recordable)', async (): Promise<void> => {
    const mock = makeMockResponse({
      status: 204,
      contentType: '',
      text: '',
      url: ASHX_URL,
      method: 'POST',
      postData: '',
    });

    const endpoint = await parseResponse(mock);

    expect(endpoint).toBe(false);
  });

  it('PR-ASHX-003 still records the modern (non-ashx) endpoint with identical body', async (): Promise<void> => {
    const mock = makeMockResponse({
      status: 200,
      contentType: 'application/json',
      text: '{"transactions":[]}',
      url: MODERN_URL,
      method: 'POST',
      postData: '{}',
    });

    const endpoint = await parseResponse(mock);

    expect(endpoint).not.toBe(false);
    if (endpoint !== false) {
      expect(endpoint.url).toBe(MODERN_URL);
    }
  });
});
