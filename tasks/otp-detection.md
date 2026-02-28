# Task: Dynamic OTP Detection — Default Layer for All Scrapers

## Priority: High | Effort: Medium (half day)

## Current State

Beinleumi (and potentially other banks) added mandatory SMS OTP after the password step.
The scraper fails silently — it times out waiting for the dashboard selector (`#card-header`)
while the browser is sitting on the OTP selection/entry screen.

Screenshot confirms: credentials are **correct**, OTP screen appears after password login.

The `BeinleumiGroupBaseScraper` (and any other bank that adds OTP) has no way to:
1. Detect that an OTP screen appeared
2. Trigger/request the OTP code
3. Enter the code and continue

## Target

Add an **automatic, bank-agnostic OTP detection gate** inside `BaseScraperWithBrowser.login()`.
After the login form is submitted, before `postAction`, check if an OTP screen appeared.

- If yes + `options.otpCodeRetriever` provided → fill code, submit, continue
- If yes + no retriever → immediately return `TwoFactorRetrieverMissing` with screenshot path
- If no OTP screen → proceed exactly as before (zero performance impact on non-OTP banks)

**Zero bank-specific code required.** Works for any bank that adds OTP.

## Resolution Chain (already exists for form fields, extend to OTP)

```
After submit button click:
  1. detectByText(page)    — scan body text for Hebrew/English OTP keywords
  2. detectByInputField()  — resolveFieldContext(page, {credentialKey:'otpCode'})
                             uses existing WELL_KNOWN_SELECTORS.otpCode
  ↓ OTP detected?
  NO  → return null → continue to postAction (normal flow, ~50ms overhead)
  YES → otpCodeRetriever in options?
         NO  → TwoFactorRetrieverMissing + screenshot path in errorMessage
         YES → clickOtpTriggerIfPresent()   (handle SMS selection screen)
               → extractPhoneHint()
               → retriever(phoneHint)        (await user callback)
               → resolveFieldContext(otpCode) → fillInput
               → findOtpSubmitSelector() → clickButton
               → return null → continue to postAction
```

## New Files to Create

### `src/helpers/otp-detector.ts`
```typescript
// OTP text patterns — Hebrew + English, sorted most-specific first
const OTP_TEXT_PATTERNS = [
  'סיסמה חד פעמית', 'קוד חד פעמי', 'אימות זהות',
  'בחר טלפון', 'לצורך אימות', 'שלח קוד',
  'קוד SMS', 'קוד אימות',
  'one-time password', 'OTP', 'SMS code',
];

export async function detectOtpScreen(page: Page): Promise<boolean>
// Returns true if body text contains any OTP pattern OR resolveFieldContext(otpCode) succeeds

export async function extractPhoneHint(page: Page): Promise<string>
// Extracts masked phone like "******5100" from page text

export async function findOtpSubmitSelector(page: Page): Promise<string | null>
// Tries: //button[contains(.,"אשר"/"שלח"/"המשך"/"כניסה")], button[type="submit"]
// Uses tryInContext() — needs to be exported from selector-resolver.ts

async function clickOtpTriggerIfPresent(page: Page): Promise<void>
// Clicks SMS button on selection screens (before the OTP entry screen appears)
// Tries: //button[contains(.,"SMS")], input[type="radio"], ariaLabel="שלח SMS"
```

### `src/helpers/otp-handler.ts`
```typescript
export async function handleOtpStep(
  page: Page,
  options: ScraperOptions,
): Promise<ScraperScrapingResult | null>
// null = no OTP screen detected (continue normal flow)
// ScraperScrapingResult = OTP screen detected (either handled or error)
```

### `src/tests/e2e-mocked/otp-detection.e2e-mocked.test.ts`
4 tests:
1. OTP screen detected, no retriever → `TwoFactorRetrieverMissing` + screenshot path
2. OTP screen detected, retriever provided → fills code → login succeeds
3. Normal login (no OTP) → zero change to behavior (regression guard)
4. `detectByText` false-positive guard (login error page with no OTP patterns → false)

### `src/helpers/otp-detector.test.ts`
Fast unit tests (mock page, no browser):
- `detectOtpScreen` with Hebrew text match
- `detectOtpScreen` with OTP input field match
- `detectOtpScreen` returns false on normal login error
- `extractPhoneHint` extracts `******5100`
- `findOtpSubmitSelector` finds אשר, המשך, submit buttons

## Files to Modify

### `src/scrapers/interface.ts`
Add optional `otpCodeRetriever` to `ScraperOptions`:
```typescript
otpCodeRetriever?: (phoneHint: string) => Promise<string>;
```

### `src/scrapers/base-scraper-with-browser.ts`
Insert 3 lines in `login()` between `emitProgress(LoggingIn)` and `postAction`:
```typescript
const otpResult = await handleOtpStep(this.page, this.options);
if (otpResult !== null) return otpResult;
```

### `src/helpers/selector-resolver.ts`
1. Export `tryInContext` (needed by `findOtpSubmitSelector`)
2. Add `'סיסמה חד פעמית'` to `WELL_KNOWN_SELECTORS.otpCode`

## Beinleumi-Specific Note

Beinleumi has TWO OTP sub-screens:
1. **Phone selection** — "בחר טלפון" + [הודעה קולית] [SMS] buttons + "שלח"
2. **Code entry** — OTP input + "אשר" button

`clickOtpTriggerIfPresent()` handles screen 1 (clicks SMS button).
`resolveFieldContext(otpCode)` handles finding the input on screen 2.
`findOtpSubmitSelector()` finds "אשר" on screen 2.

## Backward Compatibility

| Scenario | Impact |
|---|---|
| Banks without OTP | `detectByText` runs once (~50ms), returns false, zero behavior change |
| Bank adds OTP, no `otpCodeRetriever` | Was: 30s timeout. Now: immediate `TwoFactorRetrieverMissing` error + screenshot |
| Bank adds OTP, `otpCodeRetriever` provided | New: code filled automatically, scrape continues |
| OneZero (API OTP, uses `BaseScraper`) | Not affected — never calls `login()` in `BaseScraperWithBrowser` |

## Test-First Acceptance Criteria

Tests must be written and passing **before** any implementation is merged.

### Unit tests — `src/helpers/otp-detector.test.ts` (fast, no browser)

- [ ] `detectOtpScreen` → `true` when body text contains `'סיסמה חד פעמית'`
- [ ] `detectOtpScreen` → `true` when body text contains `'לצורך אימות זהותך'` (Beinleumi exact phrase)
- [ ] `detectOtpScreen` → `true` when OTP input field present (`placeholder*="קוד חד פעמי"`)
- [ ] `detectOtpScreen` → `false` on login error page (`'שם משתמש שגוי'`, no OTP keywords)
- [ ] `detectOtpScreen` → `false` on normal login page (empty of OTP text)
- [ ] `extractPhoneHint` → returns `'******5100'` when page text contains it
- [ ] `extractPhoneHint` → returns `''` when no phone pattern in page
- [ ] `findOtpSubmitSelector` → finds `//button[contains(.,"אשר")]`
- [ ] `findOtpSubmitSelector` → finds `//button[contains(.,"המשך")]`
- [ ] `findOtpSubmitSelector` → finds `button[type="submit"]` as last resort
- [ ] `findOtpSubmitSelector` → returns `null` when no button found

### Mocked e2e tests — `src/tests/e2e-mocked/otp-detection.e2e-mocked.test.ts`

Realistic HTML fixtures required for each test (not minimal stubs):

#### Test 1: Phone-selection screen → no retriever → `TwoFactorRetrieverMissing`
- HTML mirrors Beinleumi's actual OTP selection screen:
  `"לצורך אימות זהותך, יש לבחור טלפון לקבלת סיסמה חד פעמית"` + SMS/voice buttons + phone hint `*****5100` + "שלח"
- No `otpCodeRetriever` in options
- Assert: `result.errorType === TwoFactorRetrieverMissing`
- Assert: `result.errorMessage` contains `'otpCodeRetriever'` and `'Screenshot saved to'`

#### Test 2: OTP code entry screen → retriever provided → code filled → dashboard reached
- HTML: OTP input `<input placeholder="קוד חד פעמי">` + `<button>אשר</button>` with onclick to dashboard URL
- `otpCodeRetriever` spy returns `'123456'`
- Assert: `result.success === true`
- Assert: spy called with phone hint string (any string)
- Assert: `fillInput` called with `'123456'`

#### Test 3: Phone selection + code entry (two-screen flow — Beinleumi realistic)
- Screen 1: phone selection page (SMS button + שלח)
- Screen 2 (after clicking שלח): OTP input page
- `otpCodeRetriever` returns `'654321'`
- Assert: SMS button was clicked (screen 1 → screen 2 transition)
- Assert: OTP filled on screen 2
- Assert: `result.success === true`

#### Test 4: Normal login (no OTP) — zero regression
- Standard login page (no OTP keywords, no OTP inputs)
- Success URL in `possibleResults`
- Assert: `result.success === true`
- Assert: no timeout or extra latency (OTP check fast-paths out via text check)

#### Test 5: Login error page — false-positive guard
- Page shows `'שם משתמש שגוי. ניסיון 2 מתוך 3'` (wrong username, attempt 2 of 3)
- No OTP patterns on page
- Assert: `detectOtpScreen` never triggered (or returns false)
- Assert: `result.errorType === InvalidPassword` (normal login failure)

#### Test 6: OTP inside iframe
- Main page has no OTP text; iframe contains `<input placeholder="קוד אימות">`
- Assert: Round 4 iframe search in `detectByInputField` finds it
- Assert: OTP filled correctly inside iframe

### Regression tests (existing tests must still pass)
- [ ] All 394 unit tests pass
- [ ] All 19 existing mocked e2e tests pass (no behavior change for non-OTP banks)
- [ ] All 8 selector-fallback real e2e tests pass in parallel

### Performance guard
- [ ] Non-OTP bank scrape adds ≤ 200ms overhead (text check only, no selector search if text passes)
  - `detectByText` runs first; if false only then runs `detectByInputField`
  - `detectByInputField` uses `CANDIDATE_TIMEOUT_MS = 2000` per candidate but only 6 candidates total

## Insertion Point in `login()` (base-scraper-with-browser.ts)

```typescript
  ...
  this.emitProgress(ScraperProgressTypes.LoggingIn);  // ← existing line ~311

  // [NEW] OTP interception — automatic for all DOM banks
  const otpResult = await handleOtpStep(this.page, this.options);
  if (otpResult !== null) return otpResult;

  if (loginOptions.postAction) {                       // ← existing line ~313
  ...
```
