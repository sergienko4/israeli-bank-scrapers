# Advanced usage

## Parallel scraping

Each `createScraper` instance uses its own HTTP mediator. No browser process
is started or shared. Run banks side by side with `Promise.allSettled`, while
respecting the bank's session and rate limits.

```typescript
const results = await Promise.allSettled(
  banks.map(async ({ companyId, credentials }) =>
    createScraper({ companyId, startDate }).scrape(credentials),
  ),
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
```

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

HTTP transports own request deadlines; `otpTimeoutMs` bounds the OTP callback.
The executor does not repeat failed phases, which could resend an SMS or
resubmit authentication. Transport-level connection retry policies are
separate; see [Headless transports](architecture/pipeline.md#headless-transports).

`defaultTimeout` and `navigationRetryCount` were browser options and have been
removed. See [Compatibility](compatibility.md) before upgrading older callers.

## Migrating from upstream `israeli-bank-scrapers`

```diff
- npm install israeli-bank-scrapers
+ npm install @sergienko4/israeli-bank-scrapers
```

`createScraper` and `CompanyTypes` remain the entry points. Both `import` and
`require()` work, but browser options and types were removed in v10; this is
a breaking change. Follow the [compatibility notes](compatibility.md).

Two differences worth knowing:

- **Type names gained an `I` prefix** (`IScraper`, `IScraperScrapingResult`).
  The old names remain exported as aliases, so existing code compiles as-is.
- **`accounts[].balance` is now always populated** — by `API-DIRECT-SCRAPE.final`
  for every pipeline bank. Code that already read `account.balance` keeps
  working unchanged.

For the architectural differences behind those changes, see
[Migration strategy](architecture/migration.md).
