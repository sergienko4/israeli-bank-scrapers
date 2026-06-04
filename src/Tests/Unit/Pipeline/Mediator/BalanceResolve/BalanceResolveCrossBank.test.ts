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
 * Look up a scripted response by composite key (`url#bodyJson`).
 * Missing keys resolve to `null` so the extractor sees an empty body
 * and yields MISS. Shared by both POST and GET scripted fetches.
 * @param scripts - Map of (url+'#'+body) → response.
 * @param key - Composite key built from url + body.
 * @returns Procedure that always succeeds (null on miss).
 */
function lookupScripted(
  scripts: ReadonlyMap<string, unknown>,
  key: string,
): Promise<Procedure<unknown>> {
  const found = scripts.get(key) ?? null;
  const procedure = succeed(found);
  return Promise.resolve(procedure);
}

/**
 * Build the scripted `fetchPost` for `makeFakeApi`. Splits per §19.10
 * so the parent helper stays ≤10 lines.
 * @param scripts - Response scripts.
 * @returns POST fetch keyed by `url + '#' + JSON.stringify(body)`.
 */
function makeScriptedPost(
  scripts: ReadonlyMap<string, unknown>,
): (url: string, body: Record<string, unknown>) => Promise<Procedure<unknown>> {
  return (url: string, body: Record<string, unknown>): Promise<Procedure<unknown>> =>
    lookupScripted(scripts, `${url}#${JSON.stringify(body)}`);
}

/**
 * Build the scripted `fetchGet` for `makeFakeApi`. Splits per §19.10.
 * @param scripts - Response scripts.
 * @returns GET fetch keyed by `url + '#'`.
 */
function makeScriptedGet(
  scripts: ReadonlyMap<string, unknown>,
): (url: string) => Promise<Procedure<unknown>> {
  return (url: string): Promise<Procedure<unknown>> => lookupScripted(scripts, `${url}#`);
}

/**
 * Build a fake `IApiFetchContext` that returns scripted bodies keyed
 * by (url + '#' + JSON.stringify(body)). Missing keys resolve to
 * `succeed(null)` so the extractor sees an empty body and yields MISS.
 *
 * @param scripts - Map of (url+'#'+body) → response.
 * @returns Fake api context.
 */
function makeFakeApi(scripts: ReadonlyMap<string, unknown>): IApiFetchContext {
  const fetchPost = makeScriptedPost(scripts);
  const fetchGet = makeScriptedGet(scripts);
  return { fetchPost, fetchGet, transactionsUrl: false, balanceUrl: false } as IApiFetchContext;
}

/** Account stub shape consumed by the SCRAPE option. */
interface IAccountStub {
  accountNumber: string;
  balance: number;
  txns: never[];
}

/**
 * Build a single zero-balance, zero-txn account stub for a given identity.
 * @param id - Account identifier (map key).
 * @returns Placeholder account.
 */
function makeIAccountStub(id: string): IAccountStub {
  return { accountNumber: id, balance: 0, txns: [] };
}

/**
 * Build the zero-balance account stubs consumed by the SCRAPE option.
 * Split from buildInitialCtx per §19.10 (≤10 lines).
 * @param identities - Per-card identities (SCRAPE.post emission).
 * @returns One placeholder account per identity (balance 0, no txns).
 */
function buildAccountsFromIdentities(
  identities: ReadonlyMap<string, IAccountIdentity>,
): readonly IAccountStub[] {
  return [...identities.keys()].map(makeIAccountStub);
}

/** Payload bundled by SCRAPE for the PRE → ACTION accounts handoff. */
interface IScrapeOptionPayload {
  accounts: readonly IAccountStub[];
  accountIdentities: ReadonlyMap<string, IAccountIdentity>;
  balanceFetchTemplate: IBalanceFetchTemplate;
}

/**
 * Inner-payload builder for buildScrapeOption. Split out so the parent
 * stays ≤10 lines once prettier expands the explicit-typed literal.
 * @param identities - Per-card identities.
 * @param template - Fetch template.
 * @returns Payload to wrap in some().
 */
function buildScrapePayload(
  identities: ReadonlyMap<string, IAccountIdentity>,
  template: IBalanceFetchTemplate,
): IScrapeOptionPayload {
  const accounts = buildAccountsFromIdentities(identities);
  return { accounts, accountIdentities: identities, balanceFetchTemplate: template };
}

/**
 * Build the SCRAPE option that pre-seeds identities + template for PRE.
 * Split from buildInitialCtx per §19.10 (≤10 lines).
 * @param identities - Per-card identities (SCRAPE.post emission).
 * @param template - Fetch template (SCRAPE.post emission).
 * @returns Option<IScrapeOptionPayload> threaded into the initial context.
 */
function buildScrapeOption(
  identities: ReadonlyMap<string, IAccountIdentity>,
  template: IBalanceFetchTemplate,
): ReturnType<typeof some<IScrapeOptionPayload>> {
  const payload = buildScrapePayload(identities, template);
  return some(payload);
}

/**
 * Build the API option (scripted fake api wrapped in some()).
 * Split from buildInitialCtx per §19.10 (≤10 lines) and to dodge the
 * FORBIDDEN-NESTED-CALL rule.
 * @param scripts - Response scripts.
 * @returns Option<IApiFetchContext>.
 */
function buildApiOption(
  scripts: ReadonlyMap<string, unknown>,
): ReturnType<typeof some<IApiFetchContext>> {
  const fakeApi = makeFakeApi(scripts);
  return some(fakeApi);
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
  const scrape = buildScrapeOption(identities, template);
  const api = buildApiOption(scripts);
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
 * Run the ACTION → POST tail of the chain starting from a PRE-stage success.
 * Threads `actionResult.value` into POST and returns the POST-stage value
 * (CR cycle 2 fix — consumers read the post-stage shape).
 * @param preValue - The IPipelineContext returned by executeBalanceResolvePre.
 * @returns Discriminated stage outcome carrying the post-stage value.
 */
async function runActionPost(preValue: ActionOkValue): Promise<StageOutcome> {
  const actionResult = await executeBalanceResolveAction(preValue);
  if (!isOk(actionResult)) return { kind: 'fail' };
  const postCtx = actionResult.value as unknown as Parameters<typeof executeBalanceResolvePost>[0];
  const postResult = await executeBalanceResolvePost(postCtx);
  if (!isOk(postResult)) return { kind: 'fail' };
  return { kind: 'ok', value: postResult.value as unknown as ActionOkValue };
}

/**
 * Run pre → action → post and return the post-stage Ok value, or a
 * fail sentinel when any stage failed. Centralises the isOk-guard +
 * as-unknown-as recast pattern so the orchestrator stays branch-free
 * inside the test-helper statement cap.
 * @param ctx - Initial pipeline context.
 * @returns Discriminated stage outcome.
 */
async function runPreActionPost(ctx: ReturnType<typeof makeMockContext>): Promise<StageOutcome> {
  const preResult = await executeBalanceResolvePre(ctx);
  if (!isOk(preResult)) return { kind: 'fail' };
  return runActionPost(preResult.value as unknown as ActionOkValue);
}

/**
 * Extract the final `balanceExtracted` map from a successful pipeline
 * outcome. Returns the failure sentinel when the option is empty so
 * the caller stays branch-free.
 * @param outcome - Outcome from runPreActionPost.
 * @returns Extracted balance map or RUNCHAIN_FAILED.
 */
function extractBalanceMap(outcome: StageOutcome): ReadonlyMap<string, number | 'MISS'> {
  if (outcome.kind === 'fail') return RUNCHAIN_FAILED;
  if (!outcome.value.balanceExtracted.has) return RUNCHAIN_FAILED;
  return outcome.value.balanceExtracted.value;
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
  return extractBalanceMap(outcome);
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
      ['1111', { cardDisplayId: '1111', cardUniqueId: '1111', bankAccountUniqueId: '__BULK__' }],
      ['4444', { cardDisplayId: '4444', cardUniqueId: '4444', bankAccountUniqueId: '__BULK__' }],
    ]);
    const bulkBody = {
      data: {
        cardsList: [
          { cardSuffix: '1111', cardChargeNext: { billingSumSekel: '479.40' } },
          { cardSuffix: '4444', cardChargeNext: { billingSumSekel: '169.84' } },
        ],
      },
    };
    // Bulk template has no postBodyKey — the request body is `{}`.
    const bulkKey = `${AMEX_BULK_TEMPLATE.url}#${JSON.stringify({})}`;
    const bulkScripts = new Map<string, unknown>([[bulkKey, bulkBody]]);
    const out = await runChain(identities, AMEX_BULK_TEMPLATE, bulkScripts);
    const card1111 = out.get('1111');
    const card4444 = out.get('4444');
    expect(card1111).toBe(479.4);
    expect(card4444).toBe(169.84);
  });
});
