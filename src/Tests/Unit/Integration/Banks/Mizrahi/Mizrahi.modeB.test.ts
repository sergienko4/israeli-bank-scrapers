/**
 * Mizrahi — Mode B SIMULATOR drive (INIT → … → TERMINATE).
 *
 * <p>Fires the production-shaped requests in the order the real session
 * issues them and asserts each is fulfilled from the committed manifest,
 * the phase advances, and nothing escapes fatally:
 * <ul>
 *   <li>the homepage, then the login iframe `/login/index.html` (live it
 *       carries a `?ttt=<epoch>` cache-buster);</li>
 *   <li>`SkyBL/logon` — the post-login session handshake (accounts);</li>
 *   <li>`OSH/Get428ODS` — the dashboard balance;</li>
 *   <li>`SkyOSH/get428Index` — the landing page's own call (the
 *       discovered-header donor, plan D14);</li>
 *   <li>the hard-model scrape: `SkyBL/logon` again (the account list),
 *       `SkyBL/changeAccount` (switch to the account + its balance, plan
 *       D17), then `SkyOSH/get428Index` (its movements).</li>
 * </ul>
 */

import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  type IScriptedRequest,
  type IStepObservation,
  runSimulatorScript,
} from '../../../../Integration/Mirror/SimulatorScriptDrive.js';

const BANK_ID = 'mizrahi';
const ORIGIN = 'https://www.mizrahi-tefahot.co.il';
const API = 'https://mto.mizrahi-tefahot.co.il/Online/api';
const HTML_CT = 'text/html; charset=utf-8';
const JSON_CT = 'application/json; charset=utf-8';
const HERE_FILE = fileURLToPath(import.meta.url);
const HERE = dirname(HERE_FILE);
const FIXTURES_ROOT = join(HERE, '..', '..', '..', '..', 'Integration', 'fixtures', 'banks');
const CREDENTIAL_FORM_MARKERS = ['משתמש', 'type="password"'] as const;

/** One scripted request plus the envelope the simulator must answer with. */
interface IScriptStep {
  readonly request: IScriptedRequest;
  readonly contentType: string;
  readonly phaseAfter: string;
}

/** Production-shaped requests, in real-session order. */
const STEPS: readonly IScriptStep[] = [
  {
    request: { url: `${ORIGIN}/`, method: 'GET', resourceType: 'document' },
    contentType: HTML_CT,
    phaseAfter: 'HOME',
  },
  {
    request: { url: `${ORIGIN}/login/index.html?ttt=1`, method: 'GET', resourceType: 'document' },
    contentType: HTML_CT,
    phaseAfter: 'LOGIN',
  },
  {
    request: { url: `${API}/SkyBL/logon`, method: 'POST', resourceType: 'xhr' },
    contentType: JSON_CT,
    phaseAfter: 'AUTH_DISCOVERY',
  },
  {
    request: { url: `${API}/OSH/Get428ODS`, method: 'POST', resourceType: 'xhr' },
    contentType: JSON_CT,
    phaseAfter: 'DASHBOARD',
  },
  {
    request: { url: `${API}/SkyOSH/get428Index`, method: 'POST', resourceType: 'xhr' },
    contentType: JSON_CT,
    phaseAfter: 'SCRAPE',
  },
  {
    request: { url: `${API}/SkyBL/logon`, method: 'POST', resourceType: 'fetch' },
    contentType: JSON_CT,
    phaseAfter: 'SCRAPE',
  },
  {
    request: { url: `${API}/SkyBL/changeAccount`, method: 'POST', resourceType: 'fetch' },
    contentType: JSON_CT,
    phaseAfter: 'SCRAPE',
  },
  {
    request: { url: `${API}/SkyOSH/get428Index`, method: 'POST', resourceType: 'fetch' },
    contentType: JSON_CT,
    phaseAfter: 'TERMINATE',
  },
];

const SCRIPT = STEPS.map((step): IScriptedRequest => step.request);

/** URL of the login-iframe document — the only step carrying the form. */
const LOGIN_IFRAME_URL = SCRIPT[1].url;

/**
 * Whether a scripted step is an HTML document — only documents can serve a
 * form (the logon JSON's `ClientConfig` string contains "משתמש" as data).
 * @param step - Scripted step.
 * @returns True for document steps.
 */
function isDocumentStep(step: IScriptStep): boolean {
  return step.request.resourceType === 'document';
}

/**
 * Drop the body so the envelope compares by value.
 * @param step - Step observation.
 * @returns Observation without its body.
 */
function envelope(step: IStepObservation): Omit<IStepObservation, 'body'> {
  const { fulfillCount, status, contentType, phaseAfter } = step;
  return { fulfillCount, status, contentType, phaseAfter };
}

/**
 * Credential-form markers present in a served body.
 * @param step - Step observation.
 * @returns Markers found.
 */
function formMarkersIn(step: IStepObservation): readonly string[] {
  return CREDENTIAL_FORM_MARKERS.filter((marker): boolean => step.body.includes(marker));
}

describe('Mizrahi Mode B — SIMULATOR drive', () => {
  it('walks INIT → … → TERMINATE with zero fatal escapes', async () => {
    const result = await runSimulatorScript({
      bankId: BANK_ID,
      fixturesRoot: FIXTURES_ROOT,
      script: SCRIPT,
    });
    const envelopes = result.steps.map(envelope);
    const expected = STEPS.map(({ contentType, phaseAfter }): Omit<IStepObservation, 'body'> => ({
      fulfillCount: 1,
      status: 200,
      contentType,
      phaseAfter,
    }));
    expect(envelopes).toEqual(expected);
    expect(result.final.transitionsFired).toBe(SCRIPT.length);
    expect(result.final.fatalEscapes).toHaveLength(0);
  });

  it('serves the credential form only at the login-iframe document', async () => {
    const result = await runSimulatorScript({
      bankId: BANK_ID,
      fixturesRoot: FIXTURES_ROOT,
      script: SCRIPT,
    });
    const documentSteps = result.steps.filter((_obs, i): boolean => isDocumentStep(STEPS[i]));
    const markersPerDocument = documentSteps.map(formMarkersIn);
    const expected = STEPS.filter(isDocumentStep).map((step): readonly string[] =>
      step.request.url === LOGIN_IFRAME_URL ? CREDENTIAL_FORM_MARKERS : [],
    );
    expect(markersPerDocument).toEqual(expected);
  });
});
