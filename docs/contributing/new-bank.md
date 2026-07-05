# Adding a new bank

Pipeline-first — every new bank lives under `src/Scrapers/Pipeline/Banks/<Name>/` and is registered in `PIPELINE_REGISTRY`. Legacy `src/Scrapers/<Name>/` is closed to new banks.

## Step-by-step

### 1. Add the enum entry

Edit [`src/Definitions.ts`](https://github.com/sergienko4/israeli-bank-scrapers/blob/{{BRANCH}}/src/Definitions.ts):

```typescript
export enum CompanyTypes {
  // ... existing entries ...
  NewBank = 'newBank',
}

export const SCRAPERS = {
  // ... existing entries ...
  [CompanyTypes.NewBank]: {
    name: 'New Bank',
    loginFields: ['username', PASSWORD_FIELD], // declarative
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
    { credentialKey: 'username', selectors: [] }, // resolved via shared LoginWK
    { credentialKey: 'password', selectors: [] },
  ],
  submit: [],
  possibleResults: { success: [] },
};
```

**Prefer empty `selectors: []`.** The generic Well-Known login dictionary
([`Registry/WK/LoginWK.ts`](https://github.com/sergienko4/israeli-bank-scrapers/blob/{{BRANCH}}/src/Scrapers/Pipeline/Registry/WK/LoginWK.ts))
resolves each field by visible text / `aria-label` / semantic HTML — never a CSS
selector in the bank config (the ZERO-CSS-selectors rule). If a field is not
matched (e.g. an `aria-label`-only input with an empty placeholder, like Yahav's
`#pinno` national-ID field), **add the value to the shared `LoginWK` slot** — do
not put a bank-specific selector here. See [Bank Yahav](../banks/yahav.md) for a
three-field WK-resolved login.

### 4. Write the pipeline builder

Create `src/Scrapers/Pipeline/Banks/<NewBank>/<NewBank>Pipeline.ts`:

```typescript
import { createPipelineBuilder } from '../../Core/Builder/PipelineBuilderFactory.js';
import { NEWBANK_LOGIN } from './NewBankLoginConfig.js';

export function buildNewBankPipeline(options: ScraperOptions): Procedure<IPipelineDescriptor> {
  return (
    createPipelineBuilder()
      .withOptions(options)
      .withBrowser()
      .withDeclarativeLogin(NEWBANK_LOGIN)
      // optional: .withOtpTrigger().withOtpFill() etc.
      .build()
  );
}
```

### 5. Register the builder

Add the entry to the matching alphabetical-half registry in the **Banks**
layer (never Core) — [`Banks/PipelineRegistryAmexToMax.ts`](https://github.com/sergienko4/israeli-bank-scrapers/blob/{{BRANCH}}/src/Scrapers/Pipeline/Banks/PipelineRegistryAmexToMax.ts)
for banks Amex–Max, or [`Banks/PipelineRegistryMercantileToVisaCal.ts`](https://github.com/sergienko4/israeli-bank-scrapers/blob/{{BRANCH}}/src/Scrapers/Pipeline/Banks/PipelineRegistryMercantileToVisaCal.ts)
for banks Mercantile–VisaCal:

```typescript
import { buildNewBankPipeline } from './NewBank/NewBankPipeline.js';

const PIPELINE_REGISTRY_AMEX_TO_MAX: Partial<Record<CompanyTypes, PipelineFactory>> = {
  // ... existing entries ...
  [CompanyTypes.NewBank]: buildNewBankPipeline,
};
```

> The Core layer never enumerates banks — `Core/PipelineDescriptor.ts` only
> declares the `PipelineFactory` type, and `Banks/PipelineRegistry.ts` merges
> the two halves into `PIPELINE_REGISTRY`. The `CoreBankIndependence`
> architecture test fails if a bank import leaks into `Core/**`.

### 6. Add the mocked-E2E test

Create `src/Tests/E2eMocked/<NewBank>/<NewBank>.e2e-mocked.test.ts` that:

1. Loads the fixtures from step 2 via `BankFixtureLoader`.
2. Constructs the scraper.
3. Asserts `result.success === true` + expected account count + sample txn.

The existing [`Amex.e2e-mocked.test.ts`](https://github.com/sergienko4/israeli-bank-scrapers/blob/{{BRANCH}}/src/Tests/E2eMocked/Amex.e2e-mocked.test.ts) is the template.

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
return createPipelineBuilder()
  .withOptions(options)
  .withBrowser()
  .withDeclarativeLogin(NEWBANK_LOGIN)
  .withOtpTrigger()
  .withOtpFill()
  .build();
```

See [Phases → OTP-TRIGGER](../phases/otp-trigger.md) / [OTP-FILL](../phases/otp-fill.md).

## Adding an api-direct bank

For banks with a JSON API (no browser), use `.withApiDirectCall(...)` + `.withApiDirectScrape(...)` instead of `.withBrowser()`. See [Phases → API-DIRECT-CALL](../phases/api-direct-call.md) for the primitives (signer config, JsonValueTemplate, carry derivation, phone normaliser).
