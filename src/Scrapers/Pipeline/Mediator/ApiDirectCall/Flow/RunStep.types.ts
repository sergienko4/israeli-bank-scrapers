/**
 * Shared types + private aliases used across the RunStep cluster.
 */

import type { resolveWkUrl, WKUrlOrLiteral } from '../../../Registry/WK/UrlsWK.js';
import type { ICookieJar } from '../../../Strategy/Fetch/CookieJar.js';
import type {
  IFetchCallPolicy,
  IResponseHeaderSink,
  IUrlRule,
} from '../../../Types/Domain/FetchPolicy.js';
import type { ITokenBus } from '../../../Types/Domain/TokenBus.js';
import type { IAsymmetricSignerConfig, IStepConfig } from '../ConfigContracts/index.js';
import type { IGenericKeypair } from '../Crypto/CryptoKeyFactory.js';
import type { JsonValue } from '../Envelope/JsonPointer.js';
import type { ITemplateScope } from '../Template/RefResolver.js';

/** Header map emitted by buildStepHeaders. */
type HeaderMap = Readonly<Record<string, string>>;

/** Mutable header map used internally while assembling the request. */
type MutableHeaderMap = Record<string, string>;

/** Extracted carry record returned by one step. */
type CarryMap = Readonly<Record<string, JsonValue>>;

/** String-valued query record — the opts.query shape accepted by apiPost. */
type QueryRecord = Readonly<Record<string, string>>;

/** Minimal on-set-cookie callback — adds to jar and returns jar size. */
type OnSetCookie = (cookies: readonly string[]) => number;

/** Asymmetric (non-AES) signer config — re-exported alias for clarity. */
type NonAesSignerConfig = IAsymmetricSignerConfig;

/**
 * Minimal cookie-jar port used across a single config-driven flow.
 * SmsOtpFlow constructs one instance and passes it to every RunStep
 * invocation. Same shape as the transport's session jar.
 */
type IStepCookieJar = ICookieJar;

/** Run-step args bundle — respects the 3-param ceiling. */
interface IRunStepArgs {
  readonly step: IStepConfig;
  readonly bus: ITokenBus;
  readonly scope: ITemplateScope;
  readonly companyId: Parameters<typeof resolveWkUrl>[1];
  readonly signingKeypair?: IGenericKeypair;
  readonly cookieJar?: IStepCookieJar;
  /** Rules declared by preceding URL producers in this flow's step list. */
  readonly carriedUrlRules?: readonly IUrlRule[];
  /** True when bank-supplied values must be omitted from failures and logs. */
  readonly isBankTextOmitted?: boolean;
}

/** Parsed URL parts used by `buildPathAndQuery`. */
interface IParsedUrlParts {
  readonly pathname: string;
  readonly search: string;
}

/** Pair of resolved path-and-query, the raw query record and the bus target. */
interface IPathAndQuery {
  readonly pathAndQuery: string;
  readonly query: Record<string, string>;
  readonly target: WKUrlOrLiteral;
}

/** Inputs needed to assemble the signer header value. */
interface ISignerInput {
  readonly pathAndQuery: string;
  readonly bodyJson: string;
  readonly keypair: IGenericKeypair;
}

/** Inputs used to assemble the outbound header map. */
interface IHeaderAssembly {
  readonly bodyJson: string;
  readonly pathAndQuery: string;
}

/** Args bundle for `attachSignerHeader` — single-line signature friendly. */
interface IAttachSignerArgs {
  readonly args: IRunStepArgs;
  readonly assembly: IHeaderAssembly;
  readonly out: MutableHeaderMap;
}

/**
 * A step's response capture: the sink its call policy names, the headers
 * that sink filled and the URL that gave the last answer (at most one).
 * The filled stores stay off the transport's view.
 */
interface IHeaderCapture {
  readonly sink: IResponseHeaderSink;
  readonly seen: ReadonlyMap<string, string>;
  readonly urls: readonly string[];
}

/** Args bundle passed to the transport — keeps runStep short. */
interface IFireArgs {
  readonly body: Record<string, unknown>;
  readonly query: QueryRecord;
  readonly extraHeaders: MutableHeaderMap;
  readonly onSetCookie?: OnSetCookie;
  readonly policy?: IFetchCallPolicy;
  /** Present when the step needs response headers or its answering URL; never sent to the bus. */
  readonly headerCapture?: IHeaderCapture;
}

/** Diagnostic context shape — PII-safe metadata for log calls. */
interface IStepLogContext {
  readonly stepName: string;
  readonly urlTag: string;
  readonly bodyKeyCount: number;
  readonly extractKeys: readonly string[];
}

/** Response-shape descriptor — key count, JSON length and the policy-filtered error code. */
interface IRespDescriptor {
  readonly respKeyCount: number;
  readonly respLength: number;
  readonly errorCode: string;
}

/** Prepared body + scope after hydration / crypto / signing. */
interface IPreparedBody {
  readonly body: Record<string, unknown>;
  readonly scope: ITemplateScope;
}

/** Bundle of values that prepareDispatch hands off to fireAndMergeScope. */
interface IDispatchBundle {
  readonly fireArgs: IFireArgs;
  readonly fireScope: IRunStepArgs;
  readonly baseCtx: IStepLogContext;
  readonly preparedScope: ITemplateScope;
  readonly target: WKUrlOrLiteral;
}

/** Args bundle for `assembleFire` — keeps params ≤3. */
interface IAssembleFireArgs {
  readonly args: IRunStepArgs;
  readonly preparedBody: IPreparedBody;
  readonly query: Record<string, string>;
  readonly headers: MutableHeaderMap;
}

/** Args bundle for `finalizeDispatch` — keeps params ≤3. */
interface IPostPrepArgs {
  readonly args: IRunStepArgs;
  readonly preparedBody: IPreparedBody;
  readonly pathAndQuery: string;
  readonly query: Record<string, string>;
  readonly target: WKUrlOrLiteral;
}

/** Args bundle for `headersAndFire` — keeps the signature single-line. */
interface IHeadersAndFireArgs {
  readonly opts: IPostPrepArgs;
  readonly fireScope: IRunStepArgs;
  readonly baseCtx: IStepLogContext;
}

/** Re-exports for siblings — keeps direct config-type imports out of helpers. */

export { type Procedure } from '../../../Types/Procedure.js';
export type { IApiDirectCallConfig } from '../ConfigContracts/index.js';
export type {
  CarryMap,
  HeaderMap,
  IAssembleFireArgs,
  IAttachSignerArgs,
  IDispatchBundle,
  IFireArgs,
  IHeaderAssembly,
  IHeaderCapture,
  IHeadersAndFireArgs,
  IParsedUrlParts,
  IPathAndQuery,
  IPostPrepArgs,
  IPreparedBody,
  IRespDescriptor,
  IRunStepArgs,
  ISignerInput,
  IStepCookieJar,
  IStepLogContext,
  MutableHeaderMap,
  NonAesSignerConfig,
  OnSetCookie,
  QueryRecord,
};

export type { IStepConfig } from '../ConfigContracts/index.js';
export type { JsonValue } from '../Envelope/JsonPointer.js';
export type { ITemplateScope } from '../Template/RefResolver.js';
