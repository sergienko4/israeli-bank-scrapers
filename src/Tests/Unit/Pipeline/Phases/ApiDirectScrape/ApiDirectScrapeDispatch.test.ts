/**
 * Targeted coverage for ApiDirectScrapeDispatch (and the
 * ApiDirectScrapeBody helpers it delegates to) that the
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

import { ScraperErrorTypes } from '../../../../../Scrapers/Base/ErrorTypes.js';
import type {
  IApiMediator,
  IApiQueryOpts,
} from '../../../../../Scrapers/Pipeline/Mediator/Api/ApiMediator.js';
import type {
  IAesSignerConfig,
  IBodyDigestConfig,
} from '../../../../../Scrapers/Pipeline/Mediator/ApiDirectCall/ConfigContracts/index.js';
import { computeBodyDigest } from '../../../../../Scrapers/Pipeline/Mediator/ApiDirectCall/Crypto/BodyDigest.js';
import {
  dispatchStep,
  type IDispatchArgs,
} from '../../../../../Scrapers/Pipeline/Phases/ApiDirectScrape/ApiDirectScrapeDispatch.js';
import { literalUrl } from '../../../../../Scrapers/Pipeline/Registry/WK/UrlsWK.js';
import { writePostBody } from '../../../../../Scrapers/Pipeline/Strategy/Fetch/PostBody.js';
import type { ApiPostData } from '../../../../../Scrapers/Pipeline/Types/Domain/ApiPostData.js';
import { some } from '../../../../../Scrapers/Pipeline/Types/Option.js';
import type { IActionContext } from '../../../../../Scrapers/Pipeline/Types/PipelineContext.js';
import type { Procedure } from '../../../../../Scrapers/Pipeline/Types/Procedure.js';
import { fail, succeed } from '../../../../../Scrapers/Pipeline/Types/Procedure.js';
import { assertOk } from '../../../../Helpers/AssertProcedure.js';
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
    setSessionContext: jest.fn((): boolean => true),
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
    method: 'POST',
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

describe('ApiDirectScrapeDispatch.dispatchStep — REST GET branch', () => {
  it('routes GET steps to apiGet with the resolved url and no body', async () => {
    // A GET bank (Discount) declares `method: 'GET'`; the dispatcher must
    // call `apiGet` with the resolved URL and never touch `apiPost` (GET
    // carries its params in the path/query — there is no request body).
    const getOutcome = succeed({ ok: true });
    const getResp = Promise.resolve(getOutcome);
    const apiGet = jest.fn((): Promise<Procedure<unknown>> => getResp);
    const apiPost = jest.fn();
    const baseBus = makeOneShotBus(getOutcome);
    const bus = { ...baseBus, apiGet, apiPost } as unknown as IApiMediator;
    const url = literalUrl('https://start.telebank.co.il/Titan/gatewayAPI/userAccountsData');
    const args = makeDispatchArgs({ bus, method: 'GET', urlTag: url });
    const result = await dispatchStep(args);
    expect(result.success).toBe(true);
    expect(apiGet).toHaveBeenCalledTimes(1);
    const [dispatchedUrl] = apiGet.mock.calls[0] as unknown as [unknown];
    expect(dispatchedUrl).toBe('https://start.telebank.co.il/Titan/gatewayAPI/userAccountsData');
    expect(apiPost).not.toHaveBeenCalled();
  });

  it('forwards the step opts to apiGet as it does to apiPost', async () => {
    const getOutcome = succeed({ ok: true });
    const getResp = Promise.resolve(getOutcome);
    const apiGet = jest.fn((): Promise<Procedure<unknown>> => getResp);
    const baseBus = makeOneShotBus(getOutcome);
    const bus = { ...baseBus, apiGet } as unknown as IApiMediator;
    const opts = { extraHeaders: { cid: 'c-1' } };
    const url = literalUrl('https://api.bank.example/v1/items');
    const args = makeDispatchArgs({ bus, method: 'GET', urlTag: url, opts });
    await dispatchStep(args);
    const [, dispatchedOpts] = apiGet.mock.calls[0] as unknown as [unknown, unknown];
    expect(dispatchedOpts).toBe(opts);
  });
});

describe('ApiDirectScrapeDispatch.dispatchStep — shape body check', () => {
  it('fails a 2xx response whose body the shape check rejects', async () => {
    // A bank that reports an expired session inside an HTTP 200 body must
    // fail the call, not hand an empty body to the step's extractor.
    const expired = succeed({ Header: { Status: '-2' } });
    const bus = makeOneShotBus(expired);
    const rejection = fail(ScraperErrorTypes.Generic, 'session expired');
    const checkBody = jest.fn((): typeof rejection => rejection);
    const args = makeDispatchArgs({ bus, checkBody });
    const result = await dispatchStep(args);
    expect(result).toBe(rejection);
    expect(checkBody).toHaveBeenCalledWith({ Header: { Status: '-2' } });
  });

  it('passes a failed response through without running the check', async () => {
    const networkFailure = fail(ScraperErrorTypes.NetworkError, 'socket hang up');
    const bus = makeOneShotBus(networkFailure);
    const checkBody = jest.fn();
    const args = makeDispatchArgs({ bus, checkBody });
    const result = await dispatchStep(args);
    expect(result).toBe(networkFailure);
    expect(checkBody).not.toHaveBeenCalled();
  });
});

/** A transport failure quoting the bank's reply, as the classifier words it. */
const QUOTING_FAILURE = fail(
  ScraperErrorTypes.Generic,
  'GET https://api.bank.example/v1/items 500: SYN bank notice 7731',
);

describe('ApiDirectScrapeDispatch.dispatchStep — bank-text rule', () => {
  it.each([
    { label: 'the query tag', overrides: {}, message: 'customer HTTP 500' },
    { label: 'the call name', overrides: { call: 'accounts' }, message: 'accounts HTTP 500' },
  ])('names a failed call by $label and status only', async ({ overrides, message }) => {
    const bus = makeOneShotBus(QUOTING_FAILURE);
    const args = makeDispatchArgs({ bus, omitBankText: true, ...overrides });
    const result = await dispatchStep(args);
    expect(result).toEqual({ ...QUOTING_FAILURE, errorMessage: message });
  });

  it('keeps the transport message for a shape that does not omit bank text', async () => {
    const bus = makeOneShotBus(QUOTING_FAILURE);
    const args = makeDispatchArgs({ bus });
    const result = await dispatchStep(args);
    expect(result).toBe(QUOTING_FAILURE);
  });
});

/** One way a scrape step cannot take array vars, and how it says so. */
interface IArrayVarsRefusal {
  readonly name: string;
  readonly overrides: Partial<IDispatchArgs>;
  readonly message: string;
}

const ARRAY_VARS_REFUSALS: readonly IArrayVarsRefusal[] = [
  {
    name: 'a GraphQL step',
    overrides: { urlTag: false },
    message: 'scrape vars must be an object for GraphQL',
  },
  {
    name: 'a signed step',
    overrides: { signer: SCRAPE_SIGNER },
    message: 'scrape body signing needs an object',
  },
  {
    name: 'a body-template step',
    overrides: { bodyTemplate: { page: { $literal: 1 } } },
    message: 'scrape bodyTemplate needs object vars',
  },
];

describe('ApiDirectScrapeDispatch.dispatchStep — array POST data (N19)', () => {
  it('POSTs array vars unchanged on a plain REST step', async () => {
    const okOutcome = succeed({});
    const okResp = Promise.resolve(okOutcome);
    const apiPost = jest.fn((): Promise<Procedure<unknown>> => okResp);
    const baseBus = makeOneShotBus(okOutcome);
    const bus = { ...baseBus, apiPost } as unknown as IApiMediator;
    const vars = [
      { accountId: 'syn-account-1', amount: 12.5 },
      { accountId: 'syn-account-2', amount: 7 },
    ];
    const args = makeDispatchArgs({ bus, vars });
    const result = await dispatchStep(args);
    expect(result.success).toBe(true);
    const [, dispatchedBody] = apiPost.mock.calls[0] as unknown as [unknown, unknown];
    expect(dispatchedBody).toEqual(vars);
  });

  it.each(ARRAY_VARS_REFUSALS)('refuses array vars on $name', async refusal => {
    const apiPost = jest.fn();
    const apiQuery = jest.fn();
    const okOutcome = succeed({});
    const baseBus = makeOneShotBus(okOutcome);
    const bus = { ...baseBus, apiPost, apiQuery } as unknown as IApiMediator;
    const args = makeDispatchArgs({ bus, vars: [{ a: 1 }], ...refusal.overrides });
    const result = await dispatchStep(args);
    expect(result).toMatchObject({
      success: false,
      errorType: ScraperErrorTypes.Generic,
      errorMessage: refusal.message,
    });
    expect(apiPost).not.toHaveBeenCalled();
    expect(apiQuery).not.toHaveBeenCalled();
  });
});

const BODY_DIGEST: IBodyDigestConfig = {
  header: 'X-Body-Digest',
  prefix: 'App~1~',
  hash: 'sha256-hex',
  encode: 'base64',
};

/**
 * A bus-call recorder answering every call with the given response.
 * @param resp - Response every call resolves with.
 * @returns Recording mock.
 */
function makeRecorder(resp: Promise<Procedure<unknown>>): BusRecorderFn {
  return jest.fn<Promise<Procedure<unknown>>, unknown[]>((): Promise<Procedure<unknown>> => resp);
}

/** Recording mock for one bus call. */
type BusRecorderFn = jest.Mock<Promise<Procedure<unknown>>, unknown[]>;

/** The three bus calls a scrape step can make, each answering `{}`. */
interface ICapturingBus {
  readonly bus: IApiMediator;
  readonly apiPost: BusRecorderFn;
  readonly apiGet: BusRecorderFn;
  readonly apiQuery: BusRecorderFn;
}

/**
 * Build a bus whose POST, GET and GraphQL calls all answer `{}` and record
 * their arguments.
 * @returns The bus and its three recorders.
 */
function makeCapturingBus(): ICapturingBus {
  const okOutcome = succeed({});
  const okResp = Promise.resolve(okOutcome);
  const apiPost = makeRecorder(okResp);
  const apiGet = makeRecorder(okResp);
  const apiQuery = makeRecorder(okResp);
  const baseBus = makeOneShotBus(okOutcome);
  const bus = { ...baseBus, apiPost, apiGet, apiQuery } as unknown as IApiMediator;
  return { bus, apiPost, apiGet, apiQuery };
}

/** A step kind the digest skips, and where its opts reach the bus. */
interface IUndigestedStep {
  readonly name: string;
  readonly overrides: Partial<IDispatchArgs>;
  readonly call: 'apiPost' | 'apiGet' | 'apiQuery';
  readonly optsAt: number;
}

const UNDIGESTED_STEPS: readonly IUndigestedStep[] = [
  { name: 'a GET step', overrides: { method: 'GET' }, call: 'apiGet', optsAt: 1 },
  { name: 'an array POST step', overrides: { vars: [] }, call: 'apiPost', optsAt: 2 },
  { name: 'a GraphQL step', overrides: { urlTag: false }, call: 'apiQuery', optsAt: 2 },
];

describe('ApiDirectScrapeDispatch.dispatchStep — body digest (N30)', () => {
  it('hashes exactly the bytes the JSON writer sends', async () => {
    const capture = makeCapturingBus();
    const vars = { a: 'ש', n: 1 };
    const args = makeDispatchArgs({ bus: capture.bus, vars, bodyDigest: BODY_DIGEST });
    const result = await dispatchStep(args);
    expect(result.success).toBe(true);
    const [, sentBody, sentOpts] = capture.apiPost.mock.calls[0] as [
      unknown,
      ApiPostData,
      IApiQueryOpts,
    ];
    const written = writePostBody(sentBody);
    assertOk(written);
    const writtenBytes = Buffer.from(written.value.body, 'utf8');
    const expected = computeBodyDigest(writtenBytes, BODY_DIGEST);
    expect(sentOpts.extraHeaders).toEqual({ 'X-Body-Digest': expected });
  });

  it.each(UNDIGESTED_STEPS)('leaves the opts of $name untouched', async step => {
    const capture = makeCapturingBus();
    const opts = { extraHeaders: { cid: 'c-1' } };
    const overrides = { bus: capture.bus, opts, bodyDigest: BODY_DIGEST, ...step.overrides };
    const args = makeDispatchArgs(overrides);
    await dispatchStep(args);
    const sentOpts = capture[step.call].mock.calls[0][step.optsAt];
    expect(sentOpts).toBe(opts);
  });
});
