# Experimental Settings agent-loop benchmarks

This is opt-in research tooling in `validation/`, not a supported screenshot API,
production capture backend, or bundled Decisions skill. Its purpose is to reproduce
latency comparisons and catch evidence regressions before production work begins.
Default example-skill behavior remains unchanged unless the harness installs its
experimental hooks. CI runs offline tests only; live benchmarks require an explicitly
selected device and separately authorized provider use.

The direct-buffer helper uses reflected Android internal APIs under the ADB shell
identity, validated on one physical API 37 build. It is not an Operator APK service.
The Decisions rendering gate requires macOS Vision and the tested English Settings
layout. Neither is a portable product dependency. Read the limits and cleanup steps
below before running a live experiment. Keep one controller on the device: the
prototype uses a fixed temporary DEX path and has no production session manager.

| Comparison | Modes | What changes |
| --- | --- | --- |
| Canonical execution lifetime | `cli`, `persistent` | Fresh CLI versus a retained worker calling existing Node handlers |
| Screenshot acquisition | `control`, `quarter`, `quarter-transition` | Stock versus direct quarter buffers, optionally stock after clicks |
| Decisions image size | `decisions-100`, `decisions-50`, `decisions-25` | Selected image size with full-size title probes |
| Rendering probe size | `decisions-25`, `decisions-25-fastgate` | Full-size versus quarter-size probes with verified full fallback |
| Rendering retries | `decisions-25-fastgate`, `decisions-25-retrygate` | Immediate full fallback versus up to two extra quarter probes |

Fault modes are separate recovery tests, excluded from normal timing comparisons.
Two physical comparisons are complete, each with 5/5 verified tasks per arm:

- [Fresh no-daemon CLI versus persistent Node](persistent-node-findings.md):
  30.78 s versus 22.08 s median, a 28.3% reduction.
- [Normal daemon-backed CLI versus persistent Node](daemon-node-findings.md):
  25.42 s versus 21.65 s median, a 14.8% reduction. This uses a documented
  experimental helper copy; the stock `cli` harness still disables the daemon.

The [production persistent CLI integration comparison](persistent-cli-production-findings.md)
measured 28.113 s versus 28.158 s median with unchanged command usage: no demonstrated
end-to-end gain, despite a smaller request-arrival overhead. It includes recovery,
no-replay and caller-context checks.

These are separate paired batches. A persistent screenshot helper is a different optimization. Do not infer broad vision accuracy or human
parity from successful extraction on this known, text-rich route.

## Baseline setup

The default `cli` baseline measures the existing Jev Settings helper without
changing its navigation, observation, verification, or retry policy. Requires authorized external Jev use,
`JEV_API_KEY`, an explicitly selected device, and a matching development Operator.
Use one controller on the device. This changes only navigation in Settings; it
does not tap Build number or change system configuration.

Build the branch-local CLI and verify readiness first:

```sh
npm --prefix apps/node run build
node apps/node/dist/cli/index.js devices
node apps/node/dist/cli/index.js doctor --device <device_serial> --operator-package com.androperator.operator.dev
node validation/agent-loop-latency/benchmark.cjs --device <device_serial> --out /absolute/path/to/new-trial
node validation/agent-loop-latency/benchmark.cjs --device <device_serial> --out /absolute/path/to/new-persistent-trial --backend persistent
```

The output parent must exist; the trial directory must not. Each invocation runs
one trial and refuses to resume or overwrite a previous trial. It closes Settings
outside the task timer, then runs the existing `open`, `jev`, and `finish` helpers.
The task timer includes helper process startup, initial observation, delegation,
terminal verification, and evidence writes. Jev keeps its eight-action/30-second
delegation budget and its existing HTTP retry policy. An escalation stops the
trial; do not drop failed trials or restart their budgets. Reset failures are
retained with no task duration. Successful completion exits zero; other outcomes
exit one. Inspect raw evidence before deciding any recovery.

`--backend cli` is the default and preserves fresh CLI processes. The experimental
`persistent` backend runs the same helper operations in one controller process,
using one worker thread to call the CLI's existing Node command handlers directly.
The worker retains Node module state and the existing readiness cache throughout
one task. A new controller/worker is created for each trial; their cold startup
and shutdown are included in task time. Reset uses a separate fresh CLI process
for both backends, so it does not pre-warm the persistent worker's cache.

Both backends preserve exact command arguments, snapshot presentation, logging,
no-daemon execution, candidate policy, provider settings, and completion checks.
The worker bridge keeps the helper's synchronous control flow; the original
20-second/remaining-run-budget outer command deadline still applies. On a deadline
the worker is terminated and cannot receive another command. The Android action
may have run; termination is not rollback and never triggers replay. Raw worker
errors are retained locally. This experiment changes no device transport.

For comparisons, use one warmup per backend followed by alternating paired order
(`cli,persistent` then `persistent,cli`). Retain failed attempts and compare command
and action sequences as well as time. Do not interpret fewer observations or a
different route as a pure process-lifetime improvement.

Keep raw artifacts private. The output includes hierarchies, screenshots,
extracted values, local identifiers, provider requests/responses, and CLI logs.
`summary.json` uses an explicit field allowlist to omit those contents. API keys
are supplied only through the environment and are not written by this harness.
Never commit raw trial directories. Prefer an ignored repository `tmp/` directory
with restrictive permissions for local retention.

## Measurements

- `taskMs`: complete task wall time, excluding the reset and final summary export.
- `operations`: parent-observed reset/open/Jev/finish durations. These include
  output persistence; the reset is outside `taskMs`.
- `commandCalls`: sum and distribution of existing command-ledger timings.
  CLI samples include child startup/exit; persistent samples include worker
  communication and in-process command-handler execution. Both include readiness,
  dispatch, device work and result delivery. This field replaces `cli` from
  summary schema version 1; current summaries use version 2 and include `backend`.
- `commands`: the same ledger durations grouped by operation.
- `provider.requests`: existing Jev attempt durations through response parsing
  (before successful-choice validation). Includes failed attempts; excludes retry backoff and
  request-log persistence. Cold connection and inference time are not separated.
- `spans`: opt-in helper operation, observation, and command durations. Parent
  and child spans overlap. Do not sum them together or add them to `commandCalls`.
  Persistent `operations.controller` also overlaps its open/Jev/finish phases.
- `otherMs`: task time less CLI ledger time and provider attempt time. It includes
  outer helper startup, local processing, evidence writes, retry backoff, and
  instrumentation overhead. It is not exclusively process startup.
- `failedCommands`, failed provider attempts, navigation counts, and terminal
  evidence presence accompany timing. Timing span `returned` means a function
  returned normally; a returned escalation is still a failed benchmark trial.

Enable the same local spans when manually invoking helpers with
`VERSION_TIMING=1`. The default helper behavior has timing disabled.
`timings.ndjson` contains only fixed span names, timestamps, durations, and return
status. Durations use a host monotonic clock. Synchronous trace-file writes occur
after each measured span and contribute to enclosing spans/task time.

This is a bounded, task-specific candidate-selection benchmark. The helper
already knows supported About/Software routes; it is not proof of general
unfamiliar-app navigation or human parity. Keep debug/release build, device,
starting state, policy, and cold/warm conditions explicit in reports. A human
baseline remains follow-up work; the Decisions comparison is documented below.

Offline checks (no device or provider calls):

```sh
node --test validation/agent-loop-latency/*.test.cjs examples/skills/tests/*.test.js
```

## Quarter-size screenshots in the complete Jev loop

After building/deploying `DirectCapture.java` as described in
[screenshot-scales.md](screenshot-scales.md), use `--backend control` or
`--backend quarter`. Both run one controller/worker per trial and keep every
non-screenshot operation as a fresh canonical CLI invocation. Control also uses
fresh canonical CLI screenshots. Quarter replaces screenshot acquisition with
the persistent experimental shell helper, including its cold first start and
cleanup in task time. This bypasses the canonical screenshot command's Operator
round trip and CLI overhead as well as reducing capture size. It is a whole
screenshot-path comparison, not an isolated resolution or production API test.

Quarter captures are fully PNG-decoded and checked against returned buffer/source
geometry, rotation and sequence. Viewport filtering uses verified source dimensions,
not the reduced image dimensions. Screenshot envelopes from this adapter are marked
`experimental-direct-buffer` and `experimental-shell`; they are harness evidence,
not Operator-produced command results. All actions, snapshots, provider choices,
read-value checks and terminal verification retain their existing behavior.

Run one pilot per backend, followed by five paired trials with alternating order.
Each trial now embeds doctor readiness before resetting Settings; readiness and
reset are excluded from task time. Use fresh output directories, retain failures,
and stop the sequence if readiness or a task fails. The existing Jev helper does
not send screenshots to the model; this tests task latency and evidence integrity,
not reduced-resolution vision accuracy.

An eligible session/protocol failure closes the helper and falls back to a fresh
full-resolution canonical screenshot, then uses full resolution for the remainder
of the trial. Both the original failure and fallback are retained in
`screenshot-attempts.ndjson`. Unknown Android errors, locked/rotated state,
secure-content rejection and unvalidated HDR fail closed. Overlay review always
uses full resolution. `--backend quarter-fault` deliberately closes the helper
before the second screenshot to exercise full-resolution fallback in a complete
trial. Report this separately from measured normal runs. Fallback never replays
a navigation action. Capture gets at most five seconds inside the original
command deadline, leaving time for fallback and cleanup.

No automatic low-detail model policy or general recovery service is implemented.
The prototype's pre/post geometry checks are not atomic with the snapshot. It
has no production watchdog, and forced worker termination can leave remote cleanup
uncertain; check owned processes and remove the temporary DEX after experiments.

Live review found that direct capture immediately after a successful click could
precede the destination's first rendered frame, even though the following snapshot
already represented that destination. `--backend quarter-transition` is a separate
conservative experiment: it uses the existing full-resolution screenshot path for
the observation immediately after each successful click, and direct quarter-size
captures elsewhere. Record it separately from the matched pairs. The slower path
is not a formal rendering barrier; a reliable production solution still needs
explicit visual-settling evidence. Do not equate successful extraction with fresh
intermediate screenshots. This observed failure and the fallback choice have
regression coverage in `jev-screenshots.test.cjs`.

## Decisions with screenshots and rendered-page checks

`decisions-100`, `decisions-50` and `decisions-25` run the same Settings candidate
policy through OpenAI Decisions (`gpt-6-luna`). They require `OPENAI_API_KEY` and
an executable supplied as `VERSION_SCREEN_TEXT`. Build the local pixel recognizer
on macOS using its built-in Vision framework:

```sh
swiftc -module-cache-path /tmp/androperator-swift-cache validation/agent-loop-latency/ScreenText.swift -o /tmp/androperator-screen-text
VERSION_SCREEN_TEXT=/tmp/androperator-screen-text node validation/agent-loop-latency/benchmark.cjs --device <device_serial> --out /absolute/path/to/new-trial --backend decisions-25
```

Deploy the experimental DEX first, as for the quarter-size experiment. Apple
Vision may require execution outside an agent filesystem sandbox. It processes
pixels locally; no extra OCR provider or third-party package is used. This gate
is specific to the English Settings and About phone titles on the tested phone.
Unsupported click destinations stop the experiment.

Before every accepted screenshot, the harness captures a separate full-resolution
image through the canonical CLI and recognizes the expected title in its upper
region. It then captures at the assigned size through the persistent helper and
checks the title in that actual image too. The probe, OCR, selected capture,
retries, cold helper startup and cleanup all count toward task time. The canonical
probe is intentionally conservative and expensive. It prevents the known old-page
failure; it does not synchronize every animated row or make screenshot and snapshot
atomic. Scrolls retain the page-title check, then the existing snapshot freshness,
progress and terminal field verification. Title recognition alone does not prove
all scrolling content is settled.

At most three probe attempts fit inside the existing screenshot deadline. Failed
probes are retained with attempt-specific names. An unreadable selected image is
retained as rejected, and subsequent attempts use a fresh full-resolution canonical
image. That fallback still has to pass the title check. Eligible capture transport
failures retain the existing stock fallback; rotation, lock, protected content and
unknown capture errors fail closed. No navigation action is replayed. Provider
failure, refusal or uncertain choice stops the loop; there is no automatic
provider retry with a larger image in this experiment.

Each model request includes the accepted PNG inline plus projected snapshot node
text, bounds, flags, headings, offered candidates and collected field names. Unlike
the narrower Jev input, these screenshots and nodes disclose visible device data
to the authorized provider. Local provenance paths/device IDs are omitted from the
model input, but raw evidence and private provider logs retain local references.
The model selects an offered action or escalates. Named answer type, model,
confidence (experimental threshold 0.6), allowed choice and probability distribution
are validated. A confidence value is not an accuracy guarantee.

Decisions uses an explicit 90-second delegation budget, eight-action limit and
15-second request deadline with no HTTP retries; the overall 275-second run budget
is unchanged. The wider delegation allowance accommodates rendering checks and is
identical across sizes. Default Jev behavior remains at 30 seconds. `decisions.json`
records request context, image reference/size, answer, usage and provider timing
without saving credentials or duplicating the base64 payload. `render-checks.ndjson`
records each probe and accepted/rejected image result. Summary provider timing reads
Decisions when present. Probe subprocesses are inside screenshot command spans,
not additional entries in the canonical task command ledger.

Run pilots, then at least three rounds in rotating resolution order. Compare actual
image dimensions, paths, outcomes, provider time, task time, capture time and gate
fallbacks. Inspect post-click and terminal pixels independently and compare extracted
values locally. Keep failed pilots separate and visible. Prior Jev timings use a
different observation policy and input disclosure, so they are not a matched
provider comparison. Passing this known route does not demonstrate unfamiliar-app
accuracy or human-speed control.

`decisions-25-fault` is a separate recovery trial. It closes the direct helper
before the second selected capture. The existing transport fallback supplies full
resolution thereafter, with rendering checks and model-input dimension logging
still active. Exclude this deliberate fault trial from normal size comparisons.

## Quarter-size rendering probes

`decisions-25-fastgate` keeps quarter-size model images and replaces the stock
full-size rendering probes with direct quarter-size probes from the same persistent
helper session. A recognized probe is followed by a separate selected capture and
its own title check. Probe images are not sent to the model or reused as selected
images. This isolates the probe path against `decisions-25`, whose model images
are also quarter size.

If the small probe cannot verify the expected title, preserve it and take a fresh
stock full-size probe inside the same deadline. The full probe must independently
pass the title check before the selected capture is acquired. If it still shows
the old page, continue only within the three-attempt/remaining-time bound. A rejected
selected image still switches selected captures and probes to full resolution.
Known helper transport failures retain the existing full-size fallback and disable
the direct helper for the rest of the trial. Protected/locked/rotated and unknown
capture failures do not gain a new fallback route.

The render ledger records requested probe scale and each `probe-full-fallback`
result. Requested scale is not proof of delivered dimensions: a transport fallback
may deliver a full-size probe, so inspect retained PNG dimensions and the capture
attempt ledger. All probe, fallback and OCR costs remain in task time.

Run a pilot, then three alternating pairs of `decisions-25` and
`decisions-25-fastgate`, preserving failures without replacing them. Follow with
separate recovery trials:

- `decisions-25-fastgate-ocr-fault` deliberately returns no recognized rows for
  the first probe whose original OCR recognizes About phone. Original pixels and
  OCR are retained with an explicit injected-failure marker. This simulates an
  unreadable probe to test full-size fallback; it is not evidence of a natural
  low-resolution OCR failure.
- `decisions-25-fastgate-fault` closes the helper before its second capture. With
  small probes enabled that is the first selected image, after the first probe.
  Subsequent captures use the stock full-size path; actual model-input dimensions
  must reflect that recovery.

Keep those deliberate failures outside normal timing medians. A small probe can
arrive before destination rendering; rejection is a successful safety check, not
a reason to accept old pixels. Title verification remains specific to this route
and does not prove that all scroll animation has settled.

## Bounded quarter-size re-probing

`decisions-25-retrygate` compares against `decisions-25-fastgate`. It retains the
same quarter-size selected/model images, snapshot context and visual condition.
After a rejected small probe, it permits two additional fresh quarter-size probes
before stock full-resolution fallback. No fixed sleep is added. Each retry's PNG,
OCR and `probe-retry` ledger entry are retained; a probe passing never replaces the
separate selected-image check.

The existing three outer verification attempts and common screenshot deadline
remain in force. A small retry starts only with at least four seconds remaining;
its capture and OCR budgets reserve three seconds for subsequent work. This is a
budget reservation, not a guarantee that stock capture will finish. If a full-size
fallback also shows the wrong page, another outer attempt is permitted within the
same deadline: at most nine small probes and three full probes per observation.
Capture/recognizer execution errors still fail through the existing error handling;
no expired request is restarted. Unknown policy/geometry failures do not become
eligible for fallback.

Run one pilot, then three alternating pairs against immediate full fallback.
`decisions-25-retrygate-ocr-fault` is a separate exhaustion test: every small probe's
recognition result is deliberately replaced with an empty list, while retaining
its original pixels, OCR and explicit injection marker. Full-size probe recognition
and selected-image recognition remain real. This tests that exhausted small retries
still reach independently verified full-size fallback without replaying actions.
Exclude it from normal timing medians and do not call it a natural OCR failure.


## Evidence motivating this harness

Physical-device measurements on 2026-10-10 used a Pixel 10 Pro, API 37, native
1080 x 2410 display and development Operator. These are small experimental samples,
not product performance guarantees. Retain the methods above when reproducing them.

- The original Jev baseline had a 34.98 s task median over five measured trials;
  CLI commands consumed 96.0% of mean task time, provider calls 3.4%.
- Five paired stock/direct-quarter Jev runs measured 33.64 s versus 21.19 s.
  All extracted values verified, but every quarter post-click image showed the old
  page. A valid new PNG and successful action do not prove destination rendering.
- Decisions with full-size probes measured completed-run medians of 44.94 / 42.56 /
  40.29 s at 100/50/25%. Completion was 2/3, 3/3 and 3/3: one full-size attempt
  stopped safely on low confidence, and was not replaced. This is not a controlled
  Jev-versus-Decisions comparison because input and verification policies differ.
- Three paired full-probe/quarter-probe runs measured 41.53 s versus 27.82 s, with
  3/3 completion in each arm. Each quarter-probe run rejected one old-page image
  and required a verified full-size probe.
- Three subsequent immediate-fallback/bounded-quarter-retry pairs measured 27.18 s
  versus 25.68 s, with 3/3 completion in each arm. One extra quarter probe was enough
  in each retry run. A separate forced-recognition-failure trial exhausted the small
  retries and verified all eight full-size fallbacks, completing in 48.34 s.

The last two comparisons have different contemporaneous controls. Do not combine
percentage gains across batches. Raw private trial evidence is deliberately absent
from Git; the harness records new evidence for each reproduction.

## Separate production work

The following are intentionally outside this tooling PR:

- Maintained Node capture backend: packaged helper, capability/version checks,
  setup/doctor/repair, owned sessions, bounded recovery, explicit stock fallback,
  actual resolution/coordinate metadata and cleanup/watchdog behavior.
- Rendering-verification contract: distinct action and observation outcomes,
  shared deadlines, skill-owned expected conditions, truthful failure and no replay.
  Title checks must not be advertised as scroll/content settling or atomic capture.
- Further client optimization beyond the completed [no-daemon](persistent-node-findings.md),
  [normal-daemon](daemon-node-findings.md) and [transparent CLI](transparent-cli-findings.md)
  comparisons. Keep the existing CLI interface; a new production session API and
  changes to daemon checks require separate justification. The measurements do not
  justify introducing a second daemon.
- A supported Decisions example skill and portable visual-verifier boundary.
- Broader image-dependent tasks, device/build coverage, secure/HDR and transition
  cases, matched provider comparisons and a human baseline before default changes.

## Transparent CLI startup follow-up

[Transparent CLI findings](transparent-cli-findings.md) records the first production
loading optimization after client profiling. Five physical pairs measured median
27.86 s versus 26.72 s with all tasks verified; two pairs were slower. A separate
fresh-process loading check measured 97.08 ms versus 83.86 ms. Existing commands
and daemon contracts are unchanged. These small samples are not speed guarantees.
