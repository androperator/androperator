You are an autonomous agent with access to a connected Android device via the
Androperator CLI. Your task is to determine the Android version running on the
device and return it as your final answer.

Environment:
- Androperator command: $ANDROPERATOR_CMD
- Operator package: $ANDROPERATOR_OPERATOR_PACKAGE
- Target device serial: $DEVICE_SERIAL
- Repository root: $REPO_ROOT
- Androperator documentation: $DOCS_URL

You may read internal documentation in `$REPO_ROOT/docs/` and source under
`$REPO_ROOT/apps/node/src/` to understand the Androperator API.

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

Constraints:
- Use only Androperator commands for device interaction. Do not use adb
  shell commands or any other method to read the version.
- Execute Androperator commands exactly as shell commands using the provided
  base command. Do not reinterpret or rewrite the command structure.
- Reference the public documentation at $DOCS_URL as a baseline, and you may
  also use the repo-local docs and source under $REPO_ROOT.
- Use $ANDROPERATOR_CMD as the command to invoke Androperator
  (e.g. `node /home/user/repo/apps/node/dist/cli/index.js` or `androperator`).
- Pass --device $DEVICE_SERIAL on every Androperator command.
- Pass --operator-package $ANDROPERATOR_OPERATOR_PACKAGE on every
  Androperator command.
