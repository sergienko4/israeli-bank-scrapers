/**
 * BALANCE-RESOLVE — multi-account card-bank regression lock (Mode B).
 *
 * <p>Reproduces the LIVE cross-bank regression that every offline/CI gate
 * missed: multi-account card banks (VisaCal, Isracard) whose captured pool
 * carries ONLY debit/billing AGGREGATES (`totalDebit`, `billingSumSekel`,
 * `totalIlsBillingDate`) and NO true account balance. Those aggregates are in
 * the broad {@link PIPELINE_BALANCE_ALIASES} list, so the broad evidence check
 * wrongly concluded a balance exists, HONOURED the SCRAPE live-fetch template,
 * and the per-account live re-fetch (a request-shape-picked endpoint that
 * either 200s with an unextractable deep body — VisaCal `getMonthlyDebitsSummary`
 * — or is rejected/quarantined — Isracard) resolved NOTHING → universal-miss
 * (total=N, missed=N) → BALANCE-RESOLVE POST FAIL under live E2E Real.
 *
 * <p>Faithful live condition (mirrors {@link BalanceResolveCrossBankSim}): the
 * mediator is withheld at BALANCE-RESOLVE.pre and the captured bodies are
 * carried on the SCRAPE-emitted scrape slice. Multi-account ⇒ the single-account
 * captured-seed rescue does NOT apply, so the futile re-fetch is the only path.
 *
 * <p>DESIRED post-fix behaviour (these banks NEVER had a true balance on main):
 * the narrow true-balance evidence check disproves a balance from the
 * aggregate-only pool → the template is suppressed → empty plan → soft no-op
 * (total=0, no miss) — main parity. This test FAILS on the pre-fix HEAD
 * (universal-miss) and PASSES after the narrow-evidence fix. Fake values only —
 * no PII; shapes derived from C:\tmp\runs\pipeline real captures.
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

/** One faithful multi-account card-bank shape. */
interface ICardBankShape {
  readonly bas: readonly string[];
  readonly template: IBalanceFetchTemplate;
  readonly pool: readonly unknown[];
  readonly success: ReadonlyMap<string, unknown>;
}

/**
 * Build a multi-account identity map keyed by bankAccountUniqueId.
 * @param bas - bankAccountUniqueId list.
 * @returns Identity map (one entry per id).
 */
function manyIdentities(bas: readonly string[]): ReadonlyMap<string, IAccountIdentity> {
  const entries = bas.map((ba): [string, IAccountIdentity] => [
    ba,
    { cardDisplayId: ba, cardUniqueId: `UID-${ba}`, bankAccountUniqueId: ba },
  ]);
  return new Map(entries);
}

/**
 * Build the PRE context for a multi-account card shape — mediator absent,
 * captured pool carried on the scrape slice (faithful live condition).
 * @param shape - Faithful card-bank shape.
 * @returns Mock pipeline context.
 */
function makeCardCtx(shape: ICardBankShape): IPipelineContext {
  const accountIdentities = manyIdentities(shape.bas);
  const scrape = some({
    accounts: [],
    accountIdentities,
    balanceFetchTemplate: shape.template,
    balanceResponseBodies: shape.pool,
  });
  const perUrlApi = makePerUrlApi(shape.success);
  const api = some(perUrlApi);
  return makeMockContext({
    scrape,
    api,
    mediator: none(),
    config: {
      urls: { base: 'https://test.bank' },
      balanceKind: 'card-cycle',
      authStrategyKind: 'token',
    },
  });
}

/**
 * Drive the REAL PRE → seal → ACTION → POST chain, returning the raw POST
 * procedure (so a universal-miss can be asserted, not thrown).
 * @param shape - Faithful card-bank shape.
 * @returns POST procedure (success or universal-miss failure).
 */
async function drivePost(shape: ICardBankShape): Promise<Procedure<IPipelineContext>> {
  const ctx = makeCardCtx(shape);
  const pre = await executeBalanceResolvePre(ctx);
  if (!isOk(pre)) throw new ScraperError('PRE must succeed');
  const sealed = buildActionContext(pre.value);
  const action = await executeBalanceResolveAction(sealed);
  if (!isOk(action)) throw new ScraperError('ACTION must succeed');
  return executeBalanceResolvePost(action.value as unknown as IPipelineContext);
}

/**
 * Drive the chain and unwrap the committed POST validation report. Throws
 * when the POST universal-misses (the pre-fix HEAD behaviour) so the soft
 * no-op assertions in each `it` only see the desired post-fix outcome.
 * @param shape - Faithful card-bank shape.
 * @returns POST validation report.
 */
async function drive(shape: ICardBankShape): Promise<IBalanceValidation> {
  const post = await drivePost(shape);
  if (!isOk(post)) throw new ScraperError('POST must succeed (not universal-miss)');
  const report = post.value.balanceValidation;
  if (!report.has) throw new ScraperError('POST must commit a balanceValidation report');
  return report.value;
}

/** VisaCal — pool carries only `totalDebit` (getBigNumberAndDetails). */
const VISACAL: ICardBankShape = {
  bas: ['VC-3201', 'VC-3202', 'VC-3203'],
  template: {
    url: 'https://api.cal-online.co.il/Card/getMonthlyDebitsSummary',
    method: 'POST',
    postBodyKey: 'bankAccountUniqueId',
  },
  pool: [
    {
      result: { bigNumbers: [{ totalDebits: [{ currencyCode: 376, totalDebit: 4107.44 }] }] },
      statusCode: 1,
    },
  ],
  success: new Map<string, unknown>([
    [
      'https://api.cal-online.co.il/Card/getMonthlyDebitsSummary',
      { result: { bankAccounts: [{ months: [{ totalDebits: [{ totalDebit: 4107.44 }] }] }] } },
    ],
  ]),
};

/** Isracard — pool carries only `billingSumSekel`; live re-fetch quarantined. */
const ISRACARD: ICardBankShape = {
  bas: ['IS-7701', 'IS-7702', 'IS-7703', 'IS-7704'],
  template: {
    url: 'https://web.isracard.co.il/ocp/transactions/DigitalV3',
    method: 'POST',
    postBodyKey: 'bankAccountUniqueId',
  },
  pool: [{ data: { billingSumSekel: 3500.5 }, statusCode: 200 }],
  success: new Map<string, unknown>(),
};

describe('BALANCE-RESOLVE multi-account card-bank regression lock', () => {
  it('VisaCal — aggregate-only pool + unextractable 200 re-fetch → soft no-op', async () => {
    const report = await drive(VISACAL);
    expect(report.totalAccounts).toBe(0);
    expect(report.missedIds).toHaveLength(0);
  });

  it('Isracard — aggregate-only pool + quarantined re-fetch → soft no-op', async () => {
    const report = await drive(ISRACARD);
    expect(report.totalAccounts).toBe(0);
    expect(report.missedIds).toHaveLength(0);
  });
});
