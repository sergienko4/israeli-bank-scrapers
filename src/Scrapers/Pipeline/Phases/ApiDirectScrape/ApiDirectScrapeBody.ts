/**
 * Scrape-phase body preparation — the post-login template scope, body
 * hydration from `bodyTemplate`, and the optional shape-level signature.
 * Split from ApiDirectScrapeDispatch.ts to keep both files under the
 * 150-LOC ceiling.
 *
 * Zero bank knowledge.
 */

import { randomBytes } from 'node:crypto';

import { ScraperErrorTypes } from '../../../Base/ErrorTypes.js';
import type { IApiMediator } from '../../Mediator/Api/ApiMediator.js';
import type {
  IAesSignerConfig,
  IApiDirectCallConfig,
  JsonValueTemplate,
} from '../../Mediator/ApiDirectCall/ConfigContracts/index.js';
import type { JsonValue } from '../../Mediator/ApiDirectCall/Envelope/JsonPointer.js';
import { attachBodySignature } from '../../Mediator/ApiDirectCall/Flow/RunStepBodySigning.js';
import { hydrate } from '../../Mediator/ApiDirectCall/Template/GenericBodyTemplate.js';
import type { ITemplateScope } from '../../Mediator/ApiDirectCall/Template/RefResolver.js';
import type { IActionContext } from '../../Types/PipelineContext.js';
import type { Procedure } from '../../Types/Procedure.js';
import { fail, isOk, succeed } from '../../Types/Procedure.js';
import type { VarsMap } from './IApiDirectScrapeShape.js';

/** Synthetic IApiDirectCallConfig sentinel used by scrape-phase scope. */
const SCRAPE_CONFIG_SENTINEL: IApiDirectCallConfig = Object.freeze({
  flow: 'sms-otp',
  steps: [],
  envelope: {},
});

/** Args bundle for {@link buildScrapeScope} — keeps params ≤3. */
interface IBuildScrapeScopeArgs {
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
function buildScrapeScope(args: IBuildScrapeScopeArgs): ITemplateScope {
  const session = args.bus.getSessionContext() as Record<string, JsonValue>;
  const varsJson = args.vars as Record<string, JsonValue>;
  return {
    carry: { ...session, ...varsJson },
    creds: args.ctx.credentials,
    config: buildScopeConfig(args.secrets ?? EMPTY_SECRETS),
  };
}

/** Body-preparation slice of the dispatch bundle — keeps params ≤3. */
interface IStepBodyArgs extends IBuildScrapeScopeArgs {
  readonly bodyTemplate: JsonValueTemplate | false;
  readonly signer: IAesSignerConfig | false;
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
function resolveStepBody(args: IStepBodyArgs): Procedure<Record<string, unknown>> {
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
function buildPrimedScrapeScope(signer: IAesSignerConfig, args: IStepBodyArgs): ITemplateScope {
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
  args: IStepBodyArgs,
): Procedure<Record<string, unknown>> {
  if (args.signer === false) return succeed(body);
  const primedScope = buildPrimedScrapeScope(args.signer, args);
  return attachBodySignature({ scope: primedScope, body, pathAndQuery: '' });
}

export { maybeSignBody, resolveStepBody };
