/**
 * A failed login step never quotes the response body (E15 / SEC-02).
 *
 * The table drives the sanitiser through runStep on a stub mediator. The
 * end-to-end cases send a body echoing synthetic secrets through the real
 * native transport and the real mediator, with every pipeline logger swapped
 * for a trace-level pino logger carrying the production redaction config.
 */

import { PassThrough } from 'node:stream';

import { jest } from '@jest/globals';
import pino, { type Logger, type LoggerOptions } from 'pino';

import { CompanyTypes } from '../../../../../../Definitions.js';
import { ScraperErrorTypes } from '../../../../../../Scrapers/Base/ErrorTypes.js';
import type { IWafErrorDetails } from '../../../../../../Scrapers/Base/Interfaces/WafErrorDetails.js';
import {
  getActiveLogContext,
  runWithBankContext,
} from '../../../../../../Scrapers/Pipeline/Logging/BankContext.js';
import { buildSilentOptions } from '../../../../../../Scrapers/Pipeline/Logging/RootLogger.js';
import type { ITokenStrategy } from '../../../../../../Scrapers/Pipeline/Mediator/Api/ITokenStrategy.js';
import type {
  IApiDirectCallConfig,
  IStepConfig,
} from '../../../../../../Scrapers/Pipeline/Mediator/ApiDirectCall/ConfigContracts/index.js';
import type { ITemplateScope } from '../../../../../../Scrapers/Pipeline/Mediator/ApiDirectCall/Template/RefResolver.js';
import type { GraphQLFetchStrategy } from '../../../../../../Scrapers/Pipeline/Strategy/Fetch/GraphQLFetchStrategy.js';
import type { ITokenBus } from '../../../../../../Scrapers/Pipeline/Types/Domain/TokenBus.js';
import type { IPipelineContext } from '../../../../../../Scrapers/Pipeline/Types/PipelineContext.js';
import type { Procedure } from '../../../../../../Scrapers/Pipeline/Types/Procedure.js';
import {
  fail,
  failWithDetails,
  succeed,
} from '../../../../../../Scrapers/Pipeline/Types/Procedure.js';
import { fakeFetch, type IFetchFake } from '../../../../../Helpers/FakeFetch.js';

/** Every serialized log line any pipeline module emitted. */
const LOG_LINES: string[] = [];

/**
 * Real pino logger at `trace`, production redaction, deterministic output.
 * @param production - Production pino options (redaction + mixin).
 * @returns Logger whose lines land in {@link LOG_LINES}.
 */
function makeCapturingLogger(production: LoggerOptions): Logger {
  const stream = new PassThrough();
  stream.on('data', (chunk: Buffer): number => {
    const line = chunk.toString();
    return LOG_LINES.push(line);
  });
  const options = { ...production, level: 'trace', timestamp: false, base: undefined };
  return pino(options, stream);
}

jest.unstable_mockModule('../../../../../../Scrapers/Pipeline/Logging/Debug.js', () => {
  const production = buildSilentOptions();
  const logger = makeCapturingLogger(production);
  /**
   * Every pipeline module shares the capturing logger.
   * @returns The capturing logger.
   */
  const getDebug = (): Logger => logger;
  return { getActiveLogContext, runWithBankContext, getDebug, getDebugByName: getDebug };
});

const RUN_STEP =
  await import('../../../../../../Scrapers/Pipeline/Mediator/ApiDirectCall/Flow/RunStep.js');
const MEDIATOR = await import('../../../../../../Scrapers/Pipeline/Mediator/Api/ApiMediator.js');
const NATIVE =
  await import('../../../../../../Scrapers/Pipeline/Strategy/Fetch/NativeFetchStrategy.js');
const URLS = await import('../../../../../../Scrapers/Pipeline/Registry/WK/UrlsWK.js');
const STUB = await import('./StubMediator.js');

type RealMediator = ReturnType<(typeof MEDIATOR)['createApiMediator']>;

const HINT = CompanyTypes.OneZero;
const BIND_URL = 'https://example.test/api/bind';

/** Synthetic request secrets the bank echoes back in its error body. */
const ECHOED_SECRETS = ['syn-pass-Q7x', 'syn-otp-864209', 'syn-device-55aa'] as const;
const ECHO_BODY = JSON.stringify({
  error: 'denied',
  password: ECHOED_SECRETS[0],
  otp: ECHOED_SECRETS[1],
  deviceId: ECHOED_SECRETS[2],
});

const PLAIN_CONFIG: IApiDirectCallConfig = {
  flow: 'sms-otp',
  steps: [],
  envelope: {},
  probe: { queryTag: 'customer' },
};

const BIND_STEP: IStepConfig = {
  name: 'bind',
  urlTag: 'auth.bind',
  body: { shape: {} },
  extractsToCarry: { token: '/access_token' },
};

const WAF_DETAILS: IWafErrorDetails = {
  provider: 'cloudflare',
  httpStatus: 403,
  pageTitle: 'Attention Required',
  pageUrl: BIND_URL,
  suggestions: [],
};

/** One transport failure and the safe message the step must report. */
interface IFailureCase {
  readonly label: string;
  readonly type: ScraperErrorTypes;
  readonly message: string;
  readonly expected: string;
}

const FAILURE_CASES: readonly IFailureCase[] = [
  {
    label: 'an HTTP failure echoing secrets',
    type: ScraperErrorTypes.Generic,
    message: `POST ${BIND_URL} 500: ${ECHO_BODY}`,
    expected: 'bind HTTP 500',
  },
  {
    label: 'a network failure',
    type: ScraperErrorTypes.Generic,
    message: `POST ${BIND_URL} network error: ECONNRESET`,
    expected: 'bind GENERIC',
  },
  {
    label: 'a timeout',
    type: ScraperErrorTypes.Timeout,
    message: `POST ${BIND_URL} network error: timeout`,
    expected: 'bind TIMEOUT',
  },
];

beforeAll((): void => {
  URLS.registerWkUrl('auth.bind', HINT, BIND_URL);
});

/**
 * Build an empty template scope.
 * @returns Template scope.
 */
function makeScope(): ITemplateScope {
  return { carry: {}, creds: {}, config: PLAIN_CONFIG, keypair: undefined };
}

/**
 * Run the bind step on a bus.
 * @param bus - Stub or real mediator.
 * @returns The step result.
 */
function runBind(bus: ITokenBus): Promise<Procedure<ITemplateScope>> {
  const scope = makeScope();
  return RUN_STEP.runStep({ step: BIND_STEP, bus, scope, companyId: HINT });
}

/**
 * List the echoed secrets a text quotes.
 * @param text - Error message or log output.
 * @returns Secrets found in the text.
 */
function leaksIn(text: string): string[] {
  return ECHOED_SECRETS.filter((secret): boolean => text.includes(secret));
}

/**
 * Point globalThis.fetch at a fake replying with the scripted statuses.
 * @param statuses - Status per call, oldest first; 2xx replies carry a token.
 * @returns The fake, for call assertions.
 */
function installFetch(statuses: readonly number[]): IFetchFake {
  const queue = [...statuses];
  const fake = fakeFetch((): Response => {
    const status = queue.shift() ?? 500;
    if (status === 200) return Response.json({ access_token: 'syn-token' });
    return new Response(ECHO_BODY, { status });
  });
  globalThis.fetch = fake.fetchImpl as typeof globalThis.fetch;
  return fake;
}

/**
 * Token strategy whose prime and refresh share one scripted answer.
 * @param refreshed - Result every primeInitial / primeFresh returns.
 * @returns Strategy stub.
 */
function refreshingStrategy(refreshed: Procedure<string>): ITokenStrategy<object> {
  /**
   * Prime and refresh share one scripted answer.
   * @returns The scripted result.
   */
  const prime = (): Promise<Procedure<string>> => Promise.resolve(refreshed);
  /**
   * No stored state — the retry layer is the only path to a refresh.
   * @returns False.
   */
  const hasWarmState = (): boolean => false;
  return { name: 'e15', primeInitial: prime, primeFresh: prime, hasWarmState };
}

/**
 * Real mediator over the real native transport, armed with a token strategy.
 * @param refreshed - Result the strategy's refresh returns.
 * @returns Mediator bound to the fake fetch.
 */
function makeRealMediator(refreshed: Procedure<string>): RealMediator {
  const graphql = {} as unknown as GraphQLFetchStrategy;
  const transport = new NATIVE.NativeFetchStrategy('https://example.test');
  const mediator = MEDIATOR.createApiMediator(HINT, transport, graphql);
  const strategy = refreshingStrategy(refreshed);
  const ctx = {} as unknown as IPipelineContext;
  mediator.withTokenStrategy(strategy, ctx, {});
  return mediator;
}

describe('E15 RunStep failure message', () => {
  it.each(FAILURE_CASES)('reports $label by step and status only', async (row): Promise<void> => {
    const responses = [fail(row.type, row.message)];
    const bus = STUB.makeStubMediator({ responses, captures: [] });
    const result = await runBind(bus);
    expect(result).toMatchObject({ success: false, errorType: row.type });
    expect(result).toMatchObject({ errorMessage: row.expected });
  });

  it('passes a WAF-blocked step through with its fixed reason', async (): Promise<void> => {
    const refused = failWithDetails(
      ScraperErrorTypes.WafBlocked,
      `POST ${BIND_URL} 403: blocked by Cloudflare edge (WAF) before reaching the API`,
      WAF_DETAILS,
    );
    const bus = STUB.makeStubMediator({ responses: [refused], captures: [] });
    const result = await runBind(bus);
    expect(result).toEqual(refused);
  });
});

describe('E15 SEC-02 through the native transport and the mediator', () => {
  const originalFetch = globalThis.fetch;

  beforeEach((): void => {
    LOG_LINES.length = 0;
  });

  afterEach((): void => {
    globalThis.fetch = originalFetch;
  });

  it('keeps an echoed secret out of the message and every log line', async (): Promise<void> => {
    installFetch([401, 401]);
    const refused = fail(ScraperErrorTypes.Generic, 'refresh refused');
    const bus = makeRealMediator(refused);
    const result = await runBind(bus);
    const emitted = LOG_LINES.join('\n');
    expect(result).toMatchObject({ success: false, errorMessage: 'bind HTTP 401' });
    expect(emitted).toContain('firePost FAIL');
    const exposed = JSON.stringify(result) + emitted;
    const leaked = leaksIn(exposed);
    expect(leaked).toEqual([]);
  });

  it('still lets the retry layer re-mint on the original 401', async (): Promise<void> => {
    const fake = installFetch([401, 200]);
    const minted = succeed('Bearer syn-fresh');
    const bus = makeRealMediator(minted);
    const result = await runBind(bus);
    expect(result.success).toBe(true);
    expect(fake.calls).toHaveLength(2);
  });
});
