/**
 * Unit coverage for the ApiDirectScrape BOOTSTRAP driver's step-list form:
 * steps run in declared order, each patch is merged into the session-context
 * before the next step dispatches, and the first failure stops the chain.
 * The single-step form is pinned by the PayBox bootstrap suites.
 */

import { jest } from '@jest/globals';

import { ScraperErrorTypes } from '../../../../../Scrapers/Base/ErrorTypes.js';
import ScraperError from '../../../../../Scrapers/Base/ScraperError.js';
import type { IApiMediator } from '../../../../../Scrapers/Pipeline/Mediator/Api/ApiMediator.js';
import runBootstrap from '../../../../../Scrapers/Pipeline/Phases/ApiDirectScrape/ApiDirectScrapeBootstrap.js';
import type { IDriverCtx } from '../../../../../Scrapers/Pipeline/Phases/ApiDirectScrape/ApiDirectScrapeDispatchArgs.js';
import type {
  ApiBody,
  IApiDirectScrapeBootstrapStep,
  IBootstrapExtractArgs,
  SessionContextPatch,
} from '../../../../../Scrapers/Pipeline/Phases/ApiDirectScrape/IApiDirectScrapeShape.js';
import { literalUrl } from '../../../../../Scrapers/Pipeline/Registry/WK/UrlsWK.js';
import { some } from '../../../../../Scrapers/Pipeline/Types/Option.js';
import type { Procedure } from '../../../../../Scrapers/Pipeline/Types/Procedure.js';
import { fail, succeed } from '../../../../../Scrapers/Pipeline/Types/Procedure.js';
import { makeMockContext } from '../../Infrastructure/MockFactories.js';

const LOGIN_URL = 'https://bank.example/login';
const PORTFOLIO_URL = 'https://bank.example/portfolio';
const LOGIN_OK = succeed({ pid: 'P-7' });
const PORTFOLIO_OK = succeed({ ior: 'IOR-1' });

/** One recorded apiPost call: the URL it hit and the body it sent. */
interface IPost {
  readonly url: string;
  readonly body: unknown;
}

/** A bus whose session-context is a real store, plus the posts it saw. */
interface IBootBus {
  readonly bus: IApiMediator;
  readonly posts: IPost[];
  readonly session: () => Readonly<Record<string, unknown>>;
}

/**
 * Build a bus that answers each URL from a fixed table and keeps the
 * session-context it is given, starting from a post-login identity.
 * @param answers - Response per URL.
 * @returns Bus, recorded posts and a session reader.
 */
function makeBootBus(answers: Readonly<Record<string, Procedure<ApiBody>>>): IBootBus {
  const posts: IPost[] = [];
  let session: Readonly<Record<string, unknown>> = { uId: 'u-1' };
  const apiPost = jest.fn(async (url: string, body: unknown): Promise<Procedure<ApiBody>> => {
    await Promise.resolve();
    posts.push({ url, body });
    return answers[url] ?? fail(ScraperErrorTypes.Generic, `no answer for ${url}`);
  });
  const setSessionContext = jest.fn((next: Readonly<Record<string, unknown>>): boolean => {
    session = next;
    return true;
  });
  /**
   * Read the session-context as last stored.
   * @returns Current session-context.
   */
  function readSession(): Readonly<Record<string, unknown>> {
    return session;
  }
  const getSessionContext = jest.fn(readSession);
  const bus = { apiPost, setSessionContext, getSessionContext } as unknown as IApiMediator;
  return { bus, posts, session: readSession };
}

/**
 * Empty request variables.
 * @returns Empty variables object.
 */
function noVars(): Record<string, never> {
  return {};
}

/**
 * Login patch: the portfolio id read from the login response.
 * @param args - Extract args.
 * @returns Patch carrying `portfolioId`.
 */
function loginPatch(args: IBootstrapExtractArgs): Procedure<SessionContextPatch> {
  const body = args.body as { readonly pid: string };
  return succeed({ portfolioId: body.pid });
}

/**
 * Portfolio patch: the IOR id read from the portfolio response.
 * @param args - Extract args.
 * @returns Patch carrying `portfolioIorId`.
 */
function portfolioPatch(args: IBootstrapExtractArgs): Procedure<SessionContextPatch> {
  const body = args.body as { readonly ior: string };
  return succeed({ portfolioIorId: body.ior });
}

/**
 * Login patch that cannot read the response it was given.
 * @returns A failed extraction.
 */
function refusedPatch(): Procedure<SessionContextPatch> {
  return fail(ScraperErrorTypes.Generic, 'no portfolio id');
}

/**
 * Login patch that throws before it can return a procedure.
 * @returns Never — always throws.
 */
function throwingPatch(): Procedure<SessionContextPatch> {
  throw new ScraperError('patch mapper exploded');
}

const LOGIN_STEP: IApiDirectScrapeBootstrapStep = {
  urlTag: literalUrl(LOGIN_URL),
  buildVars: noVars,
  extractPatch: loginPatch,
};

const PORTFOLIO_STEP: IApiDirectScrapeBootstrapStep = {
  urlTag: literalUrl(PORTFOLIO_URL),
  buildVars: noVars,
  bodyTemplate: { pid: { $ref: 'carry.portfolioId' } },
  extractPatch: portfolioPatch,
};

/**
 * Driver context whose shape declares the given bootstrap list.
 * @param bus - Mediator under test.
 * @param bootstrap - Bootstrap steps.
 * @returns Cast driver context (the driver reads only the bootstrap slots).
 */
function driverWith(
  bus: IApiMediator,
  bootstrap: readonly IApiDirectScrapeBootstrapStep[],
): IDriverCtx<unknown, unknown> {
  const base = makeMockContext({ apiMediator: some(bus) });
  const ctx = base;
  return { shape: { bootstrap }, bus, ctx } as unknown as IDriverCtx<unknown, unknown>;
}

describe('ApiDirectScrapeBootstrap/step list', () => {
  it('runs the steps in order, each seeing the patch before it', async () => {
    const boot = makeBootBus({ [LOGIN_URL]: LOGIN_OK, [PORTFOLIO_URL]: PORTFOLIO_OK });
    const d = driverWith(boot.bus, [LOGIN_STEP, PORTFOLIO_STEP]);
    const result = await runBootstrap(d);
    expect(result.success).toBe(true);
    const urls = boot.posts.map((p): string => p.url);
    expect(urls).toEqual([LOGIN_URL, PORTFOLIO_URL]);
    expect(boot.posts[1].body).toEqual({ pid: 'P-7' });
    const session = boot.session();
    expect(session).toEqual({ uId: 'u-1', portfolioId: 'P-7', portfolioIorId: 'IOR-1' });
  });

  it('stops at the first failed step and leaves the session alone', async () => {
    const refused = fail(ScraperErrorTypes.Generic, 'login refused');
    const boot = makeBootBus({ [LOGIN_URL]: refused, [PORTFOLIO_URL]: PORTFOLIO_OK });
    const d = driverWith(boot.bus, [LOGIN_STEP, PORTFOLIO_STEP]);
    const result = await runBootstrap(d);
    expect(result).toEqual(refused);
    expect(boot.posts).toHaveLength(1);
    const session = boot.session();
    expect(session).toEqual({ uId: 'u-1' });
  });

  it('stops when a step cannot extract its patch', async () => {
    const boot = makeBootBus({ [LOGIN_URL]: LOGIN_OK, [PORTFOLIO_URL]: PORTFOLIO_OK });
    const unreadable = { ...LOGIN_STEP, extractPatch: refusedPatch };
    const d = driverWith(boot.bus, [unreadable, PORTFOLIO_STEP]);
    const result = await runBootstrap(d);
    expect(result.success).toBe(false);
    expect(boot.posts).toHaveLength(1);
  });

  it('converts a throwing extractPatch into a typed failure', async () => {
    const boot = makeBootBus({ [LOGIN_URL]: LOGIN_OK, [PORTFOLIO_URL]: PORTFOLIO_OK });
    const throwing = { ...LOGIN_STEP, extractPatch: throwingPatch };
    const d = driverWith(boot.bus, [throwing, PORTFOLIO_STEP]);
    const result = await runBootstrap(d);
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.errorType).toBe(ScraperErrorTypes.Generic);
      expect(result.errorMessage).toBe('shape bootstrap.extractPatch threw: patch mapper exploded');
    }
    expect(boot.posts).toHaveLength(1);
  });

  it('treats an empty list as no bootstrap', async () => {
    const boot = makeBootBus({});
    const d = driverWith(boot.bus, []);
    const result = await runBootstrap(d);
    expect(result.success).toBe(true);
    expect(boot.posts).toHaveLength(0);
  });
});
