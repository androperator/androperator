#!/usr/bin/env node

import { spawn } from "node:child_process";
import { extname } from "node:path";

const agentCliPath = process.env.ANDROPERATOR_SKILL_AGENT_CLI_PATH;
const skillProgramPath = process.env.ANDROPERATOR_SKILL_PROGRAM;

if (!agentCliPath || !skillProgramPath) {
  console.error("Missing orchestrated skill runtime env");
  process.exit(1);
}

const forwardedArgs = process.argv.slice(2);
const spawnArgs = extname(agentCliPath) === ".js"
  ? [agentCliPath, skillProgramPath, ...forwardedArgs]
  : [skillProgramPath, ...forwardedArgs];
const child = spawn(extname(agentCliPath) === ".js" ? process.execPath : agentCliPath, spawnArgs, {
  stdio: ["ignore", "pipe", "pipe"],
  env: process.env,
});

function forwardTermination(signal) {
  if (child.exitCode === null && child.signalCode === null) {
    child.kill(signal);
  }
}

process.on("SIGTERM", () => {
  forwardTermination("SIGTERM");
});

process.on("SIGINT", () => {
  forwardTermination("SIGINT");
});

child.stdout?.on("data", (chunk) => {
  process.stdout.write(chunk);
});

child.stderr?.on("data", (chunk) => {
  process.stderr.write(chunk);
});

child.on("error", (error) => {
  console.error(error.message);
  process.exit(1);
});

child.on("close", (code, signal) => {
  if (signal) {
    process.kill(process.pid, signal);
    return;
  }
  process.exit(code ?? 1);
});
