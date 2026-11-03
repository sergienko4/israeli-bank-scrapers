/**
 * Edge coverage for ApiDirectScrapeDispatchArgs URL-tag resolvers that
 * the full-phase integration test cannot naturally reach: the optional
 * customer secondary-identity producer (declared only by a couple of
 * banks) and the balance-step producer form. Minimal driver contexts are
 * cast in because these resolvers read only the shape's urlTag slots.
 * Also pins the per-account header call info.
 */

import { jest } from '@jest/globals';

import type { IApiQueryOpts } from '../../../../../Scrapers/Pipeline/Mediator/Api/ApiMediator.js';
import {
  buildBalanceDispatchArgs,
  buildBootstrapDispatchArgs,
  buildCustomerDispatchArgs,
  buildSecondaryOpts,
  buildTxnsDispatchArgs,
  type IAcctCtx,
  type IDriverCtx,
  resolveSecondaryUrlTag,
} from '../../../../../Scrapers/Pipeline/Phases/ApiDirectScrape/ApiDirectScrapeDispatchArgs.js';
import type {
  ApiDirectScrapeHeadersLike,
  HeaderMap,
  IApiDirectScrapeBootstrapStep,
  IScrapeCallInfo,
} from '../../../../../Scrapers/Pipeline/Phases/ApiDirectScrape/IApiDirectScrapeShape.js';
import type { IActionContext } from '../../../../../Scrapers/Pipeline/Types/PipelineContext.js';
import { succeed } from '../../../../../Scrapers/Pipeline/Types/Procedure.js';

/** Account number the fixture shape reports for its one account. */
const ACCOUNT_ID = '0123456789';

/** Action context the fixture driver hands to header producers. */
const CTX = { tag: 'ctx' } as unknown as IActionContext;

/** One header-producer invocation, as the producer saw it. */
interface ISeenCall {
  readonly ctx: IActionContext;
  readonly call: IScrapeCallInfo;
}

/** A step builder reduced to the options it sends. */
type OptsOf = (a: IAcctCtx<unknown, unknown>) => IApiQueryOpts;

/** Per-account fixture: the context plus what its producer and accessor saw. */
interface IHeaderFixture {
  readonly acct: IAcctCtx<unknown, unknown>;
  readonly seen: ISeenCall[];
  readonly accountNumberOf: jest.Mock<string, [unknown]>;
}

/**
 * Producer form of a customer secondary-identity urlTag.
 * @returns Secondary-identity urlTag path.
 */
function secondaryProducer(): string {
  return 'data.customerSecondary';
}

/**
 * Producer form of a balance-step urlTag.
 * @returns Balance urlTag path.
 */
function balanceUrlTag(): string {
  return 'data.sync';
}

/**
 * Empty balance query variables.
 * @returns Empty variables object.
 */
function balanceVars(): object {
  return {};
}

/**
 * Build a driver context whose customer step declares the given
 * secondary-identity urlTag spec.
 * @param secondaryUrlTag - Producer, literal, or undefined.
 * @returns Cast driver context.
 */
function driverWithSecondary(secondaryUrlTag: unknown): IDriverCtx<unknown, unknown> {
  const shape = { customer: { secondaryUrlTag } };
  return { shape, bus: {}, ctx: {} } as unknown as IDriverCtx<unknown, unknown>;
}

/**
 * Build a per-account context whose balance step resolves its urlTag via
 * a producer function.
 * @returns Cast per-account context.
 */
function acctWithBalanceProducer(): IAcctCtx<unknown, unknown> {
  const balance = { urlTag: balanceUrlTag, buildVars: balanceVars };
  const shape = { balance, signer: false, secrets: undefined };
  return { shape, bus: {}, ctx: {}, acct: {} } as unknown as IAcctCtx<unknown, unknown>;
}

describe('ApiDirectScrapeDispatchArgs.resolveSecondaryUrlTag (edge)', () => {
  it('returns false when the shape declares no secondary fetch', () => {
    const driver = driverWithSecondary(undefined);
    const resolved = resolveSecondaryUrlTag(driver);
    expect(resolved).toBe(false);
  });

  it('invokes a producer secondary urlTag with the action context', () => {
    const driver = driverWithSecondary(secondaryProducer);
    const resolved = resolveSecondaryUrlTag(driver);
    expect(resolved).toBe('data.customerSecondary');
  });

  it('passes a literal secondary urlTag through unchanged', () => {
    const driver = driverWithSecondary('data.customerSecondary');
    const resolved = resolveSecondaryUrlTag(driver);
    expect(resolved).toBe('data.customerSecondary');
  });
});

describe('ApiDirectScrapeDispatchArgs.buildBalanceDispatchArgs (edge)', () => {
  it('resolves a producer balance urlTag from the account', () => {
    const acct = acctWithBalanceProducer();
    const args = buildBalanceDispatchArgs(acct);
    expect(args.urlTag).toBe('data.sync');
    expect(args.queryTag).toBe('balance');
  });
});

describe('ApiDirectScrapeDispatchArgs — shape body check', () => {
  it('hands the shape-level body check to every step it builds', () => {
    const acct = acctWithBalanceProducer();
    const checkBody = succeed;
    const shape = { ...acct.shape, checkBody };
    const args = buildBalanceDispatchArgs({ ...acct, shape });
    expect(args.checkBody).toBe(checkBody);
  });
});

/**
 * Header producer that records what it was handed and echoes the account.
 * @param seen - Sink for each invocation.
 * @returns Two-argument producer.
 */
function recordingHeaders(seen: ISeenCall[]): ApiDirectScrapeHeadersLike {
  return (ctx: IActionContext, call: IScrapeCallInfo): HeaderMap => {
    seen.push({ ctx, call });
    return { AccountNumber: call.accountId ?? '' };
  };
}

/**
 * Producer in the one-argument form (Pepper / Max style).
 * @param ctx - Action context.
 * @returns Header naming whether it saw the fixture context.
 */
function oneArgHeaders(ctx: IActionContext): HeaderMap {
  return { cid: ctx === CTX ? 'c-1' : 'other' };
}

/**
 * Build a per-account context whose every step declares the given headers.
 * @param extraHeaders - Static map or producer shared by every step.
 * @param seen - Sink the caller's recording producer writes into.
 * @returns Fixture with the context and its accessor spy.
 */
function headerFixture(
  extraHeaders: ApiDirectScrapeHeadersLike,
  seen: ISeenCall[],
): IHeaderFixture {
  const step = { urlTag: 'https://bank.example/api', buildVars: balanceVars, extraHeaders };
  const accountNumberOf = jest.fn<string, [unknown]>().mockReturnValue(ACCOUNT_ID);
  const steps = { customer: step, balance: step, transactions: step };
  const shape = { ...steps, accountNumberOf, signer: false };
  const raw = { shape, bus: {}, ctx: CTX, acct: { id: 'a-1' }, ledger: {} };
  const acct = raw as unknown as IAcctCtx<unknown, unknown>;
  return { acct, seen, accountNumberOf };
}

/**
 * Options of the balance call.
 * @param a - Per-account context.
 * @returns Balance opts.
 */
function balanceOpts(a: IAcctCtx<unknown, unknown>): IApiQueryOpts {
  return buildBalanceDispatchArgs(a).opts;
}

/**
 * Options of the first transactions call.
 * @param a - Per-account context.
 * @returns Transactions opts.
 */
function txnsOpts(a: IAcctCtx<unknown, unknown>): IApiQueryOpts {
  return buildTxnsDispatchArgs(a, false).opts;
}

/**
 * Options of the customer call.
 * @param a - Context (only its driver part is read).
 * @returns Customer opts.
 */
function customerOpts(a: IAcctCtx<unknown, unknown>): IApiQueryOpts {
  return buildCustomerDispatchArgs(a).opts;
}

/**
 * Options of a bootstrap call built from the customer step literal.
 * @param a - Context (only its driver part is read).
 * @returns Bootstrap opts.
 */
function bootstrapOpts(a: IAcctCtx<unknown, unknown>): IApiQueryOpts {
  const step = a.shape.customer as unknown as IApiDirectScrapeBootstrapStep;
  return buildBootstrapDispatchArgs(a, step).opts;
}

const PER_ACCOUNT: readonly { title: string; optsOf: OptsOf }[] = [
  { title: 'balance', optsOf: balanceOpts },
  { title: 'transactions', optsOf: txnsOpts },
];

const ACCOUNTLESS: readonly { title: string; optsOf: OptsOf }[] = [
  { title: 'customer', optsOf: customerOpts },
  { title: 'secondary identity', optsOf: buildSecondaryOpts },
  { title: 'bootstrap', optsOf: bootstrapOpts },
];

describe('ApiDirectScrapeDispatchArgs — per-account headers', () => {
  it.each(PER_ACCOUNT)('$title producer receives the account id', ({ optsOf }) => {
    const seen: ISeenCall[] = [];
    const producer = recordingHeaders(seen);
    const fx = headerFixture(producer, seen);
    const opts = optsOf(fx.acct);
    expect(opts.extraHeaders).toEqual({ AccountNumber: ACCOUNT_ID });
    expect(seen).toHaveLength(1);
    expect(seen[0].ctx).toBe(CTX);
    expect(seen[0].call).toStrictEqual({ accountId: ACCOUNT_ID });
    expect(opts.redactUrlValues).toEqual([ACCOUNT_ID]);
    expect(fx.accountNumberOf).toHaveBeenCalledWith({ id: 'a-1' });
  });

  it.each(PER_ACCOUNT)('$title producer receives the shape call id', ({ optsOf }) => {
    const seen: ISeenCall[] = [];
    const producer = recordingHeaders(seen);
    const fx = headerFixture(producer, seen);
    const callAccountIdOf = jest.fn<string, [unknown]>().mockReturnValue('path-7');
    const shape = { ...fx.acct.shape, callAccountIdOf };
    const opts = optsOf({ ...fx.acct, shape });
    expect(opts.extraHeaders).toStrictEqual({ AccountNumber: 'path-7' });
    expect(opts.redactUrlValues).toStrictEqual(['path-7']);
    expect(callAccountIdOf).toHaveBeenCalledWith({ id: 'a-1' });
    expect(fx.accountNumberOf).not.toHaveBeenCalled();
  });

  it.each(ACCOUNTLESS)('$title producer receives no account', ({ optsOf }) => {
    const seen: ISeenCall[] = [];
    const producer = recordingHeaders(seen);
    const fx = headerFixture(producer, seen);
    const callAccountIdOf = jest.fn<string, [unknown]>();
    const shape = { ...fx.acct.shape, callAccountIdOf };
    const opts = optsOf({ ...fx.acct, shape });
    expect(seen).toHaveLength(1);
    expect(seen[0].call).toStrictEqual({});
    expect(opts.extraHeaders).toStrictEqual({ AccountNumber: '' });
    expect(callAccountIdOf).not.toHaveBeenCalled();
    expect(fx.accountNumberOf).not.toHaveBeenCalled();
  });

  it.each(PER_ACCOUNT)('$title static map never reads the account', ({ optsOf }) => {
    const fx = headerFixture({ AccountNumber: '', site: 'retail' }, []);
    const opts = optsOf(fx.acct);
    expect(opts.extraHeaders).toStrictEqual({ AccountNumber: '', site: 'retail' });
    expect(fx.accountNumberOf).not.toHaveBeenCalled();
  });

  it.each(PER_ACCOUNT)('$title one-argument producer still works', ({ optsOf }) => {
    const fx = headerFixture(oneArgHeaders, []);
    const opts = optsOf(fx.acct);
    expect(opts.extraHeaders).toStrictEqual({ cid: 'c-1' });
  });
});
