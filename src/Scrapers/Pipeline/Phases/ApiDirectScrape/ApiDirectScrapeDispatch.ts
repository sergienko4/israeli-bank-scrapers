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
import type { JsonValue } from '../../Mediator/ApiDirectCall/Envelope/JsonPointer.js';
import { attachBodySignature } from '../../Mediator/ApiDirectCall/Flow/RunStepBodySigning.js';
import type {
  IAesSignerConfig,
  IApiDirectCallConfig,
  JsonValueTemplate,
} from '../../Mediator/ApiDirectCall/IApiDirectCallConfig.js';
import { hydrate } from '../../Mediator/ApiDirectCall/Template/GenericBodyTemplate.js';
import type { ITemplateScope } from '../../Mediator/ApiDirectCall/Template/RefResolver.js';
import type { WKUrlGroup } from '../../Registry/WK/UrlsWK.js';
import type { IActionContext } from '../../Types/PipelineContext.js';
import type { Procedure } from '../../Types/Procedure.js';
import { fail, isOk, succeed } from '../../Types/Procedure.js';
import type { ApiBody, VarsMap } from './IApiDirectScrapeShape.js';

/** Synthetic IApiDirectCallConfig sentinel used by scrape-phase scope. */
const SCRAPE_CONFIG_SENTINEL: IApiDirectCallConfig = Object.freeze({
  flow: 'sms-otp',
  steps: [],
  envelope: {},
});

/**
 * Build the post-login scope the scrape-phase dispatcher passes into
 * the template hydrator + body signer.
 * @param bus - ApiMediator (for session-context lookup).
 * @param ctx - Action context (for credentials).
 * @param vars - Step `buildVars` output, merged under carry.
 * @returns Template scope.
 */
export function buildScrapeScope(
  bus: IApiMediator,
  ctx: IActionContext,
  vars: VarsMap,
): ITemplateScope {
  const session = bus.getSessionContext() as Record<string, JsonValue>;
  const varsJson = vars as Record<string, JsonValue>;
  return {
    carry: { ...session, ...varsJson },
    creds: ctx.credentials,
    config: SCRAPE_CONFIG_SENTINEL,
  };
}

/** Args bundle for {@link dispatchStep} — keeps params ≤3. */
export interface IDispatchArgs {
  readonly bus: IApiMediator;
  readonly ctx: IActionContext;
  readonly queryTag: 'customer' | 'balance' | 'transactions';
  readonly urlTag: WKUrlGroup | false;
  readonly vars: VarsMap;
  readonly bodyTemplate: JsonValueTemplate | false;
  readonly signer: IAesSignerConfig | false;
  readonly opts: IApiQueryOpts;
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
function resolveStepBody(args: IDispatchArgs): Procedure<Record<string, unknown>> {
  if (args.bodyTemplate === false) return succeed(args.vars);
  const scope = buildScrapeScope(args.bus, args.ctx, args.vars);
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
function buildPrimedScrapeScope(signer: IAesSignerConfig, args: IDispatchArgs): ITemplateScope {
  const scope = buildScrapeScope(args.bus, args.ctx, args.vars);
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
  args: IDispatchArgs,
): Procedure<Record<string, unknown>> {
  if (args.signer === false) return succeed(body);
  const primedScope = buildPrimedScrapeScope(args.signer, args);
  return attachBodySignature({ scope: primedScope, body, pathAndQuery: '' });
}

/**
 * Dispatch one scrape step against the mediator. REST when `urlTag`
 * is set, GraphQL otherwise. Bodies are hydrated/signed before POST.
 * @param args - Dispatch bundle.
 * @returns Procedure with the typed payload.
 */
export async function dispatchStep(args: IDispatchArgs): Promise<Procedure<ApiBody>> {
  if (args.urlTag === false) {
    return args.bus.apiQuery<ApiBody>(args.queryTag, args.vars, args.opts);
  }
  const bodyProc = resolveStepBody(args);
  if (!isOk(bodyProc)) return bodyProc;
  const signedProc = maybeSignBody(bodyProc.value, args);
  if (!isOk(signedProc)) return signedProc;
  return args.bus.apiPost<ApiBody>(args.urlTag, signedProc.value, args.opts);
}
