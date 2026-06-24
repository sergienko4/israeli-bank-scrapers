/**
 * BALANCE-RESOLVE — bulk-seed shadow regression lock (FIBI/Beinleumi).
 *
 * <p>Reproduces the REAL FIBI/Beinleumi universal-miss root cause OFFLINE.
 * FIBI's SCRAPE emits a BULK balance template (no per-account substitution),
 * so {@link buildBalanceFetchPlan} produces a single plan entry keyed by
 * {@link BULK_KEY} — the SAME key the captured-pool seed
 * ({@link readCapturedBalanceResponses}) uses. The live re-fetch hits a
 * wrong endpoint (`/api/v2/auth/assert`) and returns HTTP 400 with a JSON
 * error body. The fetch layer captures any HTTP response as a "success"
 * (status recorded ⇒ `isOk`), so the 400 error body is stored under
 * {@link BULK_KEY} in the fetched map.
 *
 * <p>THE BUG: `mergeCaptured` merged as `new Map([...captured, ...fetched])`,
 * so the (balance-less) fetched error body OVERWROTE the captured seed's real
 * balance at {@link BULK_KEY}. By the time `extractOneCard` ran, the seed was
 * already gone — its keyed-vs-bulk fallback never fired — and every account
 * universal-missed (`resolved=0 missed=1 total=1`). That is the exact live
 * regression observed on 2026-06-19. The fix makes the merge balance-aware: a
 * fetched body overrides the captured seed only when it actually carries a
 * balance, so a wrong-endpoint / 4xx live response can never shadow the real
 * captured balance.
 *
 * <p>True regression lock: drives the REAL PRE → seal
 * ({@link buildActionContext}) → ACTION → POST chain and FAILS (universal-miss)
 * on the pre-fix `[...captured, ...fetched]` merge. Fake values only — no PII.
 */

import ScraperError from '../../../../../Scrapers/Base/ScraperError.js';
import {
  executeBalanceResolveAction,
  executeBalanceResolvePost,
  executeBalanceResolvePre,
} from '../../../../../Scrapers/Pipeline/Mediator/BalanceResolve/BalanceResolveActions.js';
import { buildActionContext } from '../../../../../Scrapers/Pipeline/Phases/Base/ActionContextBuilder.js';
import { some } from '../../../../../Scrapers/Pipeline/Types/Option.js';
import type {
  IAccountIdentity,
  IBalanceFetchTemplate,
  IPipelineContext,
} from '../../../../../Scrapers/Pipeline/Types/PipelineContext.js';
import { isOk, type Procedure } from '../../../../../Scrapers/Pipeline/Types/Procedure.js';
import { makeMockContext } from '../../Infrastructure/MockFactories.js';
import { makeMediatorWithPool, makePerUrlApi, makePool } from './BalancePoolHelpers.js';

/** FAKE clean FIBI balance body (mirrors the `transactions/balances` shape). No PII. */
const CLEAN_BALANCE = { withdrawableBalance: 12345.67, currentBalance: 12345.67 };

/** FAKE wrong-endpoint 400 body — captured as "success", carries NO balance. */
const AUTH_ASSERT_400 = {
  error_code: 11,
  error_message: "Parameter 'aid' was not found in 'query'",
  headers: [],
};

/** BULK template (no per-account substitution) — plan keys by BULK_KEY. */
const BULK_TEMPLATE: IBalanceFetchTemplate = {
  url: 'https://fibi.test/api/v2/auth/assert',
  method: 'POST',
};

/** The single bank-account id under test. */
const BA = 'BA-FIBI1';

/**
 * Build a one-account identity map.
 * @param ba - bankAccountUniqueId.
 * @returns Single-entry identity map keyed by the id.
 */
function oneIdentity(ba: string): ReadonlyMap<string, IAccountIdentity> {
  return new Map([[ba, { cardDisplayId: ba, cardUniqueId: `UID-${ba}`, bankAccountUniqueId: ba }]]);
}

/**
 * Build the PRE context: carried snapshot carries the real balance, the live
 * BULK re-fetch "succeeds" with the balance-less 400 body (mapped per-URL).
 * @returns Mock pipeline context for the bulk-seed shadow scenario.
 */
function makeCtx(): IPipelineContext {
  const accountIdentities = oneIdentity(BA);
  const scrape = some({
    accounts: [],
    accountIdentities,
    balanceFetchTemplate: BULK_TEMPLATE,
    balanceResponseBodies: [CLEAN_BALANCE] as readonly unknown[],
  });
  const pool = makePool([CLEAN_BALANCE]);
  const mediator = makeMediatorWithPool(pool);
  const liveBodies = new Map<string, unknown>([[BULK_TEMPLATE.url, AUTH_ASSERT_400]]);
  const perUrlApi = makePerUrlApi(liveBodies);
  const api = some(perUrlApi);
  const config = {
    urls: { base: 'https://fibi.test' },
    balanceKind: 'account' as const,
    authStrategyKind: 'token' as const,
  };
  return makeMockContext({ scrape, api, mediator, config });
}

/**
 * Drive the REAL PRE → seal → ACTION → POST chain.
 * @returns POST procedure (success or universal-miss failure).
 */
async function drivePost(): Promise<Procedure<IPipelineContext>> {
  const ctx = makeCtx();
  const pre = await executeBalanceResolvePre(ctx);
  if (!isOk(pre)) throw new ScraperError('PRE must succeed');
  const sealed = buildActionContext(pre.value);
  const action = await executeBalanceResolveAction(sealed);
  if (!isOk(action)) throw new ScraperError('ACTION must succeed');
  const acted = action.value as unknown as IPipelineContext;
  return executeBalanceResolvePost(acted);
}

describe('BALANCE-RESOLVE bulk-seed shadow (FIBI/Beinleumi)', () => {
  it('keeps the captured BULK_KEY balance when the live BULK re-fetch returns a balance-less body', async () => {
    const post = await drivePost();
    if (!isOk(post))
      throw new ScraperError('POST must succeed — captured balance must survive the merge');
    const report = post.value.balanceValidation;
    if (!report.has) throw new ScraperError('POST must commit a balanceValidation report');
    expect(report.value.totalAccounts).toBe(1);
    expect(report.value.resolvedIds.length).toBe(1);
  });
});
