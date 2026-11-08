# Advanced usage

## Parallel scraping

Each `createScraper` instance is independent: it launches (or, for a browserless
bank, skips) its own browser and shares no state with the others. Run several
banks side by side with `Promise.allSettled`.

> **No shared browser.** `browser` and `browserContext` are read by no scraper —
> the [legacy](architecture/legacy.md) launcher that honoured them was removed.
> Every Pipeline scrape that needs a browser launches and closes its own Camoufox
> instance, so the lever is concurrency, not sharing: each scrape in flight holds
> its own ~1.3 GB browser process, so cap how many run at once. Banks that never
> open a browser hold no such process — see
> [Browser lifecycle options](configuration.md#browser-lifecycle-options).

```typescript
const results = await Promise.allSettled(
  banks.map(({ companyId, credentials }) =>
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

```typescript
createScraper({
  companyId: CompanyTypes.Leumi,
  startDate,
  defaultTimeout: 60000,
});
```

`defaultTimeout` bounds **each phase** independently, not the run as a whole.

!!! warning "`navigationRetryCount` does nothing"
    `navigationRetryCount` once retried a phase that failed with `TIMEOUT`, but
    the [legacy](architecture/legacy.md) scraper that read it was removed.
    Every bank ignores it — including Leumi, above — and `createScraper`
    emits a `ScraperOptionsWarning` when you pass one. See
    [Options the Pipeline ignores](configuration.md#options-the-pipeline-ignores).

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
