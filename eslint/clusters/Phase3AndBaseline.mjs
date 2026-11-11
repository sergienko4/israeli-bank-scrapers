// @ts-check
/**
 * The Common-to-Pipeline import ban and the zero-drift canonical 10/10
 * production baseline.
 */
import { PHASE3_COMMON_IMPORT_BAN_PATTERN } from '../rules/GuardRules.mjs';

export const PHASE3_AND_BASELINE_BLOCKS = [
  // 15. PHASE 3 COMMON ↔ PIPELINE UNIFICATION GUARD — Commit 11 (refactor/phase-3-common-unify).
  //
  // Closes Phase 3 Probe 3.4 (Pipeline → Common runtime imports = 0). Phase 3
  // collapsed every Common/* duplicate into a thin re-export shim that delegates
  // to the canonical Pipeline implementation; this rule prevents Pipeline
  // production code from ever importing back from Common/*, which would
  // re-introduce duplication and defeat the canonical-Pipeline mandate.
  //
  // The constant `PHASE3_COMMON_IMPORT_BAN_PATTERN` (defined above) bans every
  // Common/* specifier; no Pipeline → Common edge is allowed any more.
  {
    files: ['src/Scrapers/Pipeline/**/*.ts'],
    ignores: ['src/Scrapers/Pipeline/EslintCanaries/**'],
    rules: {
      'no-restricted-imports': ['error', { patterns: [PHASE3_COMMON_IMPORT_BAN_PATTERN] }],
    },
  },

  // 15b. Phase 3 canary scope — re-enable the rule for the dedicated canary file.
  //
  // `EslintCanaries/**` is globally ignored at the top (line 509). `verify.sh`
  // runs ESLint with `--no-ignore` so canaries are parsed; this single-file
  // override re-attaches the Phase 3 rule so the canary's deliberate Common
  // import trips it. Mirrors the pattern used by every other canary in this file.
  //
  {
    files: ['src/Scrapers/Pipeline/EslintCanaries/no-common-import-in-pipeline.canary.ts'],
    rules: {
      'no-restricted-imports': ['error', { patterns: [PHASE3_COMMON_IMPORT_BAN_PATTERN] }],
    },
  },

  // 19. ZERO-DRIFT GLOBAL BASELINE — universal canonical 10/10 across all
  // first-party production trees (`src/Scrapers/**` + `src/Common/**`).
  //
  // All former directory and file grandfathers (`Strategy`, `Types`, `Core`,
  // `Phases`, `Banks`, `Registry`, `BasePhase.ts`, `Base`, `Common`) have been
  // drained and retired. Test files (`src/Tests/**`) keep their
  // `max-lines-per-function: 'off'` override from §4.
  {
    files: ['src/Scrapers/**/*.ts', 'src/Common/**/*.ts'],
    ignores: [
      'src/scrapers/**',
      'src/Scrapers/Pipeline/EslintCanaries/**',
      '!src/Scrapers/Pipeline/EslintCanaries/scrape-cluster-fn-over-cap.canary.ts',
    ],
    rules: {
      'max-lines-per-function': [
        'error',
        { max: 10, skipBlankLines: true, skipComments: true, IIFEs: true },
      ],
      'max-statements': ['error', 10],
    },
  },
];
