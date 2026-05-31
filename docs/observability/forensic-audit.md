# Forensic audit

Every scrape path (browser + api-direct) emits a **per-account audit line** during `.post`. The line is the primary debug surface for "did the scrape actually pull transactions for this account?".

| Source | [`src/Scrapers/Pipeline/Mediator/Scrape/ForensicAuditAction.ts`](https://github.com/[REDACTED-USER]/israeli-bank-scrapers/blob/{{BRANCH}}/src/Scrapers/Pipeline/Mediator/Scrape/ForensicAuditAction.ts) |
|---|---|

## What it looks like in `pipeline.log`

```
--- Account ***6789 | 42 txns ---
--- Account ***5432 | 0 txns ---
--- Account ***9981 | 18 txns ---
```

| Element | Source |
|---|---|
| `***NNNN` | `maskTail4(accountNumber)` — last-4 of the discovered iter id |
| `N txns` | `scrape.accounts[i].txns.length` |

The line is emitted **regardless of underlying transport** — browser banks call it from [`SCRAPE.post`](../phases/scrape.md), api-direct banks call it from [`API-DIRECT-SCRAPE.post`](../phases/api-direct-scrape.md). Both paths produce the same line shape so triage scripts work cross-bank.

## Why it's load-bearing

When a scrape result comes back "empty", the first question is always: **did we get 0 transactions per account, or 0 accounts entirely?** The forensic audit answers it directly:

| What you see | What it means | Where to look next |
|---|---|---|
| No `--- Account ---` lines | 0 accounts discovered | [ACCOUNT-RESOLVE](../phases/account-resolve.md) — discovery returned empty |
| `--- Account *** | 0 txns ---` for one account | That account is genuinely empty for the date range OR scrape miss | Compare with `scrape.post.empty-gate.<verdict>` event |
| `--- Account *** | 0 txns ---` for **every** account | Real scrape miss OR legitimate "no transactions this month" | Consult `network.countSuccessfulResponses()` via empty-gate heuristic |
| `--- Account *** | N txns ---` with N > 0 | Scrape worked for that account | OK |

## Cross-reference with BALANCE-RESOLVE

The forensic audit reports **txn count**, BALANCE-RESOLVE separately reports **resolved balance**. Together they tell the full per-account story:

```
--- Account ***6789 | 42 txns ---
balance.miss account=***6789 message=balance unresolved — fallback to 0
```

→ 42 transactions captured fine, but the balance fetch for that bank account failed (quarantined). The account still ships with `balance: 0` and the txn list. Open a bug if the bank's balance endpoint truly should have returned data.

## Pre-v6 behavior

Before the v6 BALANCE-RESOLVE rewrite, this audit line was only emitted from SCRAPE — api-direct banks had no equivalent. v8.4 adds the same call to `ApiDirectScrapePhase.post` so both paths produce the line. See [Architecture → BALANCE-RESOLVE (v6)](../architecture/balance-resolve.md).
