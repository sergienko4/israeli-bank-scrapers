/**
 * Shared fixtures for the Discount login-config tests: the telebank origin,
 * synthetic creds and carry, and helpers that load the config (by a dynamic
 * import, per the Pipeline test rule), hydrate a step's templates and run
 * its answer checks.
 */

import type { IApiDirectRuleInput } from '../../../../../Scrapers/Pipeline/Core/Builder/ApiDirectConfigRules.js';
import type {
  IApiDirectCallConfig,
  IStepConfig,
  JsonValueTemplate,
} from '../../../../../Scrapers/Pipeline/Mediator/ApiDirectCall/ConfigContracts/index.js';
import type { JsonValue } from '../../../../../Scrapers/Pipeline/Mediator/ApiDirectCall/Envelope/JsonPointer.js';
import { cookieRefOf } from '../../../../../Scrapers/Pipeline/Mediator/ApiDirectCall/Flow/RunStep.clientCookies.js';
import { applyExtractRules } from '../../../../../Scrapers/Pipeline/Mediator/ApiDirectCall/Flow/RunStep.extractRules.js';
import { hydrate } from '../../../../../Scrapers/Pipeline/Mediator/ApiDirectCall/Template/GenericBodyTemplate.js';
import { resolveRefText } from '../../../../../Scrapers/Pipeline/Mediator/ApiDirectCall/Template/RefResolver.js';
import type { Procedure } from '../../../../../Scrapers/Pipeline/Types/Procedure.js';
import { isOk } from '../../../../../Scrapers/Pipeline/Types/Procedure.js';

const CONFIG_MODULE =
  '../../../../../Scrapers/Pipeline/Registry/Config/PipelineBankConfigDiscount.js';

/** The bank's headless block, as the build-time validator reads it. */
type HeadlessBlock = Exclude<IApiDirectRuleInput['transport'], false>;

/** The Discount login config and its headless block. */
interface IDiscountModule {
  readonly call: IApiDirectCallConfig;
  readonly headless: HeadlessBlock;
}

/** A slot map, as carry holds it. */
type CarrySlots = Readonly<Record<string, JsonValue>>;

const ORIGIN = 'https://start.telebank.co.il';
const LOGIN_PAGE = `${ORIGIN}/login/`;
const UA = 'BankApiInteroperabilityResearch/1.0';

const CREDS = { id: '123456789', password: 'syn-p\u00e4ss', num: 'SYN42' } as const;

/** The synthetic id as the bank's web app formats it, and its MD5. */
const UID = '00001123456789';
const UID_MD5 = 'cf2a090bba654295a35131427b3b067b';

const CARRY = { uid: UID, uidMd5: UID_MD5, rsaKey: 'syn-key', mi6: UID_MD5 } as const;

/**
 * Load the Discount config module.
 * @returns Its login config and headless block.
 */
async function loadModule(): Promise<IDiscountModule> {
  const loaded = (await import(CONFIG_MODULE)) as Record<string, unknown>;
  const call = loaded.default as IApiDirectCallConfig;
  const headless = loaded.DISCOUNT_HEADLESS as HeadlessBlock;
  return { call, headless };
}

/**
 * Hydrate a template with the fixed creds and carry above.
 * @param template - Body, header or query template.
 * @param config - The config the template belongs to.
 * @returns The hydrated value; fails the test when hydration fails.
 */
function hydrateFixed(template: JsonValueTemplate, config: IApiDirectCallConfig): JsonValue {
  const scope = { carry: CARRY, creds: CREDS, config };
  const result = hydrate(template, scope);
  if (!isOk(result)) throw new TypeError(result.errorMessage);
  return result.value;
}

/**
 * Hydrate every header of a step.
 * @param step - Login step.
 * @param call - Login config.
 * @returns Header name → hydrated text.
 */
function hydratedHeaders(step: IStepConfig, call: IApiDirectCallConfig): Record<string, JsonValue> {
  const entries = Object.entries(step.headers ?? {});
  const hydrated = entries.map(([name, template]) => [name, hydrateFixed(template, call)]);
  return Object.fromEntries(hydrated) as Record<string, JsonValue>;
}

/**
 * Resolve every cookie a step sets before its request.
 * @param step - Login step.
 * @param call - Login config.
 * @returns Cookie name → resolved value, or false when unresolved.
 */
function resolvedCookies(step: IStepConfig, call: IApiDirectCallConfig): Record<string, unknown> {
  const scope = { carry: CARRY, creds: CREDS, config: call };
  const entries = Object.entries(step.setCookies ?? {});
  const resolved = entries.map(([name, source]) => {
    const ref = cookieRefOf(source);
    return [name, resolveRefText(ref, scope)];
  });
  return Object.fromEntries(resolved) as Record<string, unknown>;
}

/**
 * Reduce a check's result to what a test compares.
 * @param proc - The check's result.
 * @returns The value, or the refusal's type and message.
 */
function verdictOf(proc: Procedure<unknown>): unknown {
  return isOk(proc) ? proc.value : [proc.errorType, proc.errorMessage];
}

/**
 * Run a step's extract rules over the slots it read.
 * @param step - Login step.
 * @param call - Login config.
 * @param carry - The slots as read.
 * @returns The ruled slots, or the refusal's type and message.
 */
function ruled(step: IStepConfig, call: IApiDirectCallConfig, carry: CarrySlots): unknown {
  const scope = { carry, creds: CREDS, config: call };
  const input = { step, resp: {}, carry, stepUrl: LOGIN_PAGE, scope };
  const result = applyExtractRules(input);
  return verdictOf(result);
}

export type { CarrySlots };
export {
  CARRY,
  CREDS,
  hydratedHeaders,
  hydrateFixed,
  loadModule,
  LOGIN_PAGE,
  ORIGIN,
  resolvedCookies,
  ruled,
  UA,
  UID,
  UID_MD5,
  verdictOf,
};
