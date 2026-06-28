/**
 * Integration test for the PayBox scrape shape end-to-end against
 * `createApiDirectScrapePhase`. Exercises the full PRE → ACTION → POST
 * walk with a router-backed mediator covering both account variants
 * (wallet via /getUserHistory + debit via /virtualCardTranRequest).
 *
 * Per `c:\tmp\guidelines\test-guidlines.md` ("integration test over
 * unit test, unit test for edge cases only") this is the primary
 * coverage surface for PayBox helpers (extractor + cursor +
 * urlTag dispatch). Edge cases (empty pages, missing session
 * context) are unit-pinned at the end of the file.
 */

import { jest } from '@jest/globals';

import { ScraperErrorTypes } from '../../../../../Scrapers/Base/ErrorTypes.js';
import { ONE_ZERO_SHAPE } from '../../../../../Scrapers/Pipeline/Banks/OneZero/scrape/OneZeroShape.js';
import { PAYBOX_SHAPE } from '../../../../../Scrapers/Pipeline/Banks/PayBox/scrape/PayBoxShape.js';
import {
  accountNumberOf,
  balanceExtract,
  balanceVars,
  customerVars,
  extractAccountsFromSessionContext,
  type IPayBoxAcct,
} from '../../../../../Scrapers/Pipeline/Banks/PayBox/scrape/PayBoxShapeHelpers.js';
import {
  type IPayBoxCursor,
  PAYBOX_TXNS_INTERNALS,
  txnsExtractPage,
} from '../../../../../Scrapers/Pipeline/Banks/PayBox/scrape/PayBoxShapeTxns.js';
import { PEPPER_SHAPE } from '../../../../../Scrapers/Pipeline/Banks/Pepper/scrape/PepperShape.js';
import type { IApiMediator } from '../../../../../Scrapers/Pipeline/Mediator/Api/ApiMediator.js';
import {
  buildApiDirectScrapePhase,
  createApiDirectScrapePhase,
} from '../../../../../Scrapers/Pipeline/Phases/ApiDirectScrape/ApiDirectScrapePhase.js';
import { some } from '../../../../../Scrapers/Pipeline/Types/Option.js';
import type {
  IActionContext,
  IPipelineContext,
} from '../../../../../Scrapers/Pipeline/Types/PipelineContext.js';
import type { Procedure } from '../../../../../Scrapers/Pipeline/Types/Procedure.js';
import { fail, succeed } from '../../../../../Scrapers/Pipeline/Types/Procedure.js';
import { assertHas, assertOk } from '../../../../Helpers/AssertProcedure.js';
import { makeMockContext, makeRecoverySessionStubs } from '../../Infrastructure/MockFactories.js';

const FIXT_UID = 'pb-uid-fixture-1';
const FIXT_DEVICE = 'fixt-device-pb-0001';
const FIXT_TOKEN = 'fixt-jwt-pb-0001';

/** PayBox session-context fixture used by extractAccountsFromSessionContext. */
const PAYBOX_SESSION: Readonly<Record<string, unknown>> = Object.freeze({
  uId: FIXT_UID,
  deviceId16Hex: FIXT_DEVICE,
  token: FIXT_TOKEN,
});

/** Route per-call apiPost dispatch via the WK URL tag. */
const URL_TAG_TO_OP: Readonly<Record<string, 'balance' | 'transactions'>> = {
  'data.sync': 'balance',
  'data.getUserHistory': 'transactions',
  'data.virtualCardTranRequest': 'transactions',
};

/**
 * Build a router-backed mock mediator pre-seeded with PayBox session.
 * @param router - Per-op ordered response queue.
 * @returns Mock mediator.
 */
function makePayBoxBus(router: Record<string, readonly Procedure<unknown>[]>): IApiMediator {
  const queues: Record<string, Procedure<unknown>[]> = {};
  for (const key of Object.keys(router)) queues[key] = [...router[key]];
  /**
   * Shift the queue for an operation, surfacing a clear failure when empty.
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
    ...makeRecoverySessionStubs(),
    getSessionContext: jest.fn((): Readonly<Record<string, unknown>> => PAYBOX_SESSION),
  } as unknown as IApiMediator;
}

/**
 * Build an IActionContext wired with the PayBox bus.
 * @param bus - Mock mediator.
 * @returns Action context.
 */
function ctxOf(bus: IApiMediator): IActionContext {
  const overrides: Partial<IPipelineContext> = { apiMediator: some(bus) };
  const base = makeMockContext(overrides);
  return base as unknown as IActionContext;
}

describe('PayBoxShape integration — wallet', () => {
  it('synthesises one wallet account from session-context and walks pagination once', async () => {
    const bus = makePayBoxBus({
      balance: [succeed({ content: { userFunds: { balance: 100 } } })],
      transactions: [
        // First call returns one row whose ts matches the initial cursor
        // sentinel `'null'` — the stall guard terminates pagination after
        // one fetch so the queue does not need a second page.
        succeed({ content: { nc: [{ ts: 'null' }] } }),
      ],
    });
    const phase = createApiDirectScrapePhase(PAYBOX_SHAPE);
    const ctx = ctxOf(bus);
    const result = await phase(ctx);
    assertOk(result);
    const scr = result.value.scrape;
    assertHas(scr);
    expect(scr.value.accounts).toHaveLength(1);
    expect(scr.value.accounts[0].accountNumber).toBe(FIXT_UID);
    expect(scr.value.accounts[0].balance).toBe(100);
  });

  it('returns zero accounts when session-context lacks uId', () => {
    const accts = extractAccountsFromSessionContext({ body: {}, sessionContext: {} });
    expect(accts).toHaveLength(0);
  });
});

describe('PayBoxShape helpers — bare data', () => {
  it('customerVars + balanceVars return empty maps', () => {
    const customerResult = customerVars();
    const balanceResult = balanceVars();
    expect(customerResult).toEqual({});
    expect(balanceResult).toEqual({});
  });

  it('accountNumberOf surfaces the wallet display number', () => {
    const acct: IPayBoxAcct = { accountNumber: FIXT_UID };
    const result = accountNumberOf(acct);
    expect(result).toBe(FIXT_UID);
  });

  it('balanceExtract reads content.userFunds.balance from /sync', () => {
    const body = { content: { userFunds: { balance: 73 } } };
    const result = balanceExtract(body);
    expect(result).toBe(73);
  });

  it('balanceExtract falls back to 0 when /sync structure is incomplete', () => {
    const result = balanceExtract({});
    expect(result).toBe(0);
  });
});

describe('PayBoxShape wallet pagination', () => {
  const walletAcct: IPayBoxAcct = { accountNumber: FIXT_UID };
  const ctx = { options: { startDate: new Date() } } as unknown as IActionContext;

  it('walletCursorOf seeds first-page cursor when input is false', () => {
    const cursor = PAYBOX_TXNS_INTERNALS.walletCursorOf(false);
    expect(cursor).toEqual({ ts: 'null', page: 0 });
  });

  it('walletCursorOf reuses existing wallet cursor on subsequent calls', () => {
    const existing: IPayBoxCursor = { ts: '999', page: 2 };
    const cursor = PAYBOX_TXNS_INTERNALS.walletCursorOf(existing);
    expect(cursor).toBe(existing);
  });

  it('nextWalletCursor returns false when items are empty', () => {
    const seed = { ts: 'null', page: 0 };
    const next = PAYBOX_TXNS_INTERNALS.nextWalletCursor(seed, []);
    expect(next).toBe(false);
  });

  it('nextWalletCursor returns false when oldest ts stalls', () => {
    const seed = { ts: '100', page: 0 };
    const items = [{ ts: '200' }, { ts: '100' }];
    const next = PAYBOX_TXNS_INTERNALS.nextWalletCursor(seed, items);
    expect(next).toBe(false);
  });

  it('nextWalletCursor advances to oldest ts when distinct', () => {
    const seed = { ts: 'null', page: 0 };
    const items = [{ ts: '200' }, { ts: '150' }];
    const next = PAYBOX_TXNS_INTERNALS.nextWalletCursor(seed, items);
    expect(next).toEqual({ ts: '150', page: 1 });
  });

  it('txnsExtractPage maps wallet rows + advances cursor', () => {
    const body = {
      content: {
        nc: [{ _id: 'a', ts: '2026-05-14T07:00:29.037Z', amt: 12, type: 'incomingTransaction' }],
      },
    };
    const page = txnsExtractPage({ body, cursor: false, acct: walletAcct, ctx });
    expect(page.items).toHaveLength(1);
    expect(page.nextCursor).toEqual({ ts: '2026-05-14T07:00:29.037Z', page: 1 });
  });

  it('txnsExtractPage returns empty + false cursor when content missing', () => {
    const page = txnsExtractPage({ body: {}, cursor: false, acct: walletAcct, ctx });
    expect(page.items).toHaveLength(0);
    expect(page.nextCursor).toBe(false);
  });
});

describe('PayBoxShape auth envelope', () => {
  it('buildAuthEnvelope copies uId/deviceId/token from session-context', () => {
    const bus = makePayBoxBus({});
    const ctx = ctxOf(bus);
    const envelope = PAYBOX_TXNS_INTERNALS.buildAuthEnvelope(ctx);
    expect(envelope.uId).toBe(FIXT_UID);
    expect(envelope.uuid).toBe(FIXT_DEVICE);
    expect(envelope.access_token).toBe(FIXT_TOKEN);
    expect(envelope.appVer).toBe('5.6.6');
    expect(envelope.type).toBe('pb');
    expect(envelope.os).toBe('android-13');
  });

  it('buildAuthEnvelope falls back to empty strings when session-context absent', () => {
    const envelope = PAYBOX_TXNS_INTERNALS.buildAuthEnvelope({
      apiMediator: { has: false },
    } as unknown as IActionContext);
    expect(envelope.uId).toBe('');
    expect(envelope.uuid).toBe('');
    expect(envelope.access_token).toBe('');
  });
});

describe('PayBoxShape mapWalletTxn — sign + status branches', () => {
  it('flips amount sign for outgoing-type rows', () => {
    const mapped = PAYBOX_TXNS_INTERNALS.mapWalletTxn({
      _id: 'fixt-0',
      ts: '2026-01-01T00:00:00.000Z',
      amt: 50,
      type: 'outgoingTransaction',
    });
    expect(mapped.chargedAmount).toBe(-50);
    expect(mapped.originalAmount).toBe(-50);
  });

  it('keeps incoming-type amount positive and maps `done` state to Completed', () => {
    const mapped = PAYBOX_TXNS_INTERNALS.mapWalletTxn({
      _id: 'fixt-1',
      ts: '2026-02-02T00:00:00.000Z',
      amt: 25,
      type: 'incomingTransaction',
      state: 'done',
    });
    expect(mapped.chargedAmount).toBe(25);
    expect(mapped.status).toBe('completed');
  });

  it('maps non-done state to Pending (only Completed/Pending are canonical)', () => {
    const mapped = PAYBOX_TXNS_INTERNALS.mapWalletTxn({
      _id: 'fixt-2',
      ts: '2026-03-03T00:00:00.000Z',
      amt: 10,
      type: 'incomingTransaction',
      state: 'pending',
    });
    expect(mapped.status).toBe('pending');
  });

  it('falls back to epoch when ts is invalid (server returned a malformed date)', () => {
    const mapped = PAYBOX_TXNS_INTERNALS.mapWalletTxn({
      _id: 'fixt-3',
      ts: 'not-a-date',
      amt: 1,
    });
    const epochIso = new Date(0).toISOString();
    expect(mapped.date).toBe(epochIso);
  });

  it('falls back to epoch when ts is omitted entirely', () => {
    const mapped = PAYBOX_TXNS_INTERNALS.mapWalletTxn({ _id: 'fixt-4', amt: 1 });
    const epochIso = new Date(0).toISOString();
    expect(mapped.date).toBe(epochIso);
  });
});

describe('PayBoxShape pagination terminators', () => {
  it('nextWalletCursor terminates at the page cap', () => {
    // page+1 === WALLET_PAGE_CAP triggers the cap-guard.
    const seed = { ts: 'seed', page: 23 };
    const items = [{ ts: 'newer' }];
    const next = PAYBOX_TXNS_INTERNALS.nextWalletCursor(seed, items);
    expect(next).toBe(false);
  });
});

describe('PayBoxShape result-guard (fail-closed) — PB-GUARD', () => {
  /**
   * Build a degraded PayBox scrape bus: the `/sync` balance call is
   * rejected (the masked 400) so `fallbackOnFail: 0` engages, and the
   * history page is empty — the exact silent-success shape the guard
   * converts into a loud, typed failure.
   * @returns Mock mediator pre-seeded for the degraded path.
   */
  function degradedBus(): IApiMediator {
    return makePayBoxBus({
      balance: [fail(ScraperErrorTypes.Generic, 'sync rejected (masked by fallbackOnFail)')],
      transactions: [succeed({ content: { nc: [] } })],
    });
  }

  /**
   * Run the PayBox scrape action then feed its scrape slot into a fresh
   * api-direct phase's POST stage (the production guard site).
   * @param bus - Pre-seeded mediator.
   * @returns POST-stage procedure (failure ⇒ guard fired).
   */
  async function postAfterScrape(bus: IApiMediator): Promise<Procedure<IPipelineContext>> {
    const scrapeFn = createApiDirectScrapePhase(PAYBOX_SHAPE);
    const ctx = ctxOf(bus);
    const scraped = await scrapeFn(ctx);
    assertOk(scraped);
    const phase = buildApiDirectScrapePhase(PAYBOX_SHAPE);
    const base = makeMockContext();
    const pctx: IPipelineContext = { ...base, scrape: scraped.value.scrape };
    return phase.post(pctx, pctx);
  }

  it('PB-GUARD-1 degraded warm token + zero txns FAILS the post stage', async () => {
    const bus = degradedBus();
    const result = await postAfterScrape(bus);
    expect(result.success).toBe(false);
    if (!result.success) expect(result.errorType).toBe(ScraperErrorTypes.Generic);
  });

  it('PB-GUARD-2 healthy wallet with zero txns does NOT fire (empty is legal)', async () => {
    const bus = makePayBoxBus({
      balance: [succeed({ content: { userFunds: { balance: 100 } } })],
      transactions: [succeed({ content: { nc: [] } })],
    });
    const result = await postAfterScrape(bus);
    expect(result.success).toBe(true);
  });

  it('PB-GUARD-2b healthy /sync returning balance 0 + zero txns does NOT fire (keys on outcome, not value)', async () => {
    const bus = makePayBoxBus({
      balance: [succeed({ content: { userFunds: { balance: 0 } } })],
      transactions: [succeed({ content: { nc: [] } })],
    });
    const result = await postAfterScrape(bus);
    expect(result.success).toBe(true);
  });

  it('PB-GUARD-5 happy path with mapped txns does NOT fire', async () => {
    const row = {
      _id: 'g5-1',
      ts: '2026-05-14T07:00:29.037Z',
      amt: 12,
      type: 'incomingTransaction',
    };
    const bus = makePayBoxBus({
      balance: [succeed({ content: { userFunds: { balance: 100 } } })],
      transactions: [succeed({ content: { nc: [row] } }), succeed({ content: { nc: [] } })],
    });
    const scrapeFn = createApiDirectScrapePhase(PAYBOX_SHAPE);
    const ctx = ctxOf(bus);
    const scraped = await scrapeFn(ctx);
    assertOk(scraped);
    assertHas(scraped.value.scrape);
    expect(scraped.value.scrape.value.accounts[0].txns.length).toBeGreaterThanOrEqual(1);
    const phase = buildApiDirectScrapePhase(PAYBOX_SHAPE);
    const base = makeMockContext();
    const pctx: IPipelineContext = { ...base, scrape: scraped.value.scrape };
    const result = await phase.post(pctx, pctx);
    expect(result.success).toBe(true);
  });

  it('PB-GUARD-3 guard is wired on PayBox only (OneZero + Pepper opt out)', () => {
    expect(typeof PAYBOX_SHAPE.resultGuard).toBe('function');
    expect(ONE_ZERO_SHAPE.resultGuard).toBeUndefined();
    expect(PEPPER_SHAPE.resultGuard).toBeUndefined();
  });

  it('PB-GUARD-4 same degraded scrape FAILS PayBox but PASSES OneZero', async () => {
    const bus = degradedBus();
    const scrapeFn = createApiDirectScrapePhase(PAYBOX_SHAPE);
    const ctx = ctxOf(bus);
    const scraped = await scrapeFn(ctx);
    assertOk(scraped);
    const base = makeMockContext();
    const pctx: IPipelineContext = { ...base, scrape: scraped.value.scrape };
    const payboxPhase = buildApiDirectScrapePhase(PAYBOX_SHAPE);
    const oneZeroPhase = buildApiDirectScrapePhase(ONE_ZERO_SHAPE);
    const payboxPost = await payboxPhase.post(pctx, pctx);
    const oneZeroPost = await oneZeroPhase.post(pctx, pctx);
    expect(payboxPost.success).toBe(false);
    expect(oneZeroPost.success).toBe(true);
  });

  it('PB-GUARD-6 absent balanceDegraded reads as not-degraded (guard stays silent)', async () => {
    const scrapeFn = createApiDirectScrapePhase(PAYBOX_SHAPE);
    const bus = makePayBoxBus({
      balance: [succeed({ content: { userFunds: { balance: 100 } } })],
      transactions: [succeed({ content: { nc: [] } })],
    });
    const ctx = ctxOf(bus);
    const scraped = await scrapeFn(ctx);
    assertOk(scraped);
    assertHas(scraped.value.scrape);
    // Rebuild the scrape slot WITHOUT balanceDegraded so the guard's
    // `scrape.balanceDegraded ?? false` exercises the undefined -> false branch:
    // an absent flag must read as not-degraded and keep the fail-closed guard silent.
    const { accounts } = scraped.value.scrape.value;
    const pctx: IPipelineContext = { ...makeMockContext(), scrape: some({ accounts }) };
    const result = await buildApiDirectScrapePhase(PAYBOX_SHAPE).post(pctx, pctx);
    expect(result.success).toBe(true);
  });
});
