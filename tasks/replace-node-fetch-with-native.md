# Task: Replace node-fetch with Native fetch()

## Priority: Medium | Effort: Small (1-2 hours)

## Current State

- `node-fetch` v2.2.0 (CommonJS)
- `@types/node-fetch` v2.5.6
- Project requires Node >= 22.14.0 which has native `fetch()` built-in
- node-fetch v3 is ESM-only and incompatible with this CommonJS project

## Target

- Remove `node-fetch` and `@types/node-fetch` dependencies entirely
- Use Node.js built-in `fetch()` API (available since Node 18, stable in Node 22)

## Planned Work

### 1. Update `src/helpers/fetch.ts`
- Remove `import nodeFetch from 'node-fetch'`
- Replace `nodeFetch()` calls with native `fetch()`
- Native fetch returns `Response` (Web API), not `node-fetch.Response`
- Adjust type imports accordingly

### 2. Remove packages
- `npm uninstall node-fetch @types/node-fetch`

### 3. Update TypeScript config
- Ensure `lib` includes `"DOM"` or use `@types/node` which includes fetch types in Node 22+

### 4. Verify all fetch usage
- `src/helpers/fetch.ts` — main fetch wrapper (`fetchPost`, `fetchGetWithinPage`, etc.)
- Check if any scrapers import node-fetch directly

## Acceptance Criteria

- [ ] `node-fetch` and `@types/node-fetch` removed from package.json
- [ ] All fetch calls use native `fetch()` API
- [ ] TypeScript compiles without errors
- [ ] All tests pass
- [ ] `npm run build` succeeds
