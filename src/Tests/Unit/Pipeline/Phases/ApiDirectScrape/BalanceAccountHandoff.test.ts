/**
 * Balance-step account handoff — unit coverage for {@link fetchBalance}.
 *
 * <p>`extract` receives the account alongside the response so a shape whose
 * balance already rode an earlier step can answer without a second call. Max
 * relies on this: its per-card cycle debit arrives on the `getHomePageData`
 * card object the customer step already read, so its balance step pairs
 * `skipFetch` with an `extract` that reads the account, not the body.
 *
 * <p>Without the handoff a `skipFetch` shape sees only `{}` and can do no
 * better than a constant — which is how every card issuer previously reported
 * 0 for every account. These tests pin the account through both branches, so
 * a regression that drops it (or hands over the wrong account while iterating)
 * fails here rather than silently reporting one card's balance for all of them.
 */

import type { IAcctCtx } from '../../../../../Scrapers/Pipeline/Phases/ApiDirectScrape/ApiDirectScrapeDispatchArgs.js';
import { fetchBalance } from '../../../../../Scrapers/Pipeline/Phases/ApiDirectScrape/ApiDirectScrapeSteps.js';
import type { ApiBody } from '../../../../../Scrapers/Pipeline/Phases/ApiDirectScrape/IApiDirectScrapeShape.js';
import { isOk } from '../../../../../Scrapers/Pipeline/Types/Procedure.js';

/** Account stand-in carrying its own balance, mirroring Max's card ref. */
interface ITestAcct {
  readonly id: string;
  readonly carried: number;
}

type Extractor = (body: ApiBody, acct: ITestAcct) => number;

/**
 * Build a per-account context whose balance step skips the fetch, so the test
 * exercises only the extract handoff.
 * @param acct - Account under assembly.
 * @param extract - Extractor stand-in.
 * @returns Minimal per-account context.
 */
function acctCtxWith(acct: ITestAcct, extract: Extractor): IAcctCtx<ITestAcct, number> {
  const balance = { skipFetch: true, extract };
  return { shape: { balance }, acct } as unknown as IAcctCtx<ITestAcct, number>;
}

/**
 * Read a balance procedure's value, or NaN when it failed.
 * @param result - Balance outcome procedure.
 * @returns Extracted balance.
 */
function balanceOf(result: Awaited<ReturnType<typeof fetchBalance<ITestAcct, number>>>): number {
  return isOk(result) ? result.value.value : Number.NaN;
}

/**
 * Extractor stand-in that answers from the account it was handed.
 * @param _body - Response body (unused; the fetch is skipped).
 * @param got - Account the driver handed over.
 * @returns The account's own carried balance.
 */
function readCarried(_body: ApiBody, got: ITestAcct): number {
  return got.carried;
}

describe('fetchBalance hands the account to extract', () => {
  it('passes the account through the skipFetch branch', async () => {
    const acct = { id: 'card-1234', carried: 13.84 };
    const a = acctCtxWith(acct, readCarried);
    const result = await fetchBalance(a);
    const balance = balanceOf(result);
    expect(balance).toBe(13.84);
  });

  it('passes each account its own balance rather than reusing the first', async () => {
    const firstCtx = acctCtxWith({ id: 'card-1234', carried: 13.84 }, readCarried);
    const secondCtx = acctCtxWith({ id: 'card-9999', carried: 250.5 }, readCarried);
    const first = await fetchBalance(firstCtx);
    const second = await fetchBalance(secondCtx);
    const firstBalance = balanceOf(first);
    const secondBalance = balanceOf(second);
    expect(firstBalance).toBe(13.84);
    expect(secondBalance).toBe(250.5);
  });

  it('identifies the account it was given, not merely some account', async () => {
    const seen: string[] = [];
    const a = acctCtxWith({ id: 'card-9999', carried: 7 }, (_body, got) => {
      seen.push(got.id);
      return got.carried;
    });
    await fetchBalance(a);
    expect(seen).toEqual(['card-9999']);
  });

  it('still yields an empty body to extract when the fetch is skipped', async () => {
    const bodies: ApiBody[] = [];
    const a = acctCtxWith({ id: 'card-1234', carried: 0 }, (body, got) => {
      bodies.push(body);
      return got.carried;
    });
    await fetchBalance(a);
    expect(bodies).toEqual([{}]);
  });

  it('reports the balance as undegraded when no fetch was needed', async () => {
    const a = acctCtxWith({ id: 'card-1234', carried: 13.84 }, readCarried);
    const result = await fetchBalance(a);
    const isDegraded = isOk(result) ? result.value.degraded : true;
    expect(isDegraded).toBe(false);
  });
});
