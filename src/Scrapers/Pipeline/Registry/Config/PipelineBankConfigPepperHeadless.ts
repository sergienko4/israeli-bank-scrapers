/**
 * Pepper headless registry block — isolated so the central registry stays
 * under its file cap. Every auth path is a full URL; the seeder registers
 * each one verbatim, so no caller concatenates `identityBase` with a path.
 */

import type { IHeadlessUrlsConfig } from './PipelineBankConfigTypes.js';

/** Pepper headless identity, GraphQL and auth endpoints. */
const PEPPER_HEADLESS: IHeadlessUrlsConfig = {
  identityBase: 'https://sa.pepper.co.il/',
  graphql: 'https://fe-sec.pepper.co.il/graphql',
  paths: {
    'auth.bind': 'https://sa.pepper.co.il/api/v2/auth/bind',
    'auth.login': 'https://sa.pepper.co.il/api/v2/auth/login',
    'auth.assert': 'https://sa.pepper.co.il/api/v2/auth/assert',
    'auth.logout': 'https://sa.pepper.co.il/api/v2/auth/logout',
  },
  // Public Transmit Security client ID (equivalent to User-Agent / public API key).
  // Extracted from com.pepper.ldb APK index.android.bundle and identical
  // across every Play Store install — not a user secret.
  staticAuth: 'TSToken 7cf2d7a7-681d-450a-ab23-06e48d2b8fd6; tid=digital_client_token_token',
  // `fe-sec.pepper.co.il` sits behind an AWS WAF on CloudFront that
  // allow-lists the Android app's OkHttp client and blocks every other
  // client with a 403 HTML page BEFORE the request reaches the app.
  // Measured inside `docker/Dockerfile.ci-mirror` with User-Agent as the
  // only variable: absent / Chrome / iOS CFNetwork => 403 "Request
  // blocked."; `okhttp/4.12.0` => 401 UnauthorizedException (app answered,
  // WAF cleared). Applies to EVERY GraphQL call, including the post-auth
  // probe, so it is declared at transport level rather than in
  // PepperShape's per-call headers. Canary:
  // `Tests/Unit/Pipeline/Registry/Config/PipelineBankConfigPepperWaf.test.ts`.
  graphqlHeaders: { 'user-agent': 'okhttp/4.12.0' },
  requiresBrowserTls: true,
  phoneNumberFormat: 'international-flat',
};

export default PEPPER_HEADLESS;
export { PEPPER_HEADLESS };
