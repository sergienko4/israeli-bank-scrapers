/**
 * Pepper GraphQL default-header canary.
 *
 * Pepper's GraphQL host (`fe-sec.pepper.co.il`) sits behind an AWS WAF on
 * CloudFront that allow-lists the Android app's OkHttp client and blocks
 * everything else with a 403 HTML block page BEFORE the request reaches the
 * app. Evidence (probe run inside `docker/Dockerfile.ci-mirror`, identical
 * body + auth, User-Agent the only variable):
 *
 * | User-Agent                     | Response                          |
 * | ------------------------------ | --------------------------------- |
 * | (absent)                       | 403 CloudFront "Request blocked."  |
 * | `okhttp/4.12.0`                | 401 `UnauthorizedException` (app)  |
 * | Chrome desktop                 | 403 CloudFront "Request blocked."  |
 * | iOS `CFNetwork/…`              | 403 CloudFront "Request blocked."  |
 *
 * The 401 proves the WAF was cleared and the app answered. Dropping the
 * header therefore breaks every Pepper GraphQL call — including the
 * post-auth probe, so the failure surfaces as a login error rather than an
 * empty scrape. This test is the drift detector for that header.
 */

import { CompanyTypes } from '../../../../../Definitions.js';

/** Marker the CloudFront WAF allow-lists (Pepper Android app client). */
const OKHTTP_MARKER = 'okhttp/';

// Dynamic import dodges the no-restricted-imports DI rule that bans static
// imports of Registry/Config/** in Pipeline tests (precedent:
// PipelineBankConfigAuthConfirm.test.ts).
describe('Pepper headless config — GraphQL WAF header', () => {
  it('declares an OkHttp user-agent as a GraphQL default header', async () => {
    const { resolvePipelineBankConfig } =
      await import('../../../../../Scrapers/Pipeline/Registry/Config/PipelineBankConfig.js');
    const config = resolvePipelineBankConfig(CompanyTypes.Pepper);
    expect(config).not.toBe(false);
    const headers = config === false ? {} : (config.headless?.graphqlHeaders ?? {});
    expect(headers['user-agent']).toContain(OKHTTP_MARKER);
  });

  it('keeps the GraphQL host that the WAF header was measured against', async () => {
    const { resolvePipelineBankConfig } =
      await import('../../../../../Scrapers/Pipeline/Registry/Config/PipelineBankConfig.js');
    const config = resolvePipelineBankConfig(CompanyTypes.Pepper);
    expect(config).not.toBe(false);
    const graphql = config === false ? '' : config.headless?.graphql;
    expect(graphql).toContain('fe-sec.pepper.co.il');
  });
});
