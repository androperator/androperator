# Persistent CLI experiment

This opt-in experiment measures whether a thin Node launcher forwarding existing
CLI arguments to a warm CLI process saves meaningful time beyond PR #396.
It is not installed, used by the product CLI, or a supported API.

Build first, then run local compatibility and failure tests:

```sh
npm --prefix apps/node run build
node --test validation/persistent-cli/test.cjs
```

With an unlocked stationary physical phone, the matching development Operator,
`JEV_API_KEY` configured locally, and no running daemon for that device:

```sh
node validation/persistent-cli/compare.cjs <device_serial> <new_absolute_output_directory>
```

The comparison uses two excluded pilots then five alternating pairs. Both arms
use the same built CLI, existing daemon, full-resolution screenshots, Jev policy
and independent terminal evidence verification. Both private helper copies remove
the example's explicit no-daemon flag. Setup, doctor, Settings reset, daemon and
prototype-worker startup are outside task timing. A fresh owned daemon and, for
the persistent arm, a fresh warm worker are created per trial. A failure stops the
batch and is retained. Existing daemons are never stopped or replaced by setup.

The relay still starts Node on every command. Its only job is forwarding arguments
and returning captured stdout, stderr and exit status. The sequential worker calls
the existing built CLI parser and handlers, preserving normal daemon requests and
checks. It uses the explicit CLI runner when available. For legacy builds it
creates a temporary adjacent module that exposes the CLI main function and
replaces parser process exits with caught exits, deleting it after import.
The benchmark resolves the installed entry from package metadata. This transformation is intentionally a laboratory technique, not a
production refactor. Do not build concurrently with a run.

Only the command-first forms used by the Settings route and help/version are
accepted. The worker inherits a fixed working directory and environment; only run
ID and log directory vary per request. Output is non-interactive. One request may
run at a time; concurrent requests fail. The private socket directory is mode 0700
and the socket mode 0600. Requests and relay responses have size limits. The relay
never retries or falls back after a connection failure. A disconnected request may
still complete on the device; the caller must inspect state before another action.
Explicit worker replacement is tested, but automatic recovery is not implemented.
The host kills its worker and removes its private socket directory on cleanup.

Do not use this worker for arbitrary users, concurrent requests, general commands
or different caller environments. It temporarily captures process-global streams,
arguments and selected environment values. Module caches and other ambient state
are deliberately retained. A production implementation must introduce explicit
request context and avoid such global mutation; it must support current global
flag placement, caller paths, environment/config selection, lifecycle ownership,
build invalidation, deadlines, cancellation, output limits and no-replay recovery.
Integrate persistent CLI handling into the existing daemon rather than deploying
this extra experimental worker as another managed daemon.

The API Agent UX acceptance criterion is unchanged agent commands, validation,
structured output and exit behavior. This experiment does not claim full CLI
compatibility from a known-route success. It separates the feasibility measurement
from the larger production compatibility requirement.

Raw evidence contains private device/UI details and stays outside Git. Compare
per-trial summaries, retained command envelopes, images and daemon logs before
claiming improved reliability or speed. Do not combine percentages from earlier
batches. The isolated startup result and physical end-to-end result answer different
questions.

See [physical findings and production boundaries](findings.md). To audit a fresh
completed batch, run `node validation/persistent-cli/analyze.cjs <output_directory>`.
For the device-free timing check, run `node validation/persistent-cli/loading.cjs`.
Neither command requires provider calls; keep their output private if it contains
local diagnostics.
