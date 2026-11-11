// @ts-check
/**
 * Rule #10, the shape window-end lock, the canary contract, generated
 * exemptions, and the JsonUnknown alias exemption. Emitted last so nothing
 * can overwrite them.
 */
import {
  RULE10_NO_RAW_PAGE_RULE,
  SHAPE_TXNS_WINDOW_END_RULE,
} from '../rules/GuardRules.mjs';
import { CANARY_EXTRA_BLOCKS } from '../rules/CanaryRegistry.mjs';
import {
  PIPELINE_CANARY_SYNTAX_RULES,
  PIPELINE_SELECTOR_EXEMPTIONS,
  PIPELINE_SYNTAX_RULES,
  pipelineSyntaxExcept,
} from '../rules/PipelineContract.mjs';

export const FINAL_GUARD_BLOCKS = [
  // 21. RULE #10 — NO RAW `page` IN PIPELINE BUSINESS LOGIC.
  //     The ban existed only under `src/Tests/**/Pipeline/**` (§5), so it had
  //     never once run against production. Selector + its known blind spots are
  //     documented on `RULE10_NO_RAW_PAGE_RULE` above — read that before
  //     assuming this glob makes a layer Playwright-free.
  //
  //     SCOPE — the five layers that are business logic: Phases, Core, Banks,
  //     Registry, Logging. No production file in them is grandfathered.
  //
  //     EXCLUDED, and why each is a judgement call rather than a settled fact:
  //       • Mediator — is the browser boundary by definition (P7). Settled.
  //       • Strategy — `IFetchStrategy` implementations the ApiMediator selects
  //         at runtime (P4). Being *chosen by* the Mediator is not the same as
  //         *being* the Mediator, so this exclusion is arguable; 5 call sites.
  //       • Interceptors — DOM-snapshot / WAF capture, inherently page-bound;
  //         8 call sites.
  //       • Types — NOT a principled exclusion. `Types/FixtureCapture.ts` is a
  //         misplaced capture helper with 2 call sites; it belongs under
  //         Mediator or Interceptors. Excluded only to keep this commit to one
  //         guardrail change (eslint-rules-guidlines.md §5).
  //     Bringing any of the three latter layers in-scope is a follow-up worth
  //     doing; it needs ~15 grandfather entries and a maintainer decision.
  //
  //     `PIPELINE_SYNTAX_RULES` is spread rather than listing selectors here
  //     because flat config REPLACES a rule's options rather than merging them
  //     — omitting it would strip the guards that the `src/**/*.ts` block (§14)
  //     establishes for these files. That constant already unions
  //     `RESTRICTED_SYNTAX_RULES`, §6's richer `RESTRICTED_SYNTAX_RULES_NEW`
  //     and `PIPELINE_REVIEW_RULES` (minus the drain queue), so §6's extra
  //     selectors ARE in force on these paths.
  {
    files: [
      'src/Scrapers/Pipeline/Phases/**/*.ts',
      'src/Scrapers/Pipeline/Core/**/*.ts',
      'src/Scrapers/Pipeline/Banks/**/*.ts',
      'src/Scrapers/Pipeline/Registry/**/*.ts',
      'src/Scrapers/Pipeline/Logging/**/*.ts',
    ],
    rules: {
      'no-restricted-syntax': ['error', ...PIPELINE_SYNTAX_RULES, RULE10_NO_RAW_PAGE_RULE],
    },
  },

  // 20. SHAPE TRANSACTIONS WINDOW-END LOCK — added 2026-06 with the
  //     window-coverage backfill.
  //
  //     The backfill re-asks a bank for an older slice by handing the shape a
  //     context whose `windowEnd` is narrowed. That only reaches the wire while
  //     `scrapeWindowEnd(ctx)` is the single place the window's end is decided,
  //     so a shape that reads the clock directly silently opts out of the
  //     backfill and re-introduces the transaction loss it exists to close.
  //     The rule's rationale, and the window contract it protects, are
  //     documented in docs/phases/api-direct-scrape.md ("Window upper bound —
  //     `scrapeWindowEnd` and the `windowNarrowing` declaration"); this rule
  //     keeps a call site that bypasses it from appearing.
  //
  //     `RESTRICTED_SYNTAX_RULES` and `NO_DIRECT_SCREENSHOT_RULE` are re-spread
  //     because flat config REPLACES a rule's options rather than merging them
  //     — omitting them would silently weaken §6 and §14 on these files.
  //
  //     OneZeroShapeTxns.ts is excluded, not grandfathered: OneZero is declared
  //     `providerCursor` and has no upper bound to narrow. Its single clock read
  //     computes the provider's absolute one-year floor on the window's START
  //     (`max(options.startDate, 1y ago)`), which must stay pinned to wall-clock
  //     now — measuring it from a narrowed end would let the walk ask for data
  //     older than the provider serves.
  //
  //     MizrahiShapeTxns.ts is excluded for the same reason, on a request
  //     field: `get428Index` refuses (HTTP 500) any `inFromDate` older than
  //     today − 365 days, measured live (real logins #9 and #13). Its END still
  //     comes from `scrapeWindowEnd(ctx)`; only the START floor reads the clock.
  //     Both exclusions are retired by a follow-up that moves the floor into a
  //     shared helper beside `scrapeWindowEnd`.
  //
  //     Widened 2026-08 (Phase 4) from `Banks/**/scrape/` to also cover
  //     `Phases/ApiDirectScrape/**`: a bank family that shares one neutral
  //     `*ShapeTxns.ts` factory moves the wire's window bound out of the bank
  //     folder, and a path-keyed rule would have dropped the guardrail exactly
  //     where several banks now depend on it at once. The glob is widened, never
  //     narrowed — coverage only grows (eslint-rules-guidlines.md §1/§4).
  {
    files: [
      'src/Scrapers/Pipeline/Banks/**/scrape/*ShapeTxns.ts',
      'src/Scrapers/Pipeline/Phases/ApiDirectScrape/**/*ShapeTxns.ts',
    ],
    ignores: [
      'src/Scrapers/Pipeline/Banks/OneZero/scrape/OneZeroShapeTxns.ts',
      'src/Scrapers/Pipeline/Banks/Mizrahi/scrape/MizrahiShapeTxns.ts',
    ],
    rules: {
      'no-restricted-syntax': [
        'error',
        ...PIPELINE_SYNTAX_RULES,
        SHAPE_TXNS_WINDOW_END_RULE,
        RULE10_NO_RAW_PAGE_RULE,
      ],
    },
  },

  // 22. CANARY DIRECTORY — the full contract, nothing drained.
  //
  // Placed last (before the per-file exemptions) so no earlier block can
  // narrow it. Canaries exist to prove a selector still fires; a canary whose
  // target had been drained or overwritten would pass on incidental lint noise
  // — which is exactly how `readonly-set-instead-of-const` and
  // `as-unknown-as-double-cast` sat green while certifying nothing.
  {
    files: ['src/Scrapers/Pipeline/EslintCanaries/**/*.canary.ts'],
    rules: { 'no-restricted-syntax': ['error', ...PIPELINE_CANARY_SYNTAX_RULES] },
  },

  // 22a. CANARY FILE-SPECIFIC RULES — the contract plus what one canary certifies.
  //
  // Generated from CANARY_EXTRA_RULES and emitted after §22 so the base
  // contract cannot swallow a canary's own target. `check-syntax-guardrails`
  // proves each entry resolves on the canary that declares it.
  ...CANARY_EXTRA_BLOCKS,

  // 23. CONTRACT EXEMPTIONS — last, so nothing can overwrite them.
  //
  // Generated from PIPELINE_SELECTOR_EXEMPTIONS so the table a reviewer reads
  // is the table ESLint applies and the one `check-syntax-guardrails` subtracts.
  // Each entry re-declares the full contract MINUS the named selectors, never
  // `'no-restricted-syntax': 'off'` — `off` excuses one selector by lifting all
  // of them, which is how `PiiRedactor/Types.ts` came to run unguarded.
  //
  // The file is passed to `pipelineSyntaxExcept` so scoped selectors (§12C)
  // survive: rebuilding from the global contract alone silently disarmed them
  // on the three exempted files that sit inside the canonical-10 folders.
  ...Object.entries(PIPELINE_SELECTOR_EXEMPTIONS).map(([file, exempt]) => ({
    files: [file],
    rules: { 'no-restricted-syntax': pipelineSyntaxExcept(exempt, file) },
  })),

  // ── `JsonUnknown` is the one alias S6564 may not judge ───────────
  //
  //     `Types/JsonValue.ts` declares `type JsonUnknown = unknown` —
  //     the single name for "a boundary value nobody has narrowed
  //     yet". S6564 (`sonarjs/redundant-type-aliases`) fires because
  //     the alias carries no TYPE information. That is true, and it is
  //     beside the point: the NAME is the contract. It marks an
  //     OPAQUE boundary — a value carrying no structural guarantee —
  //     and it is the vocabulary `JsonValueSingleSource.test.ts` uses
  //     to tell the open arm from the closed ones. Note it does NOT
  //     today keep bare `unknown` out of Pipeline signatures: both
  //     `unknown` signature selectors sit in
  //     `PIPELINE_SYNTAX_PENDING_DRAIN` above and are filtered out of
  //     the active rule set.
  //
  //     The alias is exempted rather than re-spelled because each
  //     obvious direct alternative is blocked by another enabled gate
  //     — every one below was run, not assumed. (Indirect evasions
  //     such as `ReturnType<() => unknown>` do pass; they are worse
  //     than an explicit, documented exemption, not better.)
  //       - `JsonValue | NonNullable<unknown> | null | undefined`, the
  //         spelling this replaced, trips
  //         `@typescript-eslint/no-generated-empty-object-type` (added
  //         in 8.70.0): `NonNullable<unknown>` resolves to `{}`.
  //       - `JsonValue | unknown | null | undefined` trips
  //         `@typescript-eslint/no-redundant-type-constituents`.
  //       - `JsonValue | object | null | undefined` trips `tsc`: 20
  //         diagnostics, boundary call sites passing `unknown` in by
  //         design, which is precisely what the type exists to accept.
  //
  //     Mirrored by `jsonUnknownAlias` in `sonar-project.properties`;
  //     without that, SonarCloud fails the quality gate on the same
  //     rule and `sonar.qualitygate.wait=true` blocks the merge.
  //
  //     This override is FILE-scoped — the narrowest scope ESLint
  //     supports — so it also silences S6564 for the closed arms
  //     declared alongside it. `JsonValueSingleSource.test.ts`
  //     restores the declaration-level guard by running S6564
  //     itself with this override reversed, and asserting the rule
  //     reports exactly one alias here: `JsonUnknown`. (`JsonObject`
  //     is not reported — S6564 flags a reference only when it
  //     resolves to another alias, and `IJsonObject` is an
  //     interface.) It also asserts, through ESLint's own resolved
  //     config, that S6564 is off for this file and still armed
  //     for its neighbours.
  //
  //     Removal condition: drop this when the alias is deleted, or if
  //     S6564 gains an exemption for documented top-type aliases. It
  //     may only ever be narrowed, never widened
  //     (eslint-rules-guidlines.md §4).
  {
    files: ['src/Scrapers/Pipeline/Types/JsonValue.ts'],
    rules: {
      'sonarjs/redundant-type-aliases': 'off',
    },
  },
];
