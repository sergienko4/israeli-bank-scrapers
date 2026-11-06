/**
 * Whole-scrape auth recovery. A bank whose session rotates on every
 * answer cannot retry one rejected call: the retry would carry a session the
 * bank has already moved past. With `recoversWholeScrape()` on, the scrape
 * recovers only when the bank rejected the session (401/403, warm or cold),
 * re-grants it once and re-runs the whole scrape from its bootstrap. Every
 * other failure, a degraded success and a WAF block stand. Without the flag
 * the warm-session rule is unchanged.
 */

import { jest } from '@jest/globals';

import { ScraperErrorTypes } from '../../../../../Scrapers/Base/ErrorTypes.js';
import type { IApiMediator } from '../../../../../Scrapers/Pipeline/Mediator/Api/ApiMediator.js';
import { createApiDirectScrapePhase } from '../../../../../Scrapers/Pipeline/Phases/ApiDirectScrape/ApiDirectScrapePhase.js';
import type { ApiDirectScrapeResult } from '../../../../../Scrapers/Pipeline/Phases/ApiDirectScrape/ApiDirectScrapeTypes.js';
import type {
  IApiDirectScrapeBootstrapStep,
  IApiDirectScrapeShape,
} from '../../../../../Scrapers/Pipeline/Phases/ApiDirectScrape/IApiDirectScrapeShape.js';
import { literalUrl } from '../../../../../Scrapers/Pipeline/Registry/WK/UrlsWK.js';
import { some } from '../../../../../Scrapers/Pipeline/Types/Option.js';
import type { IActionContext } from '../../../../../Scrapers/Pipeline/Types/PipelineContext.js';
import type { Procedure } from '../../../../../Scrapers/Pipeline/Types/Procedure.js';
import { fail, succeed } from '../../../../../Scrapers/Pipeline/Types/Procedure.js';
import { assertHas, assertOk } from '../../../../Helpers/AssertProcedure.js';
import { makeMockContext } from '../../Infrastructure/MockFactories.js';
import { SYN_CASE } from './ApiDirectScrapeBankShapes.js';
import { makeRouterBus, type RouterQueues } from './ApiDirectScrapeRouterBus.js';

/** The bootstrap list, by step name. */
const BOOT_URLS = {
  login: 'https://bank.test/login',
  profile: 'https://bank.test/profile',
  portfolio: 'https://bank.test/portfolio',
} as const;

/** One scrape's calls, in order: three bootstrap steps, then the reads. */
const CALLS = [...Object.values(BOOT_URLS), 'customer', 'balance', 'transactions'];

const UNAUTHORIZED = fail(ScraperErrorTypes.Generic, 'POST https://bank.test 401: Unauthorized');
const FORBIDDEN = fail(ScraperErrorTypes.Generic, 'POST https://bank.test 403: Forbidden');
const UNAVAILABLE = fail(ScraperErrorTypes.Generic, 'POST https://bank.test 503: Unavailable');
const BANK_STATUS = fail(ScraperErrorTypes.Generic, 'balance bank status');
const SESSION_MISSING = fail(ScraperErrorTypes.Generic, 'login session state missing');
const WAF_BLOCK = fail(ScraperErrorTypes.WafBlocked, 'POST https://bank.test 403: Forbidden');

/** What every call answers when nothing goes wrong. */
const OK_ANSWERS: Readonly<Record<string, Procedure<unknown>>> = {
  [BOOT_URLS.login]: succeed({}),
  [BOOT_URLS.profile]: succeed({}),
  [BOOT_URLS.portfolio]: succeed({}),
  customer: succeed(SYN_CASE.fixtures.customer),
  balance: succeed(SYN_CASE.fixtures.balance),
  transactions: succeed(SYN_CASE.fixtures.transactions),
};

/**
 * A bootstrap step reads nothing from its answer.
 * @returns An empty patch.
 */
function emptyPatch(): Procedure<Record<string, never>> {
  return succeed({});
}

/**
 * A bootstrap step posts no variables.
 * @returns An empty vars map.
 */
function noVars(): Record<string, never> {
  return {};
}

/**
 * A bootstrap step posting to its own URL.
 * @param name - Step name.
 * @returns The bootstrap step.
 */
function bootStep(name: keyof typeof BOOT_URLS): IApiDirectScrapeBootstrapStep {
  const urlTag = literalUrl(BOOT_URLS[name]);
  return { name, urlTag, buildVars: noVars, extractPatch: emptyPatch };
}

const SYN_SHAPE = SYN_CASE.shape as IApiDirectScrapeShape<unknown, unknown>;

/** The synthetic reads behind a three-step bootstrap. */
const BOOT_SHAPE: IApiDirectScrapeShape<unknown, unknown> = {
  ...SYN_SHAPE,
  bootstrap: [bootStep('login'), bootStep('profile'), bootStep('portfolio')],
};

/**
 * Queue two scrapes' answers; `call` answers `first`, then `second`.
 * @param call - The call whose answers are replaced.
 * @param first - What that call answers first.
 * @param second - What it answers on a re-run (its usual answer by default).
 * @returns Router queues.
 */
function routerWith(
  call: string,
  first: Procedure<unknown>,
  second?: Procedure<unknown>,
): RouterQueues {
  const queues: Record<string, readonly Procedure<unknown>[]> = {};
  for (const key of CALLS) queues[key] = [OK_ANSWERS[key], OK_ANSWERS[key]];
  queues[call] = [first, second ?? OK_ANSWERS[call]];
  return queues;
}

/** Arguments for {@link makeRecoveryBus}. */
interface IRecoveryBusArgs {
  readonly router: RouterQueues;
  readonly isWarm: boolean;
  readonly isWholeScrape: boolean;
}

/** A recovery bus plus the recovery spy. */
interface IRecoveryHandle {
  readonly bus: IApiMediator;
  readonly recoverSession: jest.Mock;
}

/**
 * Router bus whose session is warm or cold, recovers per the flag, and
 * re-grants on request.
 * @param args - Router queues, warmth and recovery mode.
 * @returns The bus plus its recovery spy.
 */
function makeRecoveryBus(args: IRecoveryBusArgs): IRecoveryHandle {
  const bus = makeRouterBus(args.router);
  const regranted = succeed('Bearer regranted');
  const recoverSession = jest.fn((): Promise<Procedure<string>> => Promise.resolve(regranted));
  /**
   * The session's warmth for this case.
   * @returns Whether a stored session was resumed.
   */
  const wasSessionWarm = (): boolean => args.isWarm;
  /**
   * The recovery mode for this case.
   * @returns Whether the scrape recovers as a whole.
   */
  const recoversWholeScrape = (): boolean => args.isWholeScrape;
  Object.assign(bus, { recoverSession, wasSessionWarm, recoversWholeScrape });
  return { bus, recoverSession };
}

/**
 * Run the scrape phase over a bus.
 * @param bus - Recovery bus.
 * @param shape - Bank shape (the three-step bootstrap by default).
 * @returns The scrape outcome.
 */
async function scrapeOver(
  bus: IApiMediator,
  shape = BOOT_SHAPE,
): Promise<Procedure<ApiDirectScrapeResult>> {
  const ctx = makeMockContext({ apiMediator: some(bus) }) as unknown as IActionContext;
  const phase = createApiDirectScrapePhase(shape);
  return phase(ctx);
}

/**
 * How often the scrape posted to one URL.
 * @param bus - Recovery bus.
 * @param url - Bootstrap URL.
 * @returns The number of posts.
 */
function postsTo(bus: IApiMediator, url: string): number {
  const { calls } = jest.mocked(bus.apiPost).mock;
  return calls.filter(call => call[0] === url).length;
}

describe('whole-scrape recovery — one rejection anywhere re-runs the scrape', () => {
  it.each(CALLS)('a 401 at %s re-grants once and re-runs from the login', async call => {
    const router = routerWith(call, UNAUTHORIZED);
    const handle = makeRecoveryBus({ router, isWarm: false, isWholeScrape: true });
    const result = await scrapeOver(handle.bus);
    assertOk(result);
    expect(handle.recoverSession).toHaveBeenCalledTimes(1);
    const logins = postsTo(handle.bus, BOOT_URLS.login);
    expect(logins).toBe(2);
  });

  it.each(CALLS)('a second 401 at %s fails the scrape', async call => {
    const router = routerWith(call, UNAUTHORIZED, UNAUTHORIZED);
    const handle = makeRecoveryBus({ router, isWarm: true, isWholeScrape: true });
    const result = await scrapeOver(handle.bus);
    expect(result).toEqual(UNAUTHORIZED);
    expect(handle.recoverSession).toHaveBeenCalledTimes(1);
  });
});

describe('whole-scrape recovery — what triggers it', () => {
  it.each([
    ['warm', true],
    ['cold', false],
  ])('a %s session recovers from a 403', async (_label, isWarm) => {
    const router = routerWith('balance', FORBIDDEN);
    const handle = makeRecoveryBus({ router, isWarm, isWholeScrape: true });
    const result = await scrapeOver(handle.bus);
    assertOk(result);
    expect(handle.recoverSession).toHaveBeenCalledTimes(1);
  });

  it.each([
    ['a 5xx', UNAVAILABLE],
    ['a bank status', BANK_STATUS],
    ['an incomplete session', SESSION_MISSING],
    ['a WAF block', WAF_BLOCK],
  ])('a warm session does not recover from %s', async (_label, failure) => {
    const router = routerWith('balance', failure);
    const handle = makeRecoveryBus({ router, isWarm: true, isWholeScrape: true });
    const result = await scrapeOver(handle.bus);
    expect(result).toEqual(failure);
    expect(handle.recoverSession).not.toHaveBeenCalled();
  });

  it('a degraded warm success does not recover', async () => {
    const balance = { ...BOOT_SHAPE.balance, fallbackOnFail: 0 };
    const router = routerWith('balance', UNAVAILABLE);
    const handle = makeRecoveryBus({ router, isWarm: true, isWholeScrape: true });
    const result = await scrapeOver(handle.bus, { ...BOOT_SHAPE, balance });
    assertOk(result);
    assertHas(result.value.scrape);
    expect(result.value.scrape.value.balanceDegraded).toBe(true);
    expect(handle.recoverSession).not.toHaveBeenCalled();
  });
});

describe('per-request recovery — the warm-session rule is unchanged', () => {
  it('a cold session does not recover from a 401', async () => {
    const router = routerWith('balance', UNAUTHORIZED);
    const handle = makeRecoveryBus({ router, isWarm: false, isWholeScrape: false });
    const result = await scrapeOver(handle.bus);
    expect(result).toEqual(UNAUTHORIZED);
    expect(handle.recoverSession).not.toHaveBeenCalled();
  });

  it('a warm session recovers from a 5xx', async () => {
    const router = routerWith('balance', UNAVAILABLE);
    const handle = makeRecoveryBus({ router, isWarm: true, isWholeScrape: false });
    const result = await scrapeOver(handle.bus);
    assertOk(result);
    expect(handle.recoverSession).toHaveBeenCalledTimes(1);
  });
});
