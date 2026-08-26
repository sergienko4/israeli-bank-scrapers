# TypeScript compilers — why there are two, and which gates them

This repository builds against **two TypeScript compilers at once**. That is
deliberate, but it is also the kind of arrangement that quietly stops being
true, so both halves are gated.

| Alias in `package.json` | Resolves to | Used by |
|---|---|---|
| `@typescript/native` | `typescript@7.0.2` — the native (Go) compiler | `npm run type-check` |
| `typescript` | `@typescript/typescript6@6.0.3` — the JS compiler | typescript-eslint, ts-jest, tsup DTS |

The aliases are inverted on purpose: the *name* `typescript` is what every
tool resolves when it does `require('typescript')`, so pointing it at TS 6
is what keeps the ecosystem working. TS 7 is reached only through the
explicit `@typescript/native` name.

## Why both are gated

The published `.d.ts` is emitted by **tsup's DTS rollup, which runs on TS 6**.
Consumers therefore install types produced by TS 6.

That emission was already gated: CI's Build job runs `npx tsup`, then asserts
the emitted `lib/index.d.ts` / `lib/index.d.cts` exist and that the public
surface is unchanged. What was missing is a TS 6 check over the **whole tree**.
`tsup` reads `tsconfig.build.json`, which excludes `src/Tests/**` and `*.test.ts`
— so TS 6 never saw most of the repo, and only TS 7 did.

`pr.yml` now runs both as separate steps:

```yaml
- name: Type check
  run: npm run type-check          # TS 7 — @typescript/native

- name: Type check (TS 6 API — the compiler that emits our .d.ts)
  run: npm run type-check:ts6      # TS 6 — the `typescript` alias
```

These two steps are whole-tree compatibility checks over `tsconfig.json`. They
are **not** configuration-equivalent to the DTS build, which uses
`tsconfig.build.json` and a narrower file set; the Build job remains what gates
actual declaration emission. The pair is complementary, not redundant.

They are two steps rather than one `&&` so the CI log names which compiler
objected. TS 6 costs about ten seconds, which is not worth optimising away.

A deliberate `const x: number = 'str'` was confirmed to fail **both** gates
with the same `TS2322`, so neither is a no-op.

!!! note "`tsconfig.build.json` is a third configuration"
    tsup reads `tsconfig.build.json`, which adds `"ignoreDeprecations": "6.0"`
    because tsup's DTS rollup unconditionally injects a `baseUrl` that TS 6
    reports as `TS5101`. That suppression is confined to the build config;
    the `tsconfig.json` used by both type-check gates stays free of it.

## Why we are not on TS 7 alone

Not a choice we control. The blockers are third-party, and all three are
verifiable from installed metadata rather than from release notes:

| Package | Locked | Declared `peerDependencies.typescript` | Admits TS 7? |
|---|---|---|---|
| `typescript-eslint` | 8.67.0 | `>=4.8.4 <6.1.0` | No |
| `ts-jest` | 29.4.12 | `>=4.3 <7` | No — excluded by an explicit upper bound |
| `tsup` | 8.5.1 | `>=4.5.0` | No upper bound, but its DTS rollup needs the TS API |

The common root cause is that **TS 7.0 exposes no stable programmatic API**.
`@typescript/native@7.0.2` publishes its API only under `./unstable/*` export
paths (`./unstable/sync`, `./unstable/async`, `./unstable/ast`, …). A linter
or transformer cannot depend on that, which is why the two type-aware tools
above still pin below 7.

### Unblock conditions

TS 7 becomes the single compiler when **all three** hold:

1. **TS 7.1 ships a stable programmatic API** — the `./unstable/*` export
   paths above graduate. This is the upstream prerequisite for the other two;
   expected late 2026.
2. **`typescript-eslint` widens its peer range past `<6.1.0`** and its
   type-aware rules run on the native compiler.
3. **`ts-jest` widens its peer range past `<7`** — or the test transform moves
   to something that does not embed the TS API at all.

Condition 1 is upstream of 2 and 3, so checking it first is usually enough.

### Re-checking

This is monitoring, not implementation — there is nothing to build until
upstream moves. Re-check on **dependency-bump PRs that touch any of the three
packages above**, which is the moment the answer can actually change, by
re-reading the installed metadata rather than the changelog:

```bash
node -e "for (const m of ['typescript-eslint','ts-jest','tsup']) {
  const p = require(m + '/package.json');
  console.log(m, p.version, p.peerDependencies?.typescript ?? '(none)');
}"
```

If every range admits 7, revisit this page.

## See also

- [CI gates](ci.md) — where these steps sit in the PR workflow
- [Pre-commit hook](pre-commit.md) — the local `tsc` gate (TS 7)
- [Public API surface gate](public-surface.md) — what guards the emitted types
