# androperator

Deterministic Node.js CLI and API for Android automation, designed for AI agents.

This npm package ships the built Node API and CLI entrypoint for installation and runtime use.
The full source tree, including the Android operator app, docs, and build tooling, lives in the public GitHub repository:
[github.com/androperator/androperator](https://github.com/androperator/androperator).
The current agent follows reusable instructions and optional helpers.
Settings examples are included in the repository; no runtime package is required. See [skill authoring](https://docs.androperator.com/skills/authoring/).

## Install

```bash
npm install -g androperator
```

For the full host + APK install flow, use:

```bash
curl -fsSL https://androperator.com/install.sh | bash
```

## Requirements

- Node.js 24+
- `adb` on `PATH`
- Android device with USB debugging enabled
- Androperator APK installed from [androperator.com/operator.apk](https://androperator.com/operator.apk)

## Quick Start

```bash
androperator doctor
androperator devices
androperator snapshot --device <device_id>
```

## Run As An MCP Server

The npm package also ships a first-party stdio MCP server for MCP clients such as Claude Desktop:

```bash
androperator mcp serve
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
    "androperator": {
      "command": "node",
      "args": [
        "<installed_androperator_path>/dist/cli/index.js",
        "mcp",
        "serve"
      ],
      "env": {
        "ADB_PATH": "<adb_path>",
        "ANDROPERATOR_OPERATOR_PACKAGE": "com.androperator.operator",
        "ANDROPERATOR_LOG_DIR": "<log_dir>",
        "ANDROPERATOR_LOG_LEVEL": "info"
      }
    }
  }
}
```

Important MCP notes:

- Node.js `24+` is required.
- Set `ADB_PATH` explicitly in GUI MCP clients. They often do not inherit your shell `PATH`.
- Use `ANDROPERATOR_OPERATOR_PACKAGE=com.androperator.operator.dev` for local branch verification against the debug APK.
- MCP errors and diagnostics are easiest to inspect through the log file under `ANDROPERATOR_LOG_DIR`, because GUI clients typically do not show stderr.

## Documentation

Full docs: [docs.androperator.com](https://docs.androperator.com)

- First-time setup: [docs/setup.md](../../docs/setup.md)
- Node API contract: [docs/api/overview.md](../../docs/api/overview.md)
- MCP server: [docs/api/mcp.md](../../docs/api/mcp.md)

## Build and Test

```bash
npm install
npm run build
npm run test
```
