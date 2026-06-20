/**
 * BALANCE-RESOLVE — evidence-gated regression locks.
 *
 * <p>Two regressions this branch introduced + fixed in-cluster:
 *
 * <p><b>Part A (Extract):</b> a wrong-endpoint live re-fetch that 200s
 * WITHOUT a balance must NOT shadow the captured pool's real balance.
 * The per-card extractor prefers the keyed response but falls back to the
 * captured BULK_KEY body whenever the keyed response carries no balance
 * (the Discount scenario: a non-balance 200 alongside a captured balance).
 *
 * <p><b>Part B (Pre config gate):</b> the live-fetch template is suppressed
 * unless the bank is declared a real account-balance bank
 * (`config.balanceKind === 'account'`). Card companies (`'card-cycle'`:
 * VisaCal/Max/Amex/Isracard) and not-yet-declared banks (absent) are a
 * deterministic no-op, so a credit-card billing aggregate can never be
 * misread as an account balance. This proves the gate fires on the
 * regression yet leaves the real live-fetch path (and its tests) intact.
 * Fake values only — no PII.
 */

import ScraperError from '../../../../../Scrapers/Base/ScraperError.js';
import {
  executeBalanceResolveAction,
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
import { makeMediatorWithPool, makePool } from './BalancePoolHelpers.js';

/** Captured body carrying a real balance (folded, no card record). */
const BALANCE_BODY = { BalanceDisplay: 150, items: [] };

/** A live 200 body from a wrong endpoint — carries no balance. */
const NO_BALANCE_BODY = { foo: 'bar', items: [] };

/** A live re-fetch body that DOES carry a (differing) balance. */
const KEYED_BALANCE_BODY = { BalanceDisplay: 200, items: [] };

const TEMPLATE: IBalanceFetchTemplate = {
  url: 'https://fake.bank/getBalance',
  method: 'POST',
  postBodyKey: 'bankAccountUniqueId',
  headers: { 'content-type': 'application/json' },
};

/** Single checking-account identity (fake ids). */
const SINGLE_IDENTITY: ReadonlyMap<string, IAccountIdentity> = new Map([
  ['ACCT-1', { cardDisplayId: 'ACCT-1', cardUniqueId: 'UID-1', bankAccountUniqueId: 'BA-1' }],
]);

/** SCRAPE state for the single-account fixtures (balance template present). */
const SINGLE_SCRAPE = some({
  accounts: [{ accountNumber: 'ACCT-1', balance: 0, txns: [] }],
  accountIdentities: SINGLE_IDENTITY,
  balanceFetchTemplate: TEMPLATE,
});

/** Action-context shape that {@link executeBalanceResolveAction} consumes. */
type ActionCtx = Parameters<typeof executeBalanceResolveAction>[0];

/**
 * Build an API whose every fetch SUCCEEDS with the given body (a wrong
 * endpoint that 200s but carries no balance).
 * @param body - Response body returned for every fetch.
 * @returns Fake API context returning the body.
 */
function makeOkApi(body: unknown): IApiFetchContext {
  const result = succeed(body);
  /**
   * Return the scripted body as a successful procedure.
   * @returns A succeeded procedure wrapping the body.
   */
  const ok = (): Promise<Procedure<unknown>> => Promise.resolve(result);
  const stub = { fetchPost: ok, fetchGet: ok, transactionsUrl: false, balanceUrl: false };
  return stub as unknown as IApiFetchContext;
}

/**
 * Run PRE then ACTION over a single-account context with the given pool +
 * api, returning the resolved balance for ACCT-1 (or 'MISS').
 * @param pool - Captured endpoint bodies.
 * @param api - API context for the live re-fetch.
 * @returns Resolved balance for ACCT-1, or 'MISS'.
 */
async function resolveSingle(pool: readonly unknown[], api: IApiFetchContext): Promise<unknown> {
  const endpoints = makePool(pool);
  const mediator = makeMediatorWithPool(endpoints);
  const ctx = makeMockContext({ scrape: SINGLE_SCRAPE, api: some(api), mediator });
  const pre = await executeBalanceResolvePre(ctx);
  if (!isOk(pre)) throw new ScraperError('PRE must succeed');
  const action = await executeBalanceResolveAction(pre.value as unknown as ActionCtx);
  if (!isOk(action)) throw new ScraperError('ACTION must succeed');
  const extracted = action.value.balanceExtracted;
  return extracted.has ? extracted.value.get('ACCT-1') : 'MISS';
}

describe('BALANCE-RESOLVE Part A — keyed 200 without balance falls back to BULK_KEY', () => {
  it('resolves the captured balance when the live re-fetch 200s with no balance', async () => {
    const api = makeOkApi(NO_BALANCE_BODY);
    const got = await resolveSingle([BALANCE_BODY], api);
    expect(got).toBe(150);
  });

  it('prefers the keyed balance over a differing captured pool balance', async () => {
    const api = makeOkApi(KEYED_BALANCE_BODY);
    const got = await resolveSingle([BALANCE_BODY], api);
    expect(got).toBe(200);
  });
});

/** SCRAPE state for the Part-B PRE fixtures (no accounts needed). */
const PLAN_SCRAPE = some({
  accounts: [],
  accountIdentities: SINGLE_IDENTITY,
  balanceFetchTemplate: TEMPLATE,
});

/** Mock pipeline context type returned by {@link makeMockContext}. */
type MockCtx = ReturnType<typeof makeMockContext>;

/**
 * Build a single-account PRE context declared with the given balance-kind.
 * The captured pool is irrelevant to the config gate, so none is wired.
 * @param balanceKind - Declared balance semantics ('account' resolves;
 *   'card-cycle' suppresses). Required — every bank states its kind.
 * @returns Mock pipeline context for PRE.
 */
function makeKindCtx(balanceKind: 'account' | 'card-cycle'): MockCtx {
  const config = { urls: { base: 'https://fake.bank' }, balanceKind };
  return makeMockContext({ scrape: PLAN_SCRAPE, config });
}

/**
 * Run PRE for the given balance-kind and report the committed plan length.
 * @param balanceKind - Declared balance semantics.
 * @returns Committed plan length (-1 when the plan option is absent).
 */
async function planLengthForKind(balanceKind: 'account' | 'card-cycle'): Promise<number> {
  const ctx = makeKindCtx(balanceKind);
  const pre = await executeBalanceResolvePre(ctx);
  if (!isOk(pre)) throw new ScraperError('PRE must succeed');
  const plan = pre.value.balanceFetchPlan;
  return plan.has ? plan.value.length : -1;
}

describe('BALANCE-RESOLVE Part B — config-driven balance-kind gate', () => {
  it('honours the template when the bank is declared an account bank', async () => {
    const length = await planLengthForKind('account');
    expect(length).toBeGreaterThan(0);
  });

  it('suppresses the template for a card-cycle bank', async () => {
    const length = await planLengthForKind('card-cycle');
    expect(length).toBe(0);
  });
});
