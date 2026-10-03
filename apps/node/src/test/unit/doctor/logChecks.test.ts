import { afterEach, beforeEach, describe, it } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile, mkdir } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir, homedir } from "node:os";
import { createAndroperatorLogger, getLoggerDestination, resolveLogDestination } from "../../../adapters/logger.js";
import { checkLogDestination } from "../../../domain/doctor/checks/logChecks.js";

describe("doctor log destination", () => {
  let root: string;
  let originalDir: string | undefined;
  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), "doctor-log-destination-"));
    originalDir = process.env.ANDROPERATOR_LOG_DIR;
    process.env.ANDROPERATOR_LOG_DIR = join(root, "environment");
  });
  afterEach(async () => {
    if (originalDir === undefined) delete process.env.ANDROPERATOR_LOG_DIR;
    else process.env.ANDROPERATOR_LOG_DIR = originalDir;
    await rm(root, { recursive: true, force: true });
  });

  it("shares explicit, environment and default precedence with parent and child loggers", async () => {
    const explicit = join(root, "explicit");
    const logger = createAndroperatorLogger({ logDir: explicit });
    assert.equal(resolveLogDestination(explicit).logDir, explicit);
    assert.equal(resolveLogDestination().logDir, join(root, "environment"));
    assert.deepEqual(getLoggerDestination(logger.child({ taskId: "test" })), getLoggerDestination(logger));
    process.env.ANDROPERATOR_LOG_DIR = join(root, "changed");
    const check = await checkLogDestination(logger);
    assert.equal(check.evidence?.logDir, explicit);
    assert.equal(check.evidence?.logPath, getLoggerDestination(logger).logPath);
    assert.equal(logger.logPath(), undefined);
    delete process.env.ANDROPERATOR_LOG_DIR;
    assert.equal(resolveLogDestination().logDir, join(homedir(), ".androperator/logs"));
  });

  it("opens the daily file in append mode without writing synthetic content or truncating", async () => {
    const logger = createAndroperatorLogger();
    const { logDir, logPath } = getLoggerDestination(logger);
    await mkdir(logDir, { recursive: true });
    await writeFile(logPath, "existing log\n");
    assert.equal((await checkLogDestination(logger)).status, "pass");
    assert.equal(await readFile(logPath, "utf8"), "existing log\n");
    let closed = false;
    const checked = await checkLogDestination(logger, {
      mkdir: async path => assert.equal(path, logDir),
      open: async path => {
        assert.equal(path, logPath);
        return { close: async () => { closed = true; } };
      },
    });
    assert.equal(checked.evidence?.writable, true);
    assert.equal(closed, true);
  });

  for (const stage of ["mkdir", "open", "close"] as const) {
    it(`reports injected ${stage} failure without relying on filesystem permissions`, async () => {
      const failure = () => { throw new Error("EACCES: injected write denial"); };
      const check = await checkLogDestination(undefined, {
        mkdir: async () => { if (stage === "mkdir") failure(); },
        open: async () => {
          if (stage === "open") failure();
          return { close: async () => { if (stage === "close") failure(); } };
        },
      });
      assert.equal(check.status, "warn");
      assert.equal(check.code, "LOG_DIRECTORY_UNWRITABLE");
      assert.equal(check.evidence?.writable, false);
      assert.equal(check.evidence?.logPath, resolveLogDestination().logPath);
      assert.match(check.detail!, /injected write denial/);
      assert.match(check.fix!.steps[0].value, /ANDROPERATOR_LOG_DIR/);
    });
  }

  it("reports a file used as directory and a directory used as daily file", async () => {
    const logDir = join(root, "not-a-directory");
    await writeFile(logDir, "keep");
    const logger = createAndroperatorLogger({ logDir });
    assert.equal((await checkLogDestination(logger)).status, "warn");
    assert.equal(await readFile(logDir, "utf8"), "keep");
    const daily = resolveLogDestination(join(root, "daily-directory"));
    await mkdir(daily.logPath, { recursive: true });
    const check = await checkLogDestination(createAndroperatorLogger({ logDir: daily.logDir }));
    assert.equal(check.status, "warn");
    assert.equal(check.evidence?.logPath, daily.logPath);
  });

  it("retains the attempted destination after a write disables logging", async () => {
    const logDir = join(root, "file");
    await writeFile(logDir, "keep");
    const logger = createAndroperatorLogger({ logDir });
    logger.emit({ ts: new Date().toISOString(), level: "info", event: "doctor.check", message: "test" });
    assert.equal(logger.logPath(), undefined);
    const check = await checkLogDestination(logger.child({ taskId: "test" }));
    assert.equal(check.evidence?.logDir, logDir);
    assert.equal(check.evidence?.logPath, resolveLogDestination(logDir).logPath);
  });
});
