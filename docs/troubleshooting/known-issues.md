# Known Issues

## Purpose

Record only currently reproducible, code-verifiable known issues.

## Current Status

No known issues are documented on this page at this time.

Reason for the minimal page:

- the old reference snapshot contained issues that are not fully verifiable from the current `apps/node/src/` surface alone
- this docs refactor documents only issues we can verify against current implementation

This is an intentional state, not a placeholder contract. We do not currently maintain a code-backed known-issues catalog in the Node API or CLI. Use `doctor`, `version --check-compat`, and command-specific error codes instead.

## Verification Boundary

What this page does mean:

- there is no currently maintained, code-backed list of known issues in `apps/node/src/`
- common operational failures are documented under exact error-code pages such as [Operator App](operator.md) and [Version Compatibility](compatibility.md)
- agents should use live checks like `doctor`, `version --check-compat`, and command-specific error payloads instead of assuming a hidden issue catalog exists

What this page does not mean:

- that the project has zero bugs
- that every operational failure has a dedicated known-issues entry
- that an issue was fixed just because it is absent from this page

## Practical Verification Pattern

When you suspect a current issue, verify it with a reproducible command and its exact JSON output:

```bash
androperator doctor --device <device_serial> --operator-package <package>
androperator version --check-compat --device <device_serial> --operator-package <package>
androperator snapshot --device <device_serial> --operator-package <package>
```

Use those outputs to decide where the issue belongs:

- installation, permissions, handshake, or crash recovery: [Operator App](operator.md)
- CLI and APK version mismatch: [Version Compatibility](compatibility.md)
- public API or CLI contract regression: the matching page under `docs/api/`

## Where To Track New Issues

- GitHub issues for project-level bugs and regressions: `https://github.com/androperator/androperator/issues`
- [Operator App](operator.md) for operational recovery guidance
- [Version Compatibility](compatibility.md) for CLI and APK mismatch problems

If a current issue becomes reproducible and code-verifiable, add it here with:

- exact trigger
- affected surface
- exact command or request used to reproduce it
- exact error code or failing check id
- one concrete verification pattern after the workaround
- workaround
- recovery or follow-up path

## Diagnostic Tools

When investigating issues:

1. **Check versions first** - Many issues are version mismatches:
   ```bash
   androperator version
   androperator version --check-compat --device <device_serial> --operator-package <package>
   ```

2. **Run doctor** for a comprehensive health check:
   ```bash
   androperator doctor --device <device_serial> --operator-package <package>
   ```

3. **Stream logs** to see what is happening in real time:
   ```bash
   androperator logs
   ```

4. **Check the log file** directly:
   ```bash
   cat ~/.androperator/logs/androperator-$(date +%F).log
   ```

See [Logging](../api/logging.md) for log format details and [Version Compatibility](compatibility.md) for compatibility rules.

## Related Pages

- [Operator App](operator.md)
- [Version Compatibility](compatibility.md)
- [Doctor](../api/doctor.md)
- [Errors](../api/errors.md)
- [Logging](../api/logging.md)
