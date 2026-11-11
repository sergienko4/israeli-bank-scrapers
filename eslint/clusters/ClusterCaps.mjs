// @ts-check
/**
 * File-size and function-size locks for the Network, Scrape, PiiRedactor,
 * ApiDirectCall and Mediator clusters.
 */
import sonarjs from 'eslint-plugin-sonarjs';
import {
  PII_ERRORLOG_NO_BYPASS_RULE,
  PII_SENTINEL_LITERAL_RULES,
} from '../rules/GuardRules.mjs';
import {
  PIPELINE_SCOPED_SYNTAX_EXTRAS,
  PIPELINE_SYNTAX_RULES,
} from '../rules/PipelineContract.mjs';

export const CLUSTER_CAP_BLOCKS = [
  // 11. NETWORK SUB-MODULE FILE-SIZE + FUNCTION-SIZE GUARD
  //
  // Phase 4 split the 1812-LoC NetworkDiscovery.ts blob into seven
  // focused sub-modules under `Mediator/Network/`. Section 7 turns
  // `max-lines` off across all `Mediator/**` files (DI factories,
  // Strategy adapters, and similar infrastructure files are
  // legitimately long); without a re-imposed bound on the Network
  // sub-folder, future commits could quietly re-blob one of the new
  // homes back toward four-digit line counts.
  //
  // PR #276 review-fix: CodeRabbit pushed back on the 500-line cap
  // — at that ceiling, files this size routinely violate SRP
  // (Scoring.ts at 335 LoC already mixed shape-tier ranking,
  // header probing and SPA-discovery). We tighten the ceiling to
  // **150 effective lines per file** and add a **10-line cap per
  // function** (skipBlankLines + skipComments) so every Network/
  // sub-module stays small enough for a single reviewer to hold
  // in working memory.
  //
  // Phase 8.5a (commits 1-6): the three grandfathered legacy files
  // (`Fetch.ts`, `AuthFailureWatcher.ts`, `AuthDiscovery.ts`) are
  // now fully drained into focused sub-modules, and every remaining
  // function across `Mediator/Network/**` fits the 10-LoC cap.
  // Section §11A grandfather override is therefore removed and the
  // per-function cap is tightened from 20 → 10 to match the §13
  // PiiRedactor and CLAUDE.md ideal.
  //
  // The shim itself (`NetworkDiscovery.ts`) is intentionally left
  // unconstrained — Section 7 already allows it, and this guard is
  // about preventing regression of the new homes, not the facade.
  //
  // Two canary files enforce both halves of the cap: the
  // `no-network-discovery-blob.canary.ts` over-sizes the file to
  // prove `max-lines` fires, and the
  // `network-cluster-fn-over-cap.canary.ts` over-sizes a single
  // function to prove `max-lines-per-function` fires.
  {
    files: [
      'src/Scrapers/Pipeline/Mediator/Network/**/*.ts',
      'src/Scrapers/Pipeline/EslintCanaries/no-network-discovery-blob.canary.ts',
      'src/Scrapers/Pipeline/EslintCanaries/network-cluster-fn-over-cap.canary.ts',
    ],
    rules: {
      'max-lines': ['error', { max: 150, skipBlankLines: true, skipComments: true }],
      'max-lines-per-function': [
        'error',
        { max: 10, skipBlankLines: true, skipComments: true, IIFEs: true },
      ],
    },
  },

  // 12. SCRAPE SUB-MODULE FILE-SIZE + FUNCTION-SIZE GUARD (baseline)
  //
  // Phase 5 split the 1637-LoC ScrapeAutoMapper.ts blob into eleven
  // focused sub-modules under `Mediator/Scrape/<Bucket>/` (mirror of
  // Phase 4's Network/ split). Section 7 turns `max-lines` off
  // across all `Mediator/**` files; without a re-imposed bound on
  // the Scrape sub-folder, future commits could quietly re-blob one
  // of the new homes back toward four-digit line counts.
  //
  // Per-function cap: the Phase 5 baseline for this glob **was** 20
  // effective lines, chosen so pre-existing files unrelated to Phase
  // 8.5b's canonical-10 drain (AccountExtractor, BfsFieldSearch,
  // Coercion, ContainerPicker, EndpointResolver, ForensicAuditAction,
  // JsonTraversal, MirrorDetection, ScrapeUiTrigger, TxnMapper,
  // TxnShape, LifoCrawl, TxnHunt) were not forced into a
  // phase-mismatched refactor. That 20 is now dead: §12B below raises
  // the bar to 10 for the drained canonical-10 sub-folders
  // (ScrapePhase/**, ScrapeReplay/**, FrozenScrapeAction,
  // UrlDateRange), §14b.4 re-scopes ALL of `Mediator/Scrape/**` to 10
  // for the Phase 2e drain, and the §19.0 strict baseline — later
  // still, and therefore the block that actually wins — resolves every
  // one of the 65 production files under this glob to 10. Flat config
  // is last-wins, so no production file here resolves to 20 any more.
  // The `max-lines-per-function` rule is therefore NOT declared in this
  // block: a dead 20 would read as the effective cap and mislead the
  // next maintainer, which is precisely the failure the cap-regime gate
  // in `src/Tests/Tools/` exists to surface.
  //
  // File-size cap stays at **150 effective lines** so every Scrape
  // sub-module still fits in a single reviewer's working memory. The
  // shim (`ScrapeAutoMapper.ts`) sits under this same glob and so is
  // bound by that 150 too — Section 7 turns `max-lines` off across
  // `Mediator/**`, and this block is what puts it back for Scrape.
  //
  // One canary enforces the file half of the cap: the
  // `no-scrape-mapper-blob.canary.ts` over-sizes the file to prove
  // `max-lines` fires. The function half is proved by
  // `scrape-cluster-fn-over-cap.canary.ts`, which is un-ignored in
  // §19.0 so it resolves through the same block production does. It
  // deliberately does NOT live here: this block declares no
  // per-function cap, so there is nothing here for it to certify.
  {
    files: [
      'src/Scrapers/Pipeline/Mediator/Scrape/**/*.ts',
      'src/Scrapers/Pipeline/EslintCanaries/no-scrape-mapper-blob.canary.ts',
    ],
    rules: {
      'max-lines': ['error', { max: 150, skipBlankLines: true, skipComments: true }],
    },
  },

  // 12B. SCRAPE CANONICAL-10 SUB-FOLDER PER-FN CAP (Phase 8.5b 2026-05-31)
  //
  // Locks the canonical-10 per-function cap (max 10 eff LoC) for the
  // four sub-trees drained during Phase 8.5b commits C1-C5:
  //   • `ScrapePhase/**` — composer + leaf modules split from
  //     ScrapePhaseActions.ts (C4 + C5)
  //   • `ScrapeReplay/**` — sub-modules split from
  //     ScrapeReplayAction.ts (C3)
  //   • `FrozenScrapeAction.ts` — in-place drained (C2)
  //   • `UrlDateRange.ts` — in-place drained (C1)
  //
  // This is a **scoped** tightening (not a global §12 drop) because
  // the broader Mediator/Scrape/** surface contains files unrelated
  // to Phase 8.5b's canonical-10 work; forcing those into the same
  // tightened cap here would expand C6 scope into a phase-mismatched
  // drain. Those pre-existing files keep §12's cap-20 baseline and
  // are slated for their own dedicated drain phase.
  //
  // The §12A grandfather block (which previously exempted the four
  // drained files at cap 20) was deleted in the same commit — all
  // four files now meet cap 10 through the C1-C4 refactor work.
  {
    files: [
      'src/Scrapers/Pipeline/Mediator/Scrape/ScrapeReplay/**/*.ts',
      'src/Scrapers/Pipeline/EslintCanaries/scrape-canonical10-fn-over-cap.canary.ts',
    ],
    rules: {
      'max-lines-per-function': [
        'error',
        { max: 10, skipBlankLines: true, skipComments: true, IIFEs: true },
      ],
    },
  },

  // 12C. SCRAPE CANONICAL-10 LOOKUP-ARRAY NAMING GUARD (PR #281 C8 hardening, 2026-05-31)
  //
  // Pattern detection: PR #281 SonarCloud flagged the same anti-pattern
  // (`typescript:S7776`) in TWO files within the canonical-10 sub-folders:
  //   • `ScrapeReplay/JsonReplace.ts:47` — `lowerKeys = keys.map(toLowerCase)` then `.includes`
  //   • `ScrapeReplay/RecordShape.ts:158` — `lowerKeys = bodyKeys.map(toLowerCase)` then `.includes`
  //
  // Root cause: a variable named `lowerKeys` (or `lowerXxxKeys`) conveys
  // "set of keys for membership testing" — semantically a Set, not an Array.
  // eslint-plugin-sonarjs@4.0.3 does NOT expose S7776 and a pure AST data-flow
  // rule is fragile, so we enforce a NAMING convention in canonical-10
  // sub-folders: `lower*Keys` is forbidden — force authors to either
  // `lowerKeySet = new Set(...)` (lookup) or `lowerNames` (iteration-only).
  //
  // The accompanying canary
  // `scrape-canonical10-lookup-array-shouldbe-set.canary.ts` exhibits
  // the banned name; it is armed in §22a.
  //
  // Generated from PIPELINE_SCOPED_SYNTAX_EXTRAS so that §23's exemption
  // blocks — which are emitted later and rebuild the rule wholesale — can
  // re-add these selectors from the same source instead of dropping them.
  ...PIPELINE_SCOPED_SYNTAX_EXTRAS.map(scope => ({
    files: scope.files,
    rules: {
      'no-restricted-syntax': ['error', ...PIPELINE_SYNTAX_RULES, ...scope.rules],
    },
  })),

  // 12D. SCRAPE CANONICAL-10 NO-NEGATED-CONDITION GUARD (PR #281 C9 hardening, 2026-05-31)
  //
  // Pattern detection: PR #281 SonarCloud flagged `typescript:S7735`
  // ("Unexpected negated condition") TWICE in the canonical-10 sub-folders:
  //   • PR #281 SQ-1 — `ScrapePhase/PhaseActions.ts` `executeStampAccounts`
  //     `if (!input.txnEndpoint.has) { … } else { … }` (early-cycle finding)
  //   • PR #281 C9     — `ScrapePhase/PhaseActions.ts:139` ternary
  //     `template.url !== '' ? template : undefined` (post-C8 finding)
  //
  // Both expose a tiny readability cost (cognitive double-negation),
  // both surface in the same drained sub-folder, and both are trivially
  // fixable by swapping branches to positive-first. Built-in ESLint
  // `no-negated-condition` is the canonical mirror of S7735 — enable it
  // locally so authors catch this BEFORE pushing.
  //
  // The accompanying canary
  // `scrape-canonical10-negated-condition.canary.ts` exhibits the banned
  // pattern (both if-else and ternary forms) so verify.sh asserts the
  // rule fires on every commit.
  {
    files: [
      'src/Scrapers/Pipeline/Mediator/Scrape/ScrapeReplay/**/*.ts',
      'src/Scrapers/Pipeline/EslintCanaries/scrape-canonical10-negated-condition.canary.ts',
    ],
    rules: {
      'no-negated-condition': 'error',
    },
  },

  // 13. PII REDACTOR SUB-MODULE FILE-SIZE + PER-FN + ANTI-LITERAL GUARD
  //
  // Phase 6 split the 996-LoC PiiRedactor.ts blob into thirteen
  // focused sub-modules under `Types/PiiRedactor/` (mirror of
  // Phase 4 Network/ and Phase 5 Scrape/ splits). Section 7 turns
  // `max-lines` off across all `Types/**` files; without a
  // re-imposed bound on the PiiRedactor sub-folder, future commits
  // could quietly re-blob one of the new homes back toward
  // four-digit line counts.
  //
  // Caps (all derived from CLAUDE.md "Code Quality" + the
  // §11/§12 precedent for sibling Phase-4 / Phase-5 clusters):
  //   • `max-lines` = **150** effective LoC (matches §11/§12)
  //   • `max-lines-per-function` = **10** effective LoC (matches
  //     CLAUDE.md "Max 10 lines per method"; CR cycle-1 #7 escaped
  //     under the §6C default cap of 15)
  //   • `no-restricted-syntax` bans hardcoded `'[REDACTED]'` /
  //     `'[OTP]'` / `'[REDACTION_ERROR]'` literals so per-category
  //     modules must import the matching constant from Types.ts
  //     (CR cycle-1 #9 — "Use constants from configuration, never
  //     hardcode values inline").
  //   • `sonarjs/no-identical-functions` catches duplicate fn
  //     bodies (e.g. the FALLBACK_PATTERNS regex helper that CR
  //     cycle-1 #4/#5 caught duplicated across JsonBody.ts and
  //     Html.ts).
  //   • `sonarjs/no-duplicate-string` threshold:3 surfaces
  //     repeated string literals before they become hardcoded
  //     constants.
  //
  // The shim itself (`PiiRedactor.ts`) is intentionally left
  // unconstrained — Section 7 already allows it, and this guard
  // is about preventing regression of the new homes, not the
  // tombstone re-export.
  //
  // Pre-existing files that already exceed the new file-size cap
  // (`Facade.ts` ~162 eff LoC — composes every per-category
  // strategy + the path-tail routing table + the dispatcher) are
  // grandfathered via §13A below, mirroring the §11A / §12A
  // pattern. The sentinel definers (`Types.ts`, which OWNS the
  // hint constants) are unlocked via §13B so the bans don't fire
  // on the defining file.
  //
  // Canaries:
  //   • `no-pii-redactor-blob.canary.ts` — proves `max-lines`
  //     fires (file > 150 LoC)
  //   • `pii-cluster-fn-over-cap.canary.ts` — proves
  //     `max-lines-per-function: 10` fires (function > 10 LoC)
  //   • `pii-hardcoded-sentinel.canary.ts` — proves the
  //     sentinel-literal ban fires (armed in §22a, not here)
  {
    files: [
      'src/Scrapers/Pipeline/Types/PiiRedactor/**/*.ts',
      'src/Scrapers/Pipeline/EslintCanaries/no-pii-redactor-blob.canary.ts',
      'src/Scrapers/Pipeline/EslintCanaries/pii-cluster-fn-over-cap.canary.ts',
      'src/Scrapers/Pipeline/EslintCanaries/pii-facade-no-grandfather.canary.ts',
      'src/Scrapers/Pipeline/EslintCanaries/lint-guideline-coverage-defaults-audit.canary.ts',
    ],
    plugins: { sonarjs },
    rules: {
      'max-lines': ['error', { max: 150, skipBlankLines: true, skipComments: true }],
      'max-lines-per-function': [
        'error',
        { max: 10, skipBlankLines: true, skipComments: true, IIFEs: true },
      ],
      'sonarjs/no-identical-functions': 'error',
      'sonarjs/no-duplicate-string': ['error', { threshold: 3 }],
      // The sentinel canary is armed in §22a — a canary-directory block
      // declared later would replace these options and disarm it.
      'no-restricted-syntax': ['error', ...PIPELINE_SYNTAX_RULES, ...PII_SENTINEL_LITERAL_RULES],
    },
  },

  // 13B. PII CONSTANT DEFINER UNLOCK
  //
  // `Types.ts` legitimately HOLDS the hint constants — its
  // `export const REDACTED_HINT = '[REDACTED]'` declaration MUST
  // contain the bare literal. Unlock the §13 sentinel ban here.
  //
  // Re-declaring the shared contract, NOT `'no-restricted-syntax': 'off'`.
  // `off` lifted all sixty-one selectors to excuse four sentinel literals,
  // leaving the module that defines the redaction vocabulary as the only
  // production Pipeline file with no restricted-syntax guardrails at all.
  // The §13 sentinel selectors are additions on top of the contract, so
  // simply not repeating them here grants exactly the intended unlock.
  {
    files: ['src/Scrapers/Pipeline/Types/PiiRedactor/Types.ts'],
    rules: {
      'no-restricted-syntax': ['error', ...PIPELINE_SYNTAX_RULES],
    },
  },

  // 13C. PII ERROR-LOG NO-BYPASS LOCK
  //
  // `ErrorLog.ts` MUST NEVER reference `isPiiRedactionDisabled` —
  // bank error messages are security-classified (CodeQL #28 / CR
  // cycle-1 #3): they always redact, even with `PII_REDACTION=off`.
  //
  // The canary that proves the rule fires is armed in §22a instead of
  // being listed here: a canary-directory block declared later would
  // replace these options and silently disarm it.
  {
    files: ['src/Scrapers/Pipeline/Types/PiiRedactor/ErrorLog.ts'],
    rules: {
      'no-restricted-syntax': ['error', ...PIPELINE_SYNTAX_RULES, PII_ERRORLOG_NO_BYPASS_RULE],
    },
  },

  // 14. API-DIRECT-CALL CONFIGCONTRACTS FILE-SIZE + PER-FN GUARD
  //
  // Phase 8 split the 369-LoC `IApiDirectCallConfig.ts` god-type-tree
  // into six concern-slice sub-modules under
  // `Mediator/ApiDirectCall/ConfigContracts/` (mirror of Phase 4
  // Network/, Phase 5 Scrape/, Phase 6 PiiRedactor/ splits).
  // Section 7 turns `max-lines` off across all `Mediator/**` files;
  // without a re-imposed bound on the ConfigContracts sub-folder,
  // future commits could quietly re-blob one of the new homes back
  // toward four-digit line counts.
  //
  // Caps (canonical CLEAN_CODE.md "Code Quality" — matches §13
  // PiiRedactor; type-only files should stay even smaller than
  // logic-bearing clusters §11/§12, so per-fn cap is the strict 10):
  //   • `max-lines` = **150** effective LoC (matches §11/§12/§13)
  //   • `max-lines-per-function` = **10** effective LoC (matches
  //     CLAUDE.md "Max 10 lines per method" + §13 precedent)
  //   • `complexity` = **10** + `@typescript-eslint/max-params` = **3**
  //     are inherited from §5/§6 globals — the guideline-coverage
  //     gate (`npm run lint:guideline-coverage`) asserts the
  //     resolved values stay ≤ canonical.
  //   • `sonarjs/no-identical-functions` catches duplicate
  //     factory / helper bodies if any are added later.
  //   • `sonarjs/no-duplicate-string` threshold:3 surfaces repeated
  //     string literals (signer-algorithm tags, ref-token prefixes)
  //     before they harden into hardcoded constants.
  //
  // The legacy `IApiDirectCallConfig.ts` shim this guard was written
  // alongside was deleted in Phase 3 (v8.6). The guard remains valid on
  // its own terms: it is about preventing regression of the new homes,
  // and never depended on the tombstone re-export existing.
  //
  // Canary:
  //   • `no-api-direct-call-blob.canary.ts` — proves `max-lines`
  //     fires (file > 150 LoC) so the guard cannot silently rot.
  //
  // CR feedback (PR #279, finding F1): canary now uses 71 *unique*
  // function bodies (each returns its own integer literal) so the
  // co-enabled `sonarjs/no-identical-functions` (S4144) cannot
  // silently fire on duplicate bodies and mask a future
  // `max-lines:150` regression. Note that rule-firing identity
  // (asserting the *specific* error ID, not just `errorCount > 0`)
  // is tracked separately as Phase 8.5c canary-infrastructure
  // hardening — that work also adds the `tsconfig.eslint.json`
  // needed to surface the intended rule instead of a fallback parse
  // error caused by the canary dir being excluded from the main
  // tsconfig.
  {
    files: [
      'src/Scrapers/Pipeline/Mediator/ApiDirectCall/ConfigContracts/**/*.ts',
      'src/Scrapers/Pipeline/EslintCanaries/no-api-direct-call-blob.canary.ts',
    ],
    plugins: { sonarjs },
    rules: {
      'max-lines': ['error', { max: 150, skipBlankLines: true, skipComments: true }],
      'max-lines-per-function': [
        'error',
        { max: 10, skipBlankLines: true, skipComments: true, IIFEs: true },
      ],
      'sonarjs/no-identical-functions': 'error',
      'sonarjs/no-duplicate-string': ['error', { threshold: 3 }],
    },
  },

  // 14. MEDIATOR CLUSTER LOCK — full strict three-rule lock.
  //
  // Every surviving Mediator/ sub-cluster is pinned to the canonical
  // three-rule lock (no relaxation):
  //
  //   • max-statements: 10            — body statement count
  //   • max-lines-per-function: 10    — signature+body+brace
  //                                     (skipBlankLines + skipComments + IIFEs)
  //   • max-lines: 150                — per-file
  //                                     (skipBlankLines + skipComments)
  //
  // Canaries — one fn-over-cap + one file-over-cap per cluster — live
  // alongside in EslintCanaries/ and are scoped into each block via the
  // `files` array so the corresponding rule provably fires:
  //   • mediator-api-selector-{fn,file}-over-cap.canary.ts (Api + ApiDirectCall)
  //   • mediator-residue-{fn,file}-over-cap.canary.ts (Scrape + Credentials + Timing)

  // 14a. Api + ApiDirectCall.
  {
    files: [
      'src/Scrapers/Pipeline/Mediator/Api/**/*.ts',
      'src/Scrapers/Pipeline/Mediator/ApiDirectCall/**/*.ts',
      'src/Scrapers/Pipeline/EslintCanaries/mediator-api-selector-fn-over-cap.canary.ts',
      'src/Scrapers/Pipeline/EslintCanaries/mediator-api-selector-file-over-cap.canary.ts',
    ],
    rules: {
      'max-statements': ['error', 10],
      'max-lines-per-function': [
        'error',
        { max: 10, skipBlankLines: true, skipComments: true, IIFEs: true },
      ],
      'max-lines': ['error', { max: 150, skipBlankLines: true, skipComments: true }],
    },
  },

  // 14b. Scrape + Credentials + Timing.
  {
    files: [
      'src/Scrapers/Pipeline/Mediator/Scrape/**/*.ts',
      'src/Scrapers/Pipeline/Mediator/Credentials/**/*.ts',
      'src/Scrapers/Pipeline/Mediator/Timing/**/*.ts',
      'src/Scrapers/Pipeline/EslintCanaries/mediator-residue-fn-over-cap.canary.ts',
      'src/Scrapers/Pipeline/EslintCanaries/mediator-residue-file-over-cap.canary.ts',
    ],
    rules: {
      'max-statements': ['error', 10],
      'max-lines-per-function': [
        'error',
        { max: 10, skipBlankLines: true, skipComments: true, IIFEs: true },
      ],
      'max-lines': ['error', { max: 150, skipBlankLines: true, skipComments: true }],
    },
  },
];
