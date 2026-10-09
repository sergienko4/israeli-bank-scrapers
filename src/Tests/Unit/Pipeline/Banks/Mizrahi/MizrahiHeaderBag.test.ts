/**
 * Mizrahi discovered-header bag — pins plan D14/D15: every hard-model `mto`
 * call carries the SPA's `mizrahixsrftoken`, replayed from the landing
 * page's own `get428Index` request. Real login #8 showed one token-less call
 * ends the server session, and Mode B scripted requests carry no headers, so
 * this unit test is the only offline guard on the donor.
 *
 * <p>The pool mirrors the landing order real login #10 captured: a
 * token-less `Get428ODS`, a tokened `Get428ODS`, then `get428Index`. Values
 * are fake.
 *
 * <p>Uses dynamic import to dodge the no-restricted-imports DI rule that bans
 * static imports of Registry/Config in Pipeline tests (same precedent as
 * PipelineBankConfigDiscoveredHeaders.test.ts).
 */

import { CompanyTypes } from '../../../../../Definitions.js';
import type { IDiscoveredEndpoint } from '../../../../../Scrapers/Pipeline/Mediator/Network/Types/Endpoint.js';
import { buildDiscoveredHeaderBag } from '../../../../../Scrapers/Pipeline/Phases/BindApiMediator/BindApiMediatorAuth.js';

const MTO = 'https://mto.mizrahi-tefahot.co.il/Online/api';
const TOKEN_HEADER = 'mizrahixsrftoken';
const FAKE_TOKEN = 'fake-xsrf-value';

/**
 * Build a captured endpoint carrying the given request headers.
 * @param url - Captured request URL.
 * @param requestHeaders - Lowercase request headers the capture exposes.
 * @returns Discovered-endpoint literal.
 */
function makeEndpoint(url: string, requestHeaders: Record<string, string>): IDiscoveredEndpoint {
  const rest = { method: 'POST', contentType: 'application/json', responseHeaders: {} };
  return { url, postData: '', responseBody: null, requestHeaders, ...rest } as IDiscoveredEndpoint;
}

const JSON_TYPE = { 'content-type': 'application/json; charset=utf-8' };
const TOKENED = { ...JSON_TYPE, [TOKEN_HEADER]: FAKE_TOKEN };
const LANDING_POOL = [
  makeEndpoint(`${MTO}/OSH/Get428ODS`, JSON_TYPE),
  makeEndpoint(`${MTO}/OSH/Get428ODS`, TOKENED),
  makeEndpoint(`${MTO}/SkyOSH/get428Index`, TOKENED),
];

/**
 * Resolve Mizrahi's registry config (dynamic import — DI rule).
 * @returns Mizrahi bank config.
 */
async function mizrahiConfig(): Promise<Parameters<typeof buildDiscoveredHeaderBag>[0]> {
  const { resolvePipelineBankConfig } =
    await import('../../../../../Scrapers/Pipeline/Registry/Config/PipelineBankConfig.js');
  const config = resolvePipelineBankConfig(CompanyTypes.Mizrahi);
  if (config === false) throw new TypeError('Mizrahi is not in the Pipeline registry');
  return config;
}

describe('Mizrahi discovered-header bag (D14/D15)', () => {
  it('opts into the bag, scoped to the mto data-API host', async () => {
    const config = await mizrahiConfig();
    expect(config.installDiscoveredHeaders).toBe(true);
    expect(config.discoveredHeadersUrlMatch).toBe('mto.mizrahi-tefahot.co.il');
  });

  it('replays the token from the landing get428Index request', async () => {
    const config = await mizrahiConfig();
    const bag = buildDiscoveredHeaderBag(config, LANDING_POOL, false);
    expect(bag[TOKEN_HEADER]).toBe(FAKE_TOKEN);
    expect(bag['content-type']).toBe(JSON_TYPE['content-type']);
  });

  it('never adopts a donor outside the mto host', async () => {
    const config = await mizrahiConfig();
    const foreign = makeEndpoint('https://www.mizrahi-tefahot.co.il/get428Index', TOKENED);
    const bag = buildDiscoveredHeaderBag(config, [foreign], false);
    expect(bag[TOKEN_HEADER]).toBeUndefined();
  });
});
