/**
 * Unit tests for distillHeaders — Traffic Distillation.
 * Filters captured request headers to only security-relevant ones.
 */

import { distillHeaders } from '../../../../../Scrapers/Pipeline/Mediator/NetworkDiscovery.js';

describe('distillHeaders', () => {
  it('keeps authorization header', () => {
    const result = distillHeaders({ authorization: 'Bearer abc123' });
    expect(result.authorization).toBe('Bearer abc123');
  });

  it('keeps x-site-id header', () => {
    const result = distillHeaders({ 'x-site-id': '5B5160DD' });
    expect(result['x-site-id']).toBe('5B5160DD');
  });

  it('keeps x-xsrf-token header', () => {
    const result = distillHeaders({ 'x-xsrf-token': 'csrf123' });
    expect(result['x-xsrf-token']).toBe('csrf123');
  });

  it('keeps session-id header', () => {
    const result = distillHeaders({ 'session-id': 'sess456' });
    expect(result['session-id']).toBe('sess456');
  });

  it('removes cookie header (browser-managed)', () => {
    const result = distillHeaders({ cookie: 'sid=abc; path=/' });
    expect(result.cookie).toBeUndefined();
  });

  it('removes user-agent header (browser noise)', () => {
    const result = distillHeaders({ 'user-agent': 'Mozilla/5.0' });
    expect(result['user-agent']).toBeUndefined();
  });

  it('removes host header', () => {
    const result = distillHeaders({ host: 'api.cal-online.co.il' });
    expect(result.host).toBeUndefined();
  });

  it('removes content-length header', () => {
    const result = distillHeaders({ 'content-length': '256' });
    expect(result['content-length']).toBeUndefined();
  });

  it('removes sec-ch and sec-fetch headers', () => {
    const headers = {
      'sec-ch-ua': 'Chromium',
      'sec-fetch-mode': 'cors',
      'sec-fetch-site': 'same-origin',
    };
    const result = distillHeaders(headers);
    const resultKeys = Object.keys(result);
    expect(resultKeys).toHaveLength(0);
  });

  it('removes accept header', () => {
    const result = distillHeaders({ accept: 'application/json' });
    expect(result.accept).toBeUndefined();
  });

  it('handles Cal auth scenario: keeps CALAuthScheme + X-Site-Id', () => {
    const headers = {
      authorization: 'CALAuthScheme eyJhbGciOi...',
      'x-site-id': '5B5160DD-F84A-4D72-B67E-65891BA194FF',
      'content-type': 'application/json',
      'user-agent': 'Mozilla/5.0',
      cookie: 'sid=abc',
      host: 'connect.cal-online.co.il',
    };
    const result = distillHeaders(headers);
    expect(result.authorization).toBe('CALAuthScheme eyJhbGciOi...');
    expect(result['x-site-id']).toBe('5B5160DD-F84A-4D72-B67E-65891BA194FF');
    const calKeys = Object.keys(result);
    expect(calKeys).toHaveLength(2);
  });

  it('handles empty headers', () => {
    const result = distillHeaders({});
    const emptyKeys = Object.keys(result);
    expect(emptyKeys).toHaveLength(0);
  });
});
