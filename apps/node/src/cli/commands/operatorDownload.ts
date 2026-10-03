import type { OutputOptions } from "../output.js";
import { formatError, formatSuccess } from "../output.js";
import { downloadOperatorApk } from "../../domain/version/operatorDownload.js";
import { isAndroperatorError } from "../../contracts/errors.js";

export async function cmdOperatorDownload(options: OutputOptions & {
  operatorPackage?: string;
}): Promise<string> {
  try {
    const result = await downloadOperatorApk({
      operatorPackage: options.operatorPackage,
    });

    return formatSuccess({
      ...result,
      message: `Downloaded and verified Operator APK ${result.operatorVersion}.`,
    }, options);
  } catch (error) {
    process.exitCode = 1;
    return formatError(
      isAndroperatorError(error)
        ? error
        : { code: "UNKNOWN", message: String(error) },
      options,
    );
  }
}
