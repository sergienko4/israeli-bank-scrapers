/**
 * Scrape-phase dispatch helpers — REST/GraphQL routing, body-template
 * hydration, and shape-level signature attachment. Split from
 * ApiDirectScrapeSteps.ts to keep both files under the 150-LOC ceiling.
 *
 * Zero bank knowledge.
 */

import { ScraperErrorTypes } from '../../../Base/ErrorTypes.js';
import type { IApiMediator, IApiQueryOpts } from '../../Mediator/Api/ApiMediator.js';
import type {
  IAesSignerConfig,
  IBodyDigestConfig,
  JsonValueTemplate,
} from '../../Mediator/ApiDirectCall/ConfigContracts/index.js';
import type { JsonValue } from '../../Mediator/ApiDirectCall/Envelope/JsonPointer.js';
import { sanitiseStepFailure } from '../../Mediator/ApiDirectCall/Flow/RunStep.failure.js';
import type { WKUrlOrLiteral } from '../../Registry/WK/UrlsWK.js';
import type { ApiPostData } from '../../Types/Domain/ApiPostData.js';
import type { IActionContext } from '../../Types/PipelineContext.js';
import type { Procedure } from '../../Types/Procedure.js';
import { fail, isOk, succeed } from '../../Types/Procedure.js';
import { maybeSignBody, resolveStepBody } from './ApiDirectScrapeBody.js';
import { withBodyDigest } from './ApiDirectScrapeBodyDigest.js';
import {
  captureAnswer,
  type IAnswerCapture,
  readResponseSession,
} from './ApiDirectScrapeResponseSession.js';
import type {
  ApiBody,
  BodyCheck,
  IResponseSessionSpec,
  OperationBodyChecks,
  ScrapeHttpMethod,
  ScrapeOperation,
  VarsMap,
} from './IApiDirectScrapeShape.js';

/** Args bundle for {@link dispatchStep} — keeps params ≤3. */
export interface IDispatchArgs {
  readonly bus: IApiMediator;
  readonly ctx: IActionContext;
  readonly queryTag: 'customer' | 'balance' | 'transactions';
  readonly urlTag: WKUrlOrLiteral | false;
  /** REST verb for the urlTag branch — GET sends no body, POST hydrates one. */
  readonly method: ScrapeHttpMethod;
  /** Step vars; an array is sent only by a plain REST POST step. */
  readonly vars: ApiPostData;
  readonly bodyTemplate: JsonValueTemplate | false;
  readonly signer: IAesSignerConfig | false;
  readonly opts: IApiQueryOpts;
  /** Shape-level secrets — threaded into scope.config.secrets for signing. */
  readonly secrets?: Readonly<Record<string, string>>;
  /** Shape-level response check — see `IApiDirectScrapeShape.checkBody`. */
  readonly checkBody?: BodyCheck;
  /** Operation-specific checks and the identity of this call. */
  readonly checkBodyByOperation?: OperationBodyChecks;
  readonly operation?: ScrapeOperation;
  /** Shape-level body digest — see `IApiDirectScrapeShape.bodyDigest`. */
  readonly bodyDigest?: IBodyDigestConfig;
  /** Omit bank response text from failed calls when the bank opts in. */
  readonly omitBankText?: boolean;
  /** Shape-level response session — see `IApiDirectScrapeShape.responseSession`. */
  readonly responseSession?: IResponseSessionSpec;
  /** Name the call's response-session failures carry; `queryTag` when absent. */
  readonly call?: string;
}

/** Dispatch args whose vars are an object — what templates and signing need. */
interface IObjectDispatchArgs extends Omit<IDispatchArgs, 'vars'> {
  readonly vars: VarsMap;
}

/** A hydrated REST POST body plus the opts its digest header belongs on. */
interface IPreparedPost {
  readonly body: ApiBody;
  readonly opts: IApiQueryOpts;
}

/** An object-only REST POST feature and its refusal of array vars. */
interface IArrayPostRefusal {
  readonly field: 'bodyTemplate' | 'signer';
  readonly message: string;
}

/** Object-only REST POST features, in the order dispatch applies them. */
const ARRAY_POST_REFUSALS: readonly IArrayPostRefusal[] = [
  { field: 'bodyTemplate', message: 'scrape bodyTemplate needs object vars' },
  { field: 'signer', message: 'scrape body signing needs an object' },
];

/** Refusal of array vars on a GraphQL step. */
const GRAPHQL_ARRAY_VARS = 'scrape vars must be an object for GraphQL';

/**
 * Whether step vars are a top-level JSON array. `Array.isArray` alone
 * does not narrow a readonly array out of the union.
 * @param vars - Step vars.
 * @returns True for an array.
 */
function isPostArray(vars: ApiPostData): vars is readonly JsonValue[] {
  return Array.isArray(vars);
}

/**
 * Run the shape's body check on a successful response; a failed response,
 * or a shape with no check, passes through unchanged.
 * @param response - The call's result.
 * @param checkBody - The shape's check, when it declares one.
 * @returns The response, or the check's failure.
 */
export function applyBodyCheck(
  response: Procedure<ApiBody>,
  checkBody?: BodyCheck,
): Procedure<ApiBody> {
  if (!isOk(response) || checkBody === undefined) return response;
  return checkBody(response.value);
}

/**
 * Apply the operation check, then the global check to its result.
 * @param response - The call's result.
 * @param checkBody - Global check, when declared.
 * @param operationCheck - Check for this operation, when declared.
 * @returns The checked response or the first failure.
 */
export function applyBodyChecks(
  response: Procedure<ApiBody>,
  checkBody?: BodyCheck,
  operationCheck?: BodyCheck,
): Procedure<ApiBody> {
  const selected = applyBodyCheck(response, operationCheck);
  return applyBodyCheck(selected, checkBody);
}

/**
 * Rebuild an opted-in scrape failure without its bank-supplied response text.
 * @param response - Scrape call result.
 * @param name - Name of the failed call.
 * @param omitBankText - Whether the bank opted out of response text.
 * @returns A sanitized failure or the unchanged result.
 */
export function omitBankResponseText<T>(
  response: Procedure<T>,
  name: string,
  omitBankText?: boolean,
): Procedure<T> {
  if (isOk(response) || omitBankText !== true) return response;
  return sanitiseStepFailure({ name }, response);
}

/**
 * Dispatch a REST POST scrape step: hydrate the body from the step's
 * `bodyTemplate` (or bare vars), apply the optional shape-level signer,
 * add the optional body digest header over the final body, then POST
 * against the resolved URL. Split from {@link dispatchStep}
 * so the router stays a thin 3-way switch.
 * @param args - Dispatch bundle.
 * @param url - Resolved REST URL (router guarantees it is not `false`).
 * @returns Procedure with the typed payload.
 */
async function dispatchRestPost(
  args: IObjectDispatchArgs,
  url: WKUrlOrLiteral,
): Promise<Procedure<ApiBody>> {
  const prepared = preparedPost(args);
  if (!isOk(prepared)) return prepared;
  return args.bus.apiPost<ApiBody>(url, prepared.value.body, prepared.value.opts);
}

/**
 * Hydrate and sign a REST POST body, then attach its digest header.
 * @param args - Dispatch bundle whose vars are an object.
 * @returns The ready body and opts, or the first refusal.
 */
function preparedPost(args: IObjectDispatchArgs): Procedure<IPreparedPost> {
  const bodyProc = resolveStepBody(args);
  if (!isOk(bodyProc)) return bodyProc;
  const signedProc = maybeSignBody(bodyProc.value, args);
  if (!isOk(signedProc)) return signedProc;
  const opts = withBodyDigest(args.opts, signedProc.value, args.bodyDigest);
  return succeed({ body: signedProc.value, opts });
}

/**
 * POST array vars as they are, unless the step uses a feature that needs
 * an object — then fail with that feature's refusal.
 * @param args - Dispatch bundle whose vars are an array.
 * @param url - Resolved REST URL.
 * @returns Procedure with the typed payload.
 */
async function dispatchArrayPost(
  args: IDispatchArgs,
  url: WKUrlOrLiteral,
): Promise<Procedure<ApiBody>> {
  const refusal = ARRAY_POST_REFUSALS.find((r): boolean => args[r.field] !== false);
  if (refusal !== undefined) return fail(ScraperErrorTypes.Generic, refusal.message);
  return args.bus.apiPost<ApiBody>(url, args.vars, args.opts);
}

/**
 * Send a GraphQL step; its variables must be an object.
 * @param args - Dispatch bundle.
 * @returns Procedure with the typed payload.
 */
async function dispatchGraphQl(args: IDispatchArgs): Promise<Procedure<ApiBody>> {
  if (isPostArray(args.vars)) return fail(ScraperErrorTypes.Generic, GRAPHQL_ARRAY_VARS);
  return args.bus.apiQuery<ApiBody>(args.queryTag, args.vars, args.opts);
}

/**
 * Route one scrape call: GraphQL when `urlTag` is absent, REST GET when
 * `method === 'GET'` (no body, same opts), REST POST of array vars as
 * they are, and REST POST otherwise (body hydrated/signed).
 * @param args - Dispatch bundle.
 * @returns Procedure with the typed payload.
 */
async function routeStep(args: IDispatchArgs): Promise<Procedure<ApiBody>> {
  if (args.urlTag === false) return dispatchGraphQl(args);
  if (args.method === 'GET') return args.bus.apiGet<ApiBody>(args.urlTag, args.opts);
  if (isPostArray(args.vars)) return dispatchArrayPost(args, args.urlTag);
  return dispatchRestPost({ ...args, vars: args.vars }, args.urlTag);
}

/**
 * Dispatch one scrape step against the mediator, strip the bank's text from a
 * failed call when the shape asks for it, run the shape's body check on a
 * successful response, then read its response session. The bank-text rule
 * runs before the check so a check's own descriptive message survives.
 * @param args - Dispatch bundle.
 * @returns Procedure with the typed payload.
 */
export async function dispatchStep(args: IDispatchArgs): Promise<Procedure<ApiBody>> {
  if (args.checkBodyByOperation !== undefined && args.operation === undefined) {
    return fail(ScraperErrorTypes.Generic, 'scrape operation required for body checks');
  }
  const capture = captureAnswer(args.opts, args.responseSession);
  const response = await routeStep({ ...args, opts: capture.opts });
  const answered = omitBankResponseText(response, args.call ?? args.queryTag, args.omitBankText);
  return checkAndRead(answered, capture, args);
}

/**
 * Apply the shape's body checks, then read the call's response session.
 * @param answered - The sanitised response.
 * @param capture - The answers the call's sink filed.
 * @param args - Dispatch bundle.
 * @returns The checked response with its session patch applied.
 */
function checkAndRead(
  answered: Procedure<ApiBody>,
  capture: IAnswerCapture,
  args: IDispatchArgs,
): Procedure<ApiBody> {
  const operationCheck = args.operation && args.checkBodyByOperation?.[args.operation];
  const checked = applyBodyChecks(answered, args.checkBody, operationCheck);
  return readResponseSession(checked, capture, args);
}
