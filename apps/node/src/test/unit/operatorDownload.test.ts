import { afterEach, describe, it } from "node:test";
import assert from "node:assert";
import { createHash } from "node:crypto";
import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { cmdOperatorDownload } from "../../cli/commands/operatorDownload.js";
import { ERROR_CODES } from "../../contracts/errors.js";
import { downloadOperatorApk } from "../../domain/version/operatorDownload.js";

const ENV_KEYS = [
  "HOME",
  "ANDROPERATOR_APK_METADATA_URL",
  "ANDROPERATOR_OPERATOR_PACKAGE",
] as const;

const ORIGINAL_ENV = new Map<string, string | undefined>(
  ENV_KEYS.map((key) => [key, process.env[key]]),
);

afterEach(() => {
  process.exitCode = undefined;
  for (const [key, value] of ORIGINAL_ENV.entries()) {
    if (value === undefined) {
      delete process.env[key];
    } else {
      process.env[key] = value;
    }
  }
});

async function makeTempHome(): Promise<string> {
  return mkdtemp(join(tmpdir(), "androperator-operator-download-"));
}

function sha256Hex(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

async function withHttpServer(
  handler: (req: IncomingMessage, res: ServerResponse) => void,
  run: (baseUrl: string) => Promise<void>,
): Promise<void> {
  const server = createServer(handler);
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", () => resolve()));
  const address = server.address();
  if (!address || typeof address === "string") {
    server.close();
    throw new Error("Failed to resolve HTTP test server address");
  }

  try {
    await run(`http://127.0.0.1:${address.port}`);
  } finally {
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
}

describe("operator download", () => {
  it("writes the APK to the canonical path when metadata includes an inline checksum", async () => {
    const homeDir = await makeTempHome();
    const apkContents = "apk-inline-checksum";
    const checksum = sha256Hex(apkContents);

    try {
      process.env.HOME = homeDir;

      await withHttpServer((req, res) => {
        if (req.url === "/latest.json") {
          res.writeHead(200, { "content-type": "application/json" });
          res.end(JSON.stringify({
            version: "0.7.4",
            apk_url: `${serverBase(req)}/operator.apk`,
            sha256_url: `${serverBase(req)}/operator.apk.sha256`,
            sha256: checksum,
          }));
          return;
        }
        if (req.url === "/operator.apk") {
          res.writeHead(200, { "content-type": "application/vnd.android.package-archive" });
          res.end(apkContents);
          return;
        }

        res.writeHead(404);
        res.end();
      }, async (baseUrl) => {
        process.env.ANDROPERATOR_APK_METADATA_URL = `${baseUrl}/latest.json`;
        const result = await downloadOperatorApk();

        assert.strictEqual(result.localPath, join(homeDir, ".androperator", "downloads", "operator.apk"));
        assert.strictEqual(result.operatorVersion, "0.7.4");
        assert.strictEqual(result.sha256, checksum);
        assert.strictEqual(result.operatorPackage, "com.androperator.operator");
        assert.strictEqual(result.checksumSource, "inline");
        assert.strictEqual(await readFile(result.localPath, "utf8"), apkContents);
      });
    } finally {
      await rm(homeDir, { recursive: true, force: true });
    }
  });

  it("downloads an external checksum file when metadata does not include an inline checksum", async () => {
    const homeDir = await makeTempHome();
    const apkContents = "apk-external-checksum";
    const checksum = sha256Hex(apkContents);

    try {
      process.env.HOME = homeDir;

      await withHttpServer((req, res) => {
        if (req.url === "/latest.json") {
          res.writeHead(200, { "content-type": "application/json" });
          res.end(JSON.stringify({
            version: "0.7.4",
            apk_url: `${serverBase(req)}/operator.apk`,
            sha256_url: `${serverBase(req)}/operator.apk.sha256`,
          }));
          return;
        }
        if (req.url === "/operator.apk") {
          res.writeHead(200, { "content-type": "application/vnd.android.package-archive" });
          res.end(apkContents);
          return;
        }
        if (req.url === "/operator.apk.sha256") {
          res.writeHead(200, { "content-type": "text/plain" });
          res.end(`${checksum}  operator.apk\n`);
          return;
        }

        res.writeHead(404);
        res.end();
      }, async (baseUrl) => {
        process.env.ANDROPERATOR_APK_METADATA_URL = `${baseUrl}/latest.json`;
        const result = await downloadOperatorApk();

        assert.strictEqual(result.checksumSource, "external");
        assert.strictEqual(result.sha256, checksum);
        assert.strictEqual(await readFile(result.localPath, "utf8"), apkContents);
      });
    } finally {
      await rm(homeDir, { recursive: true, force: true });
    }
  });

  it("treats a blank ANDROPERATOR_OPERATOR_PACKAGE env var as unset", async () => {
    const homeDir = await makeTempHome();
    const apkContents = "apk-blank-operator-package-env";
    const checksum = sha256Hex(apkContents);

    try {
      process.env.HOME = homeDir;
      process.env.ANDROPERATOR_OPERATOR_PACKAGE = "";

      await withHttpServer((req, res) => {
        if (req.url === "/latest.json") {
          res.writeHead(200, { "content-type": "application/json" });
          res.end(JSON.stringify({
            version: "0.7.4",
            apk_url: `${serverBase(req)}/operator.apk`,
            sha256_url: `${serverBase(req)}/operator.apk.sha256`,
            sha256: checksum,
          }));
          return;
        }
        if (req.url === "/operator.apk") {
          res.writeHead(200, { "content-type": "application/vnd.android.package-archive" });
          res.end(apkContents);
          return;
        }

        res.writeHead(404);
        res.end();
      }, async (baseUrl) => {
        process.env.ANDROPERATOR_APK_METADATA_URL = `${baseUrl}/latest.json`;
        const result = await downloadOperatorApk();

        assert.strictEqual(result.operatorPackage, "com.androperator.operator");
        assert.strictEqual(result.localPath, join(homeDir, ".androperator", "downloads", "operator.apk"));
        assert.strictEqual(await readFile(result.localPath, "utf8"), apkContents);
      });
    } finally {
      await rm(homeDir, { recursive: true, force: true });
    }
  });

  it("replaces a pre-existing destination path before writing the APK", async () => {
    const homeDir = await makeTempHome();
    const apkContents = "apk-existing-destination";
    const checksum = sha256Hex(apkContents);
    const existingDestination = join(homeDir, ".androperator", "downloads", "operator.apk");

    try {
      process.env.HOME = homeDir;
      await mkdir(existingDestination, { recursive: true });

      await withHttpServer((req, res) => {
        if (req.url === "/latest.json") {
          res.writeHead(200, { "content-type": "application/json" });
          res.end(JSON.stringify({
            version: "0.7.4",
            apk_url: `${serverBase(req)}/operator.apk`,
            sha256_url: `${serverBase(req)}/operator.apk.sha256`,
            sha256: checksum,
          }));
          return;
        }
        if (req.url === "/operator.apk") {
          res.writeHead(200, { "content-type": "application/vnd.android.package-archive" });
          res.end(apkContents);
          return;
        }

        res.writeHead(404);
        res.end();
      }, async (baseUrl) => {
        process.env.ANDROPERATOR_APK_METADATA_URL = `${baseUrl}/latest.json`;
        const result = await downloadOperatorApk();

        assert.strictEqual(result.localPath, existingDestination);
        assert.strictEqual(await readFile(result.localPath, "utf8"), apkContents);
      });
    } finally {
      await rm(homeDir, { recursive: true, force: true });
    }
  });

  it("fails when required metadata fields are missing", async () => {
    await withHttpServer((req, res) => {
      if (req.url === "/latest.json") {
        res.writeHead(200, { "content-type": "application/json" });
        res.end(JSON.stringify({
          version: "0.7.4",
          apk_url: "https://example.com/operator.apk",
        }));
        return;
      }

      res.writeHead(404);
      res.end();
    }, async (baseUrl) => {
      process.env.ANDROPERATOR_APK_METADATA_URL = `${baseUrl}/latest.json`;
      await assert.rejects(
        () => downloadOperatorApk(),
        (error: unknown) => {
          const typed = error as { code?: string; message?: string };
          return typed.code === ERROR_CODES.OPERATOR_METADATA_INVALID
            && /missing sha256_url/i.test(typed.message ?? "");
        },
      );
    });
  });

  it("fails when metadata JSON is malformed", async () => {
    await withHttpServer((req, res) => {
      if (req.url === "/latest.json") {
        res.writeHead(200, { "content-type": "application/json" });
        res.end('{"version":');
        return;
      }

      res.writeHead(404);
      res.end();
    }, async (baseUrl) => {
      process.env.ANDROPERATOR_APK_METADATA_URL = `${baseUrl}/latest.json`;
      await assert.rejects(
        () => downloadOperatorApk(),
        (error: unknown) => {
          const typed = error as { code?: string; message?: string };
          return typed.code === ERROR_CODES.OPERATOR_METADATA_INVALID
            && /not valid json/i.test(typed.message ?? "");
        },
      );
    });
  });

  it("fails when the downloaded APK checksum does not match", async () => {
    const homeDir = await makeTempHome();
    const apkContents = "apk-checksum-mismatch";

    try {
      process.env.HOME = homeDir;

      await withHttpServer((req, res) => {
        if (req.url === "/latest.json") {
          res.writeHead(200, { "content-type": "application/json" });
          res.end(JSON.stringify({
            version: "0.7.4",
            apk_url: `${serverBase(req)}/operator.apk`,
            sha256_url: `${serverBase(req)}/operator.apk.sha256`,
            sha256: sha256Hex("different-apk"),
          }));
          return;
        }
        if (req.url === "/operator.apk") {
          res.writeHead(200, { "content-type": "application/vnd.android.package-archive" });
          res.end(apkContents);
          return;
        }

        res.writeHead(404);
        res.end();
      }, async (baseUrl) => {
        process.env.ANDROPERATOR_APK_METADATA_URL = `${baseUrl}/latest.json`;
        await assert.rejects(
          () => downloadOperatorApk(),
          (error: unknown) => {
            const typed = error as { code?: string; message?: string };
            return typed.code === ERROR_CODES.OPERATOR_CHECKSUM_FAILED
              && /checksum did not match/i.test(typed.message ?? "");
          },
        );

        const downloadsDir = join(homeDir, ".androperator", "downloads");
        assert.deepStrictEqual(await readdir(downloadsDir), []);
      });
    } finally {
      await rm(homeDir, { recursive: true, force: true });
    }
  });

  it("emits a structured download error when the canonical APK path is not writable", async () => {
    const homeDir = await makeTempHome();
    const apkContents = "apk-write-failure";
    const checksum = sha256Hex(apkContents);

    try {
      process.env.HOME = homeDir;
      await writeFile(join(homeDir, ".androperator"), "not-a-directory");

      await withHttpServer((req, res) => {
        if (req.url === "/latest.json") {
          res.writeHead(200, { "content-type": "application/json" });
          res.end(JSON.stringify({
            version: "0.7.4",
            apk_url: `${serverBase(req)}/operator.apk`,
            sha256_url: `${serverBase(req)}/operator.apk.sha256`,
            sha256: checksum,
          }));
          return;
        }
        if (req.url === "/operator.apk") {
          res.writeHead(200, { "content-type": "application/vnd.android.package-archive" });
          res.end(apkContents);
          return;
        }

        res.writeHead(404);
        res.end();
      }, async (baseUrl) => {
        process.env.ANDROPERATOR_APK_METADATA_URL = `${baseUrl}/latest.json`;
        const output = await cmdOperatorDownload({ format: "json" });
        const parsed = JSON.parse(output) as {
          code: string;
          message: string;
          hint?: string;
          details?: {
            localPath?: string;
          };
        };

        assert.strictEqual(parsed.code, ERROR_CODES.OPERATOR_DOWNLOAD_FAILED);
        assert.match(parsed.message, /failed to write operator apk/i);
        assert.match(parsed.hint ?? "", /download directory is writable/i);
        assert.strictEqual(parsed.details?.localPath, join(homeDir, ".androperator", "downloads", "operator.apk"));
        assert.strictEqual(process.exitCode, 1);
      });
    } finally {
      await rm(homeDir, { recursive: true, force: true });
    }
  });

  it("emits installer-consumable JSON fields on success", async () => {
    const homeDir = await makeTempHome();
    const apkContents = "apk-command-success";
    const checksum = sha256Hex(apkContents);

    try {
      process.env.HOME = homeDir;

      await withHttpServer((req, res) => {
        if (req.url === "/latest.json") {
          res.writeHead(200, { "content-type": "application/json" });
          res.end(JSON.stringify({
            version: "0.7.4",
            apk_url: `${serverBase(req)}/operator.apk`,
            sha256_url: `${serverBase(req)}/operator.apk.sha256`,
            sha256: checksum,
          }));
          return;
        }
        if (req.url === "/operator.apk") {
          res.writeHead(200, { "content-type": "application/vnd.android.package-archive" });
          res.end(apkContents);
          return;
        }

        res.writeHead(404);
        res.end();
      }, async (baseUrl) => {
        process.env.ANDROPERATOR_APK_METADATA_URL = `${baseUrl}/latest.json`;
        const output = await cmdOperatorDownload({ format: "json" });
        const parsed = JSON.parse(output) as {
          localPath: string;
          operatorVersion: string;
          sha256: string;
          operatorPackage: string;
        };

        assert.strictEqual(parsed.localPath, join(homeDir, ".androperator", "downloads", "operator.apk"));
        assert.strictEqual(parsed.operatorVersion, "0.7.4");
        assert.strictEqual(parsed.sha256, checksum);
        assert.strictEqual(parsed.operatorPackage, "com.androperator.operator");
        assert.strictEqual(process.exitCode, undefined);
      });
    } finally {
      await rm(homeDir, { recursive: true, force: true });
    }
  });
});

function serverBase(req: IncomingMessage): string {
  const host = req.headers.host;
  if (!host) {
    throw new Error("Missing test server host header");
  }
  return `http://${host}`;
}
