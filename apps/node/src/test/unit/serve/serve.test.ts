import { afterEach, describe, it } from "node:test";
import assert from "node:assert/strict";
import http, { type Server } from "node:http";
import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import type express from "express";
import { createServeApp, startServer } from "../../../cli/commands/serve.js";
import { getCliBuildIdentity, getCliVersion } from "../../../domain/version/compatibility.js";
import { buildServeCommandOptions } from "../../../cli/registry.js";
import type { Logger } from "../../../adapters/logger.js";

const servers: Server[] = [];
const tempDirs: string[] = [];
const noopLogger: Logger = {
  status: () => ({ status: "disabled" }),
  emit: () => undefined,
  child: () => noopLogger,
  logPath: () => undefined,
};

async function closeServer(server: Server): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    server.close((error) => {
      if (error) {
        reject(error);
        return;
      }
      resolve();
    });
  });
}

async function requestJson(options: http.RequestOptions): Promise<{ statusCode: number; body: unknown }> {
  return await new Promise((resolve, reject) => {
    const req = http.request({ method: "GET", ...options }, (res) => {
      const chunks: Buffer[] = [];
      res.on("data", (chunk: Buffer) => chunks.push(chunk));
      res.on("end", () => {
        const rawBody = Buffer.concat(chunks).toString("utf8");
        resolve({
          statusCode: res.statusCode ?? 0,
          body: JSON.parse(rawBody) as unknown,
        });
      });
    });
    req.on("error", reject);
    req.end();
  });
}

async function listenOnEphemeralPort(app: express.Application): Promise<Server> {
  const server = await new Promise<Server>((resolve, reject) => {
    const candidate = app.listen(0, "127.0.0.1", () => resolve(candidate));
    candidate.on("error", reject);
  });
  servers.push(server);
  return server;
}

async function makeSocketPath(): Promise<string> {
  const tempDir = await mkdtemp(join(tmpdir(), "androperator-serve-test-"));
  tempDirs.push(tempDir);
  return join(tempDir, "serve.sock");
}

afterEach(async () => {
  await Promise.all(servers.splice(0).map(closeServer));
  await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

describe("serve app", () => {
  it("returns ok from GET /ping", async () => {
    const app = createServeApp({ verbose: false });
    const server = await listenOnEphemeralPort(app);
    const address = server.address();
    assert.ok(address && typeof address === "object");

    const response = await requestJson({ hostname: "127.0.0.1", port: address.port, path: "/ping" });

    assert.equal(response.statusCode, 200);
    assert.deepEqual(response.body, { ok: true });
  });

  it("returns the CLI version from GET /version", async () => {
    const app = createServeApp({ verbose: false });
    const server = await listenOnEphemeralPort(app);
    const address = server.address();
    assert.ok(address && typeof address === "object");

    const response = await requestJson({ hostname: "127.0.0.1", port: address.port, path: "/version" });

    assert.equal(response.statusCode, 200);
    assert.deepEqual(response.body, { version: getCliVersion(), buildIdentity: getCliBuildIdentity() });
  });

  it("starts with TCP options and accepts requests", async () => {
    const server = await startServer({ port: 0, host: "127.0.0.1", verbose: false });
    servers.push(server);
    const address = server.address();
    assert.ok(address && typeof address === "object");

    const response = await requestJson({ hostname: "127.0.0.1", port: address.port, path: "/ping" });

    assert.equal(response.statusCode, 200);
    assert.deepEqual(response.body, { ok: true });
  });

  it("starts with a Unix socket path and accepts requests", async () => {
    const socketPath = await makeSocketPath();
    const server = await startServer({ socketPath, verbose: false });
    servers.push(server);

    const response = await requestJson({ socketPath, path: "/ping" });

    assert.equal(response.statusCode, 200);
    assert.deepEqual(response.body, { ok: true });
  });

  it("throws when no transport is provided", async () => {
    await assert.rejects(
      startServer({ verbose: false }),
      /Exactly one serve transport must be provided/,
    );
  });
});

describe("serve command registry", () => {
  it("forwards the global operator package to serve options", () => {
    const built = buildServeCommandOptions({
      argv: ["serve"],
      rest: ["--port", "4321"],
      format: "json",
      explicitJsonOutput: true,
      verbose: false,
      noDaemon: false,
      logger: noopLogger,
      operatorPackage: "com.androperator.operator.dev",
    });

    assert.deepEqual(built, {
      ok: true,
      options: {
      port: 4321,
      host: "127.0.0.1",
      operatorPackage: "com.androperator.operator.dev",
      verbose: false,
      logger: noopLogger,
      },
    });
  });
});
