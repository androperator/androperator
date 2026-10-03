# Repository test execution

Run `./validation/test_all.sh` from any working directory to run all off-device
suites. The runner builds Node once before its consumers, prints a result for
each selected suite, and exits nonzero if any suite fails or cannot run. A failed
Node build blocks Node-dependent suites; independent suites still run. Within a
suite, a failing command stops that suite.

Install Node dependencies with `npm --prefix apps/node ci` first. Prerequisites
are Node 24+, Python 3.11+, uv, JDK 17, and the Android SDK configured for Gradle.
The runner does not install host tools. Gradle and uv may download dependencies.

Select one or more suites with repeated `--suite` options:

| Suite | Coverage |
| --- | --- |
| `android` | Debug unit tests across all Android modules via `unitTest` |
| `node` | Every built `*.test.js` under `apps/node/dist`, discovered recursively |
| `evals` | All pytest tests under `evals/harness`, including mocked live-eval tests |
| `validation` | Runner regression tests, sensitive-hierarchy assertion tests, blocked-term policy, installer and fake-adb doctor tests, and on-screen-log contract/proof harness tests |

For example, `./validation/test_all.sh --suite node --suite validation` builds
Node once and runs both suites. Pull-request CI uses these same definitions in
separate jobs. Documentation builds and commit-message checks remain separate
CI checks; they are not test suites.

`npm --prefix apps/node test` runs the complete built Node test inventory without
building. `npm --prefix apps/node run test:unit` limits discovery to
`dist/test/unit` and `dist/cli`. Both commands require a fresh Node build and use
explicit file discovery, independent of shell glob expansion. Do not run another
Node build concurrently with tests: the build replaces `dist/`.

## Adding tests

No runner changes are needed when adding Node or Android test files:

- Node: add `*.test.ts` anywhere under `apps/node/src/`. TypeScript includes the
  whole source tree, and the runner recursively discovers the compiled
  `*.test.js` files under `dist/`, including new directories. The narrower
  `test:unit` command only includes `src/test/unit/` and `src/cli/`.
- Android: add JUnit tests to a module's standard `src/test/java/` or
  `src/test/kotlin/` source set. Gradle discovers the test classes; the runner
  does not enumerate files or modules. New Android modules must be registered
  in `settings.gradle.kts` as usual. The root `unitTest` task dynamically includes
  every subproject's `testDebugUnitTest` task.
- Android instrumented tests belong in `src/androidTest/` and are discovered
  by the explicit `instrumentation` suite. They remain excluded from the default
  off-device run.

New test frameworks or build variants may need suite configuration. File
additions within these conventions do not.

## Device tests

Device tests never run by default. Select a suite and pass an explicit serial:

```bash
./validation/test_all.sh --suite instrumentation --device <device_serial>
./validation/test_all.sh --suite mcp-device --device <device_serial>
```

`instrumentation` runs Gradle's debug connected Android tests using
`ANDROID_SERIAL`. `mcp-device` builds Node and runs the MCP stdio smoke harness
against the selected connected device. Install and enable the matching Operator
first; the MCP harness defaults to `com.androperator.operator.dev`. Set
`ANDROPERATOR_OPERATOR_PACKAGE` for explicit release validation. Device suites
can interact with the screen and require adb and a ready device.

The sensitive-hierarchy API 35 emulator proof remains in the manually dispatched
`sensitive-hierarchy.yml` workflow. Its APK and device prerequisites are described
in `validation/sensitive-hierarchy-access/README.md`. Other scenario-specific
smoke and proof scripts remain explicit developer tools; the default runner does
not start emulators, install APKs, run live skills, or contact agent services.
