/**
 * At the builder — `build()` reads the bank's headless block from the
 * registry and refuses an api-direct call config that cannot work with it.
 *
 * The bank-config resolver is mocked so one bank keeps a session cookie jar
 * and every other bank has no config, which pins that the rules see the
 * block of the bank named in the options.
 */

import { jest } from '@jest/globals';

import type { CompanyTypes } from '../../../../../Definitions.js';
import { ScraperErrorTypes } from '../../../../../Scrapers/Base/ErrorTypes.js';
import type { ScraperOptions } from '../../../../../Scrapers/Base/Interface.js';
import type { IPipelineDescriptor } from '../../../../../Scrapers/Pipeline/Core/PipelineDescriptor.js';
import type {
  IApiDirectCallConfig,
  IStepConfig,
} from '../../../../../Scrapers/Pipeline/Mediator/ApiDirectCall/ConfigContracts/index.js';
import type { Procedure } from '../../../../../Scrapers/Pipeline/Types/Procedure.js';
import { makeMockOptions, MOCK_API_DIRECT_SHAPE } from '../../Infrastructure/MockFactories.js';

const JAR_BANK = 'jarBank' as unknown as CompanyTypes;
const TLS_BANK = 'tlsBank' as unknown as CompanyTypes;
const TLS_CLEAN_BANK = 'tlsCleanBank' as unknown as CompanyTypes;
const DYNAMIC_TLS_BANK = 'dynamicTlsBank' as unknown as CompanyTypes;
const DYNAMIC_TLS_REDIRECT_BANK = 'dynamicTlsRedirectBank' as unknown as CompanyTypes;
const DYNAMIC_CERT = { mode: 'dynamic', origin: 'https://native.example' } as const;

/**
 * Mocked resolver: only the jar bank has a config; the TLS banks need
 * node:https.
 * @param companyId - Bank named in the options.
 * @returns A config whose headless block names the transport, or false.
 */
function resolveMocked(companyId: CompanyTypes): object | false {
  if (companyId === TLS_BANK) {
    return { headless: { requiresClientCert: true, redirectPolicy: 'reject' } };
  }
  if (companyId === TLS_CLEAN_BANK) {
    return {
      headless: {
        requiresClientCert: true,
        sessionCookies: true,
        cookieDomains: ['native.example'],
      },
    };
  }
  if (companyId === DYNAMIC_TLS_REDIRECT_BANK) {
    return { headless: { clientCert: DYNAMIC_CERT, redirectPolicy: 'reject' } };
  }
  if (companyId === DYNAMIC_TLS_BANK) {
    return {
      headless: {
        clientCert: DYNAMIC_CERT,
        sessionCookies: true,
        cookieDomains: ['native.example'],
      },
    };
  }
  if (companyId !== JAR_BANK) return false;
  return { headless: { sessionCookies: true } };
}

jest.unstable_mockModule(
  '../../../../../Scrapers/Pipeline/Registry/Config/PipelineBankConfig.js',
  () => ({
    default: resolveMocked,
    resolvePipelineBankConfig: resolveMocked,
    PIPELINE_BANK_CONFIG: {},
  }),
);

const BUILDER_FACTORY =
  await import('../../../../../Scrapers/Pipeline/Core/Builder/PipelineBuilderFactory.js');

const STEP: IStepConfig = {
  name: 'bind',
  urlTag: 'auth.bind',
  body: { shape: { x: { $literal: 1 } } },
  extractsToCarry: { token: '/data/accessToken' },
};

const PLAIN_CALL: IApiDirectCallConfig = { flow: 'sms-otp', envelope: {}, steps: [STEP] };

const NONE_CALL: IApiDirectCallConfig = {
  flow: 'sms-otp',
  envelope: {},
  authScheme: 'none',
  steps: [STEP],
};

const JAR_STEP_CALL: IApiDirectCallConfig = {
  flow: 'sms-otp',
  envelope: {},
  steps: [{ ...STEP, cookieJar: true }],
};
const DYNAMIC_CALL: IApiDirectCallConfig = {
  ...NONE_CALL,
  steps: [
    { ...STEP, encoding: 'text', body: { shape: { text: { $literal: 'payload' } } } },
    { ...STEP, name: 'resume', headerExtractsToCarry: { session: { header: 'x-session' } } },
  ],
};

/**
 * Build a headless api-direct pipeline for the given bank and call config.
 * @param opts - Scraper options naming the bank.
 * @param call - Call config under test.
 * @returns Build result.
 */
function buildWith(
  opts: ScraperOptions,
  call: IApiDirectCallConfig,
): Procedure<IPipelineDescriptor> {
  const builder = BUILDER_FACTORY.createPipelineBuilder();
  const seeded = builder.withOptions(opts);
  const withLogin = seeded.withApiDirect(call, MOCK_API_DIRECT_SHAPE);
  return withLogin.build();
}

/**
 * Build a headless pipeline whose call config sets no transport option, so any
 * refusal comes from the bank's headless block alone.
 * @param opts - Scraper options naming the bank.
 * @returns Build result.
 */
function buildPlain(opts: ScraperOptions): Procedure<IPipelineDescriptor> {
  return buildWith(opts, PLAIN_CALL);
}

describe('PipelineBuilder — api-direct config rules', () => {
  it('builds authScheme none for a bank whose headless block keeps a jar', () => {
    const opts = makeMockOptions({ companyId: JAR_BANK });
    const result = buildWith(opts, NONE_CALL);
    expect(result.success).toBe(true);
  });

  it('refuses authScheme none for a bank with no headless block', () => {
    const opts = makeMockOptions();
    const result = buildWith(opts, NONE_CALL);
    expect(result).toMatchObject({
      success: false,
      errorType: ScraperErrorTypes.Generic,
      errorMessage: 'headless.sessionCookies: required when authScheme is none',
    });
  });

  it('refuses a step jar for a bank whose headless block keeps a jar', () => {
    const opts = makeMockOptions({ companyId: JAR_BANK });
    const result = buildWith(opts, JAR_STEP_CALL);
    expect(result).toMatchObject({
      success: false,
      errorMessage: 'steps.cookieJar: not allowed with headless.sessionCookies',
    });
  });

  it('builds a step jar for a bank with no headless block', () => {
    const opts = makeMockOptions();
    const result = buildWith(opts, JAR_STEP_CALL);
    expect(result.success).toBe(true);
  });
});

describe('PipelineBuilder — node-tls headless rules', () => {
  it('refuses a native-only redirect policy on a node:https block', () => {
    const opts = makeMockOptions({ companyId: TLS_BANK });
    const result = buildPlain(opts);
    expect(result).toMatchObject({
      success: false,
      errorType: ScraperErrorTypes.Generic,
      errorMessage: 'headless.redirectPolicy: not allowed without headless.nativeFetch',
    });
  });

  it('builds a registered mTLS block with a domain cookie jar', () => {
    const opts = makeMockOptions({ companyId: TLS_CLEAN_BANK });
    const result = buildPlain(opts);
    expect(result.success).toBe(true);
  });

  it('builds a dynamic mTLS flow with text bodies, header slots and domain cookies', () => {
    const opts = makeMockOptions({ companyId: DYNAMIC_TLS_BANK });
    const result = buildWith(opts, DYNAMIC_CALL);
    expect(result.success).toBe(true);
  });

  it('refuses a dynamic mTLS redirect default on a node:https block', () => {
    const opts = makeMockOptions({ companyId: DYNAMIC_TLS_REDIRECT_BANK });
    const result = buildPlain(opts);
    expect(result).toMatchObject({
      success: false,
      errorMessage: 'headless.redirectPolicy: not allowed without headless.nativeFetch',
    });
  });
});
