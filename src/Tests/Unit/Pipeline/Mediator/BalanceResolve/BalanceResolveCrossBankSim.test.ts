/**
 * BALANCE-RESOLVE — cross-bank Mode B simulator (full-chain regression).
 *
 * <p>Drives the REAL production PRE → seal ({@link buildActionContext}) →
 * ACTION → POST chain for four faithful single-account bank shapes, through
 * a per-URL-validating fetch context that 200s ONLY for the exact synthesized
 * live URL and 4xxs otherwise (modelling the live server rejecting a replay /
 * a quarantined redirect).
 *
 * <p>CRITICAL — faithful live condition: the mediator is withheld at
 * BALANCE-RESOLVE.pre (mediator: none) exactly as production does (the seal /
 * phase boundary drops the live network pool), and the captured response
 * bodies are carried on the SCRAPE-emitted scrape slice
 * ({@link IScrapeState.balanceResponseBodies}) — the channel SCRAPE.post
 * stamps. An earlier version of this simulator wired the mediator INTO the
 * PRE context, so the captured-seed fired off the live pool and the test
 * passed while production (no live pool at PRE) universal-missed.
 * Withholding the mediator here is what makes this a TRUE regression lock: the
 * `LIVE REGRESSION` case below proves that WITHOUT the carried pool the very
 * same chain universal-misses. Fake values only — no PII.
 *
 * <p>Expected per-bank outcomes (all PASS under the carried-pool fix):
 *   - Discount  — `'account'`; keyed 200 shadows balance; keyed-miss falls
 *                 back to the carried BULK_KEY balance → resolved=1.
 *   - VisaCal   — `'card-cycle'`; credit-card billing aggregates only, no
 *                 account balance → config gate suppresses → empty plan →
 *                 soft no-op → total=0 (the regression fix; balance stays
 *                 undefined, exact main-parity).
 *   - Leumi     — `'account'`; folded balance, live re-fetch quarantined →
 *                 BULK_KEY rescue → resolved=1.
 *   - Hapoalim  — `'account'`; separate balance endpoint, live re-fetch 4xx →
 *                 BULK_KEY rescue → resolved=1.
 */

import ScraperError from '../../../../../Scrapers/Base/ScraperError.js';
import {
  executeBalanceResolveAction,
  executeBalanceResolvePost,
  executeBalanceResolvePre,
} from '../../../../../Scrapers/Pipeline/Mediator/BalanceResolve/BalanceResolveActions.js';
import { buildActionContext } from '../../../../../Scrapers/Pipeline/Phases/Base/ActionContextBuilder.js';
import { none, some } from '../../../../../Scrapers/Pipeline/Types/Option.js';
import type {
  IAccountIdentity,
  IBalanceFetchTemplate,
  IBalanceValidation,
  IPipelineContext,
} from '../../../../../Scrapers/Pipeline/Types/PipelineContext.js';
import { isOk, type Procedure } from '../../../../../Scrapers/Pipeline/Types/Procedure.js';
import { makeMockContext } from '../../Infrastructure/MockFactories.js';
import { makePerUrlApi } from './BalancePoolHelpers.js';

/** One faithful single-account bank shape. */
interface IBankShape {
  readonly ba: string;
  readonly template: IBalanceFetchTemplate;
  readonly pool: readonly unknown[];
  readonly success: ReadonlyMap<string, unknown>;
  /** Declared balance semantics — required (every bank states its kind). */
  readonly balanceKind: 'account' | 'card-cycle';
}

/**
 * Build a one-account identity map for a bank-account id.
 * @param ba - bankAccountUniqueId.
 * @returns Single-entry identity map keyed by the id.
 */
function oneIdentity(ba: string): ReadonlyMap<string, IAccountIdentity> {
  return new Map([[ba, { cardDisplayId: ba, cardUniqueId: `UID-${ba}`, bankAccountUniqueId: ba }]]);
}

/**
 * Build the PRE context for one bank shape — faithful live condition:
 * mediator ABSENT (the seal drops the live pool), with the captured bodies
 * carried on the scrape slice (the SCRAPE.post channel).
 * @param shape - Faithful bank shape.
 * @param carryPool - Whether to carry the captured pool on scrape state.
 * @returns Mock pipeline context wired with the shape's carried pool + api.
 */
function makeShapeCtx(shape: IBankShape, carryPool: boolean): IPipelineContext {
  const accountIdentities = oneIdentity(shape.ba);
  const scrape = some({
    accounts: [],
    accountIdentities,
    balanceFetchTemplate: shape.template,
    balanceResponseBodies: carryPool ? shape.pool : undefined,
  });
  const perUrlApi = makePerUrlApi(shape.success);
  const api = some(perUrlApi);
  const config = {
    urls: { base: 'https://test.bank' },
    balanceKind: shape.balanceKind,
    authStrategyKind: 'token' as const,
  };
  return makeMockContext({ scrape, api, mediator: none(), config });
}

/**
 * Run the REAL PRE → seal → ACTION stages for one bank shape.
 * @param shape - Faithful bank shape.
 * @param carryPool - Whether to carry the captured pool on scrape state.
 * @returns Post-action context (throws if PRE or ACTION fails).
 */
async function runPreSealAction(shape: IBankShape, carryPool: boolean): Promise<IPipelineContext> {
  const ctx = makeShapeCtx(shape, carryPool);
  const pre = await executeBalanceResolvePre(ctx);
  if (!isOk(pre)) throw new ScraperError('PRE must succeed');
  const sealed = buildActionContext(pre.value);
  const action = await executeBalanceResolveAction(sealed);
  if (!isOk(action)) throw new ScraperError('ACTION must succeed');
  return action.value as unknown as IPipelineContext;
}

/**
 * Drive the REAL PRE → seal → ACTION → POST chain, returning the raw POST
 * procedure (so a universal-miss can be asserted, not thrown).
 * @param shape - Faithful bank shape.
 * @param carryPool - Whether to carry the captured pool on scrape state.
 * @returns POST procedure (success or universal-miss failure).
 */
async function drivePost(
  shape: IBankShape,
  carryPool: boolean,
): Promise<Procedure<IPipelineContext>> {
  const acted = await runPreSealAction(shape, carryPool);
  return executeBalanceResolvePost(acted);
}

/**
 * Drive the chain and unwrap the committed POST validation report.
 * @param shape - Faithful bank shape.
 * @returns POST validation report (throws if any stage fails).
 */
async function drive(shape: IBankShape): Promise<IBalanceValidation> {
  const post = await drivePost(shape, true);
  if (!isOk(post)) throw new ScraperError('POST must succeed (not universal-miss)');
  const report = post.value.balanceValidation;
  if (!report.has) throw new ScraperError('POST must commit a balanceValidation report');
  return report.value;
}

const DISCOUNT: IBankShape = {
  ba: 'BA-8812',
  balanceKind: 'account',
  template: {
    url: 'https://start.telebank.discountbank.co.il/getUserProfile/<ID>',
    method: 'GET',
    urlPathInterpolation: true,
  },
  pool: [
    { GetUserProfileEvent: { ProfileNo: 1 } },
    { CurrentAccountInfo: { AccountBalance: 19308.48 } },
  ],
  success: new Map<string, unknown>([
    [
      'https://start.telebank.discountbank.co.il/getUserProfile/BA-8812',
      { GetUserProfileEvent: { ProfileNo: 1 } },
    ],
  ]),
};

const VISACAL: IBankShape = {
  ba: 'BA-VC1',
  balanceKind: 'card-cycle',
  template: { url: 'https://api.cal-online.co.il/Transactions/getMonthlyDebits', method: 'POST' },
  pool: [{ totalDebit: 1234.5, billingSumSekel: 1234.5 }],
  success: new Map<string, unknown>(),
};

const LEUMI: IBankShape = {
  ba: 'BA-LE1',
  balanceKind: 'account',
  template: { url: 'https://hb2.bankleumi.co.il/UC_SO_27', method: 'POST' },
  pool: [
    { HistoryTransactionsItems: [{ DateUTC: '2026-06-17', Amount: 150 }], BalanceDisplay: 150 },
  ],
  success: new Map<string, unknown>(),
};

const HAPOALIM: IBankShape = {
  ba: 'BA-6347',
  balanceKind: 'account',
  template: {
    url: 'https://login.bankhapoalim.co.il/balanceAndCreditLimit?partyCurrentAccount=<ID>',
    method: 'GET',
    urlQueryKey: 'partyCurrentAccount',
  },
  pool: [{ currentBalance: 5000 }],
  success: new Map<string, unknown>(),
};

describe('BALANCE-RESOLVE cross-bank Mode B simulator', () => {
  it('Discount — keyed 200 without balance falls back to the captured balance', async () => {
    const report = await drive(DISCOUNT);
    expect(report.totalAccounts).toBe(1);
    expect(report.resolvedIds.length).toBe(1);
  });

  it('VisaCal — card-cycle bank → deterministic no-op (total=0, no miss)', async () => {
    const report = await drive(VISACAL);
    expect(report.totalAccounts).toBe(0);
    expect(report.missedIds.length).toBe(0);
  });

  it('Leumi — folded balance with a quarantined re-fetch resolves via BULK_KEY', async () => {
    const report = await drive(LEUMI);
    expect(report.totalAccounts).toBe(1);
    expect(report.resolvedIds.length).toBe(1);
  });

  it('Hapoalim — separate balance endpoint, 4xx re-fetch resolves via BULK_KEY', async () => {
    const report = await drive(HAPOALIM);
    expect(report.totalAccounts).toBe(1);
    expect(report.resolvedIds.length).toBe(1);
  });

  it('LIVE REGRESSION — an account bank without the carried pool universal-misses', async () => {
    const post = await drivePost(LEUMI, false);
    const isPostOk = isOk(post);
    expect(isPostOk).toBe(false);
  });
});
