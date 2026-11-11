/**
 * A `text` step's `locationCapture` reads every script on its answer,
 * takes the one location assignment the configured User-Agent selects,
 * resolves it against the step URL and carries it to `into` once it passes
 * `url`. None fails `<step> handoff missing`, two `<step> handoff ambiguous`,
 * any statement outside the grammar `<step> handoff script unsupported`, and a
 * URL the rules refuse `<step> handoff refused`. No failure names the URL.
 */

import { CompanyTypes } from '../../../../../../Definitions.js';
import { ScraperErrorTypes } from '../../../../../../Scrapers/Base/ErrorTypes.js';
import type {
  IApiDirectCallConfig,
  IGetStep,
  ILocationCapture,
} from '../../../../../../Scrapers/Pipeline/Mediator/ApiDirectCall/ConfigContracts/index.js';
import { runStep } from '../../../../../../Scrapers/Pipeline/Mediator/ApiDirectCall/Flow/Lifecycle/RunStep.js';
import type { ITemplateScope } from '../../../../../../Scrapers/Pipeline/Mediator/ApiDirectCall/Template/RefResolver.js';
import { registerWkUrl } from '../../../../../../Scrapers/Pipeline/Registry/WK/UrlsWK.js';
import type { Procedure } from '../../../../../../Scrapers/Pipeline/Types/Procedure.js';
import { fakeFetch } from '../../../../../Helpers/FakeFetch.js';
import { makeNativeMediator } from '../../../../../Helpers/NativeStepHarness.js';

const HINT = CompanyTypes.OneZero;
const ORIGIN = 'https://example.test';
const STEP_URL = `${ORIGIN}/MatafLoginService/MatafLoginServlet`;
const MISSING = 'bootstrap handoff missing';
const AMBIGUOUS = 'bootstrap handoff ambiguous';
const UNSUPPORTED = 'bootstrap handoff script unsupported';
const REFUSED = 'bootstrap handoff refused';

const CAPTURE: ILocationCapture = {
  into: 'handoffUrl',
  userAgent: 'Mozilla/5.0 (research)',
  url: [{ origin: ORIGIN, anyPathExcept: ['logout', 'changepass', 'recovery', 'resetpassword'] }],
};

const CONFIG: IApiDirectCallConfig = {
  flow: 'sms-otp',
  steps: [],
  envelope: {},
  probe: { queryTag: 'customer' },
};

/** One page, and the URL it carries or the message it fails with. */
interface IPageCase {
  readonly label: string;
  readonly html: string;
  readonly expected: string;
}

beforeAll((): void => {
  registerWkUrl('auth.bind', HINT, STEP_URL);
});

/**
 * A page holding scripts.
 * @param scripts - Script tags.
 * @returns Page text.
 */
function page(...scripts: readonly string[]): string {
  return `<html><head><title>x</title></head><body>${scripts.join('\n')}</body></html>`;
}

/**
 * An inline script.
 * @param body - Script body.
 * @returns Script tag.
 */
function script(body: string): string {
  return `<script type="text/javascript">${body}</script>`;
}

/**
 * The bank's handoff script: the app gets a message, a browser a location.
 * @param url - The browser's location.
 * @returns Script tag.
 */
function handoff(url: string): string {
  const check = "navigator.userAgent.indexOf('MatafMobile') > -1";
  const app = "window.parent.postMessage({ type: 'login' }, '*');";
  return script(`if (${check}) { ${app} } else { window.location.href = '${url}'; }`);
}

/**
 * A page holding only the handoff script.
 * @param url - The browser's location.
 * @returns Page text.
 */
function handoffPage(url: string): string {
  const tag = handoff(url);
  return page(tag);
}

/**
 * A page holding one inline script.
 * @param body - Script body.
 * @returns Page text.
 */
function scriptPage(body: string): string {
  const tag = script(body);
  return page(tag);
}

/**
 * Run a location-capturing text step against a fake answering `body`.
 * @param body - Answer text.
 * @param maxTextChars - The step's text cap, if not the default.
 * @returns The step's result.
 */
async function runOn(body: string, maxTextChars?: number): Promise<Procedure<ITemplateScope>> {
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
    locationCapture: CAPTURE,
    ...(maxTextChars === undefined ? {} : { maxTextChars }),
  };
  return runStep({ step, bus, scope, companyId: HINT });
}

/**
 * The URL a successful run carried, or the failure message.
 * @param result - Step result.
 * @returns The carried `handoffUrl`, or the error message.
 */
function outcomeOf(result: Procedure<ITemplateScope>): unknown {
  if (!result.success) return result.errorMessage;
  return result.value.carry.handoffUrl;
}

const HOME = `${ORIGIN}/wps/myportal/Home?x=1`;
const SRC_SCRIPT = '<script src="/js/app.js"></script>';
const READY = script("console.log('ready');");
const HOME_HANDOFF = handoff('/wps/myportal/Home?x=1');
const A_HANDOFF = handoff('/a');
const B_HANDOFF = handoff('/b');
const VAR_SCRIPT = script('var x = 1;');

const PAGES: readonly IPageCase[] = [
  { label: 'a relative URL', html: handoffPage('/wps/myportal/Home?x=1'), expected: HOME },
  { label: 'an absolute URL', html: handoffPage(HOME), expected: HOME },
  { label: 'an escaped URL', html: handoffPage('\\/wps\\/myportal\\/Home?x=1'), expected: HOME },
  {
    label: 'every script on the page',
    html: page(SRC_SCRIPT, READY, HOME_HANDOFF),
    expected: HOME,
  },
  {
    label: 'tags in upper case',
    html: page("<SCRIPT>location = '/wps/myportal/Home?x=1';</SCRIPT>"),
    expected: HOME,
  },
  { label: 'a page with no script', html: page(), expected: MISSING },
  { label: 'scripts with no assignment', html: page(SRC_SCRIPT, READY), expected: MISSING },
  {
    label: 'an unclosed script',
    html: "<html><script>location = '/wps/myportal/Home';",
    expected: MISSING,
  },
  {
    label: 'two scripts assigning',
    html: page(A_HANDOFF, B_HANDOFF),
    expected: AMBIGUOUS,
  },
  {
    label: 'two assignments in one script',
    html: scriptPage("location = '/a'; location = '/b';"),
    expected: AMBIGUOUS,
  },
  { label: 'another statement', html: scriptPage('doLogin();'), expected: UNSUPPORTED },
  {
    label: 'an unsupported script after the handoff',
    html: page(A_HANDOFF, VAR_SCRIPT),
    expected: UNSUPPORTED,
  },
  { label: 'another origin', html: handoffPage('https://evil.test/x'), expected: REFUSED },
  { label: 'a denied path', html: handoffPage('/wps/LogOut.aspx'), expected: REFUSED },
  { label: 'userinfo', html: handoffPage('https://user@example.test/x'), expected: REFUSED },
  { label: 'plain http', html: handoffPage('http://example.test/x'), expected: REFUSED },
  { label: 'a fragment', html: handoffPage('/x#top'), expected: REFUSED },
  { label: 'an unparsable URL', html: handoffPage('https://[/x'), expected: REFUSED },
];

describe('handoff script capture on a text step', () => {
  it.each(PAGES)('reads $label', async ({ html, expected }) => {
    const result = await runOn(html);
    const outcome = outcomeOf(result);
    expect(outcome).toBe(expected);
  });

  it('fails Generic without naming the URL', async () => {
    const html = handoffPage('https://evil.test/secret-path');
    const result = await runOn(html);
    expect(result).toMatchObject({ success: false, errorType: ScraperErrorTypes.Generic });
    const message = outcomeOf(result);
    expect(message).toBe(REFUSED);
  });

  it('refuses a page over the text cap before reading it', async () => {
    const html = handoffPage('/wps/myportal/Home?x=1');
    const result = await runOn(html, html.length - 1);
    const outcome = outcomeOf(result);
    expect(outcome).toBe('bootstrap text too long');
  });
});
