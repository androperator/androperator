# MCP Server Design Notes

## Purpose

Capture the durable design decisions behind the first-party Androperator MCP server so future contributors can extend it without reintroducing stdout corruption, transport drift, or MCP-only contract forks.

## Sources

- `apps/node/src/cli/index.ts`
- `apps/node/src/cli/commands/mcp.ts`
- `apps/node/src/mcp/server.ts`
- `apps/node/src/mcp/tools/common.ts`
- `apps/node/src/mcp/tools/core.ts`
- `apps/node/src/mcp/tools/named.ts`
- `apps/node/src/domain/executions/runExecution.ts`
- `apps/node/src/domain/executions/validateExecution.ts`
- `apps/node/src/domain/actions/`

## Stdio Only In V1

The shipped MCP server is stdio only.

Why:

- MCP desktop clients already know how to supervise stdio subprocesses
- stdio avoids adding a second remote surface alongside the existing HTTP `serve` API
- the highest-risk regression for a CLI-hosted MCP server is stdout contamination, and that risk is easier to control on one transport first

Implementation consequence:

- `apps/node/src/cli/index.ts` detects `mcp serve` before normal CLI parsing and formatting
- the MCP path bypasses star hints, usage formatting, and normal command-result printing
- stdout is reserved for MCP protocol messages; diagnostics go to stderr or log files

## Thin MCP Boundary For `execute`

The `execute` MCP tool intentionally accepts a light schema:

- `actions` is required
- each action must include `id` and `type`
- `params` is optional passthrough data

The server does not mirror every `ActionParams` variant into a second MCP-only validator.

Why:

- `validateExecution()` is already the canonical execution contract
- duplicating the full action matrix in Zod would create a second source of truth
- a thin MCP boundary lets future action types ship by extending the canonical execution validator instead of updating two large validation systems

Boundary split:

- MCP validates transport-local concerns such as blank `operatorPackage` and named-tool xor rules
- execution semantics stay in the shared domain validation path

## Named Tools Use Domain Builders

The named MCP tools call execution builders under `apps/node/src/domain/actions/` and `apps/node/src/domain/observe/`.

They do not call CLI formatter functions.

Why:

- CLI command handlers mix parsing, stdout formatting, and command-line affordances
- MCP needs structured results, not pretty-print helpers
- the domain builders already encode the canonical action types, timeout defaults, and execution shapes needed by the runtime

This keeps the MCP layer transport-focused:

- parse MCP args
- map selector objects into `NodeMatcher`
- build a canonical execution
- call `runExecution()`
- shape the result into MCP content

The one intentional exception is `configure`, which stores session-local defaults in the per-`createMcpServer()` session object passed into MCP tools; this state is bounded to MCP transport ergonomics and does not change the shared execution engine contract.

## Stdout Safety Is A Design Constraint

The MCP transport must never emit non-protocol stdout bytes.

Threats that are intentionally bypassed on the `mcp serve` path:

- CLI star-hint output
- normal `console.log(result)` command printing
- `UsageError` help formatting

That is why the `mcp serve` detection lives as the first branch inside `main()`. If this moves later, stray stdout writes become possible again and MCP clients may fail before `initialize`.

## In-Flight Locking Semantics

Execution-backed MCP tools share the existing in-process `executionStore` lock semantics from the execution layer.

Important persistence rule:

- the lock lives only in process memory
- it does not survive process restarts
- restarting the MCP server after a crash, SIGTERM, or client disconnect is safe
- a fresh boot cannot inherit a stale `EXECUTION_CONFLICT_IN_FLIGHT`

This behavior is intentional. The lock protects concurrent work inside one live runtime process, not cross-process coordination.

## Real Smoke Verification Notes

The original verification pass used the standalone terminal script at `validation/test_mcp_stdio_smoke.mjs`.

Durable caveats for future contributors:

- the smoke flow opens Android Settings because it is stable across physical devices and emulators
- the script discovers visible text from the live snapshot before issuing the selector-driven read; this is more robust than hardcoding one OEM-specific label
- when multiple devices are connected, explicit `deviceId` selection matters even in MCP flows
- use `com.androperator.operator.dev` for branch-local verification unless the task is explicitly validating the release APK
