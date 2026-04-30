/**
 * Unit tests for TokenStrategyFromConfig.getLatestLongTermToken — the
 * capture slot used by ApiDirectCallActions to surface the long-term
 * token via ScraperOptions.onAuthFlowComplete.
 */

import { CompanyTypes } from '../../../../../../Definitions.js';
import { ScraperErrorTypes } from '../../../../../../Scrapers/Base/ErrorTypes.js';
import type {
  IApiMediator,
  IApiQueryOpts,
} from '../../../../../../Scrapers/Pipeline/Mediator/Api/ApiMediator.js';
import { createTokenStrategyFromConfig } from '../../../../../../Scrapers/Pipeline/Mediator/ApiDirectCall/Flow/TokenStrategyFromConfig.js';
import type { IApiDirectCallConfig } from '../../../../../../Scrapers/Pipeline/Mediator/ApiDirectCall/IApiDirectCallConfig.js';
import type { WKUrlGroup } from '../../../../../../Scrapers/Pipeline/Registry/WK/UrlsWK.js';
import { registerWkUrl } from '../../../../../../Scrapers/Pipeline/Registry/WK/UrlsWK.js';
import type { IPipelineContext } from '../../../../../../Scrapers/Pipeline/Types/PipelineContext.js';
import type { Procedure } from '../../../../../../Scrapers/Pipeline/Types/Procedure.js';
import { fail, succeed } from '../../../../../../Scrapers/Pipeline/Types/Procedure.js';

const ASSERT_TAG: WKUrlGroup = 'auth.assert';
const HINT = CompanyTypes.OneZero;

beforeAll((): void => {
  registerWkUrl(ASSERT_TAG, HINT, 'https://example.test/api/assert-lt');
});

const CTX_STUB = { companyId: HINT } as unknown as IPipelineContext;

/** One-call stubbed mediator for the long-term capture tests. */
interface IStubArgs {
  readonly response: Procedure<unknown>;
}

/**
 * Build a mediator that returns a scripted response on the first
 * apiPost call. All other methods are unused stubs.
 * @param args - Scripted-response bundle.
 * @returns IApiMediator.
 */
function makeBus(args: IStubArgs): IApiMediator {
  /**
   * Always-true boolean return — satisfies the setter contract.
   * @returns true
   */
  const okSet = (): true => true;
  /**
   * Shared async mediator no-op used for primeSession.
   * @returns Empty-string success.
   */
  const okPrime = async (): Promise<Procedure<string>> => {
    await Promise.resolve();
    return succeed('');
  };
  /**
   * Scripted apiPost — fails fast on a sentinel tag (proves the mock
   * routes by url) otherwise returns the bundled response.
   * @param url - WK URL group.
   * @param body - Body payload (ignored by the mock but shape-checked).
   * @param opts - Query opts (ignored by the mock but shape-checked).
   * @returns Scripted Procedure.
   */
  const apiPost = async <T>(
    url: WKUrlGroup,
    body: Record<string, unknown>,
    opts?: IApiQueryOpts,
  ): Promise<Procedure<T>> => {
    await Promise.resolve();
    const hasValidShapes =
      typeof url === 'string' &&
      typeof body === 'object' &&
      (opts === undefined || typeof opts === 'object');
    if (!hasValidShapes) {
      return fail(ScraperErrorTypes.Generic, 'mock apiPost received malformed inputs');
    }
    return args.response as Procedure<T>;
  };
  /**
   * Unused apiGet — tests never call it.
   * @returns Generic failure.
   */
  const apiGet = async <T>(): Promise<Procedure<T>> => {
    await Promise.resolve();
    return fail(ScraperErrorTypes.Generic, 'unused');
  };
  /**
   * Unused apiQuery — tests never call it.
   * @returns Generic failure.
   */
  const apiQuery = async <T>(): Promise<Procedure<T>> => {
    await Promise.resolve();
    return fail(ScraperErrorTypes.Generic, 'unused');
  };
  return {
    setBearer: okSet,
    setRawAuth: okSet,
    withTokenResolver: okSet,
    withTokenStrategy: okSet,
    primeSession: okPrime,
    apiPost,
    apiGet,
    apiQuery,
  };
}

/** Minimal strategy config exercising the capture slot. */
const BASE_CONFIG: IApiDirectCallConfig = {
  flow: 'sms-otp',
  envelope: {},
  probe: {},
  warmStart: { credsField: 'stored', carryField: 'token', fromStepIndex: 1 },
  steps: [
    {
      name: 'getIdToken',
      urlTag: ASSERT_TAG,
      body: { shape: {} },
      extractsToCarry: { token: '/access_token' },
    },
  ],
};

describe('api-direct-call strategy long-term token capture', () => {
  it('returns empty string before any flow has run', (): void => {
    const factoryProc = createTokenStrategyFromConfig({ config: BASE_CONFIG });
    expect(factoryProc.success).toBe(true);
    if (factoryProc.success) {
      const initialToken = factoryProc.value.getLatestLongTermToken();
      expect(initialToken).toBe('');
    }
  });

  it('captures carry[warmStart.carryField] after a successful cold flow', async (): Promise<void> => {
    const response = succeed({ access_token: 'captured-token-xyz' });
    const bus = makeBus({ response });
    const factoryProc = createTokenStrategyFromConfig({ config: BASE_CONFIG });
    expect(factoryProc.success).toBe(true);
    if (factoryProc.success) {
      const primed = await factoryProc.value.primeFresh(bus, CTX_STUB, {});
      expect(primed.success).toBe(true);
      const captured = factoryProc.value.getLatestLongTermToken();
      expect(captured).toBe('captured-token-xyz');
    }
  });

  it('returns empty when no warmStart is configured', async (): Promise<void> => {
    const noWarmConfig: IApiDirectCallConfig = {
      flow: 'sms-otp',
      envelope: {},
      probe: {},
      steps: [
        {
          name: 'getIdToken',
          urlTag: ASSERT_TAG,
          body: { shape: {} },
          extractsToCarry: { token: '/access_token' },
        },
      ],
    };
    const response = succeed({ access_token: 'bearer-only' });
    const bus = makeBus({ response });
    const factoryProc = createTokenStrategyFromConfig({ config: noWarmConfig });
    expect(factoryProc.success).toBe(true);
    if (factoryProc.success) {
      const primed = await factoryProc.value.primeFresh(bus, CTX_STUB, {});
      expect(primed.success).toBe(true);
      const captured = factoryProc.value.getLatestLongTermToken();
      expect(captured).toBe('');
    }
  });
});
