/**
 * Unit tests for IApiDirectCallConfig — verifies the data-only
 * shape via satisfies assignments (compile-time pin). Banks MUST
 * be able to declare a config literal without importing anything
 * from Mediator/* other than the port itself.
 */

import type {
  IApiDirectCallConfig,
  ICanonicalStringConfig,
} from '../../../../../Scrapers/Pipeline/Mediator/ApiDirectCall/IApiDirectCallConfig.js';
import type { WKQueryOperation } from '../../../../../Scrapers/Pipeline/Registry/WK/QueriesWK.js';
import type { WKUrlGroup } from '../../../../../Scrapers/Pipeline/Registry/WK/UrlsWK.js';

/** Cast helpers — the real WK tags are enforced at wiring time; these tests pin shape only. */
const BIND_TAG = 'auth.bind' as WKUrlGroup;
const ASSERT_TAG = 'auth.assert' as WKUrlGroup;
const PROBE_QUERY = 'graphqlQuery.userData' as unknown as WKQueryOperation;

/** Reusable canonical-string config for shape tests. */
const CANONICAL_STUB: ICanonicalStringConfig = {
  parts: ['pathAndQuery', 'clientVersion', 'bodyJson'],
  separator: '%%',
  escapeFrom: '%%',
  escapeTo: String.raw`\%`,
  sortQueryParams: true,
  clientVersion: '1.0.0',
};

/** Compile-time pin: Pepper-like config with signer + fingerprint. */
const FULL_CONFIG: IApiDirectCallConfig = {
  flow: 'sms-otp',
  steps: [
    {
      name: 'bind',
      urlTag: BIND_TAG,
      body: { shape: { data: { challenge: { $literal: '' } } } },
      extractsToCarry: { challenge: '/data/challenge' },
    },
  ],
  envelope: {
    challengePath: '/data/challenge',
    sessionPath: '/headers/session_id',
    assertionIdPath: '/data/control_flow/0/methods/0/assertion_id',
  },
  signer: {
    algorithm: 'ECDSA-P256',
    encoding: 'DER',
    headerName: 'Content-Signature',
    schemeTag: 4,
    canonical: CANONICAL_STUB,
  },
  fingerprint: {
    shape: {
      metadata: { timestamp: { $ref: 'now' } },
      content: { device_details: { $literal: { model: 'synthetic' } } },
    },
  },
  jwtClaims: { freshnessField: 'exp', skewSeconds: 60 },
  probe: { queryTag: PROBE_QUERY },
};

/** Compile-time pin: minimal OneZero-like config without signer/fingerprint. */
const MINIMAL_CONFIG: IApiDirectCallConfig = {
  flow: 'sms-otp',
  steps: [
    {
      name: 'bind',
      urlTag: BIND_TAG,
      body: { shape: {} },
      extractsToCarry: { deviceToken: '/resultData/deviceToken' },
    },
  ],
  envelope: { deviceTokenPath: '/resultData/deviceToken' },
  probe: { urlTag: ASSERT_TAG },
};

describe('IApiDirectCallConfig shape', () => {
  it('accepts a full Pepper-like config literal', () => {
    expect(FULL_CONFIG.flow).toBe('sms-otp');
    expect(FULL_CONFIG.signer?.algorithm).toBe('ECDSA-P256');
    expect(FULL_CONFIG.fingerprint).toBeDefined();
    expect(FULL_CONFIG.probe.queryTag).toBe(PROBE_QUERY);
    expect(FULL_CONFIG.steps).toHaveLength(1);
  });

  it('accepts a minimal OneZero-like config without signer/fingerprint', () => {
    expect(MINIMAL_CONFIG.flow).toBe('sms-otp');
    expect(MINIMAL_CONFIG.signer).toBeUndefined();
    expect(MINIMAL_CONFIG.fingerprint).toBeUndefined();
    expect(MINIMAL_CONFIG.probe.urlTag).toBe(ASSERT_TAG);
  });
});

// The `describe('FlowKind enum')` block was removed 2026-05-18 to close
// SonarCloud S5914 (three runtime `expect(x).toBe(x)` tautologies on
// typed string consts). The FlowKind union members ('sms-otp',
// 'stored-jwt', 'bearer-static') are pinned at compile time by usage
// in production code (ApiDirectCallActions.ts, IApiDirectCallConfig.ts,
// Jwt/GenericJwtClaims.ts) and by the FULL_CONFIG/MINIMAL_CONFIG literals
// above — renaming any member is a tsc failure across 8 files, not a
// runtime test miss.
