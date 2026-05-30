/**
 * IApiDirectCallConfig — temporary aggregator after the Phase 8 split.
 *
 * Re-exports every type the API-DIRECT-CALL config tree exposes,
 * sourced from the focused sub-modules under ./ConfigContracts/.
 * Existing call-sites (53 production + test importers) continue to
 * compile unchanged against this stable path; new code SHOULD import
 * from `./ConfigContracts/<SubModule>.js` (narrow) or
 * `./ConfigContracts/index.js` (wide) once the barrel lands.
 *
 * Replaced by the ≤ 40 LoC re-export shim in Commit 7/8.
 * Rule #11 compliance: zero bank-name strings.
 */

export type { IApiDirectCallConfig } from './ConfigContracts/ApiDirectCallConfig.js';
export type {
  IDerivedCarry,
  ISeedCarrySource,
  IWarmStartConfig,
  SeedCarryBootstrapKind,
} from './ConfigContracts/CarryTypes.js';
export type {
  AuthScheme,
  IFingerprintConfig,
  IJwtClaimsConfig,
  IPreStepHook,
  IProbeConfig,
} from './ConfigContracts/EnvelopeTypes.js';
export type { FlowKind, IStepConfig, StepName } from './ConfigContracts/FlowTypes.js';
export type {
  AsymmetricSignerAlgorithm,
  CanonicalPart,
  IAesSignerConfig,
  IAsymmetricSignerConfig,
  ICanonicalStringConfig,
  ICryptoFieldConfig,
  ISignerConfig,
  SignerAlgorithm,
  SignerEncoding,
} from './ConfigContracts/SignerTypes.js';
export type {
  IBodyTemplate,
  IEnvelopeSelectors,
  JsonValueTemplate,
  RefToken,
} from './ConfigContracts/TemplateTypes.js';
