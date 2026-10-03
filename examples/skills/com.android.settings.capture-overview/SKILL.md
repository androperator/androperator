---
name: com.android.settings.capture-overview
description: Minimal runnable example that opens Settings and captures current evidence.
androperator-skill-type: replay
---

# Settings observation starter

Run with an explicit device and compatible Operator package through
`androperator skills run com.android.settings.capture-overview`.
The wrapper supplies the CLI, device, and Operator package. This script opens
Settings and captures a fresh snapshot, retaining each raw response in a new
local temporary directory. It neither navigates to About nor claims that any
version value has been verified. Use the Codex example for that goal.

Inspect the returned evidence directory after failure before deciding whether to
retry. Opening Settings can resume its previous screen; a successful snapshot
alone does not establish a root-start route. Evidence may contain private data.
