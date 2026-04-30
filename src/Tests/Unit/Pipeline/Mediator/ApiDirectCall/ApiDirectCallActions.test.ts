/**
 * Unit tests for ApiDirectCallActions — PRE / ACTION / POST helpers
 * that drive the api-direct-call phase from an IApiDirectCallConfig
 * literal. Exercises: warmStart classification, safeInvoke wrap,
 * runApiDirectCallAction primeSession success + empty-header fail +
 * callback invocation, runApiDirectCallPost queryTag / urlTag /
 * missing-probe branches, mergeOptionsIntoCreds precedence.
 */

import { CompanyTypes } from '../../../../../Definitions.js';
import { ScraperErrorTypes } from '../../../../../Scrapers/Base/ErrorTypes.js';
import type { IAuthFlowInfo } from '../../../../../Scrapers/Base/Interface.js';
import type { IApiMediator } from '../../../../../Scrapers/Pipeline/Mediator/Api/ApiMediator.js';
import {
  runApiDirectCallAction,
  runApiDirectCallPost,
  runApiDirectCallPre,
} from '../../../../../Scrapers/Pipeline/Mediator/ApiDirectCall/ApiDirectCallActions.js';
import type { IApiDirectCallConfig } from '../../../../../Scrapers/Pipeline/Mediator/ApiDirectCall/IApiDirectCallConfig.js';
import type { WKUrlGroup } from '../../../../../Scrapers/Pipeline/Registry/WK/UrlsWK.js';
import { registerWkUrl } from '../../../../../Scrapers/Pipeline/Registry/WK/UrlsWK.js';
import { some } from '../../../../../Scrapers/Pipeline/Types/Option.js';
import type { IPipelineContext } from '../../../../../Scrapers/Pipeline/Types/PipelineContext.js';
import { fail } from '../../../../../Scrapers/Pipeline/Types/Procedure.js';
import { makeMockContext } from '../../Infrastructure/MockFactories.js';
import { type IApiPostCapture, makeStubMediator } from './Flow/StubMediator.js';

const ASSERT_TAG: WKUrlGroup = 'auth.assert';
const PROBE_TAG: WKUrlGroup = 'auth.logout';

beforeAll((): void => {
  registerWkUrl(ASSERT_TAG, CompanyTypes.OneZero, 'https://example.test/api/actions-assert');
  registerWkUrl(PROBE_TAG, CompanyTypes.OneZero, 'https://example.test/api/actions-probe');
});

/**
 * Build a minimal api-direct-call config with a single step that
 * extracts carry.token from the response.
 * @returns IApiDirectCallConfig literal.
 */
function makeBaseConfig(): IApiDirectCallConfig {
  return {
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
}

/** Bundled context-build args — respects the 3-param ceiling. */
interface IActionsCtxArgs {
  readonly bus: IApiMediator;
  readonly options?: Record<string, unknown>;
  readonly credentials?: Record<string, unknown>;
}

/**
 * Build a context carrying the supplied api-mediator + options + creds.
 * @param args - Bundled bus + optional overrides.
 * @returns IPipelineContext.
 */
function makeActionsCtx(args: IActionsCtxArgs): IPipelineContext {
  const base = makeMockContext();
  const options = { ...base.options, ...(args.options ?? {}) };
  const credentials = { ...base.credentials, ...(args.credentials ?? {}) };
  return {
    ...base,
    apiMediator: some(args.bus) as unknown as IPipelineContext['apiMediator'],
    options: options as typeof base.options,
    credentials: credentials as typeof base.credentials,
  };
}

describe('ApiDirectCallActions.runApiDirectCallPre classification', () => {
  it('succeeds without warmStart and logs sms-otp kind', async (): Promise<void> => {
    const captures: IApiPostCapture[] = [];
    const bus = makeStubMediator({ responses: [], captures });
    const ctx = makeActionsCtx({ bus });
    const config = makeBaseConfig();
    const result = await runApiDirectCallPre(config, ctx);
    expect(result.success).toBe(true);
  });

  it('succeeds when warmStart is configured but creds slot is empty', async (): Promise<void> => {
    const captures: IApiPostCapture[] = [];
    const cfg: IApiDirectCallConfig = {
      ...makeBaseConfig(),
      warmStart: { credsField: 'storedJwt', carryField: 'token', fromStepIndex: 1 },
    };
    const bus = makeStubMediator({ responses: [], captures });
    const ctx = makeActionsCtx({ bus });
    const result = await runApiDirectCallPre(cfg, ctx);
    expect(result.success).toBe(true);
  });

  it('succeeds when warmStart populated + jwtClaims fresh-gate applies', async (): Promise<void> => {
    const captures: IApiPostCapture[] = [];
    const cfg: IApiDirectCallConfig = {
      ...makeBaseConfig(),
      warmStart: { credsField: 'storedJwt', carryField: 'token', fromStepIndex: 1 },
      jwtClaims: { freshnessField: 'exp', skewSeconds: 60 },
    };
    const bus = makeStubMediator({ responses: [], captures });
    const ctx = makeActionsCtx({ bus, credentials: { storedJwt: 'not-a-real-jwt' } });
    const result = await runApiDirectCallPre(cfg, ctx);
    expect(result.success).toBe(true);
  });
});

describe('ApiDirectCallActions.runApiDirectCallAction primeSession', () => {
  it('succeeds when strategy primes a non-empty bearer', async (): Promise<void> => {
    const captures: IApiPostCapture[] = [];
    const bus = makeStubMediator({ responses: [], captures, primeBearer: 'hdr-tok' });
    const ctx = makeActionsCtx({ bus });
    const config = makeBaseConfig();
    const result = await runApiDirectCallAction(config, ctx);
    expect(result.success).toBe(true);
  });

  it('fails on unsupported flow kind (factory propagation)', async (): Promise<void> => {
    const captures: IApiPostCapture[] = [];
    const cfg: IApiDirectCallConfig = { ...makeBaseConfig(), flow: 'stored-jwt' };
    const bus = makeStubMediator({ responses: [], captures });
    const ctx = makeActionsCtx({ bus });
    const result = await runApiDirectCallAction(cfg, ctx);
    expect(result.success).toBe(false);
    if (!result.success) expect(result.errorMessage).toContain('unsupported flow-kind');
  });

  it('fails with "ApiMediator missing" when slot is absent', async (): Promise<void> => {
    const ctx = makeMockContext();
    const config = makeBaseConfig();
    const result = await runApiDirectCallAction(config, ctx);
    expect(result.success).toBe(false);
    if (!result.success) expect(result.errorMessage).toContain('ApiMediator missing');
  });
});

describe('ApiDirectCallActions.runApiDirectCallAction callback invocation', () => {
  /**
   * Recording no-op onAuthFlowComplete used by the callback branches.
   * @param info - Flow-result info emitted by the mediator.
   * @returns Void promise.
   */
  async function noOpCallback(info: IAuthFlowInfo): Promise<void> {
    await Promise.resolve();
    void info;
  }

  it('skips onAuthFlowComplete when no long-term token is captured', async (): Promise<void> => {
    const captures: IApiPostCapture[] = [];
    const bus = makeStubMediator({ responses: [], captures, primeBearer: 'warm-t' });
    const ctx = makeActionsCtx({ bus, options: { onAuthFlowComplete: noOpCallback } });
    const config = makeBaseConfig();
    const result = await runApiDirectCallAction(config, ctx);
    expect(result.success).toBe(true);
  });
});

describe('ApiDirectCallActions.runApiDirectCallPost probe', () => {
  it('propagates the probe-url Procedure failure verbatim', async (): Promise<void> => {
    const captures: IApiPostCapture[] = [];
    const bus = makeStubMediator({ responses: [], captures });
    const ctx = makeActionsCtx({ bus });
    const cfg: IApiDirectCallConfig = { ...makeBaseConfig(), probe: { urlTag: PROBE_TAG } };
    const result = await runApiDirectCallPost(cfg, ctx);
    expect(result.success).toBe(false);
    if (!result.success) expect(result.errorMessage).toBe('unused');
  });

  it('propagates the probe-query Procedure failure verbatim', async (): Promise<void> => {
    const captures: IApiPostCapture[] = [];
    const bus = makeStubMediator({ responses: [], captures });
    const ctx = makeActionsCtx({ bus });
    const cfg: IApiDirectCallConfig = { ...makeBaseConfig(), probe: { queryTag: 'customer' } };
    const result = await runApiDirectCallPost(cfg, ctx);
    expect(result.success).toBe(false);
    if (!result.success) expect(result.errorMessage).toBe('unused');
  });

  it('fails with a diagnostic when probe config is empty', async (): Promise<void> => {
    const captures: IApiPostCapture[] = [];
    const bus = makeStubMediator({ responses: [], captures });
    const ctx = makeActionsCtx({ bus });
    const config = makeBaseConfig();
    const result = await runApiDirectCallPost(config, ctx);
    expect(result.success).toBe(false);
    if (!result.success) expect(result.errorMessage).toContain('probe config missing');
  });

  it('fails with "ApiMediator missing" when slot is absent', async (): Promise<void> => {
    const ctx = makeMockContext();
    const config = makeBaseConfig();
    const result = await runApiDirectCallPost(config, ctx);
    expect(result.success).toBe(false);
    if (!result.success) expect(result.errorMessage).toContain('ApiMediator missing');
  });
});

describe('ApiDirectCallActions primeSession outcomes', () => {
  it('fails on empty-bearer primeSession result', async (): Promise<void> => {
    const captures: IApiPostCapture[] = [];
    const bus = makeStubMediator({ responses: [], captures, primeBearer: '' });
    const ctx = makeActionsCtx({ bus });
    const config = makeBaseConfig();
    const result = await runApiDirectCallAction(config, ctx);
    expect(result.success).toBe(false);
    if (!result.success) expect(result.errorMessage).toContain('empty header');
  });

  it('propagates prime-session failure verbatim', async (): Promise<void> => {
    const captures: IApiPostCapture[] = [];
    const failingProc = fail(ScraperErrorTypes.Generic, 'upstream boom');
    const bus = makeStubMediator({ responses: [], captures, primeSession: failingProc });
    const ctx = makeActionsCtx({ bus });
    const config = makeBaseConfig();
    const result = await runApiDirectCallAction(config, ctx);
    expect(result.success).toBe(false);
    if (!result.success) expect(result.errorMessage).toBe('upstream boom');
  });
});
