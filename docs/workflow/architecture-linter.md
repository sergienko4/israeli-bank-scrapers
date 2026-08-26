# Architecture linter scope

`npm run lint:architecture` runs `src/Tests/Tools/lint-and-validate.ts`, a
rule set that ESLint cannot express: Pipeline structure, Phase isolation,
PII-in-logs, retired-shim detection, and a set of SonarJS _canaries_.

## Scope

The linter analyses **`src`** — the whole tree.

It previously ran against `src/Scrapers/Pipeline` only, which meant
`src/Common`, `src/Scrapers/Base`, `src/Scrapers/Registry` and `src/Tests`
were never inspected. `Rule #17` was the sole exception: `lint:retired-shims`
has always passed `src` explicitly.

|                                  | analysable `.ts` files |
| -------------------------------- | ---------------------- |
| before (`src/Scrapers/Pipeline`) | 788                    |
| after (`src`)                    | 1666                   |

## The three canaries are production-only

`S6564-Canary` (bare-primitive type alias), `S3735-Canary` (`void <expr>;`)
and `S1607-Canary` (skipped test without a `#nnn` rationale) do **not** run on
`src/Tests`. See `isTestOwned()` in
[`LintValidator.ts`](https://github.com/sergienko4/israeli-bank-scrapers/blob/main/src/Tests/Tools/LintValidator.ts).

These three are _defence-in-depth_: they re-assert SonarJS rules by regex so an
`eslint --no-verify` bypass still trips the architecture gate. That reasoning
holds for production code. It does not hold under `src/Tests`, where
`eslint.config.mjs` already states a deliberate — and deliberately different —
per-directory test policy. Letting a regex overrule that would replace a
considered decision with a heuristic.

**This narrows scope, never strength.** No production file loses a canary. The
canaries ran on zero test files before the widening (the old scope contained
none), and now cover **70 production files that were previously invisible** to
them.

### Why each canary is wrong about tests

Widening the linter surfaced 26 pre-existing hits, every one under `src/Tests`,
and every one a false positive against the canary's own documented intent.

| Canary  | Hits | Why the match is spurious                                                                                                                                                                                                       |
| ------- | ---- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `S6564` | 14   | Documented semantic aliases (`/** Whether a WK predicate matches. */ type WkMatch = boolean;`). ESLint does not configure `sonarjs/no-redundant-type-aliases` anywhere; two files were already allowlisted for this exact rule. |
| `S3735` | 5    | The rule targets the discard-promise antipattern. Every hit is `void unusedParam;` — the standard idiom for a parameter kept for interface conformance. The regex cannot tell the two apart.                                    |
| `S1607` | 7    | All in `E2eMocked`, where ESLint sets `sonarjs/no-skipped-tests: 0` on purpose. Each skip carries a multi-line JSDoc rationale; the canary only accepts a `//` comment containing `#nnn`, so it cannot see prose.               |

`S1607` loses nothing on unit tests: ESLint sets `sonarjs/no-skipped-tests: 2`
there, a _stricter_ policy than the canary's (no skips at all, rationale or
not).

## Per-file exemptions

Genuine one-off conflicts use
[`architecture-allowlist.json`](https://github.com/sergienko4/israeli-bank-scrapers/blob/main/src/Tests/Tools/architecture-allowlist.json),
a map of repo-relative path to exempt rule keys:

```json
{ "src/Tests/Unit/Tools/PiiLogBypassPrevention.test.ts": ["PII-Log"] }
```

Prefer the allowlist over widening a rule: it records _which_ file and _which_
rule, and it shows up in review.

## Verifying the scope

```bash
npx tsx src/Tests/Tools/lint-and-validate.ts src   # exit 0
```

Detail for any failure is written to `.architecture-violations.log` as JSON;
the console prints only a count.

To confirm the canaries still fire on newly-covered production code, plant a
`type Probe = string;` in `src/Common/` and re-run — it must be reported, and
must disappear when reverted.
