/**
 * FlowTypes — flow-discriminator and per-step config concern slice of
 * the API-DIRECT-CALL config contract.
 *
 * Depends on TemplateTypes (`IBodyTemplate`, `IEnvelopeSelectors`,
 * `JsonValueTemplate` referenced by IStepConfig), EnvelopeTypes
 * (`IPreStepHook` referenced by IStepConfig.preHook) and SignerTypes
 * (`ISealFieldConfig` referenced by IStepConfig.seal). Top-level
 * ApiDirectCallConfig composes the FlowKind discriminator + steps array
 * from here.
 *
 * Rule #11 compliance: zero bank-name strings.
 */

import type { ScraperErrorTypes } from '../../../../Base/ErrorTypes.js';
import type { WKUrlGroup } from '../../../Registry/WK/UrlsWK.js';
import type {
  BodyEncoding,
  IUrlRule,
  RedirectPolicy,
  ResponseKind,
} from '../../../Types/Domain/FetchPolicy.js';
import type { IDerivedCarry } from './CarryTypes.js';
import type { IPreStepHook } from './EnvelopeTypes.js';
import type { ICarryGenerator } from './GeneratorTypes.js';
import type { ISealFieldConfig } from './SignerTypes.js';
import type {
  IBodyTemplate,
  IEnvelopeSelectors,
  JsonValueTemplate,
  RefToken,
} from './TemplateTypes.js';

/** Exhaustive flow-kind discriminator (spec.txt §B.3). */
type FlowKind = 'sms-otp' | 'stored-jwt' | 'bearer-static';

/**
 * Where a finished login leaves its cookies. `shared` keeps them in the
 * session jar for the scrape; `isolate` moves them to the run's private
 * stash, so the scrape starts from an empty jar.
 */
type CookieHandoff = 'shared' | 'isolate';

/** Step identifiers in the sms-otp flow. */
type StepName =
  | 'bind'
  | 'login'
  | 'assertPassword'
  | 'assertOtp'
  | 'getIdToken'
  | 'sessionToken'
  | 'prime'
  | 'validate'
  | 'deviceKey'
  | 'register'
  | 'resume'
  | 'bootstrap'
  | 'landing'
  | 'logon'
  | 'encryptionKey'
  | 'identify'
  | 'verify'
  | 'otpInit'
  | 'otpVerify';

/**
 * How a step's HTTP 2xx body says whether the step worked. The code at
 * `codePointer` is compared as text; a code outside `successCodes` fails the
 * step with its `failureMap` type, or `defaultFailure` when it is unmapped or
 * missing.
 */
interface IStepOutcome {
  /** JSON pointer to the bank's status code in the response body. */
  readonly codePointer: string;
  /** Codes that mean the step worked. */
  readonly successCodes: readonly string[];
  /** Failure type per known code, e.g. a wrong-password code. */
  readonly failureMap: Readonly<Record<string, ScraperErrorTypes>>;
  /** Failure type for any other code, or when the code is missing. */
  readonly defaultFailure: ScraperErrorTypes;
  /** Match the code, success codes and failure-map keys lower-cased (N13). */
  readonly caseInsensitive?: boolean;
}

/**
 * A carry slot read only when the response has it. A pointer that resolves
 * to a string that is not blank writes that string; otherwise `fallback` is
 * written when set, and the slot keeps its earlier value when not.
 */
interface IOptionalExtract {
  /** RFC-6901 pointer into the response body. */
  readonly pointer: string;
  /** Value written when the field is missing, blank or not a string. */
  readonly fallback?: string;
}

/** One carry slot read from a response header. */
interface IHeaderExtract {
  /** Header name, compared case-insensitively. */
  readonly header: string;
  /** Value written when the response lacks the header; without it the step fails. */
  readonly fallback?: string;
}

/** JSON type an extract rule demands of a slot's raw value (N18). */
type ExtractValueType = 'string' | 'number' | 'object' | 'array';

/**
 * A certificate rule (N27): the slot text is one PEM certificate that
 * certifies the private key `keyRef` resolves to, and is valid now.
 */
interface IPemCertificateRule {
  /** Ref to the PEM private key the certificate must certify. */
  readonly keyRef: RefToken;
}

/**
 * Checks on one body- or header-extract slot (N18, N27), run on the raw value
 * once the step's answer is read: `type` first, then `transform`, then the
 * text checks.
 */
interface IExtractRule {
  /** JSON type of the raw value. */
  readonly type?: ExtractValueType;
  /** Applied before the text checks; the slot keeps the result. */
  readonly transform?: 'lower';
  /** Allowed texts, after the transform. */
  readonly oneOf?: readonly string[];
  /** Anchored regex source (`^…$`) the whole text must match. */
  readonly pattern?: string;
  /** Allow-list a URL text must match, resolved against the step URL. */
  readonly url?: readonly IUrlRule[];
  /** Longest text allowed; 8192 when unset. */
  readonly maxChars?: number;
  /** The text must be one current PEM certificate of the referenced key (N27). */
  readonly pemCertificate?: IPemCertificateRule;
}

/**
 * A step's guard (N14): the step runs only when the carry slot holds text
 * equal to one of `oneOf`, compared without case.
 */
interface IRunIf {
  /** Carry slot the guard reads. */
  readonly carry: string;
  /** Texts that let the step run. */
  readonly oneOf: readonly string[];
}

/**
 * A step's device certificate (N26): refs to the PEM private key and the PEM
 * certificate, installed through the bus's certificate port before the step's
 * request and presented to the bank origin from then on.
 */
interface IStepClientCert {
  /** Ref to the PEM private key. */
  readonly key: RefToken;
  /** Ref to the PEM certificate that certifies the key. */
  readonly cert: RefToken;
}

/** Fields every login step has, whatever its HTTP method. */
interface IStepBase {
  readonly name: StepName;
  readonly urlTag: WKUrlGroup;
  readonly extractsToCarry: IEnvelopeSelectors;
  /** Carry slots the response may omit; read after `extractsToCarry`. */
  readonly optionalExtractsToCarry?: Readonly<Record<string, IOptionalExtract>>;
  /** Optional hook — awaited before the step fires. */
  readonly preHook?: IPreStepHook;
  /**
   * Optional URL query params — hydrated JsonValueTemplate whose
   * root is an object whose string-valued leaves become the
   * outgoing ?k=v pairs. Values may be $ref / $literal / nested.
   */
  readonly queryTemplate?: JsonValueTemplate;
  /**
   * When true, captures this step's response Set-Cookie lines into
   * the internal cookie jar. Subsequent steps with cookieJar=true
   * include those cookies on the outbound Cookie header.
   */
  readonly cookieJar?: boolean;
  /**
   * Optional per-step headers, hydrated against the step scope on every
   * call. Non-string values are sent as their JSON text. A step header
   * replaces a static header of the same name, compared case-insensitively.
   */
  readonly headers?: Readonly<Record<string, JsonValueTemplate>>;
  /** Optional outcome policy, judged after HTTP 2xx and before the extracts. */
  readonly outcome?: IStepOutcome;
  /** Optional redirect policy for this step; overrides the bank's `redirectPolicy`. */
  readonly redirect?: RedirectPolicy;
  /**
   * How the step reads its 2xx answer; `json` when absent. A `document` step
   * sees `{}`; a `text` step sees `{ text }`, so its extracts read `/text`.
   */
  readonly response?: ResponseKind;
  /** Text a `document` answer must contain, else the step fails `document unverified`. */
  readonly documentMarker?: string;
  /** Carry slots read from the final response's headers, merged beside `extractsToCarry`. */
  readonly headerExtractsToCarry?: Readonly<Record<string, IHeaderExtract>>;
  /** Carry slots derived, in order, once this step's extracts are in scope. */
  readonly deriveCarry?: readonly IDerivedCarry[];
  /** Optional credential seal, written into the body before the request (N10). */
  readonly seal?: ISealFieldConfig;
  /** Client cookies (name → ref) set in the domain jar before the request (N11). */
  readonly setCookies?: Readonly<Record<string, RefToken>>;
  /** Device certificate installed before the request; needs headless `clientCert` (N26). */
  readonly clientCert?: IStepClientCert;
  /** Body pointers that, present and truthy, fail the step `<step> bank error` (N20). */
  readonly failIfPresent?: readonly string[];
  /** Rules per body- or header-extract slot, checked once the answer is read (N18, N27). */
  readonly extractRules?: Readonly<Record<string, IExtractRule>>;
  /** Guard checked before the pre-hook; a miss skips the step (N14). */
  readonly runIf?: IRunIf;
  /** Carry generators, run in order once `runIf` passes, before hydration (N25). */
  readonly generate?: readonly ICarryGenerator[];
}

/** A POST step, the default when `method` is omitted: sends the hydrated body. */
interface IPostStep extends IStepBase {
  readonly method?: 'POST';
  readonly body: IBodyTemplate;
  /**
   * How the body is written; `json` when absent. A `form` or `form-latin1`
   * body must be a flat record; a `text` body must be exactly `{ text }`.
   */
  readonly encoding?: BodyEncoding;
}

/** A GET step: it sends no body, so the type rules one out. */
interface IGetStep extends IStepBase {
  readonly method: 'GET';
  readonly body?: never;
  readonly encoding?: never;
}

/** Per-step config: a POST or a GET step. */
type IStepConfig = IPostStep | IGetStep;

/** HTTP method of a login step. */
type StepMethod = NonNullable<IStepConfig['method']>;

export type {
  CookieHandoff,
  ExtractValueType,
  FlowKind,
  IExtractRule,
  IGetStep,
  IHeaderExtract,
  IOptionalExtract,
  IPemCertificateRule,
  IPostStep,
  IRunIf,
  IStepBase,
  IStepClientCert,
  IStepConfig,
  IStepOutcome,
  StepMethod,
  StepName,
};
