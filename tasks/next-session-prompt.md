# Next Session Start Prompt

Copy-paste this at the start of a new Claude Code session:

---

## Resuming israeli-bank-scrapers-fork — Feb 2026

**Repo:** `c:\Code\israeli-bank-scrapers-fork`
**Branch:** `fix/browser-version-mismatch-warning` → **PR #63 open**, not yet merged
**Package:** `@sergienko4/israeli-bank-scrapers` v7.0.1

### What was completed last session

1. **PR #61** (merged): fetchPostWithinPage error surfacing + Amex errorMessage fixes
2. **PR #63** (open, needs merge): Major architecture — GenericBankScraper + BANK_REGISTRY
   - All 14 DOM bank scrapers now extend `GenericBankScraper` using `BANK_REGISTRY` config
   - 4-round selector resolution in every login (CSS → display names → WELL_KNOWN_SELECTORS → iframes)
   - `scripts/inspect-bank-login.ts` CLI for detecting bank login fields
   - 8 real e2e selector-fallback tests across 6 banks (run: `npx jest --testPathPatterns='selector-fallback.*e2e-real' --maxWorkers=6`)
   - 416 unit tests + 19 mocked e2e tests all pass

3. **Discovered**: Beinleumi now requires SMS OTP after password — task documented in `tasks/otp-detection.md`

### Immediate next tasks (priority order)

**Task 1 — Merge PR #63**
```bash
gh pr view 63  # check CI status
# if green → squash merge to main → release-please creates release PR
```

**Task 2 — OTP Detection** (`tasks/otp-detection.md`)
- **Test-first**: write `src/helpers/otp-detector.test.ts` (11 unit tests) + `src/tests/e2e-mocked/otp-detection.e2e-mocked.test.ts` (6 tests) BEFORE implementation
- Implementation: 3 new files + 3-line insertion in `login()` in `base-scraper-with-browser.ts`
- Screenshot confirmed: Beinleumi shows "לצורך אימות זהותך, יש לבחור טלפון לקבלת סיסמה חד פעמית"

**Task 3 — Dead Code CI** (`tasks/dead-code-detection.md`)
- Add `ts-unused-exports` + `no-duplicate-imports` ESLint rule to CI

**Task 4 — Investigate Max**
- Max login returns TIMEOUT — login flow has changed since our test
- Run: `npx jest --testPathPatterns='max.e2e-real' --testPathIgnorePatterns='/node_modules/'`

### Key files to know
- `src/scrapers/bank-registry.ts` — login configs for all 14 DOM banks
- `src/scrapers/generic-bank-scraper.ts` — GenericBankScraper + ConcreteGenericScraper
- `src/helpers/selector-resolver.ts` — resolveFieldContext (4 rounds) + tryInContext
- `src/scrapers/base-scraper-with-browser.ts` — activeLoginContext, fillInputs with resolver
- `tasks/otp-detection.md` — full OTP plan with test specs
- `tasks/dead-code-detection.md` — CI dead code detection plan

### Run commands
```bash
npm test                                                           # 416 unit tests
npx jest --testPathPatterns='e2e-mocked' ...                      # 19 mocked e2e
npx jest --testPathPatterns='selector-fallback.*e2e-real' --maxWorkers=6  # 8 real e2e (88s)
npm run build                                                      # lint + tsc + babel
```

### .env credentials (already set)
Amex, VisaCal, Discount, Isracard — working
Beinleumi — blocked by OTP
Max — TIMEOUT (login changed)
OneZero — needs live OTP code at runtime
