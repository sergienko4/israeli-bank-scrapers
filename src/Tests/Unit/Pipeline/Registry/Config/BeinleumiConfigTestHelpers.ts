/**
 * Shared fixtures for the Beinleumi login-config tests: the traced origin and
 * headers, synthetic creds and carry, and helpers that load the config (by a
 * dynamic import, per the Pipeline test rule), hydrate a step's templates and
 * run its answer checks.
 */

import type { IApiDirectRuleInput } from '../../../../../Scrapers/Pipeline/Core/Builder/Validation/ApiDirectConfigRules.js';
import type {
  IApiDirectCallConfig,
  IStepConfig,
  JsonValueTemplate,
} from '../../../../../Scrapers/Pipeline/Mediator/ApiDirectCall/ConfigContracts/index.js';
import type { JsonValue } from '../../../../../Scrapers/Pipeline/Mediator/ApiDirectCall/Envelope/JsonPointer.js';
import { classifyAnswer } from '../../../../../Scrapers/Pipeline/Mediator/ApiDirectCall/Flow/Steps/RunStep.classify.js';
import { applyExtractRules } from '../../../../../Scrapers/Pipeline/Mediator/ApiDirectCall/Flow/Steps/RunStep.extractRules.js';
import { hydrate } from '../../../../../Scrapers/Pipeline/Mediator/ApiDirectCall/Template/GenericBodyTemplate.js';
import { isOk } from '../../../../../Scrapers/Pipeline/Types/Procedure.js';

const CONFIG_MODULE =
  '../../../../../Scrapers/Pipeline/Registry/Config/PipelineBankConfigBeinleumi.js';

/** The bank's transport block, as the build-time validator reads it. */
type HeadlessBlock = Exclude<IApiDirectRuleInput['transport'], false>;

/** The Beinleumi login config and its transport block. */
interface IBeinleumiModule {
  readonly call: IApiDirectCallConfig;
  readonly headless: HeadlessBlock;
}

/** A slot map, as carry holds it. */
type CarrySlots = Readonly<Record<string, JsonValue>>;

const ORIGIN = 'https://online.fibi.co.il';
const ENTRY = `${ORIGIN}/MatafLoginService/MatafLoginServlet?bankId=FIBIPORTAL&site=Private&KODSAFA=HE`;
const SERVLET = `${ORIGIN}/MatafLoginService/MatafLoginServlet`;
const UA = 'BankApiInteroperabilityResearch/1.0';

const CREDS = { username: 'SynUser', password: 'syn-p\u00e4ss' } as const;

/** A synthetic collection result, standing in for the flow's fingerprint. */
const FINGERPRINT = { metadata: { syn: 'fp' } } as const;

const CARRY = {
  flowId: 'AB'.repeat(32),
  uid: 'synuser',
  did: 'syn-did',
  sid: 'syn-sid',
  ecdhPublic: 'BHN5bi1wdWI=',
  bankNum: '031',
  client_ip: '192.0.2.7',
  pwdAssertionId: 'syn-pwd-assertion',
  challenge: 'syn-challenge',
  otpAssertionId: 'syn-otp-assertion',
  otpTargetId: 'syn-target',
  otpCode: '123456',
  token: 'syn.token-1',
  loginForm: { user: '', passwordEnc: '', bankId: 'FIBIPORTAL', site: 'Private' },
  handoffUrl: `${ORIGIN}/appsng/Resources/PortalNG/shell/`,
  landingUrl: `${ORIGIN}/appsng/Resources/PortalNG/shell/#/accountSummary`,
  ssoCode: 'syn-code_1',
} as const;

/** The fixed headers every Transmit call sends. */
const TRANSMIT_HEADERS = {
  'content-type': 'application/json',
  accept: 'application/json',
  'x-ts-client-version': '7.3.0;[11]',
  authorization: 'TSToken null; tid=null',
  'user-agent': UA,
  origin: ORIGIN,
  referer: ENTRY,
} as const;

/** The flow and user headers every Transmit envelope opens with. */
const ENVELOPE_HEADERS = [
  { type: 'flow_id', flow_id: CARRY.flowId },
  { type: 'uid', uid: CARRY.uid },
] as const;

/**
 * Load the Beinleumi config module.
 * @returns Its login config and transport block.
 */
async function loadModule(): Promise<IBeinleumiModule> {
  const loaded = (await import(CONFIG_MODULE)) as Record<string, unknown>;
  const call = loaded.default as IApiDirectCallConfig;
  const headless = loaded.BEINLEUMI_TRANSPORT as HeadlessBlock;
  return { call, headless };
}

/**
 * Hydrate a template with the fixed creds, fingerprint and carry above.
 * @param template - Body, header or query template.
 * @param config - The config the template belongs to.
 * @param carry - Carry to hydrate against; the fixed carry by default.
 * @returns The hydrated value; fails the test when hydration fails.
 */
function hydrateFixed(
  template: JsonValueTemplate,
  config: IApiDirectCallConfig,
  carry: CarrySlots = CARRY,
): JsonValue {
  const scope = { carry, creds: CREDS, config, fingerprint: FINGERPRINT };
  const result = hydrate(template, scope);
  if (!isOk(result)) throw new TypeError(result.errorMessage);
  return result.value;
}

/**
 * The named login step.
 * @param call - Login config.
 * @param name - Step name.
 * @returns The step; fails the test when absent.
 */
function stepNamed(call: IApiDirectCallConfig, name: string): IStepConfig {
  const step = call.steps.find(candidate => candidate.name === name);
  if (step === undefined) throw new TypeError(`no ${name} step`);
  return step;
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

/** A step's extracted slots, prior carry and optional response body. */
interface IAnswerRead {
  readonly carry: CarrySlots;
  readonly priorCarry?: CarrySlots;
  readonly resp?: JsonValue;
}

/**
 * Whether a step's rules accept the slots it read.
 * @param step - Login step.
 * @param call - Login config.
 * @param read - Extracted slots, prior carry and the answer (empty by default).
 * @returns True when every rule passes.
 */
function isAccepted(step: IStepConfig, call: IApiDirectCallConfig, read: IAnswerRead): boolean {
  const { carry, priorCarry = {}, resp = {} } = read;
  const scope = { carry: priorCarry, creds: CREDS, config: call };
  const input = { step, resp, carry, stepUrl: ENTRY, scope };
  return applyExtractRules(input).success;
}

/**
 * A slot map without one slot.
 * @param slots - Slot map.
 * @param slot - Slot to leave out.
 * @returns The other slots.
 */
function withoutSlot(slots: CarrySlots, slot: string): CarrySlots {
  const entries = Object.entries(slots);
  const kept = entries.filter(([name]) => name !== slot);
  return Object.fromEntries(kept);
}

/**
 * Classify an answer the way the step's classifier does.
 * @param step - Login step.
 * @param resp - Opened answer.
 * @returns The written slots, or the refusal's message.
 */
function classified(step: IStepConfig, resp: JsonValue): CarrySlots | string {
  const verdict = classifyAnswer(step, resp);
  return isOk(verdict) ? verdict.value : verdict.errorMessage;
}

export type { CarrySlots, IAnswerRead };
export {
  CARRY,
  classified,
  CREDS,
  ENTRY,
  ENVELOPE_HEADERS,
  FINGERPRINT,
  hydratedHeaders,
  hydrateFixed,
  isAccepted,
  loadModule,
  ORIGIN,
  SERVLET,
  stepNamed,
  TRANSMIT_HEADERS,
  UA,
  withoutSlot,
};
