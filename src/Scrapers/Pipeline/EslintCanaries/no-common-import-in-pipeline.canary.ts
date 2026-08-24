// Canary: Phase 3 — Pipeline production code must not import from Common/*
// (Pipeline is canonical; Common/* are deprecated re-export shims). Allowlist:
// Common/Config/BrowserConfig (browser-bootstrap-only). The import below MUST
// trip `no-restricted-imports` via the PHASE3_COMMON_IMPORT_BAN_PATTERN regex.
//
// The banned module only has to be a *live* Common one — it is never called for
// its behaviour. `ResultFormatter` is a dependency-free leaf, so this canary
// cannot be invalidated by a later shim retirement.
import { maskAccount } from '../../../Common/ResultFormatter.js';

function makeCanaryLogger(): unknown {
  return maskAccount('phase-3-canary');
}

export { makeCanaryLogger };
