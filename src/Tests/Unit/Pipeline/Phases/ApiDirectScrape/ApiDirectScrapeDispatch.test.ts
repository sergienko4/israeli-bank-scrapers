/**
 * Targeted coverage for ApiDirectScrapeDispatch helpers that the
 * full-phase integration test cannot naturally reach. The scrape-phase
 * dispatcher's signer pipeline (`maybeSignBody` → `buildPrimedScrapeScope`
 * → `freshIvHex`) runs against the frozen `SCRAPE_CONFIG_SENTINEL`,
 * whose `secrets` slot is empty by design — so the signer branch
 * fails fast when invoked through {@link createApiDirectScrapePhase}
 * with a shape-root signer. This file exercises that branch directly,
 * plus the `asPlainObject` failure (bodyTemplate hydrates to non-object).
 *
 * Per test-guidlines.md: integration first, edge cases as unit tests —
 * the {@link dispatchStep} surface is the public seam the scrape phase
 * delegates to, so this is the natural boundary for those edges.
 */

import { jest } from '@jest/globals';

import type { IApiMediator } from '../../../../../Scrapers/Pipeline/Mediator/Api/ApiMediator.js';
import type { IAesSignerConfig } from '../../../../../Scrapers/Pipeline/Mediator/ApiDirectCall/IApiDirectCallConfig.js';
import {
  dispatchStep,
  type IDispatchArgs,
} from '../../../../../Scrapers/Pipeline/Phases/ApiDirectScrape/ApiDirectScrapeDispatch.js';
import { literalUrl } from '../../../../../Scrapers/Pipeline/Registry/WK/UrlsWK.js';
import { some } from '../../../../../Scrapers/Pipeline/Types/Option.js';
import type { IActionContext } from '../../../../../Scrapers/Pipeline/Types/PipelineContext.js';
import type { Procedure } from '../../../../../Scrapers/Pipeline/Types/Procedure.js';
import { succeed } from '../../../../../Scrapers/Pipeline/Types/Procedure.js';
import { makeMockContext } from '../../Infrastructure/MockFactories.js';

/** AES signer literal — keyRef points at the (empty) sentinel secrets. */
const SCRAPE_SIGNER: IAesSignerConfig = {
  algorithm: 'AES-CBC-PKCS7',
  keyRef: 'config.secrets.absent',
  ivStrategy: 'random-16',
  ivCarrySlot: 'sigIvHex',
  canonical: {
    parts: ['bodyJson'],
    separator: '|',
    escapeFrom: '|',
    escapeTo: String.raw`\|`,
    sortQueryParams: false,
    clientVersion: '1.0',
  },
  bodySignatureField: '/auth/signature',
};

/** Pre-built session-context returned by the bus stub. */
const STUB_SESSION: Readonly<Record<string, unknown>> = {};

/**
 * Stable getSessionContext used by every bus stub in this file.
 * @returns Frozen empty session-context.
 */
function stubSessionContext(): Readonly<Record<string, unknown>> {
  return STUB_SESSION;
}

/**
 * Build a bus whose apiPost resolves with the supplied procedure on
 * first call. Subsequent calls are not expected.
 * @param resp - Procedure the apiPost stub resolves with.
 * @returns Mock mediator.
 */
function makeOneShotBus(resp: Procedure<unknown>): IApiMediator {
  return {
    apiPost: jest.fn(async (): Promise<Procedure<unknown>> => {
      await Promise.resolve();
      return resp;
    }),
    apiGet: jest.fn(),
    apiQuery: jest.fn(),
    setBearer: jest.fn(),
    setRawAuth: jest.fn(),
    setSessionContext: jest.fn(),
    getSessionContext: jest.fn(stubSessionContext),
  } as unknown as IApiMediator;
}

/**
 * Build the dispatch-args bundle with the chosen body template + signer.
 * @param overrides - Partial dispatch-args overrides.
 * @returns Dispatch-args bundle.
 */
function makeDispatchArgs(overrides: Partial<IDispatchArgs>): IDispatchArgs {
  const defaultResp = succeed({});
  const bus = overrides.bus ?? makeOneShotBus(defaultResp);
  const base = makeMockContext({ apiMediator: some(bus) });
  const ctx = base as unknown as IActionContext;
  return {
    bus,
    ctx,
    queryTag: 'customer',
    urlTag: 'identity.deviceToken',
    vars: {},
    bodyTemplate: false,
    signer: false,
    opts: { extraHeaders: {} },
    ...overrides,
  };
}

describe('ApiDirectScrapeDispatch.dispatchStep — REST signer branch', () => {
  it('walks the signer pipeline (primedScope + IV seed + attach) and POSTs the body', async () => {
    // The scrape-phase dispatcher's `maybeSignBody` branch primes a
    // signing scope (buildPrimedScrapeScope → freshIvHex → tsMs) and
    // calls attachBodySignature. The signing helper reads
    // `scope.config.signer` from the SCRAPE_CONFIG_SENTINEL (no signer
    // on the sentinel), so the no-op short-circuit fires and the body
    // is POSTed unchanged. Beyond the success flag this test pins:
    //   1. apiPost was invoked exactly once.
    //   2. The hydrated `bodyTemplate` survives to the dispatched body
    //      (no template token leak).
    //   3. The original signer config is preserved (no in-place mutation).
    const okOutcome = succeed({});
    const okResp = Promise.resolve(okOutcome);
    const apiPost = jest.fn((): Promise<Procedure<unknown>> => okResp);
    const baseBus = makeOneShotBus(okOutcome);
    const bus = { ...baseBus, apiPost } as unknown as IApiMediator;
    const args = makeDispatchArgs({
      bus,
      bodyTemplate: { hello: { $literal: 'world' } },
      signer: SCRAPE_SIGNER,
    });
    const result = await dispatchStep(args);
    expect(result.success).toBe(true);
    expect(apiPost).toHaveBeenCalledTimes(1);
    const [, dispatchedBody] = apiPost.mock.calls[0] as unknown as [unknown, unknown];
    expect(dispatchedBody).toEqual({ hello: 'world' });
    expect(args.signer).toBe(SCRAPE_SIGNER);
  });

  it('fails when the bodyTemplate hydrates to a non-object value', async () => {
    // `asPlainObject` is the second failure mode: hydrate succeeds but
    // returns a scalar/array. Driving through dispatchStep is the only
    // public seam — the helper is intentionally module-private.
    const args = makeDispatchArgs({ bodyTemplate: { $literal: 42 } });
    const result = await dispatchStep(args);
    expect(result.success).toBe(false);
    if (!result.success) expect(result.errorMessage).toContain('did not hydrate to an object');
  });

  it('propagates bodyTemplate hydrate failures verbatim', async () => {
    const args = makeDispatchArgs({ bodyTemplate: { x: { $ref: 'carry.missing' } } });
    const result = await dispatchStep(args);
    expect(result.success).toBe(false);
    if (!result.success) expect(result.errorMessage).toContain('carry.missing');
  });

  it('uses bare vars as body when bodyTemplate is false', async () => {
    // `resolveStepBody` short-circuits with `succeed(args.vars)` when
    // the shape has no bodyTemplate — REST-style step with raw vars,
    // no hydration through the template engine.
    const args = makeDispatchArgs({
      vars: { account: 'A1', verb: 'fetch' },
      bodyTemplate: false,
    });
    const result = await dispatchStep(args);
    expect(result.success).toBe(true);
  });
});

describe('ApiDirectScrapeDispatch.dispatchStep — REST literal URL', () => {
  it('forwards an inline literal absolute URL to apiPost as the urlTag', async () => {
    // A browser bank declares its endpoint inline via `literalUrl(...)`
    // instead of a WK group. dispatchStep must forward that absolute URL
    // verbatim as apiPost's first arg (mediator passthrough resolves it).
    const okOutcome = succeed({});
    const okResp = Promise.resolve(okOutcome);
    const apiPost = jest.fn((): Promise<Procedure<unknown>> => okResp);
    const baseBus = makeOneShotBus(okOutcome);
    const bus = { ...baseBus, apiPost } as unknown as IApiMediator;
    const literalTag = literalUrl('https://api.example/v2/transactions');
    const args = makeDispatchArgs({ bus, urlTag: literalTag, vars: { page: 1 } });
    const result = await dispatchStep(args);
    expect(result.success).toBe(true);
    const [dispatchedTag] = apiPost.mock.calls[0] as unknown as [unknown];
    expect(dispatchedTag).toBe('https://api.example/v2/transactions');
  });
});
