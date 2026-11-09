/**
 * Leumi's guarded SSO and serialized SPA session handoff.
 */

import type { IGetStep, IStepConfig } from '../../Mediator/ApiDirectCall/ConfigContracts/index.js';
import { CLIENT_PROFILE } from './PipelineBankConfigLeumiBootstrap.js';
import {
  COMMON_HEADERS,
  ORIGIN,
  PAGE_LIMIT,
  SPA_RULES,
} from './PipelineBankConfigLeumiPortalPolicies.js';
import { literalHeaders } from './PipelineBankConfigLiteralHeaders.js';

const SSO_STEP: IGetStep = {
  name: 'logon',
  urlTag: 'auth.logon',
  method: 'GET',
  urlFromCarry: 'ssoUrl',
  extractsToCarry: {},
  headers: {
    ...COMMON_HEADERS,
    ...literalHeaders({ 'content-type': 'application/json', 'x-aid': 'webapp' }),
    authorization: { $ref: 'carry.token' },
  },
  headerExtractsToCarry: {
    spaLanding: { header: 'LandingPage' },
    portalSession: { header: 'sessionID', fallback: '' },
    ssoError: { header: 'SSOLoginError', fallback: '' },
  },
  extractRules: { ssoError: { oneOf: [''] } },
  deriveCarry: [
    {
      into: 'spaUrl',
      parts: ['carry.spaLanding'],
      op: { kind: 'url-compose', base: ORIGIN, source: SPA_RULES, url: SPA_RULES },
    },
  ],
  response: 'document',
  responseIntegrity: { maxBytes: PAGE_LIMIT },
};
const SPA_STEP: IGetStep = {
  name: 'sessionToken',
  urlTag: 'identity.sessionToken',
  method: 'GET',
  urlFromCarry: 'spaUrl',
  extractsToCarry: {},
  headers: {
    ...literalHeaders({ accept: 'text/html,application/xhtml+xml', ...CLIENT_PROFILE }),
    referer: { $ref: 'carry.gatekeeperUrl' },
  },
  setCookies: {
    transmitToken: 'carry.token',
    cochavSessionId: { ref: 'carry.portalSession', optional: true },
  },
  response: 'text',
  mediaType: 'text/html',
  maxTextChars: PAGE_LIMIT,
  responseIntegrity: { maxBytes: PAGE_LIMIT },
  structuredCapture: {
    kind: 'script-json',
    into: 'sessionToken',
    field: 'SessionID',
    pattern: '^[a-fA-F0-9]{32}$',
    maxChars: 32,
  },
};
const LEUMI_SSO_STEPS: readonly IStepConfig[] = [
  { ...SSO_STEP, runIf: { carry: 'site', oneOf: ['01'] } },
  {
    ...SSO_STEP,
    runIf: { carry: 'site', oneOf: ['40', '70'] },
    headers: {
      ...SSO_STEP.headers,
      'x-session-id': { $ref: 'carry.jti' },
      'x-message-id': { $ref: 'carry.messageId' },
      'x-transaction-id': { $ref: 'carry.transactionId' },
      'x-uid': { $ref: 'creds.username' },
      ...literalHeaders({ pragma: 'no-cache' }),
    },
  },
  SPA_STEP,
];

export default LEUMI_SSO_STEPS;
