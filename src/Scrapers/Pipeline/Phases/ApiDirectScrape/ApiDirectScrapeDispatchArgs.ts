/**
 * Dispatch-args construction for the ApiDirectScrape phase driver.
 * Consumes the urlTag resolvers from ApiDirectScrapeUrlTags.ts and assembles
 * the IDispatchArgs bundle (verb, vars, body, headers, signing) consumed by
 * dispatchStep. Balance and transactions header producers learn the account
 * the call is for (see ApiDirectScrapeHeaders.ts). Split out of
 * ApiDirectScrapeSteps.ts to keep both files within the per-file LOC ceiling.
 * Zero bank-name coupling.
 */

import type { IApiQueryOpts } from '../../Mediator/Api/ApiMediator.js';
import type { WKUrlOrLiteral } from '../../Registry/WK/UrlsWK.js';
import type { IDispatchArgs } from './ApiDirectScrapeDispatch.js';
import { accountlessOpts, headerOpts } from './ApiDirectScrapeHeaders.js';
import type { IAcctCtx, IDriverCtx } from './ApiDirectScrapeTypes.js';
import {
  resolveBalanceUrlTag,
  resolveCustomerUrlTag,
  resolveTxnsUrlTag,
} from './ApiDirectScrapeUrlTags.js';
import type {
  ApiDirectScrapeHeadersLike,
  IApiDirectScrapeBootstrapStep,
  IApiDirectScrapeShape,
  IScrapeCallInfo,
  ScrapeOperation,
} from './IApiDirectScrapeShape.js';

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
type ShapeLevelArgs = Pick<IDispatchArgs, 'signer' | 'secrets' | 'checkBody' | 'bodyDigest'> &
  Pick<IDispatchArgs, 'checkBodyByOperation' | 'responseSession' | 'omitBankText' | 'operation'>;

/** The fields a step supplies before the shape-level ones are folded in. */
type StepCall = Omit<IDispatchArgs, keyof ShapeLevelArgs>;

/** A step literal's declared REST verb and body-template flag. */
type StepVerb = Pick<IApiDirectScrapeBootstrapStep, 'method' | 'bodyTemplate'>;

/**
 * The bus/ctx/queryTag triple every step's dispatch fields start with.
 * @param d - Driver context.
 * @param queryTag - Which call this step represents.
 * @returns The shared head of a step's dispatch fields.
 */
function callHead<TAcct, TCursor>(
  d: IDriverCtx<TAcct, TCursor>,
  queryTag: StepCall['queryTag'],
): Pick<StepCall, 'bus' | 'ctx' | 'queryTag'> {
  return { bus: d.bus, ctx: d.ctx, queryTag };
}

/**
 * Resolve a step's REST verb, body-template flag and url tag.
 * @param step - The step literal declaring the verb and body template.
 * @param urlTag - The call's resolved url tag.
 * @returns The tail of a step's dispatch fields.
 */
function stepTail(
  step: StepVerb,
  urlTag: WKUrlOrLiteral | false,
): Pick<StepCall, 'method' | 'bodyTemplate' | 'urlTag'> {
  const method = step.method ?? 'POST';
  const bodyTemplate = step.bodyTemplate ?? false;
  return { method, bodyTemplate, urlTag };
}

/**
 * Pull the shape-level signer, secrets, body check, body digest and
 * response session onto a dispatch-args slice.
 * @param shape - Bank shape literal.
 * @param operation - Operation represented by this call.
 * @returns Slice with the shape-level fields.
 */
function pickShapeLevel<TAcct, TCursor>(
  shape: IApiDirectScrapeShape<TAcct, TCursor>,
  operation: ScrapeOperation,
): ShapeLevelArgs {
  const { secrets, checkBody, checkBodyByOperation, bodyDigest, responseSession } = shape;
  const checks = { checkBody, checkBodyByOperation, operation, omitBankText: shape.omitBankText };
  const signer = shape.signer ?? false;
  return { signer, secrets, ...checks, bodyDigest, responseSession };
}

/**
 * Fold the shape-level fields into one step's own dispatch fields.
 * @param d - Driver context, whose shape supplies the shared fields.
 * @param operation - Operation represented by this call.
 * @param call - The step's own fields.
 * @returns Dispatch args ready for {@link dispatchStep}.
 */
function assembleDispatch<TAcct, TCursor>(
  d: IDriverCtx<TAcct, TCursor>,
  operation: ScrapeOperation,
  call: StepCall,
): IDispatchArgs {
  return { ...call, ...pickShapeLevel(d.shape, operation) };
}

/** Name a bootstrap call carries when its step declares none. */
const BOOTSTRAP_CALL = 'bootstrap';

/**
 * The bootstrap step's own dispatch fields. Mirrors the customer step but
 * sources its fields from the shape-level `bootstrap` literal, and names
 * the call after the step (`bootstrap` when unnamed).
 * @param d - Driver context.
 * @param step - The shape's bootstrap step literal.
 * @returns Step fields, signed through the shape-level signer + secrets.
 */
function bootstrapCall<TAcct, TCursor>(
  d: IDriverCtx<TAcct, TCursor>,
  step: IApiDirectScrapeBootstrapStep,
): StepCall {
  const call = step.name ?? BOOTSTRAP_CALL;
  const opts = accountlessOpts(d.ctx, step.extraHeaders);
  const vars = step.buildVars(d.ctx);
  return { ...callHead(d, 'customer'), call, vars, opts, ...stepTail(step, step.urlTag) };
}

/**
 * Build the bootstrap-step dispatch args bundle. Signed through the same
 * shape-level signer + secrets, so the bootstrap body (PayBox getKey
 * `auth` envelope) gets its `/auth/signature`.
 * @param d - Driver context.
 * @param step - The shape's bootstrap step literal.
 * @returns Dispatch args ready for {@link dispatchStep}.
 */
export function buildBootstrapDispatchArgs<TAcct, TCursor>(
  d: IDriverCtx<TAcct, TCursor>,
  step: IApiDirectScrapeBootstrapStep,
): IDispatchArgs {
  const call = bootstrapCall(d, step);
  return assembleDispatch(d, 'bootstrap', call);
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
 * The customer step's own dispatch fields.
 * @param d - Driver context.
 * @returns Step fields with the resolved urlTag and customer opts.
 */
function customerCall<TAcct, TCursor>(d: IDriverCtx<TAcct, TCursor>): StepCall {
  const cust = d.shape.customer;
  const urlTag = resolveCustomerUrlTag(d);
  const opts = accountlessOpts(d.ctx, cust.extraHeaders);
  const vars = cust.buildVars(d.ctx);
  return { ...callHead(d, 'customer'), vars, opts, ...stepTail(cust, urlTag) };
}

/**
 * Build the customer-step dispatch args bundle.
 * @param d - Driver context.
 * @returns Dispatch args ready for {@link dispatchStep}.
 */
export function buildCustomerDispatchArgs<TAcct, TCursor>(
  d: IDriverCtx<TAcct, TCursor>,
): IDispatchArgs {
  const call = customerCall(d);
  return assembleDispatch(d, 'customer', call);
}

/**
 * The balance step's own dispatch fields.
 * @param a - Per-account context.
 * @returns Step fields with the resolved urlTag and account-aware opts.
 */
function balanceCall<TAcct, TCursor>(a: IAcctCtx<TAcct, TCursor>): StepCall {
  const bal = a.shape.balance;
  const urlTag = resolveBalanceUrlTag(a);
  const vars = bal.buildVars(a.acct, a.ctx);
  const opts = accountOpts(a, bal.extraHeaders);
  return { ...callHead(a, 'balance'), vars, opts, ...stepTail(bal, urlTag) };
}

/**
 * Build the balance-step dispatch args bundle.
 * @param a - Per-account context.
 * @returns Dispatch args ready for {@link dispatchStep}.
 */
export function buildBalanceDispatchArgs<TAcct, TCursor>(
  a: IAcctCtx<TAcct, TCursor>,
): IDispatchArgs {
  const call = balanceCall(a);
  return assembleDispatch(a, 'balance', call);
}

/**
 * The transactions step's own dispatch fields.
 * @param a - Per-account context.
 * @param cursor - Cursor for this round (or false on first call).
 * @returns Step fields with the round's urlTag, vars and account-aware opts.
 */
function txnsCall<TAcct, TCursor>(a: IAcctCtx<TAcct, TCursor>, cursor: TCursor | false): StepCall {
  const t = a.shape.transactions;
  const urlTag = resolveTxnsUrlTag(a, cursor);
  const vars = t.buildVars(a.acct, cursor, a.ctx);
  const opts = accountOpts(a, t.extraHeaders);
  return { ...callHead(a, 'transactions'), vars, opts, ...stepTail(t, urlTag) };
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
  const call = txnsCall(a, cursor);
  return assembleDispatch(a, 'txns', call);
}
