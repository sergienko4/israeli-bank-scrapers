/**
 * Dispatch-args construction for the ApiDirectScrape phase driver.
 * Resolves each step's urlTag (literal or producer) and assembles the
 * IDispatchArgs bundle (verb, vars, body, headers, signing) consumed by
 * dispatchStep. Balance and transactions header producers learn the
 * account the call is for (N53, see ApiDirectScrapeHeaders.ts). Split
 * out of ApiDirectScrapeSteps.ts to keep both files within the per-file
 * LOC ceiling. Zero bank-name coupling.
 */

import type { IApiMediator, IApiQueryOpts } from '../../Mediator/Api/ApiMediator.js';
import type { IEvidenceLedger } from '../../Mediator/Scrape/CoverageAudit/EvidenceLedger.js';
import type { WKUrlOrLiteral } from '../../Registry/WK/UrlsWK.js';
import type { IActionContext } from '../../Types/PipelineContext.js';
import type { IDispatchArgs } from './ApiDirectScrapeDispatch.js';
import { accountlessOpts, headerOpts } from './ApiDirectScrapeHeaders.js';
import type {
  ApiDirectScrapeHeadersLike,
  IApiDirectScrapeBootstrapStep,
  IApiDirectScrapeShape,
  IScrapeCallInfo,
} from './IApiDirectScrapeShape.js';

/** Driver context — shape + bus + action context. */
export interface IDriverCtx<TAcct, TCursor> {
  readonly shape: IApiDirectScrapeShape<TAcct, TCursor>;
  readonly bus: IApiMediator;
  readonly ctx: IActionContext;
}

/** Per-account context — driver context + current account. */
export interface IAcctCtx<TAcct, TCursor> extends IDriverCtx<TAcct, TCursor> {
  readonly acct: TAcct;
  /**
   * Where this account's guardrails report what they saw.
   *
   * One per account, never shared. Required rather than optional so a new
   * call site that forgets to open one is a compile error rather than an
   * account whose evidence silently vanishes.
   */
  readonly ledger: IEvidenceLedger;
}

/**
 * Call info naming the account a balance or transactions call is for.
 * @param a - Per-account context.
 * @returns Call info carrying the shape's call id, else its account number.
 */
function accountCall<TAcct, TCursor>(a: IAcctCtx<TAcct, TCursor>): IScrapeCallInfo {
  const idOf = a.shape.callAccountIdOf ?? a.shape.accountNumberOf;
  return { accountId: idOf(a.acct) };
}

/**
 * Attach the account ids a call's logged URLs must mask. The list is
 * resolved on demand, when a transport logs a URL, so building the opts
 * (a static header map included) never reads the account.
 * @param opts - The call's header opts.
 * @param valuesOf - Supplies the ids to mask, read only by the transport.
 * @returns Opts whose `redactUrlValues` is resolved lazily.
 */
function withLazyRedaction(opts: IApiQueryOpts, valuesOf: () => readonly string[]): IApiQueryOpts {
  return Object.defineProperty({ ...opts }, 'redactUrlValues', {
    configurable: true,
    enumerable: true,
    get: valuesOf,
  });
}

/**
 * Build the opts of a balance or transactions call, whose header
 * producer learns the account it is for. The account ids the transport
 * masks in logged URLs are resolved lazily too, so building the opts never
 * reads the account.
 * @param a - Per-account context.
 * @param extra - The step's static map, function, or absent.
 * @returns Opts value carrying a lazily-resolved redaction list.
 */
function accountOpts<TAcct, TCursor>(
  a: IAcctCtx<TAcct, TCursor>,
  extra?: ApiDirectScrapeHeadersLike,
): IApiQueryOpts {
  const opts = headerOpts(a.ctx, (): IScrapeCallInfo => accountCall(a), extra);
  return withLazyRedaction(opts, (): readonly string[] => {
    const { accountId } = accountCall(a);
    return accountId === undefined ? [] : [accountId];
  });
}

/** The dispatch-args fields every step of one shape shares. */
type ShapeLevelArgs = Pick<
  IDispatchArgs,
  'signer' | 'secrets' | 'checkBody' | 'bodyDigest' | 'responseSession' | 'omitBankText'
>;

/**
 * Pull the shape-level signer, secrets, body check, body digest and
 * response session onto a dispatch-args slice.
 * @param shape - Bank shape literal.
 * @returns Slice with the shape-level fields.
 */
function pickShapeLevel<TAcct, TCursor>(
  shape: IApiDirectScrapeShape<TAcct, TCursor>,
): ShapeLevelArgs {
  const { secrets, checkBody, bodyDigest, responseSession } = shape;
  return {
    signer: shape.signer ?? false,
    secrets,
    checkBody,
    bodyDigest,
    responseSession,
    omitBankText: shape.omitBankText,
  };
}

/** Name a bootstrap call carries when its step declares none. */
const BOOTSTRAP_CALL = 'bootstrap';

/**
 * Build the bootstrap-step dispatch args bundle. Mirrors the customer
 * step but sources its fields from the shape-level `bootstrap` literal,
 * and names the call after the step (`bootstrap` when unnamed).
 * Signed through the same shape-level signer + secrets, so the bootstrap
 * body (PayBox getKey `auth` envelope) gets its `/auth/signature`.
 * @param d - Driver context.
 * @param step - The shape's bootstrap step literal.
 * @returns Dispatch args ready for {@link dispatchStep}.
 */
export function buildBootstrapDispatchArgs<TAcct, TCursor>(
  d: IDriverCtx<TAcct, TCursor>,
  step: IApiDirectScrapeBootstrapStep,
): IDispatchArgs {
  const head = { bus: d.bus, ctx: d.ctx, queryTag: 'customer' as const, urlTag: step.urlTag };
  const vars = step.buildVars(d.ctx);
  const method = step.method ?? 'POST';
  const bodyTemplate = step.bodyTemplate ?? false;
  const opts = accountlessOpts(d.ctx, step.extraHeaders);
  const call = step.name ?? BOOTSTRAP_CALL;
  return { ...head, call, method, vars, bodyTemplate, ...pickShapeLevel(d.shape), opts };
}

/**
 * Resolve a customer-step urlTag (literal or producer).
 * @param d - Driver context.
 * @returns WK URL tag or `false` when GraphQL.
 */
function resolveCustomerUrlTag<TAcct, TCursor>(
  d: IDriverCtx<TAcct, TCursor>,
): WKUrlOrLiteral | false {
  const spec = d.shape.customer.urlTag;
  if (spec === undefined) return false;
  if (typeof spec === 'function') return spec(d.ctx);
  return spec;
}

/**
 * Resolve the optional customer secondary-identity urlTag (a second GET
 * whose body augments `extractAccounts`). Mirrors
 * {@link resolveCustomerUrlTag}, but `false` here means "no secondary
 * fetch declared" — there is no GraphQL secondary variant.
 * @param d - Driver context.
 * @returns WK URL tag, or `false` when the shape declares none.
 */
export function resolveSecondaryUrlTag<TAcct, TCursor>(
  d: IDriverCtx<TAcct, TCursor>,
): WKUrlOrLiteral | false {
  const spec = d.shape.customer.secondaryUrlTag;
  if (spec === undefined) return false;
  if (typeof spec === 'function') return spec(d.ctx);
  return spec;
}

/**
 * Options for the secondary identity GET. It belongs to the customer step,
 * so it sends the customer step's `extraHeaders`, resolved afresh for this
 * call.
 * @param d - Driver context.
 * @returns Opts value (frozen empty when the customer step declares none).
 */
export function buildSecondaryOpts<TAcct, TCursor>(d: IDriverCtx<TAcct, TCursor>): IApiQueryOpts {
  return accountlessOpts(d.ctx, d.shape.customer.extraHeaders);
}

/**
 * Build the customer-step dispatch args bundle.
 * @param d - Driver context.
 * @returns Dispatch args ready for {@link dispatchStep}.
 */
export function buildCustomerDispatchArgs<TAcct, TCursor>(
  d: IDriverCtx<TAcct, TCursor>,
): IDispatchArgs {
  return {
    bus: d.bus,
    ctx: d.ctx,
    queryTag: 'customer',
    urlTag: resolveCustomerUrlTag(d),
    method: d.shape.customer.method ?? 'POST',
    vars: d.shape.customer.buildVars(d.ctx),
    bodyTemplate: d.shape.customer.bodyTemplate ?? false,
    ...pickShapeLevel(d.shape),
    opts: accountlessOpts(d.ctx, d.shape.customer.extraHeaders),
  };
}

/**
 * Resolve a balance-step urlTag (literal or producer).
 * @param a - Per-account context.
 * @returns WK URL tag or `false` when GraphQL.
 */
function resolveBalanceUrlTag<TAcct, TCursor>(a: IAcctCtx<TAcct, TCursor>): WKUrlOrLiteral | false {
  const spec = a.shape.balance.urlTag;
  if (spec === undefined) return false;
  if (typeof spec === 'function') return spec(a.acct);
  return spec;
}

/**
 * Build the balance-step dispatch args bundle.
 * @param a - Per-account context.
 * @returns Dispatch args ready for {@link dispatchStep}.
 */
export function buildBalanceDispatchArgs<TAcct, TCursor>(
  a: IAcctCtx<TAcct, TCursor>,
): IDispatchArgs {
  return {
    bus: a.bus,
    ctx: a.ctx,
    queryTag: 'balance',
    urlTag: resolveBalanceUrlTag(a),
    method: a.shape.balance.method ?? 'POST',
    vars: a.shape.balance.buildVars(a.acct, a.ctx),
    bodyTemplate: a.shape.balance.bodyTemplate ?? false,
    ...pickShapeLevel(a.shape),
    opts: accountOpts(a, a.shape.balance.extraHeaders),
  };
}

/**
 * Resolve a transactions-step urlTag (literal or producer).
 * @param a - Per-account context.
 * @param cursor - Cursor passed into the producer (when dynamic).
 * @returns WK URL tag or `false` when GraphQL.
 */
function resolveTxnsUrlTag<TAcct, TCursor>(
  a: IAcctCtx<TAcct, TCursor>,
  cursor: TCursor | false,
): WKUrlOrLiteral | false {
  const spec = a.shape.transactions.urlTag;
  if (spec === undefined) return false;
  if (typeof spec === 'function') return spec(a.acct, cursor, a.ctx);
  return spec;
}

/**
 * Build the transactions-step dispatch args bundle.
 * @param a - Per-account context.
 * @param cursor - Cursor for this round (or false on first call).
 * @returns Dispatch args ready for {@link dispatchStep}.
 */
export function buildTxnsDispatchArgs<TAcct, TCursor>(
  a: IAcctCtx<TAcct, TCursor>,
  cursor: TCursor | false,
): IDispatchArgs {
  const t = a.shape.transactions;
  const vars = t.buildVars(a.acct, cursor, a.ctx);
  const head = { bus: a.bus, ctx: a.ctx, queryTag: 'transactions' as const, vars };
  const urlTag = resolveTxnsUrlTag(a, cursor);
  const bodyTemplate = t.bodyTemplate ?? false;
  const method = t.method ?? 'POST';
  const opts = accountOpts(a, t.extraHeaders);
  return { ...head, urlTag, method, bodyTemplate, ...pickShapeLevel(a.shape), opts };
}
