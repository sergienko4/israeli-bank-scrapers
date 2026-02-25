# Task: Migrate ESLint to v10 with Flat Config

## Priority: Medium | Effort: Medium (half day)

## Current State

- ESLint 8.57.0 with legacy `.eslintrc.js` config
- `@typescript-eslint/*` v7.12.0
- `eslint-config-airbnb-typescript` v18 (does not support flat config)
- `eslint-config-airbnb-base` v15

## Target

- ESLint 10.x with `eslint.config.js` (flat config)
- `@typescript-eslint/*` v8.x
- Replace `airbnb-typescript` with equivalent manual rules or a flat-config-compatible alternative

## Planned Work

### 1. Update packages
- `eslint` ^8.57.0 → ^10.x
- `@typescript-eslint/eslint-plugin` ^7.12.0 → ^8.x
- `@typescript-eslint/parser` ^7.12.0 → ^8.x
- Remove `eslint-config-airbnb-base`, `eslint-config-airbnb-typescript`
- Add `@eslint/js` for recommended rules

### 2. Convert `.eslintrc.js` to `eslint.config.js`
- Migrate all rules from legacy format to flat config
- Replace `extends` with direct plugin imports
- Replace `env` with `languageOptions.globals`
- Replace `parserOptions.project` with `languageOptions.parserOptions`

### 3. Update lint scripts
- Verify `npm run lint` and `npm run lint:fix` work with new config

## Acceptance Criteria

- [ ] ESLint 10.x installed and configured with flat config
- [ ] All existing lint rules preserved (same behavior)
- [ ] `npm run lint` passes with zero warnings
- [ ] `.eslintrc.js` removed, `eslint.config.js` in place
- [ ] All tests pass
