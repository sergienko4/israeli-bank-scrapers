// Canary: Phase 3 (CR PR #286 finding F3) — the PHASE3_COMMON_IMPORT_BAN_PATTERN
// allowlist must be an EXACT-MATCH for `Common/Config/BrowserConfig`. Lookalikes
// in the same directory (e.g. `Common/Config/NavigationConfig`,
// `Common/Config/BrowserConfigLegacy`) must trip `no-restricted-imports`. This
// canary imports a sibling Common/Config/* module to prove the negative
// lookahead's `(?:\.js)?$` anchor is in place and rejects lookalikes.
import { NAVIGATION_TIMEOUT_MS } from '../../../Common/Config/NavigationConfig.js';

function useLookalike(): number {
  return NAVIGATION_TIMEOUT_MS;
}

export { useLookalike };
