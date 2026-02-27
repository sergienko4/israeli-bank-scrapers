# Part 7: CI/CD Workflows

## Goal
Update GitHub Actions workflows to install Playwright browser instead of Chrome, remove Puppeteer env vars.

## Files to Modify

### `.github/workflows/nodeCI.yml`

**`build` job** — replace Chrome setup with Playwright:

```yaml
# REMOVE this step (around line 100):
- name: Setup Chrome
  uses: browser-actions/setup-chrome@4f8e94349a351df0f048634f25fec36c3c91eded # v2

# ADD after 'npm ci' step:
- name: Install Playwright Chromium
  run: npx playwright install chromium --with-deps
```

Note: The `test` job does NOT need Playwright browser (unit tests are fully mocked).
The `lint`, `type-check`, `security`, `dependency-review`, `audit` jobs also don't need it.

---

### `.github/workflows/e2e.yml`

**All 3 jobs** (`e2e-smoke`, `e2e-mocked`, `e2e-real`) — same change:

```yaml
# REMOVE from each job (lines 31, 49, 68):
- name: Setup Chrome
  uses: browser-actions/setup-chrome@4f8e94349a351df0f048634f25fec36c3c91eded # v2

# ADD after 'npm ci' in each job:
- name: Install Playwright Chromium
  run: npx playwright install chromium --with-deps

# REMOVE env var from each job (lines 37, 55, 74):
PUPPETEER_HEADLESS: 'true'
```

## Validation
```bash
# Local validation — just verify YAML syntax:
grep -r "puppeteer\|setup-chrome" .github/workflows/
# Expect: EMPTY (zero references)

grep -r "playwright install" .github/workflows/
# Expect: 4 matches (1 in nodeCI.yml, 3 in e2e.yml)
```

Full CI validation happens when the PR is pushed.

## Expected State After
- CI uses `npx playwright install chromium --with-deps` instead of `browser-actions/setup-chrome`
- No `PUPPETEER_HEADLESS` env var
- No references to puppeteer in any workflow file
