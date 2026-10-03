import { createHash } from "node:crypto";
import { createWriteStream } from "node:fs";
import { mkdir, rename, rm } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { Readable, Transform } from "node:stream";
import { pipeline } from "node:stream/promises";
import { expandHomePath } from "../../contracts/logging.js";
import { ERROR_CODES, type AndroperatorError } from "../../contracts/errors.js";
import { getOperatorPackageApkPath } from "./compatibility.js";

const DEFAULT_METADATA_URL = "https://downloads.androperator.com/operator/latest.json";
const RELEASE_OPERATOR_PACKAGE = "com.androperator.operator";
const SHA256_HEX_REGEX = /^[a-f0-9]{64}$/i;

interface OperatorApkMetadata {
  version: string;
  apk_url: string;
  sha256_url: string;
  sha256?: string;
}

export interface DownloadOperatorApkOptions {
  operatorPackage?: string;
  metadataUrl?: string;
}

export interface OperatorDownloadResult {
  localPath: string;
  operatorVersion: string;
  sha256: string;
  operatorPackage: string;
  checksumSource: "inline" | "external";
  metadataUrl: string;
  apkUrl: string;
  sha256Url: string;
}

function getResolvedOperatorPackage(operatorPackage?: string): string {
  const candidate = operatorPackage ?? process.env.ANDROPERATOR_OPERATOR_PACKAGE;
  if (typeof candidate === "string") {
    const trimmed = candidate.trim();
    if (trimmed.length > 0) {
      return trimmed;
    }
  }

  return RELEASE_OPERATOR_PACKAGE;
}

function buildDownloadError(
  code: AndroperatorError["code"],
  message: string,
  details?: Record<string, unknown>,
  hint?: string,
): AndroperatorError {
  return {
    code,
    message,
    hint,
    details,
  };
}

async function fetchText(url: string): Promise<string> {
  let response: Response;
  try {
    response = await fetch(url);
  } catch (error) {
    throw buildDownloadError(
      ERROR_CODES.OPERATOR_DOWNLOAD_FAILED,
      `Failed to fetch ${url}.`,
      { url, cause: String(error) },
    );
  }

  if (!response.ok) {
    throw buildDownloadError(
      ERROR_CODES.OPERATOR_DOWNLOAD_FAILED,
      `Failed to fetch ${url}: HTTP ${response.status}.`,
      { url, status: response.status },
    );
  }

  return response.text();
}

async function downloadApkToTempFile(url: string, tempPath: string): Promise<string> {
  let response: Response;
  try {
    response = await fetch(url);
  } catch (error) {
    throw buildDownloadError(
      ERROR_CODES.OPERATOR_DOWNLOAD_FAILED,
      `Failed to download ${url}.`,
      { url, cause: String(error) },
    );
  }

  if (!response.ok) {
    throw buildDownloadError(
      ERROR_CODES.OPERATOR_DOWNLOAD_FAILED,
      `Failed to download ${url}: HTTP ${response.status}.`,
      { url, status: response.status },
    );
  }

  if (!response.body) {
    throw buildDownloadError(
      ERROR_CODES.OPERATOR_DOWNLOAD_FAILED,
      `Failed to download ${url}: response body was empty.`,
      { url },
    );
  }

  const hash = createHash("sha256");
  const hashingStream = new Transform({
    transform(chunk, _encoding, callback) {
      try {
        hash.update(chunk as Uint8Array);
        callback(null, chunk);
      } catch (error) {
        callback(error as Error);
      }
    },
  });

  try {
    await pipeline(
      Readable.fromWeb(response.body),
      hashingStream,
      createWriteStream(tempPath),
    );
  } catch (error) {
    throw buildDownloadError(
      ERROR_CODES.OPERATOR_DOWNLOAD_FAILED,
      `Failed to download ${url}.`,
      { url, tempPath, cause: String(error) },
    );
  }

  return hash.digest("hex");
}

function parseMetadata(raw: string, metadataUrl: string): OperatorApkMetadata {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (error) {
    throw buildDownloadError(
      ERROR_CODES.OPERATOR_METADATA_INVALID,
      `Operator metadata at ${metadataUrl} was not valid JSON.`,
      { metadataUrl, cause: String(error) },
    );
  }

  if (!parsed || typeof parsed !== "object") {
    throw buildDownloadError(
      ERROR_CODES.OPERATOR_METADATA_INVALID,
      `Operator metadata at ${metadataUrl} must be a JSON object.`,
      { metadataUrl },
    );
  }

  const metadata = parsed as Partial<OperatorApkMetadata>;
  for (const key of ["version", "apk_url", "sha256_url"] as const) {
    if (typeof metadata[key] !== "string" || metadata[key].trim().length === 0) {
      throw buildDownloadError(
        ERROR_CODES.OPERATOR_METADATA_INVALID,
        `Operator metadata at ${metadataUrl} is missing ${key}.`,
        { metadataUrl, missingField: key },
      );
    }
  }

  const version = (metadata.version as string).trim();
  const apkUrl = (metadata.apk_url as string).trim();
  const sha256Url = (metadata.sha256_url as string).trim();

  if (
    metadata.sha256 !== undefined
    && (typeof metadata.sha256 !== "string" || metadata.sha256.trim().length === 0)
  ) {
    throw buildDownloadError(
      ERROR_CODES.OPERATOR_METADATA_INVALID,
      `Operator metadata at ${metadataUrl} contained an invalid sha256 field.`,
      { metadataUrl },
    );
  }

  return {
    version,
    apk_url: apkUrl,
    sha256_url: sha256Url,
    sha256: metadata.sha256?.trim(),
  };
}

function parseExpectedSha256(value: string, sourceUrl: string): string {
  const firstToken = value.trim().split(/\s+/)[0] ?? "";
  if (!SHA256_HEX_REGEX.test(firstToken)) {
    throw buildDownloadError(
      ERROR_CODES.OPERATOR_CHECKSUM_FAILED,
      `Checksum source ${sourceUrl} did not contain a valid SHA-256 hash.`,
      { sourceUrl },
    );
  }
  return firstToken.toLowerCase();
}

export async function downloadOperatorApk(
  options: DownloadOperatorApkOptions = {},
): Promise<OperatorDownloadResult> {
  const operatorPackage = getResolvedOperatorPackage(options.operatorPackage);
  if (operatorPackage !== RELEASE_OPERATOR_PACKAGE) {
    throw buildDownloadError(
      ERROR_CODES.OPERATOR_DOWNLOAD_UNSUPPORTED,
      `Automatic operator download is only available for ${RELEASE_OPERATOR_PACKAGE}.`,
      {
        operatorPackage,
        localPath: getOperatorPackageApkPath(operatorPackage),
      },
      `Use a matching local debug APK and run androperator operator setup --apk ${getOperatorPackageApkPath(operatorPackage)} --operator-package ${operatorPackage}.`,
    );
  }

  const metadataUrl = options.metadataUrl ?? process.env.ANDROPERATOR_APK_METADATA_URL ?? DEFAULT_METADATA_URL;
  const metadata = parseMetadata(await fetchText(metadataUrl), metadataUrl);
  const checksumSource = metadata.sha256?.trim() ? "inline" : "external";
  const expectedSha256 = checksumSource === "inline"
    ? parseExpectedSha256(metadata.sha256 ?? "", metadataUrl)
    : parseExpectedSha256(await fetchText(metadata.sha256_url), metadata.sha256_url);
  const localPath = resolve(expandHomePath(getOperatorPackageApkPath(operatorPackage)));
  const tempPath = join(dirname(localPath), `.androperator-operator-download.${process.pid}.${Date.now()}.tmp`);
  try {
    await mkdir(dirname(localPath), { recursive: true });
  } catch (error) {
    throw buildDownloadError(
      ERROR_CODES.OPERATOR_DOWNLOAD_FAILED,
      `Failed to write Operator APK to ${localPath}.`,
      {
        operatorPackage,
        operatorVersion: metadata.version,
        localPath,
        cause: String(error),
      },
      "Ensure the download directory is writable, then re-run androperator operator download.",
    );
  }

  let actualSha256 = "";
  try {
    actualSha256 = await downloadApkToTempFile(metadata.apk_url, tempPath);

    if (expectedSha256 !== actualSha256) {
      throw buildDownloadError(
        ERROR_CODES.OPERATOR_CHECKSUM_FAILED,
        "Downloaded Operator APK checksum did not match the expected SHA-256 hash.",
        {
          operatorPackage,
          operatorVersion: metadata.version,
          expectedSha256,
          actualSha256,
          apkUrl: metadata.apk_url,
          sha256Url: metadata.sha256_url,
        },
        "Re-run androperator operator download to fetch a fresh verified copy.",
      );
    }

    try {
      // Windows cannot rename over an existing destination, so clear any stale path first.
      await rm(localPath, { force: true, recursive: true });
      await rename(tempPath, localPath);
    } catch (error) {
      throw buildDownloadError(
        ERROR_CODES.OPERATOR_DOWNLOAD_FAILED,
        `Failed to write Operator APK to ${localPath}.`,
        {
          operatorPackage,
          operatorVersion: metadata.version,
          localPath,
          cause: String(error),
        },
        "Ensure the download directory is writable, then re-run androperator operator download.",
      );
    }
  } finally {
    await rm(tempPath, { force: true }).catch(() => undefined);
  }

  return {
    localPath,
    operatorVersion: metadata.version,
    sha256: actualSha256,
    operatorPackage,
    checksumSource,
    metadataUrl,
    apkUrl: metadata.apk_url,
    sha256Url: metadata.sha256_url,
  };
}
