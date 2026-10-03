# Docs Home

Androperator is a deterministic actuator tool for Android device automation.

Use this page as the routing index into the authored docs. The concrete machine entry points are `llms.txt` and `llms-full.txt`.

---

**Current release: [1.0.0](https://github.com/androperator/androperator/releases/tag/v1.0.0)**

---

## Version Quick Reference

Check your CLI version:

```bash
androperator version
```

Check CLI and APK compatibility:

```bash
androperator version --check-compat --device <device_serial> --operator-package <package>
```

See [Version Compatibility](troubleshooting/compatibility.md) for detailed compatibility rules and recovery.

## Agent Entry Points

- [llms.txt](https://docs.androperator.com/llms.txt) - compact machine entrypoint
- [llms-full.txt](https://docs.androperator.com/llms-full.txt) - full machine-readable docs corpus

Verification pattern:

```bash
curl -fsSL https://docs.androperator.com/llms.txt
curl -fsSL https://docs.androperator.com/llms-full.txt
```

Use:

- `llms.txt` when you want the compact docs index
- `llms-full.txt` when you want the full assembled documentation corpus

## Setup

- [Setup](setup.md) - install the CLI, prepare a device, install the Operator APK, verify readiness, and run the first snapshot
- [Host Agent Orientation](host-agents.md) - canonical post-install route for choosing between `androperator skills`, `androperator mcp serve`, and direct CLI automation
- [Quickstart](quickstart.md) - the observe/decide/act loop: taking snapshots, reading the hierarchy, and sending actions

## API

- [Overview](api/overview.md) - execution payload, result envelope, and branching model
- [CLI Reference](api/cli.md) - generated command and flag reference
- [Actions](api/actions.md) - canonical action types and parameter semantics
- [Selectors](api/selectors.md) - `NodeMatcher` contract and CLI selector mapping
- [Snapshot Format](api/snapshot.md) - where `snapshot` XML lives and how extraction works
- [Errors](api/errors.md) - public error-code contract and recovery patterns
- [Devices](api/devices.md) - device discovery and deterministic targeting
- [Doctor](api/doctor.md) - doctor report contract and readiness checks
- [Timeouts](api/timeouts.md) - execution and action timeout budgeting
- [Environment Variables](api/environment.md) - current `ANDROPERATOR_*` and runtime environment controls
- [Serve API](api/serve.md) - local HTTP and SSE contract
- [MCP Server](api/mcp.md) - stdio MCP server for MCP clients such as Claude Desktop
- [Navigation Patterns](api/navigation.md) - composed navigation workflows for agents
- [Recording Format](api/recording.md) - raw NDJSON recording schema and parsed step log

## Skills

- [Overview](skills/overview.md) - registry model, discovery, and wrapper execution
- [Authoring](skills/authoring.md) - scaffolded files, artifacts, and validation
- [Personalized Skills](skills/personalized-skills.md) - local wrappers, privacy boundaries, and shared-skill promotion rules
- [Development Workflow](skills/development.md) - local iteration loop for skills
- [Device Prep and Runtime](skills/runtime.md) - runtime environment, timeout, and output rules

## Troubleshooting

- [Operator App](troubleshooting/operator.md) - installation, permission, handshake, and crash recovery
- [Known Issues](troubleshooting/known-issues.md) - currently verified known issues page
- [Version Compatibility](troubleshooting/compatibility.md) - CLI and Operator APK version alignment

Androperator is open source. If these docs help, see the [project on GitHub](https://github.com/androperator/androperator).
