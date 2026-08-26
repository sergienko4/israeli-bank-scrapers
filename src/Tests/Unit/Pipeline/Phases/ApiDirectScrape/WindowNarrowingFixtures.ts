/**
 * Fixtures for the cross-bank window-narrowing contract.
 *
 * Every bank declares `transactions.windowNarrowing` — whether a coverage gap
 * can be closed by re-asking for an older slice. A declaration is a claim about
 * runtime behaviour, so it is worth exactly as much as the test that checks it.
 * These fixtures let the contract build a bank's real transactions request
 * twice, under two different `ctx.windowEnd` values, and compare the bytes.
 *
 * The request is built with stand-in inputs rather than live ones: the contract
 * asks whether the upper bound reaches the wire at all, which is answered by
 * the shape's own code, not by the values flowing through it.
 */

import type { WindowNarrowing } from '../../../../../Scrapers/Pipeline/Phases/ApiDirectScrape/IApiDirectScrapeShape.js';
import type { Brand } from '../../../../../Scrapers/Pipeline/Types/Brand.js';
import type { Option } from '../../../../../Scrapers/Pipeline/Types/Option.js';
import { none, some } from '../../../../../Scrapers/Pipeline/Types/Option.js';
import type { IActionContext } from '../../../../../Scrapers/Pipeline/Types/PipelineContext.js';
import {
  AMEX_SHAPE,
  BEINLEUMI_SHAPE,
  DISCOUNT_SHAPE,
  HAPOALIM_SHAPE,
  ISRACARD_SHAPE,
  LEUMI_SHAPE,
  MASSAD_SHAPE,
  MAX_SHAPE,
  MERCANTILE_SHAPE,
  ONE_ZERO_SHAPE,
  OTSAR_HAHAYAL_SHAPE,
  PAGI_SHAPE,
  PAYBOX_SHAPE,
  PEPPER_SHAPE,
  VISACAL_SHAPE,
  YAHAV_SHAPE,
} from './ApiDirectBankShapes.js';

/** Minimal surface the contract needs from a bank shape. */
interface ITxnsLike {
  readonly windowNarrowing: WindowNarrowing;
  readonly buildVars: (acct: never, cursor: never, ctx: IActionContext) => unknown;
  readonly urlTag?: unknown;
  readonly extraHeaders?: unknown;
  readonly bodyTemplate?: unknown;
}

/** Signature the contract calls a shape's request builders through. */
type LooseBuilder = (acct: unknown, cursor: unknown, ctx: IActionContext) => unknown;

/**
 * Every request a bounded walk would send, serialized into one comparable
 * value. Branded so a caller cannot pass an arbitrary string where the
 * contract expects a rendering it produced itself.
 */
type WalkFingerprint = Brand<string, 'WindowNarrowingWalkFingerprint'>;

/** One row of the cross-bank window-narrowing contract. */
export interface IWindowNarrowingCase {
  readonly bank: string;
  readonly txns: ITxnsLike;
}

/** Lower bound every case requests, so only the upper bound varies. */
export const START_DATE = new Date('2026-02-09T00:00:00Z');

/** Two upper bounds far enough apart to move even a month-granular request. */
export const EARLY_END = new Date('2026-03-15T00:00:00Z');

/** Later of the two upper bounds — six months after {@link EARLY_END}. */
export const LATE_END = new Date('2026-09-15T00:00:00Z');

/**
 * Property a stand-in must not answer with a function.
 *
 * Anything awaited is inspected for a callable `then`; answering with one would
 * make every stand-in a thenable and hang the contract.
 */
const THENABLE_KEY = 'then';

/**
 * Build the callable a stand-in wraps and answers calls with.
 * @param name - Label the stand-in reports when coerced to a string.
 * @returns Callable yielding a further stand-in.
 */
function standInCall(name: string): () => unknown {
  /**
   * Answer a call on the stand-in.
   * @returns A further stand-in.
   */
  function call(): unknown {
    return anyProxy(name);
  }
  return call;
}

/**
 * Build the property reader a stand-in answers every access with.
 * @param name - Label the stand-in reports when coerced to a string.
 * @returns Proxy `get` trap for that label.
 */
function standInRead(name: string): (target: unknown, prop: string | symbol) => unknown {
  /**
   * Answer one property access on the stand-in.
   * @param _target - Wrapped callable, unused.
   * @param prop - Property being read.
   * @returns Value for that property.
   */
  function read(_target: unknown, prop: string | symbol): unknown {
    if (prop === Symbol.toPrimitive || prop === 'toString') return (): string => name;
    if (prop === THENABLE_KEY) return name;
    return anyProxy(name);
  }
  return read;
}

/**
 * Build a stand-in that answers any property access without throwing.
 *
 * A shape reads bank-specific account fields the contract has no way to know.
 * Returning a further stand-in for every access lets the shape run to
 * completion, which is all the contract needs.
 * @param name - Label the stand-in reports when coerced to a string.
 * @returns Value usable wherever a shape expects an account.
 */
function anyProxy(name: string): unknown {
  const target = standInCall(name);
  const read = standInRead(name);
  const invoke = standInCall(name);
  const handler = { get: read, apply: invoke };
  return new Proxy(target, handler);
}

/** Stand-in account shared by every case. */
export const STUB_ACCOUNT = anyProxy('acct');

/**
 * Build an action context carrying a chosen window upper bound.
 *
 * `windowEnd` and `options` are real values because the shapes read them;
 * everything else falls through to a stand-in.
 * @param windowEnd - Upper bound to place on the context.
 * @returns Context suitable for `buildVars` and `urlTag`.
 */
function ctxWithBound(windowEnd: Option<Date>): IActionContext {
  const base: Record<string, unknown> = {
    companyId: 'contract',
    options: { startDate: START_DATE, companyId: 'contract' },
    credentials: {},
    windowEnd,
  };
  const handler = { get: readOrStandIn };
  const proxied = new Proxy(base, handler);
  return proxied as unknown as IActionContext;
}

/**
 * Read a context field, falling back to a stand-in for anything unset.
 * @param target - Fields the contract set explicitly.
 * @param prop - Field being read.
 * @returns The explicit value, or a stand-in.
 */
function readOrStandIn(target: Record<string, unknown>, prop: string | symbol): unknown {
  if (prop in target) return target[prop as string];
  const label = String(prop);
  return anyProxy(label);
}

/**
 * Build a context bounded at a given date.
 * @param windowEnd - Upper bound of the scrape window.
 * @returns Context whose `windowEnd` is that date.
 */
export function ctxBoundedAt(windowEnd: Date): IActionContext {
  const bound = some(windowEnd);
  return ctxWithBound(bound);
}

/**
 * Build a context that names no upper bound at all.
 * @returns Context whose `windowEnd` is absent.
 */
export function ctxUnbounded(): IActionContext {
  const bound: Option<Date> = none();
  return ctxWithBound(bound);
}

/**
 * Render a value as a stable string, tolerating cycles and stand-ins.
 *
 * `JSON.stringify` is not enough: a request may embed a stand-in, and two
 * distinct stand-ins must compare equal so only real differences show.
 * @param value - Value to render.
 * @returns Deterministic string form.
 */
function stableString(value: unknown): string {
  if (typeof value === 'function') return '[fn]';
  if (typeof value === 'symbol') return String(value);
  if (value === undefined) return '[undefined]';
  const seen = new WeakSet();

  /**
   * Flatten one value so distinct stand-ins and cycles compare equal.
   * @param _key - Property name, unused.
   * @param candidate - Value being serialized.
   * @returns Value to serialize in its place.
   */
  function replacer(_key: string, candidate: unknown): unknown {
    if (typeof candidate === 'function') return '[fn]';
    if (typeof candidate !== 'object' || candidate === null) return candidate;
    if (seen.has(candidate)) return '[cycle]';
    seen.add(candidate);
    return candidate;
  }

  return JSON.stringify(value, replacer);
}

/**
 * Resolve a step's URL, which a shape may declare as a value or a builder.
 *
 * Banks whose endpoint never varies (Leumi) declare a plain tag; banks that
 * fold the window into the path or query (Hapoalim, Max) declare a function.
 * @param urlTag - Declared tag, builder, or nothing at all.
 * @param ctx - Context carrying the window upper bound.
 * @param cursor - Position in the walk; `false` is the first call.
 * @returns Resolved URL-ish value.
 */
function resolveUrl(urlTag: unknown, ctx: IActionContext, cursor: number | false): unknown {
  if (urlTag === undefined) return 'graphql';
  if (typeof urlTag !== 'function') return urlTag;
  const build = urlTag as LooseBuilder;
  return build(STUB_ACCOUNT, cursor, ctx);
}

/**
 * Resolve a step's extra headers, which a shape may declare as a fixed map
 * or as a builder over the whole action context.
 *
 * The builder form receives `windowEnd`, so a bank can fold the upper bound
 * into a header without touching its URL or variables. Rendering headers
 * keeps that third route inside the contract instead of outside it.
 * @param extraHeaders - Declared map, builder, or nothing at all.
 * @param ctx - Context carrying the window upper bound.
 * @returns Resolved headers, or a marker when the step declares none.
 */
function resolveHeaders(extraHeaders: unknown, ctx: IActionContext): unknown {
  if (extraHeaders === undefined) return '[no-headers]';
  if (typeof extraHeaders !== 'function') return extraHeaders;
  const build = extraHeaders as (headerCtx: IActionContext) => unknown;
  return build(ctx);
}

/** Stand-in for a value that changes between two identical renders. */
const VOLATILE = '[volatile]';

/**
 * Whether a value is a plain object worth walking key by key.
 * @param value - Candidate value.
 * @returns True for non-null, non-array objects.
 */
function isPlainObject(value: unknown): value is Record<string, unknown> {
  const isObject = typeof value === 'object' && value !== null;
  return isObject && !Array.isArray(value);
}

/**
 * Replace every leaf that differs between two same-context renders.
 *
 * Some shapes mint a fresh value on every call — Pepper stamps a per-call
 * `x-transaction-id`, Hapoalim a per-call `uuid`. Those differ between *any*
 * two renders, so a fingerprint carrying them differs under a fixed bound
 * too, and every narrowability assertion built on it would pass without
 * proving anything.
 *
 * Masking by differencing calibrates itself: it needs no list of volatile
 * keys, so a shape that adds one later is neutralised the same way. Only
 * leaves that survive two identical renders reach the fingerprint.
 *
 * Clock-derived values are NOT caught here — two reads inside one render
 * fall in the same millisecond and agree. The suite freezes the clock for
 * those; see the `fingerprint determinism` control.
 * @param first - Render under the context.
 * @param second - Second render under that same context.
 * @returns Shape of the first render with unstable leaves replaced.
 */
function maskUnstable(first: unknown, second: unknown): unknown {
  if (Array.isArray(first) && Array.isArray(second)) {
    return first.map((item, i): unknown => maskUnstable(item, second[i]));
  }
  if (isPlainObject(first) && isPlainObject(second)) {
    const pairs = Object.keys(first).map(k => [k, maskUnstable(first[k], second[k])] as const);
    return Object.fromEntries(pairs);
  }
  return stableString(first) === stableString(second) ? first : VOLATILE;
}

/**
 * Resolve all three request surfaces once.
 * @param txns - Transactions step under test.
 * @param ctx - Context carrying the window upper bound.
 * @param cursor - Position in the walk; `false` is the first call.
 * @returns URL, variables, and headers as one structure.
 */
function resolveSurfaces(txns: ITxnsLike, ctx: IActionContext, cursor: number | false): unknown {
  const buildVars = txns.buildVars as LooseBuilder;
  return {
    url: resolveUrl(txns.urlTag, ctx, cursor),
    vars: buildVars(STUB_ACCOUNT, cursor, ctx),
    headers: resolveHeaders(txns.extraHeaders, ctx),
  };
}

/**
 * Build the transactions request a shape would send at one cursor position.
 *
 * All three request surfaces matter: some banks put the window in the URL
 * (Hapoalim, Max), others in the body (Leumi, Yahav), and a header builder
 * sees the whole context. A contract that inspected only one would clear a
 * bank it never actually checked. The fourth surface, `bodyTemplate`, is not
 * rendered here: no transactions step in the registry declares one, so there
 * is nothing to walk. Should one appear, its `carry.*` tokens could project
 * a window value, and this contract would need to render it too.
 *
 * The request is resolved twice under the same context so per-call values
 * can be masked; see {@link maskUnstable}. A leaf that is volatile *and*
 * bound-carrying would be masked with the rest, so the determinism control
 * in the suite asserts the masking actually holds.
 * @param txns - Transactions step under test.
 * @param ctx - Context carrying the window upper bound.
 * @param cursor - Position in the walk; `false` is the first call.
 * @returns Serialized URL, variables, and headers, minus unstable leaves.
 */
function renderRequest(txns: ITxnsLike, ctx: IActionContext, cursor: number | false): string {
  const first = resolveSurfaces(txns, ctx, cursor);
  const second = resolveSurfaces(txns, ctx, cursor);
  const stable = maskUnstable(first, second);
  return stableString(stable);
}

/**
 * Cursor positions sampled across a walk.
 *
 * `false` is the first call; the numbers reach far enough into a month-walking
 * or chunked bank to pass the point where a narrowed bound would bite.
 */
const WALK_CURSORS: readonly (number | false)[] = [false, 0, 3, 6, 9, 11];

/**
 * Build every request a shape would send across a bounded walk.
 *
 * Chunked banks (Yahav) and month-walking card issuers put the first request
 * at the *start* of the window, so comparing only the first request would
 * clear a bank whose bound never reaches the wire. Sampling cursor positions
 * across the walk exposes the difference where it actually appears — in the
 * later requests, or not at all.
 * @param txns - Transactions step under test.
 * @param ctx - Context carrying the window upper bound.
 * @returns Serialized requests, joined.
 */
export function renderWalk(txns: ITxnsLike, ctx: IActionContext): WalkFingerprint {
  const rendered = WALK_CURSORS.map(cursor => renderRequest(txns, ctx, cursor));
  return rendered.join('\n') as WalkFingerprint;
}

/**
 * Every bank that reaches a provider through the API-direct scrape phase.
 *
 * Listed explicitly rather than derived from a registry: no registry of shapes
 * exists, and an explicit list makes a forgotten bank a visible omission in
 * review rather than a silent gap in coverage. The count assertion in the
 * contract guards against that omission.
 */
export const WINDOW_NARROWING_CASES: readonly IWindowNarrowingCase[] = [
  { bank: 'amex', txns: AMEX_SHAPE.transactions },
  { bank: 'beinleumi', txns: BEINLEUMI_SHAPE.transactions },
  { bank: 'discount', txns: DISCOUNT_SHAPE.transactions },
  { bank: 'hapoalim', txns: HAPOALIM_SHAPE.transactions },
  { bank: 'isracard', txns: ISRACARD_SHAPE.transactions },
  { bank: 'leumi', txns: LEUMI_SHAPE.transactions },
  { bank: 'massad', txns: MASSAD_SHAPE.transactions },
  { bank: 'max', txns: MAX_SHAPE.transactions },
  { bank: 'mercantile', txns: MERCANTILE_SHAPE.transactions },
  { bank: 'oneZero', txns: ONE_ZERO_SHAPE.transactions },
  { bank: 'otsarHahayal', txns: OTSAR_HAHAYAL_SHAPE.transactions },
  { bank: 'pagi', txns: PAGI_SHAPE.transactions },
  { bank: 'payBox', txns: PAYBOX_SHAPE.transactions },
  { bank: 'pepper', txns: PEPPER_SHAPE.transactions },
  { bank: 'visaCal', txns: VISACAL_SHAPE.transactions },
  { bank: 'yahav', txns: YAHAV_SHAPE.transactions },
] as const;
