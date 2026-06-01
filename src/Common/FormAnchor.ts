/**
 * Common ↔ Pipeline UNIFY shim (Phase 3 — Commit 3 of 11).
 *
 * This file is a pure re-export of `Pipeline/Mediator/Form/FormAnchor.ts`.
 * Per the user mandate (2026-06-01) "Pipeline is canonical, non-Pipeline is
 * deprecated", the duplicate Common implementation (~180 LoC) has been
 * collapsed into this shim so that legacy callers (e.g. `GenericBankScraper`)
 * keep compiling against `src/Common/FormAnchor.js` while every symbol now
 * resolves to the canonical Pipeline copy (id > name > class > position
 * selector chain + PII-redacted form-anchor log line).
 *
 * No brand-type wrappers are needed: all public signatures use plain types
 * (`string`, `SelectorCandidate`, `Promise<Nullable<IFormAnchor>>`). A direct
 * `export … from` is sufficient.
 *
 * @deprecated Import from
 * `src/Scrapers/Pipeline/Mediator/Form/FormAnchor.ts` directly. This shim
 * will be deleted when the last caller (`GenericBankScraper`) migrates.
 */

export {
  discoverFormAnchor,
  type IFormAnchor,
  scopeCandidate,
  scopeCandidates,
} from '../Scrapers/Pipeline/Mediator/Form/FormAnchor.js';
