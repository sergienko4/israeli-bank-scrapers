/**
 * FlowTypes — flow-discriminator and per-step config concern slice of
 * the API-DIRECT-CALL config contract.
 *
 * Depends on TemplateTypes (`IBodyTemplate`, `IEnvelopeSelectors`,
 * `JsonValueTemplate` referenced by IStepConfig) and EnvelopeTypes
 * (`IPreStepHook` referenced by IStepConfig.preHook). Top-level
 * ApiDirectCallConfig composes the FlowKind discriminator + steps array
 * from here.
 *
 * Rule #11 compliance: zero bank-name strings.
 */

import type { WKUrlGroup } from '../../../Registry/WK/UrlsWK.js';
import type { IPreStepHook } from './EnvelopeTypes.js';
import type { IBodyTemplate, IEnvelopeSelectors, JsonValueTemplate } from './TemplateTypes.js';

/** Exhaustive flow-kind discriminator (spec.txt §B.3). */
type FlowKind = 'sms-otp' | 'stored-jwt' | 'bearer-static';

/** Step identifiers in the sms-otp flow. */
type StepName = 'bind' | 'assertPassword' | 'assertOtp' | 'getIdToken' | 'sessionToken';

/** Per-step config: name, URL tag, body template, response-extract selectors. */
interface IStepConfig {
  readonly name: StepName;
  readonly urlTag: WKUrlGroup;
  readonly body: IBodyTemplate;
  readonly extractsToCarry: IEnvelopeSelectors;
  /** Optional hook — awaited before the step fires. */
  readonly preHook?: IPreStepHook;
  /**
   * Optional URL query params — hydrated JsonValueTemplate whose
   * root is an object whose string-valued leaves become the
   * outgoing ?k=v pairs. Values may be $ref / $literal / nested.
   */
  readonly queryTemplate?: JsonValueTemplate;
  /**
   * When true, captures this step's response Set-Cookie lines into
   * the internal cookie jar. Subsequent steps with cookieJar=true
   * include those cookies on the outbound Cookie header.
   */
  readonly cookieJar?: boolean;
}

export type { FlowKind, IStepConfig, StepName };
