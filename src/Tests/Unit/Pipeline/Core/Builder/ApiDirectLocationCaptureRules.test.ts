/**
 * `locationCapture` needs a `text` response; its `into`, `userAgent`
 * and `url` are not empty; its slot is fresh: no other slot the step writes.
 */

import { ScraperErrorTypes } from '../../../../../Scrapers/Base/ErrorTypes.js';
import {
  type IApiDirectRuleInput,
  validateApiDirectConfig,
} from '../../../../../Scrapers/Pipeline/Core/Builder/ApiDirectConfigRules.js';
import type {
  IGetStep,
  ILocationCapture,
} from '../../../../../Scrapers/Pipeline/Mediator/ApiDirectCall/ConfigContracts/index.js';

const HOST = 'https://handoff.example';
const NATIVE = {
  identityBase: HOST,
  graphql: `${HOST}/graphql`,
  paths: {},
  nativeFetch: true,
  redirectPolicy: 'reject' as const,
};
const MANUAL = { maxHops: 2, allow: [{ origin: HOST, anyPathExcept: ['logout'] }] };
const RESPONSE_MSG = 'steps.locationCapture: needs a text response';
const EMPTY_MSG = 'steps.locationCapture: into, userAgent and url must not be empty';
const FRESH_MSG = 'steps.locationCapture: must be a fresh slot';

const CAPTURE: ILocationCapture = {
  into: 'handoffUrl',
  userAgent: 'Mozilla/5.0 (research)',
  url: [{ origin: HOST, anyPathExcept: ['logout'] }],
};

/** The step a case builds: changes over the bank's text step and its capture. */
interface IStepChange {
  readonly step?: Partial<IGetStep>;
  readonly capture?: Partial<ILocationCapture>;
}

/** One refused step, its label and the message. */
interface IRefusalCase extends IStepChange {
  readonly label: string;
  readonly expected: string;
}

/**
 * Rule input running one text step that differs from the bank's.
 * @param change - Fields over the bank's step and capture.
 * @returns Rule input.
 */
function runOf(change: IStepChange): IApiDirectRuleInput {
  const step: IGetStep = {
    name: 'login',
    urlTag: 'auth.bind',
    method: 'GET',
    response: 'text',
    extractsToCarry: {},
    ...change.step,
    locationCapture: { ...CAPTURE, ...change.capture },
  };
  return { call: { flow: 'sms-otp', envelope: {}, steps: [step] }, transport: NATIVE };
}

const REFUSALS: readonly IRefusalCase[] = [
  { label: 'a json step', step: { response: 'json' }, expected: RESPONSE_MSG },
  { label: 'an empty slot', capture: { into: '' }, expected: EMPTY_MSG },
  { label: 'a blank slot', capture: { into: ' ' }, expected: EMPTY_MSG },
  { label: 'an empty User-Agent', capture: { userAgent: '' }, expected: EMPTY_MSG },
  { label: 'no url rule', capture: { url: [] }, expected: EMPTY_MSG },
  {
    label: 'a slot the step extracts',
    step: { extractsToCarry: { handoffUrl: '/next' } },
    expected: FRESH_MSG,
  },
  {
    label: 'a slot the step captures as text',
    step: { textCaptures: { handoffUrl: { pattern: 'u=(.+)', group: 1 } } },
    expected: FRESH_MSG,
  },
  {
    label: "the step's final URL slot",
    step: { redirect: MANUAL, finalUrlInto: 'handoffUrl' },
    expected: FRESH_MSG,
  },
];

describe('validateApiDirectConfig — handoff script capture', () => {
  it.each(REFUSALS)('refuses $label', ({ expected, step, capture }) => {
    const input = runOf({ step, capture });
    const result = validateApiDirectConfig(input);
    expect(result).toMatchObject({
      success: false,
      errorType: ScraperErrorTypes.Generic,
      errorMessage: expected,
    });
  });

  it('builds the bank capture', () => {
    const input = runOf({});
    const result = validateApiDirectConfig(input);
    expect(result).toEqual({ success: true, value: true });
  });
});
