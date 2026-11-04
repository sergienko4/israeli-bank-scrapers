/**
 * N8 — the session-transport fields of an api-direct call config are
 * checked against its bank's headless block when the pipeline is built.
 *
 * A document step reads no body extracts or outcome, and carries a marker
 * only when it is a document step; a manual redirect runs only on a GET step,
 * allows at least one URL rule and 1–10 hops, and needs the bank default
 * `reject`. Each broken config fails with its exact
 * `"<field>: <rule>"` text; the bootstrap / landing / logon steps a
 * session bank runs pass.
 */

import { ScraperErrorTypes } from '../../../../../Scrapers/Base/ErrorTypes.js';
import {
  type IApiDirectRuleInput,
  validateApiDirectConfig,
} from '../../../../../Scrapers/Pipeline/Core/Builder/ApiDirectConfigRules.js';
import type { IStepConfig } from '../../../../../Scrapers/Pipeline/Mediator/ApiDirectCall/ConfigContracts/index.js';
import type {
  IManualRedirect,
  RedirectPolicy,
} from '../../../../../Scrapers/Pipeline/Types/Domain/FetchPolicy.js';

/** The bank's headless block when it has one. */
type HeadlessBlock = Exclude<IApiDirectRuleInput['headless'], false>;

const ORIGIN = 'https://session.example';
const BANK: HeadlessBlock = {
  identityBase: ORIGIN,
  graphql: `${ORIGIN}/graphql`,
  paths: {},
  nativeFetch: true,
};
const MANUAL: IManualRedirect = { maxHops: 3, allow: [{ origin: ORIGIN, paths: ['/home'] }] };

const BOOTSTRAP: IStepConfig = {
  name: 'bootstrap',
  urlTag: 'auth.bootstrap',
  method: 'GET',
  extractsToCarry: {},
  response: 'document',
  headerExtractsToCarry: { xsrf: { header: 'x-xsrf-token' } },
};

const LANDING: IStepConfig = {
  name: 'landing',
  urlTag: 'auth.landing',
  method: 'GET',
  extractsToCarry: {},
  redirect: MANUAL,
  response: 'document',
  documentMarker: 'welcome',
};

const LOGON: IStepConfig = {
  name: 'logon',
  urlTag: 'auth.logon',
  body: { shape: { user: { $literal: 'u' } } },
  extractsToCarry: { session: '/session' },
  redirect: 'reject',
};

/**
 * The bank's headless block under the given default redirect policy.
 * @param redirectPolicy - Bank default.
 * @returns Headless block.
 */
function bankWith(redirectPolicy: RedirectPolicy): HeadlessBlock {
  return { ...BANK, redirectPolicy };
}

const REJECT = bankWith('reject');
const FOLLOW = bankWith('follow');
const BANK_MANUAL = bankWith(MANUAL);

/**
 * Rule input running the given steps beside the given headless block.
 * @param steps - Login steps.
 * @param headless - Bank headless block, or false when it has none.
 * @returns Rule input.
 */
function runOf(
  steps: readonly IStepConfig[],
  headless: IApiDirectRuleInput['headless'],
): IApiDirectRuleInput {
  return { call: { flow: 'sms-otp', envelope: {}, steps }, headless };
}

/**
 * The landing step redirecting under a manual policy with the given fields.
 * @param overrides - Manual policy fields to set.
 * @returns Landing step.
 */
function landingWith(overrides: Partial<IManualRedirect>): IStepConfig {
  return { ...LANDING, redirect: { ...MANUAL, ...overrides } };
}

/**
 * Rule input running only the landing step under the given manual fields.
 * @param overrides - Manual policy fields to set.
 * @returns Rule input with the session bank's `reject` default.
 */
function landingRun(overrides: Partial<IManualRedirect>): IApiDirectRuleInput {
  const landing = landingWith(overrides);
  return runOf([landing], REJECT);
}

/** Durable auth fields beside the resume steps. */
const RESUME_AUTH = {
  provider: 'syn-provider',
  clientInstanceIdField: 'clientInstanceId',
  deviceIdField: 'deviceId',
  accountField: 'account',
  freshnessMarginSeconds: 60,
} as const;

/**
 * Rule input whose only resume step is the given one.
 * @param step - Resume step.
 * @returns Rule input with the session bank's `reject` default.
 */
function resumeOf(step: IStepConfig): IApiDirectRuleInput {
  const persistentAuth = { ...RESUME_AUTH, resumeSteps: [step] };
  const steps = [LOGON];
  const call: IApiDirectRuleInput['call'] = {
    flow: 'sms-otp',
    envelope: {},
    steps,
    persistentAuth,
  };
  return { call, headless: REJECT };
}

const DOC_EXTRACTS: IStepConfig = { ...BOOTSTRAP, extractsToCarry: { token: '/token' } };
const DOC_OPTIONAL: IStepConfig = {
  ...BOOTSTRAP,
  optionalExtractsToCarry: { token: { pointer: '/token' } },
};
const DOC_OUTCOME: IStepConfig = {
  ...BOOTSTRAP,
  outcome: {
    codePointer: '/code',
    successCodes: ['0'],
    failureMap: {},
    defaultFailure: ScraperErrorTypes.Generic,
  },
};
const MARKED_JSON: IStepConfig = { ...LOGON, documentMarker: 'welcome' };
const POST_MANUAL: IStepConfig = { ...LOGON, redirect: MANUAL };

/** A config, the headless block beside it, and the text it fails with. */
interface IBrokenCase {
  readonly label: string;
  readonly input: IApiDirectRuleInput;
  readonly message: string;
}

const DOC_MSG = 'steps.response: a document step reads no body extracts or outcome';
const MARKER_MSG = 'steps.documentMarker: only on a document step';
const GET_MSG = 'steps.redirect: manual only on GET steps';
const BANK_MANUAL_MSG = 'headless.redirectPolicy: manual only on GET steps';
const ALLOW_MSG = 'redirect.allow: must not be empty';
const HOPS_MSG = 'redirect.maxHops: must be an integer from 1 to 10';
const DEFAULT_MSG = 'headless.redirectPolicy: must be reject when a step redirects manually';

const BROKEN: readonly IBrokenCase[] = [
  { label: 'document step with extracts', input: runOf([DOC_EXTRACTS], REJECT), message: DOC_MSG },
  { label: 'document step, optional', input: runOf([DOC_OPTIONAL], REJECT), message: DOC_MSG },
  { label: 'document step with outcome', input: runOf([DOC_OUTCOME], REJECT), message: DOC_MSG },
  { label: 'document resume step', input: resumeOf(DOC_EXTRACTS), message: DOC_MSG },
  { label: 'document resume step with outcome', input: resumeOf(DOC_OUTCOME), message: DOC_MSG },
  { label: 'marker off a document step', input: runOf([MARKED_JSON], REJECT), message: MARKER_MSG },
  { label: 'marker off a resume step', input: resumeOf(MARKED_JSON), message: MARKER_MSG },
  { label: 'manual POST step', input: runOf([POST_MANUAL], REJECT), message: GET_MSG },
  { label: 'manual POST resume step', input: resumeOf(POST_MANUAL), message: GET_MSG },
  {
    label: 'manual bank default',
    input: runOf([LOGON], BANK_MANUAL),
    message: BANK_MANUAL_MSG,
  },
  {
    label: 'empty allow list',
    input: landingRun({ allow: [] }),
    message: ALLOW_MSG,
  },
  { label: 'no hops', input: landingRun({ maxHops: 0 }), message: HOPS_MSG },
  { label: 'eleven hops', input: landingRun({ maxHops: 11 }), message: HOPS_MSG },
  {
    label: 'fractional hops',
    input: landingRun({ maxHops: 1.5 }),
    message: HOPS_MSG,
  },
  { label: 'manual step, no headless', input: runOf([LANDING], false), message: DEFAULT_MSG },
  { label: 'manual step, no default', input: runOf([LANDING], BANK), message: DEFAULT_MSG },
  {
    label: 'manual step, follow',
    input: runOf([LANDING], FOLLOW),
    message: DEFAULT_MSG,
  },
];

/** A config the rules accept. */
interface ISoundCase {
  readonly label: string;
  readonly input: IApiDirectRuleInput;
}

const SOUND: readonly ISoundCase[] = [
  { label: 'bootstrap, landing, logon', input: runOf([BOOTSTRAP, LANDING, LOGON], REJECT) },
  { label: 'one hop', input: landingRun({ maxHops: 1 }) },
  { label: 'ten hops', input: landingRun({ maxHops: 10 }) },
  { label: 'fixed policies, follow default', input: runOf([LOGON], FOLLOW) },
];

describe('validateApiDirectConfig — session transport', () => {
  it.each(BROKEN)('$label → fails with the rule text', ({ input, message }) => {
    const result = validateApiDirectConfig(input);
    expect(result).toMatchObject({
      success: false,
      errorType: ScraperErrorTypes.Generic,
      errorMessage: message,
    });
  });

  it.each(SOUND)('$label → passes', ({ input }) => {
    const result = validateApiDirectConfig(input);
    expect(result).toEqual({ success: true, value: true });
  });
});
