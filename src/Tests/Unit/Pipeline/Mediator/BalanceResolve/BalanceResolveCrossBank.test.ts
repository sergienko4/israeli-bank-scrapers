/**
 * BALANCE-RESOLVE cross-bank factory (v6) — drives the live-fetch +
 * extract chain end-to-end with a fake `IApiFetchContext`.
 *
 * <p>Per `test-guidlines.md` "integration > unit; unit for edge cases
 * only": this file exercises ONE round-trip per shape family —
 * single-account (Hapoalim-class) + per-bank-account loop
 * (Visa-Cal-class) + bulk (Amex-class) — without the v5 fixture
 * pool walk. The v6 contract emits identities + template from SCRAPE,
 * so the cross-bank shape variance is in the API response body, not
 * in the attribution. The unit suite (BalanceResolveActionsV6.test.ts)
 * covers default-deny + quarantine + edge cases; this file pins the
 * per-shape happy path.
 */

import {
  executeBalanceResolveAction,
  executeBalanceResolvePost,
  executeBalanceResolvePre,
} from '../../../../../Scrapers/Pipeline/Mediator/BalanceResolve/BalanceResolveActions.js';
import { some } from '../../../../../Scrapers/Pipeline/Types/Option.js';
import type {
  IAccountIdentity,
  IApiFetchContext,
  IBalanceFetchTemplate,
} from '../../../../../Scrapers/Pipeline/Types/PipelineContext.js';
import { isOk, type Procedure, succeed } from '../../../../../Scrapers/Pipeline/Types/Procedure.js';
import { makeMockContext } from '../../Infrastructure/MockFactories.js';

/** Sentinel returned by runChain when a pipeline stage fails. */
const RUNCHAIN_FAILED: ReadonlyMap<string, number | 'MISS'> = new Map();

/**
 * Build a fake `IApiFetchContext` that returns scripted bodies keyed
 * by (url + '#' + JSON.stringify(body)). Missing keys resolve to
 * `succeed(null)` so the extractor sees an empty body and yields MISS.
 *
 * @param scripts - Map of (url+'#'+body) → response.
 * @returns Fake api context.
 */
function makeFakeApi(scripts: ReadonlyMap<string, unknown>): IApiFetchContext {
  /**
   * Scripted POST fetch — looks up by url + JSON body.
   *
   * @param url - URL.
   * @param body - JSON-encoded body.
   * @returns Scripted procedure (always succeed; null on miss).
   */
  const fetchPost = (url: string, body: Record<string, unknown>): Promise<Procedure<unknown>> => {
    const key = `${url}#${JSON.stringify(body)}`;
    const found = scripts.get(key) ?? null;
    const procedure = succeed(found);
    return Promise.resolve(procedure);
  };
  /**
   * Scripted GET fetch — looks up by url only.
   *
   * @param url - URL.
   * @returns Scripted procedure (always succeed; null on miss).
   */
  const fetchGet = (url: string): Promise<Procedure<unknown>> => {
    const key = `${url}#`;
    const found = scripts.get(key) ?? null;
    const procedure = succeed(found);
    return Promise.resolve(procedure);
  };
  return { fetchPost, fetchGet, transactionsUrl: false, balanceUrl: false } as IApiFetchContext;
}

/**
 * Build the initial PipelineContext consumed by the BALANCE-RESOLVE chain
 * (scrape + api options pre-seeded with identities + a scripted fake api).
 * @param identities - Per-card identities (SCRAPE.post emission).
 * @param template - Fetch template (SCRAPE.post emission).
 * @param scripts - API response scripts.
 * @returns Pipeline context ready for executeBalanceResolvePre.
 */
function buildInitialCtx(
  identities: ReadonlyMap<string, IAccountIdentity>,
  template: IBalanceFetchTemplate,
  scripts: ReadonlyMap<string, unknown>,
): ReturnType<typeof makeMockContext> {
  const accounts = [...identities.keys()].map(
    (id): { accountNumber: string; balance: number; txns: never[] } => ({
      accountNumber: id,
      balance: 0,
      txns: [],
    }),
  );
  const scrape = some({ accounts, accountIdentities: identities, balanceFetchTemplate: template });
  const fakeApi = makeFakeApi(scripts);
  const api = some(fakeApi);
  return makeMockContext({ scrape, api });
}

/** Action-stage Ok value (kept narrow for downstream type discrimination). */
type ActionOkValue = Extract<
  Awaited<ReturnType<typeof executeBalanceResolveAction>>,
  { success: true }
>['value'];

/** Discriminated stage outcome — fail-loud sentinel without null/undefined. */
type StageOutcome = { kind: 'ok'; value: ActionOkValue } | { kind: 'fail' };

/**
 * Run pre → action → post and return the action-stage Ok value, or a
 * fail sentinel when any stage failed. Centralises the isOk-guard +
 * as-unknown-as recast pattern so the orchestrator stays branch-free
 * inside the test-helper statement cap.
 * @param ctx - Initial pipeline context.
 * @returns Discriminated stage outcome.
 */
async function runPreActionPost(ctx: ReturnType<typeof makeMockContext>): Promise<StageOutcome> {
  const preResult = await executeBalanceResolvePre(ctx);
  if (!isOk(preResult)) return { kind: 'fail' };
  const actionCtx = preResult.value as unknown as Parameters<typeof executeBalanceResolveAction>[0];
  const actionResult = await executeBalanceResolveAction(actionCtx);
  if (!isOk(actionResult)) return { kind: 'fail' };
  const postCtx = actionResult.value as unknown as Parameters<typeof executeBalanceResolvePost>[0];
  const postResult = await executeBalanceResolvePost(postCtx);
  if (!isOk(postResult)) return { kind: 'fail' };
  return { kind: 'ok', value: actionResult.value };
}

/**
 * Run pre → action → post end-to-end with a fake api and given inputs.
 * Returns {@link RUNCHAIN_FAILED} when any stage fails so the caller
 * stays branch-free (no null/undefined returns).
 *
 * @param identities - Per-card identities (SCRAPE.post emission).
 * @param template - Fetch template (SCRAPE.post emission).
 * @param scripts - API response scripts.
 * @returns Final balanceExtracted map, or the failure sentinel.
 */
async function runChain(
  identities: ReadonlyMap<string, IAccountIdentity>,
  template: IBalanceFetchTemplate,
  scripts: ReadonlyMap<string, unknown>,
): Promise<ReadonlyMap<string, number | 'MISS'>> {
  const ctx = buildInitialCtx(identities, template, scripts);
  const outcome = await runPreActionPost(ctx);
  if (outcome.kind === 'fail') return RUNCHAIN_FAILED;
  if (!outcome.value.balanceExtracted.has) return RUNCHAIN_FAILED;
  return outcome.value.balanceExtracted.value;
}

const HAPOALIM_TEMPLATE: IBalanceFetchTemplate = {
  url: 'https://bank.example/balance/<ID>',
  method: 'GET',
  urlPathInterpolation: true,
};

const VISACAL_TEMPLATE: IBalanceFetchTemplate = {
  url: 'https://cal.example/getBigNumber',
  method: 'POST',
  postBodyKey: 'bankAccountUniqueId',
};

const AMEX_BULK_TEMPLATE: IBalanceFetchTemplate = {
  url: 'https://amex.example/GetCardList',
  method: 'POST',
};

describe('BALANCE-RESOLVE cross-bank factory — v6 happy paths', () => {
  it('single-account (Hapoalim shape) — GET path interpolation → currentBalance', async () => {
    const identities = new Map<string, IAccountIdentity>([
      ['ACC-1', { cardDisplayId: 'ACC-1', cardUniqueId: 'ACC-1', bankAccountUniqueId: 'ACC-1' }],
    ]);
    const scripts = new Map<string, unknown>([
      ['https://bank.example/balance/ACC-1#', { currentBalance: 150 }],
    ]);
    const out = await runChain(identities, HAPOALIM_TEMPLATE, scripts);
    const balance = out.get('ACC-1');
    expect(balance).toBe(150);
  });

  it('per-bank-account (Visa Cal shape) — POST loop with nested cards[].nextDebit', async () => {
    const identities = new Map<string, IAccountIdentity>([
      ['CARD-A', { cardDisplayId: 'CARD-A', cardUniqueId: 'UID-A', bankAccountUniqueId: 'BA-1' }],
      ['CARD-B', { cardDisplayId: 'CARD-B', cardUniqueId: 'UID-B', bankAccountUniqueId: 'BA-2' }],
    ]);
    const ba1Body = {
      result: {
        bigNumbers: [
          {
            cards: [
              {
                cardUniqueId: 'UID-A',
                nextDebit: { totalDebits: [{ currencyCode: 3, totalDebit: 100 }] },
              },
            ],
          },
        ],
      },
    };
    const ba2Body = {
      result: {
        bigNumbers: [
          {
            cards: [
              {
                cardUniqueId: 'UID-B',
                nextDebit: { totalDebits: [{ currencyCode: 3, totalDebit: 200 }] },
              },
            ],
          },
        ],
      },
    };
    const ba1Key = `${VISACAL_TEMPLATE.url}#${JSON.stringify({ bankAccountUniqueId: 'BA-1' })}`;
    const ba2Key = `${VISACAL_TEMPLATE.url}#${JSON.stringify({ bankAccountUniqueId: 'BA-2' })}`;
    const scripts = new Map<string, unknown>([
      [ba1Key, ba1Body],
      [ba2Key, ba2Body],
    ]);
    const out = await runChain(identities, VISACAL_TEMPLATE, scripts);
    const cardA = out.get('CARD-A');
    const cardB = out.get('CARD-B');
    expect(cardA).toBe(100);
    expect(cardB).toBe(200);
  });

  it('bulk (Amex shape) — single POST → multi-card cardChargeNext.billingSumSekel', async () => {
    const identities = new Map<string, IAccountIdentity>([
      ['8912', { cardDisplayId: '8912', cardUniqueId: '8912', bankAccountUniqueId: '__BULK__' }],
      ['1314', { cardDisplayId: '1314', cardUniqueId: '1314', bankAccountUniqueId: '__BULK__' }],
    ]);
    const bulkBody = {
      data: {
        cardsList: [
          { cardSuffix: '8912', cardChargeNext: { billingSumSekel: '479.40' } },
          { cardSuffix: '1314', cardChargeNext: { billingSumSekel: '169.84' } },
        ],
      },
    };
    // Bulk template has no postBodyKey — the request body is `{}`.
    const bulkKey = `${AMEX_BULK_TEMPLATE.url}#${JSON.stringify({})}`;
    const bulkScripts = new Map<string, unknown>([[bulkKey, bulkBody]]);
    const out = await runChain(identities, AMEX_BULK_TEMPLATE, bulkScripts);
    const card8912 = out.get('8912');
    const card1314 = out.get('1314');
    expect(card8912).toBe(479.4);
    expect(card1314).toBe(169.84);
  });
});
