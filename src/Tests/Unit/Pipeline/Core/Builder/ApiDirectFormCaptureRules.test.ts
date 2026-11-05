/**
 * N37 — `formCapture` needs a `text` response; its `form` and `into` are not
 * empty; its `action` is an absolute https URL written as the URL API writes
 * it; its field counts are integers with 1 <= minFields <= maxFields; its
 * required and forbidden names are valid field names and share none.
 */

import { ScraperErrorTypes } from '../../../../../Scrapers/Base/ErrorTypes.js';
import {
  type IApiDirectRuleInput,
  validateApiDirectConfig,
} from '../../../../../Scrapers/Pipeline/Core/Builder/ApiDirectConfigRules.js';
import type {
  IFormCapture,
  IGetStep,
} from '../../../../../Scrapers/Pipeline/Mediator/ApiDirectCall/ConfigContracts/index.js';

const HOST = 'https://form.example';
const NATIVE = { identityBase: HOST, graphql: `${HOST}/graphql`, paths: {}, nativeFetch: true };
const RESPONSE_MSG = 'steps.formCapture: needs a text response';
const EMPTY_MSG = 'steps.formCapture: form and into must not be empty';
const ACTION_MSG = 'steps.formCapture.action: must be an absolute https URL';
const COUNT_MSG = 'steps.formCapture: needs integers 1 <= minFields <= maxFields';
const NAMES_MSG = 'steps.formCapture: field names must be valid and disjoint';

const CAPTURE: IFormCapture = {
  form: 'loginServlet',
  into: 'loginForm',
  action: `${HOST}/MatafLoginService/MatafLoginServlet`,
  required: ['user', 'passwordEnc', 'bankId'],
  forbidden: ['password'],
  minFields: 3,
  maxFields: 32,
};

/** One refused capture: its label, the change from the bank's and the message. */
interface IRefusalCase {
  readonly label: string;
  readonly change: Partial<IFormCapture>;
  readonly expected: string;
}

/**
 * Rule input running one text step whose capture differs from the bank's.
 * @param change - Fields over the bank's capture.
 * @param response - The step's response kind.
 * @returns Rule input.
 */
function runOf(
  change: Partial<IFormCapture>,
  response: IGetStep['response'] = 'text',
): IApiDirectRuleInput {
  const step: IGetStep = {
    name: 'prime',
    urlTag: 'auth.bind',
    method: 'GET',
    response,
    extractsToCarry: {},
    formCapture: { ...CAPTURE, ...change },
  };
  return { call: { flow: 'sms-otp', envelope: {}, steps: [step] }, headless: NATIVE };
}

const REFUSALS: readonly IRefusalCase[] = [
  { label: 'an empty form', change: { form: '' }, expected: EMPTY_MSG },
  { label: 'an empty slot', change: { into: '' }, expected: EMPTY_MSG },
  { label: 'a relative action', change: { action: '/MatafLoginServlet' }, expected: ACTION_MSG },
  { label: 'an http action', change: { action: 'http://form.example/x' }, expected: ACTION_MSG },
  {
    label: 'an action the URL API rewrites',
    change: { action: 'https://FORM.example/x' },
    expected: ACTION_MSG,
  },
  { label: 'no fields', change: { minFields: 0 }, expected: COUNT_MSG },
  { label: 'a fractional count', change: { maxFields: 3.5 }, expected: COUNT_MSG },
  { label: 'a max below the min', change: { minFields: 4, maxFields: 3 }, expected: COUNT_MSG },
  { label: 'a required name with a dot', change: { required: ['a.b'] }, expected: NAMES_MSG },
  { label: 'an empty forbidden name', change: { forbidden: [''] }, expected: NAMES_MSG },
  { label: 'a name both ways', change: { forbidden: ['user'] }, expected: NAMES_MSG },
];

describe('validateApiDirectConfig — N37 login-form capture', () => {
  it('refuses a capture on a json step', () => {
    const input = runOf({}, 'json');
    const result = validateApiDirectConfig(input);
    expect(result).toMatchObject({ success: false, errorMessage: RESPONSE_MSG });
  });

  it.each(REFUSALS)('refuses $label', ({ change, expected }) => {
    const input = runOf(change);
    const result = validateApiDirectConfig(input);
    expect(result).toMatchObject({
      success: false,
      errorType: ScraperErrorTypes.Generic,
      errorMessage: expected,
    });
  });

  it.each<Partial<IFormCapture>>([{}, { minFields: 1, maxFields: 1, required: [], forbidden: [] }])(
    'builds the capture %o',
    change => {
      const input = runOf(change);
      const result = validateApiDirectConfig(input);
      expect(result).toEqual({ success: true, value: true });
    },
  );
});
