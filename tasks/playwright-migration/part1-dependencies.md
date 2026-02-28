# Part 1: Dependencies & Cleanup

## Goal
Remove Puppeteer, keep Playwright, remove `getPuppeteerConfig()`, delete unused utility scripts.

## Files to Modify

### `package.json`
- Remove `"puppeteer": "24.37.5"` from `dependencies`
- Keep `"playwright": "^1.58.2"` in `dependencies`
- Run `npm install` to update lockfile

### `src/index.ts`
Remove `getPuppeteerConfig()` export (lines 17-19):
```ts
// DELETE these lines:
export function getPuppeteerConfig() {
  return { chromiumRevision: '1250580' };
}
```

### Delete utility scripts (inherited from upstream, unused by fork)
- `utils/prepare-israeli-bank-scrapers-core.js`
- `utils/jscodeshift/index.js`
- `utils/jscodeshift/puppeteer-imports.js`
- `utils/core-utils.js` (if exists)

## Validation
```bash
npm install                         # succeeds
npm ls puppeteer 2>&1               # not found
npm ls playwright                   # shows playwright@1.58.x
node -e "const p = require('./src/index.ts'); console.log(typeof p.getPuppeteerConfig)"  # should error (not built yet)
```

## Expected State After
- `node_modules/puppeteer` does NOT exist
- `node_modules/playwright` exists
- TypeScript compilation will fail (many files still import from 'puppeteer') — expected
