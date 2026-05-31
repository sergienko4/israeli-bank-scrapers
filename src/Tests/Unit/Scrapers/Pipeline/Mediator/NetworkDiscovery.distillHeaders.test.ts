/**
 * Unit tests for distillHeaders — Traffic Distillation.
 * Filters captured request headers to only security-relevant ones.
 * distillHeaders returns Procedure<DistilledHeaders> — tests use assertOk for narrowing.
 */

import { distillHeaders } from '../../../../../Scrapers/Pipeline/Mediator/Network/NetworkDiscovery.js';
import { assertOk } from '../../../../Helpers/AssertProcedure.js';

describe('distillHeaders', () => {
  it('keeps authorization header', () => {
    const result = distillHeaders({ authorization: 'Bearer abc123' });
    assertOk(result);
    expect(result.value.authorization).toBe('Bearer abc123');
  });

  it('keeps x-site-id header', () => {
    const result = distillHeaders({ 'x-site-id': '5B5160DD' });
    assertOk(result);
    expect(result.value['x-site-id']).toBe('5B5160DD');
  });

  it('keeps x-xsrf-token header', () => {
    const result = distillHeaders({ 'x-xsrf-token': 'csrf123' });
    assertOk(result);
    expect(result.value['x-xsrf-token']).toBe('csrf123');
  });

  it('keeps session-id header', () => {
    const result = distillHeaders({ 'session-id': 'sess456' });
    assertOk(result);
    expect(result.value['session-id']).toBe('sess456');
  });

  it('removes cookie header (browser-managed)', () => {
    const result = distillHeaders({ cookie: 'sid=abc; path=/' });
    assertOk(result);
    expect(result.value.cookie).toBeUndefined();
  });

  it('removes user-agent header (browser noise)', () => {
    const result = distillHeaders({ 'user-agent': 'Mozilla/5.0' });
    assertOk(result);
    expect(result.value['user-agent']).toBeUndefined();
  });

  it('removes host header', () => {
    const result = distillHeaders({ host: 'api.cal-online.co.il' });
    assertOk(result);
    expect(result.value.host).toBeUndefined();
  });

  it('removes content-length header', () => {
    const result = distillHeaders({ 'content-length': '256' });
    assertOk(result);
    expect(result.value['content-length']).toBeUndefined();
  });

  it('removes sec-ch and sec-fetch headers', () => {
    const headers = {
      'sec-ch-ua': 'Chromium',
      'sec-fetch-mode': 'cors',
      'sec-fetch-site': 'same-origin',
    };
    const result = distillHeaders(headers);
    assertOk(result);
    const resultKeys = Object.keys(result.value);
    expect(resultKeys).toHaveLength(0);
  });

  it('removes accept header', () => {
    const result = distillHeaders({ accept: 'application/json' });
    assertOk(result);
    expect(result.value.accept).toBeUndefined();
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
    assertOk(result);
    expect(result.value.authorization).toBe('CALAuthScheme eyJhbGciOi...');
    expect(result.value['x-site-id']).toBe('5B5160DD-F84A-4D72-B67E-65891BA194FF');
    const calKeys = Object.keys(result.value);
    expect(calKeys).toHaveLength(2);
  });

  it('handles empty headers', () => {
    const result = distillHeaders({});
    assertOk(result);
    const resultKeys = Object.keys(result.value);
    expect(resultKeys).toHaveLength(0);
  });
});
