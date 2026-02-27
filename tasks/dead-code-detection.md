# Task: Dead Code & Unused Export Detection in CI

## Priority: Medium | Effort: Small (2 hours)

## Problem

TypeScript `noUnusedLocals: true` and `noUnusedParameters: true` already catch **local** dead
variables. But **exported symbols** that are never imported anywhere are silently ignored:

| Symbol | File | Status |
|--------|------|--------|
| `BANK_REGISTRY` | `bank-registry.ts` | Exported, 0 importers |
| `resolveSelector` | `selector-resolver.ts` | Deprecated, 0 external callers |
| `FieldContext` | `selector-resolver.ts` | Exported type, 0 importers |
| `OtpConfig` | `login-config.ts` | Exported type, 0 importers |
| `LoginPossibleResults` | `login-config.ts` | Exported type, 0 importers |

These are discovered days or weeks later during code review — or never, causing confusion in git
blame when clients file bugs ("what does `BANK_REGISTRY` do? why is it empty?").

ESLint `@typescript-eslint/no-unused-vars` only catches local vars.
Duplicate imports (`import { a } from 'x'; import { b } from 'x'`) also currently pass lint.

## Target

Fail `npm run lint` (and therefore `npm run build` and CI) when:

1. An exported symbol has **zero importers** across the entire project
2. The same module is **imported twice** in one file
3. An import is **unused** (already caught, but tighten the rule)

## Planned Work

### 1. Add `ts-unused-exports` — catches dead exports across the whole project

```bash
npm install --save-dev ts-unused-exports
```

Add to `package.json` scripts:
```json
"check:unused-exports": "ts-unused-exports tsconfig.json --excludePathsFromReport='*.test.ts;*.test-utils.ts;tests/'",
```

Rationale for exclusions:
- Test files export describe/it blocks that are consumed by the test runner, not imported
- `tests/` helpers export utilities used only within the test folder — covered by tsc already

Add to the `lint` script or as a separate `check` script called from CI:
```json
"lint": "eslint src --max-warnings 0 && npm run format:check && npm run check:unused-exports",
```

**What this catches:**
- `BANK_REGISTRY` exported but never imported → ❌ fail
- `OtpConfig` exported but never used → ❌ fail
- `resolveSelector` (deprecated) exported but no callers → ❌ fail (forces decision: remove or use)

**What this does NOT flag:**
- `ScraperOptions`, `CompanyTypes` etc. — exported and imported in test files (covered by exclusion pattern)
- Main public API exports from `index.ts` — should be excluded or tested via a consumer

### 2. Add `eslint-plugin-unused-imports` — catches import-level dead code

```bash
npm install --save-dev eslint-plugin-unused-imports
```

In `eslint.config.mjs`:
```javascript
import unusedImports from 'eslint-plugin-unused-imports';

// In rules:
'unused-imports/no-unused-imports': 'error',
'no-duplicate-imports': 'error',   // catches bank-registry.ts F2, generic-bank-scraper.ts F11
```

**What this catches:**
- `import { pageEval, pageEvalAll } from '...'` duplicated on line 10 of `bank-registry.ts` → ❌ fail
- `import { clickButton } from '...'` + `import { fillInput } from '...'` separate in `generic-bank-scraper.ts` → ❌ fail
- Any import that is brought in but never referenced in the file body → ❌ fail

### 3. Add to CI workflow (`.github/workflows/nodeCI.yml`)

```yaml
- name: Check unused exports
  run: npm run check:unused-exports
```

Add as a separate CI step after `Type Check` so failures are clearly attributed.

### 4. Allowlist pattern for intentionally-exported-but-not-yet-used symbols

Some exports are "planned" (e.g., `OtpConfig` will be used by the OTP detection task).
Use a JSDoc tag to suppress the warning:

```typescript
/** @public — exported for future OTP detection use, not yet imported */
export type OtpConfig = ...
```

Alternatively, configure `ts-unused-exports` with an `--allowUnusedTypes` flag to skip type-only
exports, since types are often exported for consumer use.

## Acceptance Criteria

- [ ] `npm run check:unused-exports` fails when a new unused export is added
- [ ] `npm run lint` fails when a module is imported twice in one file
- [ ] `npm run lint` fails when an import is brought in but never used
- [ ] CI `lint` job fails on PRs that introduce dead exports or duplicate imports
- [ ] Existing unused exports (`BANK_REGISTRY`, `resolveSelector`, `OtpConfig`, etc.) are
      either removed, used, or explicitly allowlisted with a `@public` JSDoc comment
- [ ] All existing 394 unit tests still pass
- [ ] `npm run build` (which calls `npm run lint`) still passes on the clean codebase

## Why This Matters for Debugging & Bug Reports

When a client files a bug like "the scraper stopped working after the bank redesigned":

1. Developer opens git blame — sees `BANK_REGISTRY` was added 3 months ago but **never wired**
2. Without this task: silent confusion. With this task: the dead export would have **failed CI at PR time**
3. Same for `resolveSelector` marked `@deprecated` but still exported — a future developer might use
   it instead of `resolveFieldContext`, get the wrong behavior (missing iframe context), and file a
   confusing bug

Dead export detection transforms a "mystery 3 months later" problem into an "immediate PR failure"
problem — which is where it belongs.

## Files to Modify

| File | Change |
|------|--------|
| `package.json` | Add `check:unused-exports` script, add to `lint` script |
| `eslint.config.mjs` | Add `unused-imports` plugin + `no-duplicate-imports` rule |
| `.github/workflows/nodeCI.yml` | Add `check:unused-exports` step |
| `src/scrapers/bank-registry.ts` | Fix duplicate import (F2); or this file will fail the new rule |
| `src/scrapers/generic-bank-scraper.ts` | Merge duplicate imports (F11); or will fail |
| `src/scrapers/login-config.ts` | Add `@public` JSDoc to `OtpConfig`, `LoginPossibleResults` if keeping |
| `src/helpers/selector-resolver.ts` | Remove or use `resolveSelector`; or add `@public` JSDoc |

## Related Findings

- F2: Duplicate import in `bank-registry.ts` → caught by `no-duplicate-imports`
- F7: `BANK_REGISTRY` never imported → caught by `ts-unused-exports`
- F8: `GenericBankScraper` not wired to factory → partially caught (exported, used in tests)
- F9: `resolveSelector` deprecated + 0 callers → caught by `ts-unused-exports`
- F10: `OtpConfig`, `LoginPossibleResults`, `FieldContext` → caught by `ts-unused-exports`
- F11: Duplicate imports in `generic-bank-scraper.ts` → caught by `no-duplicate-imports`
