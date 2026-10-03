You are an autonomous agent with access to a connected Android device via the
Androperator CLI. Your task is to determine the Android version running on the
device and return it as your final answer.

Environment:
- Androperator command: $ANDROPERATOR_CMD
- Operator package: $ANDROPERATOR_OPERATOR_PACKAGE
- Target device serial: $DEVICE_SERIAL
- Androperator documentation: $DOCS_URL

Instructions:
1. Open Android Settings using the Androperator CLI. The Android Settings
   app package name is: com.android.settings
2. Navigate within Settings to find the Android version. It is typically
   found under "About phone" or "About device".
   Example path: Settings -> About phone -> Android version.
3. Use the observe-decide-act loop: snapshot the current state, decide
   what to do, execute an action, repeat.
   Concrete workflow:
   1. Take a snapshot of the current UI.
   2. Inspect visible text and elements.
   3. Decide the next action (tap, open app, scroll, or go back).
   4. Execute that action.
   5. Repeat until the Android version is known.
4. When you have determined the Android version, output exactly this line:

   ANDROPERATOR_EVAL_ANSWER: <version>

   where <version> is the numeric version string only (e.g. "15" or "14",
   not "Android 15"). You may revise your answer by outputting the line
   again - the last occurrence is used.

5. If you cannot determine the version within your allowed attempts, output:

   ANDROPERATOR_EVAL_ANSWER: unknown

6. Once you know the Android version, print the answer line immediately before
   you begin any recording, skill scaffolding, or self-test work. Do not hold
   the answer until the end of the run.

## Skill Emission (required Pack A attempt)

After determining the Android version, do not stop at the answer line alone.
For Pack A, you must attempt the discovery-to-proving route and either:

- emit a reusable Androperator skill package, or
- truthfully conclude that the route cannot complete yet and omit the skill
  markers only after you have shown the blocking evidence in the transcript

Skill emission is not a free-form shortcut. You must use the Pack A
discovery-to-proving route first:

1. Check whether an installed runtime skill already matches the Settings/About
   route for `com.android.settings`.
2. If runtime-skill discovery returns no relevant match, inspect the installed
   authoring-workflow front doors with:

   `androperator bundled-skills list`

3. For this benchmark, `androperator-skill-author-by-agent-discovery` is the required
   discovery front door. It should decide whether to hand off to
   `androperator-skill-author-by-recording` to prove a reusable authored skill for this
   device family.
4. Do not bypass discovery by inventing a direct wrapper skill or a universal
   cross-device Settings skill.
5. Before you omit the skill markers, you must show the route attempt in the
   transcript:
   - runtime-skill discovery command(s)
   - `androperator bundled-skills list`
   - the discovery decision and why it blocked or handed off
6. If `androperator-skill-author-by-agent-discovery` is unavailable, incomplete, or cannot
   truthfully finish the route yet, still return the Android version answer but
   omit the skill markers entirely after recording the blocking reason.

## Pack A Benchmark Workflow

Use this exact evaluation posture:

- Do not do repo-wide grep sweeps or long doc reviews.
- Do not use web search for this benchmark. The local files and CLI surface are
  sufficient.
- If you need local guidance, open only these files:
  - `apps/node/bundled-skills/androperator-skill-author-by-agent-discovery/SKILL.md`
  - `apps/node/bundled-skills/androperator-skill-author-by-recording/SKILL.md`
  - `apps/node/src/contracts/skillResult.ts`
  - `apps/node/src/test/fixtures/skills/com.test.skill-result/scripts/emit_skill_result.js`
- Do not run `--help` on commands unless a command actually fails and you are
  blocked.
- Do not print or inspect full snapshot XML, full recording exports, or full
  scaffold files when a targeted command or direct overwrite will do.
- When you need snapshot evidence, use a filtered command shape such as:
  `$ANDROPERATOR_CMD snapshot --device $DEVICE_SERIAL --operator-package $ANDROPERATOR_OPERATOR_PACKAGE | jq -r '.envelope.stepResults[0].data.text' | rg ...`
  so the transcript only includes the relevant rows.
- After `open com.android.settings`, wait briefly before the first snapshot.
  A short `sleep` is cheaper than recovering from a launcher snapshot.
- Do not use `sed -n` on raw snapshot XML for this benchmark. Grep only the
  specific labels you need from the filtered snapshot text.
- Use one bounded discovery pass, one proving pass, and one self-test pass.
- Because this eval runs in a local shell agent context, do not wait for a
  human after `recording start`. Start recording, perform the Settings flow
  yourself with Androperator commands, then stop, pull, and export.
- For this benchmark, the truthful proving target is a target-specific replay
  skill created from one recording-derived scaffold unless discovery uncovers a
  concrete reason replay would be untruthful.
- Use a device-family-specific skill id:
  - emulator / AOSP: `com.android.settings.read-android-version-aosp-replay`
  - Samsung: `com.android.settings.read-android-version-samsung-replay`
- After recording export, use `androperator skills new <skill_id> --recording-context <export_json>`,
  patch the scaffold into a truthful Settings/About-device replay skill, run
  `androperator skills validate <skill_id>`, then run one
  `androperator skills run <skill_id> --device $DEVICE_SERIAL --operator-package $ANDROPERATOR_OPERATOR_PACKAGE`
  self-test.
- After `skills new`, overwrite the scaffold directly instead of reading it
  line by line.
- Fastest truthful path for this benchmark: overwrite `SKILL.md` and
  `scripts/run.js`, keep `scripts/run.sh` as the thin delegate, and leave the
  scaffolded `skill.json` unchanged unless you also update the matching entry
  in `~/.androperator/skills/skills/skills-registry.json`.
- Use the already-proven minimal replay shape instead of inventing a richer
  wrapper. Keep the generated helper functions at the top of `scripts/run.js`,
  then replace everything from `const [, , deviceId, operatorPackageArg] =
  process.argv;` through EOF with the template below after substituting the
  device-family constants:
  - AOSP constants:
    - `skillId = "com.android.settings.read-android-version-aosp-replay"`
    - `searchQuery = "About emulated device"`
    - `resultCoordinate = ["300", "420"]`
    - `routeNote = "About emulated device"`
    - `terminalNote = "The replay parser matched the Android version row on the AOSP About screen."`
    - `diagnosticHint = "This replay tolerates Settings resuming directly into the search surface on the AOSP emulator."`
  - Samsung constants:
    - `skillId = "com.android.settings.read-android-version-samsung-replay"`
    - `searchQuery = "Android version"`
    - `resultCoordinate = ["300", "690"]`
    - `routeNote = "Software information"`
    - `terminalNote = "The replay parser matched the Android version row on the Samsung Software information screen."`
    - `diagnosticHint = "This replay depends on the current Samsung search result placement for the Android version route."`
- Proven `SKILL.md` body shape:

  ```md
  ---
  name: <skill_id>
  androperator-skill-type: replay
  description: |-
    Open Android Settings on a <device_family> device, navigate to <route_note>,
    and read the Android version.
  ---

  Replay skill for the Android Settings app on a <device_family> device family.

  This skill:

  - closes and reopens Android Settings
  - searches for the target Settings route
  - opens the known result row
  - captures a fresh snapshot on the destination screen
  - extracts the numeric Android version from the `Android version` row
  - emits `ANDROPERATOR_EVAL_ANSWER: <version>` followed by one terminal
    `[Androperator-Skill-Result]` frame

  ## Output

  On success, the script prints:

  ```text
  ANDROPERATOR_EVAL_ANSWER: <version>
  ```

  ## Caveats

  - This replay is target-specific to the recorded Settings route for this
    device family.
  - It relies on the current destination screen still exposing an
    `Android version` title row with a nearby summary value.

  Usage:

  ```bash
  node skills/<skill_id>/scripts/run.js <device_id> [operator_package]
  ```
  ```

- Proven `scripts/run.js` bottom-half replacement:

  ```js
  function sleep(ms) {
    return new Promise((resolvePromise) => {
      setTimeout(resolvePromise, ms);
    });
  }

  function parseJson(raw) {
    try {
      return JSON.parse(raw);
    } catch {
      return null;
    }
  }

  function runAndroperatorJson(commandArgs, options = {}) {
    const allowFailure = options.allowFailure === true;
    try {
      const stdout = execFileSync(
        resolvedAndroperatorBin.cmd,
        [...resolvedAndroperatorBin.args, ...commandArgs],
        {
          encoding: "utf8",
          timeout: 120000,
          stdio: ["ignore", "pipe", "pipe"],
        }
      );
      return {
        ok: true,
        raw: stdout,
        json: parseJson(stdout),
      };
    } catch (err) {
      const stdout = err?.stdout?.toString?.("utf8") ?? "";
      const stderr = err?.stderr?.toString?.("utf8") ?? "";
      const parsed = parseJson(stdout);
      if (allowFailure) {
        return {
          ok: false,
          raw: stdout,
          stderr,
          json: parsed,
        };
      }
      const message = stderr || stdout || err?.message || "androperator command failed";
      throw new Error(message);
    }
  }

  function snapshotTextFromResponse(response) {
    return response?.json?.envelope?.stepResults?.[0]?.data?.text ?? "";
  }

  function extractAndroidVersion(snapshotText) {
    const matches = [...String(snapshotText).matchAll(/<node[^>]*text="([^"]*)"[^>]*resource-id="([^"]*)"[^>]*>/g)];
    for (let index = 0; index < matches.length; index += 1) {
      const [, text, resourceId] = matches[index];
      if (text !== "Android version" || resourceId !== "android:id/title") {
        continue;
      }
      for (let lookahead = index + 1; lookahead < Math.min(matches.length, index + 4); lookahead += 1) {
        const [, summaryText, summaryResourceId] = matches[lookahead];
        if (summaryResourceId !== "android:id/summary") {
          continue;
        }
        const numeric = String(summaryText).match(/\d+(?:\.\d+)?/);
        if (numeric) {
          return numeric[0];
        }
        return String(summaryText).trim();
      }
    }
    return null;
  }

  const [, , deviceId, operatorPackageArg] = process.argv;

  if (!deviceId) {
    console.error("Usage: node run.js <device_id> [operator_package]");
    process.exit(1);
  }

  const operatorPackage = resolveOperatorPackage(operatorPackageArg);
  const resolvedAndroperatorBin = resolveAndroperatorBin();
  const skillId = "<skill_id>";
  const searchQuery = "<search_query>";
  const resultCoordinateX = "<result_x>";
  const resultCoordinateY = "<result_y>";
  const routeNote = "<route_note>";
  const skillResultFramePrefix = "[Androperator-Skill-Result]";
  const skillResultContractVersion = "1.0.0";

  async function main() {
    runAndroperatorJson([
      "close",
      "--app",
      "com.android.settings",
      "--device",
      deviceId,
      "--operator-package",
      operatorPackage,
    ]);

    runAndroperatorJson([
      "open",
      "com.android.settings",
      "--device",
      deviceId,
      "--operator-package",
      operatorPackage,
    ]);

    await sleep(2000);

    runAndroperatorJson([
      "click",
      "--text",
      "Search settings",
      "--device",
      deviceId,
      "--operator-package",
      operatorPackage,
    ], { allowFailure: true });

    runAndroperatorJson([
      "type",
      searchQuery,
      "--role",
      "textfield",
      "--device",
      deviceId,
      "--operator-package",
      operatorPackage,
    ]);

    runAndroperatorJson([
      "click",
      "--coordinate",
      resultCoordinateX,
      resultCoordinateY,
      "--device",
      deviceId,
      "--operator-package",
      operatorPackage,
    ]);

    await sleep(1500);

    let snapshotResponse = runAndroperatorJson([
      "snapshot",
      "--device",
      deviceId,
      "--operator-package",
      operatorPackage,
    ]);
    let version = extractAndroidVersion(snapshotTextFromResponse(snapshotResponse));

    if (!version) {
      await sleep(1500);
      snapshotResponse = runAndroperatorJson([
        "snapshot",
        "--device",
        deviceId,
        "--operator-package",
        operatorPackage,
      ]);
      version = extractAndroidVersion(snapshotTextFromResponse(snapshotResponse));
    }

    if (!version) {
      throw new Error("Could not extract Android version from the " + routeNote + " snapshot.");
    }

    console.log("ANDROPERATOR_EVAL_ANSWER: " + version);
    console.log(skillResultFramePrefix);
    console.log(JSON.stringify({
      contractVersion: skillResultContractVersion,
      skillId,
      goal: {
        kind: "read_android_version",
      },
      inputs: {},
      status: "success",
      checkpoints: [
        {
          id: "settings-opened",
          status: "ok",
          note: "Closed and reopened Android Settings for a fresh replay run.",
        },
        {
          id: "settings-route-opened",
          status: "ok",
          note: "Navigated through Settings search to " + routeNote + ".",
        },
        {
          id: "android-version-read",
          status: "ok",
          evidence: {
            kind: "text",
            text: version,
          },
          note: "Extracted the Android version summary from the destination screen.",
        },
      ],
      terminalVerification: {
        status: "verified",
        expected: {
          kind: "text",
          text: "Numeric Android version from Settings -> " + routeNote,
        },
        observed: {
          kind: "text",
          text: "ANDROPERATOR_EVAL_ANSWER: " + version,
        },
        note: "<terminal_note>",
      },
      diagnostics: {
        runtimeState: "healthy",
        hints: ["<diagnostic_hint>"],
      },
    }));
  }

  main().catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(2);
  });
  ```

- If you do change `skill.json`, sync the matching registry entry before
  running `skills validate`, or validation will fail on metadata mismatch.
- `SKILL.md` frontmatter must include `androperator-skill-type: replay`.
- Do not inspect `recording-context.json` after scaffolding. The recorded
  export already served its purpose once the scaffold exists.
- For the AOSP emulator route, use this fixed proving path:
  - `$ANDROPERATOR_CMD close --app com.android.settings --device $DEVICE_SERIAL --operator-package $ANDROPERATOR_OPERATOR_PACKAGE`
  - `$ANDROPERATOR_CMD open com.android.settings --device $DEVICE_SERIAL --operator-package $ANDROPERATOR_OPERATOR_PACKAGE`
  - `sleep 2`
  - `$ANDROPERATOR_CMD click --text "Search settings" --device $DEVICE_SERIAL --operator-package $ANDROPERATOR_OPERATOR_PACKAGE`
  - `$ANDROPERATOR_CMD type "About emulated device" --role textfield --device $DEVICE_SERIAL --operator-package $ANDROPERATOR_OPERATOR_PACKAGE`
  - `$ANDROPERATOR_CMD click --coordinate 300 420 --device $DEVICE_SERIAL --operator-package $ANDROPERATOR_OPERATOR_PACKAGE`
  - extract the version from a filtered fresh snapshot on the About screen
- For the Samsung route, use this fixed proving path:
  - `$ANDROPERATOR_CMD close --app com.android.settings --device $DEVICE_SERIAL --operator-package $ANDROPERATOR_OPERATOR_PACKAGE`
  - `$ANDROPERATOR_CMD open com.android.settings --device $DEVICE_SERIAL --operator-package $ANDROPERATOR_OPERATOR_PACKAGE`
  - `sleep 2`
  - `$ANDROPERATOR_CMD click --text "Search settings" --device $DEVICE_SERIAL --operator-package $ANDROPERATOR_OPERATOR_PACKAGE`
  - `$ANDROPERATOR_CMD type "Android version" --role textfield --device $DEVICE_SERIAL --operator-package $ANDROPERATOR_OPERATOR_PACKAGE`
  - `$ANDROPERATOR_CMD click --coordinate 300 690 --device $DEVICE_SERIAL --operator-package $ANDROPERATOR_OPERATOR_PACKAGE`
  - click the known result row under `Software information`
  - extract the version from a filtered fresh snapshot on the Software
    information screen
- Do not rely on `read-value --label "Android version"` for this benchmark.
- In the replay script, print `ANDROPERATOR_EVAL_ANSWER: <version>` before the
  terminal `[Androperator-Skill-Result]` frame, and make the framed JSON the
  final non-empty stdout content.
- Keep the authored skill target-specific. Do not emit one universal Settings
  skill for all OEMs.
- After the self-test passes, emit the exact authored package between the skill
  markers with the same file contents used for that self-test.

If you do emit a skill, output it between these exact markers:

ANDROPERATOR_SKILL_START
<skill JSON here>
ANDROPERATOR_SKILL_END

The JSON object must be valid UTF-8 JSON and must satisfy the Androperator
skill registry contract. At minimum, it must include these top-level fields:

- `id`
- `applicationId`
- `intent`
- `summary`
- `path`
- `skillFile`
- `scripts`
- `artifacts`

To make the skill replayable, include these inline file-content
fields at the top level as required by the paths you provide:

- `skillMarkdown` - the exact Markdown body for `skillFile`
- `scriptContents` - an object whose keys are the script paths from `scripts`
  and whose values are the script source text. If `scripts` is non-empty, you
  must provide `scriptContents` for every path listed in `scripts`, or replay
  will fail.
- `artifactContents` - an object whose keys are the artifact paths from
  `artifacts` and whose values are the artifact source text. If `artifacts` is
  non-empty, you must provide `artifactContents` for every path listed in
  `artifacts`, or replay will fail.

The JSON object should describe a target-specific authored skill for the
current device family, rooted at `com.android.settings`, after the required
discovery route completes. Do not emit a direct minimal wrapper that only
prints the answer, and do not emit one universal skill meant to cover every
OEM or Settings variant.

Before emitting the skill block, run one self-test on this same device and make
sure the authored skill emits a valid `SkillResult`.

The authored skill's runtime output must include the line:

ANDROPERATOR_EVAL_ANSWER: <version>

Use the numeric Android version only as the `<version>` value.

If you cannot produce a valid authored skill package through the required
discovery route, omit the markers entirely.

Do not end the run immediately after printing `ANDROPERATOR_EVAL_ANSWER`.
Continue until the Pack A route has either emitted a valid skill package or
produced a truthful blocked-route conclusion in the transcript.

Constraints:
- Use only Androperator commands for device interaction. Do not use adb
  shell commands or any other method to read the version.
- Execute Androperator commands exactly as shell commands using the provided
  base command. Do not reinterpret or rewrite the command structure.
- Reference the public documentation at $DOCS_URL as the baseline. If the
  current run exposes repo-local docs and source, you may inspect them too.
- Use $ANDROPERATOR_CMD as the command to invoke Androperator
  (e.g. `node /home/user/repo/apps/node/dist/cli/index.js` or `androperator`).
- Pass --device $DEVICE_SERIAL on every Androperator command.
- Pass --operator-package $ANDROPERATOR_OPERATOR_PACKAGE on every
  Androperator command.
