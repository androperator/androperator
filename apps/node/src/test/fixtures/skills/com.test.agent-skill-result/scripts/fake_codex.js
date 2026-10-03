#!/usr/bin/env node

const args = process.argv.slice(2);
const skillProgramPath = args[0];
const mode = args[1] || "valid";
const skillId = process.env.ANDROPERATOR_SKILL_ID || "com.test.agent-skill-result";
const prefix = "[Androperator-Skill-Result]";

if (!skillProgramPath) {
  console.error("missing skill program");
  process.exit(3);
}

if (
  process.env.EXPECTED_SKILL_PROGRAM_PATH !== undefined &&
  skillProgramPath !== process.env.EXPECTED_SKILL_PROGRAM_PATH
) {
  console.error("unexpected skill program path");
  process.exit(8);
}

if (
  process.env.ANDROPERATOR_SKILL_INPUTS !== undefined &&
  process.env.ANDROPERATOR_SKILL_INPUTS !== JSON.stringify(args.slice(1))
) {
  console.error("unexpected forwarded skill inputs");
  process.exit(4);
}

if (
  process.env.EXPECTED_SKILLS_DIR !== undefined &&
  process.env.ANDROPERATOR_SKILLS_DIR !== process.env.EXPECTED_SKILLS_DIR
) {
  console.error("unexpected skills registry path");
  process.exit(6);
}

if (
  process.env.EXPECTED_SKILL_TIMEOUT_MS !== undefined &&
  process.env.ANDROPERATOR_SKILL_AGENT_TIMEOUT_MS !== process.env.EXPECTED_SKILL_TIMEOUT_MS
) {
  console.error("unexpected skill timeout env");
  process.exit(7);
}

if (
  process.env.EXPECTED_DEVICE_ID !== undefined &&
  process.env.ANDROPERATOR_DEVICE_ID !== process.env.EXPECTED_DEVICE_ID
) {
  console.error("unexpected device id env");
  process.exit(10);
}

const basePayload = {
  contractVersion: "1.0.0",
  skillId,
  goal: {
    kind: "set_discharge_limit",
    percent: 40,
  },
  inputs: {
    percent: 40,
  },
  result: null,
  status: "success",
  checkpoints: [
    { id: "app_opened", status: "ok" },
    { id: "discharge_to_row_focused", status: "ok" },
    { id: "target_text_entered", status: "ok" },
    { id: "save_completed", status: "ok" },
    { id: "terminal_state_verified", status: "ok" },
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
  diagnostics: {
    runtimeState: "healthy",
  },
};

switch (mode) {
  case "valid":
    process.stderr.write(`agent-reading:${skillProgramPath}\n`);
    console.log(prefix);
    console.log(JSON.stringify(basePayload));
    process.exit(0);
    break;
  case "agent-fail":
    process.stderr.write("agent failed intentionally\n");
    process.exit(17);
    break;
  case "malformed-json":
    console.log(prefix);
    console.log("{not-json");
    process.exit(0);
    break;
  case "indeterminate":
    console.log(prefix);
    console.log(JSON.stringify({
      ...basePayload,
      status: "indeterminate",
      checkpoints: basePayload.checkpoints.map((checkpoint, index) => (
        index === basePayload.checkpoints.length - 1
          ? { ...checkpoint, status: "skipped", note: "recovery path preserved terminal verification uncertainty" }
          : checkpoint
      )),
      terminalVerification: {
        status: "not_run",
        note: "agent stopped before terminal verification",
      },
    }));
    process.exit(0);
    break;
  case "recovery-success":
    console.log(prefix);
    console.log(JSON.stringify({
      ...basePayload,
      checkpoints: [
        { id: "app_opened", status: "ok", note: "app reopened once before proceeding" },
        { id: "discharge_to_row_focused", status: "ok" },
        { id: "target_text_entered", status: "ok", note: "recovery branch still reached target input" },
        { id: "save_completed", status: "ok" },
        { id: "terminal_state_verified", status: "ok" },
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
        note: "recovery branch preserved terminal verification",
      },
    }));
    process.exit(0);
    break;
  case "timeout":
    process.stdout.write('{"stage":"before-timeout"}\n');
    {
      const heartbeat = setInterval(() => {
        process.stdout.write('{"stage":"waiting-for-timeout"}\n');
      }, 20);
      heartbeat.unref?.();
    }
    setTimeout(() => {
      console.log(prefix);
      console.log(JSON.stringify(basePayload));
      process.exit(0);
    }, 1000);
    break;
  case "env-check":
    console.log(prefix);
    console.log(JSON.stringify(basePayload));
    process.exit(0);
    break;
  case "no-frame-success":
    console.log("agent completed without framed result");
    process.exit(0);
    break;
  default:
    console.error(`unknown mode:${mode}`);
    process.exit(5);
}
