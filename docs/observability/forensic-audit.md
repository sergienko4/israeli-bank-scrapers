# Forensic audit

API-DIRECT-SCRAPE emits a **per-account audit line** during `.post`.
The line answers "did this run collect transactions for this account?"
without rerunning a live bank.

| Source | [`src/Scrapers/Pipeline/Mediator/Scrape/ForensicAuditAction.ts`](https://github.com/sergienko4/israeli-bank-scrapers/blob/{{BRANCH}}/src/Scrapers/Pipeline/Mediator/Scrape/ForensicAuditAction.ts) |
| ------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |

## What it looks like in `pipeline.log`

```
--- Account ***6789 | 42 txns ---
--- Account ***5432 | 0 txns ---
--- Account ***9981 | 18 txns ---
```

| Element       | Source                                                        |
| ------------- | ------------------------------------------------------------- |
| Account label | `redactAccount(accountNumber)` — the central redaction policy |
| `N txns`      | `scrape.accounts[i].txns.length`                              |

Every bank uses [`API-DIRECT-SCRAPE.post`](../phases/api-direct-scrape.md).
The audit also emits a mirror check, window-completeness diagnostics and a
redacted transaction preview at debug level. Account/amount/merchant output
uses the central [redaction policy](redaction.md).

## Why it's load-bearing

When a scrape result comes back "empty", the first question is always: **did we get 0 transactions per account, or 0 accounts entirely?** The forensic audit answers it directly:

| What you see                | What it means                                                         | Where to look next                                                                 |
| --------------------------- | --------------------------------------------------------------------- | ---------------------------------------------------------------------------------- |
| No account lines            | The run did not reach account auditing, or no accounts were available | Inspect authentication/action failures and the universal zero-account result guard |
| Zero txns for one account   | Legitimately empty window or incomplete collection                    | Inspect the account's window-completeness diagnostics                              |
| Zero txns for every account | May be legitimate; may indicate degraded authentication/data          | Inspect coverage and the bank's result guard; the count alone cannot decide        |
| `--- Account ***            | N txns ---` with N > 0                                                | Scrape worked for that account                                                     | OK  |

## Balance and final-result interpretation

Transaction count is not evidence that a balance was resolved. Balance
values come from the bank's scrape shape; unknown values may be omitted
rather than reported as zero. See [Account and card balances](../architecture/balance-resolve.md).

Auditing happens before the result guard. An account line therefore does
not by itself prove a successful scrape: inspect the POST verdict and
final scraper result as well.
