/**
 * ExtractRuleTypes — the extract-rule concern slice of the API-DIRECT-CALL
 * config contract (N18, N27, N47): the checks a step runs on one body-,
 * header- or text-capture slot once its answer is read.
 *
 * Depends on TemplateTypes (`RefToken` referenced by IPemCertificateRule.keyRef
 * and IExtractRule.equalsRef). FlowTypes references IExtractRule from
 * IStepBase.extractRules.
 *
 * Rule #11 compliance: zero bank-name strings.
 */

import type { IUrlRule } from '../../../Types/Domain/FetchPolicy.js';
import type { RefToken } from './TemplateTypes.js';

/** JSON type an extract rule demands of a slot's raw value (N18). */
type ExtractValueType = 'string' | 'number' | 'object' | 'array';

/**
 * A certificate rule (N27): the slot text is one PEM certificate that
 * certifies the private key `keyRef` resolves to, and is valid now.
 */
interface IPemCertificateRule {
  /** Ref to the PEM private key the certificate must certify. */
  readonly keyRef: RefToken;
}

/**
 * Checks on one body- or header-extract slot (N18, N27, N47), run on the raw
 * value once the step's answer is read: `type` first, then `transform`, then
 * the text checks, then `equalsRef`.
 */
interface IExtractRule {
  /** JSON type of the raw value. */
  readonly type?: ExtractValueType;
  /** Applied before the text checks; the slot keeps the result. */
  readonly transform?: 'lower';
  /** Allowed texts, after the transform. */
  readonly oneOf?: readonly string[];
  /** Anchored regex source (`^…$`) the whole text must match. */
  readonly pattern?: string;
  /** Allow-list a URL text must match, resolved against the step URL. */
  readonly url?: readonly IUrlRule[];
  /** Longest text allowed; 8192 when unset. */
  readonly maxChars?: number;
  /** The text must be one current PEM certificate of the referenced key (N27). */
  readonly pemCertificate?: IPemCertificateRule;
  /** The checked text must equal the text this ref resolves to (N47). */
  readonly equalsRef?: RefToken;
}

export type { ExtractValueType, IExtractRule, IPemCertificateRule };
