# Part 8: Documentation

## Goal
Update all documentation to reflect Playwright migration. Remove all Puppeteer references.

## Files to Modify

### `CLAUDE.md`

- **Tooling Stack**: `Puppeteer 24` → `Playwright 1.58+`
- **Key Files section**:
  - `src/helpers/browser.ts` — update description: "context options builder (Hebrew UA/locale, client hints)" instead of "manual stealth overrides"
  - Remove references to stealth, retry backoff, Cloudflare challenge handling
- **Anti-Detection section**: Update to explain Playwright's native WAF bypass
- **Changes from upstream section**: Update all bullet points about anti-detection

### `README.md`

Search and update all Puppeteer references (approximately lines 73, 241, 244, 246, 262, 296, 364):
- `puppeteer` → `playwright` in dependency/setup instructions
- Browser option documentation updates
- Note about `npx playwright install chromium` requirement
- Note about breaking change in v7.0.0 (external browser/browserContext options)

### `MEMORY.md` (auto-memory)

- Update "Tooling Stack" entry: `Puppeteer 24` → `Playwright 1.58+`
- Update "Anti-Detection" section

## Validation
```bash
# Verify no stale Puppeteer references in docs:
grep -ri "puppeteer" CLAUDE.md README.md
# Expected: only in historical context (e.g., "migrated from Puppeteer") or CHANGELOG

# Final comprehensive check across entire repo:
grep -r "puppeteer" --include="*.ts" --include="*.yml" --include="*.js" src/ .github/ utils/ 2>/dev/null
# Expected: EMPTY (zero references)
```

## Final Full Validation (all parts complete)

```bash
# 1. Build
npm run type-check               # 0 errors
npm run lint                     # 0 warnings, 0 errors
npm test                         # all tests pass, coverage thresholds met
npm run build                    # compiles cleanly

# 2. E2E
npx playwright install chromium
npx jest --testPathPatterns='e2e-mocked' --testPathIgnorePatterns='/node_modules/' --verbose   # pass

# 3. No puppeteer anywhere
npm ls puppeteer 2>&1            # not found
grep -r "from 'puppeteer'" src/  # EMPTY
grep -r "puppeteer" .github/     # EMPTY

# 4. Package exports
npm run build && node -e "const m = require('./lib'); console.log(Object.keys(m))"
# Should include createScraper, CompanyTypes, SCRAPERS — NOT getPuppeteerConfig
```

## Expected State After
- All documentation reflects Playwright
- README has migration notes for v7.0.0
- Zero stale Puppeteer references anywhere in the repo (except CHANGELOG history)
