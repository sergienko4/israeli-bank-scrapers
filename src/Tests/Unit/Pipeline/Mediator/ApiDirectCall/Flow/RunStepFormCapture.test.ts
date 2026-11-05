/**
 * N37 — a `text` step's `formCapture` reads its login form off the real
 * answer through the headless native transport: exactly one form named by
 * `id` or `name`, posting to the configured action, whose named, enabled
 * inputs are all hidden. The field record goes to carry `into` in page order.
 * A failure names the step and the form only, never a field value.
 */

import { CompanyTypes } from '../../../../../../Definitions.js';
import { ScraperErrorTypes } from '../../../../../../Scrapers/Base/ErrorTypes.js';
import type {
  IApiDirectCallConfig,
  IFormCapture,
  IGetStep,
} from '../../../../../../Scrapers/Pipeline/Mediator/ApiDirectCall/ConfigContracts/index.js';
import { runStep } from '../../../../../../Scrapers/Pipeline/Mediator/ApiDirectCall/Flow/RunStep.js';
import type { ITemplateScope } from '../../../../../../Scrapers/Pipeline/Mediator/ApiDirectCall/Template/RefResolver.js';
import { registerWkUrl } from '../../../../../../Scrapers/Pipeline/Registry/WK/UrlsWK.js';
import type { Procedure } from '../../../../../../Scrapers/Pipeline/Types/Procedure.js';
import { fakeFetch } from '../../../../../Helpers/FakeFetch.js';
import { makeNativeMediator } from '../../../../../Helpers/NativeStepHarness.js';

const HINT = CompanyTypes.OneZero;
const ORIGIN = 'https://example.test';
const SERVLET = `${ORIGIN}/MatafLoginService/MatafLoginServlet`;
const SECRET = 'syn-form-9c1e';
const FORM_ATTRS = 'name="loginServlet" method="post" action="MatafLoginServlet"';
const MISSING = 'bootstrap form loginServlet missing';
const AMBIGUOUS = 'bootstrap form loginServlet ambiguous';
const ACTION_REFUSED = 'bootstrap form action refused';
const NOT_HIDDEN = 'bootstrap form field not hidden';
const INVALID = 'bootstrap form fields invalid';

const CAPTURE: IFormCapture = {
  form: 'loginServlet',
  into: 'loginForm',
  action: SERVLET,
  required: ['user', 'passwordEnc', 'bankId'],
  forbidden: ['password'],
  minFields: 3,
  maxFields: 32,
};

const CONFIG: IApiDirectCallConfig = {
  flow: 'sms-otp',
  steps: [],
  envelope: {},
  probe: { queryTag: 'customer' },
};

/** One refused page: its label, page, expected message and capture, if not the bank's. */
interface IRefusalCase {
  readonly label: string;
  readonly html: string;
  readonly expected: string;
  readonly capture?: IFormCapture;
}

beforeAll((): void => {
  registerWkUrl('auth.bind', HINT, SERVLET);
});

/**
 * A hidden input.
 * @param name - Field name.
 * @param value - Field value.
 * @returns Input tag.
 */
function hidden(name: string, value: string): string {
  return `<input type="hidden" name="${name}" value="${value}">`;
}

const USER = hidden('user', '');
const PASSWORD_ENC = hidden('passwordEnc', '');
const BANK_ID = hidden('bankId', SECRET);
const LONG_VALUE = 'v'.repeat(32_769);

/** The three fields the bank's form holds. */
const FIELDS = `${USER}${PASSWORD_ENC}${BANK_ID}`;

/**
 * A page holding one form.
 * @param formAttrs - The form's attributes.
 * @param inner - The form's content.
 * @returns Page text.
 */
function page(formAttrs: string, inner: string): string {
  return `<html><body><form ${formAttrs}>${inner}</form></body></html>`;
}

/**
 * A page holding the login form with extra content.
 * @param extra - Content after the three fields.
 * @returns Page text.
 */
function loginPage(extra: string): string {
  return page(FORM_ATTRS, `${FIELDS}${extra}`);
}

/**
 * Hidden inputs named f0, f1, ….
 * @param count - How many.
 * @returns Input tags.
 */
function fillers(count: number): string {
  const names = Array.from({ length: count }, (_, index): string => `f${String(index)}`);
  return names.map((name): string => hidden(name, '1')).join('');
}

/**
 * Run a form-capturing text step against a fake answering `body`.
 * @param body - Answer text.
 * @param capture - The step's form capture.
 * @returns The step's result.
 */
async function runOn(
  body: string,
  capture: IFormCapture = CAPTURE,
): Promise<Procedure<ITemplateScope>> {
  const fake = fakeFetch((): Response => new Response(body, { status: 200 }));
  globalThis.fetch = fake.fetchImpl as typeof globalThis.fetch;
  const bus = makeNativeMediator(HINT, ORIGIN);
  const scope: ITemplateScope = { carry: {}, creds: {}, config: CONFIG, keypair: undefined };
  const step: IGetStep = {
    name: 'bootstrap',
    urlTag: 'auth.bind',
    method: 'GET',
    response: 'text',
    extractsToCarry: {},
    formCapture: capture,
  };
  return runStep({ step, bus, scope, companyId: HINT });
}

/**
 * The record a successful run carried into `loginForm`.
 * @param result - Step result.
 * @returns The carried field record.
 */
function loginFormOf(result: Procedure<ITemplateScope>): unknown {
  if (!result.success) return result.errorMessage;
  return result.value.carry.loginForm;
}

const X_FIELD = hidden('x', '1');
const PASSWORD = hidden('password', '');
const USER_AGAIN = hidden('user', '2');
const DOTTED = hidden('a.b', '1');
const LONG = hidden('x', LONG_VALUE);
const FILLERS_30 = fillers(30);
const FILLERS_28 = fillers(28);
const NOTE = hidden('note', 'a&amp;b&#x3D;');

const REFUSALS: readonly IRefusalCase[] = [
  { label: 'a page without the form', html: page('name="other"', FIELDS), expected: MISSING },
  {
    label: 'a form named in another case',
    html: page('name="LoginServlet" method="post"', FIELDS),
    expected: MISSING,
  },
  {
    label: 'two forms by that name',
    html: loginPage('') + page('id="loginServlet" method="post"', FIELDS),
    expected: AMBIGUOUS,
  },
  {
    label: 'a get form',
    html: page('name="loginServlet" method="get" action="MatafLoginServlet"', FIELDS),
    expected: ACTION_REFUSED,
  },
  {
    label: 'a form with no method',
    html: page('name="loginServlet" action="MatafLoginServlet"', FIELDS),
    expected: ACTION_REFUSED,
  },
  {
    label: 'a form posting elsewhere',
    html: page('name="loginServlet" method="post" action="/other"', FIELDS),
    expected: ACTION_REFUSED,
  },
  {
    label: 'a form posting to another origin',
    html: page('name="loginServlet" method="post" action="https://evil.test/x"', FIELDS),
    expected: ACTION_REFUSED,
  },
  {
    label: 'a form with no action',
    html: page('name="loginServlet" method="post"', FIELDS),
    expected: ACTION_REFUSED,
  },
  {
    label: 'a text field',
    html: loginPage('<input type="text" name="x" value="1">'),
    expected: NOT_HIDDEN,
  },
  { label: 'an untyped field', html: loginPage('<input name="x">'), expected: NOT_HIDDEN },
  {
    label: 'a valueless type',
    html: loginPage('<input type name="x" value="1">'),
    expected: NOT_HIDDEN,
  },
  {
    label: 'a missing required field',
    html: page(FORM_ATTRS, `${USER}${BANK_ID}${X_FIELD}`),
    expected: INVALID,
  },
  { label: 'a forbidden field', html: loginPage(PASSWORD), expected: INVALID },
  {
    label: 'two fields',
    html: page(FORM_ATTRS, `${USER}${PASSWORD_ENC}`),
    expected: INVALID,
    capture: { ...CAPTURE, required: ['user', 'passwordEnc'] },
  },
  { label: '33 fields', html: loginPage(FILLERS_30), expected: INVALID },
  { label: 'a repeated name', html: loginPage(USER_AGAIN), expected: INVALID },
  { label: 'a name with a dot', html: loginPage(DOTTED), expected: INVALID },
  {
    label: 'a value past 32768 chars',
    html: loginPage(LONG),
    expected: INVALID,
  },
  {
    label: 'a valueless value',
    html: loginPage('<input type="hidden" name="x" value>'),
    expected: INVALID,
  },
  {
    label: 'a field cut off by a nested form',
    html: page(FORM_ATTRS, `${USER}<form name="inner">${PASSWORD_ENC}`),
    expected: INVALID,
  },
];

describe('N37 login-form capture on a text step', () => {
  const originalFetch = globalThis.fetch;

  afterEach((): void => {
    globalThis.fetch = originalFetch;
  });

  it('carries the hidden fields of the form found by name, in page order', async () => {
    const html = loginPage('');
    const result = await runOn(html);
    const loginForm = loginFormOf(result);
    const names = Object.keys(loginForm as object);
    expect(loginForm).toEqual({ user: '', passwordEnc: '', bankId: SECRET });
    expect(names).toEqual(['user', 'passwordEnc', 'bankId']);
  });

  it('finds the form by id, with an upper-case method and an absolute action', async () => {
    const attrs = `id="loginServlet" method="POST" action="${SERVLET}"`;
    const html = page(attrs, FIELDS);
    const result = await runOn(html);
    const loginForm = loginFormOf(result);
    expect(loginForm).toEqual({ user: '', passwordEnc: '', bankId: SECRET });
  });

  it('skips disabled and nameless inputs, other forms and inputs past the form', async () => {
    const extra = '<input type="text" name="password" disabled><input type="submit" value="Go">';
    const other = page('name="search" method="get"', '<input type="text" name="q">');
    const html = `${other}${loginPage(extra)}<input type="text" name="after">`;
    const result = await runOn(html);
    const loginForm = loginFormOf(result);
    expect(loginForm).toEqual({ user: '', passwordEnc: '', bankId: SECRET });
  });

  it('decodes entities in field values and accepts 32 fields', async () => {
    const html = loginPage(`${NOTE}${FILLERS_28}`);
    const result = await runOn(html);
    const loginForm = loginFormOf(result);
    expect(loginForm).toMatchObject({ note: 'a&b=', f27: '1' });
  });

  it.each(REFUSALS)('refuses $label, naming no field value', async (refusal: IRefusalCase) => {
    const { html, expected, capture } = refusal;
    const result = await runOn(html, capture);
    expect(result).toMatchObject({
      success: false,
      errorType: ScraperErrorTypes.Generic,
      errorMessage: expected,
    });
  });
});
