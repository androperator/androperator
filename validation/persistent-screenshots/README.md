# Persistent screenshot validation

Off-device package/CLI regression checks run through the shared validation suite:

```sh
npm --prefix apps/node run build
node --test validation/persistent-screenshots/package.test.mjs
node --test apps/node/dist/test/unit/captureHelper.test.js
```

The helper's source and packaged artifact are rebuilt with
`bash apps/capture-helper/build.sh`. See the
[durable design](../../docs/internal/design/persistent-screenshots.md) and
[public contract](../../docs/api/actions.md#action-take-screenshot).

## Explicit live runs

Select a physical device with `adb devices -l`; install the matching development
Operator through branch-local `operator setup` and use its development package.
No device work runs in CI. These commands deliberately display changing
on-screen diagnostic labels, capture images, then clear the labels. The fault
harness changes/restores rotation, kills its exact owned helper process and
forces an ADB transport reconnect. Do not run another controller concurrently.
No app navigation is replayed and no model calls are made.

```sh
node validation/persistent-screenshots/live.mjs <device_serial> /tmp/capture-backend <local_ocr_executable> backend
node validation/persistent-screenshots/live.mjs <device_serial> /tmp/capture-api <local_ocr_executable> api
node validation/persistent-screenshots/live.mjs <device_serial> /tmp/capture-cli <local_ocr_executable> cli
node validation/persistent-screenshots/faults.mjs <device_serial> /tmp/capture-faults
```

The optional local OCR executable receives one PNG path and emits JSON rows
`[{"text":"FRAME 10"}]`. It is a laboratory verifier, not shipped runtime code
or a product dependency. A 20-second timeout bounds it. Retain the PNGs and
JSON privately; they may contain personal screen content. Never commit them.
A capture passes freshness only when its current marker is present in pixels.
The scripts decode PNGs independently and keep timing outside OCR verification.

Four rounds run at explicit 100/50/25 and omitted scale (stock). Round zero is
excluded from warm aggregates. Backend/API round zero deliberately closes the
helper before each explicit scale; subsequent rounds reuse one session. CLI
round zero is a first-use pass through the existing daemon; only its first
helper capture is cold. `cold` records a new helper session, not every startup
cost of the full command. The CLI daemon may already be started by setting the
marker, so this is not a measurement of daemon startup itself.

Failure evidence is retained. Helpers are closed and the current overlay is
cleared even if validation fails. The fault runner restores both rotation
settings in `finally`. A transport reconnect is not a physical USB unplug or
Android reboot. See [findings](findings.md) for measured results and limits.
