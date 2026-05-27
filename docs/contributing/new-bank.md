# Adding a new bank

Pipeline-first — every new bank lives under `src/Scrapers/Pipeline/Banks/<Name>/` and is registered in `PIPELINE_REGISTRY`. Legacy `src/Scrapers/<Name>/` is closed to new banks.

## Step-by-step

### 1. Add the enum entry

Edit [`src/Definitions.ts`](https://github.com/sergienko4/israeli-bank-scrapers/blob/main/src/Definitions.ts):

```typescript
export enum CompanyTypes {
  // ... existing entries ...
  NewBank = 'newBank',
}

export const SCRAPERS = {
  // ... existing entries ...
  [CompanyTypes.NewBank]: {
    name: 'New Bank',
    loginFields: ['username', PASSWORD_FIELD],   // declarative
  },
};
```

### 2. Capture a real-bank network trace

Run a manual scrape against your account once and capture the HTTP traffic (browser DevTools → Network → Save All as HAR, or use `mitmproxy`). You need:

- The login form HTML (post-auth redirect URLs, hidden fields)
- The post-login account-discovery endpoint (URL + response body)
- The per-account txn endpoint (URL + body template)
- The balance endpoint (URL + body template + per-card response shape)

Save these under `src/Tests/E2eMocked/<NewBank>/fixtures/`.

### 3. Write the declarative LoginConfig

Create `src/Scrapers/Pipeline/Banks/<NewBank>/<NewBank>LoginConfig.ts`:

```typescript
import type { ILoginConfig } from '../../../Base/Interfaces/Config/LoginConfig.js';

export const NEWBANK_LOGIN: ILoginConfig = {
  loginUrl: 'https://newbank.example/login',
  fields: [
    { name: 'username', kind: 'textContent', value: 'שם משתמש' },     // Hebrew label
    { name: 'password', kind: 'placeholder', value: 'סיסמה' },
  ],
  submit: { kind: 'textContent', value: 'כניסה' },
  possibleResults: {
    [ScraperErrorTypes.InvalidPassword]: { kind: 'textContent', value: 'פרטים שגויים' },
    // ... etc
  },
};
```

### 4. Write the pipeline builder

Create `src/Scrapers/Pipeline/Banks/<NewBank>/<NewBank>Pipeline.ts`:

```typescript
import { PipelineBuilder } from '../../Core/Builder/PipelineBuilder.js';
import { NEWBANK_LOGIN } from './NewBankLoginConfig.js';

export function buildNewBankPipeline(options: ScraperOptions): Procedure<IPipelineDescriptor> {
  return PipelineBuilder.create(options)
    .withBrowser()
    .withLogin(NEWBANK_LOGIN)
    // optional: .withOtpFill(...).withPreLogin(...) etc.
    .build();
}
```

### 5. Register the builder

Edit [`src/Scrapers/Pipeline/Core/PipelineRegistry.ts`](https://github.com/sergienko4/israeli-bank-scrapers/blob/main/src/Scrapers/Pipeline/Core/PipelineRegistry.ts):

```typescript
import { buildNewBankPipeline } from '../Banks/NewBank/NewBankPipeline.js';

const PIPELINE_REGISTRY: Partial<Record<CompanyTypes, PipelineFactory>> = {
  // ... existing entries ...
  [CT.NewBank]: buildNewBankPipeline,
};
```

### 6. Add the mocked-E2E test

Create `src/Tests/E2eMocked/<NewBank>/<NewBank>.e2e-mocked.test.ts` that:

1. Loads the fixtures from step 2 via `BankFixtureLoader`.
2. Constructs the scraper.
3. Asserts `result.success === true` + expected account count + sample txn.

The existing [`Amex.e2e-mocked.test.ts`](https://github.com/sergienko4/israeli-bank-scrapers/blob/main/src/Tests/E2eMocked/Amex/Amex.e2e-mocked.test.ts) is the template.

### 7. Verify

```sh
npm run test:e2e:mock -- --testPathPatterns=NewBank
npm run lint                      # eslint + architecture + canaries
npm run test:pipeline             # coverage gates
npm run test:e2e:real:single -- --testPathPatterns=NewBank   # requires .env credentials
```

### 8. Open the PR

Conventional Commit subject: `feat(banks): add NewBank pipeline scraper`. The pre-commit hook runs everything; CI re-runs it. Squash-merge once green.

## Adding OTP support

If your bank needs OTP:

```typescript
return PipelineBuilder.create(options)
  .withBrowser()
  .withLogin(NEWBANK_LOGIN)
  .withOtpTrigger(NEWBANK_OTP_TRIGGER_CONFIG)
  .withOtpFill(NEWBANK_OTP_FILL_CONFIG)
  .build();
```

See [Phases → OTP-TRIGGER](../phases/otp-trigger.md) / [OTP-FILL](../phases/otp-fill.md).

## Adding an api-direct bank

For banks with a JSON API (no browser), use `.withApiDirectCall(...)` + `.withApiDirectScrape(...)` instead of `.withBrowser()`. See [Phases → API-DIRECT-CALL](../phases/api-direct-call.md) for the primitives (signer config, JsonValueTemplate, carry derivation, phone normaliser).
