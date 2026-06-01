// Canary: Phase 3 — Pipeline production code must not import from Common/*
// (Pipeline is canonical; Common/* are deprecated re-export shims). Allowlist:
// Common/Config/BrowserConfig (browser-bootstrap-only). The import below MUST
// trip `no-restricted-imports` via the PHASE3_COMMON_IMPORT_BAN_PATTERN regex.
import { getDebug } from '../../../Common/Debug.js';

function makeCanaryLogger(): unknown {
  return getDebug('phase-3-canary');
}

export { makeCanaryLogger };
