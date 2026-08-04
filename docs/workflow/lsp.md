# LSP (code intelligence)

> **Who this is for:** contributors and coding agents that want
> go-to-definition, find-references and hover while working in this repo.

`lsp.json` at the repo root configures a TypeScript language server for
[GitHub Copilot CLI](https://docs.github.com/copilot). The OODA agent contract
assumes it exists — agents are told to use `goToDefinition`, `findReferences`
and `incomingCalls` during the OBSERVE phase to confirm who imports what before
refactoring.

## Prerequisite — install the server

`lsp.json` declares the server by **bare command name** so the same file works
on macOS, Linux and Windows. That means the executable must be resolvable on
your `PATH`; it is **not** installed by `npm install`, because it is a developer
tool rather than a build or runtime dependency of the package.

```bash
npm install -g typescript-language-server typescript
```

Verify it resolves:

```bash
# macOS / Linux
which typescript-language-server

# Windows (PowerShell)
where.exe typescript-language-server
```

If the command is not found, the LSP host silently reports no server for
TypeScript files and code intelligence stays unavailable — the editor or agent
keeps working, only the navigation features are missing.

## Activate it

The config is read at startup, so a running Copilot CLI session will not pick it
up:

1. `/exit` to quit Copilot CLI.
2. Re-launch `copilot` from the repo root.
3. Run `/lsp` to confirm the server is attached.

## Configuration

```json
{
  "lspServers": {
    "typescript": {
      "command": "typescript-language-server",
      "args": ["--stdio"],
      "fileExtensions": { ".ts": "typescript", ".tsx": "typescriptreact" }
    }
  }
}
```

The committed file maps eight extensions (`.ts`, `.tsx`, `.mts`, `.cts`, `.js`,
`.jsx`, `.mjs`, `.cjs`). A repo-level `lsp.json` takes precedence over a
user-level `~/.copilot/lsp-config.json`, so this file governs for everyone
working in this checkout.

## Windows note

If the bare command fails to resolve on Windows even though the package is
installed, npm's shim directory is not on `PATH` for the launching process.
Fix `PATH` — add the directory printed by `npm prefix -g` (it holds
`typescript-language-server.cmd`) and restart the terminal.

A user-level `~/.copilot/lsp-config.json` will **not** help here, because the
repo-level `lsp.json` takes precedence over it. If you cannot change `PATH`,
edit the `command` in this repo's `lsp.json` to the absolute `.cmd` path
locally and leave that edit uncommitted, so the committed file stays portable.
