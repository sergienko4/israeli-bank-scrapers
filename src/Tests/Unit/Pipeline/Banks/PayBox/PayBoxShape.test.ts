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
import { succeed } from '../../../../../Scrapers/Pipeline/Types/Procedure.js';
import { assertHas, assertOk } from '../../../../Helpers/AssertProcedure.js';
import { makeMockContext } from '../../Infrastructure/MockFactories.js';
import { ctxOf, FIXT_DEVICE, FIXT_TOKEN, FIXT_UID, makePayBoxBus } from './PayBoxBusFactory.js';

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
    // Balance is a deterministic 0: the `/sync` fetch is skipped, so the
    // mocked response above is never consumed. Asserting 0 (not 100)
    // pins that the balance probe really is gone — a regression that
    // re-enabled it would return 100 and fail here.
    expect(scr.value.accounts[0].balance).toBe(0);
  });

  it('returns zero accounts when session-context lacks uId', () => {
    const accts = extractAccountsFromSessionContext({ body: {}, sessionContext: {} });
    expect(accts).toHaveLength(0);
  });
});

describe('PayBoxShape helpers — bare data', () => {
  it('customerVars returns an empty map (customer step skips the fetch)', () => {
    const customerResult = customerVars();
    expect(customerResult).toEqual({});
  });

  it('balanceVars sends NO auth envelope on /sync (session-poisoning guard)', () => {
    // REGRESSION GUARD — do not "fix" this by sending the envelope.
    // `/sync` is answered with HTTP 400 whatever the body contains, but
    // a 400 on a body carrying the live `access_token` makes PayBox
    // invalidate the session: the very next `/getUserHistory` returns
    // `401 UNAUTHORIZED` (`404 UNAUTHORIZED_TOKEN` on a warm token)
    // instead of rows — observed with a token minted well under a second
    // earlier by a successful `loginBySms`, refused immediately after
    // `/sync` 400'd, scraping 0 txns. With an empty body the 400 stays
    // inert, `fallbackOnFail: 0` degrades the balance, and the
    // transaction scrape still returns rows.
    const balanceResult = balanceVars();
    expect(balanceResult).toEqual({});
    expect(balanceResult).not.toHaveProperty('auth');
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
    const next = PAYBOX_TXNS_INTERNALS.nextWalletCursor(seed, [], []);
    expect(next).toBe(false);
  });

  it('nextWalletCursor returns false when oldest ts stalls', () => {
    const seed = { ts: '2024-01-01T00:00:00Z', page: 0 };
    const items = [{ ts: '2024-01-02T00:00:00Z' }, { ts: '2024-01-01T00:00:00Z' }];
    const next = PAYBOX_TXNS_INTERNALS.nextWalletCursor(seed, items, items);
    expect(next).toBe(false);
  });

  it('nextWalletCursor advances to oldest ts when distinct', () => {
    const seed = { ts: 'null', page: 0 };
    const items = [{ ts: '2024-01-02T00:00:00Z' }, { ts: '2024-01-01T00:00:00Z' }];
    const next = PAYBOX_TXNS_INTERNALS.nextWalletCursor(seed, items, items);
    expect(next).toMatchObject({ ts: '2024-01-01T00:00:00Z', page: 1 });
  });

  it('txnsExtractPage maps wallet rows + advances cursor', () => {
    const body = {
      content: {
        nc: [{ _id: 'a', ts: '2026-05-14T07:00:29.037Z', amt: 12, type: 'incomingTransaction' }],
      },
    };
    const page = txnsExtractPage({ body, cursor: false, acct: walletAcct, ctx });
    expect(page.items).toHaveLength(1);
    expect(page.nextCursor).toEqual({
      ts: '2026-05-14T07:00:29.037Z',
      page: 1,
      seenIds: ['a'],
    });
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
    expect(envelope.appVer).toBe('5.7.3');
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
  it('negates the magnitude for debit-type rows (pay)', () => {
    const mapped = PAYBOX_TXNS_INTERNALS.mapWalletTxn({
      _id: 'fixt-0',
      ts: '2026-01-01T00:00:00.000Z',
      amt: 50,
      type: 'pay',
    });
    expect(mapped.chargedAmount).toBe(-50);
    expect(mapped.originalAmount).toBe(-50);
  });

  it('negates the magnitude for a wallet purchase (money leaves the balance)', () => {
    const mapped = PAYBOX_TXNS_INTERNALS.mapWalletTxn({
      _id: 'fixt-0b',
      ts: '2026-01-02T00:00:00.000Z',
      amt: 30,
      type: 'purchase',
      state: 'clearance',
    });
    expect(mapped.chargedAmount).toBe(-30);
    expect(mapped.status).toBe('completed');
  });

  it('keeps credit-type amount positive and reads an absent state as Completed', () => {
    const mapped = PAYBOX_TXNS_INTERNALS.mapWalletTxn({
      _id: 'fixt-1',
      ts: '2026-02-02T00:00:00.000Z',
      amt: 25,
      type: 'incomingTransaction',
    });
    expect(mapped.chargedAmount).toBe(25);
    expect(mapped.status).toBe('completed');
  });

  it('keeps a top-up positive (money enters the balance)', () => {
    const mapped = PAYBOX_TXNS_INTERNALS.mapWalletTxn({
      _id: 'fixt-1b',
      ts: '2026-02-03T00:00:00.000Z',
      amt: 200,
      type: 'topUp',
    });
    expect(mapped.chargedAmount).toBe(200);
  });

  it('forces interest income positive even on a debit-looking type (subType wins)', () => {
    const mapped = PAYBOX_TXNS_INTERNALS.mapWalletTxn({
      _id: 'fixt-1c',
      ts: '2026-02-04T00:00:00.000Z',
      amt: 3,
      type: 'purchase',
      subType: 'interestIncome',
    });
    expect(mapped.chargedAmount).toBe(3);
  });

  it('maps a filtered purchase to Pending (not yet settled)', () => {
    const mapped = PAYBOX_TXNS_INTERNALS.mapWalletTxn({
      _id: 'fixt-2',
      ts: '2026-03-03T00:00:00.000Z',
      amt: 10,
      type: 'purchase',
      state: 'filtered',
    });
    expect(mapped.status).toBe('pending');
  });

  it('maps a rejected purchase to Pending', () => {
    const mapped = PAYBOX_TXNS_INTERNALS.mapWalletTxn({
      _id: 'fixt-2b',
      ts: '2026-03-04T00:00:00.000Z',
      amt: 10,
      type: 'purchase',
      state: 'rejected',
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
    const next = PAYBOX_TXNS_INTERNALS.nextWalletCursor(seed, items, items);
    expect(next).toBe(false);
  });
});

describe('PayBoxShape result-guard (fail-closed) — PB-GUARD', () => {
  /**
   * Build a REFUSED PayBox scrape bus: `/getUserHistory` answers with the
   * error envelope PayBox returns for a rejected read (`{code, name,
   * message}` and no `content`). Because the row reader only looks for
   * `content.nc`, this shape would otherwise pass as a legitimately empty
   * page and lose the run's data silently.
   *
   * <p>Replaces the former `degradedBus`, which forced the `/sync`
   * balance call to fail. That path is unreachable now the balance step
   * is `skipFetch: true`, so the scenario it stood for (a rejected read
   * masquerading as an empty wallet) is pinned here instead, where the
   * rejection is detected directly rather than inferred from the balance.
   * @returns Mock mediator pre-seeded for the refused path.
   */
  function refusedBus(): IApiMediator {
    return makePayBoxBus({
      balance: [succeed({ content: { userFunds: { balance: 0 } } })],
      transactions: [succeed({ code: '401', name: 'UNAUTHORIZED', message: 'refused' })],
    });
  }

  /**
   * Run the PayBox scrape and reduce it to a pass/fail verdict, treating
   * a thrown rejection and a failure Procedure alike — both are "loud".
   * @param bus - Pre-seeded mediator.
   * @returns Whether the scrape refused to produce a result.
   */
  async function scrapeVerdict(bus: IApiMediator): Promise<'failed' | 'succeeded'> {
    const scrapeFn = createApiDirectScrapePhase(PAYBOX_SHAPE);
    const ctx = ctxOf(bus);
    try {
      const scraped = await scrapeFn(ctx);
      return scraped.success ? 'succeeded' : 'failed';
    } catch {
      return 'failed';
    }
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

  it('PB-GUARD-1 a refused transactions page fails loudly, never as an empty page', async () => {
    const bus = refusedBus();
    const verdict = await scrapeVerdict(bus);
    expect(verdict).toBe('failed');
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

  it('PB-GUARD-4 a refusal fails while a genuinely empty page still succeeds', async () => {
    const emptyBus = makePayBoxBus({
      balance: [succeed({ content: { userFunds: { balance: 0 } } })],
      transactions: [succeed({ content: { nc: [] } })],
    });
    const refused = refusedBus();
    const refusedVerdict = await scrapeVerdict(refused);
    const emptyVerdict = await scrapeVerdict(emptyBus);
    expect([refusedVerdict, emptyVerdict]).toEqual(['failed', 'succeeded']);
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
