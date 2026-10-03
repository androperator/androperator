# Agent host integration

The current host agent owns reusable instructions, app strategy and optional
helpers. Androperator owns Android execution, readiness and structured evidence.
CLI, HTTP and MCP serve the retained operations with command/task correlation.

Bundled guidance is installed separately from app instructions. Its canonical
store is `~/.androperator/bundled-skills/`; supported discovery directories use
managed copies or links. Host setup writes a private local guide and a bounded
bridge in an existing shared AGENTS.md. Preserve unrelated content and report
bridge failures as warnings when the core host artifacts succeed.

Do not recreate runtime manifests, registries, recipe compilation, child-agent
launchers or result wrappers in core. Scheduling and optional delegation belong
to caller-owned tooling. Recordings are optional evidence for adaptive guidance.
See [agent instructions](agent-instructions.md) for the maintained instruction
and helper boundaries.
