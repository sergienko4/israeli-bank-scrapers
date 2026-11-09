# Element identity

> **Who this is for:** maintainers debugging a credential field that was filled twice, or not at all.

A diagnostic signal that answers a question the selector trace could not: *"is this the same field I already filled?"*.

It is safe to share: an identity token is a structural path such as `BODY:0/FORM:1/INPUT:0`. It cannot carry page content, a value, or a credential.

## Why a token

Selector strings are a poor proxy for identity, and they fail in **both** directions:

- **False match** — two different inputs answer the same string. A password field and its confirmation both answer a type-based selector.
- **False miss** — one input is described by two strings. `#user` and a placeholder match reach the same node.

The credential-collision guard that compares fields inherits both failures. An identity token replaces the comparison with the element's own position in the document tree, which is unique per element and independent of whichever selector found it.

## Exports

| Export | What it gives you |
|---|---|
| `elementPathToken` | Builds the position token. Runs in the browser realm, so it is self-contained by necessity |
| `readElementIdentity` | Resolves a locator and reads its token, within a bounded budget |
| `UNKNOWN_IDENTITY` | The empty-string token returned when identity could not be established |

## Handling an unknown token

`readElementIdentity` returns `UNKNOWN_IDENTITY` — the empty string — when the locator did not resolve, the read outlived its budget, or the element was detached from any document.

An unknown token means **"cannot compare"**. It must never be read as a match, and two unknown tokens are not equal to one another in any meaningful sense. Callers that compare identity may therefore only ever *add* a collision on the strength of a token, never clear one that the selector already established.

Note that a present `elementId` property does **not** imply a known identity: the field is always set, and carries the empty token when the read failed. Check the value, not the key.

## Shadow boundaries

A shadow root stops `parentElement`, so a walk that ignored it would describe an element by its position *within its own shadow tree*. Two copies of the same custom element, each holding one input, would then answer the same path and be read as one element. The walk crosses the boundary through the shadow host instead, so the host's own path prefixes the inner one and the two copies stay distinct.

## See also

- [Structured events](events.md) — where these fields surface in the trace
