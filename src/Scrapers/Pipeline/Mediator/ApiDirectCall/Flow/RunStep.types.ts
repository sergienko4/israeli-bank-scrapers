/**
 * Shared types + private aliases used across the RunStep cluster.
 */

import type { resolveWkUrl } from '../../../Registry/WK/UrlsWK.js';
import type { IApiMediator } from '../../Api/ApiMediator.js';
import type { IGenericKeypair } from '../Crypto/CryptoKeyFactory.js';
import type { JsonValue } from '../Envelope/JsonPointer.js';
import type {
  IApiDirectCallConfig,
  IAsymmetricSignerConfig,
  IStepConfig,
} from '../IApiDirectCallConfig.js';
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
 * invocation.
 */
interface IStepCookieJar {
  add: (setCookieLines: readonly string[]) => number;
  header: () => string;
}

/** Run-step args bundle — respects the 3-param ceiling. */
interface IRunStepArgs {
  readonly step: IStepConfig;
  readonly bus: IApiMediator;
  readonly scope: ITemplateScope;
  readonly companyId: Parameters<typeof resolveWkUrl>[1];
  readonly signingKeypair?: IGenericKeypair;
  readonly cookieJar?: IStepCookieJar;
}

/** Parsed URL parts used by `buildPathAndQuery`. */
interface IParsedUrlParts {
  readonly pathname: string;
  readonly search: string;
}

/** Pair of resolved path-and-query and the raw query record. */
interface IPathAndQuery {
  readonly pathAndQuery: string;
  readonly query: Record<string, string>;
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

/** Args bundle passed to the transport — keeps runStep short. */
interface IFireArgs {
  readonly body: Record<string, unknown>;
  readonly query: QueryRecord;
  readonly extraHeaders: MutableHeaderMap;
  readonly onSetCookie?: OnSetCookie;
}

/** Diagnostic context shape — PII-safe metadata for log calls. */
interface IStepLogContext {
  readonly stepName: string;
  readonly urlTag: string;
  readonly bodyKeys: readonly string[];
  readonly extractKeys: readonly string[];
}

/** Diagnostic response-shape descriptor — top-level keys + JSON length + envelope error code. */
interface IRespDescriptor {
  readonly respKeys: readonly string[];
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
}

/** Args bundle for `headersAndFire` — keeps the signature single-line. */
interface IHeadersAndFireArgs {
  readonly opts: IPostPrepArgs;
  readonly fireScope: IRunStepArgs;
  readonly baseCtx: IStepLogContext;
}

/** Re-exports for siblings — keeps direct config-type imports out of helpers. */

export { type Procedure } from '../../../Types/Procedure.js';
export type {
  CarryMap,
  HeaderMap,
  IApiDirectCallConfig,
  IAssembleFireArgs,
  IAttachSignerArgs,
  IDispatchBundle,
  IFireArgs,
  IHeaderAssembly,
  IHeadersAndFireArgs,
  IParsedUrlParts,
  IPathAndQuery,
  IPostPrepArgs,
  IPreparedBody,
  IRespDescriptor,
  IRunStepArgs,
  ISignerInput,
  IStepConfig,
  IStepCookieJar,
  IStepLogContext,
  ITemplateScope,
  JsonValue,
  MutableHeaderMap,
  NonAesSignerConfig,
  OnSetCookie,
  QueryRecord,
};
