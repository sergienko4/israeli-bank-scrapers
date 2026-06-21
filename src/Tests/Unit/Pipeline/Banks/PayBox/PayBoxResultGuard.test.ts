/**
 * Fail-closed guard tests for the warm PayBox empty-result regression.
 *
 * A warm PayBox session can silently degrade: the cached token still
 * resolves an identity (≥1 account) but `/sync` is rejected (balance
 * falls back to 0 via `fallbackOnFail`) and `getUserHistory` returns
 * HTTP 200 with an empty body. On HEAD that path assembles a
 * valid-looking scrape of zero transactions and reports `success([])`
 * — indistinguishable, on the data alone, from a genuinely empty
 * wallet. The guard fires IFF identity present AND zero txns AND the
 * balance step DEGRADED, keying on the balance-step OUTCOME (not its
 * value, which is 0 in both cases).
 *
 * Pyramid (integration-over-unit, typed-mock mediator only — no real
 * network, no timers, PII-safe synthetic ids):
 *   TC1 — warm PayBox degraded + empty → fail closed (THE FIRE).
 *   TC2 — genuinely empty wallet (balance healthy) → no false positive.
 *   TC3 — OneZero at the exact firing condition → UNCHANGED (no fire).
 *   TC4 — Pepper at the exact firing condition → UNCHANGED (no fire).
 *   TC5 — healthy warm path with rows → success, guard untouched.
 * TC3/TC4 prove the guard is PayBox-config-scoped, never global.
 */

import { jest } from '@jest/globals';

import { ScraperErrorTypes } from '../../../../../Scrapers/Base/ErrorTypes.js';
import { PAYBOX_EMPTY_RESULT_MESSAGE } from '../../../../../Scrapers/Pipeline/Banks/PayBox/scrape/PayBoxResultGuard.js';
import { PAYBOX_SHAPE } from '../../../../../Scrapers/Pipeline/Banks/PayBox/scrape/PayBoxShape.js';
import type { IApiMediator } from '../../../../../Scrapers/Pipeline/Mediator/Api/ApiMediator.js';
import {
  buildApiDirectScrapePhase,
  createApiDirectScrapePhase,
} from '../../../../../Scrapers/Pipeline/Phases/ApiDirectScrape/ApiDirectScrapePhase.js';
import type { IApiDirectScrapeShape } from '../../../../../Scrapers/Pipeline/Phases/ApiDirectScrape/IApiDirectScrapeShape.js';
import { some } from '../../../../../Scrapers/Pipeline/Types/Option.js';
import type {
  IActionContext,
  IPipelineContext,
} from '../../../../../Scrapers/Pipeline/Types/PipelineContext.js';
import type { Procedure } from '../../../../../Scrapers/Pipeline/Types/Procedure.js';
import { fail, succeed } from '../../../../../Scrapers/Pipeline/Types/Procedure.js';
import { assertHas, assertOk } from '../../../../Helpers/AssertProcedure.js';
import { makeMockContext } from '../../Infrastructure/MockFactories.js';
import {
  ONEZERO_CASE,
  PEPPER_CASE,
} from '../../Phases/ApiDirectScrape/ApiDirectScrapeBankShapes.js';

/** PII-safe synthetic ids — no real token, account, or digit run ≥4. */
const FIXT_UID = 'pb-uid-guard';
const FIXT_DEVICE = 'pb-device-guard';
const FIXT_TOKEN = 'pb-token-guard';

/** PayBox session-context fixture used by extractAccountsFromSessionContext. */
const PAYBOX_SESSION: Readonly<Record<string, unknown>> = Object.freeze({
  uId: FIXT_UID,
  deviceId16Hex: FIXT_DEVICE,
  token: FIXT_TOKEN,
});

/** Pepper headers consult ctx.credentials.phoneNumber — provide one. */
const PEPPER_TEST_CREDENTIALS = {
  username: 'pepper-test-user',
  password: 'pepper-test-pass',
  phoneNumber: 'pepper-phone',
} as unknown as IPipelineContext['credentials'];

/** Route per-call apiPost dispatch via the WK URL tag (PayBox REST path). */
const URL_TAG_TO_OP: Readonly<Record<string, string>> = {
  'data.sync': 'balance',
  'data.getUserHistory': 'transactions',
  'data.virtualCardTranRequest': 'transactions',
};

/** Empty OneZero movements page — terminates pagination immediately. */
const ONEZERO_EMPTY_PAGE = {
  movements: { movements: [], pagination: { cursor: null, hasMore: false } },
};

/** Empty Pepper txn page — totalCount 0 terminates pagination immediately. */
const PEPPER_EMPTY_PAGE = {
  accounts: { oshTransactionsNew: { totalCount: 0, transactions: [], pendingTransactions: [] } },
};

/**
 * Build a router-backed mock mediator serving both transports: REST
 * (`apiPost`, routed via {@link URL_TAG_TO_OP}) for PayBox and GraphQL
 * (`apiQuery`, routed by op label) for OneZero/Pepper. Mocks the
 * external mediator only — no real network, no timers.
 * @param router - Per-op ordered response queue.
 * @param session - Session-context the shape reads (PayBox uId etc.).
 * @returns Mock mediator.
 */
function makeBus(
  router: Record<string, readonly Procedure<unknown>[]>,
  session: Readonly<Record<string, unknown>>,
): IApiMediator {
  const queues: Record<string, Procedure<unknown>[]> = {};
  for (const key of Object.keys(router)) queues[key] = [...router[key]];
  /**
   * Shift the queue for an operation, failing clearly when empty.
   * @param op - Operation label.
   * @returns Next queued procedure.
   */
  async function route(op: string): Promise<Procedure<unknown>> {
    await Promise.resolve();
    const q = queues[op] ?? [];
    const head = q.shift();
    if (head) return head;
    return fail(ScraperErrorTypes.Generic, `no stub for op=${op}`);
  }
  const apiPost = jest.fn((urlTag: string) => route(URL_TAG_TO_OP[urlTag] ?? 'customer'));
  return {
    apiPost,
    apiGet: jest.fn(),
    apiQuery: jest.fn(route),
    setBearer: jest.fn(),
    setRawAuth: jest.fn(),
    setSessionContext: jest.fn(),
    getSessionContext: jest.fn((): Readonly<Record<string, unknown>> => session),
  } as unknown as IApiMediator;
}

/**
 * Drive a shape through ACTION (typed scrape) then the phase POST stage
 * where the opt-in `resultGuard` runs. Returns the POST verdict.
 * @param shape - Bank shape under test.
 * @param bus - Pre-loaded mock mediator.
 * @param creds - Optional credentials override (Pepper).
 * @returns Procedure emitted by the POST stage.
 */
async function scrapeThenPost<TAcct, TCursor>(
  shape: IApiDirectScrapeShape<TAcct, TCursor>,
  bus: IApiMediator,
  creds?: IPipelineContext['credentials'],
): Promise<Procedure<IPipelineContext>> {
  const overrides = creds
    ? { apiMediator: some(bus), credentials: creds }
    : { apiMediator: some(bus) };
  const pctx = makeMockContext(overrides);
  const fn = createApiDirectScrapePhase(shape);
  const acted = await fn(pctx as unknown as IActionContext);
  assertOk(acted);
  const input: IPipelineContext = { ...pctx, scrape: acted.value.scrape };
  const phase = buildApiDirectScrapePhase(shape);
  return phase.post(input, input);
}

/**
 * Add `fallbackOnFail` so a rejected balance falls back (degrades) —
 * lets a cross-bank shape reproduce PayBox's exact firing condition.
 * @param shape - Bank shape to clone.
 * @returns Shape clone whose balance step degrades on failure.
 */
function withBalanceFallback<TAcct, TCursor>(
  shape: IApiDirectScrapeShape<TAcct, TCursor>,
): IApiDirectScrapeShape<TAcct, TCursor> {
  return { ...shape, balance: { ...shape.balance, fallbackOnFail: 0 } };
}

/**
 * Assert a message carries no PII per logging-pii-guidlines: no digit
 * run ≥4 (account/balance), and none of the synthetic token/ids leaked.
 * @param message - Failure message to inspect.
 * @returns True when the message passed every PII assertion.
 */
function assertPiiSafe(message: string): boolean {
  expect(message).not.toMatch(/\d{4,}/);
  expect(message).not.toContain(FIXT_UID);
  expect(message).not.toContain(FIXT_DEVICE);
  expect(message).not.toContain(FIXT_TOKEN);
  return true;
}

describe('PayBox fail-closed guard — warm empty-result regression', () => {
  it('TC1 — degraded warm session + zero rows → fails closed (PII-safe)', async () => {
    const bus = makeBus(
      {
        balance: [fail(ScraperErrorTypes.Generic, 'sync rejected')],
        transactions: [succeed({ content: { nc: [] } })],
      },
      PAYBOX_SESSION,
    );
    const posted = await scrapeThenPost(PAYBOX_SHAPE, bus);
    expect(posted.success).toBe(false);
    if (!posted.success) {
      expect(posted.errorType).toBe(ScraperErrorTypes.Generic);
      expect(posted.errorMessage).toBe(PAYBOX_EMPTY_RESULT_MESSAGE);
      assertPiiSafe(posted.errorMessage);
    }
  });

  it('TC2 — genuinely empty wallet (healthy balance) → no false positive', async () => {
    const bus = makeBus(
      {
        balance: [succeed({ content: { userFunds: { balance: 5 } } })],
        transactions: [succeed({ content: { nc: [] } })],
      },
      PAYBOX_SESSION,
    );
    const posted = await scrapeThenPost(PAYBOX_SHAPE, bus);
    expect(posted.success).toBe(true);
  });

  it('TC3 — OneZero at the exact firing condition → unchanged (no fire)', async () => {
    const shape = withBalanceFallback(ONEZERO_CASE.shape);
    const bus = makeBus(
      {
        customer: [succeed(ONEZERO_CASE.fixtures.customer)],
        balance: [fail(ScraperErrorTypes.Generic, 'sync rejected')],
        transactions: [succeed(ONEZERO_EMPTY_PAGE)],
      },
      {},
    );
    const posted = await scrapeThenPost(shape, bus);
    expect(posted.success).toBe(true);
  });

  it('TC4 — Pepper at the exact firing condition → unchanged (no fire)', async () => {
    const shape = withBalanceFallback(PEPPER_CASE.shape);
    const bus = makeBus(
      {
        customer: [succeed(PEPPER_CASE.fixtures.customer)],
        balance: [fail(ScraperErrorTypes.Generic, 'sync rejected')],
        transactions: [succeed(PEPPER_EMPTY_PAGE)],
      },
      {},
    );
    const posted = await scrapeThenPost(shape, bus, PEPPER_TEST_CREDENTIALS);
    expect(posted.success).toBe(true);
  });

  it('TC5 — healthy warm path with rows → success, guard untouched', async () => {
    const bus = makeBus(
      {
        balance: [succeed({ content: { userFunds: { balance: 7 } } })],
        transactions: [succeed({ content: { nc: [{ ts: 'null' }] } })],
      },
      PAYBOX_SESSION,
    );
    const posted = await scrapeThenPost(PAYBOX_SHAPE, bus);
    assertOk(posted);
    const scr = posted.value.scrape;
    assertHas(scr);
    expect(scr.value.accounts[0].txns).toHaveLength(1);
  });
});
