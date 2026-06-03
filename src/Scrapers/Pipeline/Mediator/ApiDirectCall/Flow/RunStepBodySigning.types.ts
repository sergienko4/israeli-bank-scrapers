/**
 * Public arg interfaces consumed by the RunStepBodySigning surface.
 */

import type { JsonValue } from '../Envelope/JsonPointer.js';
import type { IStepConfig } from '../IApiDirectCallConfig.js';
import type { ITemplateScope } from '../Template/RefResolver.js';

/** Args bundle for `applyCryptoField` — keeps params ≤3. */
interface IApplyCryptoFieldArgs {
  readonly step: IStepConfig;
  readonly scope: ITemplateScope;
  readonly body: Record<string, unknown>;
}

/** Result of `applyCryptoField` — updated body + scope. */
interface ICryptoFieldResult {
  readonly body: Record<string, unknown>;
  readonly scope: ITemplateScope;
}

/** Args bundle for `attachBodySignature` — keeps params ≤3. */
interface IAttachBodySignatureArgs {
  readonly scope: ITemplateScope;
  readonly body: Record<string, unknown>;
  readonly pathAndQuery: string;
}

/** Plain-JSON document type alias — keeps line lengths short. */
type DocObj = Record<string, unknown>;

/** JSON-value re-export alias kept local for short signatures. */
type DocValue = JsonValue;
export type {
  DocObj,
  DocValue,
  IApplyCryptoFieldArgs,
  IAttachBodySignatureArgs,
  ICryptoFieldResult,
};
