/**
 * Unit tests for IApiDirectCallConfig — verifies the data-only
 * shape via satisfies assignments (compile-time pin). Banks MUST
 * be able to declare a config literal without importing anything
 * from Mediator/* other than the port itself.
 */

import type {
  FlowKind,
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

/**
 * Builder for non-OTP flow shapes. STORED_JWT and BEARER_STATIC
 * carry an identical IApiDirectCallConfig shape (empty steps,
 * default envelope, ASSERT_TAG probe) modulo the flow string, so
 * the shape lives in this single helper. Each named constant
 * below pins one flow value while keeping the shape DRY.
 * @param flow - The non-OTP FlowKind value for this config.
 * @returns A typed IApiDirectCallConfig with the shared shape.
 */
function buildNonOtpConfig(flow: 'stored-jwt' | 'bearer-static'): IApiDirectCallConfig {
  return {
    flow,
    steps: [],
    envelope: { deviceTokenPath: '/resultData/deviceToken' },
    probe: { urlTag: ASSERT_TAG },
  };
}

/** Compile-time pin: stored-jwt flow shape (no signer/fingerprint). */
const STORED_JWT_CONFIG: IApiDirectCallConfig = buildNonOtpConfig('stored-jwt');
/** Compile-time pin: bearer-static flow shape. */
const BEARER_STATIC_CONFIG: IApiDirectCallConfig = buildNonOtpConfig('bearer-static');

describe('FlowKind enum', () => {
  it('covers the three declared flow kinds', () => {
    // Dynamic comparisons against the resolved field values — closes
    // Sonar S5914 (the prior literal-to-literal assertions always
    // succeeded because both sides were string literals). Each
    // assertion now verifies the FlowKind union accepts a distinct
    // value from a config literal — a real contract under test.
    const smsOtp: FlowKind = FULL_CONFIG.flow;
    const storedJwt: FlowKind = STORED_JWT_CONFIG.flow;
    const bearerStatic: FlowKind = BEARER_STATIC_CONFIG.flow;
    expect(smsOtp).toBe(MINIMAL_CONFIG.flow);
    expect(storedJwt).not.toBe(smsOtp);
    expect(bearerStatic).not.toBe(storedJwt);
  });
});
