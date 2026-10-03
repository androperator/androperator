---
name: com.android.settings.get-version-details-with-jev
description: Delegate bounded Settings navigation to Jev using current-agent decisions and verified Android evidence.
---

# Delegate bounded Settings navigation to Jev

This advanced example extends [version details](../com.android.settings.get-version-details/SKILL.md).
The current agent owns planning, observation review, recovery, and final verification.
Jev is an optional external provider choosing among offered navigation candidates;
it is not another general-purpose agent and cannot issue arbitrary CLI commands.

Follow the primary example's preparation and evidence rules. Obtain authorization
for external provider use and configure `JEV_API_KEY` without exposing it. The
request discloses screen headings, navigation descriptions, structural state,
and collected-field names. It omits actual extracted values, node text/resource
identifiers, local device paths/IDs, bounds, and screenshot bytes. This narrow
projection is not a general privacy guarantee; inspect it for the intended use.

After observing a supported Settings screen, invoke:

```bash
node examples/skills/utils/settings_version_tool.js jev
```

The helper validates each choice against the fresh menu, preserves requests and
responses locally, and delegates at most eight actions within 30 seconds (also
bounded by the overall run deadline). It retries only the supported transient
HTTP failures within the request budget. Invalid choices, uncertainty, overlays,
no progress, and provider failure return control to you.

Inspect `status`, `reason`, failure details, and current evidence. On escalation,
you may continue with observed candidates within the remaining overall budget,
or stop truthfully. Do not reset delegation's budget or treat provider confidence
as UI proof. Review overlays yourself. Finish using the same independent label/
value reads and `finish` verification as the primary example.

No Codex launcher, model setting, registry, or catalog is needed. Your host remains
the orchestrator. Do not put provider-specific delegation in the core runtime.
