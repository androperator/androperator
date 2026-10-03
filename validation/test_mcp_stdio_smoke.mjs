#!/usr/bin/env node

import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import path from "node:path";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const cliEntrypoint = path.join(repoRoot, "apps/node/dist/cli/index.js");
function resolveSmokeOperatorPackage(value) {
  if (value === undefined) {
    return "com.androperator.operator.dev";
  }

  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : "com.androperator.operator.dev";
}

const operatorPackage = resolveSmokeOperatorPackage(process.env.ANDROPERATOR_OPERATOR_PACKAGE);
const preferredDevice = process.env.ANDROPERATOR_SMOKE_DEVICE;

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function decodeXmlEntities(value) {
  return value
    .replaceAll("&amp;", "&")
    .replaceAll("&quot;", "\"")
    .replaceAll("&apos;", "'")
    .replaceAll("&lt;", "<")
    .replaceAll("&gt;", ">");
}

function buildCandidateKey(selector) {
  return JSON.stringify(selector);
}

function appendCandidate(candidates, seen, selector, label, maxCandidates) {
  if (candidates.length >= maxCandidates) {
    return;
  }

  const key = buildCandidateKey(selector);
  if (seen.has(key)) {
    return;
  }

  seen.add(key);
  candidates.push({ selector, label });
}

function extractCandidateTexts(snapshotXml, maxCandidates = 5) {
  const textCandidates = [...snapshotXml.matchAll(/\btext="([^"]+)"/g)]
    .map((match) => decodeXmlEntities(match[1] ?? "").trim())
    .filter((value) => value.length > 0);
  const descCandidates = [...snapshotXml.matchAll(/\bcontent-desc="([^"]+)"/g)]
    .map((match) => decodeXmlEntities(match[1] ?? "").trim())
    .filter((value) => value.length > 0);

  const candidates = [];
  const seen = new Set();
  const maxLength = Math.max(textCandidates.length, descCandidates.length);

  for (let index = 0; index < maxLength && candidates.length < maxCandidates; index += 1) {
    const textValue = textCandidates[index];
    if (textValue !== undefined) {
      appendCandidate(candidates, seen, { text: textValue }, `text=${JSON.stringify(textValue)}`, maxCandidates);
    }

    const descValue = descCandidates[index];
    if (descValue !== undefined) {
      appendCandidate(candidates, seen, { desc: descValue }, `desc=${JSON.stringify(descValue)}`, maxCandidates);
    }
  }

  return candidates;
}

function parseToolPayload(result) {
  const textBlock = result?.content?.find((item) => item?.type === "text")?.text;
  if (typeof textBlock !== "string") {
    throw new Error("MCP tool result did not include text content");
  }
  return JSON.parse(textBlock);
}

class McpSession {
  constructor(child) {
    this.child = child;
    this.nextId = 1;
    this.buffer = "";
    this.pending = new Map();
    this.notifications = [];

    child.stdout.setEncoding("utf8");
    child.stdout.on("data", (chunk) => this.handleStdout(chunk));
    child.stderr.setEncoding("utf8");
    child.stderr.on("data", (chunk) => process.stderr.write(chunk));

    const rejectAll = (error) => {
      for (const { reject, timeout } of this.pending.values()) {
        clearTimeout(timeout);
        reject(error);
      }
      this.pending.clear();
    };
    child.once("exit", (code) => {
      rejectAll(new Error(`MCP server exited unexpectedly with code ${code}`));
    });
    child.once("error", (err) => {
      rejectAll(new Error(`MCP server process error: ${err.message}`));
    });
  }

  handleStdout(chunk) {
    this.buffer += chunk;
    let newlineIndex = this.buffer.indexOf("\n");
    while (newlineIndex >= 0) {
      const line = this.buffer.slice(0, newlineIndex).trim();
      this.buffer = this.buffer.slice(newlineIndex + 1);
      if (line.length > 0) {
        this.handleMessage(line);
      }
      newlineIndex = this.buffer.indexOf("\n");
    }
  }

  handleMessage(line) {
    let message;
    try {
      message = JSON.parse(line);
    } catch {
      const error = new Error(`Non-JSON bytes received on MCP stdout: ${line.slice(0, 200)}`);
      for (const { reject, timeout } of this.pending.values()) {
        clearTimeout(timeout);
        reject(error);
      }
      this.pending.clear();
      return;
    }
    if ("id" in message && this.pending.has(message.id)) {
      const { resolve, reject, timeout } = this.pending.get(message.id);
      clearTimeout(timeout);
      this.pending.delete(message.id);
      if ("error" in message) {
        reject(new Error(JSON.stringify(message.error)));
      } else {
        resolve(message.result);
      }
      return;
    }
    this.notifications.push(message);
  }

  request(method, params = undefined, timeoutMs = 15000) {
    const id = this.nextId++;
    const payload = {
      jsonrpc: "2.0",
      id,
      method,
      ...(params !== undefined ? { params } : {}),
    };

    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`Timed out waiting for ${method}`));
      }, timeoutMs);

      this.pending.set(id, { resolve, reject, timeout });
      this.child.stdin.write(`${JSON.stringify(payload)}\n`);
    });
  }

  async initialize() {
    const result = await this.request("initialize", {
      protocolVersion: "2024-11-05",
      capabilities: {},
      clientInfo: {
        name: "androperator-smoke",
        version: "1.0.0",
      },
    });
    this.child.stdin.write(`${JSON.stringify({ jsonrpc: "2.0", method: "notifications/initialized" })}\n`);
    return result;
  }

  async close() {
    this.child.stdin.end();
    const code = this.child.exitCode ?? await new Promise((resolve) => {
      this.child.once("exit", (exitCode) => resolve(exitCode));
    });
    if (code !== 0) {
      throw new Error(`MCP server exited with code ${code}`);
    }
  }
}

function chooseDevice(devices) {
  if (preferredDevice) {
    const exact = devices.find((device) => device.serial === preferredDevice && device.state === "device");
    if (!exact) {
      throw new Error(`Requested ANDROPERATOR_SMOKE_DEVICE ${preferredDevice} is not connected in device state`);
    }
    return exact.serial;
  }

  const ready = devices.filter((device) => device.state === "device");
  const physical = ready.find((device) => !device.serial.startsWith("emulator-"));
  return physical?.serial ?? ready[0]?.serial;
}

async function main() {
  const child = spawn(process.execPath, [cliEntrypoint, "mcp", "serve"], {
    cwd: repoRoot,
    env: process.env,
    stdio: ["pipe", "pipe", "pipe"],
  });

  const session = new McpSession(child);

  try {
    const init = await session.initialize();
    if (init?.serverInfo?.name !== "androperator") {
      throw new Error("Unexpected MCP server info");
    }

    const tools = await session.request("tools/list", {});
    const toolNames = new Set((tools?.tools ?? []).map((tool) => tool.name));
    for (const required of ["devices", "snapshot", "open", "read"]) {
      if (!toolNames.has(required)) {
        throw new Error(`Required MCP tool missing from listTools: ${required}`);
      }
    }

    const devicesResult = await session.request("tools/call", {
      name: "devices",
      arguments: {},
    });
    const devicesPayload = parseToolPayload(devicesResult);
    const selectedDevice = chooseDevice(devicesPayload.devices ?? []);
    if (!selectedDevice) {
      throw new Error("No connected device or emulator is available for MCP smoke verification");
    }

    console.log(`Using device ${selectedDevice}`);

    const openResult = await session.request("tools/call", {
      name: "open",
      arguments: {
        appId: "com.android.settings",
        deviceId: selectedDevice,
        operatorPackage,
      },
    }, 30000);
    if (openResult?.isError) {
      throw new Error(`open failed: ${JSON.stringify(parseToolPayload(openResult))}`);
    }

    await delay(1500);

    const snapshotResult = await session.request("tools/call", {
      name: "snapshot",
      arguments: {
        deviceId: selectedDevice,
        operatorPackage,
      },
    }, 30000);
    if (snapshotResult?.isError) {
      throw new Error(`snapshot failed: ${JSON.stringify(parseToolPayload(snapshotResult))}`);
    }

    const snapshotPayload = parseToolPayload(snapshotResult);
    const snapshotXml = snapshotPayload.snapshot;
    if (typeof snapshotXml !== "string" || !snapshotXml.includes("<node")) {
      throw new Error("snapshot did not return parseable XML with at least one <node element");
    }

    const candidates = extractCandidateTexts(snapshotXml);
    if (candidates.length === 0) {
      throw new Error("Could not find any non-empty text or content-desc value in the live snapshot");
    }

    let readResult;
    let usedCandidate;
    let lastReadError;
    for (const candidate of candidates) {
      const attempt = await session.request("tools/call", {
        name: "read",
        arguments: {
          selector: candidate.selector,
          deviceId: selectedDevice,
          operatorPackage,
        },
      }, 30000);
      if (attempt && !attempt.isError) {
        readResult = attempt;
        usedCandidate = candidate.label;
        break;
      }
      lastReadError = attempt ? parseToolPayload(attempt) : { code: "MCP_READ_MISSING_RESULT" };
    }

    if (!readResult || !usedCandidate) {
      throw new Error(`read failed for all snapshot-derived candidates: ${JSON.stringify(lastReadError)}`);
    }

    console.log(`Using selector ${usedCandidate}`);

    const readPayload = parseToolPayload(readResult);
    if (typeof readPayload !== "string" || readPayload.trim().length === 0) {
      throw new Error("read did not return a non-empty string");
    }

    console.log("MCP stdio smoke verification passed");
  } finally {
    await session.close();
  }
}

main().catch((error) => {
  const message = error instanceof Error ? error.message : String(error);
  process.stderr.write(`${message}\n`);
  process.exitCode = 1;
});
