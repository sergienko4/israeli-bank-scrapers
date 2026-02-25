# Task: Upgrade Jest to v30

## Priority: Low | Effort: Small (1-2 hours)

## Current State

- Jest 29.7.0 with ts-jest 29.4.6
- `@types/jest` 29.5.12
- 384 tests (372 active + 12 skipped)

## Target

- Jest 30.x with matching ts-jest
- `@types/jest` 30.x

## Planned Work

### 1. Check ts-jest compatibility
- Verify ts-jest has a stable release supporting Jest 30
- If not available yet, defer this task

### 2. Update packages
- `jest` ^29.7.0 → ^30.x
- `ts-jest` ^29.4.6 → matching 30.x version
- `@types/jest` ^29.5.12 → ^30.x

### 3. Fix breaking changes
- Check Jest 30 migration guide for config changes
- Update `jest.config.js` if needed
- Fix any deprecated API usage in tests

## Acceptance Criteria

- [ ] Jest 30.x installed
- [ ] ts-jest compatible version installed
- [ ] All 384 tests pass
- [ ] Coverage thresholds still met
- [ ] `npm run build` succeeds
