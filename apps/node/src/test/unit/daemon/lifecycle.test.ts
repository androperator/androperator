import { afterEach, describe, it } from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { createServer as createHttpServer, type Server as HttpServer } from "node:http";
import { createServer, type Server, type Socket } from "node:net";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
  getDaemonLogPath,
  getDaemonDir,
  getDaemonLockPath,
  getDaemonPidPath,
  getDaemonSocketPath,
  isDaemonRunning,
  sanitizeDaemonKey,
  spawnDaemonRun,
  stopDaemon,
  type DaemonPathsOptions,
  withDaemonLock,
  writeDaemonPidMetadata,
} from "../../../domain/daemon/lifecycle.cjs";
import { ANDROPERATOR_RUN_ID_ENV_VAR } from "../../../contracts/logging.js";
import {
  cmdDaemonStart,
  cmdDaemonRun,
  cmdDaemonStatus,
  cmdDaemonStop,
} from "../../../cli/commands/daemon.js";
import { ERROR_CODES } from "../../../contracts/errors.js";
import { shouldCliStdoutForceExitCode1 } from "../../../cli/stdoutExitCode.js";

const tempDirs: string[] = [];
const servers: Server[] = [];
const httpServers: HttpServer[] = [];
const sockets: Socket[] = [];

async function makeTempBaseDir(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), "androperator-daemon-test-"));
  tempDirs.push(dir);
  return dir;
}

async function writePidMetadata(baseDir: string, pid: number, startedAt = Date.now()): Promise<void> {
  writeDaemonPidMetadata(undefined, { pid, startedAt, cliEntryPath: "/tmp/androperator", daemonKey: "default" }, { baseDir });
}

afterEach(async () => {
  for (const socket of sockets.splice(0)) {
    socket.destroy();
  }
  await Promise.all(servers.splice(0).map((server) => new Promise<void>((resolve) => server.close(() => resolve()))));
  await Promise.all(httpServers.splice(0).map((server) => new Promise<void>((resolve) => server.close(() => resolve()))));
  await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

describe("daemon lifecycle paths", () => {
  it("sanitizes TCP adb serials", () => {
    assert.equal(sanitizeDaemonKey("192.168.1.1:5555"), "id-MTkyLjE2OC4xLjE6NTU1NQ");
  });

  it("keeps similar device ids on distinct daemon keys", () => {
    assert.notEqual(sanitizeDaemonKey("host:5555"), sanitizeDaemonKey("host-5555"));
  });

  it("uses default for empty or omitted device ids", () => {
    assert.equal(sanitizeDaemonKey(""), "default");
    assert.equal(sanitizeDaemonKey(undefined), "default");
  });

  it("builds socket, PID, and log paths from the sanitized key", async () => {
    const baseDir = await makeTempBaseDir();

    assert.equal(getDaemonSocketPath("192.168.1.1:5555", { baseDir }), join(baseDir, "daemon-id-MTkyLjE2OC4xLjE6NTU1NQ.sock"));
    assert.equal(getDaemonPidPath("192.168.1.1:5555", { baseDir }), join(baseDir, "daemon-id-MTkyLjE2OC4xLjE6NTU1NQ.pid"));
    assert.equal(getDaemonLogPath("192.168.1.1:5555", { baseDir }), join(baseDir, "daemon-id-MTkyLjE2OC4xLjE6NTU1NQ.log"));
  });

  it("keeps default daemon files under the daemon subdirectory", () => {
    const socketPath = getDaemonSocketPath("emulator-5554");

    assert.ok(socketPath.endsWith(join(".androperator", "daemon", "daemon-id-ZW11bGF0b3ItNTU1NA.sock")));
  });

  it("hardens an existing daemon directory to owner-only permissions", async () => {
    const baseDir = await makeTempBaseDir();
    const daemonDir = join(baseDir, "daemon-dir");
    mkdirSync(daemonDir, { mode: 0o755 });

    assert.equal(getDaemonDir({ baseDir: daemonDir }), daemonDir);
    assert.equal(statSync(daemonDir).mode & 0o777, 0o700);
  });
});

describe("daemon lifecycle lock", () => {
  it("reclaims a lock owned by a dead process", async () => {
    const baseDir = await makeTempBaseDir();
    const lockPath = getDaemonLockPath(undefined, { baseDir });
    writeFileSync(lockPath, `${JSON.stringify({ pid: 987654, createdAt: 100 })}\n`, "utf8");
    let ran = false;

    await withDaemonLock(undefined, () => {
      ran = true;
    }, { baseDir });

    assert.equal(ran, true);
    assert.equal(existsSync(lockPath), false);
  });
});

describe("daemon process state", () => {
  it("reports not running when the PID file does not exist", async () => {
    const baseDir = await makeTempBaseDir();

    assert.equal(await isDaemonRunning(undefined, { baseDir }), false);
  });

  it("reports not running when the PID file exists but the process is not alive", async () => {
    const baseDir = await makeTempBaseDir();
    await writePidMetadata(baseDir, 12345);

    const options: DaemonPathsOptions = {
      baseDir,
      processController: {
        isAlive: () => false,
        kill: () => undefined,
      },
    };

    assert.equal(await isDaemonRunning(undefined, options), false);
  });

  it("reports not running when the PID belongs to a non-daemon process", async () => {
    const baseDir = await makeTempBaseDir();
    await writePidMetadata(baseDir, 12345);

    const options: DaemonPathsOptions = {
      baseDir,
      processController: {
        isAlive: () => true,
        isDaemonProcess: () => false,
        kill: () => undefined,
      },
    };

    assert.equal(await isDaemonRunning(undefined, options), false);
  });

  it("passes daemon ownership metadata into the process verifier", async () => {
    const baseDir = await makeTempBaseDir();
    writeDaemonPidMetadata("device-1", {
      pid: 12345,
      startedAt: 100,
      cliEntryPath: "/tmp/androperator",
      daemonKey: sanitizeDaemonKey("device-1"),
      rawDeviceId: "device-1",
    }, { baseDir });
    let observedMetadata: unknown;

    const options: DaemonPathsOptions = {
      baseDir,
      processController: {
        isAlive: () => true,
        isDaemonProcess: (_pid, metadata) => {
          observedMetadata = metadata;
          return metadata.rawDeviceId === "device-1" &&
            metadata.daemonKey === sanitizeDaemonKey("device-1") &&
            metadata.cliEntryPath === "/tmp/androperator";
        },
        kill: () => undefined,
      },
    };

    assert.equal(await isDaemonRunning("device-1", options), true);
    assert.deepEqual(observedMetadata, {
      pid: 12345,
      startedAt: 100,
      daemonKey: sanitizeDaemonKey("device-1"),
      cliEntryPath: "/tmp/androperator",
      rawDeviceId: "device-1",
    });
  });

  it("treats legacy PID metadata without ownership fields as not running", async () => {
    const baseDir = await makeTempBaseDir();
    await writeFile(getDaemonPidPath(undefined, { baseDir }), `${JSON.stringify({ pid: 12345, startedAt: 100 })}\n`, "utf8");

    const options: DaemonPathsOptions = {
      baseDir,
      processController: {
        isAlive: () => true,
        kill: () => undefined,
      },
    };

    assert.equal(await isDaemonRunning(undefined, options), false);
  });

  it("stopDaemon returns not_running when the PID file does not exist", async () => {
    const baseDir = await makeTempBaseDir();

    assert.equal(await stopDaemon(undefined, { baseDir }), "not_running");
  });

  it("stopDaemon sends SIGTERM and removes PID and socket files", async () => {
    const baseDir = await makeTempBaseDir();
    await writePidMetadata(baseDir, 9876);
    await writeFile(getDaemonSocketPath(undefined, { baseDir }), "", "utf8");
    let alive = true;
    let signal: NodeJS.Signals | undefined;
    const options: DaemonPathsOptions = {
      baseDir,
      terminationTimeoutMs: 20,
      terminationPollIntervalMs: 1,
      processController: {
        isAlive: () => alive,
        kill: (_pid, sentSignal) => {
          signal = sentSignal;
          alive = false;
        },
      },
    };

    assert.equal(await stopDaemon(undefined, options), "stopped");
    assert.equal(signal, "SIGTERM");
    assert.equal(await isDaemonRunning(undefined, options), false);
  });

  it("stopDaemon preserves files when PID metadata changes before cleanup", async () => {
    const baseDir = await makeTempBaseDir();
    await writePidMetadata(baseDir, 9876, 100);
    await writeFile(getDaemonSocketPath(undefined, { baseDir }), "replacement socket", "utf8");
    let alive = true;
    const options: DaemonPathsOptions = {
      baseDir,
      terminationTimeoutMs: 20,
      terminationPollIntervalMs: 1,
      processController: {
        isAlive: () => alive,
        kill: () => {
          alive = false;
          writeDaemonPidMetadata(undefined, { pid: 1234, startedAt: 200, cliEntryPath: "/tmp/androperator", daemonKey: "default" }, { baseDir });
        },
      },
    };

    assert.equal(await stopDaemon(undefined, options), "stopped");
    assert.equal(readFileSync(getDaemonPidPath(undefined, { baseDir }), "utf8").includes("\"pid\":1234"), true);
    assert.equal(readFileSync(getDaemonSocketPath(undefined, { baseDir }), "utf8"), "replacement socket");
  });

  it("stopDaemon removes stale metadata without unlinking a socket owned by a non-daemon process", async () => {
    const baseDir = await makeTempBaseDir();
    await writePidMetadata(baseDir, 9876, 100);
    await writeFile(getDaemonSocketPath(undefined, { baseDir }), "", "utf8");
    let killCalled = false;
    const options: DaemonPathsOptions = {
      baseDir,
      processController: {
        isAlive: () => true,
        isDaemonProcess: () => false,
        kill: () => {
          killCalled = true;
        },
      },
    };

    assert.equal(await stopDaemon(undefined, options), "not_running");
    assert.equal(killCalled, false);
    assert.equal(existsSync(getDaemonPidPath(undefined, { baseDir })), false);
    assert.equal(existsSync(getDaemonSocketPath(undefined, { baseDir })), true);
  });

  it("stopDaemon preserves a responding socket when metadata points to a dead process", async () => {
    const baseDir = await makeTempBaseDir();
    const socketPath = getDaemonSocketPath(undefined, { baseDir });
    await writePidMetadata(baseDir, 9876, 100);
    const server = createHttpServer((req, res) => {
      if (req.url === "/ping") {
        res.writeHead(200, { "content-type": "application/json" });
        res.end(JSON.stringify({ ok: true }));
        return;
      }
      res.writeHead(404);
      res.end();
    });
    await new Promise<void>((resolve, reject) => {
      server.once("error", reject);
      server.listen(socketPath, resolve);
    });
    httpServers.push(server);

    assert.equal(await stopDaemon(undefined, {
      baseDir,
      processController: {
        isAlive: () => false,
        kill: () => undefined,
      },
    }), "not_running");
    assert.equal(existsSync(getDaemonPidPath(undefined, { baseDir })), false);
    assert.equal(existsSync(socketPath), true);

    const raw = await cmdDaemonStatus({ format: "json", baseDir });
    const parsed = JSON.parse(raw) as { ok?: boolean; daemon?: { status?: string } };
    assert.equal(parsed.ok, true);
    assert.equal(parsed.daemon?.status, "unowned");
  });
});

describe("daemon command output", () => {
  it("returns valid JSON for status in default mode", async () => {
    const baseDir = await makeTempBaseDir();
    const raw = await cmdDaemonStatus({ format: "json", baseDir });
    const parsed = JSON.parse(raw) as { ok?: boolean; daemon?: { status?: string } };

    assert.equal(parsed.ok, true);
    assert.equal(parsed.daemon?.status, "not_running");
  });

  it("status reports an unowned responding socket without daemon metadata", async () => {
    const baseDir = await makeTempBaseDir();
    const socketPath = getDaemonSocketPath(undefined, { baseDir });
    const server = createHttpServer((req, res) => {
      if (req.url === "/ping") {
        res.writeHead(200, { "content-type": "application/json" });
        res.end(JSON.stringify({ ok: true }));
        return;
      }
      res.writeHead(404);
      res.end();
    });
    await new Promise<void>((resolve, reject) => {
      server.once("error", reject);
      server.listen(socketPath, resolve);
    });
    httpServers.push(server);

    const raw = await cmdDaemonStatus({ format: "json", baseDir });
    const parsed = JSON.parse(raw) as { ok?: boolean; daemon?: { status?: string; pid?: unknown } };

    assert.equal(parsed.ok, true);
    assert.equal(parsed.daemon?.status, "unowned");
    assert.equal("pid" in (parsed.daemon ?? {}), false);
  });

  it("status reports an unowned socket when PID metadata belongs to a non-daemon process", async () => {
    const baseDir = await makeTempBaseDir();
    const socketPath = getDaemonSocketPath(undefined, { baseDir });
    await writePidMetadata(baseDir, 9876, 100);
    const server = createHttpServer((req, res) => {
      if (req.url === "/ping") {
        res.writeHead(200, { "content-type": "application/json" });
        res.end(JSON.stringify({ ok: true }));
        return;
      }
      res.writeHead(404);
      res.end();
    });
    await new Promise<void>((resolve, reject) => {
      server.once("error", reject);
      server.listen(socketPath, resolve);
    });
    httpServers.push(server);

    const raw = await cmdDaemonStatus({
      format: "json",
      baseDir,
      processController: {
        isAlive: () => true,
        isDaemonProcess: () => false,
        kill: () => undefined,
      },
    });
    const parsed = JSON.parse(raw) as { ok?: boolean; daemon?: { status?: string; pid?: unknown } };

    assert.equal(parsed.ok, true);
    assert.equal(parsed.daemon?.status, "unowned");
    assert.equal("pid" in (parsed.daemon ?? {}), false);
  });

  it("status returns not_running when version metadata cannot be read", async () => {
    const baseDir = await makeTempBaseDir();
    const socketPath = getDaemonSocketPath(undefined, { baseDir });
    await writePidMetadata(baseDir, 9876, 100);
    const server = createHttpServer((req, res) => {
      if (req.url === "/ping") {
        res.writeHead(200, { "content-type": "application/json" });
        res.end(JSON.stringify({ ok: true }));
        return;
      }
      if (req.url === "/version") {
        res.writeHead(200, { "content-type": "application/json" });
        res.end(JSON.stringify({ ok: true }));
        return;
      }
      res.writeHead(404);
      res.end();
    });
    await new Promise<void>((resolve, reject) => {
      server.once("error", reject);
      server.listen(socketPath, resolve);
    });
    httpServers.push(server);

    const raw = await cmdDaemonStatus({
      format: "json",
      baseDir,
      processController: {
        isAlive: () => true,
        isDaemonProcess: () => true,
        kill: () => undefined,
      },
    });
    const parsed = JSON.parse(raw) as { ok?: boolean; daemon?: { status?: string; pid?: unknown } };

    assert.equal(parsed.ok, true);
    assert.equal(parsed.daemon?.status, "not_running");
    assert.equal("pid" in (parsed.daemon ?? {}), false);
  });

  it("start timeout returns DAEMON_START_FAILED and forces exit code 1", async () => {
    const baseDir = await makeTempBaseDir();
    const raw = await cmdDaemonStart({
      format: "json",
      baseDir,
      pollTimeoutMs: 1,
      pollIntervalMs: 1,
      spawnDaemonRunImpl: () => undefined,
    });
    const parsed = JSON.parse(raw) as { code?: string };

    assert.equal(parsed.code, ERROR_CODES.DAEMON_START_FAILED);
    assert.equal(shouldCliStdoutForceExitCode1(raw, false), true);
  });

  it("start does not claim already running for a responding unmanaged socket", async () => {
    const baseDir = await makeTempBaseDir();
    const socketPath = getDaemonSocketPath(undefined, { baseDir });
    const server = createHttpServer((req, res) => {
      if (req.url === "/ping") {
        res.writeHead(200, { "content-type": "application/json" });
        res.end(JSON.stringify({ ok: true }));
        return;
      }
      res.writeHead(404);
      res.end();
    });
    await new Promise<void>((resolve, reject) => {
      server.once("error", reject);
      server.listen(socketPath, resolve);
    });
    httpServers.push(server);
    let spawned = false;

    const raw = await cmdDaemonStart({
      format: "json",
      baseDir,
      pollTimeoutMs: 10,
      pollIntervalMs: 1,
      spawnDaemonRunImpl: () => {
        spawned = true;
      },
    });
    const parsed = JSON.parse(raw) as { code?: string };

    assert.equal(spawned, false);
    assert.equal(parsed.code, ERROR_CODES.DAEMON_START_FAILED);
    assert.equal(shouldCliStdoutForceExitCode1(raw, false), true);
  });

  it("start waits for ownership metadata from a freshly listening daemon", async () => {
    const baseDir = await makeTempBaseDir();
    const socketPath = getDaemonSocketPath(undefined, { baseDir });
    const server = createHttpServer((req, res) => {
      if (req.url === "/ping") {
        res.writeHead(200, { "content-type": "application/json" });
        res.end(JSON.stringify({ ok: true }));
        return;
      }
      res.writeHead(404);
      res.end();
    });
    await new Promise<void>((resolve, reject) => {
      server.once("error", reject);
      server.listen(socketPath, resolve);
    });
    httpServers.push(server);

    setTimeout(() => {
      writeDaemonPidMetadata(undefined, {
        pid: 9876,
        startedAt: 100,
        cliEntryPath: "/tmp/androperator",
        daemonKey: "default",
      }, { baseDir });
    }, 5);

    const raw = await cmdDaemonStart({
      format: "json",
      baseDir,
      pollTimeoutMs: 50,
      pollIntervalMs: 1,
      processController: {
        isAlive: () => true,
        isDaemonProcess: () => true,
        kill: () => undefined,
      },
      spawnDaemonRunImpl: () => {
        throw new Error("should not spawn while socket is alive");
      },
    });
    const parsed = JSON.parse(raw) as { ok?: boolean; daemon?: { status?: string } };

    assert.equal(parsed.ok, true);
    assert.equal(parsed.daemon?.status, "already_running");
  });

  it("serializes concurrent start calls before spawning", async () => {
    const baseDir = await makeTempBaseDir();
    const socketPath = getDaemonSocketPath(undefined, { baseDir });
    let spawnCount = 0;

    const options = {
      format: "json" as const,
      baseDir,
      pollTimeoutMs: 50,
      pollIntervalMs: 1,
      processController: {
        isAlive: () => true,
        isDaemonProcess: () => true,
        kill: () => undefined,
      },
      spawnDaemonRunImpl: () => {
        spawnCount += 1;
        writeDaemonPidMetadata(undefined, { pid: 9876, startedAt: 100, cliEntryPath: "/tmp/androperator", daemonKey: "default" }, { baseDir });
        const server = createHttpServer((req, res) => {
          if (req.url === "/ping") {
            res.writeHead(200, { "content-type": "application/json" });
            res.end(JSON.stringify({ ok: true }));
            return;
          }
          res.writeHead(404);
          res.end();
        });
        server.listen(socketPath);
        httpServers.push(server);
      },
    };

    const [firstRaw, secondRaw] = await Promise.all([
      cmdDaemonStart(options),
      cmdDaemonStart(options),
    ]);
    const statuses = [firstRaw, secondRaw]
      .map((raw) => (JSON.parse(raw) as { daemon?: { status?: string } }).daemon?.status)
      .sort();

    assert.equal(spawnCount, 1);
    assert.deepEqual(statuses, ["already_running", "started"]);
  });

  it("removes a stale socket before spawning daemon run", async () => {
    const baseDir = await makeTempBaseDir();
    const socketPath = getDaemonSocketPath(undefined, { baseDir });
    await writeFile(socketPath, "", "utf8");
    let socketExistedAtSpawn = true;

    const raw = await cmdDaemonStart({
      format: "json",
      baseDir,
      pollTimeoutMs: 1,
      pollIntervalMs: 1,
      spawnDaemonRunImpl: () => {
        socketExistedAtSpawn = existsSync(socketPath);
      },
    });
    const parsed = JSON.parse(raw) as { code?: string };

    assert.equal(socketExistedAtSpawn, false);
    assert.equal(parsed.code, ERROR_CODES.DAEMON_START_FAILED);
  });

  it("daemon run startup failure does not remove a socket it did not bind", async () => {
    const baseDir = await makeTempBaseDir();
    const socketPath = getDaemonSocketPath(undefined, { baseDir });
    const pidPath = getDaemonPidPath(undefined, { baseDir });
    await writeFile(socketPath, "existing live socket", "utf8");

    await assert.rejects(
      cmdDaemonRun({
        baseDir,
        startServerImpl: async () => {
          throw new Error("EADDRINUSE");
        },
      }),
      /EADDRINUSE/,
    );

    assert.equal(readFileSync(socketPath, "utf8"), "existing live socket");
    assert.equal(existsSync(pidPath), false);
  });

  it("does not remove or spawn over a bound socket that is not ready yet", async () => {
    const baseDir = await makeTempBaseDir();
    const socketPath = getDaemonSocketPath(undefined, { baseDir });
    const server = createServer((_socket) => {
      // Keep the connection open so HTTP /ping times out instead of proving the socket stale.
      sockets.push(_socket);
    });
    await new Promise<void>((resolve, reject) => {
      server.once("error", reject);
      server.listen(socketPath, resolve);
    });
    servers.push(server);
    let spawned = false;

    const raw = await cmdDaemonStart({
      format: "json",
      baseDir,
      pollTimeoutMs: 1,
      pollIntervalMs: 1,
      spawnDaemonRunImpl: () => {
        spawned = true;
      },
    });
    const parsed = JSON.parse(raw) as { code?: string };

    assert.equal(spawned, false);
    assert.equal(existsSync(socketPath), true);
    assert.equal(parsed.code, ERROR_CODES.DAEMON_START_FAILED);
  });

  it("stop failures return DAEMON_STOP_FAILED and force exit code 1", async () => {
    const baseDir = await makeTempBaseDir();
    await writePidMetadata(baseDir, 12345);
    const raw = await cmdDaemonStop({
      format: "json",
      baseDir,
      processController: {
        isAlive: () => true,
        kill: () => {
          throw new Error("cannot signal");
        },
      },
    });
    const parsed = JSON.parse(raw) as { code?: string };

    assert.equal(parsed.code, ERROR_CODES.DAEMON_STOP_FAILED);
    assert.equal(shouldCliStdoutForceExitCode1(raw, false), true);
  });

  it("spawnDaemonRun does not pass ANDROPERATOR_RUN_ID to the spawned daemon", async () => {
    const baseDir = await makeTempBaseDir();
    const envOutputPath = join(baseDir, "daemon-env.json");
    const scriptPath = join(baseDir, "fake-daemon.cjs");
    await writeFile(scriptPath, `const { writeFileSync } = require("node:fs");\nwriteFileSync(${JSON.stringify(envOutputPath)}, JSON.stringify(process.env));\n`);

    const runId = "run_daemon_env_leak_regression";
    const originalValue = process.env[ANDROPERATOR_RUN_ID_ENV_VAR];
    process.env[ANDROPERATOR_RUN_ID_ENV_VAR] = runId;
    try {
      spawnDaemonRun(undefined, undefined, { baseDir, cliEntryPath: scriptPath });

      const deadline = Date.now() + 5000;
      while (!existsSync(envOutputPath) && Date.now() < deadline) {
        await new Promise<void>((resolve) => setTimeout(resolve, 25));
      }

      assert.ok(existsSync(envOutputPath), "fake daemon script did not write env output within timeout");
      const spawnedEnv = JSON.parse(readFileSync(envOutputPath, "utf8")) as Record<string, string>;
      assert.equal(spawnedEnv[ANDROPERATOR_RUN_ID_ENV_VAR], undefined);
    } finally {
      if (originalValue === undefined) {
        delete process.env[ANDROPERATOR_RUN_ID_ENV_VAR];
      } else {
        process.env[ANDROPERATOR_RUN_ID_ENV_VAR] = originalValue;
      }
    }
  });
});
