# Migrating to Androperator 1.0.0

Androperator was formerly known as Clawperator. Its first release is 1.0.0.
The new package, CLI, Android app and runtime contracts change together.
This release is being prepared; do not use the new download URLs until public cutover is complete.

| Surface | Before | After |
| --- | --- | --- |
| npm package | `clawperator` | `@androperator/cli` |
| CLI executable | `clawperator` | `androperator` |
| Environment variables | `CLAWPERATOR_*` | `ANDROPERATOR_*` |
| Local state | `~/.clawperator/` | `~/.androperator/` |
| Android release app | `com.clawperator.operator` | `com.androperator.operator` |
| Android development app | `com.clawperator.operator.dev` | `com.androperator.operator.dev` |
| Kotlin packages | `clawperator.*` | `androperator.*` |
| Result envelope | `[Clawperator-Result]` | `[Androperator-Result]` |

Install `@androperator/cli` and its matching APK. The renamed
Android app installs separately; grant its accessibility and automation permissions.
The release retains the existing signing key. Updating the CLI alone does not
make an old Android app compatible with the new envelope or ingress names.

Update scripts, MCP client commands, bundled agent skill names and environment
variables. Use the new CLI and explicitly select the new Operator package.
Do not reuse old daemon sockets, PIDs, or version markers. Stop the old daemon
using the old CLI before starting the renamed one.

The runtime skills framework was removed after the rename. The current agent
follows instructions and optional helpers directly. Installation provides bundled
host guidance and Android readiness; there is no runtime catalog or package API.

Do not copy the entire old state directory. Review any recordings, logs and user
skills you need to retain, then migrate those deliberately. Git hooks use
`ANDROPERATOR_BLOCKED_TERMS_FILE` or `~/.androperator/blocked-terms.txt`; until that
file exists, they retain the former default terms file as a migration safeguard.

The old landing site and historical release notes remain under the former name.
No Clawperator 1.0.0 package or release is to be published.

## Release preparation

Before tagging, verify new npm publishing authorization, the destination domains,
installer routes, downloads bucket and APK redirect Worker. Cloudflare upload
secrets use `ANDROPERATOR_CLOUDFLARE_*`. Android signing secrets retain their
existing stored values and secret names; the workflow maps them to renamed build
variables. Do not generate a new signing key.

Firebase SDKs, plugins, registrations and remote task-status reporting have been
removed. Crash information remains in the app-private `crash-log.txt` and logcat.
Task status remains available through structured local logcat reporting with
command/task correlation. No Firebase registrations are required.

## Scoped npm package (1.1.0)

Androperator 1.1.0 moves the npm package from `androperator` to
`@androperator/cli`. The executable, Android IDs, result envelope, environment
variables, and configuration paths remain unchanged.

If the unscoped package is installed, remove it before installing the replacement
so both packages do not compete for the same executable:

```bash
npm uninstall -g androperator
npm install -g @androperator/cli
androperator --version
```

The recovery installer handles the former package in the active npm prefix.
Existing published versions remain available; future releases use the scoped name.
