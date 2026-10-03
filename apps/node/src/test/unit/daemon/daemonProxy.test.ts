import { cmdOnScreenLog } from "../../../cli/commands/action.js";
import { afterEach, describe, it } from "node:test";
import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { mkdtemp, rm, stat, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
  getDaemonPostTimeoutMs,
  hasCallerRelativeScreenshotPath,
  parseDaemonRunExecutionResult,
  tryDaemonExecution,
  type DaemonHttpFailure,
  type DaemonHttpSuccess,
} from "../../../cli/daemonProxy.js";
import { formatRunExecutionResultForCli } from "../../../cli/output.js";
import { getDaemonLockPath, getDaemonSocketPath } from "../../../domain/daemon/lifecycle.js";
import { DEFAULT_OPERATOR_PACKAGE } from "../../../domain/config/resolveOperatorPackage.js";
import { getCliBuildIdentity, getCliVersion } from "../../../domain/version/compatibility.js";
import { ERROR_CODES } from "../../../contracts/errors.js";
import { ANDROPERATOR_RUN_ID_ENV_VAR } from "../../../contracts/logging.js";
import type { RunExecutionResult } from "../../../domain/executions/runExecution.js";

const tempDirs: string[] = [];
let originalNoDaemon: string | undefined;
let originalOperatorPackage: string | undefined;
let originalRunId: string | undefined;

const execution = {
  commandId: "daemon-proxy-test",
  taskId: "daemon-proxy-test",
  source: "test",
  expectedFormat: "android-ui-automator",
  timeoutMs: 30000,
  actions: [{ id: "snap", type: "snapshot" }],
};

const successResult: RunExecutionResult = {
  ok: true,
  deviceId: "device-1",
  terminalSource: "androperator_result",
  envelope: {
    commandId: "daemon-proxy-test",
    taskId: "daemon-proxy-test",
    status: "success",
    stepResults: [],
    error: null,
  },
};

async function makeBaseDir(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), "androperator-daemon-proxy-test-"));
  tempDirs.push(dir);
  return dir;
}

function makeAliveGet(version = getCliVersion()): (socketPath: string, path: string) => Promise<string> {
  return async (_socketPath, path) => {
    if (path === "/ping") return JSON.stringify({ ok: true });
    if (path === "/version") return JSON.stringify({ version, buildIdentity: getCliBuildIdentity() });
    throw new Error(`unexpected path ${path}`);
  };
}

function makeOwnedDaemonDeps(): { isDaemonRunningFn: () => Promise<boolean> } {
  return { isDaemonRunningFn: async () => true };
}

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
  if (originalNoDaemon === undefined) {
    delete process.env.ANDROPERATOR_NO_DAEMON;
  } else {
    process.env.ANDROPERATOR_NO_DAEMON = originalNoDaemon;
  }
  if (originalOperatorPackage === undefined) {
    delete process.env.ANDROPERATOR_OPERATOR_PACKAGE;
  } else {
    process.env.ANDROPERATOR_OPERATOR_PACKAGE = originalOperatorPackage;
  }
  if (originalRunId === undefined) {
    delete process.env[ANDROPERATOR_RUN_ID_ENV_VAR];
  } else {
    process.env[ANDROPERATOR_RUN_ID_ENV_VAR] = originalRunId;
  }
});

describe("tryDaemonExecution", () => {
  it("derives POST timeout from execution timeout plus buffer", () => {
    assert.equal(getDaemonPostTimeoutMs({ execution: { timeoutMs: 30000 } }), 35000);
    assert.equal(getDaemonPostTimeoutMs({ execution: { timeoutMs: 12000 } }), 17000);
    assert.equal(getDaemonPostTimeoutMs({ execution: { timeoutMs: "30000" } }), 35000);
  });

  it("returns null when ANDROPERATOR_NO_DAEMON=1 is set", async () => {
    originalNoDaemon = process.env.ANDROPERATOR_NO_DAEMON;
    process.env.ANDROPERATOR_NO_DAEMON = "1";

    const result = await tryDaemonExecution(execution, {}, {
      httpPostFn: async () => {
        throw new Error("should not post");
      },
    });

    assert.equal(result, null);
  });

  it("returns null when noDaemon is passed", async () => {
    const result = await tryDaemonExecution(execution, { noDaemon: true }, {
      httpPostFn: async () => {
        throw new Error("should not post");
      },
    });

    assert.equal(result, null);
  });

  it("rejects malformed daemon execution result shapes", () => {
    assert.throws(() => parseDaemonRunExecutionResult(JSON.stringify({ ok: true })));
    assert.throws(() => parseDaemonRunExecutionResult(JSON.stringify({ ok: false, error: { code: "X" } })));
  });

  it("returns null when auto-start times out", async () => {
    const baseDir = await makeBaseDir();
    let spawned = false;

    const result = await tryDaemonExecution(execution, { baseDir, startTimeoutMs: 1, pollIntervalMs: 1 }, {
      httpGetFn: async () => {
        const error = new Error("missing socket") as NodeJS.ErrnoException;
        error.code = "ENOENT";
        throw error;
      },
      spawnDaemonRunFn: () => {
        spawned = true;
      },
      isDaemonAliveFn: async () => false,
    });

    assert.equal(spawned, true);
    assert.equal(result, null);
  });

  it("returns a daemon result when version matches", async () => {
    let postedBody: unknown;

    const result = await tryDaemonExecution(execution, { rawDeviceId: "device-1" }, {
      ...makeOwnedDaemonDeps(),
      httpGetFn: makeAliveGet(),
      httpPostFn: async (_socketPath, _path, body): Promise<DaemonHttpSuccess> => {
        postedBody = body;
        return { ok: true, body: JSON.stringify(successResult) };
      },
    });

    assert.deepEqual(result, successResult);
    assert.deepEqual(postedBody, {
      execution,
      deviceId: "device-1",
      operatorPackage: DEFAULT_OPERATOR_PACKAGE,
    });
  });

  it("passes inherited runId to the daemon execute request", async () => {
    const parentRunId = "run_parent_daemon_request";
    originalRunId = process.env[ANDROPERATOR_RUN_ID_ENV_VAR];
    process.env[ANDROPERATOR_RUN_ID_ENV_VAR] = parentRunId;
    let postedBody: unknown;

    const result = await tryDaemonExecution(execution, { rawDeviceId: "device-1" }, {
      ...makeOwnedDaemonDeps(),
      httpGetFn: makeAliveGet(),
      httpPostFn: async (_socketPath, _path, body): Promise<DaemonHttpSuccess> => {
        postedBody = body;
        return { ok: true, body: JSON.stringify(successResult) };
      },
    });

    assert.deepEqual(result, successResult);
    assert.deepEqual(postedBody, {
      execution,
      deviceId: "device-1",
      operatorPackage: DEFAULT_OPERATOR_PACKAGE,
      runId: parentRunId,
    });
  });

  it("does not pass malformed inherited runId to the daemon execute request", async () => {
    originalRunId = process.env[ANDROPERATOR_RUN_ID_ENV_VAR];
    process.env[ANDROPERATOR_RUN_ID_ENV_VAR] = "not a run id";
    let postedBody: unknown;

    const result = await tryDaemonExecution(execution, { rawDeviceId: "device-1" }, {
      ...makeOwnedDaemonDeps(),
      httpGetFn: makeAliveGet(),
      httpPostFn: async (_socketPath, _path, body): Promise<DaemonHttpSuccess> => {
        postedBody = body;
        return { ok: true, body: JSON.stringify(successResult) };
      },
    });

    assert.deepEqual(result, successResult);
    assert.deepEqual(postedBody, {
      execution,
      deviceId: "device-1",
      operatorPackage: DEFAULT_OPERATOR_PACKAGE,
    });
  });

  it("detects caller-relative screenshot output paths", () => {
    assert.equal(hasCallerRelativeScreenshotPath({
      ...execution,
      actions: [{ id: "shot", type: "take_screenshot", params: { path: "shot.png" } }],
    }), true);
    assert.equal(hasCallerRelativeScreenshotPath({
      ...execution,
      actions: [{ id: "shot", type: "take_screenshot", params: { path: "/tmp/shot.png" } }],
    }), false);
    assert.equal(hasCallerRelativeScreenshotPath({
      ...execution,
      actions: [{ id: "shot", type: "take_screenshot", params: { path: " " } }],
    }), false);
  });

  it("runs direct before daemon startup when screenshot output path is relative", async () => {
    let queried = false;
    let posted = false;
    const result = await tryDaemonExecution({
      ...execution,
      actions: [{ id: "shot", type: "take_screenshot", params: { path: "shot.png" } }],
    }, {}, {
      httpGetFn: async () => {
        queried = true;
        return JSON.stringify({ ok: true });
      },
      httpPostFn: async (): Promise<DaemonHttpSuccess> => {
        posted = true;
        return { ok: true, body: JSON.stringify(successResult) };
      },
    });

    assert.equal(result, null);
    assert.equal(queried, false);
    assert.equal(posted, false);
  });

  it("returns null instead of posting to an unowned responding socket", async () => {
    let spawned = false;
    let posted = false;

    const result = await tryDaemonExecution(execution, { rawDeviceId: "device-1" }, {
      httpGetFn: makeAliveGet(),
      isDaemonRunningFn: async () => false,
      spawnDaemonRunFn: () => {
        spawned = true;
      },
      httpPostFn: async (): Promise<DaemonHttpSuccess> => {
        posted = true;
        return { ok: true, body: JSON.stringify(successResult) };
      },
    });

    assert.equal(result, null);
    assert.equal(spawned, false);
    assert.equal(posted, false);
  });

  it("returns null when daemon path setup fails", async () => {
    const baseDir = await makeBaseDir();
    const notDirectory = join(baseDir, "not-a-directory");
    await writeFile(notDirectory, "", "utf8");
    let posted = false;

    const result = await tryDaemonExecution(execution, { baseDir: notDirectory }, {
      ...makeOwnedDaemonDeps(),
      httpPostFn: async (): Promise<DaemonHttpSuccess> => {
        posted = true;
        return { ok: true, body: JSON.stringify(successResult) };
      },
    });

    assert.equal(result, null);
    assert.equal(posted, false);
  });

  it("stops and restarts when daemon version mismatches", async () => {
    const baseDir = await makeBaseDir();
    let fresh = false;
    let stopped = false;
    let spawned = false;

    const result = await tryDaemonExecution(execution, { baseDir, startTimeoutMs: 5, pollIntervalMs: 1 }, {
      ...makeOwnedDaemonDeps(),
      httpGetFn: async (_socketPath, path) => {
        if (path === "/ping") {
          if (!fresh && stopped) {
            const error = new Error("missing") as NodeJS.ErrnoException;
            error.code = "ENOENT";
            throw error;
          }
          return JSON.stringify({ ok: true });
        }
        return JSON.stringify({ version: fresh ? getCliVersion() : "0.0.0", buildIdentity: getCliBuildIdentity() });
      },
      stopDaemonFn: async () => {
        stopped = true;
        return "stopped";
      },
      spawnDaemonRunFn: () => {
        spawned = true;
        fresh = true;
      },
      httpPostFn: async (): Promise<DaemonHttpSuccess> => ({ ok: true, body: JSON.stringify(successResult) }),
    });

    assert.equal(stopped, true);
    assert.equal(spawned, true);
    assert.deepEqual(result, successResult);
  });

  it("stops and restarts when daemon build identity mismatches", async () => {
    const baseDir = await makeBaseDir();
    let fresh = false;
    let stopped = false;
    let spawned = false;

    const result = await tryDaemonExecution(execution, { baseDir, startTimeoutMs: 5, pollIntervalMs: 1 }, {
      ...makeOwnedDaemonDeps(),
      httpGetFn: async (_socketPath, path) => {
        if (path === "/ping") {
          if (!fresh && stopped) {
            const error = new Error("missing") as NodeJS.ErrnoException;
            error.code = "ENOENT";
            throw error;
          }
          return JSON.stringify({ ok: true });
        }
        return JSON.stringify({
          version: getCliVersion(),
          buildIdentity: fresh
            ? getCliBuildIdentity()
            : { ...getCliBuildIdentity(), mtimeMs: (getCliBuildIdentity().mtimeMs ?? 0) - 1 },
        });
      },
      stopDaemonFn: async () => {
        stopped = true;
        return "stopped";
      },
      spawnDaemonRunFn: () => {
        spawned = true;
        fresh = true;
      },
      httpPostFn: async (): Promise<DaemonHttpSuccess> => ({ ok: true, body: JSON.stringify(successResult) }),
    });

    assert.equal(stopped, true);
    assert.equal(spawned, true);
    assert.deepEqual(result, successResult);
  });

  it("stops and restarts when owned daemon version response is invalid", async () => {
    const baseDir = await makeBaseDir();
    let fresh = false;
    let stopped = false;
    let spawned = false;

    const result = await tryDaemonExecution(execution, { baseDir, startTimeoutMs: 5, pollIntervalMs: 1 }, {
      ...makeOwnedDaemonDeps(),
      httpGetFn: async (_socketPath, path) => {
        if (path === "/ping") {
          if (!fresh && stopped) {
            const error = new Error("missing") as NodeJS.ErrnoException;
            error.code = "ENOENT";
            throw error;
          }
          return JSON.stringify({ ok: true });
        }
        if (!fresh) {
          return JSON.stringify({ ok: true });
        }
        return JSON.stringify({ version: getCliVersion(), buildIdentity: getCliBuildIdentity() });
      },
      stopDaemonFn: async () => {
        stopped = true;
        return "stopped";
      },
      spawnDaemonRunFn: () => {
        spawned = true;
        fresh = true;
      },
      httpPostFn: async (): Promise<DaemonHttpSuccess> => ({ ok: true, body: JSON.stringify(successResult) }),
    });

    assert.equal(stopped, true);
    assert.equal(spawned, true);
    assert.deepEqual(result, successResult);
  });

  it("deletes a stale socket and restarts on ECONNREFUSED", async () => {
    const baseDir = await makeBaseDir();
    const socketPath = getDaemonSocketPath("stale", { baseDir });
    await writeFile(socketPath, "", "utf8");
    let refusedPings = 0;
    let spawned = false;

    const result = await tryDaemonExecution(execution, { rawDeviceId: "stale", baseDir, startTimeoutMs: 5, pollIntervalMs: 1 }, {
      ...makeOwnedDaemonDeps(),
      httpGetFn: async (_socketPath, path) => {
        if (path === "/ping" && refusedPings < 2) {
          refusedPings += 1;
          const error = new Error("refused") as NodeJS.ErrnoException;
          error.code = "ECONNREFUSED";
          throw error;
        }
        if (path === "/ping" && !spawned) {
          const error = new Error("missing") as NodeJS.ErrnoException;
          error.code = "ENOENT";
          throw error;
        }
        if (path === "/ping") return JSON.stringify({ ok: true });
        return JSON.stringify({ version: getCliVersion(), buildIdentity: getCliBuildIdentity() });
      },
      spawnDaemonRunFn: () => {
        spawned = true;
      },
      httpPostFn: async (): Promise<DaemonHttpSuccess> => ({ ok: true, body: JSON.stringify(successResult) }),
    });

    await assert.rejects(stat(socketPath));
    assert.equal(spawned, true);
    assert.deepEqual(result, successResult);
  });

  it("deletes a stale non-socket path and restarts on ENOTSOCK", async () => {
    const baseDir = await makeBaseDir();
    const socketPath = getDaemonSocketPath("not-sock", { baseDir });
    await writeFile(socketPath, "", "utf8");
    let rejectedPings = 0;
    let spawned = false;

    const result = await tryDaemonExecution(execution, { rawDeviceId: "not-sock", baseDir, startTimeoutMs: 5, pollIntervalMs: 1 }, {
      ...makeOwnedDaemonDeps(),
      httpGetFn: async (_socketPath, path) => {
        if (path === "/ping" && rejectedPings < 2) {
          rejectedPings += 1;
          const error = new Error("not a socket") as NodeJS.ErrnoException;
          error.code = "ENOTSOCK";
          throw error;
        }
        if (path === "/ping" && !spawned) {
          const error = new Error("missing") as NodeJS.ErrnoException;
          error.code = "ENOENT";
          throw error;
        }
        if (path === "/ping") return JSON.stringify({ ok: true });
        return JSON.stringify({ version: getCliVersion(), buildIdentity: getCliBuildIdentity() });
      },
      spawnDaemonRunFn: () => {
        spawned = true;
      },
      httpPostFn: async (): Promise<DaemonHttpSuccess> => ({ ok: true, body: JSON.stringify(successResult) }),
    });

    await assert.rejects(stat(socketPath));
    assert.equal(spawned, true);
    assert.deepEqual(result, successResult);
  });

  it("passes effective operator package using explicit, env, blank env, and default precedence", async () => {
    originalOperatorPackage = process.env.ANDROPERATOR_OPERATOR_PACKAGE;
    const bodies: unknown[] = [];
    const deps = {
      ...makeOwnedDaemonDeps(),
      httpGetFn: makeAliveGet(),
      httpPostFn: async (_socketPath: string, _path: string, body: unknown): Promise<DaemonHttpSuccess> => {
        bodies.push(body);
        return { ok: true, body: JSON.stringify(successResult) };
      },
    };

    process.env.ANDROPERATOR_OPERATOR_PACKAGE = "env.package";
    await tryDaemonExecution(execution, { operatorPackage: "explicit.package" }, deps);
    await tryDaemonExecution(execution, {}, deps);
    process.env.ANDROPERATOR_OPERATOR_PACKAGE = " ";
    await tryDaemonExecution(execution, {}, deps);
    delete process.env.ANDROPERATOR_OPERATOR_PACKAGE;
    await tryDaemonExecution(execution, {}, deps);

    assert.deepEqual(bodies.map((body) => (body as { operatorPackage: string }).operatorPackage), [
      "explicit.package",
      "env.package",
      DEFAULT_OPERATOR_PACKAGE,
      DEFAULT_OPERATOR_PACKAGE,
    ]);
  });

  it("allows idempotent post-dispatch fallback", async () => {
    const failure: DaemonHttpFailure = { ok: false, dispatched: true, error: new Error("lost") };
    const result = await tryDaemonExecution(execution, { allowPostDispatchFallback: true }, {
      ...makeOwnedDaemonDeps(),
      httpGetFn: makeAliveGet(),
      httpPostFn: async () => failure,
    });

    assert.equal(result, null);
  });

  it("allows idempotent fallback when the daemon response body is malformed", async () => {
    const result = await tryDaemonExecution(execution, { allowPostDispatchFallback: true }, {
      ...makeOwnedDaemonDeps(),
      httpGetFn: makeAliveGet(),
      httpPostFn: async (): Promise<DaemonHttpSuccess> => ({ ok: true, body: "{" }),
    });

    assert.equal(result, null);
  });

  it("returns DAEMON_PROXY_ERROR for non-idempotent post-dispatch loss", async () => {
    const failure: DaemonHttpFailure = { ok: false, dispatched: true, error: new Error("lost") };
    const result = await tryDaemonExecution(execution, { allowPostDispatchFallback: false }, {
      ...makeOwnedDaemonDeps(),
      httpGetFn: makeAliveGet(),
      httpPostFn: async () => failure,
    });

    assert.equal(result?.ok, false);
    assert.ok(result && !result.ok);
    assert.equal(result.error.code, ERROR_CODES.DAEMON_PROXY_ERROR);
    const details = result.error.details as Record<string, unknown>;
    assert.equal(details.phase, "result_wait");
    assert.equal(details.dispatchState, "unknown");
    assert.equal(details.commandId, execution.commandId);
    assert.equal(details.taskId, execution.taskId);
    assert.equal(details.probeCommandId, undefined);
    assert.equal(details.earlierEffects, undefined);
  });

  it("returns DAEMON_PROXY_ERROR for non-idempotent malformed daemon responses", async () => {
    const result = await tryDaemonExecution(execution, { allowPostDispatchFallback: false }, {
      ...makeOwnedDaemonDeps(),
      httpGetFn: makeAliveGet(),
      httpPostFn: async (): Promise<DaemonHttpSuccess> => ({ ok: true, body: "{" }),
    });

    assert.equal(result?.ok, false);
    if (result?.ok === false) {
      assert.equal(result.error.code, ERROR_CODES.DAEMON_PROXY_ERROR);
    }
  });

  it("falls back direct on a POST failure before dispatch", async () => {
    const failure: DaemonHttpFailure = { ok: false, dispatched: false, error: new Error("connect ECONNREFUSED") };
    const result = await tryDaemonExecution(execution, { allowPostDispatchFallback: false }, {
      ...makeOwnedDaemonDeps(),
      httpGetFn: makeAliveGet(),
      httpPostFn: async () => failure,
    });

    assert.equal(result, null);
  });

  it("lets concurrent auto-start callers both receive results", async () => {
    const baseDir = await makeBaseDir();
    let spawnCount = 0;
    let alive = false;
    const deps = {
      ...makeOwnedDaemonDeps(),
      httpGetFn: async (_socketPath: string, path: string) => {
        if (path === "/ping" && !alive) {
          const error = new Error("missing") as NodeJS.ErrnoException;
          error.code = "ENOENT";
          throw error;
        }
        if (path === "/ping") return JSON.stringify({ ok: true });
        return JSON.stringify({ version: getCliVersion(), buildIdentity: getCliBuildIdentity() });
      },
      spawnDaemonRunFn: () => {
        spawnCount += 1;
        alive = true;
      },
      httpPostFn: async (): Promise<DaemonHttpSuccess> => ({ ok: true, body: JSON.stringify(successResult) }),
    };

    const [first, second] = await Promise.all([
      tryDaemonExecution(execution, { baseDir, startTimeoutMs: 10, pollIntervalMs: 1 }, deps),
      tryDaemonExecution(execution, { baseDir, startTimeoutMs: 10, pollIntervalMs: 1 }, deps),
    ]);

    assert.equal(spawnCount, 1);
    assert.deepEqual(first, successResult);
    assert.deepEqual(second, successResult);
  });

  it("releases the lifecycle lock before polling spawned daemon readiness", async () => {
    const baseDir = await makeBaseDir();
    const lockPath = getDaemonLockPath(undefined, { baseDir });
    let spawned = false;
    let polledAfterSpawn = false;

    const result = await tryDaemonExecution(execution, { baseDir, startTimeoutMs: 10, pollIntervalMs: 1 }, {
      ...makeOwnedDaemonDeps(),
      httpGetFn: async (_socketPath: string, path: string) => {
        if (path === "/ping" && !spawned) {
          const error = new Error("missing") as NodeJS.ErrnoException;
          error.code = "ENOENT";
          throw error;
        }
        if (path === "/ping") {
          polledAfterSpawn = true;
          assert.equal(existsSync(lockPath), false);
          return JSON.stringify({ ok: true });
        }
        return JSON.stringify({ version: getCliVersion(), buildIdentity: getCliBuildIdentity() });
      },
      spawnDaemonRunFn: () => {
        spawned = true;
      },
      httpPostFn: async (): Promise<DaemonHttpSuccess> => ({ ok: true, body: JSON.stringify(successResult) }),
    });

    assert.equal(spawned, true);
    assert.equal(polledAfterSpawn, true);
    assert.deepEqual(result, successResult);
  });

  it("formats proxied and direct results identically for the same fixture", () => {
    assert.equal(
      formatRunExecutionResultForCli(successResult, { format: "json" }),
      formatRunExecutionResultForCli(successResult, { format: "json" }),
    );
  });
});


describe("on-screen-log public mutation proxy", () => {
  for (const operation of ["set", "clear"] as const) {
    for (const failureKind of ["before-dispatch", "lost-acknowledgement", "malformed-response"] as const) {
      it(`${operation}: ${failureKind} never duplicates a dispatched mutation`, async () => {
        let posts = 0;
        let directCalls = 0;
        const result = await cmdOnScreenLog({
          operation,
          params: operation === "set" ? { text: "proxy proof" } : undefined,
          format: "json",
          deviceId: "device-1",
          operatorPackage: "com.androperator.operator.dev",
          tryDaemonExecutionFn: (payload, options) => tryDaemonExecution(payload, options, {
            ...makeOwnedDaemonDeps(),
            httpGetFn: makeAliveGet(),
            httpPostFn: async () => {
              posts++;
              return failureKind === "malformed-response"
                ? { ok: true, body: "{" }
                : { ok: false, dispatched: failureKind !== "before-dispatch", error: new Error("lost") };
            },
          }),
          runExecutionFn: async () => { directCalls++; return successResult; },
        });
        assert.equal(posts, 1);
        assert.equal(directCalls, failureKind === "before-dispatch" ? 1 : 0);
        assert.equal(JSON.parse(result).code, failureKind === "before-dispatch" ? undefined : ERROR_CODES.DAEMON_PROXY_ERROR);
      });
    }
  }
});
