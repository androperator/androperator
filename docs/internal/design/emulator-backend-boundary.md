# Emulator backend boundary

The consumer-owned `EmulatorBackend` contract lives in
`apps/node/src/adapters/android-emulator/contracts.ts`. Its composition point,
`adapters/android-emulator/index.ts`, defaults to `packageBackend.ts`, backed by
`@androperator/emulator`. The in-tree implementation remains in `legacy/` for
comparison and rollback until the separate removal PR.

## Ownership

The package owns SDK inspection, running-emulator discovery, installation,
creation, storage configuration, launch, registration and boot waits, stop and
deletion. The adapter maps the existing consumer runtime to the package runtime.
It preserves explicit SDK paths, the supplied process runner and ADB logging.
Discovery clears an ambient device serial; targeted calls use the serial supplied
by the package exactly once. This change does not replace the general process
runner used by ordinary Androperator device actions.

Androperator retains defaults, compatibility classification, provisioning choice,
developer settings, structured output and existing domain import paths. It passes
image, profile, capacity, replacement and license policy explicitly. Launch
confirms spawn only; every caller awaits registration and boot separately.

## Published and local package selection

Normal installs depend on the exact published `@androperator/emulator` version
in `apps/node/package.json` and its lockfile integrity. There is no vendored
package snapshot, install hook or global npm link. The registry dependency stays
installed in development too, supplying the released TypeScript contract and
an immediately available published-mode comparison.

In a source checkout, automatic mode runs the built sibling emulator project.
Both `apps/node/src/cli/index.ts` and the repository's `.git` marker must exist.
For Git worktrees, discovery uses the common Git directory to find the primary
checkout's sibling. A missing sibling selects the published dependency; an
existing unbuilt or invalid sibling fails with a build instruction. Packed
installs lack the source markers and select the published dependency, even if
installed inside another Git repository.

From the primary Androperator checkout:

```sh
npm --prefix ../emulator ci
npm --prefix ../emulator run build
npm --prefix apps/node ci
npm --prefix apps/node run build
npm --prefix apps/node run emulator:status
node apps/node/dist/cli/index.js emulator list --output json
```

The status command reports backend, source, version, package root and entry URL.
It is an internal npm script, not an added public Androperator CLI command.

`ANDROPERATOR_EMULATOR_SOURCE` selects package code per process:

- `auto` (default): built local sibling when present in a development checkout;
  otherwise the installed dependency.
- `published`: the installed, pinned npm dependency.
- `local`: require sibling discovery and a built local package.
- An absolute directory: use that built `@androperator/emulator` project.

Blank values, relative directories and unknown choices are rejected. Rebuild the
library after source edits; new Androperator processes immediately load the new
JavaScript without reinstalling or changing the lockfile. Restart a long-running
serve process after rebuilding. Androperator compiles against the published
package declarations, so exported API changes in a local library must preserve
that contract or be accompanied by an intentional dependency/adapter update.

```sh
ANDROPERATOR_EMULATOR_SOURCE=published npm --prefix apps/node run emulator:status
ANDROPERATOR_EMULATOR_SOURCE=published node apps/node/dist/cli/index.js emulator list
ANDROPERATOR_EMULATOR_SOURCE=/absolute/path/to/emulator node apps/node/dist/cli/index.js emulator list
```

## Legacy comparison and rollback

`ANDROPERATOR_EMULATOR_BACKEND=legacy` selects the retained in-tree backend.
The default is `package`; blank or unknown values fail. Only the selected backend
is imported, so legacy rollback works even if the local package is unbuilt.
The source override is ignored for legacy mode. Restart long-running processes
when changing either setting.

```sh
ANDROPERATOR_EMULATOR_BACKEND=legacy npm --prefix apps/node run emulator:status
ANDROPERATOR_EMULATOR_BACKEND=legacy node apps/node/dist/cli/index.js emulator list
```

## Deliberate package behavior differences

- Locator-aware inspection follows each AVD's configured path. This can make
  previously incomplete AVD metadata complete and change compatibility selection.
- Installed-image checks recognize both legacy SDK output and Android CLI shim
  output, match complete IDs, and verify installation after the SDK command.
- Creation validates capacity and inputs before provisioning. Replacement and
  deletion refuse running targets, failed ADB discovery, and offline or
  unauthorized emulators whose ownership cannot be established safely.
- Consumer replacement and automatic SDK license acceptance policy is unchanged;
  the package enforces the checks above before replacement.

Both backends use `sys.boot_completed` and `dev.bootcomplete`, acknowledge stop
without awaiting shutdown, and configure capacity without resizing existing
userdata or limiting host disk usage. Snapshot loading is disabled; saving is
not disabled. Catalogs, progress/cancellation, cross-process operation locking,
shutdown waiting and disk resizing remain separate follow-up capabilities.

## Validation and packaging

Build Node before running tests. Run the full consumer suite separately with
`ANDROPERATOR_EMULATOR_SOURCE=published` and `local`. Keep the shared consumer
contract tests and focused legacy fallback coverage until removal. Package tests
cover discovery/logging, stricter refusal, locator resolution and install
verification. Use isolated disposable AVDs for destructive live checks.

Pack and install into a directory outside the checkout with source overrides
unset. Confirm status selects the published dependency and exercise the installed
CLI. `npm pack` contains neither the sibling project nor dependency source;
normal npm installation resolves the exact registry dependency. No symlink
restoration or pack-time source switching is needed. Keep all adapter-selection
and migration guidance internal, outside the docs navigation and public corpus.

## PR2 follow-up

After PR1 has merged and the package backend has been verified, remove `legacy/`,
its composition module, the legacy selector and fallback-only test branches.
Keep package/local selection, consumer policy and contract tests. Recheck both
package sources and packed installation. PR2 should remove the fallback without
changing the default backend behavior established here.
