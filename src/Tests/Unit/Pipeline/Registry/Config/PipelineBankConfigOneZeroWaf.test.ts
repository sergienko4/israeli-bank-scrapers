/**
 * OneZero transport-identity canary.
 *
 * OneZero's identity and GraphQL hosts (`*.tfd-bank.com`) sit behind a
 * Cloudflare WAF that admits only the Android app. Measured live, removing
 * one part at a time: the app's mTLS client certificate, its OkHttp TLS
 * ClientHello and its User-Agent are each required, and any request missing
 * one gets a 403 Cloudflare block page before it reaches the app. This test
 * fails if the config stops declaring any of the three, or if the identity
 * login steps and GraphQL stop sending the same User-Agent.
 */

import { CompanyTypes } from '../../../../../Definitions.js';

/** Prefix of the OneZero Android app User-Agent. */
const APP_UA = /^ONEZEROIL\//;

// Dynamic import dodges the no-restricted-imports DI rule that bans static
// imports of Registry/Config/** in Pipeline tests (precedent:
// PipelineBankConfigPepperWaf.test.ts).

/**
 * Read OneZero's headless transport block from the bank registry.
 * @returns The headless block, or false when OneZero has none.
 */
async function oneZeroHeadless(): Promise<object | false> {
  const registry =
    await import('../../../../../Scrapers/Pipeline/Registry/Config/PipelineBankConfig.js');
  const config = registry.resolvePipelineBankConfig(CompanyTypes.OneZero);
  if (config === false) return false;
  return config.headless ?? false;
}

/**
 * Read the User-Agent the OneZero identity login steps send.
 * @returns The `staticHeaders` User-Agent, or an empty string when absent.
 */
async function identityUserAgent(): Promise<string> {
  const oneZero =
    await import('../../../../../Scrapers/Pipeline/Registry/Config/PipelineBankConfigOneZero.js');
  return oneZero.ONEZERO_API_DIRECT_CALL.staticHeaders?.['User-Agent'] ?? '';
}

describe('OneZero headless config — Cloudflare WAF identity', () => {
  it('declares the client certificate and the Android TLS profile', async () => {
    const headless = await oneZeroHeadless();
    expect(headless).toMatchObject({ requiresClientCert: true, tlsProfile: 'android-11-okhttp' });
  });

  it('sends the app User-Agent on the identity login steps and on GraphQL alike', async () => {
    const userAgent = await identityUserAgent();
    expect(userAgent).toMatch(APP_UA);
    const headless = await oneZeroHeadless();
    expect(headless).toMatchObject({ graphqlHeaders: { 'User-Agent': userAgent } });
  });
});
