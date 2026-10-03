#!/usr/bin/env node

const args = process.argv.slice(2);
let mode = "valid";
let cliSkillId;
let modeSetFromArgs = false;

for (let index = 0; index < args.length; index += 1) {
  const arg = args[index];

  if (arg === "--mode") {
    mode = args[index + 1] || mode;
    modeSetFromArgs = true;
    index += 1;
    continue;
  }

  if (arg.startsWith("--mode=")) {
    mode = arg.slice("--mode=".length) || mode;
    modeSetFromArgs = true;
    continue;
  }

  if (arg === "--skill-id") {
    cliSkillId = args[index + 1];
    index += 1;
    continue;
  }

  if (arg.startsWith("--skill-id=")) {
    cliSkillId = arg.slice("--skill-id=".length);
    continue;
  }

  if (!arg.startsWith("--") && !modeSetFromArgs) {
    mode = arg || "valid";
    modeSetFromArgs = true;
  }
}

const skillId = cliSkillId || process.env.TEST_SKILL_ID || "com.test.skill-result";
mode = process.env.TEST_SKILL_MODE || mode;
const prefix = "[Androperator-Skill-Result]";

const basePayload = {
  contractVersion: "1.0.0",
  skillId,
  goal: {
    kind: "set",
    target: "demo",
  },
  inputs: {
    targetPercent: 40,
  },
  result: null,
  status: "success",
  checkpoints: [
    {
      id: "text-checkpoint",
      status: "ok",
      evidence: {
        kind: "text",
        text: "Discharge to 40%",
      },
    },
    {
      id: "json-checkpoint",
      status: "ok",
      evidence: {
        kind: "json",
        value: {
          observed: true,
        },
      },
    },
    {
      id: "exec-checkpoint",
      status: "skipped",
      evidence: {
        kind: "result_envelope_ref",
        execEnvelopeIndex: 0,
        stepResultId: "step-1",
      },
    },
  ],
  terminalVerification: {
    status: "verified",
    expected: {
      kind: "text",
      text: "Discharge to 40%",
    },
    observed: {
      kind: "text",
      text: "Discharge to 40%",
    },
  },
  execEnvelopes: [
    {
      commandId: "cmd-1",
      taskId: "task-1",
      status: "success",
      stepResults: [
        {
          id: "step-1",
          actionType: "tap",
          success: true,
          data: {
            selector: "text=Save",
          },
        },
      ],
      error: null,
    },
  ],
  diagnostics: {
    runtimeState: "healthy",
    warnings: ["minor warning"],
  },
};

function emitFrame(payload) {
  console.log("progress:before-frame");
  console.log(prefix);
  console.log(JSON.stringify(payload));
}

switch (mode) {
  case "valid":
    emitFrame(basePayload);
    break;
  case "missing-result": {
    const payload = { ...basePayload };
    delete payload.result;
    emitFrame(payload);
    break;
  }
  case "legacy":
    console.log("legacy-output-only");
    break;
  case "marker-progress-only":
    console.log("progress:before-marker");
    console.log(prefix);
    console.log("progress:after-marker");
    break;
  case "marker-progress-before-valid-frame":
    console.log("progress:before-marker");
    console.log(prefix);
    console.log("progress:after-marker");
    emitFrame(basePayload);
    break;
  case "frame-with-trailing-output":
    emitFrame(basePayload);
    console.log("trailing-output-after-frame");
    break;
  case "whitespace-padded-frame-marker":
    console.log("progress:before-frame");
    console.log(` ${prefix} `);
    console.log(JSON.stringify(basePayload));
    break;
  case "malformed-json":
    console.log(prefix);
    console.log("{not-json");
    break;
  case "multiple":
    emitFrame(basePayload);
    console.log(prefix);
    console.log(JSON.stringify(basePayload));
    break;
  case "unsupported-major":
    emitFrame({
      ...basePayload,
      contractVersion: "2.0.0",
    });
    break;
  case "newer-minor":
    emitFrame({
      ...basePayload,
      contractVersion: "1.2.0",
      extraField: "future",
    });
    break;
  case "raw-envelope-data":
    emitFrame({
      ...basePayload,
      execEnvelopes: [
        {
          commandId: "cmd-raw",
          taskId: "task-raw",
          status: "success",
          stepResults: [
            {
              id: "step-raw",
              actionType: "wait",
              success: true,
              data: {
                duration_ms: 1000,
                ok: true,
                retries: 0,
                note: "kept",
              },
            },
          ],
          error: null,
        },
      ],
    });
    break;
  case "with-source":
    emitFrame({
      ...basePayload,
      source: {
        kind: "script",
      },
    });
    break;
  case "mismatch-skill-id":
    emitFrame({
      ...basePayload,
      skillId: "com.test.other-skill",
    });
    break;
  case "result-valid":
    emitFrame({
      contractVersion: basePayload.contractVersion,
      skillId: basePayload.skillId,
      goal: basePayload.goal,
      inputs: basePayload.inputs,
      result: { kind: "json", value: { amount: "-$3.10" } },
      status: "success",
      checkpoints: basePayload.checkpoints,
      terminalVerification: basePayload.terminalVerification,
      execEnvelopes: basePayload.execEnvelopes,
      diagnostics: basePayload.diagnostics,
    });
    break;
  case "result-plain-object":
    emitFrame({
      contractVersion: basePayload.contractVersion,
      skillId: basePayload.skillId,
      goal: basePayload.goal,
      inputs: basePayload.inputs,
      result: { amount: "-$3.10" },
      status: "success",
      checkpoints: basePayload.checkpoints,
      terminalVerification: basePayload.terminalVerification,
      execEnvelopes: basePayload.execEnvelopes,
      diagnostics: basePayload.diagnostics,
    });
    break;
  case "partial-frame-timeout":
    console.log("progress:before-frame");
    console.log(prefix);
    process.stdout.write("{\"contractVersion\":\"1.0.0\"");
    setTimeout(() => {
      process.exit(0);
    }, 1000);
    break;
  case "fail":
    emitFrame({
      ...basePayload,
      status: "failed",
      checkpoints: [
        ...basePayload.checkpoints,
        {
          id: "terminal-state-verified",
          status: "failed",
          note: "value mismatch",
        },
      ],
      terminalVerification: {
        status: "failed",
        expected: {
          kind: "text",
          text: "Discharge to 40%",
        },
        observed: {
          kind: "text",
          text: "Discharge to 35%",
        },
      },
      diagnostics: {
        runtimeState: "poisoned",
      },
    });
    console.error("FAIL_OUTPUT:skill-result");
    process.exit(9);
    break;
  case "mismatched-success":
    emitFrame({
      ...basePayload,
      terminalVerification: {
        status: "verified",
        expected: {
          kind: "text",
          text: "Discharge to 40%",
        },
        observed: {
          kind: "text",
          text: "Charge to 40%",
        },
      },
    });
    break;
  case "extra-inputs":
    emitFrame({
      ...basePayload,
      inputs: {
        ...basePayload.inputs,
        diagnosticNote: "kept-for-debugging",
      },
    });
    break;
  case "proved-indeterminate-status":
    emitFrame({
      ...basePayload,
      status: "indeterminate",
      terminalVerification: {
        status: "verified",
        expected: {
          kind: "text",
          text: "Discharge to 40%",
        },
        observed: {
          kind: "text",
          text: "Discharge to 40%",
        },
      },
    });
    break;
  case "decorated-success":
    emitFrame({
      ...basePayload,
      terminalVerification: {
        status: "verified",
        expected: {
          kind: "text",
          text: "Discharge to 40%",
        },
        observed: {
          kind: "text",
          text: "Discharge to 40% \ue660",
        },
      },
    });
    break;
  case "spoofed-inputs":
    emitFrame({
      ...basePayload,
      inputs: {
        targetPercent: 35,
      },
      terminalVerification: {
        status: "verified",
        expected: {
          kind: "text",
          text: "Discharge to 35%",
        },
        observed: {
          kind: "text",
          text: "Discharge to 35%",
        },
      },
    });
    break;
  case "failed-zero-exit":
    emitFrame({
      ...basePayload,
      status: "failed",
      terminalVerification: {
        status: "failed",
        expected: {
          kind: "text",
          text: "Discharge to 40%",
        },
        observed: {
          kind: "text",
          text: "Discharge to 35%",
        },
      },
      diagnostics: {
        runtimeState: "poisoned",
        warnings: ["terminal verification failed"],
      },
    });
    break;
  default:
    console.error(`Unknown mode: ${mode}`);
    process.exit(1);
}
