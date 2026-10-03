# Migrating to Androperator 1.0.0

Androperator was formerly known as Clawperator. Its first release is 1.0.0.
The new package, CLI, Android app and runtime contracts change together.
This release is being prepared; do not use the new download URLs until public cutover is complete.

| Surface | Before | After |
| --- | --- | --- |
| npm and CLI | `clawperator` | `androperator` |
| Environment variables | `CLAWPERATOR_*` | `ANDROPERATOR_*` |
| Local state | `~/.clawperator/` | `~/.androperator/` |
| Android release app | `com.clawperator.operator` | `com.androperator.operator` |
| Android development app | `com.clawperator.operator.dev` | `com.androperator.operator.dev` |
| Kotlin packages | `clawperator.*` | `androperator.*` |
| Result envelope | `[Clawperator-Result]` | `[Androperator-Result]` |

Install `androperator@1.0.0` and its matching APK after publication. The renamed
Android app installs separately; grant its accessibility and automation permissions.
The release retains the existing signing key. Updating the CLI alone does not
make an old Android app compatible with the new envelope or ingress names.

Update scripts, MCP client commands, bundled agent skill names and environment
variables. Use the new CLI and explicitly select the new Operator package.
Do not reuse old daemon sockets, PIDs, or version markers. Stop the old daemon
using the old CLI before starting the renamed one.

Installation initializes a local skills directory without an index file. It no longer clones a
companion skills catalog. Keep your own workspace, set
`ANDROPERATOR_SKILLS_DIR` to the directory containing its skill folders, and adapt its scripts, manifests,
frontmatter and result handling to the new contracts before validating and running.
Git-ref catalog synchronization is no longer supported; `skills update` and
`skills sync --ref main` initialize or validate the local workspace.
Optional [bundled examples](https://github.com/androperator/androperator/tree/main/examples/skills)
provide a starter and adaptive Settings references; they are not installed by default.

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

The removed `ANDROPERATOR_SKILLS_REGISTRY` variable is ignored. Remove old exports
and use project-local `skills/<id>/skill.json`, or the optional directory override.
Existing indexes can still be read for migration; new local skills need no index.
