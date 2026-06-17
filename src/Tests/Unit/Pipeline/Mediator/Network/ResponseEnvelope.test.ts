/**
 * Network Indexing / ResponseEnvelope — WCF `Broker.svc` envelope
 * unwrap contract.
 *
 * <p>Some bank backends (e.g. Leumi's `Broker.svc/ProcessRequest`)
 * double-encode their JSON: the real container lives INSIDE a
 * `{ ProcessRequestResult: <number>, jsonResp: "<stringified JSON>" }`
 * envelope and must be JSON-parsed a SECOND time before any downstream
 * picker can see it. {@link unwrapWcfEnvelope} decodes exactly that
 * shape; {@link isWcfEnvelope} is the strict shape guard.
 *
 * <p>Contract pins (default-deny, fail-safe):
 * <ul>
 *   <li>exact envelope → parsed inner payload</li>
 *   <li>malformed inner JSON → original body (fail-safe)</li>
 *   <li>non-envelope object / array / scalar / null → passthrough</li>
 *   <li>shape near-misses (missing key, wrong value type) → passthrough</li>
 * </ul>
 *
 * <p>Pure-function contract — synthetic inputs, no Playwright needed.
 * All data is fabricated; field names mirror the real Leumi shape.
 */

import {
  isWcfEnvelope,
  unwrapWcfEnvelope,
} from '../../../../../Scrapers/Pipeline/Mediator/Network/Indexing/ResponseEnvelope.js';

describe('unwrapWcfEnvelope — WCF Broker.svc double-encoding', () => {
  it('ENV-MATCH-001 returns the parsed inner payload for an exact envelope', (): void => {
    const inner = { AccountsItems: [{ AccountIndex: 1, MaskedNumber: 'FAKE-88' }] };
    const body = { ProcessRequestResult: 0, jsonResp: JSON.stringify(inner) };

    const unwrapped = unwrapWcfEnvelope(body);

    expect(unwrapped).toEqual(inner);
  });

  it('ENV-MALFORMED-001 falls back to the original body on malformed inner JSON', (): void => {
    const body = { ProcessRequestResult: 0, jsonResp: '{not-json' };

    const unwrapped = unwrapWcfEnvelope(body);

    expect(unwrapped).toBe(body);
  });

  it('ENV-PASSTHRU-OBJ-001 passes a non-envelope object through untouched', (): void => {
    const body = { data: { accounts: [{ accountId: 'FAKE-1' }] } };

    const unwrapped = unwrapWcfEnvelope(body);

    expect(unwrapped).toBe(body);
  });

  it('ENV-PASSTHRU-ARRAY-001 passes a top-level array through untouched', (): void => {
    const body = [{ accountId: 'FAKE-1' }];

    const unwrapped = unwrapWcfEnvelope(body);

    expect(unwrapped).toBe(body);
  });

  it('ENV-PASSTHRU-SCALAR-001 passes a scalar through untouched', (): void => {
    const unwrapped = unwrapWcfEnvelope('plain-text');

    expect(unwrapped).toBe('plain-text');
  });

  it('ENV-PASSTHRU-NULL-001 passes null through untouched', (): void => {
    const unwrapped = unwrapWcfEnvelope(null);

    expect(unwrapped).toBeNull();
  });

  it('ENV-NEARMISS-RESULT-001 passes through when the result key is non-numeric', (): void => {
    const body = { ProcessRequestResult: 'ok', jsonResp: '{"a":1}' };

    const unwrapped = unwrapWcfEnvelope(body);

    expect(unwrapped).toBe(body);
  });

  it('ENV-NEARMISS-PAYLOAD-001 passes through when the payload key is missing', (): void => {
    const body = { ProcessRequestResult: 0 };

    const unwrapped = unwrapWcfEnvelope(body);

    expect(unwrapped).toBe(body);
  });
});

describe('isWcfEnvelope — strict shape guard', () => {
  it('GUARD-MATCH-001 is true for the exact envelope shape', (): void => {
    const isEnvelope = isWcfEnvelope({ ProcessRequestResult: 0, jsonResp: '{}' });

    expect(isEnvelope).toBe(true);
  });

  it('GUARD-PAYLOAD-TYPE-001 is false when jsonResp is not a string', (): void => {
    const isEnvelope = isWcfEnvelope({ ProcessRequestResult: 0, jsonResp: { a: 1 } });

    expect(isEnvelope).toBe(false);
  });

  it('GUARD-ARRAY-001 is false for an array', (): void => {
    const isEnvelope = isWcfEnvelope([{ ProcessRequestResult: 0, jsonResp: '{}' }]);

    expect(isEnvelope).toBe(false);
  });

  it('GUARD-NULL-001 is false for null', (): void => {
    const isEnvelope = isWcfEnvelope(null);

    expect(isEnvelope).toBe(false);
  });
});
