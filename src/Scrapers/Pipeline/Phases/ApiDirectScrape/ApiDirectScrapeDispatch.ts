/**
 * Scrape-phase dispatch helpers — REST/GraphQL routing, body-template
 * hydration, and shape-level signature attachment. Split from
 * ApiDirectScrapeSteps.ts to keep both files under the 150-LOC ceiling.
 *
 * Zero bank knowledge.
 */

import { randomBytes } from 'node:crypto';

import { ScraperErrorTypes } from '../../../Base/ErrorTypes.js';
import type { IApiMediator, IApiQueryOpts } from '../../Mediator/Api/ApiMediator.js';
import type {
  IAesSignerConfig,
  IApiDirectCallConfig,
  JsonValueTemplate,
} from '../../Mediator/ApiDirectCall/ConfigContracts/index.js';
import type { JsonValue } from '../../Mediator/ApiDirectCall/Envelope/JsonPointer.js';
import { attachBodySignature } from '../../Mediator/ApiDirectCall/Flow/RunStepBodySigning.js';
import { hydrate } from '../../Mediator/ApiDirectCall/Template/GenericBodyTemplate.js';
import type { ITemplateScope } from '../../Mediator/ApiDirectCall/Template/RefResolver.js';
import type { WKUrlOrLiteral } from '../../Registry/WK/UrlsWK.js';
import type { ApiPostData } from '../../Types/Domain/ApiPostData.js';
import type { IActionContext } from '../../Types/PipelineContext.js';
import type { Procedure } from '../../Types/Procedure.js';
import { fail, isOk, succeed } from '../../Types/Procedure.js';
import type { ApiBody, BodyCheck, ScrapeHttpMethod, VarsMap } from './IApiDirectScrapeShape.js';

/** Synthetic IApiDirectCallConfig sentinel used by scrape-phase scope. */
const SCRAPE_CONFIG_SENTINEL: IApiDirectCallConfig = Object.freeze({
  flow: 'sms-otp',
  steps: [],
  envelope: {},
});

/** Args bundle for {@link buildScrapeScope} — keeps params ≤3. */
export interface IBuildScrapeScopeArgs {
  readonly bus: IApiMediator;
  readonly ctx: IActionContext;
  readonly vars: VarsMap;
  /**
   * Optional shape-level secrets — merged into the synthetic scope
   * config so `config.secrets.<name>` $ref lookups resolve during
   * body-pointer signing.
   */
  readonly secrets?: Readonly<Record<string, string>>;
}

/**
 * Build the scope's synthetic IApiDirectCallConfig — adds the
 * shape-level secrets when present. Empty `secrets` object means the
 * shape did not declare any (callers pass `args.secrets`, which is
 * already typed as `Readonly<Record<string, string>>` to avoid a
 * nullable return shape).
 * @param secrets - Secrets map (empty object when shape declares none).
 * @returns Frozen synthetic config.
 */
function buildScopeConfig(secrets: Readonly<Record<string, string>>): IApiDirectCallConfig {
  if (Object.keys(secrets).length === 0) return SCRAPE_CONFIG_SENTINEL;
  return Object.freeze({ ...SCRAPE_CONFIG_SENTINEL, secrets });
}

/** Empty secrets sentinel used when the shape declares none. */
const EMPTY_SECRETS: Readonly<Record<string, string>> = Object.freeze({});

/**
 * Build the post-login scope the scrape-phase dispatcher passes into
 * the template hydrator + body signer.
 * @param args - Scope-build bundle (bus + ctx + vars + optional secrets).
 * @returns Template scope.
 */
export function buildScrapeScope(args: IBuildScrapeScopeArgs): ITemplateScope {
  const session = args.bus.getSessionContext() as Record<string, JsonValue>;
  const varsJson = args.vars as Record<string, JsonValue>;
  return {
    carry: { ...session, ...varsJson },
    creds: args.ctx.credentials,
    config: buildScopeConfig(args.secrets ?? EMPTY_SECRETS),
  };
}

/** Args bundle for {@link dispatchStep} — keeps params ≤3. */
export interface IDispatchArgs {
  readonly bus: IApiMediator;
  readonly ctx: IActionContext;
  readonly queryTag: 'customer' | 'balance' | 'transactions';
  readonly urlTag: WKUrlOrLiteral | false;
  /** REST verb for the urlTag branch — GET sends no body, POST hydrates one. */
  readonly method: ScrapeHttpMethod;
  /** Step vars; an array is sent only by a plain REST POST step (N19). */
  readonly vars: ApiPostData;
  readonly bodyTemplate: JsonValueTemplate | false;
  readonly signer: IAesSignerConfig | false;
  readonly opts: IApiQueryOpts;
  /** Shape-level secrets — threaded into scope.config.secrets for signing. */
  readonly secrets?: Readonly<Record<string, string>>;
  /** Shape-level response check — see `IApiDirectScrapeShape.checkBody`. */
  readonly checkBody?: BodyCheck;
}

/** Dispatch args whose vars are an object — what templates and signing need. */
interface IObjectDispatchArgs extends Omit<IDispatchArgs, 'vars'> {
  readonly vars: VarsMap;
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
 * Validate that a hydrated body is a plain object (not array/null).
 * @param value - Hydrated JsonValue.
 * @returns Procedure narrowed to the object shape.
 */
function asPlainObject(value: JsonValue): Procedure<Record<string, unknown>> {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    return fail(ScraperErrorTypes.Generic, 'scrape bodyTemplate did not hydrate to an object');
  }
  return succeed(value as Record<string, unknown>);
}

/**
 * Hydrate the step body from `bodyTemplate` when present, else fall
 * back to the bare `vars` payload.
 * @param args - Dispatch bundle.
 * @returns Procedure with the body.
 */
function resolveStepBody(args: IObjectDispatchArgs): Procedure<Record<string, unknown>> {
  if (args.bodyTemplate === false) return succeed(args.vars);
  const scope = buildScrapeScope(args);
  const hydrated = hydrate(args.bodyTemplate, scope);
  if (!isOk(hydrated)) return hydrated;
  return asPlainObject(hydrated.value);
}

/**
 * Fresh 16-byte IV expressed as 32-char lowercase hex.
 * @returns Lowercase hex string of length 32.
 */
function freshIvHex(): string {
  const bytes = randomBytes(16);
  return bytes.toString('hex');
}

/**
 * Build the primed scope used by the scrape-phase body signer.
 * @param signer - Shape-level AES signer config.
 * @param args - Dispatch args (bus + ctx + vars).
 * @returns Primed template scope.
 */
function buildPrimedScrapeScope(
  signer: IAesSignerConfig,
  args: IObjectDispatchArgs,
): ITemplateScope {
  const scope = buildScrapeScope(args);
  const ivHex = freshIvHex();
  const nowMs = Date.now();
  const tsMs = String(nowMs);
  const carry = { ...scope.carry, tsMs, [signer.ivCarrySlot]: ivHex };
  return { ...scope, carry };
}

/**
 * Apply the shape-level body signer when configured.
 * @param body - Hydrated body before POST.
 * @param args - Dispatch bundle.
 * @returns Procedure with the (signed) body.
 */
function maybeSignBody(
  body: Record<string, unknown>,
  args: IObjectDispatchArgs,
): Procedure<Record<string, unknown>> {
  if (args.signer === false) return succeed(body);
  const primedScope = buildPrimedScrapeScope(args.signer, args);
  return attachBodySignature({ scope: primedScope, body, pathAndQuery: '' });
}

/**
 * Dispatch a REST POST scrape step: hydrate the body from the step's
 * `bodyTemplate` (or bare vars), apply the optional shape-level signer,
 * then POST against the resolved URL. Split from {@link dispatchStep}
 * so the router stays a thin 3-way switch.
 * @param args - Dispatch bundle.
 * @param url - Resolved REST URL (router guarantees it is not `false`).
 * @returns Procedure with the typed payload.
 */
async function dispatchRestPost(
  args: IObjectDispatchArgs,
  url: WKUrlOrLiteral,
): Promise<Procedure<ApiBody>> {
  const bodyProc = resolveStepBody(args);
  if (!isOk(bodyProc)) return bodyProc;
  const signedProc = maybeSignBody(bodyProc.value, args);
  if (!isOk(signedProc)) return signedProc;
  return args.bus.apiPost<ApiBody>(url, signedProc.value, args.opts);
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
 * Dispatch one scrape step against the mediator, then run the shape's
 * body check on a successful response.
 * @param args - Dispatch bundle.
 * @returns Procedure with the typed payload.
 */
export async function dispatchStep(args: IDispatchArgs): Promise<Procedure<ApiBody>> {
  const response = await routeStep(args);
  return applyBodyCheck(response, args.checkBody);
}
