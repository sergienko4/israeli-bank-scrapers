---
title: Transaction sign
source-files:
  - src/Scrapers/Pipeline/Mediator/Scrape/TxnMapper/TxnSign.ts
---

# Transaction sign — which side of zero an amount lands on

> **Who this is for:** anyone mapping a bank or card-issuer payload into a
> `Transaction`, or debugging a row whose amount came back with the wrong sign.

Consumers of this package read one convention: **money out is negative, money
in is positive.** Providers do not agree on how to say that, and several do not
sign the amount at all. Reconciling them is owned end to end by
[`src/Scrapers/Pipeline/Mediator/Scrape/TxnMapper/TxnSign.ts`](https://github.com/sergienko4/israeli-bank-scrapers/blob/{{BRANCH}}/src/Scrapers/Pipeline/Mediator/Scrape/TxnMapper/TxnSign.ts),
so the mapper beside it is left with pure field coercion.

## The three ways a provider states direction

| Style                                           | Who                 | What arrives                                         |
| ----------------------------------------------- | ------------------- | ---------------------------------------------------- |
| Signed amount                                   | Most banks          | The value already carries the minus                  |
| **Inverted** signed amount                      | Card issuers        | A charge is **positive** — "you owe 122.17"          |
| Unsigned magnitude + a separate direction field | Hapoalim and others | `122.17` plus a word (`debit`) or a **numeric code** |

The third style is the one that cannot be read off the amount, and it is where
sign defects come from: a mapper that only understands the first two leaves an
unsigned magnitude exactly as the API sent it, so an outbound row reports as
income.

## Resolution order

`signCardAmount` runs three stages over each of a record's two amounts, in this
fixed order:

1. **Credit reconciliation — declared card issuers only.** A refund is a refund
   in both currencies, so the charged and original amounts of one record must
   share a direction. `signCardAmounts` inspects the pair before either amount
   is mapped, and does so only when the institution is a declared card issuer.
   When exactly one of them carries a minus — VisaCal signs
   `amtBeforeConvAndIndex` but not `trnAmt` — the record is read as a credit and
   both amounts are normalised negative. A bank record whose two amounts
   disagree is left exactly as it arrived.
2. **Card inversion.** For card issuers the sign is _inverted_, not forced, so a
   refund that already arrived negative becomes positive rather than collapsing
   back into a charge.
3. **Direction correction.** `applyDirectionWk` applies the direction field, if
   the record carries one.

Normalising a credit before the inversion is what lets one path serve both
issuer styles: an issuer that already signs both of its refund amounts passes
stage 1 unchanged, because there is no disagreement left to reconcile. The
inversion itself is not idempotent — applying it twice restores the original
sign — which is why it runs exactly once per amount.

## Direction precedence — a code outranks a word

Stage 3 resolves in this order, and stops at the first rule that matches:

| Record states                              | Result                                                                 |
| ------------------------------------------ | ---------------------------------------------------------------------- |
| A **numeric code** meaning outbound        | Charged amount is driven **negative**                                  |
| A **numeric code** meaning inbound         | Charged amount is taken as an **absolute value**, so it stays positive |
| No code, and a worded `debit` direction    | Charged amount is driven **negative**                                  |
| No code, and any other or absent direction | Amount is left untouched                                               |

A numeric code is **authoritative**: it is an explicit statement by the bank, so
it settles the sign outright rather than merely adding a negation. That is why a
coded inbound row keeps its positive magnitude even when a worded field or a
card issuer's inverted convention would otherwise flip it — the earlier stages
are corrections applied in the absence of a statement, and a statement overrides
a correction.

The worded reader only ever matched strings, so before this precedence existed a
coded record fell straight through it and kept the unsigned magnitude the API
sent.

## Registered direction codes

Each row below is one bank's convention, declared in `DIRECTION_CODE_CONVENTIONS`
as a field name together with both of its codes:

| Field                   | Bank     | Inbound code | Outbound code |
| ----------------------- | -------- | ------------ | ------------- |
| `eventActivityTypeCode` | Hapoalim | 1            | 2             |

The field name and its two codes are declared as one unit, so a field can never
be registered without the codes that give it meaning.

Two rules keep the reader conservative:

- **Root only.** The code is matched on the record root, never through the
  nested search the worded reader uses. A code buried in a sub-record — a
  counterparty or a beneficiary block — describes that sub-record, not this
  transaction, and must not decide the parent's sign.
- **Strict numeric equality.** A quoted or reformatted value (`'2'`, `'0x2'`,
  `' 2 '`) is left undecided rather than guessed at, matching the upstream
  per-institution scrapers' `=== 2`.

Anything the table does not decide falls through to the worded reader.

Matching carries **no bank identity**: the reader is handed the raw record and
nothing else, so a convention applies to _every_ provider whose root record
carries that field with one of those two values. `eventActivityTypeCode` is
Hapoalim's in the payloads seen so far, but that is an observation about today's
providers, not a constraint the code enforces.

## Zero keeps its sign

Every negation guards against `-0`. Negative zero passes `=== 0` but is
distinguishable through `Object.is` and `1 / x`, so letting it escape would make
a zero-amount row unequal to a stored `0` downstream.

## Adding a bank

Add the field and both codes to `DIRECTION_CODE_CONVENTIONS`, then add a row to
the table above. Because matching is by field name and value alone, first check
that no already-registered provider emits the same field name with a different
meaning: conventions are scanned in order and the first decided match wins, so
an overlapping registration would silently shadow the row after it.

`TransactionSignDocumented.test.ts` reads the conventions out of the source
declaration and fails while any of them is missing from the table above, and
the [docs staleness gate](../workflow/docs-coverage.md) fails if the module is
edited without this page being updated.

Behaviour is proven by `ScrapeAutoMapperDirectionCode.test.ts`, which maps every
case through the real `autoMapTransaction` entry point rather than calling the
sign helpers directly.
