# Advanced usage

## Parallel scraping with a shared browser

Launching one Camoufox instance and giving each bank its own
`BrowserContext` avoids paying the ~1.3 GB browser startup cost per bank, while
keeping cookies and storage isolated between them.

```typescript
import { Camoufox } from '@hieutran094/camoufox-js';

const browser = await Camoufox({ headless: true });
try {
  const results = await Promise.allSettled(
    banks.map(async ({ companyId, credentials }) => {
      const ctx = await browser.newContext();
      try {
        const scraper = createScraper({ companyId, startDate, browserContext: ctx });
        return await scraper.scrape(credentials);
      } finally {
        await ctx.close();
      }
    }),
  );

  results.forEach((result, i) => {
    const { companyId } = banks[i];
    if (result.status === 'rejected') {
      console.error(companyId, 'threw', result.reason);
    } else if (!result.value.success) {
      console.error(companyId, 'failed', result.value.errorType, result.value.errorMessage);
    } else {
      console.log(companyId, (result.value.accounts ?? []).length, 'accounts');
    }
  });
} finally {
  await browser.close();
}
```

Both `finally` blocks matter. Without the inner one a rejected scrape leaks its
context — and because `Promise.allSettled` waits for every entry, that context
would stay open for the rest of the run. Without the outer one a throw anywhere
leaves the ~1.3 GB browser process alive.

`allSettled` rather than `all` because one bank failing should not discard the
results of the banks that succeeded. That leaves two failure shapes to handle,
as the loop above does: `status: 'rejected'` when the scrape threw, and
`status: 'fulfilled'` carrying `value.success === false` when it returned a
handled error such as `INVALID_PASSWORD`.

!!! warning "Parallelism raises WAF risk"
    Several banks fingerprint concurrent sessions from one IP. If parallel runs
    start returning `WAF_BLOCKED` where serial runs do not, stagger them by
    2–5 s or reduce the width. See [Troubleshooting](troubleshooting.md#waf_blocked).

Amex and Isracard must not run concurrently against the same customer session —
Amex has to finish before Isracard logs in. The real-E2E orchestrator encodes
this in its `WORKER_GROUPS` map; mirror that constraint if you build your own
scheduler.

## Timeout and retry configuration

```typescript
createScraper({
  companyId: CompanyTypes.Leumi,
  startDate,
  defaultTimeout: 60000,
  navigationRetryCount: 2,
});
```

`defaultTimeout` bounds **each phase** independently, not the run as a whole.
`navigationRetryCount` retries a phase that failed with `TIMEOUT`; it does not
retry authentication failures, which are terminal by design.

## Migrating from upstream `israeli-bank-scrapers`

```diff
- npm install israeli-bank-scrapers
+ npm install @sergienko4/israeli-bank-scrapers
```

The public API is unchanged: same `createScraper`, same `companyId`, same
credential shapes. Both `import` and `require()` work.

Two differences worth knowing:

- **Type names gained an `I` prefix** (`IScraper`, `IScraperScrapingResult`).
  The old names remain exported as aliases, so existing code compiles as-is.
- **`accounts[].balance` is now always populated** — by `API-DIRECT-SCRAPE.final`
  for every pipeline bank. Code that already read `account.balance` keeps
  working unchanged.

For the architectural differences behind those changes, see
[Migration strategy](architecture/migration.md).
