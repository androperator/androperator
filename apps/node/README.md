# clawperator

Deterministic Node.js CLI and API for Android automation, designed for AI agents.

This npm package ships the built Node API and CLI entrypoint for installation and runtime use.
The full source tree, including the Android operator app, docs, and build tooling, lives in the public GitHub repository:
[github.com/clawperator/clawperator](https://github.com/clawperator/clawperator).
Project skills are maintained separately in the public skills repository:
[github.com/clawperator/clawperator-skills](https://github.com/clawperator/clawperator-skills).

## Install

```bash
npm install -g clawperator
```

For the full host + APK install flow, use:

```bash
curl -fsSL https://clawperator.com/install.sh | bash
```

## Requirements

- Node.js 24+
- `adb` on `PATH`
- Android device with USB debugging enabled
- Clawperator APK installed from [clawperator.com/operator.apk](https://clawperator.com/operator.apk)

## Quick Start

```bash
clawperator doctor
clawperator devices
clawperator snapshot --device <device_id>
```

## Run As An MCP Server

The npm package also ships a first-party stdio MCP server for MCP clients such as Claude Desktop:

```bash
clawperator mcp serve
```

For branch-local development, build first and launch the compiled entrypoint directly:

```bash
npm --prefix apps/node run build
node apps/node/dist/cli/index.js mcp serve
```

Claude Desktop example:

```json
{
  "mcpServers": {
    "clawperator": {
      "command": "node",
      "args": [
        "<installed_clawperator_path>/dist/cli/index.js",
        "mcp",
        "serve"
      ],
      "env": {
        "ADB_PATH": "<adb_path>",
        "CLAWPERATOR_OPERATOR_PACKAGE": "com.clawperator.operator",
        "CLAWPERATOR_LOG_DIR": "<log_dir>",
        "CLAWPERATOR_LOG_LEVEL": "info"
      }
    }
  }
}
```

Important MCP notes:

- Node.js `24+` is required.
- Set `ADB_PATH` explicitly in GUI MCP clients. They often do not inherit your shell `PATH`.
- Use `CLAWPERATOR_OPERATOR_PACKAGE=com.clawperator.operator.dev` for local branch verification against the debug APK.
- MCP errors and diagnostics are easiest to inspect through the log file under `CLAWPERATOR_LOG_DIR`, because GUI clients typically do not show stderr.

## Documentation

Full docs: [docs.clawperator.com](https://docs.clawperator.com)

- First-time setup: [docs/setup.md](../../docs/setup.md)
- Node API contract: [docs/api/overview.md](../../docs/api/overview.md)
- MCP server: [docs/api/mcp.md](../../docs/api/mcp.md)
- Branch-local direct-result transport prototype: [opt-in guide and timing definitions](../../docs/internal/design/direct-result-transport-prototype.md)

## Build and Test

```bash
npm install
npm run build
npm run test
```
