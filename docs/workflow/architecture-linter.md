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
| before (`src/Scrapers/Pipeline`) | 790                    |
| after (`src`)                    | 1671                   |

Reproduce the counts with the walker the linter itself uses (`isExcluded()`
skips `EslintCanaries/`, `*.canary.ts`, `node_modules/`, `lib/`, `dist/` and
non-`.ts` files).

## Each canary mirrors the scope of the rule it shadows

`S6564-Canary` (bare-primitive type alias), `S3735-Canary` (`void <expr>;`) and
`S1607-Canary` (skipped test without a `#nnn` rationale) re-assert three SonarJS
rules by regex, so the gate still fires if those rules are reconfigured or
dropped. A canary is only meaningful while it shadows a rule that is actually
in force — so each one is scoped exactly like its ESLint counterpart:

| Canary  | ESLint rule                     | Scope mirrored                                                                     |
| ------- | ------------------------------- | ---------------------------------------------------------------------------------- |
| `S6564` | `sonarjs/redundant-type-aliases` | Block 11 — all `src`, minus `src/Tests`, `src/Common`, `Registry` and legacy banks |
| `S3735` | `sonarjs/void-use`              | Block 11 — same exclusions                                                         |
| `S1607` | `sonarjs/no-skipped-tests`      | Block 19.6 — **on** across `src/Tests`; block 19.7 exempts 7 named files           |

Block 11's exclusion list is not arbitrary: it mirrors `sonar.exclusions` in
`sonar-project.properties`, so SonarCloud does not report those paths either.
A canary that fired there would enforce a policy no configuration states.

`S1607` is the opposite case. Skipped tests are what it exists to find, so it
stays active across `src/Tests` — including test tooling. Only the seven
`E2eMocked` suites that block 19.7 names are exempt, and they are tracked debt
awaiting fixture capture (`tasks/phase-7-5-T8-T12`), not false positives.

### One list, three consumers

Three places need the same answer to "what is in scope?": `eslint.config.mjs`
enforces the rules, `src/Tests/Tools/LintValidator.ts` shadows them, and
`src/Tests/Unit/Tools/LintCanaryScope.test.ts` pins the behaviour. They read it
from `eslint.canary-scope.mjs`:

| Export                          | Consumer                                   |
| ------------------------------- | ------------------------------------------ |
| `SONAR_PARITY_IGNORE_PREFIXES`  | `LintValidator.ts` path matching, and the test |
| `SONAR_PARITY_IGNORE_GLOBS`     | Block 11 `ignores` — derived from the prefixes |
| `SKIP_ALLOWLIST_FILES`          | Block 19.7 `files`, and `LintValidator.ts` |

Hand-maintained copies made drift a matter of time, and a canary mirroring a
stale scope reports on files ESLint no longer covers. Sharing the list makes
that drift impossible rather than merely detectable. Edit that file and every
consumer moves together.

An entry ending in `/` is a directory prefix; anything else must match a path
exactly, so an allowlisted suite cannot exempt a longer sibling filename.

**Scope changes, strength does not.** No file loses a canary that its ESLint
rule still covers, and the canaries now reach **70 production files that were
previously invisible** to them.

### What widening surfaced

Widening the linter surfaced 26 pre-existing hits, every one under `src/Tests`:
14 `S6564`, 5 `S3735`, 7 `S1607`. None is a rule violation — each sits outside
the scope of the ESLint rule the canary mirrors, as set out in the table above.
Mirroring those scopes resolves all 26 without weakening a rule or adding a
single per-file exemption.

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
`type Probe = string;` in `src/Scrapers/Base/` and re-run — it must be
reported, and must disappear when reverted. Planting the same line under
`src/Common/` must **not** be reported: block 11 excludes that path, and the
canary deliberately mirrors it.
